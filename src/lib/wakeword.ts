import { Capacitor, registerPlugin } from "@capacitor/core";

interface WakeWordPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
}

const WakeWord = registerPlugin<WakeWordPlugin>("WakeWord");

export const wakeSupported = () => Capacitor.isNativePlatform();

export async function startBackgroundWake(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await WakeWord.start();
  } catch {
    /* plugin niedostępny / brak uprawnień */
  }
}

export async function stopBackgroundWake(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await WakeWord.stop();
  } catch {
    /* ignore */
  }
}
