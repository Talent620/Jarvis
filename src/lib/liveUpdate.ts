// === Aktualizacje OTA „błyskawiczne" — sam web-bundle, nie cały APK ===
// Aplikacja jest webowa w natywnej skorupie (Capacitor). Większość zmian (kod/UI) dotyczy tylko
// web-bundla (~1–2 MB) — nie trzeba reinstalować całego APK (6 MB) ani klikać instalatora Androida.
// Tu: sprawdzamy manifest na GitHub Releases (bundle.json), pobieramy web-bundle.zip i podmieniamy
// paczkę przez @capgo/capacitor-updater. Wtyczka ma bezpiecznik: jeśli nowa paczka nie zgłosi
// gotowości (notifyAppReady), wraca do poprzedniej, działającej wersji.
//
// WAŻNE: działa dopiero od wersji APK, która MA tę wtyczkę. Pierwszy raz instalujesz pełny APK,
// potem aktualizacje idą OTA. Import wtyczki jest DYNAMICZNY i tylko na natywnym — web build czysty.

import { Capacitor } from "@capacitor/core";
import { fetchTimeout } from "./http";
import { currentBuild, isNewer } from "./updater";

const REPO = "Talent620/Jarvis";
const MANIFEST_URL = `https://github.com/${REPO}/releases/download/latest/bundle.json`;

export function liveUpdateSupported(): boolean {
  return Capacitor.isNativePlatform?.() === true;
}

export interface LiveManifest {
  version: string; // etykieta buildu (np. „2026-06-25 12:00")
  iso: string; // czas buildu ISO (do porównania nowości)
  url: string; // bezpośredni link do web-bundle.zip
}

export interface LiveCheck {
  available: boolean;
  version?: string;
  manifest?: LiveManifest;
  error?: string;
}

/** Sprawdź, czy jest nowszy web-bundle (OTA). Tylko w aplikacji natywnej (Android/iOS). */
export async function checkLiveUpdate(): Promise<LiveCheck> {
  if (!liveUpdateSupported()) {
    return { available: false, error: "Aktualizacja błyskawiczna działa tylko w aplikacji na telefonie." };
  }
  try {
    const res = await fetchTimeout(`${MANIFEST_URL}?t=${Date.now()}`, {}, 15000);
    if (!res.ok) return { available: false, error: `Brak manifestu OTA (${res.status}).` };
    const m = (await res.json()) as LiveManifest;
    if (!m?.url || !m?.iso) return { available: false, error: "Niepoprawny manifest OTA." };
    return { available: isNewer(currentBuild(), m.iso), version: m.version, manifest: m };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Pobierz i zastosuj web-bundle — przeładuje aplikację do nowej wersji (bez instalatora). */
export async function applyLiveUpdate(m: LiveManifest): Promise<{ ok: boolean; error?: string }> {
  if (!liveUpdateSupported()) return { ok: false, error: "Tylko w aplikacji na telefonie." };
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    const bundle = await CapacitorUpdater.download({ url: m.url, version: m.version });
    await CapacitorUpdater.set({ id: bundle.id }); // aktywuje + przeładowuje do nowej paczki
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * KRYTYCZNE: po starcie potwierdza wtyczce, że bieżąca paczka DZIAŁA. Bez tego wtyczka uzna
 * paczkę za wadliwą i cofnie ją przy następnym uruchomieniu (bezpiecznik anti-brick). No-op na web.
 */
export async function notifyLiveUpdateReady(): Promise<void> {
  if (!liveUpdateSupported()) return;
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    await CapacitorUpdater.notifyAppReady();
  } catch {
    /* brak wtyczki / starsze APK — pomiń łagodnie */
  }
}
