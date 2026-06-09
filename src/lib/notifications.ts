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
