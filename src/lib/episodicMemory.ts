// Faza 7 — pamięć epizodyczna.
// Lekki dziennik zdarzeń (epizodów): o czym i kiedy była mowa / co się wydarzyło.
// Różni się od pamięci semantycznej (fakty) i długoterminowej (Mem0): tu liczy się
// CZAS i POWTARZALNOŚĆ — to z tego wyłaniamy wzorce do proaktywności (Faza 7).
// Czyste funkcje + cienka warstwa trwałości w localStorage.

export type EpisodeKind = "chat" | "tool" | "task" | "event";

export interface Episode {
  at: number;
  kind: EpisodeKind;
  topic: string; // krótki opis (np. fragment wiadomości użytkownika)
  ref?: string; // opcjonalne id powiązanego obiektu
}

const KEY = "jarvis.episodes.v1";
const MAX = 500;
const DAY = 86_400_000;

// Słowa pomijane przy wyłuskiwaniu tematów (PL + ogólne).
const STOP = new Set([
  "jest", "tego", "tych", "która", "który", "które", "żeby", "jako", "oraz", "albo", "lub",
  "czy", "dla", "nie", "tak", "ale", "bym", "być", "mam", "masz", "może", "można", "jak",
  "co", "to", "na", "do", "od", "za", "ze", "we", "po", "przy", "bez", "pod", "nad", "the",
  "and", "for", "with", "you", "your", "jarvis", "proszę", "dziękuję", "mi", "mnie", "się",
]);

/** Zredukuj tekst do krótkiego „tematu" epizodu (do 80 znaków, jedna linia). */
export function topicOf(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Wyłuskaj znaczące słowa-klucze z tematu (do liczenia wzorców). */
export function keywords(topic: string): string[] {
  return (topic || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

export function episodesWithin(episodes: Episode[], sinceMs: number): Episode[] {
  return episodes.filter((e) => e.at >= sinceMs);
}

export function recentEpisodes(episodes: Episode[], n: number): Episode[] {
  return episodes.slice(0, n);
}

export interface TopicCount {
  word: string;
  count: number;
}

/** Najczęstsze słowa-klucze w danym oknie czasu (malejąco). */
export function topTopics(episodes: Episode[], sinceMs: number, limit = 5): TopicCount[] {
  const freq = new Map<string, number>();
  for (const e of episodesWithin(episodes, sinceMs)) {
    for (const w of keywords(e.topic)) freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Tematy „powracające, ale ostatnio porzucone": często wzmiankowane w ostatnich 30 dniach
 * (≥ minCount), lecz nieobecne w ostatnich `quietDays` dniach — kandydaci do przypomnienia.
 */
export function staleRecurringTopics(
  episodes: Episode[],
  now = Date.now(),
  minCount = 3,
  quietDays = 4,
): string[] {
  const monthly = topTopics(episodes, now - 30 * DAY, 20).filter((t) => t.count >= minCount);
  const recentWords = new Set<string>();
  for (const e of episodesWithin(episodes, now - quietDays * DAY)) {
    for (const w of keywords(e.topic)) recentWords.add(w);
  }
  return monthly.filter((t) => !recentWords.has(t.word)).map((t) => t.word);
}

// --- Trwałość ---

export function loadEpisodes(): Episode[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(list: Episode[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* brak miejsca — pamięć epizodyczna nie może wywrócić aplikacji */
  }
}

/** Dopisz epizod (najnowsze pierwsze, z capem). Pomija pusty temat. */
export function recordEpisode(kind: EpisodeKind, topic: string, ref?: string): void {
  const t = topicOf(topic);
  if (!t) return;
  const all = loadEpisodes();
  all.unshift({ at: Date.now(), kind, topic: t, ...(ref ? { ref } : {}) });
  save(all);
}

export function clearEpisodes(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
