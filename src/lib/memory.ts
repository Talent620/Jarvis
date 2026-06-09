import { store, uid } from "./store";
import type { MemoryFact } from "../types";

// === Pamięć autonomiczna (semantyczna) ===
// Fakty o użytkowniku są indeksowane wektorami (Gemini text-embedding-004) i
// pobierane przez podobieństwo kosinusowe do bieżącego zapytania — dzięki temu
// JARVIS przypomina sobie TO, co istotne, a nie po prostu ostatnie 25 wpisów.
// Gdy embeddingi są niedostępne (brak klucza Gemini i proxy), płynnie wracamy
// do trybu świeżości (przypięte + najnowsze).

const MAX_FACTS = 25; // budżet faktów wstrzykiwanych do promptu
const MAX_STORED = 300; // twardy limit pamięci (chroni przed nieograniczonym wzrostem)

// --- Embeddingi ---

let embedDisabled = false; // ustawiane, gdy brak źródła embeddingów (jednorazowo)

/** Zwraca wektory dla listy tekstów (Gemini bezpośrednio lub przez proxy) albo null. */
async function embedBatch(texts: string[]): Promise<number[][] | null> {
  if (embedDisabled || !texts.length) return null;
  const key = store.settings.keys.gemini?.trim();
  const proxy = store.settings.proxyUrl?.trim();
  try {
    if (key) {
      const out: number[][] = [];
      for (const t of texts) {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: "models/text-embedding-004", content: { parts: [{ text: t }] } }),
          },
        );
        if (!r.ok) throw new Error(`embed ${r.status}`);
        const d = await r.json();
        out.push(d?.embedding?.values || []);
      }
      return out;
    }
    if (proxy) {
      const r = await fetch(`${proxy.replace(/\/$/, "")}/v1/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ texts }),
      });
      if (!r.ok) throw new Error(`embed ${r.status}`);
      const d = await r.json();
      return Array.isArray(d?.vectors) ? d.vectors : null;
    }
  } catch {
    return null; // chwilowy błąd — spróbujemy ponownie później
  }
  embedDisabled = true; // brak jakiegokolwiek źródła embeddingów
  return null;
}

async function embedText(text: string): Promise<number[] | null> {
  const v = await embedBatch([text]);
  return v?.[0]?.length ? v[0] : null;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  const na = Math.sqrt(dot(a, a));
  const nb = Math.sqrt(dot(b, b));
  return na && nb ? dot(a, b) / (na * nb) : 0;
}

// --- Indeksowanie (uzupełnianie brakujących wektorów w tle) ---

let indexing = false;

/** Dolicza wektory dla faktów, które ich jeszcze nie mają. Bezpieczne do wołania „w tle". */
export async function ensureIndexed(): Promise<void> {
  if (indexing || embedDisabled) return;
  const pending = store.data.memory.filter((m) => !m.embedding?.length);
  if (!pending.length) return;
  indexing = true;
  try {
    const vecs = await embedBatch(pending.map((m) => `${m.key}: ${m.value}`));
    if (!vecs) return;
    store.setData((d) => {
      for (let i = 0; i < pending.length; i++) {
        const f = d.memory.find((x) => x.id === pending[i].id);
        if (f && vecs[i]?.length) f.embedding = vecs[i];
      }
    });
  } finally {
    indexing = false;
  }
}

// --- Zapis faktu (z unieważnieniem wektora + reindeksacją) ---

/** Zapamiętaj/zaktualizuj fakt; po zmianie treści wektor jest przeliczany w tle. */
export function rememberFact(key: string, value: string, projectId?: string): void {
  store.setData((d) => {
    const existing = d.memory.find((m) => m.key === key && (m.projectId || "") === (projectId || ""));
    if (existing) {
      if (existing.value !== value) {
        existing.value = value;
        existing.embedding = undefined; // treść się zmieniła — przelicz wektor
      }
    } else {
      d.memory.unshift({ id: uid(), key, value, projectId, createdAt: Date.now() });
    }
    // Twardy limit: usuń najstarsze, nieprzypięte fakty ponad próg.
    if (d.memory.length > MAX_STORED) {
      const keep = d.memory.filter((m) => m.pinned);
      const rest = d.memory
        .filter((m) => !m.pinned)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, Math.max(0, MAX_STORED - keep.length));
      d.memory = [...keep, ...rest].sort((a, b) => b.createdAt - a.createdAt);
    }
  });
  void ensureIndexed();
}

// --- Pobieranie trafnych faktów ---

function sortByFreshness(facts: MemoryFact[]): MemoryFact[] {
  return [...facts].sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.createdAt - a.createdAt,
  );
}

/**
 * Wybiera najtrafniejsze fakty dla zapytania. Przypięte zawsze wchodzą; resztę
 * dobiera podobieństwem semantycznym, a nieobjęte indeksem — świeżością.
 */
async function retrieve(query: string, pid: string): Promise<MemoryFact[]> {
  const all = store.data.memory.filter((m) => !m.projectId || m.projectId === pid);
  void ensureIndexed(); // uzupełnij indeks w tle (nie blokujemy odpowiedzi)
  if (all.length <= MAX_FACTS) return sortByFreshness(all);

  const qv = query.trim() ? await embedText(query) : null;
  if (!qv) return sortByFreshness(all).slice(0, MAX_FACTS);

  const pinned = all.filter((m) => m.pinned);
  const indexed = all.filter((m) => !m.pinned && m.embedding?.length);
  const unindexed = all.filter((m) => !m.pinned && !m.embedding?.length);
  indexed.sort((a, b) => cosine(qv, b.embedding!) - cosine(qv, a.embedding!));

  const result: MemoryFact[] = [...pinned];
  for (const m of indexed) {
    if (result.length >= MAX_FACTS) break;
    result.push(m);
  }
  for (const m of sortByFreshness(unindexed)) {
    if (result.length >= MAX_FACTS) break;
    result.push(m);
  }
  return result.slice(0, MAX_FACTS);
}

// --- Most do promptu (synchronicznego systemPrompt) ---

let cachedFacts: MemoryFact[] | null = null;

/** Przygotuj kontekst pamięci dla zapytania (wywołać przed systemPrompt). */
export async function prepareMemoryContext(query: string): Promise<void> {
  try {
    cachedFacts = await retrieve(query, store.settings.activeProjectId || "");
  } catch {
    cachedFacts = null; // fallback w memoryBlock()
  }
}

/** Sformatowany blok faktów do wstrzyknięcia w prompt (semantyczny lub świeżościowy). */
export function memoryBlock(): string {
  const pid = store.settings.activeProjectId || "";
  const facts =
    cachedFacts ??
    sortByFreshness(store.data.memory.filter((m) => !m.projectId || m.projectId === pid)).slice(0, MAX_FACTS);
  if (!facts.length) return "";
  return "\n\nZapamiętane fakty o użytkowniku:\n" + facts.map((m) => `- ${m.key}: ${m.value}`).join("\n");
}
