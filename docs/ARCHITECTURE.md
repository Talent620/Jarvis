# JARVIS — Architektura (mapa dla utrzymania)

Cel: żeby nowa osoba (lub Ty za pół roku) ogarnęła system w 15 minut. Local-first,
multi-platforma z jednego kodu, multi-provider AI.

## Platformy (jeden kod → 4 cele)
- **Web/PWA** — Vite + React + TS.
- **Android / iOS** — Capacitor (natywne wtyczki: TTS, mowa, kamera, schowek).
- **Windows** — Electron (`jarvisDesktop` bridge: SMTP, sterowanie PC, OAuth Google).
- **BFF** — Cloudflare Worker (`proxy/worker.js`): omija CORS, trzyma sekrety, relay do
  dostawców, Tavily/embeddings/sync, anty-SSRF.

## Przepływ jednej tury rozmowy (ścieżka krytyczna)
```
Composer.onSend → App.handleSend → brain.askJarvis(history)
  ├─ resolveProvider()           // który dostawca/model (ustawienia/auto/tryb)
  ├─ RÓWNOLEGLE (płynność):      // brain.ts ~520
  │    prepareMemoryContext · memoryContextBlock(Mem0) · rankJournal · deepThink(opt)
  ├─ systemPrompt({...})         // pamięć + profil + Szósty Zmysł + World Model + grounding
  ├─ pętla dostawców (fallback)  // shouldFallback / circuit-breaker (resilience.ts)
  │    └─ PROVIDERS[id].impl(ctx)        // adapter dostawcy
  │         ├─ streaming SSE (onToken) → UI rośnie deltami (stream.ts akumulatory)
  │         └─ pętla narzędzi: tool_use → runTool() → wynik → model (guard < 8)
  ├─ verify (opt) · localRefine/consensus (opt) · council (opt)
  └─ zwrot {text, tools, usage, citations}
```

## Warstwy / gdzie czego szukać (`src/lib/`, 137 modułów)
- **Rdzeń AI:** `brain.ts` (orkiestracja tury, routing, TASK_MODELS), `providers/`
  (`registry.ts` katalog+rank, `openai.ts` wspólny adapter OpenAI-compat, `anthropic.ts`,
  `gemini.ts`, `webllm.ts`, `types.ts`), `stream.ts` (akumulatory SSE), `tools.ts`
  (definicje + dispatch narzędzi), `verify.ts`, `council.ts`, `modelRouter.ts`.
- **Pamięć (7 warstw):** `memory.ts`+`memoryScore.ts` (fakty: decay/reinforcement),
  `episodicMemory.ts`, `journal`, `worldModel.ts` (graf encji), `reflection.ts`,
  Mem0 przez BFF. Wektory: `localEmbed.ts` / `/v1/embed`.
- **OMEGA (silniki, czyste/testowalne):** `predict.ts`, `chiefOfStaff.ts`, `orchestrator.ts`
  (graf zadań), `goalPlanner.ts`, `selfImprove.ts`.
- **Głos:** `voice.ts` (silnik+`resolveVoiceMode`+`speak`), `liveVoice.ts`, `smartConversation.ts`,
  `endpoint.ts`, `voiceprint.ts`. Wybór silnika = JEDNO źródło: `voiceMode`.
- **Sprzedaż/leady:** `leads.ts`, `leadIntel.ts`, `prospect.ts`, `offer.ts`, `mailer.ts`,
  `salesEngine.ts`, `webgen.ts` (kreator stron + wycena).
- **Obrazy:** `images.ts` (Gemini/Pollinations/fal/local), `localImage.ts` (SD img2img).
- **Research:** `research.ts` (Tavily; przez BFF gdy proxy — CORS-safe, inaczej bezpośrednio).
- **Strażnik:** `guardian.ts` + `guardianAgents.ts` + `guardianHistory.ts` (samonaprawa, czat).
- **Dane:** `store.ts` (reaktywny store + IndexedDB hydration + localStorage), `sync.ts`
  (`mergeById` po updatedAt), `backup.ts`, `keys.ts` (rotacja kluczy + BYOK).
- **Bezpieczeństwo:** `license.ts`, `secretsVault`, zgody/`requireConsentAlways`, BFF guards.
- **UX czatu (czyste):** `chatUx.ts` (`isNearBottom`, `starterSuggestions`).

## UI (`src/components/`, 53)
- Zawsze montowane: `Orb`, `Conversation` (bąbelki + smart-scroll), `Composer`.
- Panele modalne **leniwe** (`React.lazy` + `ScreenBoundary` = Suspense+ErrorBoundary):
  `Settings` (~2600 linii, lazy), `SalesDashboard`, `Studio`, `Guardian`, `Mind`, `Journal`…
- Wzorzec modala: `<div className="sheet" onClick={onClose}><div className="panel">…</div></div>`.

## BFF — trasy (`proxy/worker.js`)
`/anthropic` · `/gemini` · `/openai?u=<biała lista hostów>` · `/passthrough` ·
`/v1/search` (Tavily) · `/v1/embed` · `/v1/sync` (Bearer) · `/v1/smtp/*` · `/v1/gmail/*`.
Strażnicy: token aplikacji (opt-in fail-closed), anty-SSRF (allowlista + metadane chmury),
`noCRLF` (anty-injection), klucze z env (fallback na Bearer klienta = BYOK).

## Ekonomia / model
**Local-first + BYOK + free-tier.** Koszt działania ≈ 0 dla użytkownika. 9 dostawców
(8 darmowych + Anthropic) + lokalny Ollama/WebLLM. Tryb **Auto** wybiera wg `rank`.

## Jakość / bramka (każdy commit)
`npx tsc -b` · `npm run lint` · `npx vitest run` (1292 testy) · `npm run build` ·
`node --check proxy/worker.js` — wszystko zielone, bez maskowania.
**Pułapka:** polski prosty cudzysłów `"` wewnątrz stringów łamie esbuild.

## Mapa „chcę zmienić X → dotknij…"
- Nowy dostawca AI → `providers/types.ts` (ProviderId) + `registry.ts` (PROVIDERS/emptyKeys) +
  `brain.ts` (TASK_MODELS) + `worker.js` (allowlista, jeśli needsProxy) + test.
- Nowe narzędzie modelu → `tools.ts` (def + executor).
- Nowy panel → komponent + `React.lazy` w `App.tsx` + render w `ScreenBoundary`.
- Nowe ustawienie → `types.ts` (Settings) + `store.ts` (default) + UI w `Settings.tsx`.
