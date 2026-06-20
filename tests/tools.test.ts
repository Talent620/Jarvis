// @vitest-environment jsdom
// Testy KAŻDEGO narzędzia agenta:
//  1) walidacja definicji (nazwy, schematy) — wszystkie 40+,
//  2) klasyfikacja ryzyka — każde ma sensowny poziom,
//  3) wykonanie narzędzi lokalnych (store) przez runTool,
//  4) łagodna degradacja narzędzi wymagających konfiguracji (bez kluczy → czytelny
//     komunikat zamiast wyjątku/żądania sieciowego).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toolDefs, runTool } from "../src/lib/tools";
import { riskOf } from "../src/lib/permissions";
import { store } from "../src/lib/store";

// Test hermetyczny: żadne narzędzie nie sięga do realnej sieci (np. daily_briefing
// → pogoda). Stub fetch odrzuca natychmiast, więc działania kończą się szybko.
const realFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn(() => Promise.reject(new Error("offline test"))) as any;
});
afterEach(() => {
  global.fetch = realFetch;
});

beforeEach(() => {
  store.setData((d) => {
    d.tasks = [];
    d.notes = [];
    d.reminders = [];
    d.shopping = [];
    d.calendar = [];
    d.memory = [];
    d.scenes = [];
    d.tally = [];
    d.journal = [];
    d.audit = [];
  });
  store.setSettings({ tavilyApiKey: "", homeAssistantUrl: "", homeAssistantToken: "", syncUrl: "", syncToken: "" });
});

describe("definicje narzędzi (wszystkie)", () => {
  it("ma unikalne nazwy", () => {
    const names = toolDefs.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(toolDefs.map((d) => [d.name, d] as const))("%s — poprawny schemat", (_n, d) => {
    expect(d.name).toMatch(/^[a-z0-9_]+$/); // bezpieczne dla wszystkich API
    expect(d.description.length).toBeGreaterThan(10);
    const schema = d.input_schema as any;
    expect(schema.type).toBe("object");
    expect(schema.properties).toBeTypeOf("object");
    // każde pole z required istnieje w properties (inaczej Gemini/OpenAI odrzucą)
    for (const req of schema.required || []) {
      expect(Object.keys(schema.properties)).toContain(req);
    }
  });

  it.each(toolDefs.map((d) => [d.name] as const))("%s — ma klasyfikację ryzyka", (name) => {
    expect(["read", "write", "outbound"]).toContain(riskOf(name));
  });
});

describe("narzędzia lokalne — wykonanie end-to-end (runTool)", () => {
  it("add_task → complete_task → list_tasks", async () => {
    expect(await runTool("add_task", { title: "kupić mleko" })).toMatch(/Dodano zadanie/);
    expect(store.data.tasks).toHaveLength(1);
    expect(await runTool("complete_task", { query: "mleko" })).toMatch(/wykonane/);
    expect(store.data.tasks[0].done).toBe(true);
    expect(await runTool("list_tasks", {})).toContain("kupić mleko");
  });

  it("add_note → list_notes", async () => {
    expect(await runTool("add_note", { text: "pomysł na projekt" })).toMatch(/zapisana/);
    expect(await runTool("list_notes", {})).toContain("pomysł na projekt");
  });

  it("set_theme zmienia motyw (Matrix) i odrzuca nieznany", async () => {
    expect(await runTool("set_theme", { theme: "matrix" })).toMatch(/Matrix|matrix/);
    expect(store.settings.theme).toBe("matrix");
    expect(await runTool("set_theme", { theme: "zloty" })).toMatch(/złoty|zloty|gold|✅/i);
    expect(store.settings.theme).toBe("gold");
    expect(await runTool("set_theme", { theme: "tęcza" })).toMatch(/Dostępne motywy/);
    // Nowe motywy rozpoznawane po nazwie (też potocznej).
    await runTool("set_theme", { theme: "XP" });
    expect(store.settings.theme).toBe("xp");
    await runTool("set_theme", { theme: "nord" });
    expect(store.settings.theme).toBe("nord");
    await runTool("set_theme", { theme: "zachód" });
    expect(store.settings.theme).toBe("sunset");
    await runTool("set_theme", { theme: "win95" });
    expect(store.settings.theme).toBe("retro");
  });

  it("set_mode przełącza tryb pracy (offline/online/lokalny/auto) i odrzuca nieznany", async () => {
    await runTool("set_mode", { mode: "offline" });
    expect(store.settings.onDeviceOnly).toBe(true);
    await runTool("set_mode", { mode: "chmura" });
    expect(store.settings.onDeviceOnly).toBe(false);
    expect(store.settings.provider).toBe("auto");
    await runTool("set_mode", { mode: "lokalny" });
    expect(store.settings.provider).toBe("ollama");
    await runTool("set_mode", { mode: "auto" });
    expect(store.settings.localFirstSimple).toBe(true);
    expect(await runTool("set_mode", { mode: "xyz" })).toMatch(/Dostępne tryby/);
  });

  it("system_health zwraca kondycję JARVISA (wynik + agenci)", async () => {
    const r = await runTool("system_health", {});
    expect(r).toMatch(/Kondycja JARVISA: \d+\/100/);
    expect(r).toMatch(/Inteligencja \(AI\)|Głos|Wydajność/);
  });

  it("set_voice zmienia barwę, charakter, tempo i mówienie", async () => {
    const r = await runTool("set_voice", { voice: "Charon", persona: "operator", speed: "slower", speak: false });
    expect(r).toMatch(/✅/);
    expect(store.settings.geminiVoice).toBe("Charon");
    expect(store.settings.persona).toBe("operator");
    expect(store.settings.voiceRate).toBeCloseTo(0.85);
    expect(store.settings.speak).toBe(false);
    expect(await runTool("set_voice", {})).toMatch(/Podaj, co zmienić/);
    // Przypięcie stałego głosu JARVISA (Voice Guardian) komendą.
    await runTool("set_voice", { pin: true });
    expect(store.settings.voicePinned).toBe(true);
    expect(store.settings.voiceSystemPl).toBe(true);
    expect(store.settings.speak).toBe(true);
  });

  it("set_preference zmienia imię, wyszukiwanie i adaptacyjne menu", async () => {
    const r = await runTool("set_preference", { name: "Szefie", web_search: false, adaptive_menu: false });
    expect(r).toMatch(/✅/);
    expect(store.settings.userName).toBe("Szefie");
    expect(store.settings.webSearch).toBe(false);
    expect(store.settings.adaptiveUi).toBe(false);
    expect(await runTool("set_preference", {})).toMatch(/Podaj, co zmienić/);
  });

  it("switch_ai: auto, przełączenie z kluczem, brak klucza → podpowiedź", async () => {
    expect(await runTool("switch_ai", { provider: "auto" })).toMatch(/automatyczny/);
    expect(store.settings.provider).toBe("auto");
    // bez klucza Claude → czytelna podpowiedź, brak przełączenia
    store.setSettings({ keys: {}, provider: "auto" });
    expect(await runTool("switch_ai", { provider: "claude" })).toMatch(/Nie masz klucza|Dostępni/);
    expect(store.settings.provider).toBe("auto");
    // z kluczem Gemini → przełącza na gemini
    store.setSettings({ keys: { gemini: "AIzaTESTKEY" } });
    const r = await runTool("switch_ai", { provider: "gemini" });
    expect(r).toMatch(/przełączony|Gemini/i);
    expect(store.settings.provider).toBe("gemini");
  });

  it("add_reminder zapisuje przypomnienie", async () => {
    const at = new Date(Date.now() + 3600_000).toISOString();
    expect(await runTool("add_reminder", { text: "wyjąć pranie", at })).toMatch(/Przypomnienie/);
    expect(store.data.reminders).toHaveLength(1);
  });

  it("add_shopping_item → list_shopping", async () => {
    expect(await runTool("add_shopping_item", { name: "szparagi", qty: "2 pęczki" })).toMatch(/szparagi/);
    expect(await runTool("list_shopping", {})).toContain("2 pęczki szparagi");
  });

  it("add_calendar_event → list_calendar (web: magazyn wewnętrzny)", async () => {
    expect(await runTool("add_calendar_event", { title: "Dentysta", start: new Date().toISOString() })).toMatch(/Dentysta/);
    expect(await runTool("list_calendar", {})).toContain("Dentysta");
  });

  it("remember_fact zapisuje do pamięci", async () => {
    expect(await runTool("remember_fact", { key: "ulubiona_kawa", value: "flat white" })).toMatch(/Zapamiętane/);
    expect(store.data.memory.find((m) => m.key === "ulubiona_kawa")?.value).toBe("flat white");
  });

  it("add_journal_entry zapisuje wpis (domyślnie prywatny)", async () => {
    expect(await runTool("add_journal_entry", { title: "Refleksja", body: "dobry dzień", tags: "życie" })).toMatch(/dzienniku/);
    const e = store.data.journal[0];
    expect(e.title).toBe("Refleksja");
    expect(e.tags).toEqual(["życie"]);
    expect(e.shared).toBeFalsy();
  });

  it("targ: add_tally_item → tally_report → clear_tally", async () => {
    await runTool("add_tally_item", { name: "truskawki", unit_price: 12.5 });
    // alias „price" (modele czasem mylą nazwę argumentu) też musi działać
    await runTool("add_tally_item", { name: "szparagi", price: 8 });
    const report = await runTool("tally_report", {});
    expect(report).toContain("truskawki");
    expect(report).toMatch(/20[.,]50|20[.,]5/);
    expect(await runTool("clear_tally", {})).toMatch(/wyczyszczon/i);
    expect(store.data.tally).toHaveLength(0);
  });

  it("create_scene → list_scenes → run_scene (bez HA: czytelny komunikat)", async () => {
    await runTool("create_scene", { name: "Dobranoc", actions: [{ entity_id: "light.salon", action: "off" }] });
    expect(await runTool("list_scenes", {})).toContain("Dobranoc");
    const out = await runTool("run_scene", { name: "dobranoc" });
    expect(out).toMatch(/Home Assistant nie jest skonfigurowany/);
  });

  it("set_timer potwierdza ustawienie", async () => {
    expect(await runTool("set_timer", { minutes: 10, label: "herbata" })).toMatch(/10 min/);
  });

  it("calculate liczy wyrażenia i procenty", async () => {
    expect(await runTool("calculate", { expression: "23*2+4" })).toMatch(/=\s*50/);
    expect(await runTool("calculate", { expression: "15% z 240" })).toMatch(/=\s*36/);
    expect(await runTool("calculate", { expression: "rm -rf /" })).toMatch(/Podaj wyrażenie|Błędne/);
  });

  it("forget_fact usuwa zapamiętany fakt", async () => {
    await runTool("remember_fact", { key: "miasto", value: "Kraków" });
    expect(await runTool("forget_fact", { key: "miasto" })).toMatch(/Usunąłem/);
    expect(store.data.memory.find((m) => m.key === "miasto")).toBeUndefined();
    expect(await runTool("forget_fact", { key: "nieistnieje" })).toMatch(/Nie znalazłem/);
  });

  it("daily_briefing zwraca raport (zadania/kalendarz; pogoda best-effort)", async () => {
    await runTool("add_task", { title: "ważna sprawa" });
    const out = await runTool("daily_briefing", {});
    expect(out).toMatch(/Pora dnia/);
    expect(out).toContain("ważna sprawa");
  });
});

describe("łagodna degradacja — brak konfiguracji nie wybucha", () => {
  it("web_research bez klucza Tavily → instrukcja zamiast błędu", async () => {
    expect(await runTool("web_research", { query: "test" })).toMatch(/Tavily/);
  });

  it("smart_home bez konfiguracji → instrukcja", async () => {
    expect(await runTool("smart_home", { entity_id: "light.salon", action: "on" })).toMatch(/Home Assistant/);
  });

  it("gmail_search / gcal_list bez backendu → instrukcja", async () => {
    expect(await runTool("gmail_search", { query: "" })).toMatch(/backend|Google/i);
    expect(await runTool("gcal_list", {})).toMatch(/backend|Google/i);
  });

  it("narzędzia desktop_* poza komputerem → czytelny komunikat", async () => {
    for (const [tool, input] of [
      ["desktop_launch_app", { app: "notepad" }],
      ["desktop_open", { target: "C:/" }],
      ["desktop_power", { action: "lock" }],
      ["desktop_volume", { action: "up" }],
      ["desktop_media", { action: "playpause" }],
      ["desktop_type", { text: "abc" }],
      ["desktop_hotkey", { combo: "ctrl+s" }],
    ] as const) {
      expect(await runTool(tool, input)).toMatch(/desktopow/);
    }
  });

  it("nieznane narzędzie → komunikat, nie wyjątek", async () => {
    expect(await runTool("nie_istnieje", {})).toMatch(/Nieznane narzędzie/);
  });
});
