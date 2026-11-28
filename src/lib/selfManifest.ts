// === Sprint 3 / Moduł 2: Samowiedza (Self-Awareness) + Autonomiczna Zmiana Ustawień + Rollback ===
// Kompaktowa mapa samego JARVIS-a synchronizowana w czasie rzeczywistym z rejestrem narzędzi i store,
// wstrzykiwana do promptu systemowego + walidowana modyfikacja ustawień z 1-klikowym cofnięciem (undo).
import { Capacitor } from "@capacitor/core";
import { store } from "./store";
import { isDesktop } from "./desktop";
import { activeVoiceLabel, resolveVoiceMode, type VoiceMode } from "./voice";
import { normalizeProactiveBudget } from "./sleepCompute";
import type { ProactiveBudgetState, Settings } from "../types";
import type { PersonalityMode } from "./soulModes";

export const JARVIS_VERSION = "5.0.0-production-rc";

export const JARVIS_MODULES = [
  "JARVIS AUTOCORE (Centralny router AI, zdrowie dostawców, budżet 100%, discovery, jeden resolver TTS)",
  "Modal Brain (vLLM OpenAI-compatible)",
  "Streaming Polish TTS (ElevenLabs Flash v2.5 / OpenAI / Modal Voice / Gemini / Native fallback)",
  "Protokół Mówionej Polszczyzny (voice_mode + barge-in)",
  "3 Tryby Osobowości (BOJOWY / KUMPEL / ADWOKAT_DIABLA / AUTO)",
  "Nocny Sen (open_loops + user_lessons) + Budżet Ciszy (3/dzień, 22:00–07:00)",
  "Rada Ekspertów (Narada — 3 role równolegle Promise.all)",
  "Live Vision (Oczy w terenie — tylna kamera + instrukcja głosowa)",
  "Kolejka Misji w Tle (mission_queue z natychmiastowym potwierdzeniem Refleks)",
  "Trwałe Cele Wieloetapowe (voiceCognition + agentPlanner + goalRuntime + resultVerifier)",
  "Android Phone Use Agent + RiskGuard (Check-then-Act, zakaz pól haseł)",
  "OMNI-PILOT & Frontier Desktop Computer Use (Refleks <30ms, Hybryda AT-SPI2/UIA + Vision [0..1000], Dual-Track Strażnik Ekranu, Diagnostyka OS, RiskGuard + Kill-Switch Ctrl+Alt+X)",
  "JARVIS FORGE + AUTOPILOT ORCHESTRATOR (Jedno polecenie zero-config: Adaptive Intelligence, dynamiczne zespoły, 14 darmowych/lokalnych modeli 0 USD, git worktree, pamięć projektu/ADR, bramka zgody waiting_approval, testy, cross-model review, checkpointy i rollback)",
  "JARVIS FLOW — Reżyser Skupienia (100% offline sprinty 15/25/45 min, Parking Myśli → 1-klik Zadanie/Notatka, proceduralny Web Audio generator dźwięku, Momentum & debrief)",
  "Centrum Aktualizacji 1-Klik (Topbar + ⌘K + natywny downloader Electron z paskiem postępu %, weryfikacją SHA256, auto chmod +x dla AppImage oraz katalog Ubuntu .AppImage/.deb, Windows .exe i Android APK/OTA)",
  "Bi-Temporal Core Memory + MCP Bridge",
] as const;

export interface JarvisSelfManifest {
  version: string;
  platform: "android" | "ios" | "desktop" | "web";
  ai: {
    provider: string;
    model: string;
    modalBrainConfigured: boolean;
    proxyConfigured: boolean;
    onDeviceOnly: boolean;
  };
  voice: {
    enabled: boolean;
    engine: VoiceMode;
    label: string;
    rate: number;
    pitch: number;
    voiceModeProtocol: boolean;
    modalVoiceConfigured: boolean;
  };
  soul: {
    personalityMode: PersonalityMode;
    autonomyProfile: "STANDARD" | "OPERATOR";
  };
  silenceBudget: {
    usedToday: number;
    dailyLimit: number;
    quietHours: string;
  };
  connections: {
    online: boolean;
    cameraAvailable: boolean;
    androidPluginsAvailable: boolean;
    desktopBridgeAvailable: boolean;
  };
  capabilities: {
    modules: readonly string[];
    activeToolsCount: number;
    activeToolsSample: string[];
    limitations: string[];
  };
}

export function detectPlatform(): JarvisSelfManifest["platform"] {
  try {
    const p = Capacitor.getPlatform?.();
    if (p === "android") return "android";
    if (p === "ios") return "ios";
  } catch {
    /* ignore */
  }
  return isDesktop() ? "desktop" : "web";
}

/** Zbuduj aktualny, prawdziwy manifest stanu JARVIS-a (ZERO sekretów ani kluczy API). */
export function buildSelfManifest(toolNames: string[] = []): JarvisSelfManifest {
  const s = store.settings;
  const platform = detectPlatform();
  const budget = normalizeProactiveBudget(store.data.proactive_budget);
  const online = typeof navigator !== "undefined" ? navigator.onLine !== false : true;
  const cameraAvailable =
    platform === "android" ||
    platform === "ios" ||
    (typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia);

  const limitations: string[] = [];
  if (platform === "android") {
    limitations.push("Brak narzędzi desktop_* (Electron); wariant sideload Play-Protect-safe działa bez usługi Dostępności Androida.");
  } else if (platform === "desktop") {
    limitations.push("Brak natywnych pluginów Androida (android_*, dzwonienie/SMS); pełne narzędzia desktop_* (Linux/Windows: aplikacje, audio, media, zasilanie, MCP, Ollama).");
  } else {
    limitations.push("Tryb przeglądarkowy: brak natywnego sterowania telefonem (android_*) i pulpitem (desktop_*).");
  }
  if (!online) {
    limitations.push("Brak sieci: chmurowe AI i neuralny TTS przechodzą na tryb lokalny/natywny offline.");
  }

  return {
    version: JARVIS_VERSION,
    platform,
    ai: {
      provider: s.provider || "auto",
      model: s.model || "auto",
      modalBrainConfigured: Boolean(s.modalUrl?.trim() && s.keys?.modal?.trim()),
      proxyConfigured: Boolean(s.proxyUrl?.trim()),
      onDeviceOnly: Boolean(s.onDeviceOnly),
    },
    voice: {
      enabled: Boolean(s.speak),
      engine: resolveVoiceMode(s),
      label: activeVoiceLabel(s),
      rate: s.voiceRate ?? 1.0,
      pitch: s.voicePitch ?? 0.9,
      voiceModeProtocol: Boolean(s.voiceModeProtocol),
      modalVoiceConfigured: Boolean(s.modalVoiceUrl?.trim()),
    },
    soul: {
      personalityMode: (s.personalityMode || "AUTO") as PersonalityMode,
      autonomyProfile: s.autonomyProfile === "OPERATOR" ? "OPERATOR" : "STANDARD",
    },
    silenceBudget: {
      usedToday: budget.usedToday,
      dailyLimit: budget.dailyLimit,
      quietHours: `${String(budget.quietStartHour).padStart(2, "0")}:00–${String(budget.quietEndHour).padStart(2, "0")}:00`,
    },
    connections: {
      online,
      cameraAvailable,
      androidPluginsAvailable: platform === "android",
      desktopBridgeAvailable: platform === "desktop",
    },
    capabilities: {
      modules: JARVIS_MODULES,
      activeToolsCount: toolNames.length,
      activeToolsSample: toolNames.slice(0, 30),
      limitations,
    },
  };
}

/** Kompaktowy blok samowiedzy wstrzykiwany do promptu systemowego JARVIS-a (zero zgadywania). */
export function buildSelfAwarenessPromptBlock(toolNames: string[] = []): string {
  const m = buildSelfManifest(toolNames);
  const conn = [
    m.ai.modalBrainConfigured ? "ModalBrain=OK" : "ModalBrain=nieustawiony",
    m.voice.modalVoiceConfigured ? "ModalVoice=OK" : "ModalVoice=nieustawiony",
    m.ai.proxyConfigured ? "Proxy=OK" : "Proxy=brak",
    m.connections.cameraAvailable ? "Kamera=OK" : "Kamera=brak",
    m.connections.androidPluginsAvailable ? "AndroidPlugins=OK" : m.connections.desktopBridgeAvailable ? "DesktopBridge=OK" : "WebOnly",
  ].join(", ");

  return [
    `SAMOWIEDZA SYSTEMOWA (JARVIS v${m.version} · platforma: ${m.platform}):`,
    `- Mózg: dostawca=${m.ai.provider}, model=${m.ai.model}${m.ai.onDeviceOnly ? " (TYLKO ON-DEVICE)" : ""}.`,
    `- Głos: ${m.voice.label} (tempo=${m.voice.rate.toFixed(2)}, ton=${m.voice.pitch.toFixed(2)}, voice_mode=${m.voice.voiceModeProtocol ? "WŁ" : "WYŁ"}).`,
    `- Osobowość: ${m.soul.personalityMode} · Profil autonomii: ${m.soul.autonomyProfile} · Budżet Ciszy: ${m.silenceBudget.usedToday}/${m.silenceBudget.dailyLimit} (cisza ${m.silenceBudget.quietHours}).`,
    `- Połączenia: ${conn}.`,
    `- Narzędzia aktywne: ${m.capabilities.activeToolsCount} (w tym get_jarvis_status, update_jarvis_settings, rollback_jarvis_settings, expert_council, live_vision).`,
    `- Ograniczenia platformy: ${m.capabilities.limitations.join(" ")}`,
    `- Gdy użytkownik pyta kim jesteś, co potrafisz lub jak jesteś skonfigurowany — odpowiadaj z tego stanu (nie zgaduj). Gdy prosi o zmianę ustawień — użyj update_jarvis_settings (zawsze z opcją cofnięcia przez rollback_jarvis_settings).`,
  ].join("\n");
}

// --- Walidowana autonomiczna zmiana ustawień + 1-klikowy rollback (undo) ---

const ROLLBACK_KEY = "jarvis.settings.rollback.v1";
const MAX_ROLLBACK_STACK = 10;

const ALLOWED_PROVIDERS = new Set([
  "auto", "modal", "anthropic", "gemini", "groq", "cerebras", "mistral", "cohere", "openrouter", "nvidia", "github", "ollama", "webllm",
]);
const ALLOWED_VOICE_MODES = new Set<VoiceMode>(["system", "gemini", "eleven", "openai", "modal", "fish", "local"]);
const ALLOWED_PERSONALITIES = new Set<PersonalityMode>(["AUTO", "BOJOWY", "KUMPEL", "ADWOKAT_DIABLA"]);
const ALLOWED_ELEVEN_MODELS = new Set(["eleven_flash_v2_5", "eleven_multilingual_v2"]);
const ALLOWED_OPENAI_TTS_MODELS = new Set(["gpt-4o-mini-tts", "tts-1", "tts-1-hd"]);
const ALLOWED_AUTONOMY = new Set(["STANDARD", "OPERATOR"]);

export interface SettingsUpdatePatch {
  provider?: string;
  model?: string;
  voiceMode?: VoiceMode;
  voiceRate?: number;
  voicePitch?: number;
  speak?: boolean;
  elevenLabsModel?: "eleven_flash_v2_5" | "eleven_multilingual_v2";
  openaiTtsModel?: "gpt-4o-mini-tts" | "tts-1" | "tts-1-hd";
  openaiTtsVoice?: string;
  geminiVoice?: string;
  personalityMode?: PersonalityMode;
  voiceModeProtocol?: boolean;
  autonomyProfile?: "STANDARD" | "OPERATOR";
  modalUrl?: string;
  modalVoiceUrl?: string;
  proxyUrl?: string;
  proactiveDailyLimit?: number;
  quietStartHour?: number;
  quietEndHour?: number;
}

export interface SettingsRollbackSnapshot {
  at: number;
  reason: string;
  prevSettings: Partial<Settings>;
  prevBudget?: ProactiveBudgetState;
}

export interface SettingsUpdateResult {
  ok: boolean;
  applied: string[];
  errors: string[];
  rollbackAvailable: boolean;
  summary: string;
}

function isValidHttpUrl(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}

function loadRollbackStack(): SettingsRollbackSnapshot[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(ROLLBACK_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRollbackStack(stack: SettingsRollbackSnapshot[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(ROLLBACK_KEY, JSON.stringify(stack.slice(0, MAX_ROLLBACK_STACK)));
  } catch {
    /* quota */
  }
}

export function clearSettingsRollbackHistory(): void {
  saveRollbackStack([]);
}

/**
 * Waliduj i zastosuj zmianę ustawień JARVIS-a z automatycznym zapisem poprzedniego stanu (undo).
 * Odrzuca błędne/puste URL-e, nieznane wartości enum i wartości spoza bezpiecznych widełek.
 */
export function validateAndApplyJarvisSettings(
  patch: Record<string, unknown>,
  reason = "voice/tool update",
): SettingsUpdateResult {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return {
      ok: false,
      applied: [],
      errors: ["Niepoprawny obiekt ustawień."],
      rollbackAvailable: loadRollbackStack().length > 0,
      summary: "Nie wprowadzono zmian — przekazano niepoprawny format ustawień.",
    };
  }

  const errors: string[] = [];
  const nextSettings: Partial<Settings> = {};
  const prevSettings: Partial<Settings> = {};
  const applied: string[] = [];
  const cur = store.settings;

  const stage = <K extends keyof Settings>(key: K, val: Settings[K], label: string) => {
    prevSettings[key] = cur[key];
    nextSettings[key] = val;
    applied.push(`${label}=${String(val)}`);
  };

  if ("provider" in patch && patch.provider !== undefined) {
    const p = String(patch.provider).trim().toLowerCase();
    if (!ALLOWED_PROVIDERS.has(p)) errors.push(`Nieznany dostawca AI: ${p}`);
    else stage("provider", p, "provider");
  }
  if ("model" in patch && patch.model !== undefined) {
    const m = String(patch.model).trim();
    if (!m || m.length > 140) errors.push("Nazwa modelu musi mieć 1–140 znaków.");
    else stage("model", m, "model");
  }
  if ("voiceMode" in patch && patch.voiceMode !== undefined) {
    const vm = String(patch.voiceMode).trim().toLowerCase() as VoiceMode;
    if (!ALLOWED_VOICE_MODES.has(vm)) errors.push(`Nieznany silnik TTS: ${vm}`);
    else {
      stage("voiceMode", vm, "voiceMode");
      stage("voiceSystemPl", vm === "system", "voiceSystemPl");
      stage("geminiTts", vm === "gemini", "geminiTts");
      stage("localTts", vm === "local", "localTts");
    }
  }
  if ("voiceRate" in patch && patch.voiceRate !== undefined) {
    const r = Number(patch.voiceRate);
    if (!Number.isFinite(r) || r < 0.5 || r > 2.0) errors.push("Szybkość mowy (voiceRate) musi być w zakresie 0.5–2.0.");
    else stage("voiceRate", Number(r.toFixed(2)), "voiceRate");
  }
  if ("voicePitch" in patch && patch.voicePitch !== undefined) {
    const p = Number(patch.voicePitch);
    if (!Number.isFinite(p) || p < 0.5 || p > 2.0) errors.push("Wysokość głosu (voicePitch) musi być w zakresie 0.5–2.0.");
    else stage("voicePitch", Number(p.toFixed(2)), "voicePitch");
  }
  if ("speak" in patch && patch.speak !== undefined) {
    if (typeof patch.speak !== "boolean") errors.push("Pole speak musi być wartością logiczną (true/false).");
    else stage("speak", patch.speak, "speak");
  }
  if ("elevenLabsModel" in patch && patch.elevenLabsModel !== undefined) {
    const m = String(patch.elevenLabsModel).trim();
    if (!ALLOWED_ELEVEN_MODELS.has(m)) errors.push(`Nieznany model ElevenLabs: ${m}`);
    else stage("elevenLabsModel", m as "eleven_flash_v2_5" | "eleven_multilingual_v2", "elevenLabsModel");
  }
  if ("openaiTtsModel" in patch && patch.openaiTtsModel !== undefined) {
    const m = String(patch.openaiTtsModel).trim();
    if (!ALLOWED_OPENAI_TTS_MODELS.has(m)) errors.push(`Nieznany model OpenAI TTS: ${m}`);
    else stage("openaiTtsModel", m as "gpt-4o-mini-tts" | "tts-1" | "tts-1-hd", "openaiTtsModel");
  }
  if ("openaiTtsVoice" in patch && patch.openaiTtsVoice !== undefined) {
    const v = String(patch.openaiTtsVoice).trim().toLowerCase();
    if (!v || !/^[a-z0-9_-]{2,32}$/.test(v)) errors.push("Niepoprawna nazwa głosu OpenAI TTS.");
    else stage("openaiTtsVoice", v, "openaiTtsVoice");
  }
  if ("geminiVoice" in patch && patch.geminiVoice !== undefined) {
    const v = String(patch.geminiVoice).trim();
    if (!v || v.length > 40) errors.push("Niepoprawna nazwa głosu Gemini.");
    else stage("geminiVoice", v, "geminiVoice");
  }
  if ("personalityMode" in patch && patch.personalityMode !== undefined) {
    const pm = String(patch.personalityMode).trim().toUpperCase() as PersonalityMode;
    if (!ALLOWED_PERSONALITIES.has(pm)) errors.push(`Nieznany tryb osobowości: ${pm}`);
    else stage("personalityMode", pm, "personalityMode");
  }
  if ("voiceModeProtocol" in patch && patch.voiceModeProtocol !== undefined) {
    if (typeof patch.voiceModeProtocol !== "boolean") errors.push("Pole voiceModeProtocol musi być boolean.");
    else stage("voiceModeProtocol", patch.voiceModeProtocol, "voiceModeProtocol");
  }
  if ("autonomyProfile" in patch && patch.autonomyProfile !== undefined) {
    const ap = String(patch.autonomyProfile).trim().toUpperCase();
    if (!ALLOWED_AUTONOMY.has(ap)) errors.push(`Nieznany profil autonomii: ${ap} (dozwolone: STANDARD, OPERATOR).`);
    else stage("autonomyProfile", ap as "STANDARD" | "OPERATOR", "autonomyProfile");
  }

  for (const urlKey of ["modalUrl", "modalVoiceUrl", "proxyUrl"] as const) {
    if (urlKey in patch && patch[urlKey] !== undefined) {
      const raw = String(patch[urlKey]);
      if (!isValidHttpUrl(raw)) {
        errors.push(`Niepoprawny lub pusty URL dla ${urlKey} — wymagany pełny adres http(s)://.`);
      } else {
        stage(urlKey, raw.trim(), urlKey);
      }
    }
  }

  // Budżet Ciszy
  const curBudget = normalizeProactiveBudget(store.data.proactive_budget);
  let budgetChanged = false;
  const nextBudget: ProactiveBudgetState = { ...curBudget };

  if ("proactiveDailyLimit" in patch && patch.proactiveDailyLimit !== undefined) {
    const n = Number(patch.proactiveDailyLimit);
    if (!Number.isInteger(n) || n < 0 || n > 20) errors.push("Limit dzienny Budżetu Ciszy musi być liczbą całkowitą 0–20.");
    else {
      nextBudget.dailyLimit = n;
      budgetChanged = true;
      applied.push(`proactiveDailyLimit=${n}`);
    }
  }
  if ("quietStartHour" in patch && patch.quietStartHour !== undefined) {
    const h = Number(patch.quietStartHour);
    if (!Number.isInteger(h) || h < 0 || h > 23) errors.push("Godzina początku ciszy nocnej musi być 0–23.");
    else {
      nextBudget.quietStartHour = h;
      budgetChanged = true;
      applied.push(`quietStartHour=${h}`);
    }
  }
  if ("quietEndHour" in patch && patch.quietEndHour !== undefined) {
    const h = Number(patch.quietEndHour);
    if (!Number.isInteger(h) || h < 0 || h > 23) errors.push("Godzina końca ciszy nocnej musi być 0–23.");
    else {
      nextBudget.quietEndHour = h;
      budgetChanged = true;
      applied.push(`quietEndHour=${h}`);
    }
  }

  // Odrzuć cały patch atomowo przy jakimkolwiek błędzie walidacji (nie uszkadzaj konfiguracji!)
  if (errors.length > 0) {
    return {
      ok: false,
      applied: [],
      errors,
      rollbackAvailable: loadRollbackStack().length > 0,
      summary: `Odrzucono zmianę ustawień: ${errors.join(" ")}`,
    };
  }

  if (applied.length === 0) {
    return {
      ok: false,
      applied: [],
      errors: ["Nie podano żadnego obsługiwanego pola ustawień do zmiany."],
      rollbackAvailable: loadRollbackStack().length > 0,
      summary: "Brak obsługiwanych ustawień do zmiany.",
    };
  }

  // Zapisz snapshot poprzedniego stanu (1-klikowe cofnięcie rollback_jarvis_settings)
  const stack = loadRollbackStack();
  stack.unshift({
    at: Date.now(),
    reason,
    prevSettings,
    prevBudget: budgetChanged ? { ...curBudget } : undefined,
  });
  saveRollbackStack(stack);

  if (Object.keys(nextSettings).length > 0) {
    store.setSettings(nextSettings);
  }
  if (budgetChanged) {
    store.setData((d) => {
      d.proactive_budget = nextBudget;
    });
  }

  return {
    ok: true,
    applied,
    errors: [],
    rollbackAvailable: true,
    summary: `Zaktualizowano ustawienia (${applied.join(", ")}). Możesz cofnąć jednym poleceniem: „cofnij ostatnią zmianę ustawień”.`,
  };
}

/** Cofnij ostatnią autonomiczną zmianę ustawień JARVIS-a (1-klikowe undo). */
export function rollbackJarvisSettings(): { ok: boolean; restoredKeys: string[]; summary: string } {
  const stack = loadRollbackStack();
  const snap = stack.shift();
  if (!snap) {
    return {
      ok: false,
      restoredKeys: [],
      summary: "Brak zapisanej poprzedniej konfiguracji do cofnięcia.",
    };
  }
  saveRollbackStack(stack);

  const restoredKeys: string[] = [];
  if (snap.prevSettings && Object.keys(snap.prevSettings).length > 0) {
    store.setSettings(snap.prevSettings);
    restoredKeys.push(...Object.keys(snap.prevSettings));
  }
  if (snap.prevBudget) {
    store.setData((d) => {
      d.proactive_budget = snap.prevBudget;
    });
    restoredKeys.push("proactive_budget");
  }

  return {
    ok: true,
    restoredKeys,
    summary: `Cofnięto ostatnią zmianę ustawień (${restoredKeys.join(", ")}).`,
  };
}
