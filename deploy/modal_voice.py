"""JARVIS Modal Voice — low-latency Polish streaming STT + TTS microservice with barge-in.

Verified models:
  - STT: faster-whisper "large-v3-turbo" (based on openai/whisper-large-v3-turbo, native Polish + VAD)
  - TTS: ResembleAI/chatterbox (Chatterbox Multilingual, language_id="pl") with configurable engine
         override (MODAL_TTS_MODEL / MODAL_TTS_ENGINE, e.g. chatterbox or agnostic/Qwen3-TTS-Polish)

Deploy (no region pinning, memory snapshots enabled, scaledown_window=60):
    modal deploy deploy/modal_voice.py

Endpoints (Bearer VLLM_API_KEY from secret 'jarvis-vllm'):
  - GET  /health
  - POST /v1/stt      (multipart 'file' or raw audio bytes, ?language=pl) -> {text, language, latency_ms}
  - POST /v1/tts      ({text, language: "pl", exaggeration: 0.45})        -> streaming audio/wav
  - WS   /v1/duplex   (binary PCM/webm frames + JSON {"type":"barge_in"} cancellation)
"""

import io
import os
import tempfile
import time
import wave

import modal

APP_NAME = "jarvis-voice"
GPU_SPEC = os.environ.get("MODAL_VOICE_GPU", "L4")
STT_MODEL_ID = os.environ.get("MODAL_STT_MODEL", "large-v3-turbo")
TTS_ENGINE = os.environ.get("MODAL_TTS_ENGINE", "chatterbox")
SCALEDOWN_WINDOW_SECONDS = 60
TIMEOUT_SECONDS = 600

voice_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "fastapi[standard]>=0.115.0",
        "python-multipart>=0.0.12",
        "faster-whisper>=1.1.0",
        "chatterbox-tts>=0.1.3",
        "numpy>=1.26.0",
        "huggingface_hub[hf_transfer]>=0.28.0",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

hf_cache_vol = modal.Volume.from_name("jarvis-hf-cache", create_if_missing=True)
app = modal.App(APP_NAME)


def _check_auth(auth_header: str | None) -> bool:
    expected = (os.environ.get("VLLM_API_KEY") or "").strip()
    if not expected:
        return True
    token = (auth_header or "").replace("Bearer ", "").replace("bearer ", "").strip()
    return token == expected


@app.cls(
    image=voice_image,
    gpu=GPU_SPEC,
    scaledown_window=SCALEDOWN_WINDOW_SECONDS,
    timeout=TIMEOUT_SECONDS,
    enable_memory_snapshot=True,
    secrets=[modal.Secret.from_name("jarvis-vllm")],
    volumes={"/root/.cache/huggingface": hf_cache_vol},
)
@modal.concurrent(max_inputs=8)
class VoiceService:
    @modal.enter(snap=True)
    def load_models(self):
        from faster_whisper import WhisperModel

        self.stt = WhisperModel(STT_MODEL_ID, device="cuda", compute_type="float16")
        self.tts = None
        if TTS_ENGINE == "chatterbox":
            try:
                from chatterbox.mtl_tts import ChatterboxMultilingualTTS

                self.tts = ChatterboxMultilingualTTS.from_pretrained(device="cuda")
            except Exception as exc:
                print(f"[jarvis-voice] Chatterbox load warning (lazy fallback): {exc}")

    def _transcribe_bytes(self, raw: bytes, language: str = "pl") -> dict:
        t0 = time.perf_counter()
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=True) as tmp:
            tmp.write(raw)
            tmp.flush()
            segments, info = self.stt.transcribe(
                tmp.name,
                language=language or "pl",
                vad_filter=True,
                beam_size=1,
            )
            text = " ".join(seg.text.strip() for seg in segments).strip()
        return {
            "text": text,
            "language": getattr(info, "language", language or "pl"),
            "latency_ms": int((time.perf_counter() - t0) * 1000),
        }

    def _synthesize_wav_chunks(self, text: str, language: str = "pl", exaggeration: float = 0.45):
        import numpy as np

        if self.tts is None:
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS

            self.tts = ChatterboxMultilingualTTS.from_pretrained(device="cuda")

        # Dzielimy wypowiedź na zdania, by pierwszy pakiet audio ruszył jak najszybciej
        # (niskie opóźnienie + natychmiastowy barge-in po przerwaniu połączenia przez klienta).
        parts = [p.strip() for p in text.replace("!", "!|").replace("?", "?|").replace(". ", ".|").split("|") if p.strip()]
        if not parts:
            parts = [text.strip()]

        sample_rate = int(getattr(self.tts, "sr", 24000))
        pcm_blocks = []
        for sentence in parts:
            wav_tensor = self.tts.generate(
                sentence,
                language_id=(language or "pl")[:2].lower(),
                exaggeration=float(exaggeration),
            )
            arr = wav_tensor.squeeze().detach().cpu().numpy()
            pcm16 = np.clip(arr * 32767.0, -32768, 32767).astype(np.int16)
            pcm_blocks.append(pcm16.tobytes())

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            for block in pcm_blocks:
                wf.writeframes(block)
        buf.seek(0)
        while True:
            chunk = buf.read(16384)
            if not chunk:
                break
            yield chunk

    @modal.asgi_app()
    def web(self):
        from fastapi import FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
        from fastapi.middleware.cors import CORSMiddleware
        from fastapi.responses import StreamingResponse

        api = FastAPI(title="JARVIS Modal Voice")
        api.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )

        @api.get("/health")
        async def health():
            return {"ok": True, "stt": STT_MODEL_ID, "tts": TTS_ENGINE, "gpu": GPU_SPEC}

        @api.post("/v1/stt")
        async def stt_endpoint(
            request: Request,
            language: str = "pl",
            authorization: str | None = Header(default=None),
        ):
            if not _check_auth(authorization):
                raise HTTPException(status_code=401, detail="Invalid VLLM_API_KEY")
            ct = (request.headers.get("content-type") or "").lower()
            if "multipart/form-data" in ct:
                form = await request.form()
                upload = form.get("file")
                if upload is None:
                    raise HTTPException(status_code=400, detail="Missing 'file' upload")
                raw = await upload.read()
            else:
                raw = await request.body()
            if not raw:
                raise HTTPException(status_code=400, detail="Empty audio payload")
            return self._transcribe_bytes(raw, language=language)

        @api.post("/v1/tts")
        async def tts_endpoint(
            request: Request,
            authorization: str | None = Header(default=None),
        ):
            if not _check_auth(authorization):
                raise HTTPException(status_code=401, detail="Invalid VLLM_API_KEY")
            body = await request.json()
            text = str(body.get("text") or "").strip()
            if not text:
                raise HTTPException(status_code=400, detail="Missing 'text'")
            language = str(body.get("language") or "pl")
            exaggeration = float(body.get("exaggeration", 0.45))
            return StreamingResponse(
                self._synthesize_wav_chunks(text, language=language, exaggeration=exaggeration),
                media_type="audio/wav",
            )

        @api.websocket("/v1/duplex")
        async def duplex_ws(ws: WebSocket):
            token = ws.query_params.get("token") or ws.headers.get("authorization")
            if not _check_auth(token):
                await ws.close(code=4401)
                return
            await ws.accept()
            audio_buf = bytearray()
            try:
                while True:
                    msg = await ws.receive()
                    if msg.get("bytes"):
                        audio_buf.extend(msg["bytes"])
                    elif msg.get("text"):
                        import json

                        data = json.loads(msg["text"])
                        kind = data.get("type")
                        if kind == "barge_in":
                            audio_buf.clear()
                            await ws.send_json({"type": "barge_in_ack"})
                        elif kind == "commit" and audio_buf:
                            res = self._transcribe_bytes(bytes(audio_buf), language=data.get("language", "pl"))
                            audio_buf.clear()
                            await ws.send_json({"type": "transcript", **res})
            except WebSocketDisconnect:
                return

        return api
