# JARVIS — DEVLOG

Kontekst między sesjami. Najnowsze na górze. Szczegóły audytu: `AUDIT.md`; plan/postęp: `PROGRESS.md`.

## 2026-06-18 — Pełny przegląd + hardening (sesja staged-review)

**Stan:** wszystko na branchu `claude/functionality-modification-access-z9kod1` → **PR #1 → main** (niescalone). Testy: **683 zielone**. Build web/APK/EXE: zielone w CI.

### Co zrobione (wdrożone, przetestowane)
Audyt całości (6 klastrów, `AUDIT.md`) + 8 partii poprawek + staged-review (etap 4):
- **Bezpieczeństwo:** realny bug Gmaila (`b64` → 500 na PL tematach) ✓; sales-os outreach respektuje zgodę+limit ✓; rate-limit na token (nie XFF) ✓; walidacja importu kopii (anty-eksfiltracja) ✓; CRLF/host-allowlist w BFF ✓; **SSRF blok metadanych chmury w `/passthrough`** ✓; auth `x-app-token` na `/v1/search|embed` (gdy ustawiony) ✓; Electron `will-navigate`+`sandbox`+IPC-gate ✓; cipher wersjonowany KDF (JV2) ✓; PIN PBKDF2 ✓; redakcja audytu ✓; usunięte martwe wstrzykiwanie kluczy w CI ✓; `calculate` bez `Function()` (parser `safeCalc`) ✓.
- **Niezawodność:** **sync merge po `id`** (koniec utraty danych między urządzeniami) ✓; wyciek węzłów audio (premium-TTS) ✓; teardown LiveSession na błędzie ✓; backoff Web Speech ✓; capy/quota w store ✓; limit nagrania Transcribe ✓; debounce słuchawek ✓; batch przypomnień ✓; **timeouty na wszystkich zewnętrznych fetchach BFF + guard KV** ✓.

### Świadomie ODŁOŻONE (wymagają decyzji właściciela — NIE ruszać autonomicznie)
- **BFF fail-closed `APP_TOKEN`** na trasach relay — może zerwać wdrożenie bez `APP_TOKEN`.
- **`admin.ts`** — sekret szyfrowany numerem telefonu (hash w bundlu) → zmiana logowania właściciela + migracja.
- **consent fail-closed** dla outbound — zmienia tryb live (hands-free).
- **`brain.ts` globalny stan modułu** → parametry — poprawne, ale zmienia treść promptu w trybie live.
- **Keystore w repo + rotacja klucza; self-signed EXE** — nieodwracalne wobec Sklepu Play.
- **`release.yml` na push brancha** — ograniczenie do tagów zerwałoby rolling `latest` (z którego pobierasz buildy).
- **Electron/sales-os wildcard CORS** — allowlista zerwałaby user-konfigurowalny BFF/Home Assistant (adresy dynamiczne).

### Proponowane kolejne kierunki rozwoju
1. Decyzja o BFF `APP_TOKEN` (potwierdź, że worker go ma → wdrożę fail-closed bezpiecznie).
2. Przeprojektowanie `admin.ts` (sekret wysokiej entropii, nie numer telefonu).
3. Migracja `sentMail`/`contentPosts`/embeddingów do IndexedDB (zdejmuje presję na localStorage).
4. Scalić PR #1 do `main` (po przeglądzie).
5. `AudioWorklet` zamiast `ScriptProcessorNode` w trybie live (płynność/bateria).

### Jak uruchomić / zweryfikować
- Web dev: `npm run dev` · Build: `npm run build` · Testy: `npm test` (683).
- BFF: `proxy/worker.js` (Cloudflare Worker) — `node --check` lokalnie; brak CI.
- sales-os: własny build+E2E smoke w CI (`Sales OS build`).
- Pobranie buildów: GitHub Release `latest` (APK/EXE) — odświeżany przy pushu na branch.

---

## „Refleks i Kora" — Część I (Fundament) — raport

Dwuprędkościowy mózg: Refleks (lokalny Ollama/WebLLM) jako pełny poziom, Kora (chmura) do rozumowania.
Wszystko **opt-in** — domyślne zachowanie bez zmian.

**Co zrobione (Z1–Z7):** katalog Ollamy pod 4 GB + `TASK_MODELS.ollama`; dynamiczny dropdown modeli z
`/api/tags` (debounce + przycisk); local-first (`localFirstSimple`) + auto-lokalny offline; tuning Ollamy
(`keep_alive`, `num_ctx`, `num_gpu` via `extraBody`); health-check serwera inferencji (`/api/tags`+`/api/ps`);
`server/ollama/` (README+compose+setup.ps1); testy routeOrder. 852 testy, lint/tsc/build zielone.

**Co włączyć w ⚙ → AI (kolejność klikania):**
1. „Lokalny model — adres Ollama" → wklej adres serwera (np. `http://100.x.x.x:11434` przez Tailscale).
2. Dostawca → „Lokalny model (Ollama)" → „🔄 Odśwież modele z Ollamy" → wybierz model.
3. (Opcjonalnie) `localFirstSimple` = on → proste pytania lecą najpierw lokalnie, prywatnie i szybko.
4. Pod 4 GB VRAM: `ollamaNumCtx` zostaw 4096; `ollamaNumGpu` -1 (pełny GPU).
5. Stan systemu pokaże „Serwer inferencji aktywny + model w VRAM".

**Część II (8–14, opt-in) — do decyzji właściciela:** brama pewności, spekulacja Refleks→Kora,
konsylium hybrydowe, RAG do modelu lokalnego, router uczący się, prewarm, szkielet LoRA (server-only).
