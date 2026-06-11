import type { ReactNode } from "react";
import { registerTool, type ToolDef } from "../lib/tools";
import { toast } from "../lib/toast";
import { rememberFact } from "../lib/memory";
import { store } from "../lib/store";

// === Plugin API — fundament ekosystemu JARVIS ===
// Wtyczka to zwykły moduł TS: opisuje się (id/name/version) i w register()
// dostaje PluginAPI — może dokładać narzędzia agentowe (model widzi je jak
// wbudowane), sekcje ustawień, toasty i własną pamięć trwałą. Zero magii:
// instalacja = plik w src/plugins/ + wpis w src/plugins/index.ts.

export interface JarvisPlugin {
  /** Unikalny identyfikator, np. "pomodoro". Tylko [a-z0-9-]. */
  id: string;
  /** Nazwa wyświetlana w UI (⚙ → Wtyczki). */
  name: string;
  version: string;
  register(api: PluginAPI): void;
}

export interface PluginAPI {
  /** Dodaj narzędzie agentowe — model AI może je wywoływać jak wbudowane. */
  registerTool(name: string, description: string, schema: ToolDef["input_schema"], handler: (input: any) => Promise<string> | string): void;
  /** Dodaj sekcję w ⚙ → Wtyczki (render zwraca JSX). */
  addSettingsSection(label: string, render: () => ReactNode): void;
  /** Pokaż krótkie powiadomienie w interfejsie. */
  sendToast(message: string): void;
  /** Trwała pamięć wtyczki (w pamięci JARVIS-a, prefiksowana id wtyczki). */
  getMemory(key: string): string | undefined;
  setMemory(key: string, value: string): void;
}

export interface RegisteredPlugin {
  plugin: JarvisPlugin;
  /** Sekcje ustawień dołożone przez wtyczkę. */
  sections: { label: string; render: () => ReactNode }[];
  /** Nazwy narzędzi dołożonych przez wtyczkę. */
  tools: string[];
  /** Błąd rejestracji (wtyczka wadliwa — reszta aplikacji działa dalej). */
  error?: string;
}

const registry: RegisteredPlugin[] = [];

/** Lista zarejestrowanych wtyczek (dla UI ustawień). */
export const listPlugins = (): RegisteredPlugin[] => registry;

function apiFor(entry: RegisteredPlugin): PluginAPI {
  const pid = entry.plugin.id;
  return {
    registerTool(name, description, schema, handler) {
      const full = `${pid.replace(/-/g, "_")}_${name}`.toLowerCase();
      registerTool({ name: full, description, input_schema: schema }, handler);
      entry.tools.push(full);
    },
    addSettingsSection(label, render) {
      entry.sections.push({ label, render });
    },
    sendToast: toast,
    getMemory(key) {
      return store.data.memory.find((m) => m.key === `plugin.${pid}.${key}`)?.value;
    },
    setMemory(key, value) {
      rememberFact(`plugin.${pid}.${key}`, value);
    },
  };
}

/**
 * Załaduj wtyczki (wywoływane raz przy starcie). Awaria jednej wtyczki nie
 * psuje pozostałych ani aplikacji — błąd ląduje w jej wpisie rejestru.
 */
export function loadPlugins(plugins: JarvisPlugin[]): RegisteredPlugin[] {
  for (const plugin of plugins) {
    if (registry.some((r) => r.plugin.id === plugin.id)) continue; // bez duplikatów (HMR/StrictMode)
    const entry: RegisteredPlugin = { plugin, sections: [], tools: [] };
    registry.push(entry);
    try {
      plugin.register(apiFor(entry));
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
    }
  }
  return registry;
}
