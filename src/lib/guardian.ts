// === 🛡 Strażnik Płynności i Działania JARVISA ===
// Autonomiczny pomocnik „od wszystkiego": diagnozuje stan (mózg, serwery, głos, szybkość),
// jednym ruchem naprawia/przyspiesza/ulepsza/odcenzurowuje, łączy serwery i doradza po polsku.
// Wszystko opt-in (uruchamiane przyciskiem). Reużywa istniejących, przetestowanych mechanizmów.
import { store } from "./store";
import { detectOllama, findOllamaServer } from "./privateMode";
import { detectSd, findSdServer } from "./localImage";
import { runAndFix } from "./selfHeal";
import { applyFastSetup, applyPremiumSetup, ensurePremiumModels } from "./ollamaMaestro";
import { warmNow } from "./prewarm";
import { PROVIDER_LIST } from "./providers/registry";
import { askJarvis } from "./brain";

export interface GuardianStatus {
  brain: string; // czym JARVIS odpowie
  ollama: "ok" | "off" | "empty"; // serwer ok / nieosiągalny / bez modeli
  ollamaModels: number;
  sd: "ok" | "off" | "empty"; // serwer obrazów
  voiceLabel: string;
  speedLabel: string;
  issues: string[]; // wykryte problemy (czytelne)
}

/** Pure: opis trybu szybkości z ustawień. */
export function speedSummary(s = store.settings): string {
  const slow = !s.ollamaNoThink || s.localRefine || s.localConsensus;
  return slow ? "🧠 mądry (myślenie/dodatkowe tury — wolniej)" : "⚡ szybki (od ręki)";
}

/** Pure: opis głosu z ustawień. */
export function voiceSummary(s = store.settings): string {
  if (!s.speak) return "🔇 wyłączony";
  if (s.voiceSystemPl !== false) return "🇵🇱 polski systemowy";
  if (s.elevenLabsApiKey && s.elevenLabsVoiceId) return "ElevenLabs (premium)";
  if (s.geminiTts) return "Gemini TTS";
  return "systemowy";
}

/** Pełna diagnoza (sieć): mózg, serwery, głos, szybkość + lista problemów. */
export async function guardianDiagnose(): Promise<GuardianStatus> {
  const s = store.settings;
  const issues: string[] = [];

  // Ollama
  let ollama: GuardianStatus["ollama"] = "off";
  let ollamaModels = 0;
  if (s.ollamaUrl?.trim()) {
    const d = await detectOllama(s.ollamaUrl);
    if (d.ok) { ollama = d.models.length ? "ok" : "empty"; ollamaModels = d.models.length; }
    else issues.push(`Serwer Ollama nieosiągalny: ${d.error || "brak połączenia"}.`);
  }
  if (ollama === "empty") issues.push("Ollama działa, ale nie ma żadnego modelu — pobierz model w sekcji Refleks i Kora.");

  // Mózg: kto odpowie?
  const cloudKeys = PROVIDER_LIST.filter((p) => p.id !== "ollama" && s.keys[p.id]?.trim());
  let brain = "—";
  if (s.provider === "ollama" || ollama === "ok") brain = "lokalny (Ollama)";
  else if (cloudKeys.length) brain = "chmura (auto)";
  else { brain = "BRAK"; issues.push("Żaden mózg nie odpowie: uruchom Ollamę albo wpisz klucz API."); }

  // Serwer obrazów
  let sd: GuardianStatus["sd"] = "off";
  if (s.sdUrl?.trim()) {
    const d = await detectSd(s.sdUrl);
    sd = d.ok ? (d.models.length ? "ok" : "empty") : "off";
    if (!d.ok) issues.push("Serwer obrazów (SD) nieosiągalny — uruchom Forge/A1111 z --api.");
    else if (!d.models.length) issues.push("SD działa, ale brak modelu (checkpointu) — dodaj plik do models/Stable-diffusion.");
  }

  return {
    brain,
    ollama,
    ollamaModels,
    sd,
    voiceLabel: voiceSummary(s),
    speedLabel: speedSummary(s),
    issues,
  };
}

export interface GuardianActionResult { ok: boolean; message: string }

/** Akcje Strażnika „jednym ruchem". Każda reużywa sprawdzonych funkcji. */
export const guardian = {
  /** Napraw wszystko: wykryj serwery, wybierz działający mózg, popraw ustawienia. */
  async fixAll(onStep?: (m: string) => void): Promise<GuardianActionResult> {
    const r = await runAndFix(onStep);
    return { ok: r.ok, message: r.summary };
  },
  /** Szybciej: tryb szybki (bez myślenia i dodatkowych tur). */
  faster(): GuardianActionResult {
    const r = applyFastSetup();
    void warmNow();
    return { ok: true, message: `⚡ Tryb szybki: ${r.model} (${r.enabled.join(", ")}). Odpowiada od ręki.` };
  },
  /** Mądrzej: tryb premium (lepsze modele + inteligentny routing). */
  async smarter(onStep?: (m: string) => void): Promise<GuardianActionResult> {
    const sum = applyPremiumSetup();
    onStep?.("Sprawdzam i pobieram modele…");
    const r = await ensurePremiumModels({ onProgress: (m) => onStep?.(m) });
    void warmNow();
    return { ok: r.ok, message: r.ok ? `🧠 Tryb mądry: ${sum.overrides.complex}. ${r.pulled.length ? `Pobrano: ${r.pulled.join(", ")}.` : "Modele gotowe."}` : `❌ ${r.error}` };
  },
  /** Bez cenzury: premium + model nieocenzurowany. */
  async uncensored(onStep?: (m: string) => void): Promise<GuardianActionResult> {
    applyPremiumSetup({ uncensored: true });
    onStep?.("Pobieram model bez cenzury (dolphin-mistral)…");
    const r = await ensurePremiumModels({ uncensored: true, onProgress: (m) => onStep?.(m) });
    void warmNow();
    return { ok: r.ok, message: r.ok ? "🔓 Tryb bez cenzury gotowy (dolphin-mistral)." : `❌ ${r.error}` };
  },
  /** Napraw głos: prosty polski głos systemowy, mowa włączona. */
  fixVoice(): GuardianActionResult {
    store.setSettings({ voiceSystemPl: true, speak: true });
    return { ok: true, message: "🇵🇱 Głos ustawiony na prosty polski systemowy (spójny, po polsku)." };
  },
  /** Połącz serwery: znajdź Ollamę i serwer obrazów (localhost), ustaw adresy. */
  async connectServers(onStep?: (m: string) => void): Promise<GuardianActionResult> {
    const parts: string[] = [];
    onStep?.("Szukam serwera Ollama…");
    const o = await findOllamaServer();
    if (o.ok) { store.setSettings({ ollamaUrl: o.url, provider: "ollama" }); void warmNow(); parts.push(`Ollama: ${o.url}`); }
    onStep?.("Szukam serwera obrazów (SD)…");
    const sd = await findSdServer();
    if (sd.ok) { store.setSettings({ sdUrl: sd.url }); parts.push(`Obrazy: ${sd.url}`); }
    return { ok: parts.length > 0, message: parts.length ? `🔗 Połączono — ${parts.join(" · ")}.` : "Nie znalazłem serwerów lokalnych (uruchom JARVIS-Ollama-Server.exe / Forge)." };
  },
};

/** Zbuduj prompt doradczy dla Strażnika (po polsku, konkretnie). Czysta. */
export function guardianAdvicePrompt(status: GuardianStatus, question: string): string {
  return [
    "Jesteś Strażnikiem JARVISA — doradzasz, jak ustawić tego asystenta AI, by działał lepiej.",
    "Odpowiadaj po polsku, krótko i konkretnie (kroki). Masz aktualny stan:",
    `- Mózg: ${status.brain}`,
    `- Ollama: ${status.ollama} (${status.ollamaModels} model(i))`,
    `- Serwer obrazów: ${status.sd}`,
    `- Głos: ${status.voiceLabel}`,
    `- Szybkość: ${status.speedLabel}`,
    status.issues.length ? `- Problemy: ${status.issues.join("; ")}` : "- Brak wykrytych problemów.",
    "",
    `Pytanie użytkownika: ${question}`,
    "Podaj 2–4 konkretne kroki (i które przyciski Strażnika kliknąć: Napraw / Szybciej / Mądrzej / Bez cenzury / Połącz serwery / Napraw głos).",
  ].join("\n");
}

/** Doradca AI Strażnika: zbiera diagnozę i pyta model o radę. */
export async function guardianAdvise(question: string): Promise<string> {
  const status = await guardianDiagnose();
  const reply = await askJarvis([{ role: "user", content: guardianAdvicePrompt(status, question) }]);
  return reply.text;
}

/**
 * WYKONAJ polecenie pełnym mózgiem JARVISA z narzędziami (zadania, e-mail, kalendarz, smart home,
 * web, sterowanie PC, leady…). Akcje ryzykowne i tak przechodzą przez zgody aplikacji. Zwraca wynik.
 */
export async function guardianExecute(command: string): Promise<{ text: string; tools: string[] }> {
  const reply = await askJarvis([{ role: "user", content: command }]);
  return { text: reply.text, tools: (reply as { tools?: string[] }).tools || [] };
}

/** Katalog możliwości Strażnika/JARVISA — do pokazania użytkownikowi (świadomość pełni mocy). */
export const GUARDIAN_CAPABILITIES: { group: string; items: string[] }[] = [
  { group: "🛠 Naprawa i wydajność", items: ["Napraw wszystko (mózg/serwery/ustawienia)", "Szybciej / Mądrzej / Bez cenzury", "Połącz lokalne serwery (Ollama, obrazy)", "Napraw głos (polski)", "Aktualizuj JARVISA"] },
  { group: "🧠 Rozmowa i wiedza", items: ["Odpowiedzi po polsku, lokalnie lub z chmury", "Web-research z cytatami", "Pamięć długoterminowa, dziennik, profil"] },
  { group: "⚙ Działania (narzędzia)", items: ["Zadania, notatki, przypomnienia, kalendarz", "E-mail (pisanie i wysyłka), leady i oferty", "Smart home, nawigacja, dzwonienie/SMS", "Sterowanie komputerem (Windows)", "Generowanie i edycja obrazów"] },
  { group: "💸 Pieniądze / sprawy nieodwracalne", items: ["Mogę przypomnieć o przelewie, przygotować dane i OTWORZYĆ bankowość", "…ale przelewu NIE wykonam sam — to wymaga Twojego potwierdzenia (bezpieczeństwo). Brak integracji z bankiem."] },
];
