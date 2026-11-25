#!/usr/bin/env python3
"""
JARVIS FORGE — Zero-Secret-Leak Modal Brain Bridge (Category C: Promotional Credits).

Wywołuje istniejący, wdrożony endpoint `jarvis-brain` (vLLM Qwen3-32B-AWQ na 1x L4)
przez lekki, efemeryczny przekaźnik Modal CPU (`cpu=0.125`, koszt ~$0.000002/wywołanie),
który odczytuje `VLLM_API_KEY` WYŁĄCZNIE po stronie serwera Modal z sekretu `jarvis-vllm`.

Gwarancje bezpieczeństwa:
- `VLLM_API_KEY` NIGDY nie opuszcza środowiska Modal, nie trafia na lokalny dysk,
  do zmiennych środowiskowych VM, stdout ani logów Forge.
- Twardy timeout po stronie klienta i serwera Modal — brak wiszących kontenerów GPU.
- Wywoływany WYŁĄCZNIE pod kontrolą `PromoBudgetGovernor` z `forge/budget.mjs`.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

import modal

BRAIN_APP_NAME = os.environ.get("FORGE_MODAL_BRAIN_APP", "jarvis-brain")
BRAIN_FN_NAME = os.environ.get("FORGE_MODAL_BRAIN_FN", "serve")
RELAY_APP_NAME = "jarvis-forge-relay"

relay_app = modal.App(RELAY_APP_NAME)
relay_image = modal.Image.debian_slim(python_version="3.12")


@relay_app.function(
    image=relay_image,
    cpu=0.25,
    memory=256,
    timeout=180,
    secrets=[modal.Secret.from_name("jarvis-vllm")],
)
def forward_chat_completion(web_url: str, payload: dict[str, Any], timeout_s: int = 150) -> dict[str, Any]:
    api_key = (os.environ.get("VLLM_API_KEY") or "").strip()
    if not api_key:
        return {"ok": False, "status": 500, "error": "Brak VLLM_API_KEY w sekrecie Modal 'jarvis-vllm'."}

    url = web_url.rstrip("/") + "/v1/chat/completions"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=max(10, min(170, int(timeout_s)))) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return {"ok": True, "status": resp.status, "data": json.loads(raw)}
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")[:800]
        except Exception:
            body = str(exc)
        return {"ok": False, "status": exc.code, "error": body or f"HTTP {exc.code}"}
    except Exception as exc:
        return {"ok": False, "status": 502, "error": str(exc)[:500]}


def run_single_request(req_obj: dict[str, Any]) -> dict[str, Any]:
    fn = modal.Function.from_name(BRAIN_APP_NAME, BRAIN_FN_NAME)
    web_url = fn.get_web_url()
    if not web_url:
        return {"ok": False, "status": 503, "error": f"Brak adresu web_url dla {BRAIN_APP_NAME}.{BRAIN_FN_NAME}."}

    payload = req_obj.get("payload")
    if not isinstance(payload, dict):
        return {"ok": False, "status": 400, "error": "Brak obiektu 'payload'."}
    timeout_s = int(req_obj.get("timeoutSeconds") or 150)

    with modal.enable_output():
        pass
    with relay_app.run(show_progress=False):
        return forward_chat_completion.remote(web_url, payload, timeout_s)


def run_stdio_daemon() -> int:
    """Tryb długowiecznej sesji (1 uruchomienie `relay_app.run`, wiele zapytań NDJSON — brak narzutu startu!)."""
    fn = modal.Function.from_name(BRAIN_APP_NAME, BRAIN_FN_NAME)
    web_url = fn.get_web_url()
    if not web_url:
        sys.stdout.write(json.dumps({"ok": False, "status": 503, "error": "Brak web_url dla jarvis-brain."}) + "\n")
        sys.stdout.flush()
        return 1

    with relay_app.run(show_progress=False):
        sys.stdout.write(json.dumps({"ready": True, "brainApp": BRAIN_APP_NAME, "webUrl": web_url}) + "\n")
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
                res = forward_chat_completion.remote(
                    web_url,
                    req_obj.get("payload") or {},
                    int(req_obj.get("timeoutSeconds") or 150),
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
        res = run_single_request(req_obj)
    except Exception as exc:
        res = {"ok": False, "status": 500, "error": str(exc)[:500]}
    sys.stdout.write(json.dumps(res) + "\n")
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
