#!/usr/bin/env bash
# JARVIS — LoRA „Twój głos" — STUB komendy treningowej (SERVER-ONLY).
# To SZKIELET: nie uruchamia się automatycznie, nie jest zależnością klienta ani CI.
# Uzupełnij po stronie serwera z GPU (Linux + CUDA). Wymaga: python + peft/unsloth + transformers.
set -euo pipefail

BASE_MODEL="${BASE_MODEL:-unsloth/Qwen2.5-7B-Instruct}"   # baza pod adapter
DATA="${DATA:-server/lora/data/example.jsonl}"            # ZANONIMIZOWANY korpus instruction->output
OUT="${OUT:-server/lora/out/jarvis-glos}"                 # katalog adaptera LoRA
RANK="${RANK:-16}"; EPOCHS="${EPOCHS:-3}"

echo "[STUB] Tu trafi realny trening LoRA. Przykładowo (do uzupełnienia):"
cat <<'PY'
# python -m server.lora.train \
#   --base "$BASE_MODEL" --data "$DATA" --out "$OUT" \
#   --lora-rank "$RANK" --epochs "$EPOCHS" --max-seq 2048
#
# Po treningu — eksport do Ollamy:
#   1) scal/skonwertuj adapter do GGUF,
#   2) Modelfile:  FROM qwen2.5:7b
#                  ADAPTER ./jarvis-glos.gguf
#   3) ollama create jarvis-glos -f Modelfile
#   4) w aplikacji wybierz model "jarvis-glos" (Odśwież modele z Ollamy).
PY
echo "[STUB] Pamiętaj o anonimizacji PII przed treningiem (patrz README)."
