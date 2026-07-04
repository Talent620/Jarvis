// === Dynamiczny follow-up rozumowany przez AI (Revenue OS #1) ===
// Zamiast 3 sztywnych szablonów: każdy kolejny follow-up pisany NA NOWO z kontekstu leada (firma,
// branża, strona, słabe punkty z wywiadu, poprzednia wiadomość, dni od kontaktu, numer próby).
// Inny kąt za każdym razem, naturalny, bez nachalności. Przy błędzie/braku mózgu — czytelny fallback
// na deterministyczny szablon (followUpMessage), więc funkcja NIGDY nie zostawia użytkownika bez treści.

import { askModel } from "./brain";
import { store } from "./store";
import { followUpMessage } from "./salesEngine";
import type { Lead } from "../types";

const FOLLOWUP_SYSTEM = [
  "Jesteś ekspertem od skutecznego, kulturalnego cold outreach B2B w Polsce. Piszesz FOLLOW-UP (ponaglenie).",
  "ZASADY:",
  "- 50–110 słów, naturalny język polski, bez szablonowości — to NIE ma brzmieć jak masowy mail.",
  "- Każda kolejna próba ma INNY kąt: nawiąż do kontekstu firmy (np. coś z ich strony / branży), nie powtarzaj poprzedniej wiadomości.",
  "- Jeden konkretny powód kontaktu TERAZ + jedno jasne, łatwe pytanie/CTA (np. propozycja 10 min albo podgląd dema).",
  "- Ton uprzejmy, lekki, bez presji i bez nachalności; zero słów-wyzwalaczy spamu i CAPSów.",
  "- Przy OSTATNIEJ próbie: elegancko zamknij wątek, zostaw otwarte drzwi, bez wyrzutów.",
  "- Zwróć WYŁĄCZNIE treść maila (z podpisem na końcu, jeśli podano imię). Bez tematu, bez komentarzy, bez markdownu.",
].join("\n");

/** Pure: złóż kontekst leada dla modelu (testowalne; bez sieci). */
export function followUpContext(lead: Lead, attempt: number, now = Date.now()): string {
  const days = lead.lastContactedAt ? Math.round((now - lead.lastContactedAt) / 86_400_000) : null;
  const prev = (lead.intel?.email || lead.offer || "").trim().slice(0, 600);
  const me = store.settings.userName && store.settings.userName !== "Sir" ? store.settings.userName : "";
  const last = attempt >= 3;
  return [
    `Firma: ${lead.company}`,
    lead.niche ? `Branża: ${lead.niche}` : "",
    lead.location ? `Lokalizacja: ${lead.location}` : "",
    lead.url ? `Strona: ${lead.url}` : "",
    lead.intel?.analysis ? `Słabe punkty / co tracą (z wywiadu):\n${lead.intel.analysis.slice(0, 500)}` : "",
    `Numer próby follow-upu: ${attempt}${last ? " — to OSTATNIA próba: elegancko zamknij wątek." : ""}`,
    days != null ? `Dni od ostatniego kontaktu: ${days}` : "",
    prev ? `Poprzednia wysłana wiadomość (nawiąż, NIE powtarzaj):\n${prev}` : "",
    me ? `Podpisz się imieniem: ${me}` : "Podpis: „Pozdrawiam” (bez imienia).",
    "Napisz teraz najlepszy możliwy follow-up.",
  ].filter(Boolean).join("\n");
}

/** Napisz follow-up rozumowany przez AI; przy błędzie/braku mózgu — fallback na szablon. */
export async function draftFollowUpAI(lead: Lead, attempt: number): Promise<string> {
  try {
    const reply = await askModel({ system: FOLLOWUP_SYSTEM, history: [{ role: "user", content: followUpContext(lead, attempt) }] });
    const t = (reply || "").trim();
    return t.length >= 30 ? t : followUpMessage(lead, attempt);
  } catch {
    return followUpMessage(lead, attempt);
  }
}
