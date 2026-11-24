import { store, uid } from "./store";
import { fetchTimeout, appTokenHeader } from "./http";
import { embedLocal, localEmbedUsable, LOCAL_EMBED_TAG } from "./localEmbed";
import { durability, memoryScore } from "./memoryScore";
import { mmrSelect, reciprocalRankFusion, keywordScore } from "./rag";
import { activeMemoryFacts, buildCoreMemoryBlock, invalidateConflictingFacts } from "./coreMemory";
import type { MemoryFact } from "../types";

// Tag modelu embeddingów — porównujemy tylko wektory z tego samego modelu (różne wymiary).
const CLOUD_EMBED_TAG = "cloud:gemini-004";
const OLLAMA_EMBED_TAG = "local:ollama-embed";

/** Czy preferować embeddingi on-device (ustawienie włączone + lokalny embedder użyteczny). */
function localEmbedOn(): boolean {
  return !!store.settings.localEmbeddings && localEmbedUsable();
}

/** Tag, którego embeddingów oczekujemy w tej chwili (do doboru, co reindeksować). */
function intendedEmbedTag(): string {
  if (localEmbedOn()) return LOCAL_EMBED_TAG;
  const s = store.settings;
  if ((!s.keys?.gemini?.trim() || s.onDeviceOnly) && s.ollamaUrl?.trim()) return OLLAMA_EMBED_TAG;
  return CLOUD_EMBED_TAG;
}

interface Embedded {
  vectors: number[][];
  tag: string;
}

// === Pamięć autonomiczna (semantyczna) ===
// Fakty o użytkowniku są indeksowane wektorami (Gemini text-embedding-004, Ollama embeddings lub
// on-device Transformers.js) i pobierane przez podobieństwo kosinusowe. Brak źródła lub chwilowy
// błąd NIGDY nie zatrzaskuje embeddingów na stałe — krótki backoff resetuje się od razu po zmianie konfiguracji.

const MAX_FACTS = 25; // budżet faktów wstrzykiwanych do promptu
const MAX_STORED = 300; // twardy limit pamięci (chroni przed nieograniczonym wzrostem)

// --- Embeddingi ---

let embedBackoffUntil = 0;
let lastEmbedConfigSig = "";
const EMBED_BACKOFF_MS = 30_000;

/** Zresetuj backoff embeddingów (np. w testach lub po zmianie klucza/Ollamy). */
export function resetEmbedBackoff(): void {
  embedBackoffUntil = 0;
  lastEmbedConfigSig = "";
}

function currentEmbedConfigSig(): string {
  const s = store.settings;
  return `${s.keys?.gemini || ""}|${s.ollamaUrl || ""}|${s.proxyUrl || ""}|${s.onDeviceOnly ? 1 : 0}`;
}

function isEmbedInBackoff(): boolean {
  const sig = currentEmbedConfigSig();
  if (sig !== lastEmbedConfigSig) {
    lastEmbedConfigSig = sig;
    embedBackoffUntil = 0; // zmiana klucza / Ollamy / proxy od razu odblokowuje embeddingi!
  }
  return Date.now() < embedBackoffUntil;
}

/** Embeddingi przez lokalną Ollamę (/api/embed lub /api/embeddings) — 0 USD, w pełni offline. */
async function embedOllama(endpoint: string, texts: string[]): Promise<number[][] | null> {
  const base = endpoint.replace(/\/+$/, "");
  const model = "nomic-embed-text";
  const { reportOutcome } = await import("./autocore/gateway");
  const t0 = Date.now();
  try {
    // 1) Nowszy batch endpoint Ollama >=0.2 (/api/embed)
    const rBatch = await fetchTimeout(`${base}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: texts }),
    }, 15000);
    if (rBatch.ok) {
      const d = await rBatch.json().catch(() => null);
      if (Array.isArray(d?.embeddings) && d.embeddings.length === texts.length && Array.isArray(d.embeddings[0]) && d.embeddings[0].length > 0) {
        reportOutcome("ollama", model, "local", true, { latencyMs: Date.now() - t0 });
        return d.embeddings as number[][];
      }
    }
    // 2) Klasyczny endpoint /api/embeddings (pojedynczy prompt)
    const out: number[][] = [];
    for (const t of texts) {
      const r = await fetchTimeout(`${base}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: t }),
      }, 15000);
      if (!r.ok) throw new Error(`ollama embed ${r.status}`);
      const d = await r.json();
      if (!Array.isArray(d?.embedding) || !d.embedding.length) return null;
      out.push(d.embedding);
    }
    reportOutcome("ollama", model, "local", true, { latencyMs: Date.now() - t0 });
    return out;
  } catch (e) {
    reportOutcome("ollama", model, "local", false, { error: e });
    return null;
  }
}

/** Embeddingi zdalne/serwerowe (Gemini, lokalna Ollama lub proxy) albo null — BEZ trwałego zatrzaskiwania. */
async function embedRemoteOrOllama(texts: string[]): Promise<Embedded | null> {
  if (isEmbedInBackoff()) return null;

  const { resolveService, reportOutcome } = await import("./autocore/gateway");
  const svc = resolveService("embed");
  const key = svc.provider === "gemini" && svc.allowed ? svc.apiKey : "";
  const proxy = store.settings.proxyUrl?.trim();

  try {
    if (key) {
      const t0 = Date.now();
      const out: number[][] = [];
      let totalChars = 0;
      for (const t of texts) {
        totalChars += t.length;
        const r = await fetchTimeout(
          "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent",
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify({ model: "models/text-embedding-004", content: { parts: [{ text: t }] } }),
          },
          20000,
        );
        if (!r.ok) {
          const err = Object.assign(new Error(`embed ${r.status}`), { status: r.status });
          reportOutcome("gemini", "text-embedding-004", key, false, { error: err });
          throw err;
        }
        const d = await r.json();
        out.push(d?.embedding?.values || []);
      }
      reportOutcome("gemini", "text-embedding-004", key, true, { latencyMs: Date.now() - t0, units: Math.max(1, totalChars) });
      return { vectors: out, tag: CLOUD_EMBED_TAG };
    }
    if (svc.provider === "ollama" && svc.allowed && svc.endpoint) {
      const ollVecs = await embedOllama(svc.endpoint, texts);
      if (ollVecs) return { vectors: ollVecs, tag: OLLAMA_EMBED_TAG };
      embedBackoffUntil = Date.now() + EMBED_BACKOFF_MS;
      return null;
    }
    if (proxy && !store.settings.onDeviceOnly) {
      const r = await fetchTimeout(`${proxy.replace(/\/$/, "")}/v1/embed`, {
        method: "POST",
        headers: { "content-type": "application/json", ...appTokenHeader() },
        body: JSON.stringify({ texts }),
      }, 20000);
      if (!r.ok) throw new Error(`embed ${r.status}`);
      const d = await r.json();
      return Array.isArray(d?.vectors) ? { vectors: d.vectors, tag: CLOUD_EMBED_TAG } : null;
    }
  } catch {
    embedBackoffUntil = Date.now() + EMBED_BACKOFF_MS;
    return null; // chwilowy backoff 30 s — nie zatrzaskujemy na stałe!
  }
  return null;
}

/**
 * Zwraca wektory + tag modelu. PREFERUJE on-device (Transformers.js/WebGPU), a gdy
 * niedostępne/nieudane → płynnie spada do Gemini lub lokalnej Ollamy.
 */
async function embedBatch(texts: string[]): Promise<Embedded | null> {
  if (!texts.length) return null;
  if (localEmbedOn()) {
    const v = await embedLocal(texts);
    if (v && v.length === texts.length && v[0]?.length) return { vectors: v, tag: LOCAL_EMBED_TAG };
    // null/niepełne → fallback do chmury/Ollamy poniżej
  }
  return embedRemoteOrOllama(texts);
}

async function embedText(text: string): Promise<{ vector: number[]; tag: string } | null> {
  const e = await embedBatch([text]);
  return e && e.vectors[0]?.length ? { vector: e.vectors[0], tag: e.tag } : null;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  const na = Math.sqrt(dot(a, a));
  const nb = Math.sqrt(dot(b, b));
  return na && nb ? dot(a, b) / (na * nb) : 0;
}

// --- Indeksowanie (uzupełnianie brakujących wektorów w tle) ---

let indexingPromise: Promise<void> | null = null;

/** Dolicza wektory dla faktów bez wektora LUB policzonych innym modelem. Bezpieczne „w tle". */
export async function ensureIndexed(): Promise<void> {
  while (indexingPromise) {
    await indexingPromise;
  }
  if (isEmbedInBackoff() && !localEmbedOn()) return; // chwilowy backoff (resetuje się przy zmianie konfiguracji)
  const want = intendedEmbedTag();
  const pending = activeMemoryFacts(store.data.memory).filter((m) => !m.embedding?.length || m.embModel !== want);
  if (!pending.length) return;
  const run = (async () => {
    const e = await embedBatch(pending.map((m) => `${m.key}: ${m.value}`));
    if (!e) return;
    store.setData((d) => {
      for (let i = 0; i < pending.length; i++) {
        const f = d.memory.find((x) => x.id === pending[i].id);
        if (f && e.vectors[i]?.length) { f.embedding = e.vectors[i]; f.embModel = e.tag; }
      }
    });
  })();
  indexingPromise = run;
  try {
    await run;
  } finally {
    if (indexingPromise === run) indexingPromise = null;
  }
}

// --- Zapis faktu (z unieważnieniem wektora + bi-temporal + reindeksacją) ---

/** Usuń pojedynczy fakt po id (Centrum Pamięci — kontrola użytkownika). */
export function deleteFact(id: string): void {
  store.setData((d) => { d.memory = d.memory.filter((m) => m.id !== id); });
}

/** Przypnij/odepnij fakt (przypięte nie są kasowane przy limicie). */
export function setFactPinned(id: string, pinned: boolean): void {
  store.setData((d) => { const m = d.memory.find((x) => x.id === id); if (m) m.pinned = pinned; });
}

/** Edytuj wartość faktu (zmiana treści → przelicz wektor + odśwież valid_from). */
export function editFact(id: string, value: string): void {
  store.setData((d) => {
    const m = d.memory.find((x) => x.id === id);
    if (m && m.value !== value) {
      m.value = value;
      m.valid_from = Date.now();
      m.invalid_at = undefined;
      m.embedding = undefined;
      m.embModel = undefined;
    }
  });
  void ensureIndexed();
}

function pruneMemoryStore(d: { memory: MemoryFact[] }): void {
  if (d.memory.length <= MAX_STORED) return;
  const keep = d.memory.filter((m) => m.pinned && !m.invalid_at);
  const rest = d.memory
    .filter((m) => !(m.pinned && !m.invalid_at))
    .sort((a, b) => {
      // Aktywne fakty zawsze przed historycznymi (unieważnionymi).
      const aActive = a.invalid_at ? 0 : 1;
      const bActive = b.invalid_at ? 0 : 1;
      return bActive - aActive || durability(b) - durability(a);
    })
    .slice(0, Math.max(0, MAX_STORED - keep.length));
  d.memory = [...keep, ...rest].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Zapamiętaj/zaktualizuj fakt z automatycznym unieważnianiem (invalid_at) sprzecznych faktów
 * o tym samym temacie (np. miasto vs miasto_zamieszkania) zamiast duplikowania ich w RAG.
 */
export function rememberFact(key: string, value: string, projectId?: string): void {
  const now = Date.now();
  store.setData((d) => {
    const existing = d.memory.find(
      (m) => m.key === key && (m.projectId || "") === (projectId || "") && !m.invalid_at,
    );
    let targetId: string;
    if (existing) {
      targetId = existing.id;
      if (existing.value !== value) {
        existing.value = value;
        existing.valid_from = now;
        existing.invalid_at = undefined;
        existing.embedding = undefined; // treść się zmieniła — przelicz wektor
        existing.embModel = undefined;
      }
      // Wzmocnienie: ponowne wspomnienie tego samego faktu czyni go trwalszym.
      existing.useCount = (existing.useCount || 0) + 1;
      existing.lastUsedAt = now;
    } else {
      targetId = uid();
      d.memory.unshift({
        id: targetId,
        key,
        value,
        projectId,
        createdAt: now,
        valid_from: now,
        useCount: 1,
        lastUsedAt: now,
      });
    }
    invalidateConflictingFacts(d.memory, { id: targetId, key, value, projectId }, now);
    pruneMemoryStore(d);
  });
  void ensureIndexed();
}

/**
 * Zapis bi-temporal z pełną historią zmian: poprzedni sprzeczny fakt dostaje `invalid_at = now`
 * i `superseded_by = newId`, a nowy fakt dostaje `valid_from = now`. RAG czyta tylko aktywne.
 */
export function rememberTemporalFact(
  key: string,
  value: string,
  opts: { projectId?: string; now?: number; pinned?: boolean } = {},
): MemoryFact {
  const now = opts.now ?? Date.now();
  const created: MemoryFact = {
    id: uid(),
    key,
    value,
    projectId: opts.projectId,
    pinned: opts.pinned,
    createdAt: now,
    valid_from: now,
    useCount: 1,
    lastUsedAt: now,
  };
  store.setData((d) => {
    invalidateConflictingFacts(d.memory, created, now);
    d.memory.unshift(created);
    pruneMemoryStore(d);
  });
  void ensureIndexed();
  return created;
}

// --- Pobieranie trafnych faktów ---

function sortByFreshness(facts: MemoryFact[]): MemoryFact[] {
  return [...facts].sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.createdAt - a.createdAt,
  );
}

/**
 * Wybiera najtrafniejsze AKTYWNE fakty dla zapytania (pomija fakty z invalid_at).
 * Przypięte zawsze wchodzą; resztę dobiera podobieństwem semantycznym / świeżością.
 */
async function retrieve(query: string, pid: string): Promise<MemoryFact[]> {
  const all = activeMemoryFacts(store.data.memory).filter((m) => !m.projectId || m.projectId === pid);
  void ensureIndexed(); // uzupełnij indeks w tle (nie blokujemy odpowiedzi)
  if (all.length <= MAX_FACTS) return sortByFreshness(all);

  const q = query.trim() ? await embedText(query) : null;
  if (!q) return sortByFreshness(all).slice(0, MAX_FACTS);
  const qv = q.vector;

  // Porównujemy tylko wektory z tego samego modelu co zapytanie (zgodny wymiar).
  const pinned = all.filter((m) => m.pinned);
  const indexed = all.filter((m) => !m.pinned && m.embedding?.length && m.embModel === q.tag);
  const unindexed = all.filter((m) => !m.pinned && !(m.embedding?.length && m.embModel === q.tag));
  const now = Date.now();
  const slots = Math.max(0, MAX_FACTS - pinned.length);
  const byId = new Map(indexed.map((m) => [m.id, m]));
  const semIds = [...indexed]
    .sort((a, b) => memoryScore(b, cosine(qv, b.embedding!), now) - memoryScore(a, cosine(qv, a.embedding!), now))
    .map((m) => m.id);
  const lexIds = [...indexed]
    .sort((a, b) => keywordScore(query, `${b.key} ${b.value}`) - keywordScore(query, `${a.key} ${a.value}`))
    .map((m) => m.id);
  const fused = reciprocalRankFusion([semIds, lexIds]);
  const reranked = mmrSelect(
    fused.map((f) => { const m = byId.get(f.id)!; return { id: f.id, relevance: f.score, vector: m.embedding, fact: m }; }),
    slots,
    0.7,
  ).map((x) => x.fact);

  const result: MemoryFact[] = [...pinned, ...reranked];
  for (const m of sortByFreshness(unindexed)) {
    if (result.length >= MAX_FACTS) break;
    result.push(m);
  }
  const chosen = result.slice(0, MAX_FACTS);
  reinforceUsed(chosen); // przypomnienie = wzmocnienie (pamięć ludzka)
  return chosen;
}

/** Wzmocnij wspomnienia faktycznie przypomniane (bump useCount/lastUsedAt) — jeden zapis. */
function reinforceUsed(facts: MemoryFact[]): void {
  if (!facts.length) return;
  const ids = new Set(facts.map((f) => f.id));
  const now = Date.now();
  store.setData((d) => {
    for (const m of d.memory) if (ids.has(m.id)) { m.useCount = (m.useCount || 0) + 1; m.lastUsedAt = now; }
  });
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

/** Kompaktowy blok Core Memory (twardy limit max 30% budżetu kontekstu). */
export function coreMemoryBlock(totalContextBudgetChars = 4000): string {
  const pid = store.settings.activeProjectId || "";
  const scoped = activeMemoryFacts(store.data.memory).filter((m) => !m.projectId || m.projectId === pid);
  return buildCoreMemoryBlock(scoped, totalContextBudgetChars).block;
}

/** Sformatowany blok aktywnych faktów (Core Memory ≤ 30% budżetu + kontekst semantyczny). */
export function memoryBlock(totalContextBudgetChars = 4000): string {
  const pid = store.settings.activeProjectId || "";
  const activeScoped = activeMemoryFacts(store.data.memory).filter((m) => !m.projectId || m.projectId === pid);
  const core = buildCoreMemoryBlock(activeScoped, totalContextBudgetChars);
  const facts = activeMemoryFacts(cachedFacts ?? sortByFreshness(activeScoped).slice(0, MAX_FACTS));
  if (!facts.length && !core.block) return "";
  const coreIds = new Set(core.included.map((f) => f.id));
  const extra = facts.filter((f) => !coreIds.has(f.id));
  const parts: string[] = [];
  if (core.block) parts.push(core.block);
  if (extra.length) {
    parts.push("Dodatkowe aktywne fakty (RAG):\n" + extra.map((m) => `- ${m.key}: ${m.value}`).join("\n"));
  }
  return "\n\n" + parts.join("\n\n");
}

// === Pamięć ewoluująca: semantyczny dobór wpisów dziennika ===
// Udostępnione wpisy dziennika są wektoryzowane w tle (cache w RAM — wektory
// dziennika nie puchną w localStorage) i do promptu trafiają te NAJTRAFNIEJSZE
// dla bieżącego pytania, a nie po prostu pierwsze z brzegu. JARVIS sam „łączy
// kropki" między rozmową a przemyśleniami użytkownika.

const auxVecs = new Map<string, number[]>(); // journalId → wektor (sesyjny cache)
const AUX_CAP = 60; // ile wpisów maksymalnie indeksujemy (koszty/limit czasu)
let auxIndexing = false;

function auxKey(id: string, updatedAt: number, tag: string): string {
  return `${id}:${updatedAt}:${tag}`;
}

async function ensureJournalIndexed(): Promise<void> {
  if (auxIndexing) return;
  if (isEmbedInBackoff() && !localEmbedOn()) return;
  const tag = intendedEmbedTag();
  const shared = (store.data.journal || []).filter((j) => j.shared).slice(0, AUX_CAP);
  const pending = shared.filter((j) => !auxVecs.has(auxKey(j.id, j.updatedAt, tag)));
  if (!pending.length) return;
  auxIndexing = true;
  try {
    const e = await embedBatch(pending.map((j) => `${j.title}\n${j.body}`.slice(0, 800)));
    if (!e) return;
    pending.forEach((j, i) => {
      if (e.vectors[i]?.length) auxVecs.set(auxKey(j.id, j.updatedAt, e.tag), e.vectors[i]);
    });
  } finally {
    auxIndexing = false;
  }
}

/**
 * Zwraca id udostępnionych wpisów dziennika w kolejności trafności do zapytania
 * (semantycznie), albo null gdy indeks niedostępny — wtedy brain użyje kolejności
 * naturalnej. Wywoływane przed budową promptu, razem z prepareMemoryContext.
 */
export async function rankJournal(query: string): Promise<string[] | null> {
  const shared = (store.data.journal || []).filter((j) => j.shared);
  if (shared.length <= 3 || !query.trim()) return null; // mało wpisów — bez kosztów
  void ensureJournalIndexed();
  const q = await embedText(query);
  if (!q) return null;
  const scored = shared
    .map((j) => ({ id: j.id, score: cosine(q.vector, auxVecs.get(auxKey(j.id, j.updatedAt, q.tag)) || []) }))
    .sort((a, b) => b.score - a.score);
  return scored.map((s) => s.id);
}
