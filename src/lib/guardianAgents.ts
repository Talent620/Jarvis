// === 🛡 Strażnik JARVISA — system agentowy (Guardian Core + podagenci) ===
// Guardian Core gromadzi stan RAZ (jedno przejście sieciowe), a każdy podagent to CZYSTA funkcja
// nad tym kontekstem — łatwa do testu, bez fikcyjnej autonomii (raportuje tylko to, co aplikacja
// realnie wie i potrafi). Każdy agent zwraca: stan, wynik 0–100, ustalenia i rekomendacje.
import type { Settings } from "../types";
import { store } from "./store";
import { detectOllama } from "./privateMode";
import { detectSd } from "./localImage";
import { PROVIDER_LIST } from "./providers/registry";
import { reliabilityStats, type ReliabilityStats } from "./errorLog";
import { checkForUpdate } from "./updater";
import { googleBackendReady } from "./google";
import { listSpeechVoices, type NativeVoiceInfo } from "./voice";
import { speedSummary, voiceSummary, type GuardianActionKey } from "./guardian";

export type AgentId = "performance" | "voice" | "ai" | "image" | "integration" | "update";
export type AgentState = "ok" | "warn" | "problem" | "off";
export interface AgentFinding { level: "ok" | "warn" | "problem"; text: string }
/** Rekomendacja agenta w formacie premium: Problem → Przyczyna → Wpływ → Naprawa → Przycisk.
 *  `key` → przycisk „jednym kliknięciem"; bez → wskazówka tekstowa. Pola problem/cause/impact
 *  opcjonalne (gdy ustawione, UI pokazuje pełną, czytelną kartę rekomendacji). */
export interface AgentRec {
  label: string;        // tekst przycisku / nazwa naprawy
  why: string;          // sugerowana naprawa (co zrobi)
  key?: GuardianActionKey;
  problem?: string;     // co jest nie tak
  cause?: string;       // dlaczego
  impact?: string;      // jak to wpływa na JARVISA
}
export interface AgentReport {
  id: AgentId;
  name: string;
  icon: string;
  state: AgentState;
  score: number; // 0–100 dla domeny
  summary: string;
  findings: AgentFinding[];
  recs: AgentRec[];
}

/** Kontekst zebrany RAZ przez Guardian Core (sieć + lokalne metryki) — podawany agentom (czystym). */
export interface ScanContext {
  s: Settings;
  ollama: { configured: boolean; ok: boolean; models: string[]; error?: string };
  sd: { configured: boolean; ok: boolean; models: string[]; error?: string };
  reliability: ReliabilityStats;
  update: { current: string; latest: string; newer: boolean; error?: string } | null;
  cloudProviders: string[]; // dostawcy chmurowi z wpisanym kluczem
  voices: NativeVoiceInfo[]; // głosy wykryte w silniku (Voice Guardian)
  voicePinnedExists: boolean; // czy przypięty głos (voiceName) nadal istnieje
  ttsErrors: number; // błędy TTS w bieżącej sesji
  providerErrors: number; // błędy dostawców chmury (limity/klucze) w sesji
}

/** Guardian Core: zbierz pełny stan systemu (jedno przejście). */
export async function gatherContext(opts: { checkUpdate?: boolean } = {}): Promise<ScanContext> {
  const s = store.settings;
  const ollamaConfigured = !!s.ollamaUrl?.trim();
  const sdConfigured = !!s.sdUrl?.trim();

  const [oll, sd, upd, voices] = await Promise.all([
    ollamaConfigured ? detectOllama(s.ollamaUrl).catch(() => ({ ok: false, models: [] as string[], error: "błąd" })) : Promise.resolve({ ok: false, models: [] as string[] }),
    sdConfigured ? detectSd(s.sdUrl).catch(() => ({ ok: false, models: [] as string[], error: "błąd" })) : Promise.resolve({ ok: false, models: [] as string[] }),
    opts.checkUpdate ? checkForUpdate().catch(() => null) : Promise.resolve(null),
    listSpeechVoices().catch(() => [] as NativeVoiceInfo[]),
  ]);

  const cloudProviders = PROVIDER_LIST.filter((p) => p.id !== "ollama" && s.keys[p.id]?.trim()).map((p) => p.id);
  const update = upd && !("error" in upd) ? { current: upd.current, latest: upd.latest, newer: upd.newer } : upd && "error" in upd ? { current: "?", latest: "?", newer: false, error: upd.error } : null;
  const pinned = s.voiceName?.trim();
  const rel = reliabilityStats();
  // Błędy dostawców chmury (proxy „limitów API"): sumuj scope „provider:*" poza lokalnymi.
  const providerErrors = Object.entries(rel.byScope)
    .filter(([k]) => k.startsWith("provider:") && !/ollama|webllm/.test(k))
    .reduce((n, [, v]) => n + v, 0);

  return {
    s,
    ollama: { configured: ollamaConfigured, ok: oll.ok, models: oll.models || [], error: (oll as { error?: string }).error },
    sd: { configured: sdConfigured, ok: sd.ok, models: sd.models || [], error: (sd as { error?: string }).error },
    reliability: rel,
    update,
    cloudProviders,
    voices,
    // „Istnieje", gdy nieprzypięty (brak czego pilnować) lub lista pusta (nie wnioskuj) lub realnie obecny.
    voicePinnedExists: !pinned || !voices.length || voices.some((v) => v.name === pinned),
    ttsErrors: rel.byScope["tts"] || 0,
    providerErrors,
  };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
/** Najgorszy stan z ustaleń wyznacza stan agenta. */
function worst(findings: AgentFinding[], base: AgentState = "ok"): AgentState {
  if (findings.some((f) => f.level === "problem")) return "problem";
  if (findings.some((f) => f.level === "warn")) return "warn";
  return base;
}

// Wykrywacz modelu „rozumującego" (reasoning) wśród modeli Ollamy.
const REASONING = /(qwen3|qwq|deepseek|-r1|reason|think|marco|phi-?4)/i;

// === ⚡ Performance Agent — szybkość, latencja, niezawodność ===
export function performanceAgent(ctx: ScanContext): AgentReport {
  const r = ctx.reliability;
  const findings: AgentFinding[] = [];
  const recs: AgentRec[] = [];
  let score = 100;

  const s = ctx.s;
  const slow = !s.ollamaNoThink || s.localRefine || s.localConsensus;
  findings.push({ level: slow ? "warn" : "ok", text: `Tryb: ${speedSummary(s)}` });
  if (slow) {
    score -= 12;
    recs.push({
      key: "faster", label: "⚡ Przyspiesz odpowiedzi",
      problem: "Odpowiedzi są wolniejsze niż mogłyby być.",
      cause: `Włączone: ${[!s.ollamaNoThink ? "myślenie modelu" : "", s.localRefine ? "samokorekta" : "", s.localConsensus ? "wielokrotne sprawdzanie" : ""].filter(Boolean).join(", ")}.`,
      impact: "Każda odpowiedź trwa dłużej (czasem wielokrotnie).",
      why: "Wyłączę myślenie i dodatkowe tury — odpowiedzi od ręki.",
    });
  }
  // 🧠 Jakość — gdy szybko, ale brak modelu rozumującego do trudnych pytań.
  if (!slow && ctx.ollama.ok && ctx.ollama.models.length && !ctx.ollama.models.some((m) => REASONING.test(m))) {
    recs.push({ label: "🧠 Zwiększ jakość trudnych pytań", why: "Dograj model rozumujący trybem Mądrzej — lepsze odpowiedzi na złożone tematy." });
  }
  // 🔓 Swobodne odpowiedzi — gdy lokalnie i bez trybu nieocenzurowanego.
  if (ctx.ollama.ok && !s.unfilteredLocal) {
    recs.push({ label: "🔓 Bardziej swobodne odpowiedzi", why: "W trybach ręcznych włącz Bez cenzury (model lokalny dolphin-mistral) — bez moralizowania." });
  }
  // 💾 Zasoby — dodatkowe tury lokalne obciążają CPU/GPU.
  if (s.localRefine || s.localConsensus) {
    recs.push({ label: "💾 Zmniejsz zużycie zasobów", why: "Wyłącz samokorektę/wielokrotne sprawdzanie — mniej obciąża komputer." });
  }

  if (typeof r.successRate === "number") {
    const pct = Math.round(r.successRate * 100);
    const lvl: AgentFinding["level"] = r.successRate >= 0.9 ? "ok" : r.successRate >= 0.7 ? "warn" : "problem";
    findings.push({ level: lvl, text: `Skuteczność operacji: ${pct}%` });
    if (r.successRate < 0.9) score -= (1 - r.successRate) * 40;
  }
  if (typeof r.latencyP95 === "number" && r.latencyP95 > 0) {
    const slowNet = r.latencyP95 > 9000;
    findings.push({ level: slowNet ? "warn" : "ok", text: `Czas odpowiedzi: mediana ${Math.round((r.latencyP50 || 0))} ms, p95 ${Math.round(r.latencyP95)} ms` });
    if (slowNet) score -= 10;
  }
  if (r.errors > 0) findings.push({ level: r.errors > 5 ? "warn" : "ok", text: `Błędy w sesji: ${r.errors}` });
  if (findings.length === 1) findings.push({ level: "ok", text: "Brak danych o opóźnieniach — wszystko świeże." });

  return { id: "performance", name: "Wydajność", icon: "⚡", state: worst(findings), score: clamp(score), summary: slow ? "Można przyspieszyć" : "Reaguje od ręki", findings, recs };
}

// === 🎤 Voice Agent — pełny Voice Guardian: aktualny głos, podmiany, jakość, błędy TTS ===
export function voiceAgent(ctx: ScanContext): AgentReport {
  const s = ctx.s;
  const findings: AgentFinding[] = [];
  const recs: AgentRec[] = [];
  let score = 100;
  const pinned = s.voiceName?.trim();
  const premium = !!(s.elevenLabsApiKey && s.elevenLabsVoiceId) || !!(s.fishAudioApiKey && s.fishAudioVoiceId);

  if (!s.speak) {
    findings.push({ level: "warn", text: "Mowa wyłączona — JARVIS nie czyta odpowiedzi." });
    score -= 25;
    recs.push({ key: "fixVoice", label: "🇵🇱 Napraw głos", why: "Włącz mowę i ustaw spójny polski głos." });
    return { id: "voice", name: "Głos", icon: "🎤", state: worst(findings), score: clamp(score), summary: "Mowa wyłączona", findings, recs };
  }

  // Aktualny głos + tryb (systemowy / premium / chmurowy).
  if (s.voicePinned) findings.push({ level: "ok", text: `Tryb: 🚀 stały głos JARVISA (blokada podmian) — ${pinned || "polski systemowy"}.` });
  else findings.push({ level: "ok", text: `Głos: ${voiceSummary(s)}` });

  // Przypięty głos zniknął z silnika (np. po aktualizacji systemu) → zaproponuj zamiennik.
  if (pinned && !ctx.voicePinnedExists) {
    findings.push({ level: "problem", text: `Przypięty głos „${pinned}" zniknął z silnika — trzeba wybrać zamiennik.` });
    score -= 30;
    recs.push({ key: "pinVoice", label: "🚀 Przypnij najlepszy głos", problem: `Wybrany głos „${pinned}" zniknął z silnika mowy.`, cause: "Aktualizacja systemu lub usunięcie pakietu głosowego.", impact: "JARVIS odezwie się innym, przypadkowym głosem.", why: "Wybiorę najlepszy dostępny polski głos i przypnę go na stałe." });
  } else if (pinned) {
    findings.push({ level: "ok", text: `Przypięty głos działa: ${pinned}.` });
  }

  // Głos nie przypięty → może się „zmieniać" (problem z briefu użytkownika).
  if (!pinned && !premium) {
    findings.push({ level: "warn", text: "Głos nie jest przypięty (Auto) — system może go zmieniać (czasem translatorowy)." });
    score -= 12;
    recs.push({ key: "pinVoice", label: "🚀 Używaj głosu JARVISA", why: "Przypnę jeden, najlepszy polski głos na stałe." });
  }

  // Tor głosu: systemowy vs premium vs ryzyko angielskiego akcentu.
  if (premium && !s.voicePinned && s.voiceSystemPl === false) findings.push({ level: "ok", text: "Głos premium (ElevenLabs/Fish) aktywny." });
  if (s.voiceSystemPl === false && !s.voicePinned && !premium && !s.geminiTts) {
    findings.push({ level: "warn", text: "Głosy chmurowe i polski systemowy wyłączone — głos może być angielski." });
    score -= 15;
    recs.push({ key: "fixVoice", label: "🇵🇱 Napraw głos", why: "Przełącz na spójny polski głos systemowy." });
  }

  // Błędy TTS w sesji.
  if (ctx.ttsErrors > 0) {
    findings.push({ level: ctx.ttsErrors > 2 ? "warn" : "ok", text: `Błędy odtwarzania głosu w sesji: ${ctx.ttsErrors}.` });
    if (ctx.ttsErrors > 2) { score -= 8; recs.push({ key: "fixVoice", label: "🇵🇱 Napraw głos", why: "Przełącz na pewny polski głos systemowy." }); }
  }

  // Ile polskich głosów wykryto (świadomość możliwości wyboru).
  const plCount = ctx.voices.filter((v) => /^pl/i.test(v.lang || "")).length;
  if (ctx.voices.length) findings.push({ level: plCount ? "ok" : "warn", text: `Wykryto ${ctx.voices.length} głos(ów), w tym ${plCount} polski(ch).` });

  return { id: "voice", name: "Głos", icon: "🎤", state: worst(findings), score: clamp(score), summary: s.voicePinned ? "Stały głos JARVISA" : pinned ? "Przypięty" : "Mowa aktywna", findings, recs };
}

// === 🧠 AI Agent — modele, dostawcy, routing, reasoning ===
export function aiAgent(ctx: ScanContext): AgentReport {
  const s = ctx.s;
  const findings: AgentFinding[] = [];
  const recs: AgentRec[] = [];
  let score = 100;

  const localOk = ctx.ollama.ok && ctx.ollama.models.length > 0;
  const hasBrain = localOk || ctx.cloudProviders.length > 0 || s.provider === "ollama";

  if (!hasBrain) {
    findings.push({ level: "problem", text: "Żaden mózg nie odpowie — brak modelu lokalnego i kluczy chmurowych." });
    score -= 60;
    recs.push({
      key: "fixAll", label: "🩹 Napraw wszystko",
      problem: "JARVIS nie ma czym odpowiadać.",
      cause: "Brak skonfigurowanego klucza API i niedostępna Ollama.",
      impact: "Czat i polecenia w ogóle nie zadziałają.",
      why: "Wykryję lokalne serwery i wybiorę działający mózg; jeśli się nie da — poprowadzę po konfiguracji klucza.",
    });
  }
  if (ctx.cloudProviders.length) findings.push({ level: "ok", text: `Chmura: ${ctx.cloudProviders.length} dostawc(ów) z kluczem (${ctx.cloudProviders.join(", ")}).` });
  else findings.push({ level: "warn", text: "Brak kluczy chmurowych — pełna sprawność wymaga Ollamy albo klucza API." });

  if (ctx.ollama.configured) {
    if (!ctx.ollama.ok) { findings.push({ level: "warn", text: `Ollama nieosiągalna${ctx.ollama.error ? ` (${ctx.ollama.error})` : ""}.` }); score -= 14; recs.push({ key: "connectServers", label: "🔗 Połącz serwery", problem: "Lokalny serwer Ollama nie odpowiada.", cause: ctx.ollama.error || "Serwer wyłączony lub zmienił adres.", impact: "Brak prywatnego AI offline — JARVIS musi polegać na chmurze.", why: "Poszukam Ollamy na typowych adresach i podłączę ją." }); }
    else if (!ctx.ollama.models.length) { findings.push({ level: "warn", text: "Ollama działa, ale nie ma żadnego modelu." }); score -= 12; recs.push({ key: "smarter", label: "🧠 Mądrzej (pobierz modele)", problem: "Ollama działa, ale nie ma żadnego modelu.", cause: "Nie pobrano jeszcze żadnego modelu do serwera.", impact: "Lokalny mózg nie odpowie, mimo że serwer działa.", why: "Pobiorę komplet modeli (w tym rozumujący)." }); }
    else {
      findings.push({ level: "ok", text: `Ollama: ${ctx.ollama.models.length} model(i) — ${ctx.ollama.models.slice(0, 3).join(", ")}${ctx.ollama.models.length > 3 ? "…" : ""}.` });
      if (!ctx.ollama.models.some((m) => REASONING.test(m))) {
        findings.push({ level: "warn", text: "Brak modelu rozumującego (reasoning) — złożone pytania będą słabsze." });
        score -= 8;
        recs.push({ key: "smarter", label: "🧠 Mądrzej (pobierz reasoning)", why: "Dograj model rozumujący do trudnych pytań." });
      }
    }
  } else {
    findings.push({ level: "warn", text: "Lokalny serwer (Ollama) nieskonfigurowany — brak prywatnego AI offline." });
    recs.push({ key: "connectServers", label: "🔗 Połącz serwery", why: "Znajdę lokalną Ollamę, jeśli działa." });
  }

  // Limity API: chmura sypie błędami (429/limit/klucz). Jeśli jest lokalny model — przełącz na niego.
  if (ctx.providerErrors >= 3) {
    findings.push({ level: "warn", text: `Dostawcy chmury zgłosili ${ctx.providerErrors} błędów (możliwe limity/klucze).` });
    score -= 10;
    if (localOk) {
      recs.push({
        key: "goLocal", label: "🏠 Przełącz na lokalny model",
        problem: "Chmura odrzuca zapytania (limity/klucze API).",
        cause: "Wyczerpany limit, brak środków lub niewłaściwy klucz u dostawcy.",
        impact: "Odpowiedzi z chmury bywają wolne lub zawodzą.",
        why: "Ustawię tryb lokalny (Ollama) — bez limitów i kosztów; chmura zostanie awaryjnie.",
      });
    } else {
      recs.push({ label: "🔑 Sprawdź klucze / limity", why: "Dodaj drugi klucz API albo uruchom lokalną Ollamę, by ominąć limity chmury." });
    }
  }

  return { id: "ai", name: "Inteligencja (AI)", icon: "🧠", state: worst(findings), score: clamp(score), summary: hasBrain ? (localOk ? "Lokalny + chmura" : "Gotowy") : "Brak mózgu!", findings, recs };
}

// === 🖼 Image Agent — Forge/A1111/SD, checkpointy ===
export function imageAgent(ctx: ScanContext): AgentReport {
  const findings: AgentFinding[] = [];
  const recs: AgentRec[] = [];
  let score = 100;

  if (!ctx.sd.configured) {
    return { id: "image", name: "Obrazy (SD)", icon: "🖼", state: "off", score: 100, summary: "Nieskonfigurowane (opcjonalne)", findings: [{ level: "ok", text: "Serwer obrazów nie jest ustawiony — generowanie lokalne wyłączone (opcjonalne)." }], recs: [{ key: "connectServers", label: "🔗 Połącz serwery", why: "Jeśli masz Forge/A1111 z --api, podłączę go." }] };
  }
  if (!ctx.sd.ok) { findings.push({ level: "warn", text: `Serwer obrazów nieosiągalny — uruchom Forge/A1111 z flagą --api.` }); score -= 30; recs.push({ key: "connectServers", label: "🔗 Połącz serwery", problem: "Serwer obrazów (SD) nie odpowiada.", cause: "Forge/A1111 nie jest uruchomiony albo brak flagi --api.", impact: "Generowanie i edycja obrazów nie zadziała.", why: "Poszukam serwera obrazów na localhost i podłączę go." }); }
  else if (!ctx.sd.models.length) { findings.push({ level: "warn", text: "SD działa, ale brak checkpointu — dodaj plik do models/Stable-diffusion." }); score -= 18; recs.push({ label: "🖼 Dodaj checkpoint", problem: "SD działa, ale nie ma żadnego modelu (checkpointu).", cause: "Folder models/Stable-diffusion jest pusty.", impact: "Nie da się wygenerować obrazu.", why: "Dodaj plik modelu do models/Stable-diffusion i odśwież listę w ⚙ → Obrazy." }); }
  else findings.push({ level: "ok", text: `SD: ${ctx.sd.models.length} checkpoint(ów) — ${ctx.sd.models.slice(0, 2).join(", ")}${ctx.sd.models.length > 2 ? "…" : ""}.` });

  return { id: "image", name: "Obrazy (SD)", icon: "🖼", state: worst(findings), score: clamp(score), summary: ctx.sd.ok && ctx.sd.models.length ? "Gotowe" : "Wymaga uwagi", findings, recs };
}

// === 🔗 Integration Agent — API, Google, MCP, n8n, Home Assistant ===
export function integrationAgent(ctx: ScanContext): AgentReport {
  const s = ctx.s;
  const findings: AgentFinding[] = [];
  const items: { label: string; on: boolean }[] = [
    { label: "Google (poczta/kalendarz)", on: googleBackendReady() },
    { label: "Proxy (BFF)", on: !!s.proxyUrl?.trim() },
    { label: "n8n (automatyzacje)", on: !!s.n8nUrl?.trim() },
    { label: "Home Assistant (smart home)", on: !!(s.homeAssistantUrl?.trim() && s.homeAssistantToken?.trim()) },
    { label: "MCP (narzędzia zewnętrzne)", on: !!s.mcpServers?.trim() },
  ];
  for (const it of items) findings.push({ level: "ok", text: `${it.on ? "✓ połączone" : "○ nieskonfigurowane"}: ${it.label}` });
  const onCount = items.filter((i) => i.on).length;
  // Integracje są opcjonalne — brak nie obniża zdrowia drastycznie; to informacja.
  return { id: "integration", name: "Integracje", icon: "🔗", state: "ok", score: clamp(60 + onCount * 8), summary: `${onCount}/${items.length} aktywnych`, findings, recs: [] };
}

// === ⬆ Update Agent — wydania, kompatybilność ===
export function updateAgent(ctx: ScanContext): AgentReport {
  const findings: AgentFinding[] = [];
  const recs: AgentRec[] = [];
  if (!ctx.update) {
    findings.push({ level: "ok", text: "Nie sprawdzono aktualizacji — użyj przycisku sprawdzania, by zweryfikować." });
    return { id: "update", name: "Aktualizacje", icon: "⬆", state: "ok", score: 100, summary: "Nie sprawdzono", findings, recs };
  }
  if (ctx.update.error) {
    findings.push({ level: "warn", text: `Nie udało się sprawdzić: ${ctx.update.error}` });
    return { id: "update", name: "Aktualizacje", icon: "⬆", state: "warn", score: 90, summary: "Błąd sprawdzania", findings, recs };
  }
  if (ctx.update.newer) {
    findings.push({ level: "warn", text: `Dostępna nowsza wersja: ${ctx.update.latest} (masz ${ctx.update.current}).` });
    recs.push({ key: "update", label: "⬆ Aktualizuj", problem: `Jest nowsza wersja JARVISA (${ctx.update.latest}).`, cause: `Zainstalowana wersja: ${ctx.update.current}.`, impact: "Pomijasz najnowsze funkcje i poprawki.", why: "Pobiorę aktualizację (w przeglądarce odświeżę, na telefonie/PC pobiorę plik instalatora)." });
    return { id: "update", name: "Aktualizacje", icon: "⬆", state: "warn", score: 80, summary: "Jest aktualizacja", findings, recs };
  }
  findings.push({ level: "ok", text: `Masz najnowszą wersję (${ctx.update.current}).` });
  return { id: "update", name: "Aktualizacje", icon: "⬆", state: "ok", score: 100, summary: "Aktualne", findings, recs };
}

// Waga domen w ocenie zdrowia (AI najważniejsze; integracje/aktualizacje opcjonalne).
const WEIGHTS: Record<AgentId, number> = { ai: 0.34, performance: 0.2, voice: 0.14, image: 0.1, integration: 0.07, update: 0.15 };

export interface SystemHealth { score: number; grade: "A" | "B" | "C" | "D"; label: string }
/** 📊 Health Agent: złóż wynik 0–100 z ważonych ocen agentów. Pure. */
export function aggregateHealth(reports: AgentReport[]): SystemHealth {
  let sum = 0, wsum = 0;
  for (const r of reports) { const w = WEIGHTS[r.id] ?? 0.1; sum += r.score * w; wsum += w; }
  const score = wsum ? clamp(sum / wsum) : 100;
  const grade: SystemHealth["grade"] = score >= 85 ? "A" : score >= 65 ? "B" : score >= 40 ? "C" : "D";
  const label = score >= 85 ? "świetnie" : score >= 65 ? "dobrze" : score >= 40 ? "wymaga uwagi" : "krytycznie";
  return { score, grade, label };
}

export interface GuardianScan {
  reports: AgentReport[];
  health: SystemHealth;
  recs: AgentRec[]; // zdeduplikowane, najważniejsze najpierw
}

/** Uruchom wszystkich agentów nad kontekstem (pure). */
export function runAgents(ctx: ScanContext): AgentReport[] {
  return [aiAgent(ctx), performanceAgent(ctx), voiceAgent(ctx), imageAgent(ctx), integrationAgent(ctx), updateAgent(ctx)];
}

/** Priorytet stanu agenta dla kolejności rekomendacji. */
const STATE_RANK: Record<AgentState, number> = { problem: 3, warn: 2, ok: 1, off: 0 };

/** Zbierz i zdeduplikuj rekomendacje (po `key`/label), porządkując wg powagi domeny. */
export function collectRecs(reports: AgentReport[]): AgentRec[] {
  const ordered = [...reports].sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state]);
  const seen = new Set<string>();
  const out: AgentRec[] = [];
  for (const r of ordered) {
    for (const rec of r.recs) {
      const id = rec.key || rec.label;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(rec);
    }
  }
  return out;
}

/** 🛡 Guardian Core: pełny skan systemu (kontekst + agenci + zdrowie + rekomendacje). */
export async function guardianScan(opts: { checkUpdate?: boolean } = {}): Promise<GuardianScan> {
  const ctx = await gatherContext(opts);
  const reports = runAgents(ctx);
  return { reports, health: aggregateHealth(reports), recs: collectRecs(reports) };
}
