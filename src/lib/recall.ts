// === 🔎 Recall — przeszukaj CAŁE swoje życie w JARVISIE (lokalnie) ===
// Jedno pole znajduje rzeczy w historii czatów, dzienniku, pamięci, zadaniach, leadach, projektach
// i notatkach. Ranking hybrydowy (leksyka + świeżość) — natychmiastowy, bez sieci, bez wysyłania
// danych. To przewaga, której ChatGPT/Gemini nie mają: Twoje dane są zindeksowane TYLKO u Ciebie.
import { store } from "./store";
import { loadChats } from "./chats";
import { keywordScore } from "./rag";

export type RecallType = "Czat" | "Dziennik" | "Pamięć" | "Zadanie" | "Lead" | "Projekt" | "Notatka";

export interface RecallItem { id: string; type: RecallType; title: string; text: string; at?: number; openId?: string }
export interface RecallHit extends RecallItem { score: number }

const DAY = 86_400_000;

/**
 * Pure: ranking trafień w zebranych elementach. Trafność leksykalna (słowa zapytania) spleciona z
 * łagodną świeżością (zanik ~120 dni). Pusty query → []. Deterministyczny i szybki.
 */
export function recallSearch(query: string, items: RecallItem[], now = Date.now(), limit = 40): RecallHit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const out: RecallHit[] = [];
  for (const it of items) {
    const rel = keywordScore(q, `${it.title} ${it.text}`);
    if (rel <= 0) continue;
    const recency = it.at ? Math.exp(-((now - it.at) / DAY) / 120) : 0;
    out.push({ ...it, score: rel * 0.85 + recency * 0.15 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

const snip = (s: string, n = 200) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);

/** Zbierz wszystkie przeszukiwalne elementy ze stanu (czat z localStorage + dane store). */
export function gatherRecallItems(): RecallItem[] {
  const d = store.data;
  const items: RecallItem[] = [];
  // Historia czatów — jeden wpis na rozmowę (tytuł + sklejona treść).
  for (const s of loadChats()) {
    const body = (s.messages || []).map((m) => m.text).filter(Boolean).join(" ");
    items.push({ id: `chat:${s.id}`, type: "Czat", title: s.title || "Rozmowa", text: snip(body, 600), at: s.updatedAt, openId: s.id });
  }
  for (const j of d.journal || []) items.push({ id: `jrn:${j.id}`, type: "Dziennik", title: j.title || "Wpis", text: snip(`${j.body} ${(j.tags || []).join(" ")}`), at: j.createdAt });
  for (const m of d.memory || []) items.push({ id: `mem:${m.id}`, type: "Pamięć", title: m.key, text: snip(m.value), at: m.createdAt });
  for (const t of d.tasks || []) items.push({ id: `tsk:${t.id}`, type: "Zadanie", title: t.title, text: snip(t.notes || ""), at: t.createdAt });
  for (const l of d.leads || []) items.push({ id: `led:${l.id}`, type: "Lead", title: l.company, text: snip(`${l.niche || ""} ${l.location || ""} ${l.note || ""}`), at: l.createdAt });
  for (const p of d.projects || []) items.push({ id: `prj:${p.id}`, type: "Projekt", title: p.name, text: snip(p.instructions), at: p.createdAt });
  for (const n of d.notes || []) items.push({ id: `nte:${n.id}`, type: "Notatka", title: snip(n.text, 60), text: snip(n.text), at: n.createdAt });
  return items;
}

/** Wyszukaj wszędzie (zbiera + rankuje). */
export function recallEverything(query: string, limit = 40): RecallHit[] {
  return recallSearch(query, gatherRecallItems(), Date.now(), limit);
}

/**
 * 🧲 Anticipatory recall — „masz to już u siebie". Gdy to, co właśnie piszesz, MOCNO
 * pokrywa się z czymś z Twojej historii, zwróć to jedno trafienie (inaczej null).
 * Wymóg mocnego dopasowania (≥60% słów zapytania i ≥2 dłuższe słowa) trzyma to cicho:
 * nie wyskakuje na powitaniach ani luźnych pytaniach, tylko gdy naprawdę coś masz.
 * Pure: można podać własną pulę elementów (np. w testach).
 */
export function anticipate(query: string, items?: RecallItem[], now = Date.now()): RecallHit | null {
  const meaningful = query.trim().split(/\s+/).filter((w) => w.length >= 4);
  if (meaningful.length < 2) return null;
  const hits = recallSearch(query, items ?? gatherRecallItems(), now, 3);
  if (!hits.length) return null;
  const top = hits[0];
  const rel = keywordScore(query, `${top.title} ${top.text}`);
  return rel >= 0.6 ? top : null;
}
