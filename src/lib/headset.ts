// Wykrywanie słuchawek BT (tryb głosowy bez patrzenia). Etykiety urządzeń są
// dostępne dopiero po przyznaniu uprawnień do mikrofonu — bez nich cicho nic
// nie robimy (prywatność + zero fałszywych alarmów).

const HEADSET_RE = /bluetooth|headset|headphone|airpods|earbuds|buds|wh-?\d|wf-?\d|hands-?free|słuchawk/i;

/** Czy etykieta urządzenia audio wygląda na słuchawki/zestaw BT? */
export function isHeadsetLabel(label: string): boolean {
  return HEADSET_RE.test(label || "");
}

/**
 * Nasłuch podłączenia słuchawek: woła onConnect przy NOWYM zestawie (nie przy
 * tych podłączonych od startu). Zwraca funkcję sprzątającą.
 */
export function watchHeadset(onConnect: () => void): () => void {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!md?.enumerateDevices || !md?.addEventListener) return () => {};

  let known = new Set<string>();
  let primed = false;

  const scan = async (fire: boolean) => {
    try {
      const devs = await md.enumerateDevices();
      const present = new Set(
        devs.filter((d) => (d.kind === "audioinput" || d.kind === "audiooutput") && isHeadsetLabel(d.label)).map((d) => d.deviceId || d.label),
      );
      if (fire && primed) {
        for (const id of present) {
          if (!known.has(id)) {
            onConnect();
            break;
          }
        }
      }
      known = present;
      primed = true;
    } catch {
      /* enumeracja niedostępna */
    }
  };

  void scan(false); // baza startowa
  const handler = () => void scan(true);
  md.addEventListener("devicechange", handler);
  return () => md.removeEventListener("devicechange", handler);
}
