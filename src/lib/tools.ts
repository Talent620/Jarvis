import { store, uid } from "./store";
import { openService, call, sms, navigate, smartHome, openUrl } from "./deviceControl";
import { getWeather } from "./weather";
import { scheduleReminder, scheduleTimer } from "./notifications";
import { addEvent, listUpcoming } from "./deviceCalendar";
import { callContact, textContact } from "./deviceContacts";
import { requestConsent, emitStep, audit, captureUndo } from "./permissions";
import { gmailSearch, gmailSend, gcalList, gcalAdd } from "./google";
import { rememberFact } from "./memory";
import { generateCards } from "./cards";
import { runAutomation } from "./n8n";
import { getCrypto, getRate } from "./markets";
import { launchApp, openOnPc, powerPc, volumePc, mediaPc, typeText, hotkey as desktopHotkey } from "./desktop";
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
      name: "add_journal_entry",
      description:
        "Dopisz wpis do osobistego DZIENNIKA użytkownika (jego prywatne przemyślenia, refleksje, wspomnienia, np. gdy mówi: zapisz w dzienniku, że...). To NIE to samo co notatka czy zadanie. Dodaj zwięzły tytuł i treść; opcjonalnie tagi.",
      input_schema: obj(
        { title: str("Krótki tytuł wpisu"), body: str("Treść przemyślenia"), tags: str("Tagi po przecinku (opcjonalnie)") },
        ["body"],
      ),
    },
    run: ({ title, body, tags }) => {
      const t = (tags || "").split(",").map((x: string) => x.trim().toLowerCase()).filter(Boolean).slice(0, 10);
      const now = Date.now();
      store.setData((d) =>
        d.journal.unshift({ id: uid(), title: (title || "").trim(), body: String(body).trim(), tags: t, createdAt: now, updatedAt: now }),
      );
      return `Zapisałem w Twoim dzienniku${title ? `: „${title}"` : ""}.`;
    },
  },
  {
    def: {
      name: "calculate",
      description: "Policz wyrażenie matematyczne (np. '23*1.23+10', '15% z 240'). Zwróć wynik.",
      input_schema: obj({ expression: str("Wyrażenie do obliczenia") }, ["expression"]),
    },
    run: ({ expression }) => {
      const raw = String(expression || "");
      // „15% z 240" → 240*0.15
      const pct = raw.match(/([\d.,]+)\s*%\s*(?:z|of)\s*([\d.,]+)/i);
      const expr = pct ? `${pct[2]}*${pct[1]}/100` : raw;
      const clean = expr.replace(/,/g, ".").replace(/[^0-9+\-*/().%\s]/g, "");
      if (!clean.trim()) return "Podaj wyrażenie liczbowe.";
      try {
        const val = Function(`"use strict"; return (${clean})`)();
        if (typeof val !== "number" || !isFinite(val)) return "Nie potrafię tego policzyć.";
        return `${raw} = ${Math.round(val * 1e6) / 1e6}`;
      } catch {
        return "Błędne wyrażenie.";
      }
    },
  },
  {
    def: {
      name: "open_url",
      description: "Otwórz dowolny adres URL/stronę w przeglądarce (lub aplikacji desktopowej).",
      input_schema: obj({ url: str("Adres, np. github.com lub https://...") }, ["url"]),
    },
    run: ({ url }) => openUrl(url),
  },
  {
    def: {
      name: "forget_fact",
      description: "Usuń zapamiętany fakt o użytkowniku po jego kluczu (np. gdy się zdezaktualizował).",
      input_schema: obj({ key: str("Klucz faktu do usunięcia") }, ["key"]),
    },
    run: ({ key }) => {
      let removed = false;
      store.setData((d) => {
        const before = d.memory.length;
        d.memory = d.memory.filter((m) => m.key !== key);
        removed = d.memory.length < before;
      });
      return removed ? `Usunąłem z pamięci: ${key}.` : `Nie znalazłem w pamięci klucza „${key}".`;
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
      rememberFact(key, value, store.settings.activeProjectId || undefined);
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
      name: "desktop_launch_app",
      description:
        "KOMPUTER (Windows): uruchom lokalny program. Podaj nazwę (np. notatnik, kalkulator, eksplorator, spotify, chrome, word, excel, ustawienia, menedzer zadań) lub ścieżkę/polecenie. Używaj, gdy użytkownik prosi o otwarcie programu na komputerze.",
      input_schema: obj({ app: str("Nazwa programu lub ścieżka") }, ["app"]),
    },
    run: ({ app }) => launchApp(app),
  },
  {
    def: {
      name: "desktop_open",
      description:
        "KOMPUTER (Windows): otwórz plik, folder lub adres URL w domyślnej aplikacji systemu. Np. 'C:/Users/.../raport.pdf', 'C:/Pobrane' albo 'https://...'.",
      input_schema: obj({ target: str("Ścieżka do pliku/folderu lub URL") }, ["target"]),
    },
    run: ({ target }) => openOnPc(target),
  },
  {
    def: {
      name: "desktop_power",
      description:
        "KOMPUTER (Windows): akcja zasilania — lock (zablokuj), sleep (uśpij), restart (uruchom ponownie), shutdown (wyłącz), logoff (wyloguj). Wymaga potwierdzenia użytkownika.",
      input_schema: obj(
        { action: { type: "string", enum: ["lock", "sleep", "restart", "shutdown", "logoff"], description: "Akcja zasilania" } },
        ["action"],
      ),
    },
    run: ({ action }) => powerPc(action),
  },
  {
    def: {
      name: "desktop_volume",
      description: "KOMPUTER (Windows): głośność systemu — up (głośniej), down (ciszej), mute (wycisz/włącz dźwięk).",
      input_schema: obj(
        { action: { type: "string", enum: ["up", "down", "mute"], description: "Zmiana głośności" } },
        ["action"],
      ),
    },
    run: ({ action }) => volumePc(action),
  },
  {
    def: {
      name: "desktop_media",
      description:
        "KOMPUTER (Windows): sterowanie odtwarzaniem multimediów (Spotify, YouTube, odtwarzacz) — playpause, next, prev, stop. Działa globalnie, niezależnie od aktywnego okna.",
      input_schema: obj(
        { action: { type: "string", enum: ["playpause", "next", "prev", "stop"], description: "Akcja odtwarzania" } },
        ["action"],
      ),
    },
    run: ({ action }) => mediaPc(action),
  },
  {
    def: {
      name: "desktop_type",
      description:
        "KOMPUTER (Windows): wpisz tekst (jakbyś pisał na klawiaturze). Opcjonalnie podaj 'window' = fragment tytułu okna, do którego wpisać (np. 'Notatnik') — JARVIS aktywuje to okno przed pisaniem. Najpierw uruchom/aktywuj docelowy program.",
      input_schema: obj({ text: str("Tekst do wpisania"), window: str("Fragment tytułu okna docelowego (opcjonalnie)") }, ["text"]),
    },
    run: ({ text, window }) => typeText(text, window),
  },
  {
    def: {
      name: "desktop_hotkey",
      description:
        "KOMPUTER (Windows): naciśnij skrót klawiszowy, np. 'ctrl+s', 'ctrl+shift+t', 'alt+f4', 'ctrl+c'. Opcjonalnie 'window' = fragment tytułu okna docelowego. (Klawisz Windows nie jest obsługiwany.)",
      input_schema: obj({ combo: str("Skrót, np. ctrl+s"), window: str("Fragment tytułu okna (opcjonalnie)") }, ["combo"]),
    },
    run: ({ combo, window }) => desktopHotkey(combo, window),
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
      const key = store.settings.tavilyApiKey?.trim();
      if (!key) {
        return "Brak klucza Tavily — dodaj go w ⚙ Ustawienia (sekcja Research) albo użyj modelu Claude (ma wbudowane wyszukiwanie).";
      }
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: key, query, max_results: 5, include_answer: true, search_depth: "advanced" }),
      });
      // Przy awarii Tavily potrafi zwrócić HTML — nie wywalaj się na parsowaniu.
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) return `Błąd wyszukiwania (${data?.error || res.status}). Spróbuj ponownie za chwilę.`;
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
      name: "save_lead",
      description:
        "Zapisz lead (potencjalnego klienta) do Pulpitu Sprzedaży. Używaj po find_leads, aby zachować obiecujące firmy. Podaj nazwę, a jeśli znasz — stronę, kontakt, niszę, lokalizację, szacowaną wartość zlecenia (PLN) i krótką notatkę (czego im brakuje / kąt sprzedażowy).",
      input_schema: obj(
        {
          company: str("Nazwa firmy"),
          url: str("Strona WWW (opcjonalnie)"),
          contact: str("E-mail/telefon (opcjonalnie)"),
          niche: str("Nisza/branża (opcjonalnie)"),
          location: str("Miasto/region (opcjonalnie)"),
          value: { type: "number", description: "Szacowana wartość zlecenia w PLN (opcjonalnie)" },
          note: str("Notatka: czego im brakuje / kąt sprzedażowy (opcjonalnie)"),
        },
        ["company"],
      ),
    },
    run: ({ company, url, contact, niche, location, value, note }) => {
      const now = Date.now();
      let added = false;
      store.setData((d) => {
        const exists = d.leads.find((l) => l.company.toLowerCase() === String(company).toLowerCase());
        if (exists) {
          Object.assign(exists, { url: url || exists.url, contact: contact || exists.contact, niche: niche || exists.niche, location: location || exists.location, value: value ?? exists.value, note: note || exists.note, updatedAt: now });
        } else {
          d.leads.unshift({ id: uid(), company, url, contact, niche, location, value: Number(value) || undefined, note, status: "new", createdAt: now, updatedAt: now });
          added = true;
        }
      });
      return added ? `Zapisałem lead: ${company}.` : `Zaktualizowałem lead: ${company}.`;
    },
  },
  {
    def: {
      name: "list_leads",
      description: "Wypisz zapisane leady z Pulpitu Sprzedaży (z ich statusem i wartością).",
      input_schema: obj({}),
    },
    run: () => {
      const { leads } = store.data;
      if (!leads.length) return "Pulpit Sprzedaży jest pusty. Użyj find_leads, by znaleźć firmy.";
      const PL: Record<string, string> = { new: "nowy", contacted: "kontakt", offer: "oferta", won: "KLIENT", lost: "odrzucony" };
      return leads
        .map((l) => `• ${l.company} [${PL[l.status] || l.status}]${l.value ? ` ~${l.value} zł` : ""}${l.url ? ` · ${l.url}` : ""}${l.contact ? ` · ${l.contact}` : ""}`)
        .join("\n");
    },
  },
  {
    def: {
      name: "find_leads",
      description:
        "Znajdź potencjalnych klientów (leady) dla biznesu: lokalne firmy w danej niszy i lokalizacji, z publicznych źródeł (Tavily). Zwraca listę firm z linkami i opisem. PO UŻYCIU ułóż z tego czytelną TABELĘ leadów (firma, strona/kontakt, czego im brakuje, kąt sprzedażowy) i zaproponuj gotowy, krótki szkic oferty oraz następny krok.",
      input_schema: obj(
        {
          niche: str("Nisza/branża, np. 'gabinet stomatologiczny', 'fryzjer', 'kancelaria'"),
          location: str("Miasto lub region, np. 'Kraków'"),
          count: { type: "number", description: "Ile leadów (3–15, domyślnie 8)" },
        },
        ["niche", "location"],
      ),
    },
    run: async ({ niche, location, count }) => {
      const key = store.settings.tavilyApiKey?.trim();
      if (!key) return "Brak klucza Tavily — dodaj go w ⚙ → AI (sekcja Research), aby szukać leadów z publicznych źródeł.";
      const n = Math.min(15, Math.max(3, Number(count) || 8));
      const query = `${niche} ${location} firma oferta kontakt strona`;
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: key, query, max_results: n, include_answer: true, search_depth: "advanced" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) return `Błąd wyszukiwania leadów (${data?.error || res.status}). Spróbuj ponownie za chwilę.`;
      const results: any[] = data.results || [];
      if (!results.length) return `Nie znalazłem firm dla „${niche}" w „${location}". Spróbuj inną niszę/lokalizację.`;
      results.forEach((r) => citationBuffer.push({ title: r.title || r.url, url: r.url }));
      return (
        `Znalezione firmy (${niche}, ${location}) — surowe wyniki do analizy:\n\n` +
        results
          .map((r, i) => `[${i + 1}] ${r.title}\nWWW: ${r.url}\n${(r.content || "").slice(0, 300)}`)
          .join("\n\n")
      );
    },
  },
  {
    def: {
      name: "add_tally_item",
      description:
        "Dopisz pozycję do bieżącego rachunku/targu z ceną (np. na giełdzie). Rozbij wypowiedź na nazwę, ilość i cenę jednostkową. Przykłady: „koszyk truskawek po 15” → name='koszyk truskawek', qty=1, unit_price=15; „dwa pęczki szparagów po 8” → name='pęczek szparagów', qty=2, unit_price=8. Po dodaniu podaj sumę.",
      input_schema: obj(
        {
          name: str("Nazwa pozycji"),
          qty: { type: "number", description: "Ilość (domyślnie 1)" },
          unit_price: { type: "number", description: "Cena za sztukę" },
        },
        ["name", "unit_price"],
      ),
    },
    run: ({ name, qty, unit_price, price }) => {
      const q = Number(qty) || 1;
      // Tolerancja aliasów: modele czasem wysyłają „price" zamiast „unit_price".
      const up = Number(unit_price ?? price) || 0;
      store.setData((d) => d.tally.unshift({ id: uid(), name, qty: q, unitPrice: up, createdAt: Date.now() }));
      const total = store.data.tally.reduce((s, t) => s + t.qty * t.unitPrice, 0);
      return `Dodano: ${q}× ${name} po ${up} = ${(q * up).toFixed(2)}. Razem na rachunku: ${total.toFixed(2)}.`;
    },
  },
  {
    def: {
      name: "tally_report",
      description: "Podlicz i przedstaw raport bieżącego rachunku/targu: pozycje, ilości, ceny i sumę.",
      input_schema: obj({}),
    },
    run: () => {
      const items = store.data.tally;
      if (!items.length) return "Rachunek jest pusty.";
      const lines = [...items]
        .reverse()
        .map((t) => `• ${t.qty}× ${t.name} po ${t.unitPrice.toFixed(2)} = ${(t.qty * t.unitPrice).toFixed(2)}`);
      const total = items.reduce((s, t) => s + t.qty * t.unitPrice, 0);
      return `${lines.join("\n")}\n———\nRAZEM (${items.length} poz.): ${total.toFixed(2)}`;
    },
  },
  {
    def: {
      name: "clear_tally",
      description: "Wyczyść bieżący rachunek/targ (nowa sesja liczenia).",
      input_schema: obj({}),
    },
    run: () => {
      const n = store.data.tally.length;
      store.setData((d) => { d.tally = []; });
      return `Rachunek wyczyszczony (${n} poz.).`;
    },
  },
  {
    def: {
      name: "set_timer",
      description: "Ustaw minutnik na podaną liczbę minut (powiadomienie). Np. „ustaw minutnik na 10 minut”.",
      input_schema: obj({ minutes: { type: "number", description: "Liczba minut" }, label: str("Etykieta (opcjonalnie)") }, ["minutes"]),
    },
    run: ({ minutes, label }) => {
      void scheduleTimer(Number(minutes), label);
      return `Minutnik ustawiony na ${minutes} min${label ? ` — ${label}` : ""}.`;
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
  {
    def: {
      name: "create_flashcards",
      description:
        "Utwórz fiszki do nauki (Kapsuły Wiedzy) z podanego materiału lub tematu — do trwałego zapamiętania przez powtórki w czasie. Używaj, gdy użytkownik chce się czegoś nauczyć/zapamiętać, albo po dłuższym wyjaśnieniu/researchu zaproponuj zapis kluczowych rzeczy jako fiszki.",
      input_schema: obj(
        {
          material: str("Materiał źródłowy lub temat, z którego zrobić fiszki"),
          deck: str("Nazwa talii/tematu (opcjonalnie)"),
          count: { type: "number", description: "Ile fiszek (1–15, domyślnie 8)" },
        },
        ["material"],
      ),
    },
    run: async ({ material, deck, count }) => {
      const n = Math.min(15, Math.max(1, Number(count) || 8));
      const r = await generateCards(String(material), deck, "JARVIS", n);
      return "error" in r ? r.error : `Dodałem ${r.added} fiszek do Kapsuł Wiedzy${deck ? ` (talia „${deck}")` : ""}. Powtórzysz je w ⋯ → 🧠 Kapsuły Wiedzy.`;
    },
  },
  {
    def: {
      name: "run_automation",
      description:
        "Uruchom realną automatyzację w n8n (warstwa wykonawcza) — JARVIS faktycznie WYKONUJE zadanie, nie tylko o nim mówi: wysyłka maili/outreach, deployment, research, integracje (CRM, WHOOP, finanse). Podaj krótką nazwę akcji i szczegóły. Używaj, gdy użytkownik prosi o wykonanie czegoś, co obsługuje jego n8n.",
      input_schema: obj(
        { action: str("Nazwa zadania, np. send_outreach, deploy_site, sync_whoop"), details: str("Szczegóły/parametry zadania (opcjonalnie)") },
        ["action"],
      ),
    },
    run: async ({ action, details }) => {
      const r = await runAutomation(String(action), details);
      return r.ok ? `Automatyzacja „${action}" wykonana. ${r.result || ""}`.trim() : `Nie udało się: ${r.error}`;
    },
  },
  {
    def: {
      name: "get_news",
      description: "Pobierz najnowsze wiadomości na temat ze źródłami (przez research Tavily). Używaj na pytania o aktualności/newsy.",
      input_schema: obj({ topic: str("Temat wiadomości") }, ["topic"]),
    },
    run: async ({ topic }) => {
      const key = store.settings.tavilyApiKey?.trim();
      if (!key) return "Najnowsze wiadomości wymagają klucza Tavily (⚙ → AI, darmowy) — albo użyj modelu Claude z wbudowanym wyszukiwaniem.";
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: key, query: `najnowsze wiadomości: ${topic}`, topic: "news", max_results: 6, include_answer: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) return `Nie udało się pobrać wiadomości (${data?.error || res.status}).`;
      const items: any[] = data.results || [];
      items.forEach((r) => citationBuffer.push({ title: r.title || r.url, url: r.url }));
      const head = data.answer ? `${data.answer}\n\n` : "";
      return head + items.map((r, i) => `[${i + 1}] ${r.title}\n${(r.content || "").slice(0, 200)}\nŹródło: ${r.url}`).join("\n\n");
    },
  },
  {
    def: {
      name: "get_markets",
      description: "Notowania rynkowe: krypto (BTC/ETH/SOL…) w USD i PLN ze zmianą 24h oraz kursy walut. Używaj na pytania o ceny/kursy.",
      input_schema: obj(
        { crypto: str("Symbole krypto po przecinku (opcjonalnie)"), currency_from: str("Waluta bazowa kursu (opcjonalnie)"), currency_to: str("Waluta docelowa (opcjonalnie)") },
        [],
      ),
    },
    run: async ({ crypto, currency_from, currency_to }) => {
      const parts: string[] = [];
      if (crypto?.trim()) parts.push(await getCrypto(crypto.split(/[,\s]+/).filter(Boolean)));
      if (currency_from?.trim() || currency_to?.trim()) parts.push(await getRate(currency_from || "USD", currency_to || "PLN"));
      if (!parts.length) parts.push(await getCrypto(["bitcoin", "ethereum"]), await getRate("USD", "PLN"));
      return parts.join("\n");
    },
  },
];

export const toolDefs: ToolDef[] = tools.map((t) => t.def);

const executors: Record<string, Executor> = Object.fromEntries(tools.map((t) => [t.def.name, t.run]));

/**
 * Dynamiczna rejestracja narzędzia (Plugin API). Wtyczki dokładają własne
 * narzędzia do TEJ SAMEJ tablicy, którą mózg wysyła modelowi — model widzi je
 * natychmiast, a runTool wykonuje przez wspólną bramkę zgód i audyt.
 */
export function registerTool(def: ToolDef, run: Executor): void {
  if (!/^[a-z0-9_]+$/.test(def.name)) throw new Error(`Nieprawidłowa nazwa narzędzia: ${def.name}`);
  if (executors[def.name]) throw new Error(`Narzędzie „${def.name}" już istnieje.`);
  toolDefs.push(def);
  executors[def.name] = run;
}

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
