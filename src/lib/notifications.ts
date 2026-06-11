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
export async function scheduleTimer(minutes: number, label?: string): Promise<void> {
  // Model może podać śmieci (NaN/ujemne) — wymuś sensowny zakres, inaczej
  // new Date(NaN) dałby nieważny termin i powiadomienie nigdy nie przyjdzie.
  const mins = Math.max(0.1, Number(minutes) || 1);
  const at = new Date(Date.now() + mins * 60_000);
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
  }, mins * 60_000);
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
