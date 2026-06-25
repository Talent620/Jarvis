// === Lokalny generator obrazów (Stable Diffusion) — Studio na Twoim PC, offline i za darmo ===
// Mówi do API zgodnego z Automatic1111 / Forge / SD.Next: POST /sdapi/v1/txt2img (z opisu)
// albo /sdapi/v1/img2img (edycja zdjęcia). Działa zdalnie z telefonu jak Ollama (LAN/Tailscale).
import { Capacitor } from "@capacitor/core";
import { store } from "./store";
import { fetchTimeout } from "./http";

export interface GenImage { data: string; mediaType: string }
type Result = GenImage | { error: string };

export interface SdOpts {
  steps?: number;
  width?: number;
  height?: number;
  cfgScale?: number;
  sampler?: string;
  negative?: string;
  denoising?: number; // tylko img2img: ile zmieniać oryginał (0..1)
}

/** Ciało żądania txt2img (A1111). Czysta, testowalna. */
export function sdTxt2ImgBody(prompt: string, o: SdOpts = {}): Record<string, unknown> {
  return {
    prompt,
    negative_prompt: o.negative ?? "",
    steps: o.steps ?? 28,
    width: o.width ?? 1024,
    height: o.height ?? 1024,
    cfg_scale: o.cfgScale ?? 6,
    sampler_name: o.sampler ?? "DPM++ 2M",
    n_iter: 1,
    batch_size: 1,
  };
}

/** Ciało żądania img2img (edycja zdjęcia). Czysta. */
export function sdImg2ImgBody(prompt: string, initBase64: string, o: SdOpts = {}): Record<string, unknown> {
  return {
    ...sdTxt2ImgBody(prompt, o),
    init_images: [initBase64],
    denoising_strength: o.denoising ?? 0.6,
  };
}

/** Wyłuskaj obraz z odpowiedzi A1111 (zwraca czysty base64, czasem z prefiksem data:). Czysta. */
export function parseSdImage(json: unknown): Result {
  const d = json as { images?: string[]; error?: string; detail?: string };
  const img = d?.images?.[0];
  if (!img) return { error: d?.error || d?.detail || "Serwer SD nie zwrócił obrazu (sprawdź, czy uruchomiony z --api)." };
  const data = img.includes(",") ? img.split(",")[1] : img;
  return { data, mediaType: "image/png" };
}

/** Czytelna diagnoza błędu połączenia z lokalnym SD (jak przy Ollamie). Czysta. */
export function diagnoseSdError(url: string, err: unknown, pageHttps: boolean, isNative = false): string {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  // Mixed-content blokuje TYLKO przeglądarka — w APK cleartext do sieci lokalnej i Tailscale działa.
  if (pageHttps && /^http:\/\//i.test(url) && !isNative) {
    return "Mieszana zawartość: w przeglądarce aplikacja działa po HTTPS, a adres SD jest http:// — zainstaluj APK (dopuszcza HTTP do sieci domowej i Tailscale) albo wystaw serwer po HTTPS.";
  }
  if (name === "AbortError" || /abort|timeout/i.test(msg)) {
    return "Serwer Stable Diffusion nie odpowiedział w czasie (generowanie bywa wolne — daj mu chwilę, sprawdź adres i sieć).";
  }
  if (/failed to fetch|load failed|networkerror|fetch|connection/i.test(msg)) {
    return "Nie połączono z lokalnym generatorem. Uruchom A1111/Forge z flagami: --api --listen --cors-allow-origins=* i podaj adres http://IP-PC:7860 w ⚙ → AI.";
  }
  return msg || "Nieznany błąd serwera SD.";
}

/** Postęp generowania 0..1 z /sdapi/v1/progress. Czysta. */
export function parseSdProgress(json: unknown): number {
  const p = (json as { progress?: number })?.progress;
  return typeof p === "number" && isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
}

/** Pobierz aktualny postęp generowania z serwera SD (0..1). */
export async function getSdProgress(base: string): Promise<number> {
  const res = await fetchTimeout(`${base}/sdapi/v1/progress?skip_current_image=true`, {}, 5000);
  const d = await res.json().catch(() => null);
  return parseSdProgress(d);
}

export interface SdStatus { ok: boolean; models: string[]; error?: string }

/** Wyłuskaj nazwy checkpointów z /sdapi/v1/sd-models. Czysta. */
export function parseSdModels(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return (json as Array<{ model_name?: string; title?: string }>)
    .map((m) => m.model_name || m.title || "")
    .filter(Boolean);
}

/**
 * Auto-znajdź działający serwer Stable Diffusion: próbuje kolejno (obecny, localhost:7860,
 * 127.0.0.1:7860) i zwraca pierwszy, który odpowiada — żeby JARVIS sam się połączył z obrazami.
 */
/**
 * Doprowadź adres serwera Stable Diffusion do działającej formy (jak przy Ollamie). Czysta.
 * Brak schematu → http://, usuwa wklejone spacje i końcowy ukośnik, a goły http bez portu dostaje
 * domyślny port A1111/Forge 7860. Https (np. Tailscale serve) — portu nie rusza. Puste → "".
 */
export function normalizeSdUrl(raw?: string): string {
  let u = (raw || "").replace(/\s+/g, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  u = u.replace(/\/+$/, "");
  try {
    const p = new URL(u);
    const noPath = p.pathname.replace(/^\/+/, "") === "";
    if (p.protocol === "http:" && !p.port && noPath && !p.hostname.includes(":")) {
      p.port = "7860";
      u = p.toString().replace(/\/+$/, "");
    }
  } catch {
    /* niepoprawny URL — zostaw, detekcja zwróci czytelny błąd */
  }
  return u;
}

export async function findSdServer(candidates?: string[]): Promise<{ ok: boolean; url: string; models: string[]; error?: string; tried: string[] }> {
  const cur = store.settings.sdUrl?.trim();
  const raw = candidates ?? [cur, "http://localhost:7860", "http://127.0.0.1:7860"];
  const list = Array.from(new Set(raw.filter((u): u is string => !!u && !!u.trim()).map((u) => normalizeSdUrl(u))));
  const tried: string[] = [];
  for (const url of list) {
    tried.push(url);
    const r = await detectSd(url);
    if (r.ok) return { ok: true, url, models: r.models, tried };
  }
  return { ok: false, url: list[0] || "", models: [], error: "Nie znalazłem serwera Stable Diffusion (localhost:7860). Uruchom Forge/A1111 z flagą --api.", tried };
}

/** Sprawdź połączenie z serwerem SD i pobierz listę modeli (checkpointów). */
export async function detectSd(rawUrl?: string): Promise<SdStatus> {
  const base = normalizeSdUrl(rawUrl ?? store.settings.sdUrl);
  if (!base) return { ok: false, models: [], error: "Brak adresu serwera SD — wpisz go w ⚙ → AI." };
  try {
    const res = await fetchTimeout(`${base}/sdapi/v1/sd-models`, {}, 8000);
    if (!res.ok) return { ok: false, models: [], error: `Serwer SD odpowiedział ${res.status} (uruchom z --api).` };
    const d = await res.json().catch(() => null);
    return { ok: true, models: parseSdModels(d) };
  } catch (e) {
    const pageHttps = typeof location !== "undefined" && location.protocol === "https:";
    let native = false;
    try { native = Capacitor.isNativePlatform?.() === true; } catch { /* web */ }
    return { ok: false, models: [], error: diagnoseSdError(base, e, pageHttps, native) };
  }
}

/** Wygeneruj/edytuj obraz na lokalnym serwerze SD. Bez zdjęcia → txt2img; ze zdjęciem → img2img. */
export async function localSdGenerate(prompt: string, inputs: GenImage[] = [], opts: SdOpts = {}, onProgress?: (pct: number) => void): Promise<Result> {
  const base = normalizeSdUrl(store.settings.sdUrl);
  if (!base) return { error: "Lokalny generator (Stable Diffusion): wpisz adres serwera (A1111/Forge) w ⚙ → AI — Studio." };
  if (!prompt.trim()) return { error: "Podaj opis obrazu." };

  const hasImg = inputs.length > 0;
  const path = hasImg ? "/sdapi/v1/img2img" : "/sdapi/v1/txt2img";
  const body = hasImg ? sdImg2ImgBody(prompt, inputs[0].data, opts) : sdTxt2ImgBody(prompt, opts);
  // Wybrany checkpoint (z listy serwera) — A1111 przyjmuje go per-żądanie przez override_settings.
  const sdModel = store.settings.sdModel?.trim();
  if (sdModel) (body as Record<string, unknown>).override_settings = { sd_model_checkpoint: sdModel };
  try {
    const genP = fetchTimeout(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, 180000); // generowanie potrafi trwać — duży timeout

    // Pasek postępu: odpytujemy /progress, dopóki generowanie trwa (fire-and-forget, błędy ignorujemy).
    if (onProgress) {
      let live = true;
      void genP.then(() => { live = false; }, () => { live = false; });
      void (async () => {
        while (live) {
          await new Promise((r) => setTimeout(r, 700));
          if (!live) break;
          try { const pct = await getSdProgress(base); if (live) onProgress(pct); } catch { /* serwer zajęty — pomiń */ }
        }
      })();
    }

    const res = await genP;
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) return { error: `Błąd serwera SD (${res.status}). Sprawdź, czy działa z --api.` };
    return parseSdImage(d);
  } catch (e) {
    const pageHttps = typeof location !== "undefined" && location.protocol === "https:";
    let native = false;
    try { native = Capacitor.isNativePlatform?.() === true; } catch { /* web */ }
    return { error: diagnoseSdError(base, e, pageHttps, native) };
  }
}
