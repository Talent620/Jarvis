#!/usr/bin/env python3
"""
JARVIS FORGE — Zero-Secret-Leak Modal Brain Bridge (Category C: Promotional Credits).

Dwa tryby pracy pod twardą kontrolą `PromoBudgetGovernor` z `forge/budget.mjs`:
1. Domyślny (`--ephemeral-vllm` / `--daemon`): uruchamia efemeryczny, samogasnący worker
   `@app.cls` z vLLM (`Qwen/Qwen3-32B-AWQ` z istniejącego wolumenu `jarvis-hf-cache` na GPU
   `A100-40GB`, `scaledown_window=15`, `timeout=360`). Brak publicznego URL i brak sekretów
   (komunikacja wyłącznie prywatnym RPC Modal `.remote()`), a kontener znika natychmiast po
   zakończeniu `with app.run():`.
2. Tryb relay (`--relay`): przekazuje żądania do wdrożonego `jarvis-brain` z użyciem sekretu
   `jarvis-vllm` wyłącznie po stronie serwera Modal (klucz nigdy nie trafia na VM).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any

import modal

MODEL_NAME = os.environ.get("FORGE_MODAL_MODEL", "Qwen/Qwen3-32B-AWQ")
GPU_SPEC = os.environ.get("FORGE_MODAL_GPU", "A100-40GB")
MAX_MODEL_LEN = int(os.environ.get("FORGE_MODAL_MAX_LEN", "12288"))
VLLM_PORT = 8000

app = modal.App("jarvis-forge-ephemeral-brain")

vllm_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "vllm>=0.8.5",
        "huggingface_hub[hf_transfer]>=0.28.0",
    )
    .env(
        {
            "HF_HUB_ENABLE_HF_TRANSFER": "1",
            "VLLM_USAGE_SOURCE": "production-docker-image",
            "VLLM_USE_V1": "1",
        }
    )
)

hf_cache_vol = modal.Volume.from_name("jarvis-hf-cache", create_if_missing=True)
vllm_cache_vol = modal.Volume.from_name("jarvis-vllm-cache", create_if_missing=True)


@app.cls(
    image=vllm_image,
    gpu=GPU_SPEC,
    scaledown_window=15,
    timeout=360,
    max_containers=1,
    volumes={
        "/root/.cache/huggingface": hf_cache_vol,
        "/root/.cache/vllm": vllm_cache_vol,
    },
)
class ForgeBrainWorker:
    @modal.enter()
    def start_vllm(self) -> None:
        cmd = [
            "vllm",
            "serve",
            MODEL_NAME,
            "--host",
            "127.0.0.1",
            "--port",
            str(VLLM_PORT),
            "--served-model-name",
            MODEL_NAME,
            "--max-model-len",
            str(MAX_MODEL_LEN),
            "--gpu-memory-utilization",
            "0.88",
            "--enable-auto-tool-choice",
            "--tool-call-parser",
            "hermes",
            "--enforce-eager",
            "--uvicorn-log-level",
            "warning",
        ]
        if "awq" in MODEL_NAME.lower():
            cmd.extend(["--dtype", "half"])

        self._proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        deadline = time.time() + 210
        health_url = f"http://127.0.0.1:{VLLM_PORT}/health"
        while time.time() < deadline:
            if self._proc.poll() is not None:
                err_txt = ""
                try:
                    err_txt = (self._proc.stderr.read() or b"").decode("utf-8", errors="replace")[-1200:]
                except Exception:
                    pass
                raise RuntimeError(f"vLLM exited prematurely ({self._proc.returncode}): {err_txt}")
            try:
                with urllib.request.urlopen(health_url, timeout=2) as r:
                    if r.status == 200:
                        return
            except Exception:
                time.sleep(1.5)
        raise RuntimeError("Timeout oczekiwania na gotowość lokalnego vLLM w kontenerze Modal.")

    @modal.exit()
    def stop_vllm(self) -> None:
        proc = getattr(self, "_proc", None)
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()

    @modal.method()
    def chat(self, payload: dict[str, Any], timeout_s: int = 120) -> dict[str, Any]:
        body = dict(payload)
        body["model"] = MODEL_NAME
        # Wyłącz rozwlekłe <think> przy narzędziach/JSON, aby zaoszczędzić tokeny i czas GPU
        body.setdefault("chat_template_kwargs", {"enable_thinking": False})
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{VLLM_PORT}/v1/chat/completions",
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=max(10, min(160, int(timeout_s)))) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                return {"ok": True, "status": resp.status, "data": json.loads(raw)}
        except urllib.error.HTTPError as exc:
            err_body = ""
            try:
                err_body = exc.read().decode("utf-8", errors="replace")[:800]
            except Exception:
                err_body = str(exc)
            return {"ok": False, "status": exc.code, "error": err_body or f"HTTP {exc.code}"}
        except Exception as exc:
            return {"ok": False, "status": 502, "error": str(exc)[:500]}


def run_stdio_daemon() -> int:
    """Długowieczna sesja NDJSON (1 kontener GPU, wiele wywołań, natychmiastowe wygaszenie po zakończeniu)."""
    with app.run():
        worker = ForgeBrainWorker()
        sys.stdout.write(json.dumps({"ready": True, "model": MODEL_NAME, "gpu": GPU_SPEC}) + "\n")
        sys.stdout.flush()
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req_obj = json.loads(line)
                if req_obj.get("cmd") == "quit":
                    sys.stdout.write(json.dumps({"ok": True, "bye": True}) + "\n")
                    sys.stdout.flush()
                    break
                res = worker.chat.remote(
                    req_obj.get("payload") or {},
                    int(req_obj.get("timeoutSeconds") or 120),
                )
            except Exception as exc:
                res = {"ok": False, "status": 500, "error": str(exc)[:500]}
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()
    return 0


def main() -> int:
    if "--daemon" in sys.argv:
        return run_stdio_daemon()
    raw = sys.stdin.read().strip()
    if not raw:
        sys.stdout.write(json.dumps({"ok": False, "status": 400, "error": "Puste wejście stdin."}) + "\n")
        return 1
    try:
        req_obj = json.loads(raw)
        with app.run():
            worker = ForgeBrainWorker()
            res = worker.chat.remote(req_obj.get("payload") or {}, int(req_obj.get("timeoutSeconds") or 120))
    except Exception as exc:
        res = {"ok": False, "status": 500, "error": str(exc)[:500]}
    sys.stdout.write(json.dumps(res) + "\n")
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
