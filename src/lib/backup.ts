import { store } from "./store";
import type { AppData } from "../types";

// Eksport/import danych (kopia zapasowa). Nie zawiera kluczy API — tylko Twoje dane.
const COLLECTIONS: (keyof AppData)[] = [
  "tasks", "notes", "reminders", "shopping", "calendar",
  "memory", "scenes", "projects", "projectFiles", "tally",
];

export function exportData(): void {
  // Tylko realne dane użytkownika (bez audytu); wektory pamięci pomijamy —
  // odtworzą się automatycznie po imporcie i niepotrzebnie powiększają plik.
  const data: Record<string, unknown> = {};
  for (const c of COLLECTIONS) {
    data[c] = c === "memory"
      ? (store.data.memory || []).map(({ embedding, ...rest }) => rest)
      : store.data[c];
  }
  const payload = { app: "jarvis", version: 1, exportedAt: Date.now(), data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jarvis-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
        resolve("✅ Dane przywrócone z kopii.");
      } catch {
        resolve("❌ Nieprawidłowy plik kopii.");
      }
    };
    input.click();
  });
}
