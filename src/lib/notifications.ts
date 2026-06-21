import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { desktopNotify } from "./desktop";
import type { Reminder } from "../types";

// Stabilny dodatni int z tekstowego id (wymagane przez LocalNotifications).
function intId(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (Math.abs(h) % 2_000_000_000) || 1;
}

export async function ensureNotifPerms(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const p = await LocalNotifications.checkPermissions();
    if (p.display !== "granted") await LocalNotifications.requestPermissions();
  } catch {
    /* brak wsparcia — ignoruj */
  }
}

// Natychmiastowe powiadomienie systemowe (działa też przy zminimalizowanej apce).
export async function notify(title: string, body: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await LocalNotifications.schedule({
        notifications: [{ id: (Date.now() % 2_000_000_000) || 1, title, body, smallIcon: "ic_launcher_foreground" }],
      });
      return;
    } catch {
      /* fallback do web */
    }
  }
  // Windows (.exe): natywne powiadomienie systemowe — działa też przy zminimalizowanym oknie.
  if (await desktopNotify(title, body)) return;
  try {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
  } catch {
    /* ignore */
  }
}

// Minutnik — powiadomienie za N minut.
/**
 * Pure: minuty minutnika → bezpieczne ms. Model bywa śmieciowy (NaN/0/UJEMNE) — wszystkie te
 * przypadki dają domyślną 1 min (a nie 6 s jak dawniej, bo Number(-5)||1 = -5 przechodziło przez ||).
 * Dolny limit 0.1 min (6 s), górny ~24 dni (setTimeout > 2^31-1 ms przepełnia się i odpala od razu).
 */
export function timerMs(minutes: number): number {
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 1;
  return Math.min(2_147_483_647, Math.max(0.1, safe) * 60_000);
}

export async function scheduleTimer(minutes: number, label?: string): Promise<void> {
  const ms = timerMs(minutes);
  const mins = ms / 60_000;
  const at = new Date(Date.now() + ms);
  const body = label ? `Minutnik: ${label}` : `Minęło ${mins} min.`;
  if (Capacitor.isNativePlatform()) {
    try {
      await LocalNotifications.schedule({
        notifications: [{ id: (Date.now() % 2_000_000_000) || 1, title: "JARVIS — minutnik", body, schedule: { at } }],
      });
      return;
    } catch {
      /* fallback */
    }
  }
  // Web/desktop: po upływie czasu pokaż powiadomienie (Windows natywne lub web).
  setTimeout(async () => {
    if (await desktopNotify("JARVIS — minutnik", body)) return;
    try {
      if ("Notification" in window && Notification.permission === "granted") new Notification("JARVIS — minutnik", { body });
    } catch {
      /* ignore */
    }
  }, ms);
}

// Zaplanuj natywne powiadomienie dla przypomnienia (na urządzeniu).
export async function scheduleReminder(r: Reminder): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const at = new Date(r.at);
  if (isNaN(at.getTime()) || at.getTime() <= Date.now()) return;
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: intId(r.id),
          title: "JARVIS",
          body: r.text,
          schedule: { at },
          smallIcon: "ic_launcher_foreground",
        },
      ],
    });
  } catch {
    /* ignoruj */
  }
}
