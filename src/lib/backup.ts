import { store } from "./store";
import type { AppData, Settings } from "../types";

// Eksport/import danych (kopia zapasowa). Nie zawiera kluczy API — tylko Twoje dane.
const COLLECTIONS: (keyof AppData)[] = [
  "tasks", "notes", "reminders", "shopping", "calendar",
  "memory", "scenes", "projects", "projectFiles", "tally", "journal", "leads",
];

export function exportData(): void {
  // Tylko realne dane użytkownika (bez kluczy, bez audytu) — bezpieczny do dzielenia.
  const payload = { app: "jarvis", version: 1, exportedAt: Date.now(), data: dataDump() };
  download(payload, `jarvis-backup-${new Date().toISOString().slice(0, 10)}.json`);
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
        const parsed = JSON.parse(await f.text());
        const d = (parsed.data ?? parsed) as Record<string, unknown>;
        store.setData((s) => {
          for (const c of COLLECTIONS) if (Array.isArray(d[c])) (s as any)[c] = d[c];
        });
        // Pełna kopia może też nieść ustawienia (klucze API itp.) — przywróć i je.
        if (parsed.settings && typeof parsed.settings === "object") {
          store.setSettings(parsed.settings as Partial<Settings>);
        }
        resolve(parsed.settings ? "✅ Przywrócono dane i ustawienia (klucze API) z kopii." : "✅ Dane przywrócone z kopii.");
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
      ? (store.data.memory || []).map(({ embedding, ...rest }) => rest)
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

/**
 * PEŁNA kopia: dane + WSZYSTKIE ustawienia, łącznie z kluczami API. Plik jest
 * wrażliwy (zawiera klucze) — trzymaj go w bezpiecznym miejscu. Pozwala odtworzyć
 * całego JARVIS-a 1:1 po reinstalacji lub na nowym urządzeniu, bez ponownego
 * wklejania kluczy i przestawiania opcji.
 */
export function exportFull(): void {
  const payload = {
    app: "jarvis",
    kind: "full",
    version: 1,
    exportedAt: Date.now(),
    data: dataDump(),
    settings: store.settings,
  };
  download(payload, `jarvis-PELNA-kopia-${new Date().toISOString().slice(0, 10)}.json`);
}
