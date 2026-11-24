"""JARVIS Modal Brain — serverless vLLM OpenAI-compatible server on A100-80GB.

Deploy:
    modal secret create jarvis-vllm VLLM_API_KEY="jvllm_$(openssl rand -hex 24)"
    modal deploy deploy/modal_brain.py

Endpoint (OpenAI-compatible):
    https://<workspace>--jarvis-brain-serve.modal.run/v1
Model:
    Qwen/Qwen2.5-72B-Instruct-AWQ
"""

import os
import subprocess

import modal

APP_NAME = "jarvis-brain"
MODEL_NAME = "Qwen/Qwen2.5-72B-Instruct-AWQ"
VLLM_PORT = 8000
MAX_MODEL_LEN = 16384
GPU_MEMORY_UTILIZATION = 0.92
SCALEDOWN_WINDOW_SECONDS = 60

vllm_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "vllm>=0.6.6",
        "huggingface_hub[hf_transfer]>=0.26.0",
    )
    .env(
        {
            "HF_HUB_ENABLE_HF_TRANSFER": "1",
            "VLLM_USAGE_SOURCE": "production-docker-image",
        }
    )
)

hf_cache_vol = modal.Volume.from_name("jarvis-hf-cache", create_if_missing=True)
vllm_cache_vol = modal.Volume.from_name("jarvis-vllm-cache", create_if_missing=True)

app = modal.App(APP_NAME)


@app.function(
    image=vllm_image,
    gpu="A100-80GB",
    scaledown_window=SCALEDOWN_WINDOW_SECONDS,
    timeout=10 * 60,
    secrets=[modal.Secret.from_name("jarvis-vllm")],
    volumes={
        "/root/.cache/huggingface": hf_cache_vol,
        "/root/.cache/vllm": vllm_cache_vol,
    },
)
@modal.concurrent(max_inputs=32)
@modal.web_server(port=VLLM_PORT, startup_timeout=10 * 60)
def serve():
    api_key = (os.environ.get("VLLM_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError(
            "Brak zmiennej VLLM_API_KEY w sekrecie Modal 'jarvis-vllm'. "
            "Utwórz go: modal secret create jarvis-vllm VLLM_API_KEY=..."
        )

    cmd = [
        "vllm",
        "serve",
        MODEL_NAME,
        "--host",
        "0.0.0.0",
        "--port",
        str(VLLM_PORT),
        "--served-model-name",
        MODEL_NAME,
        "--dtype",
        "half",
        "--max-model-len",
        str(MAX_MODEL_LEN),
        "--gpu-memory-utilization",
        str(GPU_MEMORY_UTILIZATION),
        "--api-key",
        api_key,
        "--enable-auto-tool-choice",
        "--tool-call-parser",
        "hermes",
        "--uvicorn-log-level",
        "info",
    ]

    print(f"[jarvis-brain] Starting vLLM server for {MODEL_NAME} on port {VLLM_PORT}")
    subprocess.Popen(cmd)
