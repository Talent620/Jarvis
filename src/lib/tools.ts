import { store, uid } from "./store";
import { openService, call, sms, navigate, smartHome } from "./deviceControl";
import { getWeather } from "./weather";
import { scheduleReminder } from "./notifications";
import { addEvent, listUpcoming } from "./deviceCalendar";
import { callContact, textContact } from "./deviceContacts";
import { requestConsent, emitStep, audit, captureUndo } from "./permissions";
import { gmailSearch, gmailSend, gcalList, gcalAdd } from "./google";
import type { Citation } from "../types";

// Bufor cytatów z ostatniego zapytania (research). Resetowany per wywołanie w brain.ts.
let citationBuffer: Citation[] = [];
export function resetCitations() { citationBuffer = []; }
export function getCitations(): Citation[] { return citationBuffer.slice(0, 8); }

// Definicja narzędzia w formacie Claude Messages API + lokalny wykonawca.
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type Executor = (input: any) => Promise<string> | string;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const str = (description: string) => ({ type: "string", description });

// --- Rejestr narzędzi: definicja + wykonawca w jednym miejscu ---

interface Tool {
  def: ToolDef;
  run: Executor;
}

const tools: Tool[] = [
  {
    def: {
      name: "add_task",
      description: "Dodaj zadanie do listy zadań. Używaj, gdy użytkownik prosi o zapamiętanie czegoś do zrobienia.",
      input_schema: obj(
        { title: str("Treść zadania"), due: str("Termin w formacie ISO 8601 (opcjonalnie)") },
        ["title"],
      ),
    },
    run: ({ title, due }) => {
      store.setData((d) => d.tasks.unshift({ id: uid(), title, done: false, due, createdAt: Date.now() }));
      return `Dodano zadanie: „${title}”${due ? ` (termin ${due})` : ""}.`;
    },
  },
  {
    def: {
      name: "complete_task",
      description: "Oznacz zadanie jako wykonane. Dopasuj po fragmencie treści.",
      input_schema: obj({ query: str("Fragment treści zadania do oznaczenia jako zrobione") }, ["query"]),
    },
    run: ({ query }) => {
      let hit = "";
      store.setData((d) => {
        const t = d.tasks.find((x) => !x.done && x.title.toLowerCase().includes(query.toLowerCase()));
        if (t) {
          t.done = true;
          hit = t.title;
        }
      });
      return hit ? `Zadanie „${hit}” oznaczone jako wykonane.` : `Nie znalazłem aktywnego zadania pasującego do „${query}”.`;
    },
  },
  {
    def: {
      name: "list_tasks",
      description: "Wypisz aktualne zadania (aktywne i wykonane).",
      input_schema: obj({}),
    },
    run: () => {
      const { tasks } = store.data;
      if (!tasks.length) return "Lista zadań jest pusta.";
      return tasks
        .map((t) => `${t.done ? "✓" : "•"} ${t.title}${t.due ? ` (termin ${t.due})` : ""}`)
        .join("\n");
    },
  },
  {
    def: {
      name: "add_note",
      description: "Zapisz notatkę.",
      input_schema: obj({ text: str("Treść notatki") }, ["text"]),
    },
    run: ({ text }) => {
      store.setData((d) => d.notes.unshift({ id: uid(), text, createdAt: Date.now() }));
      return "Notatka zapisana.";
    },
  },
  {
    def: {
      name: "list_notes",
      description: "Wypisz zapisane notatki.",
      input_schema: obj({}),
    },
    run: () => {
      const { notes } = store.data;
      return notes.length ? notes.map((n) => `• ${n.text}`).join("\n") : "Brak notatek.";
    },
  },
  {
    def: {
      name: "add_reminder",
      description: "Ustaw przypomnienie na konkretny moment.",
      input_schema: obj(
        { text: str("Treść przypomnienia"), at: str("Data i godzina w ISO 8601") },
        ["text", "at"],
      ),
    },
    run: ({ text, at }) => {
      const reminder = { id: uid(), text, at, fired: false, createdAt: Date.now() };
      store.setData((d) => d.reminders.unshift(reminder));
      void scheduleReminder(reminder);
      return `Przypomnienie ustawione na ${at}: „${text}”.`;
    },
  },
  {
    def: {
      name: "add_shopping_item",
      description: "Dodaj pozycję do listy zakupów.",
      input_schema: obj({ name: str("Nazwa produktu"), qty: str("Ilość (opcjonalnie)") }, ["name"]),
    },
    run: ({ name, qty }) => {
      store.setData((d) => d.shopping.unshift({ id: uid(), name, qty, done: false, createdAt: Date.now() }));
      return `Dodano do zakupów: ${qty ? `${qty} ` : ""}${name}.`;
    },
  },
  {
    def: {
      name: "list_shopping",
      description: "Wypisz listę zakupów.",
      input_schema: obj({}),
    },
    run: () => {
      const { shopping } = store.data;
      return shopping.length
        ? shopping.map((s) => `${s.done ? "✓" : "•"} ${s.qty ? `${s.qty} ` : ""}${s.name}`).join("\n")
        : "Lista zakupów jest pusta.";
    },
  },
  {
    def: {
      name: "add_calendar_event",
      description: "Dodaj wydarzenie do kalendarza.",
      input_schema: obj(
        {
          title: str("Tytuł wydarzenia"),
          start: str("Początek w ISO 8601"),
          end: str("Koniec w ISO 8601 (opcjonalnie)"),
          location: str("Miejsce (opcjonalnie)"),
        },
        ["title", "start"],
      ),
    },
    run: ({ title, start, end, location }) => addEvent(title, start, end, location),
  },
  {
    def: {
      name: "list_calendar",
      description: "Wypisz nadchodzące wydarzenia z kalendarza (na telefonie najbliższe 7 dni).",
      input_schema: obj({}),
    },
    run: () => listUpcoming(7),
  },
  {
    def: {
      name: "call_contact",
      description: "Zadzwoń do osoby z listy kontaktów telefonu (po imieniu/nazwisku).",
      input_schema: obj({ name: str("Imię lub nazwa kontaktu") }, ["name"]),
    },
    run: ({ name }) => callContact(name),
  },
  {
    def: {
      name: "text_contact",
      description: "Wyślij SMS do osoby z kontaktów telefonu (po imieniu/nazwisku).",
      input_schema: obj({ name: str("Imię lub nazwa kontaktu"), body: str("Treść (opcjonalnie)") }, ["name"]),
    },
    run: ({ name, body }) => textContact(name, body),
  },
  {
    def: {
      name: "remember_fact",
      description:
        "Zapamiętaj trwałą informację o użytkowniku lub jego preferencjach (np. ulubiona kawiarnia, adres, imię partnera). Używaj proaktywnie.",
      input_schema: obj({ key: str("Krótki klucz, np. 'ulubiona_kawa'"), value: str("Wartość do zapamiętania") }, [
        "key",
        "value",
      ]),
    },
    run: ({ key, value }) => {
      const projectId = store.settings.activeProjectId || undefined;
      store.setData((d) => {
        const existing = d.memory.find((m) => m.key === key && (m.projectId || "") === (projectId || ""));
        if (existing) existing.value = value;
        else d.memory.unshift({ id: uid(), key, value, projectId, createdAt: Date.now() });
      });
      return `Zapamiętane: ${key} = ${value}.`;
    },
  },
  {
    def: {
      name: "open_service",
      description:
        "Otwórz aplikację lub usługę (spotify, youtube, netflix, maps, google, gmail, whatsapp, messenger, instagram, facebook, tiktok, allegro, olx). Można podać zapytanie, np. wyszukanie utworu.",
      input_schema: obj({ service: str("Nazwa usługi"), query: str("Zapytanie/wyszukiwanie (opcjonalnie)") }, [
        "service",
      ]),
    },
    run: ({ service, query }) => openService(service, query),
  },
  {
    def: {
      name: "make_call",
      description: "Rozpocznij połączenie telefoniczne na podany numer.",
      input_schema: obj({ number: str("Numer telefonu") }, ["number"]),
    },
    run: ({ number }) => call(number),
  },
  {
    def: {
      name: "send_sms",
      description: "Przygotuj wiadomość SMS do podanego numeru.",
      input_schema: obj({ number: str("Numer telefonu"), body: str("Treść wiadomości (opcjonalnie)") }, ["number"]),
    },
    run: ({ number, body }) => sms(number, body),
  },
  {
    def: {
      name: "navigate_to",
      description: "Uruchom nawigację do podanego miejsca w Mapach Google.",
      input_schema: obj({ destination: str("Cel podróży") }, ["destination"]),
    },
    run: ({ destination }) => navigate(destination),
  },
  {
    def: {
      name: "smart_home",
      description:
        "Steruj urządzeniem smart home przez Home Assistant. entity_id to identyfikator encji, np. 'light.salon', 'switch.czajnik', 'climate.sypialnia'.",
      input_schema: obj(
        {
          entity_id: str("Identyfikator encji Home Assistant (domena.nazwa)"),
          action: { type: "string", enum: ["on", "off", "toggle"], description: "Akcja" },
        },
        ["entity_id", "action"],
      ),
    },
    run: ({ entity_id, action }) => smartHome(entity_id, action),
  },
  {
    def: {
      name: "create_scene",
      description:
        "Zapisz scenę smart home — nazwany zestaw akcji na encjach (np. 'Dobranoc' gasi światła i włącza alarm). Później uruchamiana przez run_scene.",
      input_schema: obj(
        {
          name: str("Nazwa sceny, np. 'Dobranoc'"),
          actions: {
            type: "array",
            description: "Lista akcji w scenie",
            items: obj(
              {
                entity_id: str("Encja Home Assistant, np. light.salon"),
                action: { type: "string", enum: ["on", "off", "toggle"] },
              },
              ["entity_id", "action"],
            ),
          },
        },
        ["name", "actions"],
      ),
    },
    run: ({ name, actions }) => {
      const acts = (actions || []).map((a: any) => ({ entityId: a.entity_id, action: a.action }));
      store.setData((d) => {
        const existing = d.scenes.find((s) => s.name.toLowerCase() === name.toLowerCase());
        if (existing) existing.actions = acts;
        else d.scenes.unshift({ id: uid(), name, actions: acts, createdAt: Date.now() });
      });
      return `Scena „${name}” zapisana (${acts.length} akcji).`;
    },
  },
  {
    def: {
      name: "run_scene",
      description: "Uruchom zapisaną scenę smart home po nazwie.",
      input_schema: obj({ name: str("Nazwa sceny") }, ["name"]),
    },
    run: async ({ name }) => {
      const scene = store.data.scenes.find((s) => s.name.toLowerCase().includes(name.toLowerCase()));
      if (!scene) return `Nie znam sceny „${name}”. Najpierw ją utwórz.`;
      const results = [];
      for (const a of scene.actions) results.push(await smartHome(a.entityId, a.action));
      return `Scena „${scene.name}”:\n` + results.join("\n");
    },
  },
  {
    def: {
      name: "list_scenes",
      description: "Wypisz zapisane sceny smart home.",
      input_schema: obj({}),
    },
    run: () => {
      const { scenes } = store.data;
      return scenes.length
        ? scenes.map((s) => `• ${s.name} (${s.actions.length} akcji)`).join("\n")
        : "Brak zapisanych scen.";
    },
  },
  {
    def: {
      name: "get_weather",
      description:
        "Sprawdź aktualną pogodę. Bez podania miejsca użyje lokalizacji urządzenia. Dane na żywo (Open-Meteo).",
      input_schema: obj({ location: str("Miasto/miejsce (opcjonalnie)") }),
    },
    run: ({ location }) => getWeather(location),
  },
  {
    def: {
      name: "daily_briefing",
      description:
        "Zbierz dane do porannego raportu: pora dnia, pogoda, dzisiejsze wydarzenia, aktywne zadania i dzisiejsze przypomnienia. Następnie zreferuj je użytkownikowi naturalnie.",
      input_schema: obj({}),
    },
    run: async () => {
      const now = new Date();
      const hour = now.getHours();
      const part = hour < 12 ? "Ranek" : hour < 18 ? "Popołudnie" : "Wieczór";
      const todayStr = now.toISOString().slice(0, 10);

      const events = store.data.calendar
        .filter((e) => e.start.slice(0, 10) === todayStr)
        .sort((a, b) => a.start.localeCompare(b.start));
      const openTasks = store.data.tasks.filter((t) => !t.done);
      const todayReminders = store.data.reminders.filter((r) => !r.fired && r.at.slice(0, 10) === todayStr);

      const weather = await getWeather().catch(() => "pogoda niedostępna");

      const lines = [
        `Pora dnia: ${part} (${now.toLocaleString("pl-PL")}).`,
        weather,
        events.length
          ? `Dzisiejsze wydarzenia: ${events
              .map((e) => `${new Date(e.start).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })} ${e.title}`)
              .join("; ")}.`
          : "Brak wydarzeń w kalendarzu na dziś.",
        openTasks.length
          ? `Aktywne zadania (${openTasks.length}): ${openTasks.slice(0, 5).map((t) => t.title).join("; ")}.`
          : "Brak aktywnych zadań.",
        todayReminders.length ? `Przypomnienia na dziś: ${todayReminders.map((r) => r.text).join("; ")}.` : "",
      ].filter(Boolean);

      return lines.join("\n");
    },
  },
  {
    def: {
      name: "web_research",
      description:
        "Wyszukaj w sieci aktualne informacje i zwróć je ze ŹRÓDŁAMI (tryb research, Tavily). Używaj, gdy potrzeba świeżych danych lub cytatów. Po użyciu odwołuj się do źródeł numerami [1], [2].",
      input_schema: obj({ query: str("Zapytanie do wyszukania") }, ["query"]),
    },
    run: async ({ query }) => {
      const key = store.settings.tavilyApiKey;
      if (!key) {
        return "Brak klucza Tavily — dodaj go w ⚙ Ustawienia (sekcja Research) albo użyj modelu Claude (ma wbudowane wyszukiwanie).";
      }
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: key, query, max_results: 5, include_answer: true, search_depth: "advanced" }),
      });
      const data = await res.json();
      if (!res.ok) return `Błąd wyszukiwania: ${data?.error || res.status}.`;
      const results: any[] = data.results || [];
      results.forEach((r) => citationBuffer.push({ title: r.title || r.url, url: r.url }));
      const answer = data.answer ? `Skrót: ${data.answer}\n\n` : "";
      return (
        answer +
        results
          .map((r, i) => `[${i + 1}] ${r.title}\n${(r.content || "").slice(0, 400)}\nŹródło: ${r.url}`)
          .join("\n\n")
      );
    },
  },
  {
    def: {
      name: "gmail_search",
      description: "Przeszukaj skrzynkę Gmail (wymaga połączonego konta Google przez backend). query w składni Gmaila, np. 'is:unread from:szef'.",
      input_schema: obj({ query: str("Zapytanie Gmail (opcjonalne)") }),
    },
    run: ({ query }) => gmailSearch(query || ""),
  },
  {
    def: {
      name: "gmail_send",
      description: "Wyślij e-mail przez Gmail (wymaga połączonego konta Google).",
      input_schema: obj({ to: str("Adres odbiorcy"), subject: str("Temat"), body: str("Treść") }, ["to", "subject", "body"]),
    },
    run: ({ to, subject, body }) => gmailSend(to, subject, body),
  },
  {
    def: {
      name: "gcal_list",
      description: "Wypisz nadchodzące wydarzenia z Kalendarza Google (wymaga połączonego konta).",
      input_schema: obj({}),
    },
    run: () => gcalList(),
  },
  {
    def: {
      name: "gcal_add",
      description: "Dodaj wydarzenie do Kalendarza Google (wymaga połączonego konta). Daty w ISO 8601.",
      input_schema: obj(
        { summary: str("Tytuł"), start: str("Początek ISO 8601"), end: str("Koniec ISO 8601 (opcjonalnie)"), location: str("Miejsce (opcjonalnie)") },
        ["summary", "start"],
      ),
    },
    run: ({ summary, start, end, location }) => gcalAdd(summary, start, end, location),
  },
];

export const toolDefs: ToolDef[] = tools.map((t) => t.def);

const executors: Record<string, Executor> = Object.fromEntries(tools.map((t) => [t.def.name, t.run]));

export async function runTool(name: string, input: unknown): Promise<string> {
  const fn = executors[name];
  if (!fn) return `Nieznane narzędzie: ${name}`;

  // Bramka uprawnień (write/outbound wymagają zgody; read przechodzi).
  const allowed = await requestConsent(name, input);
  if (!allowed) {
    audit({ tool: name, input, status: "denied" });
    return "Anulowano — użytkownik nie wyraził zgody na tę akcję.";
  }

  emitStep(name);
  try {
    const out = await fn(input);
    audit({
      tool: name,
      input,
      output: typeof out === "string" ? out.slice(0, 300) : "",
      status: "ok",
      undo: captureUndo(name),
    });
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    audit({ tool: name, input, output: msg, status: "error" });
    return `Błąd narzędzia ${name}: ${msg}`;
  } finally {
    emitStep(null);
  }
}
