// === Lokalny generator obrazów (Stable Diffusion) — Studio na Twoim PC, offline i za darmo ===
// Mówi do API zgodnego z Automatic1111 / Forge / SD.Next: POST /sdapi/v1/txt2img (z opisu)
// albo /sdapi/v1/img2img (edycja zdjęcia). Działa zdalnie z telefonu jak Ollama (LAN/Tailscale).
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
export function diagnoseSdError(url: string, err: unknown, pageHttps: boolean): string {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (pageHttps && /^http:\/\//i.test(url)) {
    return "Mieszana zawartość: aplikacja po HTTPS, a adres SD jest http:// — użyj APK albo wystaw serwer po HTTPS (np. Tailscale serve).";
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

/** Sprawdź połączenie z serwerem SD i pobierz listę modeli (checkpointów). */
export async function detectSd(rawUrl?: string): Promise<SdStatus> {
  const base = (rawUrl ?? store.settings.sdUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return { ok: false, models: [], error: "Brak adresu serwera SD — wpisz go w ⚙ → AI." };
  try {
    const res = await fetchTimeout(`${base}/sdapi/v1/sd-models`, {}, 8000);
    if (!res.ok) return { ok: false, models: [], error: `Serwer SD odpowiedział ${res.status} (uruchom z --api).` };
    const d = await res.json().catch(() => null);
    return { ok: true, models: parseSdModels(d) };
  } catch (e) {
    const pageHttps = typeof location !== "undefined" && location.protocol === "https:";
    return { ok: false, models: [], error: diagnoseSdError(base, e, pageHttps) };
  }
}

/** Wygeneruj/edytuj obraz na lokalnym serwerze SD. Bez zdjęcia → txt2img; ze zdjęciem → img2img. */
export async function localSdGenerate(prompt: string, inputs: GenImage[] = [], opts: SdOpts = {}, onProgress?: (pct: number) => void): Promise<Result> {
  const base = (store.settings.sdUrl || "").trim().replace(/\/+$/, "");
  if (!base) return { error: "Lokalny generator (Stable Diffusion): wpisz adres serwera (A1111/Forge) w ⚙ → AI — Studio." };
  if (!prompt.trim()) return { error: "Podaj opis obrazu." };

  const hasImg = inputs.length > 0;
  const path = hasImg ? "/sdapi/v1/img2img" : "/sdapi/v1/txt2img";
  const body = hasImg ? sdImg2ImgBody(prompt, inputs[0].data, opts) : sdTxt2ImgBody(prompt, opts);
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
          try { onProgress(await getSdProgress(base)); } catch { /* serwer zajęty — pomiń */ }
        }
      })();
    }

    const res = await genP;
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) return { error: `Błąd serwera SD (${res.status}). Sprawdź, czy działa z --api.` };
    return parseSdImage(d);
  } catch (e) {
    const pageHttps = typeof location !== "undefined" && location.protocol === "https:";
    return { error: diagnoseSdError(base, e, pageHttps) };
  }
}
