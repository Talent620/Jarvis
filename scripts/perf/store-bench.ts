// Store write-path benchmark (mission M0 baseline, M1 before/after).
// Run: npx vite-node scripts/perf/store-bench.ts [--idb] [--json]
// Deterministic dataset, in-memory localStorage shim; measures the synchronous cost the UI
// thread pays per store mutation plus how many subscribers each mutation wakes.

const useIdb = process.argv.includes("--idb");
const asJson = process.argv.includes("--json");

class MemoryStorage {
  private m = new Map<string, string>();
  bytesWritten = 0;
  writes = 0;
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.writes++; this.bytesWritten += v.length; this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const words = "zadanie projekt klient spotkanie oferta faktura mail telefon raport analiza strona komentarz film".split(" ");
const text = (n: number) => Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(" ");
const id = (p: string, i: number) => `${p}${i.toString(36)}`;

function dataset() {
  const now = 1_780_000_000_000;
  return {
    tasks: Array.from({ length: 400 }, (_, i) => ({ id: id("t", i), title: text(6), done: rnd() > 0.6, due: new Date(now + i * 3600e3).toISOString(), createdAt: now })),
    notes: Array.from({ length: 300 }, (_, i) => ({ id: id("n", i), text: text(40), createdAt: now })),
    reminders: Array.from({ length: 80 }, (_, i) => ({ id: id("r", i), text: text(8), at: new Date(now).toISOString(), fired: false, createdAt: now })),
    shopping: Array.from({ length: 50 }, (_, i) => ({ id: id("s", i), text: text(2), done: false })),
    calendar: Array.from({ length: 200 }, (_, i) => ({ id: id("c", i), title: text(5), start: new Date(now).toISOString() })),
    memory: Array.from({ length: 600 }, (_, i) => ({ id: id("m", i), key: text(2), value: text(20), embedding: Array.from({ length: 256 }, () => +(rnd() * 2 - 1).toFixed(6)) })),
    scenes: [],
    audit: Array.from({ length: 500 }, (_, i) => ({ id: id("a", i), tool: "add_task", input: { title: text(4) }, output: text(10), status: "ok", at: now })),
    projects: Array.from({ length: 20 }, (_, i) => ({ id: id("p", i), name: text(2) })),
    projectFiles: [], tally: [], journal: Array.from({ length: 100 }, (_, i) => ({ id: id("j", i), text: text(60), at: now })),
    leads: Array.from({ length: 300 }, (_, i) => ({ id: id("l", i), company: text(2), email: `x${i}@example.com`, status: "new" })),
    flashcards: [], bargainWatch: [],
    sentMail: Array.from({ length: 200 }, (_, i) => ({ id: id("e", i), to: `x${i}@example.com`, subject: text(5), body: text(120), at: now })),
    contentPosts: [], imageHistory: [], siteProjects: [], financeProjects: [],
    world: { entities: [], relations: [] },
  };
}

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3), p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), max: +s[s.length - 1].toFixed(3) };
}

async function main() {
  const ls = new MemoryStorage();
  const blob = JSON.stringify(dataset());
  ls.setItem("jarvis.data.v2", blob);
  if (useIdb) {
    await import("fake-indexeddb/auto");
  }
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = ls;
  ls.bytesWritten = 0; ls.writes = 0;

  const t0 = performance.now();
  const { store } = await import("../../src/lib/store");
  const importMs = performance.now() - t0;
  // Let IDB migration/hydration settle.
  await new Promise((r) => setTimeout(r, useIdb ? 500 : 0));

  const SUBSCRIBERS = 22; // components calling useStore() at baseline
  let wakes = 0;
  for (let i = 0; i < SUBSCRIBERS; i++) store.subscribe(() => { wakes++; });

  const N = 200;
  const bytesBefore = ls.bytesWritten, writesBefore = ls.writes;
  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const s = performance.now();
    store.setData((d) => { const t = d.tasks[i % d.tasks.length]; t.done = !t.done; });
    times.push(performance.now() - s);
  }
  const setDataBytes = (ls.bytesWritten - bytesBefore) / N;
  const setDataWrites = (ls.writes - writesBefore) / N;
  const setDataWakes = wakes / N;

  wakes = 0;
  const sTimes: number[] = [];
  const sBytes0 = ls.bytesWritten;
  for (let i = 0; i < N; i++) {
    const s = performance.now();
    store.setSettings({ warmth: (i % 10) / 10 });
    sTimes.push(performance.now() - s);
  }

  const result = {
    mode: useIdb ? "indexeddb" : "localStorage-only",
    blobBytes: blob.length,
    importAndHydrateMs: +importMs.toFixed(1),
    setData: { ...stats(times), bytesPerCall: Math.round(setDataBytes), storageWritesPerCall: setDataWrites, subscriberWakesPerCall: setDataWakes },
    setSettings: { ...stats(sTimes), bytesPerCall: Math.round((ls.bytesWritten - sBytes0) / N), subscriberWakesPerCall: wakes / N },
    burst100SetDataMs: 0,
  };
  const b0 = performance.now();
  for (let i = 0; i < 100; i++) store.setData((d) => { d.tasks[0].done = !d.tasks[0].done; });
  result.burst100SetDataMs = +(performance.now() - b0).toFixed(1);

  if (asJson) console.log(JSON.stringify(result));
  else console.table({ ...result.setData, mode: result.mode });
  if (!asJson) console.log(JSON.stringify(result, null, 2));
  store.dispose();
  process.exit(0);
}

void main();
