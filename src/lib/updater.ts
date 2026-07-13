// === Aktualizacje JARVISA z GitHub (tag „latest") ===
// Sprawdza, czy na wydaniu jest NOWSZY build niż zainstalowany (__APP_BUILD__). Na telefonie/PC
// otwiera pobranie najnowszej wersji (1 klik → instalacja); w przeglądarce odświeża do najnowszej.
import { Capacitor } from "@capacitor/core";
import { fetchTimeout } from "./http";
import { isDesktop } from "./desktop";
import { openUrl } from "./deviceControl";

const REPO = "Talent620/Jarvis";
export type Plat = "android" | "ios" | "windows" | "web";

const ASSET: Record<Plat, string> = { android: "jarvis.apk", ios: "JARVIS.ipa", windows: "JARVIS.exe", web: "web-bundle.zip" };
const MANIFEST: Record<Plat, string> = { android: "bundle.json", ios: "ios.json", windows: "windows.json", web: "bundle.json" };

export function platform(): Plat {
  const p = Capacitor.getPlatform?.();
  if (p === "ios") return "ios";
  if (p === "android" || Capacitor.isNativePlatform?.()) return "android";
  if (isDesktop()) return "windows";
  return "web";
}

export function currentBuild(): string {
  return typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "";
}

/**
 * Pure: znacznik buildu (UTC, np. "2026-06-30 13:44") → czytelny czas LOKALNY użytkownika.
 * Dzięki temu „godzina aktualizacji" zgadza się z zegarem na telefonie (nie myli UTC z lokalnym).
 * Zwraca "" gdy nieparsowalne. S9-safe (bez /u, bez \p, bez lookbehind).
 */
export function buildLocalTime(appBuild: string): string {
  if (!appBuild || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(appBuild)) return "";
  const d = new Date(appBuild.slice(0, 16).replace(" ", "T") + ":00Z");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

export function downloadUrl(p: Plat = platform()): string {
  // iOS nie ma instalowalnego pliku w wydaniach (instalacja przez App Store / sideload) —
  // kierujemy do strony wydań z instrukcją zamiast do nieistniejącego .ipa.
  if (p === "ios") return `https://github.com/${REPO}/releases/latest`;
  return `https://github.com/${REPO}/releases/download/latest/${ASSET[p]}`;
}

/** Czy build z wydania jest nowszy niż zainstalowany. Czysta (testowalna). */
export function isNewer(buildStr: string, assetISO: string): boolean {
  if (!buildStr || !assetISO) return false;
  const b = Date.parse(buildStr.replace(" ", "T") + ":00Z"); // „2026-06-20 00:35" → ISO UTC
  const a = Date.parse(assetISO);
  if (isNaN(b) || isNaN(a)) return false;
  return a > b + 60_000; // co najmniej minutę nowszy (margines)
}

/**
 * Starsze wydania nie miały manifestu per platforma. Sam upload instalatora trwa zwykle kilka minut,
 * więc jego updated_at nie może być porównywany 1:1 z czasem buildu (ta sama wersja wyglądałaby na
 * nowszą). Dziesięć minut zachowuje zgodność, a realne kolejne wydania nadal są wykrywane.
 */
export function isNewerLegacyAsset(buildStr: string, assetISO: string): boolean {
  if (!buildStr || !assetISO) return false;
  const b = Date.parse(buildStr.replace(" ", "T") + ":00Z");
  const a = Date.parse(assetISO);
  if (isNaN(b) || isNaN(a)) return false;
  return a > b + 10 * 60_000;
}

export interface UpdateInfo {
  current: string; // build zainstalowany
  latest: string; // build na wydaniu (skrócony)
  newer: boolean; // czy jest nowszy
  url: string; // link do pobrania (właściwy dla platformy)
  platform: Plat;
  assetAvailable: boolean; // czy właściwy instalator/paczka jest już na wydaniu
  verifiedBuild: boolean; // wersja pochodzi z manifestu tej platformy, nie z czasu uploadu
  size?: number; // rozmiar instalatora/paczki w bajtach
  checkedAt: number; // czas udanego sprawdzenia
}

export interface UpdateApplyResult {
  ok: boolean;
  message: string;
}

export function platformLabel(p: Plat): string {
  if (p === "windows") return "Windows";
  if (p === "android") return "Android";
  if (p === "ios") return "iPhone / iPad";
  return "Przeglądarka / PWA";
}

export function formatUpdateSize(bytes?: number): string {
  if (!bytes || bytes < 1) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Pure: zamień surowy błąd sieci/abortu na zrozumiały komunikat. */
export function humanizeUpdateError(msg: string): string {
  const m = (msg || "").toLowerCase();
  if (/abort|signal|timeout|timed out/.test(m)) return "GitHub nie odpowiedział na czas — sprawdź internet i spróbuj ponownie.";
  if (/failed to fetch|networkerror|network error|load failed|cors|ssl|dns/.test(m)) return "Brak internetu lub GitHub chwilowo niedostępny — spróbuj później.";
  return `Nie udało się sprawdzić aktualizacji: ${msg}`;
}

/** Sprawdź wydanie „latest" na GitHub i porównaj z bieżącym buildem. */
export async function checkForUpdate(): Promise<UpdateInfo | { error: string }> {
  const p = platform();
  const url = `https://api.github.com/repos/${REPO}/releases/tags/latest`;
  // Jedna ponowna próba — na telefonie pierwszy strzał bywa ucinany (wolna sieć/abort).
  let res: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetchTimeout(url, { headers: { accept: "application/vnd.github+json" } }, 15000);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!res) return { error: humanizeUpdateError(lastErr instanceof Error ? lastErr.message : String(lastErr)) };
  try {
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) {
      if (res.status === 404) return { error: "Brak opublikowanego wydania „latest” — najnowsza wersja jeszcze się buduje. Spróbuj później." };
      return { error: `Nie udało się sprawdzić aktualizacji (HTTP ${res.status}).` };
    }
    // Porównujemy z KANONICZNYM znacznikiem buildu z bundle.json (== __APP_BUILD__), a NIE z czasem
    // WGRANIA pliku na release. Czas wgrania jest zawsze parę minut po buildzie → ten sam build był
    // wiecznie widziany jako „nowsza wersja". bundle.json.iso to dokładnie ta sama minuta co build.
    const assets: { name?: string; updated_at?: string; browser_download_url?: string; size?: number }[] = Array.isArray(d.assets) ? d.assets : [];
    let latestISO = "";
    let verifiedBuild = false;
    const manifest = assets.find((a) => a.name === MANIFEST[p]);
    if (manifest?.browser_download_url) {
      try {
        const mr = await fetchTimeout(`${manifest.browser_download_url}?t=${Date.now()}`, { headers: { accept: "application/json" } }, 15000);
        const mj = (await mr.json().catch(() => null)) as { iso?: string } | null;
        if (mj?.iso) { latestISO = mj.iso; verifiedBuild = true; }
      } catch {
        /* brak/nieczytelny manifest → fallback poniżej */
      }
    }
    // Fallback dla starych wydań bez bundle.json: czas wgrania pliku platformy.
    if (!latestISO) {
      const asset = assets.find((a) => a.name === ASSET[p]);
      latestISO = asset?.updated_at || d.published_at || "";
    }
    const asset = assets.find((a) => a.name === ASSET[p]);
    const cur = currentBuild();
    const checkedAt = Date.now();
    try { localStorage.setItem("jarvis.update.lastCheck", String(checkedAt)); } catch { /* storage może być wyłączony */ }
    return {
      current: cur || "?",
      latest: latestISO ? latestISO.slice(0, 16).replace("T", " ") : "?",
      newer: verifiedBuild ? isNewer(cur, latestISO) : isNewerLegacyAsset(cur, latestISO),
      url: p === "ios" ? downloadUrl(p) : asset?.browser_download_url || downloadUrl(p),
      platform: p,
      assetAvailable: p === "web" ? !!manifest : p === "ios" ? true : !!asset,
      verifiedBuild,
      size: asset?.size,
      checkedAt,
    };
  } catch (e) {
    return { error: humanizeUpdateError(e instanceof Error ? e.message : String(e)) };
  }
}

/** Zastosuj aktualizację: web → wyczyść cache i odśwież; telefon/PC → otwórz pobranie. */
export async function applyUpdate(info: UpdateInfo): Promise<UpdateApplyResult> {
  if (!info.assetAvailable) {
    return { ok: false, message: "Nowa wersja jest wykryta, ale instalator jeszcze się buduje. Spróbuj ponownie za kilka minut." };
  }
  if (info.platform === "web") {
    try {
      if (typeof caches !== "undefined") { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); }
    } catch { /* brak Cache API — trudno */ }
    try { location.reload(); } catch { /* ignore */ }
    return { ok: true, message: "Odświeżam aplikację do najnowszej wersji." };
  }
  try {
    await openUrl(info.url);
    return { ok: true, message: info.platform === "ios" ? "Otwieram stronę najnowszego wydania." : "Pobieranie instalatora rozpoczęte." };
  } catch {
    try {
      window.open(info.url, "_blank");
      return { ok: true, message: "Pobieranie instalatora otwarte w przeglądarce." };
    } catch {
      try {
        location.href = info.url;
        return { ok: true, message: "Otwieram pobieranie instalatora." };
      } catch {
        return { ok: false, message: "Nie udało się otworzyć pobierania. Sprawdź połączenie i spróbuj ponownie." };
      }
    }
  }
}
