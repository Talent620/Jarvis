import { store, uid } from "./store";
import { openService, call, sms, navigate, smartHome } from "./deviceControl";
import { getWeather } from "./weather";

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
      store.setData((d) => d.reminders.unshift({ id: uid(), text, at, fired: false, createdAt: Date.now() }));
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
    run: ({ title, start, end, location }) => {
      store.setData((d) =>
        d.calendar.unshift({ id: uid(), title, start, end, location, createdAt: Date.now() }),
      );
      return `Wydarzenie „${title}” dodane na ${start}${location ? ` (${location})` : ""}.`;
    },
  },
  {
    def: {
      name: "list_calendar",
      description: "Wypisz nadchodzące wydarzenia z kalendarza.",
      input_schema: obj({}),
    },
    run: () => {
      const events = [...store.data.calendar].sort((a, b) => a.start.localeCompare(b.start));
      return events.length
        ? events.map((e) => `• ${e.start} — ${e.title}${e.location ? ` @ ${e.location}` : ""}`).join("\n")
        : "Kalendarz jest pusty.";
    },
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
      store.setData((d) => {
        const existing = d.memory.find((m) => m.key === key);
        if (existing) existing.value = value;
        else d.memory.unshift({ id: uid(), key, value, createdAt: Date.now() });
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
];

export const toolDefs: ToolDef[] = tools.map((t) => t.def);

const executors: Record<string, Executor> = Object.fromEntries(tools.map((t) => [t.def.name, t.run]));

export async function runTool(name: string, input: unknown): Promise<string> {
  const fn = executors[name];
  if (!fn) return `Nieznane narzędzie: ${name}`;
  try {
    return await fn(input);
  } catch (e) {
    return `Błąd narzędzia ${name}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
