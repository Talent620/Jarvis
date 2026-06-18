import { store, uid } from "./store";
import { callNowList, followUpsDue } from "./salesEngine";

// === Autopilot sprzedaży ===
// JARVIS sam zamienia leady w konkretne zadania i utrzymuje plan bez Twojego
// udziału: gorący, niezaczepiony lead → zadanie „Zadzwoń" (priorytet, dziś);
// należny follow-up → zadanie „Ponaglenie". Domyka też zadania, które stały się
// nieaktualne (np. zadzwoniłeś → zadanie znika z listy). Odporne na duplikaty
// dzięki polu Task.sourceId.

const PROJECT_NAME = "Sprzedaż";
const todayISO = (now = new Date()) => now.toISOString().slice(0, 10);

/** Znajdź lub utwórz projekt „Sprzedaż" (zwraca jego id). */
export function salesProjectId(): string {
  const existing = store.data.projects.find((p) => p.name.toLowerCase() === PROJECT_NAME.toLowerCase());
  if (existing) return existing.id;
  const id = uid();
  store.setData((d) => d.projects.unshift({ id, name: PROJECT_NAME, instructions: "Leady i kontakt z klientami — pilnowane przez autopilota.", createdAt: Date.now(), updatedAt: Date.now() }));
  return id;
}

export interface AutoPlanResult { added: number; completed: number; }

/**
 * Zsynchronizuj zadania ze stanem leadów. Idempotentne — wielokrotne wywołanie
 * nie tworzy duplikatów. Zwraca, ile zadań dodano i ile auto-domknięto.
 */
export function syncSalesTasks(now = new Date()): AutoPlanResult {
  const leads = store.data.leads || [];
  if (!leads.length) return { added: 0, completed: 0 };

  const projectId = salesProjectId();
  const today = todayISO(now);
  let added = 0, completed = 0;

  // Pożądane zadania: telefony (gorące, otwarte, niezaczepione) + follow-upy.
  const calls = callNowList(leads, now);
  const fups = followUpsDue(leads, now.getTime());
  const want = new Map<string, { title: string; category: string }>();
  for (const l of calls) want.set(`call:${l.id}`, { title: `📞 Zadzwoń: ${l.company}`, category: "telefon" });
  for (const l of fups) want.set(`fup:${l.id}:${l.followUpCount ?? 0}`, { title: `🔁 Follow-up: ${l.company}`, category: "sprzedaż" });

  store.setData((d) => {
    const open = d.tasks.filter((t) => !t.done && t.sourceId);
    const haveOpen = new Set(open.map((t) => t.sourceId));

    // 1) Dodaj brakujące pożądane zadania.
    for (const [sourceId, info] of want) {
      if (haveOpen.has(sourceId)) continue;
      // Nie odtwarzaj zadania, które już raz wykonano w tym cyklu (ten sam sourceId, done).
      if (d.tasks.some((t) => t.sourceId === sourceId)) continue;
      d.tasks.unshift({
        id: uid(), title: info.title, done: false, due: today,
        priority: true, projectId, category: info.category,
        sourceId, createdAt: Date.now(),
      });
      added++;
    }

    // 2) Auto-domknij nieaktualne: telefon do leada, który już nie jest „nowy"
    //    (zadzwoniłeś/zaczepiłeś) oraz follow-up do leada wygranego/odrzuconego.
    const byId = new Map(d.leads.map((l) => [l.id, l]));
    for (const t of open) {
      const [kind, leadId] = (t.sourceId || "").split(":");
      const lead = byId.get(leadId);
      const stale =
        !lead ||
        (kind === "call" && lead.status !== "new") ||
        // Follow-up: zamknięty gdy klient/odrzucony LUB gdy zadanie zostało zastąpione nowym
        // cyklem (sourceId koduje followUpCount) / nie jest już „due" — inaczej stare
        // fup:<id>:0, fup:<id>:1… kumulowały się bez końca dla tego samego leada.
        (kind === "fup" && (lead.status === "won" || lead.status === "lost" || !want.has(t.sourceId || "")));
      if (stale) { t.done = true; completed++; }
    }
  });

  return { added, completed };
}

/** Uruchom autopilota najwyżej raz dziennie (do cichego wywołania przy starcie). */
export function autoPlanDaily(now = new Date()): AutoPlanResult | null {
  if (store.settings.salesAutopilot === false) return null;
  const today = todayISO(now);
  if (store.settings.lastAutoPlanAt === today) return null;
  store.setSettings({ lastAutoPlanAt: today });
  return syncSalesTasks(now);
}

/** Zwięzłe podsumowanie do czatu/powiadomienia. */
export function autoPlanSummary(r: AutoPlanResult): string {
  if (!r.added && !r.completed) return "Plan sprzedaży aktualny — nic nowego do zrobienia.";
  const parts: string[] = [];
  if (r.added) parts.push(`dodałem ${r.added} zadań na dziś (telefony i follow-upy)`);
  if (r.completed) parts.push(`domknąłem ${r.completed} nieaktualnych`);
  return `Autopilot sprzedaży: ${parts.join(", ")}. Zerknij: ✅ Zadania Pro → ⭐ Priorytet.`;
}

export { PROJECT_NAME };
