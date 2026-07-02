#!/usr/bin/env bash
# KOMPAS verify — jedyne źródło prawdy o postępie runu:
# build + testy e2e + tabela scenariuszy, pełny zrzut do EVIDENCE/.
set -uo pipefail
cd "$(dirname "$0")"
mkdir -p EVIDENCE
TS=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
LOG=EVIDENCE/verify-latest.txt

{
  echo "KOMPAS verify — $TS"
  echo "== git =="
  git rev-parse --short HEAD 2>/dev/null || echo "(brak commita)"
  git status --short -- . 2>/dev/null
  echo
  echo "== build =="
} > "$LOG"

npm run build >> "$LOG" 2>&1
BUILD=$?
echo "build exit: $BUILD" >> "$LOG"

echo >> "$LOG"
echo "== e2e ==" >> "$LOG"
if [ "$BUILD" -eq 0 ]; then
  npx playwright test >> "$LOG" 2>&1
  TEST=$?
else
  echo "(pominięte — build czerwony)" >> "$LOG"
  TEST=1
fi
echo "e2e exit: $TEST" >> "$LOG"

echo >> "$LOG"
echo "== scenariusze (eval.md) ==" >> "$LOG"
if [ -f EVIDENCE/e2e-latest.json ]; then
  node scripts/scenario-table.mjs >> "$LOG" 2>&1 || echo "(tabela niedostępna)" >> "$LOG"
else
  echo "(brak wyników e2e)" >> "$LOG"
fi

cp "$LOG" "EVIDENCE/verify-$TS.txt"
echo
echo "verify: build=$BUILD e2e=$TEST → EVIDENCE/verify-latest.txt (kopia: verify-$TS.txt)"
tail -n 20 "$LOG"
if [ "$BUILD" -ne 0 ] || [ "$TEST" -ne 0 ]; then exit 1; fi
