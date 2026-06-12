// Blokada wygaszania ekranu — by „Tryb Słuchawki" działał z telefonem w kieszeni
// (na OLED czarny ekran prawie nie zużywa baterii). Sam reaktywuje się po powrocie
// do aplikacji. Tam, gdzie API niedostępne (część WebView), po cichu nie robi nic.

let lock: any = null;

async function acquire(): Promise<void> {
  try {
    lock = await (navigator as any).wakeLock?.request("screen");
    lock?.addEventListener?.("release", () => {
      lock = null;
    });
  } catch {
    lock = null;
  }
}

function onVisible(): void {
  if (document.visibilityState === "visible" && !lock) void acquire();
}

export async function keepAwake(): Promise<void> {
  await acquire();
  document.addEventListener("visibilitychange", onVisible);
}

export function releaseAwake(): void {
  try {
    document.removeEventListener("visibilitychange", onVisible);
    lock?.release?.();
  } catch {
    /* ignore */
  }
  lock = null;
}
