// === Łącznik z JARVIS Site OS 2.0 ===
// Site OS jest osobną aplikacją przeglądarkową. JARVIS przekazuje projekty i wykonuje
// polecenia AI przez lokalne, tokenowane API (SSE + REST); publiczny tunel nigdy nie dostaje tokenu.

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

/**
 * Pure (P0-1 fix): wycina ciężkie obrazy `data:image/...;base64,...` z kodu HTML przed wysłaniem do LLM,
 * zamieniając je na lekkie tokeny `__JARVIS_ASSET_N__`. Chroni przed ścianą SAFE_EDIT_CHARS = 60_000
 * po dodaniu grafik WebP w Site OS oraz oszczędza setki tysięcy tokenów.
 */
export function extractDataUriAssets(html: string): { strippedHtml: string; assets: Map<string, string> } {
  const assets = new Map<string, string>();
  if (!html || html.indexOf("data:image/") === -1) {
    return { strippedHtml: html || "", assets };
  }
  let idx = 0;
  const strippedHtml = html.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{256,}/g, (match) => {
    const tokenKey = `__JARVIS_ASSET_${idx++}__`;
    assets.set(tokenKey, match);
    return tokenKey;
  });
  return { strippedHtml, assets };
}

/**
 * Pure: przywraca oryginalne `data:image/...` na miejsce tokenów `__JARVIS_ASSET_N__` po odpowiedzi modelu.
 */
export function restoreDataUriAssets(html: string, assets: Map<string, string>): string {
  if (!html || assets.size === 0) return html || "";
  return html.replace(/__JARVIS_ASSET_\d+__/g, (tokenKey) => assets.get(tokenKey) ?? tokenKey);
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

/**
 * Automatyczne parowanie loopback (0 kliknięć i bez przepisywania 6 cyfr na tym samym komputerze):
 * jeśli Site OS działa lokalnie na 127.0.0.1, pobiera sesję bezpośrednio z `/api/session`.
 */
export async function autoConnectLocalSiteOs(): Promise<boolean> {
  if (siteOsConfigured()) return true;
  try {
    const session = await request<{ ok: boolean; token?: string }>("/api/session", {}, false);
    if (session?.ok && session.token) {
      store.setSettings({ siteOsUrl: baseUrl(), siteOsToken: session.token });
      return true;
    }
  } catch {
    /* serwer wyłączony albo zdalny — wymagany kod parowania */
  }
  return false;
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
    if (!token()) {
      const auto = await autoConnectLocalSiteOs();
      if (!auto) return `Site OS ${health.version} działa. Wpisz kod parowania, aby połączyć JARVISA.`;
    }
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
  if (!siteOsConfigured()) {
    await autoConnectLocalSiteOs();
  }
  if (!siteOsConfigured()) throw new Error("Najpierw połącz Site OS w Ustawieniach → Połączenia.");
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
    "Zachowaj wszystkie pozostałe sekcje, tokeny grafik __JARVIS_ASSET_N__, działające formularze i responsywność.",
  ].join("\n");
}

let processing = false;

/**
 * Odbiera najwyżej jedno polecenie naraz. Przed wysłaniem do modelu wycina osadzone obrazy base64
 * do lekkich placeholderów `__JARVIS_ASSET_N__` i przywraca je po wygenerowaniu poprawki.
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
    const { strippedHtml, assets } = extractDataUriAssets(projectResult.project.html);
    const generated = await generateSite(commandInstruction(command), strippedHtml);
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

    const finalHtml = restoreDataUriAssets(repaired.html, assets);
    await request(`/api/public/commands/${command.id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "done", html: finalHtml }),
    });
    return { processed: 1, message: "Site OS: poprawka JARVISA jest gotowa." };
  } catch (error) {
    return { processed: 0, message: error instanceof Error ? error.message : String(error) };
  } finally {
    processing = false;
  }
}

/**
 * Subskrybuje strumień SSE `/api/events` z lokalnego Site OS, aby polecenia AI startowały
 * w czasie rzeczywistym (< 50 ms) zamiast czekać na 12-sekundowy interwał pollingu.
 */
export function subscribeSiteOsEvents(onCommandQueued: () => void): () => void {
  if (typeof EventSource === "undefined" || !siteOsConfigured()) return () => {};
  let es: EventSource | null = null;
  try {
    const url = `${baseUrl()}/api/events?token=${encodeURIComponent(token())}`;
    es = new EventSource(url);
    es.addEventListener("command-queued", () => onCommandQueued());
  } catch {
    return () => {};
  }
  return () => {
    try { es?.close(); } catch { /* ignore */ }
  };
}
