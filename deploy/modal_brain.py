"""JARVIS Modal Brain (2026) — serverless vLLM OpenAI-compatible server with Memory Snapshots.

Verified HuggingFace models (Polish + OpenAI tool-calling):
  - Qwen/Qwen3-32B-AWQ                   (default, ~18.5 GB VRAM — runs on 1x L4 / A10G / A100-80GB)
  - Qwen/Qwen3-30B-A3B-Instruct-2507-FP8 (MoE 30B/3.3B active — ultra-fast on L40S / A100-80GB)
  - Qwen/Qwen2.5-72B-Instruct-AWQ        (72B AWQ — runs on A100-80GB)
  - Qwen/Qwen3-14B-AWQ                   (fast Reflex tier — runs on L4 / A10G)

Deploy (no region pinning => avoids 1.5x-1.75x regional surcharge):
    modal secret create jarvis-vllm VLLM_API_KEY="jvllm_$(openssl rand -hex 24)"
    modal deploy deploy/modal_brain.py

Optional overrides at deploy time:
    MODAL_BRAIN_MODEL="Qwen/Qwen2.5-72B-Instruct-AWQ" MODAL_BRAIN_GPU="A100-80GB" modal deploy deploy/modal_brain.py
"""

import os
import subprocess

import modal

APP_NAME = "jarvis-brain"
MODEL_NAME = os.environ.get("MODAL_BRAIN_MODEL", "Qwen/Qwen3-32B-AWQ")
GPU_SPEC = os.environ.get("MODAL_BRAIN_GPU", "L4")
VLLM_PORT = 8000
MAX_MODEL_LEN = int(os.environ.get("MODAL_BRAIN_MAX_LEN", "16384"))
GPU_MEMORY_UTILIZATION = float(os.environ.get("MODAL_BRAIN_GPU_MEM", "0.92"))
SCALEDOWN_WINDOW_SECONDS = 60
TIMEOUT_SECONDS = 600

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

app = modal.App(APP_NAME)


@app.function(
    image=vllm_image,
    gpu=GPU_SPEC,
    scaledown_window=SCALEDOWN_WINDOW_SECONDS,
    timeout=TIMEOUT_SECONDS,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
    secrets=[modal.Secret.from_name("jarvis-vllm")],
    volumes={
        "/root/.cache/huggingface": hf_cache_vol,
        "/root/.cache/vllm": vllm_cache_vol,
    },
)
@modal.concurrent(max_inputs=32)
@modal.web_server(port=VLLM_PORT, startup_timeout=TIMEOUT_SECONDS)
def serve():
    api_key = (os.environ.get("VLLM_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError(
            "Brak zmiennej VLLM_API_KEY w sekrecie Modal 'jarvis-vllm'. "
            "Utwórz go: modal secret create jarvis-vllm VLLM_API_KEY=..."
        )

    model = os.environ.get("MODAL_BRAIN_MODEL", MODEL_NAME)
    tool_parser = "hermes"

    cmd = [
        "vllm",
        "serve",
        model,
        "--host",
        "0.0.0.0",
        "--port",
        str(VLLM_PORT),
        "--served-model-name",
        model,
        "--max-model-len",
        str(MAX_MODEL_LEN),
        "--gpu-memory-utilization",
        str(GPU_MEMORY_UTILIZATION),
        "--api-key",
        api_key,
        "--enable-auto-tool-choice",
        "--tool-call-parser",
        tool_parser,
        "--uvicorn-log-level",
        "info",
    ]
    if "awq" in model.lower():
        cmd.extend(["--dtype", "half"])

    print(f"[jarvis-brain] Starting vLLM ({model}) on {GPU_SPEC}, port {VLLM_PORT}")
    subprocess.Popen(cmd)
