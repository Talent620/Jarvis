// === Aktualizacje JARVISA z GitHub (tag „latest") ===
// Sprawdza, czy na wydaniu jest NOWSZY build niż zainstalowany (__APP_BUILD__). Na telefonie/PC
// otwiera pobranie najnowszej wersji (1 klik → instalacja); w przeglądarce odświeża do najnowszej.
import { Capacitor } from "@capacitor/core";
import { fetchTimeout } from "./http";
import { isDesktop } from "./desktop";
import { openUrl } from "./deviceControl";

const REPO = "Talent620/Jarvis";
export type Plat = "android" | "windows" | "web";

const ASSET: Record<Plat, string> = { android: "jarvis.apk", windows: "JARVIS.exe", web: "jarvis.apk" };

export function platform(): Plat {
  if (Capacitor.isNativePlatform?.()) return "android";
  if (isDesktop()) return "windows";
  return "web";
}

export function currentBuild(): string {
  return typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "";
}

export function downloadUrl(p: Plat = platform()): string {
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

export interface UpdateInfo {
  current: string; // build zainstalowany
  latest: string; // build na wydaniu (skrócony)
  newer: boolean; // czy jest nowszy
  url: string; // link do pobrania (właściwy dla platformy)
  platform: Plat;
}

/** Sprawdź wydanie „latest" na GitHub i porównaj z bieżącym buildem. */
export async function checkForUpdate(): Promise<UpdateInfo | { error: string }> {
  const p = platform();
  try {
    const res = await fetchTimeout(`https://api.github.com/repos/${REPO}/releases/tags/latest`, { headers: { accept: "application/vnd.github+json" } }, 10000);
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) return { error: `Nie udało się sprawdzić aktualizacji (HTTP ${res.status}).` };
    const asset = Array.isArray(d.assets) ? d.assets.find((a: { name?: string }) => a.name === ASSET[p]) : null;
    const latestISO: string = asset?.updated_at || d.published_at || "";
    const cur = currentBuild();
    const newer = p === "web" ? true : isNewer(cur, latestISO); // w przeglądarce zawsze można odświeżyć
    return { current: cur || "?", latest: latestISO ? latestISO.slice(0, 16).replace("T", " ") : "?", newer, url: downloadUrl(p), platform: p };
  } catch (e) {
    return { error: `Brak połączenia z GitHub: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Zastosuj aktualizację: web → wyczyść cache i odśwież; telefon/PC → otwórz pobranie. */
export async function applyUpdate(info: UpdateInfo): Promise<void> {
  if (info.platform === "web") {
    try {
      if (typeof caches !== "undefined") { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); }
    } catch { /* brak Cache API — trudno */ }
    try { location.reload(); } catch { /* ignore */ }
    return;
  }
  try { await openUrl(info.url); } catch { try { window.open(info.url, "_blank"); } catch { location.href = info.url; } }
}
