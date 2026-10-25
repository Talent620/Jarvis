// The user's choice of coding backend (AUTO / CODEX / CLAUDE / LOCAL) and cost mode
// (TANIO / NORMALNIE / MAKSIMUM), kept per device in local storage.

import type { BackendChoice, CostMode } from "./types";
import type { CoderSettings } from "./controller";

const KEY = "jarvis.coder.settings.v1";
const BACKENDS: readonly BackendChoice[] = ["auto", "codex", "claude", "local"];
const MODES: readonly CostMode[] = ["cheap", "normal", "max"];

export const DEFAULT_CODER_SETTINGS: CoderSettings = { backend: "auto", mode: "normal" };

export function loadCoderSettings(): CoderSettings {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "{}") as Partial<CoderSettings>;
    return {
      backend: BACKENDS.includes(raw.backend as BackendChoice) ? (raw.backend as BackendChoice) : DEFAULT_CODER_SETTINGS.backend,
      mode: MODES.includes(raw.mode as CostMode) ? (raw.mode as CostMode) : DEFAULT_CODER_SETTINGS.mode,
    };
  } catch {
    return { ...DEFAULT_CODER_SETTINGS };
  }
}

export function saveCoderSettings(s: CoderSettings): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(s)); } catch { /* blocked storage: this session only */ }
}
