import { store } from "./store";
import { fetchTimeout } from "./http";

// === n8n — warstwa wykonawcza („agenci robią rzeczy") ===
// JARVIS wysyła zlecenie HTTP-em na webhook n8n, a tam workflow REALNIE coś robi:
// outreach (maile/LinkedIn), deployment, research, integracje (WHOOP, finanse,
// CRM…). Zwrotka z n8n wraca do JARVIS-a jako wynik. To zamienia „rozmowę" w
// wykonanie. Konfiguracja: adres webhooka (+ opcjonalny token) w ⚙ → Integracje.

export interface AutomationResult {
  ok: boolean;
  result?: string;
  error?: string;
}

/** Odpal automatyzację n8n. `action` to nazwa zadania, `details` — dane/parametry. */
export async function runAutomation(action: string, details?: unknown): Promise<AutomationResult> {
  const url = store.settings.n8nUrl?.trim();
  if (!url) return { ok: false, error: "Brak adresu n8n — dodaj webhook w ⚙ → Integracje (n8n)." };
  const token = store.settings.n8nToken?.trim();
  try {
    const res = await fetchTimeout(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ source: "jarvis", action, details: details ?? null, at: Date.now() }),
    }, 20000);
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* zwykły tekst */ }
    if (!res.ok) return { ok: false, error: parsed?.error || `n8n zwrócił błąd (${res.status}).` };
    const result = parsed?.result ?? parsed?.message ?? (typeof parsed === "string" ? parsed : text) ?? "Wykonano.";
    return { ok: true, result: String(result).slice(0, 2000) };
  } catch (e) {
    return { ok: false, error: `Brak połączenia z n8n: ${e instanceof Error ? e.message : e}` };
  }
}

/** Czy warstwa wykonawcza jest skonfigurowana. */
export const automationReady = (): boolean => !!store.settings.n8nUrl?.trim();
