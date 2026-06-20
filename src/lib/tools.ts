import { store, uid } from "./store";
import { fetchTimeout } from "./http";
import { openService, call, sms, navigate, smartHome, openUrl, openCompose } from "./deviceControl";
import { canSendDirect, sendTestEmail, sendAllOffers, sendOfferEmail, isValidEmail, mailReadiness } from "./mailer";
import { getWeather } from "./weather";
import { scheduleReminder, scheduleTimer } from "./notifications";
import { addEvent, listUpcoming } from "./deviceCalendar";
import { callContact, textContact } from "./deviceContacts";
import { requestConsent, emitStep, audit, captureUndo } from "./permissions";
import { gmailSearch, gmailRead, gmailReply, gmailUnreadSummary, gcalList, gcalDay, gcalAdd } from "./google";
import { rememberFact } from "./memory";
import { generateCards } from "./cards";
import { runAutomation } from "./n8n";
import { getCrypto, getRate } from "./markets";
import { findLeads } from "./leads";
import { safeCalc } from "./calc";
import { openSalesOs, syncFromSalesOs, salesOsStatsText, pushLeadsToSalesOs, salesOsConfigured, outreachViaSalesOs, flushSalesOsOutreach, leadToOutreachInput, pushLeadStatusToSalesOs } from "./salesOs";
import { buildDossier, auditWeakPoints } from "./leadIntel";
import { callNowList, followUpsDue, followUpMessage, pipelineForecast, openLabel } from "./salesEngine";
import { syncSalesTasks, autoPlanSummary } from "./autoPlan";
import { launchApp, openOnPc, powerPc, volumePc, mediaPc, typeText, hotkey as desktopHotkey } from "./desktop";
import { PROVIDER_LIST, PROVIDERS } from "./providers/registry";
import { primaryKey } from "./keys";
import { exportData } from "./backup";
import { applyBrainMode, BRAIN_MODES, type BrainModeId } from "./brainModes";
import type { ProviderId } from "./providers/types";
import type { Citation, Settings, LeadStatus } from "../types";

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
      description: "Dodaj zadanie (Zadania Pro / styl Nozbe). Używaj, gdy użytkownik prosi o zapamiętanie czegoś do zrobienia. Możesz nadać priorytet (dzisiejszy fokus), przypisać do PROJEKTU po nazwie (utworzę go, jeśli nie istnieje), dodać kontekst (np. telefon, dom), osobę odpowiedzialną i powtarzalność.",
      input_schema: obj(
        {
          title: str("Treść zadania"),
          due: str("Termin ISO 8601 (opcjonalnie)"),
          project: str("Nazwa projektu (opcjonalnie) — utworzę, jeśli nie istnieje"),
          category: str("Kontekst/etykieta, np. telefon, dom, komputer (opcjonalnie)"),
          owner: str("Kto odpowiada (opcjonalnie)"),
          priority: { type: "boolean", description: "Priorytet — dzisiejszy fokus (opcjonalnie)" },
          repeat: { type: "string", enum: ["daily", "weekly", "monthly"], description: "Powtarzalność (opcjonalnie)" },
        },
        ["title"],
      ),
    },
    run: ({ title, due, project, category, owner, priority, repeat }) => {
      let projectId: string | undefined;
      if (project?.trim()) {
        const p = String(project).trim();
        const found = store.data.projects.find((x) => x.name.toLowerCase() === p.toLowerCase())
          || store.data.projects.find((x) => x.name.toLowerCase().includes(p.toLowerCase()));
        if (found) projectId = found.id;
        else { projectId = uid(); store.setData((d) => d.projects.unshift({ id: projectId!, name: p, instructions: "", createdAt: Date.now(), updatedAt: Date.now() })); }
      }
      store.setData((d) => d.tasks.unshift({ id: uid(), title, done: false, due, projectId, category: category?.trim() || undefined, owner: owner?.trim() || undefined, priority: !!priority, repeat: repeat as any, createdAt: Date.now() }));
      const extra = [project && `projekt ${project}`, priority && "priorytet", owner && `dla ${owner}`, due && `termin ${due}`].filter(Boolean).join(", ");
      return `Dodano zadanie: „${title}”${extra ? ` (${extra})` : ""}.`;
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
      const val = safeCalc(clean); // parser zamiast Function() — bez ryzyka wykonania kodu
      if (val === null) return "Błędne wyrażenie.";
      return `${raw} = ${Math.round(val * 1e6) / 1e6}`;
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

      // Dorzuć dzisiejszy kalendarz Google (desktop natywnie LUB backend) + nieprzeczytane maile.
      // silent=true → gdy niepołączone, NIE otwieramy logowania w tle; funkcje zwracają puste.
      {
        const [gcal, unread] = await Promise.all([
          gcalDay(0, true).catch(() => ""),
          gmailUnreadSummary().catch(() => ""),
        ]);
        if (gcal && !/niepołączone|Skonfiguruj|błąd|error/i.test(gcal)) lines.push(`Kalendarz Google — ${gcal.replace(/^📅\s*/, "")}`);
        if (unread) lines.push(unread);
      }

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
      const res = await fetchTimeout("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: key, query, max_results: 5, include_answer: true, search_depth: "advanced" }),
      }, 12000);
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
        "Znajdź realnych potencjalnych klientów (leady) — lokalne firmy z OpenStreetMap, z NAZWĄ, TELEFONEM, adresem i stroną. DZIAŁA OD RĘKI, za darmo, bez żadnego klucza. Nisza i lokalizacja są OPCJONALNE: bez lokalizacji użyje geolokalizacji, bez niszy znajdzie wszystkie lokalne firmy (priorytet: te BEZ strony www — idealni klienci dla agencji stron). Leady zapisują się od razu do Pulpitu Sprzedaży. AUTONOMIA: gdy użytkownik chce pełnego przygotowania (mówi np. przygotuj mi klientów / zrób profile / chcę być gotowy do rozmów / ogarnij leady za mnie) — ustaw with_dossiers=true: dla najgorętszych firm od razu powstaną teczki (audyt strony, słabe punkty, jak poprowadzić rozmowę, gotowy e-mail i skrypt). Rozumiej kontekst rozmowy: jeśli wcześniej padła branża/miasto/cel użytkownika, użyj ich bez dopytywania.",
      input_schema: obj(
        {
          niche: str("Nisza/branża (opcjonalnie), np. fryzjer, restauracja, warsztat"),
          location: str("Miasto (opcjonalnie), np. Kraków"),
          count: { type: "number", description: "Ile leadów (3–50, domyślnie z ustawień — 15)" },
          only_without_website: { type: "boolean", description: "Tylko firmy BEZ strony www (idealne dla agencji stron)" },
          with_dossiers: { type: "boolean", description: "Po znalezieniu od razu przygotuj TECZKI dla 3 najgorętszych (audyt + słabe punkty + plan rozmowy + e-mail + skrypt). Włącz, gdy użytkownik chce być gotowy do kontaktu." },
        },
        [],
      ),
    },
    run: async ({ niche, location, count, only_without_website, with_dossiers }) => {
      const r = await findLeads({ niche, location, count: Number(count) || undefined, onlyNoWebsite: !!only_without_website });
      if (r.error) return r.error;
      const lines = r.sample.map((l) => `• ${l.company}${l.phone ? ` — ☎ ${l.phone}` : ""}${l.hasWebsite ? "" : " (BEZ strony — idealny lead)"}`);
      let out = `Znalazłem ${r.found} firm w „${r.city}"${niche ? ` (${niche})` : ""} i zapisałem ${r.added} nowych do Pulpitu Sprzedaży (⋯ → 📈).\n\nPrzykłady:\n${lines.join("\n")}`;

      if (with_dossiers && r.addedLeads.length) {
        // Autonomicznie: teczki dla 3 najgorętszych (lista jest już posortowana — bez strony + telefon na górze).
        const top = r.addedLeads.slice(0, 3);
        const parts: string[] = [];
        for (const lead of top) {
          const d = await buildDossier(lead.id);
          if ("error" in d) { parts.push(`• ${lead.company}: ${d.error}`); continue; }
          const weak = auditWeakPoints(d.audit, !!lead.url);
          parts.push([
            `▸ ${lead.company} — szansa ${d.score}/100${lead.contact ? ` · ☎ ${lead.contact}` : ""}`,
            weak.length ? `  Słabe punkty: ${weak.slice(0, 3).map((w) => w.split(" — ")[0]).join("; ")}` : "  Strona OK — sprzedawaj rozbudowę.",
            d.analysis ? `  Jak podejść: ${d.analysis.split("\n").slice(-1)[0]?.slice(0, 160)}` : "",
          ].filter(Boolean).join("\n"));
        }
        out += `\n\nTECZKI GOTOWE (pełne analizy, e-maile i skrypty rozmów czekają w 📈 Pulpit → kliknij firmę):\n${parts.join("\n\n")}`;
      } else {
        out += `\n\nPowiedz „przygotuj teczkę dla [firma]" — zrobię audyt strony, analizę słabych punktów, e-mail i skrypt rozmowy.`;
      }
      return out;
    },
  },
  {
    def: {
      name: "sales_autopilot",
      description:
        "Autopilot sprzedaży: SAM zamień leady na konkretne zadania na dziś (telefony do gorących, otwartych, niezaczepionych firm + należne follow-upy) i domknij nieaktualne. Używaj, gdy użytkownik mówi: zrób to autonomicznie, ogarnij zadania, zorganizuj sprzedaż, działaj sam. Zadania trafiają do ✅ Zadania Pro → ⭐ Priorytet i do Planu Dnia.",
      input_schema: obj({}),
    },
    run: () => autoPlanSummary(syncSalesTasks()),
  },
  {
    def: {
      name: "sales_plan",
      description:
        "Pokaż PLAN SPRZEDAŻY NA DZIŚ z Pulpitu: do kogo dzwonić TERAZ (firmy otwarte, gorące, jeszcze niezaczepione), komu wysłać follow-up (ponaglenie — bo to one domykają sprzedaż) i ile realnie wisi w lejku. Używaj, gdy użytkownik pyta: co dziś robić, od czego zacząć, plan sprzedaży, kogo zaczepić, do kogo zadzwonić.",
      input_schema: obj({}),
    },
    run: () => {
      const leads = store.data.leads || [];
      if (!leads.length) return "Pulpit jest pusty. Powiedz: znajdź leady w [miasto], a przygotuję plan.";
      const now = new Date();
      const call = callNowList(leads, now).slice(0, 5);
      const fups = followUpsDue(leads).slice(0, 5);
      const f = pipelineForecast(leads);
      const parts: string[] = [`💰 W lejku: ${f.pipeline} zł · prognoza ważona: ${f.expected} zł · zarobione: ${f.won} zł.`];
      parts.push(call.length
        ? `\n📞 Dzwoń teraz:\n${call.map((l) => `• ${l.company}${l.contact ? ` (${l.contact})` : ""} — ${openLabel(l.hours, now).text}${l.intel ? `, szansa ${l.intel.score}/100` : ""}`).join("\n")}`
        : "\n📞 Brak firm do dzwonienia w tej chwili (zaczepione albo zamknięte).");
      parts.push(fups.length
        ? `\n🔁 Follow-up dzisiaj (${fups.length}):\n${fups.map((l) => `• ${l.company} — ponaglenie #${(l.followUpCount ?? 0) + 1}`).join("\n")}`
        : "\n🔁 Brak ponagleń na dziś.");
      parts.push("\nSzczegóły, gotowe treści i przyciski wysyłki: 📈 Pulpit Sprzedaży → 🎯 Plan na dziś.");
      return parts.join("\n");
    },
  },
  {
    def: {
      name: "lead_followup",
      description:
        "Napisz gotowe PONAGLENIE (follow-up) do leada, który nie odpowiedział. Podaj nazwę firmy z Pulpitu. Treść eskaluje delikatnie wg numeru kontaktu — nigdy nachalnie.",
      input_schema: obj({ company: str("Nazwa firmy (lead z Pulpitu)") }, ["company"]),
    },
    run: ({ company }) => {
      const q = String(company || "").toLowerCase().trim();
      const lead = store.data.leads.find((l) => l.company.toLowerCase().includes(q));
      if (!lead) return `Nie mam leada „${company}" w Pulpicie.`;
      return followUpMessage(lead, (lead.followUpCount ?? 0) + 1);
    },
  },
  {
    def: {
      name: "lead_dossier",
      description:
        "Przygotuj TECZKĘ KLIENTA dla zapisanego leada: techniczny audyt jego strony (HTTPS, wersja mobilna, SEO, kontakt), scoring szansy 0–100, analizę AI słabych punktów (problem → co tracą → rozwiązanie), spersonalizowany e-mail i skrypt rozmowy telefonicznej. Podaj nazwę firmy z Pulpitu Sprzedaży (dopasowanie częściowe). Wyniki zapisują się w leadzie (📈 Pulpit → kliknij firmę).",
      input_schema: obj({ company: str("Nazwa firmy (lead z Pulpitu Sprzedaży)") }, ["company"]),
    },
    run: async ({ company }) => {
      const q = String(company || "").toLowerCase().trim();
      const lead = store.data.leads.find((l) => l.company.toLowerCase().includes(q));
      if (!lead) return `Nie mam leada „${company}" w Pulpicie. Użyj find_leads albo save_lead.`;
      const r = await buildDossier(lead.id);
      if ("error" in r) return r.error;
      const weak = auditWeakPoints(r.audit, !!lead.url);
      return [
        `Teczka gotowa: ${lead.company} — szansa ${r.score}/100.`,
        weak.length ? `Słabe punkty:\n${weak.map((w) => `• ${w}`).join("\n")}` : "Strona w dobrym stanie — sprzedawaj rozbudowę.",
        r.analysis ? `\nANALIZA:\n${r.analysis}` : "",
        r.email ? `\nE-MAIL (gotowy do wysłania):\n${r.email}` : "",
        `\nPełna teczka (skrypt rozmowy, przyciski wysyłki): 📈 Pulpit Sprzedaży → kliknij „${lead.company}".`,
      ].filter(Boolean).join("\n");
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
      description: "Przeszukaj skrzynkę Gmail (wymaga połączonego konta Google przez backend). query w składni Gmaila, np. 'is:unread from:szef'. Zwraca listę z [id] każdej wiadomości — użyj go w gmail_read/gmail_reply.",
      input_schema: obj({ query: str("Zapytanie Gmail (opcjonalne)") }),
    },
    run: ({ query }) => gmailSearch(query || ""),
  },
  {
    def: {
      name: "gmail_read",
      description: "Przeczytaj PEŁNĄ treść e-maila po id (z gmail_search). Zwraca nadawcę, temat, treść oraz threadId i messageId potrzebne do odpowiedzi w wątku.",
      input_schema: obj({ id: str("id wiadomości z gmail_search") }, ["id"]),
    },
    run: ({ id }) => gmailRead(id),
  },
  {
    def: {
      name: "gmail_reply",
      description: "Odpowiedz na e-mail W TYM SAMYM WĄTKU. Najpierw gmail_read, by poznać nadawcę, threadId i messageId. Podaj to=adres nadawcy, subject=temat oryginału (dopisze się „Re:”), threadId i inReplyTo=messageId.",
      input_schema: obj(
        { to: str("Adres nadawcy oryginału"), subject: str("Temat oryginału"), body: str("Treść odpowiedzi"), threadId: str("threadId z gmail_read"), inReplyTo: str("messageId z gmail_read") },
        ["to", "subject", "body"],
      ),
    },
    run: ({ to, subject, body, threadId, inReplyTo }) => gmailReply(to, subject, body, threadId, inReplyTo),
  },
  {
    def: {
      name: "gmail_send",
      description: "Wyślij e-mail PROSTO Z JARVIS-a, bez wychodzenia z aplikacji — używa dowolnego skonfigurowanego kanału (SMTP komputera, przekaźnik SMTP przez backend, albo Gmail). Zapisuje w Skrzynce wysłanych. Dopiero gdy NIC nie jest skonfigurowane, otwiera gotową wiadomość. Zawsze działa — używaj śmiało, nie wspominaj o n8n.",
      input_schema: obj({ to: str("Adres odbiorcy"), subject: str("Temat"), body: str("Treść") }, ["to", "subject", "body"]),
    },
    run: async ({ to, subject, body }) => {
      const addr = String(to || "").trim();
      if (!isValidEmail(addr)) return `Adres „${addr}" nie wygląda na e-mail (przykład: firma@domena.pl).`;
      // Inteligentny wybór kanału (SMTP/przekaźnik/Gmail) — wysyłka W APLIKACJI.
      if (canSendDirect()) {
        const r = await sendOfferEmail(addr, String(subject || ""), String(body || ""));
        if (r.ok) return `✅ Wysłano e-mail do ${addr} (${r.via}). Zapisałem w 📤 Skrzynce wysłanych.`;
        // Błąd „dokończ konfigurację" (połącz Google / hasło aplikacji) → poprowadź, zostań w aplikacji.
        if (/Połącz|zezwól|Integracje|hasło aplikacji|Synchronizacj|Google|backend/i.test(r.error))
          return `Nie wysłałem automatycznie: ${r.error}`;
        // Realny błąd transportu → ostateczność: gotowa wiadomość.
        const opened = await openCompose(addr, String(subject || ""), String(body || ""));
        return `Automatyczna wysyłka nie wyszła (${r.error}). ${opened}`;
      }
      // Nic nieskonfigurowane → gotowa wiadomość + jak włączyć wysyłkę bez wychodzenia z aplikacji.
      const opened = await openCompose(addr, String(subject || ""), String(body || ""));
      return `${opened} Aby następnym razem wysłać bez wychodzenia z JARVIS-a: ${mailReadiness().reason}`;
    },
  },
  {
    def: {
      name: "gcal_list",
      description: "Wypisz nadchodzące wydarzenia z Kalendarza Google. Jeśli konto Google nie jest jeszcze połączone, JARVIS sam otworzy stronę autoryzacji — po prostu użyj narzędzia.",
      input_schema: obj({}),
    },
    run: () => gcalList(),
  },
  {
    def: {
      name: "gcal_day",
      description: "Odczytaj zapisy z Kalendarza Google na KONKRETNY dzień. dayOffset: 0=dziś, 1=jutro, -1=wczoraj. Użyj na pytania typu „co mam dziś/jutro w kalendarzu”.",
      input_schema: obj({ dayOffset: { type: "number", description: "0=dziś, 1=jutro, -1=wczoraj (domyślnie 0)" } }),
    },
    run: ({ dayOffset }) => gcalDay(Number(dayOffset) || 0),
  },
  {
    def: {
      name: "gcal_add",
      description: "Dodaj wydarzenie do Kalendarza Google. Jeśli konto nie jest połączone, JARVIS sam otworzy autoryzację — używaj śmiało. Daty w ISO 8601.",
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
      const res = await fetchTimeout("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: key, query: `najnowsze wiadomości: ${topic}`, topic: "news", max_results: 6, include_answer: true }),
      }, 12000);
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

  // === Sterowanie ustawieniami JARVIS-a głosem/czatem (automatyzacja) ===
  {
    def: {
      name: "set_voice",
      description:
        "Zmień ustawienia GŁOSU JARVIS-a na żądanie: barwę głosu (Gemini), charakter (persona), tempo mówienia albo włącz/wyłącz mówienie na głos. Używaj, gdy użytkownik prosi np. „zmień głos na głębszy”, „mów wolniej”, „bądź bardziej zwięzły”, „wycisz się”, „mów do mnie”.",
      input_schema: obj(
        {
          voice: { type: "string", enum: ["Charon", "Orus", "Fenrir", "Puck", "Kore", "Zephyr", "Aoede", "Leda"], description: "Barwa głosu Gemini (opcjonalnie). Charon = głęboki JARVIS." },
          persona: { type: "string", enum: ["classic", "concise", "warm", "witty", "operator"], description: "Charakter: classic (majordomus), concise (zwięzły), warm (ciepły), witty (dowcipny), operator (operacyjny). Opcjonalnie." },
          speed: { type: "string", enum: ["slower", "normal", "faster"], description: "Tempo mówienia (opcjonalnie)." },
          speak: { type: "boolean", description: "true = mów na głos, false = wycisz (opcjonalnie)." },
          pin: { type: "boolean", description: "true = przypnij STAŁY polski głos JARVISA (bez automatycznych podmian, zawsze ten sam). Użyj, gdy ktoś prosi „ustaw stały głos”, „nie zmieniaj głosu”." },
        },
        [],
      ),
    },
    run: ({ voice, persona, speed, speak, pin }) => {
      const patch: Partial<Settings> = {};
      const changed: string[] = [];
      if (voice) { patch.geminiVoice = String(voice); changed.push(`barwa: ${voice}`); }
      if (persona) { patch.persona = String(persona); changed.push(`charakter: ${persona}`); }
      if (speed) { patch.voiceRate = speed === "slower" ? 0.85 : speed === "faster" ? 1.15 : 1; changed.push(`tempo: ${speed === "slower" ? "wolniej" : speed === "faster" ? "szybciej" : "normalne"}`); }
      if (typeof speak === "boolean") { patch.speak = speak; changed.push(speak ? "głos włączony" : "głos wyciszony"); }
      if (typeof pin === "boolean") {
        patch.voicePinned = pin;
        if (pin) { patch.voiceSystemPl = true; patch.speak = true; }
        changed.push(pin ? "stały głos JARVISA przypięty (bez podmian)" : "stały głos odpięty");
      }
      if (!changed.length) return "Podaj, co zmienić w głosie: barwa (np. Charon), charakter (np. operator), tempo (slower/faster), speak true/false albo pin true (stały głos).";
      store.setSettings(patch);
      return `✅ Ustawienia głosu zmienione — ${changed.join(", ")}.`;
    },
  },
  {
    def: {
      name: "switch_ai",
      description:
        "Przełącz aktywnego dostawcę AI (mózg) lub model na żądanie — np. „przełącz na Claude”, „użyj Gemini”, „wróć do auto”. Działa tylko dla dostawców z wpisanym kluczem API; w razie braku podpowiada dostępnych.",
      input_schema: obj(
        {
          provider: str("Dostawca: auto, claude/anthropic, gemini, groq, cerebras, mistral, openrouter, nvidia, github, ollama."),
          model: str("Opcjonalnie id modelu albo 'auto'."),
        },
        ["provider"],
      ),
    },
    run: ({ provider, model }) => {
      const raw = String(provider || "").trim().toLowerCase();
      const alias: Record<string, string> = { claude: "anthropic", anthropic: "anthropic", google: "gemini", gemini: "gemini", groq: "groq", cerebras: "cerebras", mistral: "mistral", openrouter: "openrouter", nvidia: "nvidia", github: "github", ollama: "ollama", auto: "auto" };
      const id = alias[raw] || raw;
      const available = PROVIDER_LIST.filter((p) => primaryKey(p.id)).map((p) => p.id);
      const hasOllama = !!store.settings.ollamaUrl?.trim();
      if (id === "auto") {
        store.setSettings({ provider: "auto", model: "auto" });
        return "✅ Wybór mózgu AI: automatyczny (sam dobiorę najlepszy dostępny).";
      }
      if (!PROVIDERS[id as ProviderId]) {
        return `Nie znam dostawcy „${provider}”. Dostępni z kluczem: ${available.join(", ") || "brak — dodaj klucz w ⚙ → AI"}${hasOllama ? ", ollama" : ""}.`;
      }
      const ready = id === "ollama" ? hasOllama : !!primaryKey(id as ProviderId);
      if (!ready) {
        return `Nie masz klucza do „${PROVIDERS[id as ProviderId].label}”. Dostępni teraz: ${available.join(", ") || "brak"}${hasOllama ? ", ollama" : ""}. Klucz dodasz w ⚙ → AI.`;
      }
      const meta = PROVIDERS[id as ProviderId];
      const m = model && String(model).trim() && String(model).toLowerCase() !== "auto" ? String(model).trim() : meta.defaultModel;
      store.setSettings({ provider: id, model: m });
      return `✅ Mózg AI przełączony na ${meta.label} (model: ${m}).`;
    },
  },
  {
    def: {
      name: "set_theme",
      description:
        "Zmień motyw kolorystyczny interfejsu (HUD): cyan (domyślny), złoty, bursztyn, zielony, ocean, czerwony, róż, fiolet, Matrix, Nord, Sunset, Retro 95, XP. Np. „włącz motyw XP”, „zmień na Nord”.",
      input_schema: obj({ theme: str("cyan, gold/złoty, amber/bursztyn, green/zielony, ocean, red/czerwony, rose/róż, purple/fiolet, matrix, nord, sunset, retro, xp") }, ["theme"]),
    },
    run: ({ theme }) => {
      const map: Record<string, string> = {
        cyan: "default", default: "default", domyslny: "default", domyślny: "default", niebieski: "default",
        zloty: "gold", złoty: "gold", gold: "gold",
        bursztyn: "amber", bursztynowy: "amber", amber: "amber",
        zielony: "green", green: "green",
        ocean: "ocean", morski: "ocean",
        czerwony: "red", red: "red",
        roz: "rose", róż: "rose", rozowy: "rose", różowy: "rose", rose: "rose",
        fiolet: "purple", fioletowy: "purple", purple: "purple",
        matrix: "matrix",
        nord: "nord",
        sunset: "sunset", zachod: "sunset", zachód: "sunset",
        retro: "retro", "retro 95": "retro", win95: "retro", windows95: "retro",
        xp: "xp", "xp luna": "xp", luna: "xp", windowsxp: "xp", "windows xp": "xp",
      };
      const t = map[String(theme || "").trim().toLowerCase()];
      if (!t) return "Dostępne motywy: cyan, złoty, bursztyn, zielony, ocean, czerwony, róż, fiolet, matrix, nord, sunset, retro, xp.";
      store.setSettings({ theme: t });
      return `✅ Motyw interfejsu zmieniony na ${theme}.`;
    },
  },
  {
    def: {
      name: "set_mode",
      description:
        "Zmień tryb pracy JARVISA (skąd biorą się odpowiedzi): auto (zalecane — lokalnie gdy można, chmura gdy trzeba), online (zawsze chmura), offline (tylko urządzenie, prywatnie, bez sieci), lokalny/ollama (Ollama sama dobiera model). Np. „przełącz na tryb offline”, „używaj chmury”, „działaj lokalnie”.",
      input_schema: obj({ mode: str("auto, online/chmura, offline/prywatnie, lokalny/ollama") }, ["mode"]),
    },
    run: ({ mode }) => {
      const map: Record<string, BrainModeId> = {
        auto: "auto", automatyczny: "auto", hybryda: "auto", hybrydowy: "auto", zalecany: "auto",
        online: "online", chmura: "online", chmurowy: "online", "w chmurze": "online", siec: "online", sieć: "online",
        offline: "offline", prywatny: "offline", prywatnie: "offline", "na urzadzeniu": "offline", "na urządzeniu": "offline", "on-device": "offline", ondevice: "offline",
        ollama: "ollama", lokalny: "ollama", lokalnie: "ollama", local: "ollama",
      };
      const m = map[String(mode || "").trim().toLowerCase()];
      if (!m) return "Dostępne tryby: auto, online (chmura), offline (prywatnie), lokalny (Ollama).";
      applyBrainMode(m, []);
      const preset = BRAIN_MODES.find((b) => b.id === m);
      return `✅ Tryb pracy: ${preset?.title || m}. ${preset?.does || ""}`;
    },
  },
  {
    def: {
      name: "system_health",
      description:
        "Sprawdź KONDYCJĘ JARVISA (Strażnik): mózg/AI, serwery lokalne, głos, szybkość, integracje. Użyj, gdy ktoś pyta „jak się czujesz”, „sprawdź stan systemu”, „czy wszystko działa”, „diagnoza”, „co u ciebie”.",
      input_schema: obj({}, []),
    },
    run: async () => {
      // Dynamiczny import — unika cyklu modułów (tools ↔ brain ↔ guardianAgents).
      const { guardianScan } = await import("./guardianAgents");
      const scan = await guardianScan({ checkUpdate: false });
      const dot = (st: string) => (st === "ok" ? "🟢" : st === "warn" ? "🟡" : st === "problem" ? "🔴" : "⚪");
      const lines = [`🛡 Kondycja JARVISA: ${scan.health.score}/100 (${scan.health.label}).`];
      for (const a of scan.reports) lines.push(`${dot(a.state)} ${a.name}: ${a.summary}`);
      const top = scan.recs.find((r) => r.problem);
      if (top) lines.push(`Zalecenie: ${top.label}${top.problem ? ` — ${top.problem}` : ""}`);
      return lines.join("\n");
    },
  },
  {
    def: {
      name: "set_preference",
      description:
        "Zmień osobiste preferencje JARVIS-a na żądanie: jak ma się do Ciebie zwracać (imię), wyszukiwanie w sieci on/off, adaptacyjny układ menu on/off. Np. „mów do mnie Szefie”, „wyłącz wyszukiwanie w sieci”, „nie układaj menu pod moje nawyki”.",
      input_schema: obj(
        {
          name: str("Jak zwracać się do użytkownika, np. „Marcin”, „Szefie” (opcjonalnie)."),
          web_search: { type: "boolean", description: "Wyszukiwanie w sieci włączone (true) / wyłączone (false) (opcjonalnie)." },
          adaptive_menu: { type: "boolean", description: "Adaptacyjny układ menu wg nawyków on/off (opcjonalnie)." },
        },
        [],
      ),
    },
    run: ({ name, web_search, adaptive_menu }) => {
      const patch: Partial<Settings> = {};
      const changed: string[] = [];
      if (name && String(name).trim()) { patch.userName = String(name).trim().slice(0, 40); changed.push(`zwracam się: ${patch.userName}`); }
      if (typeof web_search === "boolean") { patch.webSearch = web_search; changed.push(web_search ? "wyszukiwanie w sieci: włączone" : "wyszukiwanie w sieci: wyłączone"); }
      if (typeof adaptive_menu === "boolean") { patch.adaptiveUi = adaptive_menu; changed.push(adaptive_menu ? "adaptacyjne menu: włączone" : "adaptacyjne menu: wyłączone"); }
      if (!changed.length) return "Podaj, co zmienić: imię (jak się zwracać), web_search true/false albo adaptive_menu true/false.";
      store.setSettings(patch);
      return `✅ Preferencje zaktualizowane — ${changed.join(", ")}.`;
    },
  },
  {
    def: {
      name: "backup_data",
      description:
        "Zrób kopię zapasową danych użytkownika (zadania, leady, notatki, kalendarz, skrzynka wysłanych, historia postów…) — pobiera plik JSON na urządzenie. Bez kluczy API, bezpieczny do przechowania. Np. „zrób kopię zapasową”, „wyeksportuj moje dane”.",
      input_schema: obj({}, []),
    },
    run: () => {
      exportData();
      return "✅ Kopia zapasowa pobrana — plik JSON z Twoimi danymi (bez kluczy API). Schowaj go w bezpiecznym miejscu; wczytasz go w ⚙ → Dane.";
    },
  },
  {
    def: {
      name: "send_test_email",
      description:
        "Wyślij testowy e-mail, żeby sprawdzić, czy wysyłka z aplikacji działa. Domyślnie na Twój własny adres; możesz podać inny w „to”. Wymaga skonfigurowanej poczty (⚙ → Poczta).",
      input_schema: obj({ to: str("Adres odbiorcy testu (opcjonalnie; domyślnie Twój adres z ⚙ Poczta).") }, []),
    },
    run: async ({ to }) => (await sendTestEmail(to ? String(to) : undefined)).message,
  },
  {
    def: {
      name: "send_offers_all",
      description:
        "Wyślij ofertę e-mail do WSZYSTKICH leadów, którzy mają adres e-mail i nie byli jeszcze mailowani (resztę pomija). Dla każdego pisze ofertę (jeśli brak) i wysyła. Domyślnie maks. 25 na turę (limity Gmaila). Wymaga skonfigurowanej poczty. Używaj, gdy użytkownik mówi: wyślij do wszystkich, roześlij oferty, mailing do leadów.",
      input_schema: obj({ max: { type: "number", description: "Maks. liczba maili w tej turze (1–50, domyślnie 25)." } }, []),
    },
    run: async ({ max }) => {
      if (!canSendDirect()) {
        return "Najpierw skonfiguruj pocztę: ⚙ → Poczta (adres Gmail + hasło aplikacji); na telefonie dodatkowo ⚙ → Synchronizacja (backend). Bez tego oferty wyślesz ręcznie z 📈 Pulpitu (przycisk „Napisz i otwórz pocztę”).";
      }
      const cap = Math.min(50, Math.max(1, Number(max) || 25));
      const r = await sendAllOffers(cap);
      if (r.total === 0) return "Pulpit jest pusty — najpierw znajdź leady (np. „znajdź leady fryzjer Poznań”).";
      const parts = [`✅ Wysłano ${r.sent} ${r.sent === 1 ? "ofertę" : "ofert"}.`];
      if (r.alreadyEmailed) parts.push(`↪︎ pominięto ${r.alreadyEmailed} już mailowanych`);
      if (r.noEmail) parts.push(`✉️ pominięto ${r.noEmail} bez adresu e-mail`);
      if (r.failed) parts.push(`⚠ nieudane: ${r.failed}${r.errors.length ? ` (${r.errors.join("; ")})` : ""}`);
      if (r.sent >= cap) parts.push(`osiągnięto limit ${cap}/turę — powtórz, by wysłać kolejne`);
      return parts.join(" · ");
    },
  },
  {
    def: {
      name: "salesos_open",
      description:
        "Otwórz osobną aplikację AI Sales OS w przeglądarce (pełny CRM do pozyskiwania klientów). Używaj, gdy użytkownik chce „otworzyć Sales OS / wejść do CRM-u / przejść do panelu sprzedaży”. Wymaga ustawionego adresu (⚙ → Integracje).",
      input_schema: obj({}, []),
    },
    run: () => (openSalesOs() ? "Otwieram AI Sales OS." : "AI Sales OS nie jest skonfigurowany — podaj adres w ⚙ → Integracje."),
  },
  {
    def: {
      name: "salesos_sync",
      description:
        "Pobierz (read-only) leady z osobnej aplikacji AI Sales OS do Pulpitu Sprzedaży JARVIS-a (dedup po nazwie firmy). Używaj, gdy użytkownik mówi „zsynchronizuj Sales OS / ściągnij leady z CRM-u / zaktualizuj leady z Sales OS”.",
      input_schema: obj({}, []),
    },
    run: async () => (await syncFromSalesOs()).message,
  },
  {
    def: {
      name: "salesos_stats",
      description:
        "Pokaż wgląd/statystyki z AI Sales OS: liczba leadów, otwarte/klienci/odrzuceni i wartość wygranych. Używaj na pytania typu „ile mam leadów w Sales OS / jak idzie sprzedaż w CRM / podsumuj pipeline z Sales OS”.",
      input_schema: obj({}, []),
    },
    run: () => salesOsStatsText(),
  },
  {
    def: {
      name: "salesos_push",
      description:
        "Odeślij leady znalezione w JARVIS-ie do AI Sales OS (źródła prawdy) — tam zostaną zescoringowane i wpadną do lejka. Domyślnie wysyła świeże leady (status „nowy”). Używaj, gdy użytkownik mówi „wyślij leady do Sales OS / dodaj te firmy do CRM-u / przerzuć leady do Sales OS”.",
      input_schema: obj({}, []),
    },
    run: async () => {
      if (!salesOsConfigured()) return "AI Sales OS nie jest skonfigurowany — podaj adres i token w ⚙ → Integracje.";
      return (await pushLeadsToSalesOs()).message;
    },
  },
  {
    def: {
      name: "salesos_email",
      description:
        "Zleć AI Sales OS-owi napisanie i WYSŁANIE maila (pierwszy kontakt) do leada — treść i wysyłka dzieją się w Sales OS (źródło prawdy: scoring, kolejka akceptacji, dostawca poczty). Używaj na: „napisz i wyślij mail do <firma> przez Sales OS / odezwij się do <firma> mailowo z CRM / wyślij ofertę do <firma>”. Podaj firmę (znajdę jej e-mail w Pulpicie) lub bezpośrednio e-mail. Ustaw draft_only=true, gdy użytkownik chce tylko szkic do akceptacji (bez wysyłki).",
      input_schema: obj(
        {
          company: str("Nazwa firmy/leada z Pulpitu (znajdę kontakt) — opcjonalnie, jeśli podasz e-mail"),
          email: str("Adres e-mail odbiorcy (opcjonalnie, jeśli podasz firmę)"),
          context: str("Kontekst dla AI: co oferujemy / czego im brakuje (opcjonalnie)"),
          draft_only: { type: "boolean", description: "Tylko szkic do kolejki akceptacji, bez wysyłki (opcjonalnie)" },
        },
        [],
      ),
    },
    run: async ({ company, email, context, draft_only }) => {
      if (!salesOsConfigured()) return "AI Sales OS nie jest skonfigurowany — podaj adres i token w ⚙ → Integracje.";
      const send = draft_only !== true;
      if (company?.trim()) {
        const c = String(company).trim().toLowerCase();
        const lead = (store.data.leads || []).find((l) => l.company.toLowerCase() === c)
          || (store.data.leads || []).find((l) => l.company.toLowerCase().includes(c));
        if (lead) {
          const input = leadToOutreachInput(lead, context);
          input.send = send;
          if (email?.trim()) input.email = String(email).trim();
          return (await outreachViaSalesOs(input)).message;
        }
        if (!email?.trim()) return `Nie mam „${company}" w Pulpicie. Podaj e-mail albo najpierw znajdź/zsynchronizuj leada.`;
      }
      if (!email?.trim()) return "Podaj firmę (z Pulpitu) lub adres e-mail odbiorcy.";
      return (await outreachViaSalesOs({ email: String(email).trim(), companyName: company?.trim(), context: context?.trim(), send })).message;
    },
  },
  {
    def: {
      name: "salesos_flush_emails",
      description:
        "Auto-wyślij zaległe szkice maili z kolejki akceptacji AI Sales OS (do dziennego limitu firmy). Używaj na: „wyślij wszystkie zaległe maile z CRM / opróżnij kolejkę Sales OS / roześlij przygotowane wiadomości”.",
      input_schema: obj({ max: { type: "number", description: "Maks. liczba maili do wysłania (opcjonalnie)" } }, []),
    },
    run: async ({ max }) => {
      if (!salesOsConfigured()) return "AI Sales OS nie jest skonfigurowany — podaj adres i token w ⚙ → Integracje.";
      return (await flushSalesOsOutreach(typeof max === "number" ? max : undefined)).message;
    },
  },
  {
    def: {
      name: "salesos_set_status",
      description:
        "Zmień status leada i wypchnij tę zmianę do lejka AI Sales OS (dwukierunkowo). Używaj na: „oznacz <firma> jako klienta / przesuń <firma> na ofertę / <firma> odrzucił / <firma> już po kontakcie”. Statusy: new (nowy), contacted (kontakt), offer (oferta), won (klient), lost (odrzucony).",
      input_schema: obj(
        {
          company: str("Nazwa firmy/leada z Pulpitu"),
          status: { type: "string", enum: ["new", "contacted", "offer", "won", "lost"], description: "Nowy status leada" },
        },
        ["company", "status"],
      ),
    },
    run: async ({ company, status }) => {
      const c = String(company || "").trim().toLowerCase();
      if (!c) return "Podaj firmę, której status mam zmienić.";
      const lead = (store.data.leads || []).find((l) => l.company.toLowerCase() === c)
        || (store.data.leads || []).find((l) => l.company.toLowerCase().includes(c));
      if (!lead) return `Nie mam „${company}" w Pulpicie. Najpierw znajdź/zsynchronizuj leada.`;
      const st = status as LeadStatus;
      store.setData((d) => { const l = d.leads.find((x) => x.id === lead.id); if (l) { l.status = st; l.updatedAt = Date.now(); } });
      if (!salesOsConfigured() || lead.origin !== "salesos") {
        return `✅ Status „${lead.company}" → ${st} (lokalnie).`;
      }
      const r = await pushLeadStatusToSalesOs({ ...lead, status: st }, st);
      return r ? r.message : `✅ Status „${lead.company}" → ${st}.`;
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
