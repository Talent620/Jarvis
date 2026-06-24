// === Asystent edycji zdjęć — „zrozum i dopytaj, zanim wydasz kasę" ===
// Płatne modele (fal.ai) kosztują ~$0.04–0.08 za obraz, więc szkoda generować na ślepo.
// Tu DARMOWY mózg (askModel — sam tekst) zamienia polecenie po polsku na precyzyjny prompt po
// angielsku (modele edycji rozumieją go lepiej) albo — gdy polecenie jest niejasne — zadaje JEDNO
// pytanie. Dopiero po potwierdzeniu odpalamy płatną generację. Czyste, łatwe do testów.

import { askModel } from "./brain";

export interface EditPlan {
  ready: boolean; // true → mamy gotowy prompt; false → trzeba dopytać
  prompt?: string; // angielski prompt edycji (gdy ready)
  summary?: string; // 1 zdanie po polsku: co zrobię (gdy ready)
  question?: string; // jedno pytanie po polsku (gdy !ready)
}

/** Wytnij pierwszy obiekt JSON z odpowiedzi modelu (modele lubią dokleić tekst). */
function extractJson(s: string): Record<string, unknown> | null {
  const m = (s || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Zinterpretuj polecenie edycji. Zwraca gotowy prompt ALBO jedno pytanie doprecyzowujące.
 * Przy błędzie/braku JSON-a NIE blokuje — zwraca polecenie wprost (ready), by nie utknąć.
 */
export async function refineEdit(instruction: string, hasImage: boolean): Promise<EditPlan> {
  const sys = [
    `Jesteś asystentem EDYCJI ZDJĘĆ. Użytkownik chce edytować ${hasImage ? "DOŁĄCZONE zdjęcie" : "obraz z opisu"}.`,
    `Zamień jego polecenie (po polsku, potoczne) na DOBRY prompt dla modelu edycji obrazu PO ANGIELSKU.`,
    `Stosuj zasady (z oficjalnych wytycznych edytorów typu Nano Banana / FLUX Kontext):`,
    `1) ZACHOWANIE: nie opisuj sceny od nowa — wyraźnie napisz, co ZOSTAWIĆ bez zmian ("keep everything else unchanged"), a tylko opisz ZMIANĘ.`,
    `2) REALIZM: poproś o dopasowanie światła, cieni, faktury, perspektywy; "photorealistic, seamless, no visible editing".`,
    `3) TEKST: jeśli zmiana dotyczy napisu, podaj DOKŁADNĄ nową treść w cudzysłowie i poproś o tę samą czcionkę, rozmiar, kolor, pochylenie i perspektywę co oryginał.`,
    `4) JEDNA RZECZ: jeśli użytkownik prosi o KILKA zmian naraz (np. „wysuń papierosy ORAZ zamień napis"), wykonaj prompt na PIERWSZĄ, a w "summary" zaznacz po polsku, że resztę najlepiej zrobić osobno przez „Edytuj dalej".`,
    `Jeśli polecenie jest NIEJASNE i bez doprecyzowania wynik byłby losowy (np. nie wiadomo: jaki kolor, jaka dokładnie treść tekstu, którego z elementów dotyczy, ile sztuk) — zadaj JEDNO krótkie pytanie po polsku zamiast zgadywać.`,
    `Odpowiedz WYŁĄCZNIE JSON-em, bez tekstu wokół:`,
    `• gdy jasne: {"ready":true,"prompt":"<angielski prompt edycji>","summary":"<jedno zdanie po polsku: co zrobię (i ew. że resztę zrób osobno)>"}`,
    `• gdy niejasne: {"ready":false,"question":"<jedno pytanie po polsku>"}`,
  ].join("\n");
  try {
    const txt = await askModel({ system: sys, history: [{ role: "user", content: instruction }] });
    const j = extractJson(txt || "");
    if (!j || typeof j.ready !== "boolean") return { ready: true, prompt: instruction };
    return {
      ready: j.ready as boolean,
      prompt: typeof j.prompt === "string" ? j.prompt : undefined,
      summary: typeof j.summary === "string" ? j.summary : undefined,
      question: typeof j.question === "string" ? j.question : undefined,
    };
  } catch {
    return { ready: true, prompt: instruction }; // w razie błędu nie blokuj — generuj wprost
  }
}
