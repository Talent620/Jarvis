import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
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
  try {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
  } catch {
    /* ignore */
  }
}

// Minutnik — powiadomienie za N minut.
export async function scheduleTimer(minutes: number, label?: string): Promise<void> {
  const at = new Date(Date.now() + Math.max(0.1, minutes) * 60_000);
  const body = label ? `Minutnik: ${label}` : "Minęło " + minutes + " min.";
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
  // Web/desktop: prosty fallback w przeglądarce.
  setTimeout(() => {
    try {
      if ("Notification" in window && Notification.permission === "granted") new Notification("JARVIS — minutnik", { body });
    } catch {
      /* ignore */
    }
  }, Math.max(100, minutes * 60_000));
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
