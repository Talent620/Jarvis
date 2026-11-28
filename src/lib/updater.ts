// === Aktualizacje JARVISA z GitHub (tag „latest") ===
// Sprawdza, czy na wydaniu jest NOWSZY build niż zainstalowany (__APP_BUILD__), buduje pełną
// listę instalatorów (Ubuntu AppImage/.deb, Windows .exe, Android APK Safe + OTA) oraz obsługuje
// natywne pobieranie z weryfikacją SHA256 w Electronie (z auto chmod +x dla AppImage na Ubuntu).
import { Capacitor } from "@capacitor/core";
import { fetchTimeout } from "./http";
import { desktop } from "./desktop";
import { openUrl } from "./deviceControl";

const REPO = "Talent620/Jarvis";
export type Plat = "android" | "ios" | "windows" | "linux" | "web";

const ASSET: Record<Plat, string> = { android: "jarvis.apk", ios: "JARVIS.ipa", windows: "JARVIS.exe", linux: "JARVIS.AppImage", web: "web-bundle.zip" };
const MANIFEST: Record<Plat, string> = { android: "bundle.json", ios: "ios.json", windows: "windows.json", linux: "linux.json", web: "bundle.json" };

export interface UpdateAssetItem {
  id: "ubuntu-appimage" | "ubuntu-deb" | "windows-exe" | "android-safe-apk" | "android-apk";
  label: string;
  platform: Plat;
  filename: string;
  url: string;
  size?: number;
  sha256?: string;
  recommended?: boolean;
  note: string;
}

export interface UpdateProgress {
  filename: string;
  receivedBytes: number;
  totalBytes: number;
  pct: number;
  speedBps: number;
}

export interface NativeUpdateDownloadResult {
  ok: boolean;
  filePath?: string;
  filename?: string;
  bytes?: number;
  sha256?: string;
  verifiedSha256?: boolean;
  executableSet?: boolean;
  message: string;
}

export function platform(): Plat {
  const p = Capacitor.getPlatform?.();
  if (p === "ios") return "ios";
  if (p === "android" || Capacitor.isNativePlatform?.()) return "android";
  const d = desktop();
  if (d?.platform === "linux") return "linux";
  if (d) return "windows";
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

export function releasePageUrl(tag = "latest"): string {
  return tag === "latest"
    ? `https://github.com/${REPO}/releases/tag/latest`
    : `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`;
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
  sha256?: string; // suma SHA256 pliku bieżącej platformy (jeśli w manifeście)
  releaseTag?: string;
  releaseUrl?: string;
  downloads?: UpdateAssetItem[]; // wszystkie dostępne instalatory w wydaniu (Ubuntu/Windows/Android)
  checkedAt: number; // czas udanego sprawdzenia
}

export interface UpdateApplyResult {
  ok: boolean;
  message: string;
}

export function platformLabel(p: Plat): string {
  if (p === "windows") return "Windows";
  if (p === "linux") return "Linux";
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

interface RawReleaseAsset {
  name?: string;
  updated_at?: string;
  browser_download_url?: string;
  size?: number;
}

interface PlatformManifestJson {
  iso?: string;
  version?: string;
  url?: string;
  sha256?: string;
  debUrl?: string;
  debSha256?: string;
  apkUrl?: string;
  apkSha256?: string;
}

/** Pure: zbuduj czytelną listę wszystkich dostępnych instalatorów (Ubuntu/Windows/Android) z wydania. */
export function buildDownloadsCatalog(
  assets: RawReleaseAsset[],
  activePlatform: Plat,
  manifestData?: PlatformManifestJson | null,
): UpdateAssetItem[] {
  const find = (name: string) => assets.find((a) => a.name === name);
  const out: UpdateAssetItem[] = [];

  const appImage = find("JARVIS.AppImage");
  if (appImage?.browser_download_url) {
    out.push({
      id: "ubuntu-appimage",
      label: "Ubuntu / Linux (AppImage)",
      platform: "linux",
      filename: "JARVIS.AppImage",
      url: appImage.browser_download_url,
      size: appImage.size,
      sha256: activePlatform === "linux" ? manifestData?.sha256 : undefined,
      recommended: activePlatform === "linux",
      note: "Przenośny pakiet Linux — bez instalacji (w Electronie automatyczne chmod +x).",
    });
  }

  const deb = find("JARVIS.deb");
  if (deb?.browser_download_url) {
    out.push({
      id: "ubuntu-deb",
      label: "Ubuntu / Debian (.deb)",
      platform: "linux",
      filename: "JARVIS.deb",
      url: deb.browser_download_url,
      size: deb.size,
      sha256: activePlatform === "linux" ? manifestData?.debSha256 : undefined,
      note: "Natywny pakiet systemowy Ubuntu (sudo apt install ./JARVIS.deb).",
    });
  }

  const exe = find("JARVIS.exe");
  if (exe?.browser_download_url) {
    out.push({
      id: "windows-exe",
      label: "Windows (.exe)",
      platform: "windows",
      filename: "JARVIS.exe",
      url: exe.browser_download_url,
      size: exe.size,
      sha256: activePlatform === "windows" ? manifestData?.sha256 : undefined,
      recommended: activePlatform === "windows",
      note: "Podpisany instalator Windows (NSIS — Dalej → Zainstaluj).",
    });
  }

  const apkSafe = find("jarvis-apex-v4.apk");
  if (apkSafe?.browser_download_url) {
    out.push({
      id: "android-safe-apk",
      label: "Android APK (Play-Protect Safe)",
      platform: "android",
      filename: "jarvis-apex-v4.apk",
      url: apkSafe.browser_download_url,
      size: apkSafe.size,
      sha256: activePlatform === "android" ? manifestData?.apkSha256 : undefined,
      recommended: activePlatform === "android",
      note: "Podpisany V1+V2+V3, instaluje się bez blokady Play Protect.",
    });
  }

  const apkStd = find("jarvis.apk");
  if (apkStd?.browser_download_url) {
    out.push({
      id: "android-apk",
      label: "Android APK (standard)",
      platform: "android",
      filename: "jarvis.apk",
      url: apkStd.browser_download_url,
      size: apkStd.size,
      recommended: activePlatform === "android" && !apkSafe,
      note: "Główny pakiet Android z usługą Dostępności + OTA.",
    });
  }

  return out;
}

/** Czy natywny downloader Electron (z paskiem postępu i SHA256) jest dostępny. */
export function nativeDesktopDownloadSupported(): boolean {
  const d = desktop();
  return Boolean(d && typeof d.downloadUpdate === "function");
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
    const assets: RawReleaseAsset[] = Array.isArray(d.assets) ? d.assets : [];
    if (p === "linux" && !assets.some((a) => a.name === ASSET.linux) && !assets.some((a) => a.name === MANIFEST.linux)) {
      return { error: "W wydaniu nie ma jeszcze aktualizacji dla Linuksa." };
    }
    let latestISO = "";
    let verifiedBuild = false;
    let manifestJson: PlatformManifestJson | null = null;
    const manifest = assets.find((a) => a.name === MANIFEST[p]);
    const manifestUrl = manifest?.browser_download_url || "";
    const isGithubDownloadCrossOrigin =
      typeof window !== "undefined" &&
      /^https?:$/i.test(window.location?.protocol || "") &&
      /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//i.test(manifestUrl);
    if (manifestUrl && !isGithubDownloadCrossOrigin) {
      try {
        const mr = await fetchTimeout(`${manifestUrl}?t=${Date.now()}`, { headers: { accept: "application/json" } }, 15000);
        const mj = (await mr.json().catch(() => null)) as PlatformManifestJson | null;
        if (mj?.iso) {
          latestISO = mj.iso;
          verifiedBuild = true;
          manifestJson = mj;
        }
      } catch {
        /* brak/nieczytelny manifest → fallback poniżej */
      }
    }
    const primaryAsset =
      p === "android"
        ? (assets.find((a) => a.name === "jarvis-apex-v4.apk") || assets.find((a) => a.name === ASSET.android))
        : assets.find((a) => a.name === ASSET[p]);
    if (!latestISO) {
      latestISO = primaryAsset?.updated_at || d.published_at || "";
    }
    const cur = currentBuild();
    const checkedAt = Date.now();
    try { localStorage.setItem("jarvis.update.lastCheck", String(checkedAt)); } catch { /* storage może być wyłączony */ }
    const downloads = buildDownloadsCatalog(assets, p, manifestJson);
    const primarySha = p === "android" ? manifestJson?.apkSha256 : manifestJson?.sha256;
    return {
      current: cur || "?",
      latest: latestISO ? latestISO.slice(0, 16).replace("T", " ") : "?",
      newer: verifiedBuild ? isNewer(cur, latestISO) : isNewerLegacyAsset(cur, latestISO),
      url: p === "ios" ? downloadUrl(p) : primaryAsset?.browser_download_url || downloadUrl(p),
      platform: p,
      assetAvailable: p === "web" ? !!manifest : p === "ios" ? true : !!primaryAsset,
      verifiedBuild,
      size: primaryAsset?.size,
      sha256: primarySha,
      releaseTag: typeof d.tag_name === "string" ? d.tag_name : "latest",
      releaseUrl: typeof d.html_url === "string" ? d.html_url : releasePageUrl("latest"),
      downloads,
      checkedAt,
    };
  } catch (e) {
    return { error: humanizeUpdateError(e instanceof Error ? e.message : String(e)) };
  }
}

/** Pobierz instalator natywnie w Electronie (pasek postępu + SHA256 + auto chmod +x na Ubuntu). */
export async function downloadNativeDesktopUpdate(
  url: string,
  expectedSha256?: string,
  onProgress?: (p: UpdateProgress) => void,
): Promise<NativeUpdateDownloadResult> {
  const d = desktop();
  if (!d?.downloadUpdate) {
    return { ok: false, message: "Natywne pobieranie działa wyłącznie w aplikacji desktopowej Electron." };
  }
  const off = onProgress && d.onUpdateProgress ? d.onUpdateProgress(onProgress) : null;
  try {
    const res = await d.downloadUpdate({ url, expectedSha256 });
    if (!res.ok) {
      return { ok: false, message: res.error || "Nie udało się pobrać aktualizacji." };
    }
    const extra = [
      res.verifiedSha256 ? "SHA256 zweryfikowane ✓" : "",
      res.executableSet ? "uprawnienia +x ustawione ✓" : "",
    ].filter(Boolean).join(" · ");
    return {
      ok: true,
      filePath: res.filePath,
      filename: res.filename,
      bytes: res.bytes,
      sha256: res.sha256,
      verifiedSha256: res.verifiedSha256,
      executableSet: res.executableSet,
      message: `Pobrano ${res.filename || "instalator"}${extra ? ` (${extra})` : ""}.`,
    };
  } catch (e) {
    return { ok: false, message: humanizeUpdateError(e instanceof Error ? e.message : String(e)) };
  } finally {
    if (off) off();
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
