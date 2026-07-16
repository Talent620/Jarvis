// === Łącznik z JARVIS Site OS ===
// Site OS jest osobną aplikacją przeglądarkową. JARVIS przekazuje projekty i wykonuje
// polecenia AI przez lokalne, tokenowane API; publiczny tunel nigdy nie dostaje tokenu.

import { store } from "./store";
import { continueSite, generateSite, repairTruncatedSite } from "./webgen";
import type { SiteProject } from "../types";

const DEFAULT_URL = "http://127.0.0.1:3210";

export interface SiteOsHealth {
  ok: boolean;
  name: string;
  version: string;
  localUrl: string;
  tunnelUrl?: string;
}

export interface SiteOsCommand {
  id: string;
  projectId: string;
  prompt: string;
  selection?: {
    tag?: string;
    id?: string | null;
    classes?: string[];
    text?: string;
  } | null;
}

function baseUrl(): string {
  return (store.settings.siteOsUrl || DEFAULT_URL).trim().replace(/\/$/, "");
}

function token(): string {
  return (store.settings.siteOsToken || "").trim();
}

async function request<T>(path: string, init: RequestInit = {}, requireToken = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (requireToken && token()) headers.set("Authorization", `Bearer ${token()}`);
  const response = await fetch(baseUrl() + path, { ...init, headers });
  const data = await response.json().catch(() => ({ error: "Nieprawidłowa odpowiedź Site OS." }));
  if (!response.ok) throw new Error(data.error || `Site OS: HTTP ${response.status}`);
  return data as T;
}

export function siteOsConfigured(): boolean {
  return Boolean(baseUrl() && token());
}

export function openSiteOs(): boolean {
  try {
    window.open(baseUrl(), "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}

export async function checkSiteOs(): Promise<SiteOsHealth> {
  return request<SiteOsHealth>("/api/health", {}, false);
}

export async function testSiteOs(): Promise<string> {
  try {
    const health = await checkSiteOs();
    if (!token()) return `Site OS ${health.version} działa. Wpisz kod parowania, aby połączyć JARVISA.`;
    await request("/api/projects");
    return `Połączono z Site OS ${health.version}. Projekty i polecenia AI są zsynchronizowane.`;
  } catch (error) {
    return `Brak połączenia z Site OS: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function pairSiteOs(code: string): Promise<string> {
  const clean = code.replace(/\D/g, "").slice(0, 6);
  if (clean.length !== 6) return "Wpisz sześciocyfrowy kod pokazany przy uruchomieniu Site OS.";
  try {
    const result = await request<{ ok: boolean; token: string; url: string; version: string }>(
      "/api/pair",
      { method: "POST", body: JSON.stringify({ code: clean }) },
      false,
    );
    store.setSettings({ siteOsUrl: result.url || baseUrl(), siteOsToken: result.token });
    return `Połączono z Site OS ${result.version}. Od teraz projekty i poprawki przepływają automatycznie.`;
  } catch (error) {
    return `Nie udało się sparować Site OS: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function sendProjectToSiteOs(project: Pick<SiteProject, "id" | "name" | "html" | "brief">): Promise<{ id: string }> {
  if (!siteOsConfigured()) throw new Error("Najpierw połącz Site OS w Ustawieniach → Integracje.");
  const result = await request<{ ok: boolean; project: { id: string } }>("/api/public/projects", {
    method: "POST",
    body: JSON.stringify({
      name: project.name,
      html: project.html,
      brief: project.brief,
      jarvisProjectId: project.id,
    }),
  });
  return { id: result.project.id };
}

function commandInstruction(command: SiteOsCommand): string {
  const selection = command.selection;
  if (!selection) return command.prompt;
  const target = [
    selection.tag ? `tag <${selection.tag}>` : "",
    selection.id ? `id #${selection.id}` : "",
    selection.classes?.length ? `klasy .${selection.classes.join(".")}` : "",
    selection.text ? `tekst zaczynający się od: „${selection.text.slice(0, 180)}”` : "",
  ].filter(Boolean).join(", ");
  return [
    command.prompt,
    "",
    `Zmień przede wszystkim zaznaczony element (${target}).`,
    "Zachowaj wszystkie pozostałe sekcje, treści, działające formularze i responsywność.",
  ].join("\n");
}

let processing = false;

/**
 * Odbiera najwyżej jedno polecenie naraz. Dzięki temu dwa interwały lub ponowne
 * renderowanie aplikacji nie uruchomią równoległych, kosztownych generacji.
 */
export async function processPendingSiteOsCommands(): Promise<{ processed: number; message?: string }> {
  if (processing || !siteOsConfigured()) return { processed: 0 };
  processing = true;
  try {
    const queue = await request<{ ok: boolean; commands: SiteOsCommand[] }>("/api/public/commands");
    const command = queue.commands[0];
    if (!command) return { processed: 0 };

    const projectResult = await request<{ ok: boolean; project: { html: string } }>(
      `/api/public/projects/${encodeURIComponent(command.projectId)}`,
    );
    const generated = await generateSite(commandInstruction(command), projectResult.project.html);
    if ("error" in generated) {
      await request(`/api/public/commands/${command.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: "failed", error: generated.error }),
      });
      return { processed: 1, message: generated.error };
    }

    const repaired = await repairTruncatedSite(generated.html, continueSite, { finishReason: generated.finishReason });
    if (!repaired.validation.safeToDownload) {
      const error = "Model zwrócił niepełną stronę. Poprzednia wersja została zachowana.";
      await request(`/api/public/commands/${command.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: "failed", error }),
      });
      return { processed: 1, message: error };
    }

    await request(`/api/public/commands/${command.id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "done", html: repaired.html }),
    });
    return { processed: 1, message: "Site OS: poprawka JARVISA jest gotowa." };
  } catch (error) {
    return { processed: 0, message: error instanceof Error ? error.message : String(error) };
  } finally {
    processing = false;
  }
}
