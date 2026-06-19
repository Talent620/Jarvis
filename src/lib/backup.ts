import { store } from "./store";
import { encryptText, decryptText } from "./cipher";
import type { AppData, Settings } from "../types";

// Eksport/import danych (kopia zapasowa). Trzy poziomy:
//  1) exportData — same dane (bez kluczy), bezpieczny do dzielenia;
//  2) exportFull — dane + ustawienia z kluczami (jawny JSON, wrażliwy);
//  3) exportFullEncrypted — pełna kopia zaszyfrowana AES-256-GCM hasłem —
//     bezpieczna nawet, gdy plik wpadnie w niepowołane ręce.
const COLLECTIONS: (keyof AppData)[] = [
  "tasks", "notes", "reminders", "shopping", "calendar",
  "memory", "scenes", "projects", "projectFiles", "tally", "journal", "leads", "flashcards",
  "bargainWatch", "sentMail", "contentPosts",
];

export function exportData(): void {
  // Tylko realne dane użytkownika (bez kluczy, bez audytu) — bezpieczny do dzielenia.
  const payload = { app: "jarvis", version: 1, exportedAt: Date.now(), data: dataDump() };
  download(payload, `jarvis-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

// Pola, które przekierowują ruch/pocztę — wstrzyknięte ze spreparowanej kopii mogłyby
// po cichu wyprowadzić klucze i maile na wrogi serwer. Wymagają potwierdzenia.
const ENDPOINT_KEYS = ["proxyUrl", "syncUrl", "salesOsUrl", "smtpHost", "homeAssistantUrl", "ollamaUrl", "n8nUrl"] as const;

/**
 * Odsiej importowane ustawienia: tylko znane klucze o pasującym typie; zmianę
 * adresów-endpointów dopuść jedynie po jawnym potwierdzeniu. Czysta, testowalna.
 */
export function sanitizeImportedSettings(
  raw: unknown,
  current: Settings,
  confirmEndpoints: (keys: string[]) => boolean,
): Partial<Settings> {
  if (!raw || typeof raw !== "object") return {};
  const cur = current as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in cur)) continue; // nieznany klucz — pomiń (anty-injection)
    const tc = typeof cur[k];
    // typ musi pasować (obiekty: object===object); null/undefined w bieżącym → akceptuj
    if (cur[k] != null && typeof v !== tc) {
      if (!(typeof v === "object" && tc === "object")) continue;
    }
    out[k] = v;
  }
  const changed = ENDPOINT_KEYS.filter(
    (k) => typeof out[k] === "string" && (out[k] as string).trim() && out[k] !== cur[k],
  );
  if (changed.length && !confirmEndpoints(changed)) {
    for (const k of changed) delete out[k]; // odrzuć podmianę adresów
  }
  return out as Partial<Settings>;
}

/** Zastosuj odczytaną kopię (dane i — przy pełnej — ustawienia). Zwraca komunikat. */
function applyParsed(parsed: any): string {
  // Zanim nadpiszemy dane — upewnij się, że to w ogóle kopia JARVIS-a. Inaczej wybór
  // przypadkowego pliku JSON mógłby po cichu wyczyścić/uszkodzić istniejące dane.
  const looksLikeBackup =
    parsed && typeof parsed === "object" &&
    (parsed.app === "jarvis" ||
      (parsed.data && typeof parsed.data === "object") ||
      COLLECTIONS.some((c) => Array.isArray((parsed as Record<string, unknown>)[c])));
  if (!looksLikeBackup) return "❌ To nie wygląda na kopię zapasową JARVIS-a — nic nie zmieniono.";
  const d = (parsed.data ?? parsed) as Record<string, unknown>;
  store.setData((s) => {
    for (const c of COLLECTIONS) if (Array.isArray(d[c])) (s as any)[c] = d[c];
  });
  if (parsed.settings && typeof parsed.settings === "object") {
    const safe = sanitizeImportedSettings(parsed.settings, store.settings, (keys) =>
      typeof window !== "undefined" &&
      window.confirm(`Kopia zmienia adresy serwerów: ${keys.join(", ")}.\nPrzywrócić je? To może przekierować ruch AI i pocztę na inny serwer.`),
    );
    store.setSettings(safe);
    return "✅ Przywrócono dane i ustawienia (klucze API) z kopii.";
  }
  return "✅ Dane przywrócone z kopii.";
}

export function importData(): Promise<string> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve("Anulowano.");
      try {
        const text = await f.text();
        const parsed = JSON.parse(text);
        // Kopia zaszyfrowana: poproś o hasło i odszyfruj zawartość.
        if (parsed?.kind === "full-encrypted" && typeof parsed.payload === "string") {
          const pass = window.prompt("Kopia jest zaszyfrowana. Podaj hasło:") || "";
          if (!pass) return resolve("Anulowano — nie podano hasła.");
          try {
            resolve(await unpackEncrypted(parsed.payload, pass));
          } catch {
            resolve("❌ Złe hasło albo uszkodzony plik kopii.");
          }
          return;
        }
        resolve(applyParsed(parsed));
      } catch {
        resolve("❌ Nieprawidłowy plik kopii.");
      }
    };
    input.click();
  });
}

// Zrzut danych (bez wektorów pamięci — odtworzą się po imporcie).
function dataDump(): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const c of COLLECTIONS) {
    data[c] = c === "memory"
      ? (store.data.memory || []).map(({ embedding: _embedding, ...rest }) => rest)
      : store.data[c];
  }
  return data;
}

function download(payload: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Pełny ładunek kopii: dane + wszystkie ustawienia (w tym klucze). */
export function buildFullPayload(): Record<string, unknown> {
  return {
    app: "jarvis",
    kind: "full",
    version: 1,
    exportedAt: Date.now(),
    data: dataDump(),
    settings: store.settings,
  };
}

/**
 * PEŁNA kopia (jawna): dane + WSZYSTKIE ustawienia, łącznie z kluczami API.
 * Plik jest wrażliwy — trzymaj go w bezpiecznym miejscu.
 */
export function exportFull(): void {
  download(buildFullPayload(), `jarvis-PELNA-kopia-${new Date().toISOString().slice(0, 10)}.json`);
}

/** Zaszyfruj pełny ładunek hasłem (AES-256-GCM + PBKDF2). Czysta funkcja — testowalna. */
export async function packEncrypted(payload: unknown, pass: string): Promise<string> {
  return encryptText(JSON.stringify(payload), pass);
}

/** Odszyfruj i zastosuj kopię. Rzuca przy złym haśle (GCM weryfikuje integralność). */
export async function unpackEncrypted(cipherPayload: string, pass: string): Promise<string> {
  const json = await decryptText(cipherPayload, pass);
  return applyParsed(JSON.parse(json));
}

/**
 * PEŁNA kopia ZASZYFROWANA: wszystko jak w exportFull, ale opakowane w AES-256
 * z Twoim hasłem. Bez hasła plik jest bezużyteczny — można go trzymać w chmurze.
 */
export async function exportFullEncrypted(pass: string): Promise<string> {
  const p = (pass || "").trim();
  if (p.length < 4) return "Hasło musi mieć co najmniej 4 znaki.";
  const payload = {
    app: "jarvis",
    kind: "full-encrypted",
    version: 1,
    exportedAt: Date.now(),
    payload: await packEncrypted(buildFullPayload(), p),
  };
  download(payload, `jarvis-SEJF-${new Date().toISOString().slice(0, 10)}.json`);
  return "✅ Zaszyfrowana kopia pobrana. Zapamiętaj hasło — bez niego nie da się jej odtworzyć.";
}
