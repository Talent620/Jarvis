import { store } from "./store";

// Wybór mikrofonu. JARVIS domyślnie bierze SYSTEMOWY domyślny mikrofon (getUserMedia bez
// deviceId). Przy słuchawkach Bluetooth Windows lubi trzymać inny domyślny niż zestaw —
// wtedy JARVIS „nie słyszy". Tu pozwalamy przypiąć konkretne wejście (deviceId) z ustawień.
//
// Używamy `ideal` (a nie `exact`): JARVIS mocno preferuje wybrane urządzenie, ale gdy je
// odłączysz (typowe dla BT), płynnie wróci do domyślnego zamiast rzucić błąd.

/** Łączy bazowe ograniczenia audio z wybranym w ustawieniach mikrofonem (deviceId).
 *  Pusty wybór = systemowy domyślny (zachowanie jak dotąd, bez zmian). */
export function micAudioConstraints(
  base: MediaTrackConstraints | true = true,
): MediaStreamConstraints["audio"] {
  const id = store.settings.micDeviceId;
  if (!id) return base; // brak wyboru → nic nie dokładamy (zgodność wsteczna)
  const b: MediaTrackConstraints = base === true ? {} : { ...base };
  b.deviceId = { ideal: id };
  return b;
}

/** Lista dostępnych mikrofonów (audioinput). Etykiety bywają puste, dopóki nie ma zgody
 *  na mikrofon — wtedy najpierw wywołaj ensureMicPermission(). */
export async function listMics(): Promise<MediaDeviceInfo[]> {
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices) return [];
  try {
    const devs = await md.enumerateDevices();
    return devs.filter((d) => d.kind === "audioinput");
  } catch {
    return [];
  }
}

/** Krótko otwiera mikrofon, by przeglądarka odblokowała etykiety urządzeń, po czym go zwalnia.
 *  Zwraca true, gdy zgoda jest. Bezpieczne do wywołania przed listMics() w ustawieniach. */
export async function ensureMicPermission(): Promise<boolean> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) return false;
  try {
    const s = await md.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}
