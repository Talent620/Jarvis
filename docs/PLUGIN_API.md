# JARVIS Plugin API

JARVIS nie jest monolitem — to platforma. Wtyczka dokłada własne **narzędzia agentowe**
(model AI wywołuje je jak wbudowane: przez bramkę zgód i z audytem), **sekcje ustawień**,
**toasty** i ma **trwałą pamięć**. Wszystko w TypeScripcie, bez zewnętrznych zależności.

## Instalacja wtyczki

1. Skopiuj plik wtyczki do `src/plugins/` (np. `src/plugins/moja.plugin.ts`).
2. Dopisz ją do manifestu `src/plugins/index.ts`:

```ts
import { loadPlugins } from "./PluginRegistry";
import pomodoroPlugin from "./examples/pomodoro.plugin";
import mojaPlugin from "./moja.plugin"; // ← nowa wtyczka

export function initPlugins(): void {
  loadPlugins([pomodoroPlugin, mojaPlugin]);
}
```

3. `npm run build` (lub `npm run dev`). Wtyczka pojawi się w **⚙ → Integracje → 🧩 Wtyczki**.

Awaria wtyczki nie psuje aplikacji — błąd rejestracji widać przy jej wpisie w ustawieniach.

## Pełne API

| Metoda | Opis |
|---|---|
| `registerTool(name, description, schema, handler)` | Dodaje narzędzie agentowe. Nazwa jest prefiksowana id wtyczki (`pomodoro_start`). `schema` to JSON Schema wejścia (`{ type: "object", properties: {...}, required: [...] }`). `handler(input)` zwraca string (odpowiedź dla modelu). Narzędzie przechodzi przez tę samą bramkę zgód i audyt co wbudowane. |
| `addSettingsSection(label, render)` | Dodaje sekcję w ⚙ → Integracje → Wtyczki. `render()` zwraca JSX (React 18). |
| `sendToast(message)` | Krótkie powiadomienie w interfejsie (znika samo). |
| `getMemory(key)` | Odczyt trwałej pamięci wtyczki (string lub `undefined`). Klucze są prefiksowane id wtyczki — wtyczki nie widzą swoich nawzajem. |
| `setMemory(key, value)` | Zapis trwałej pamięci wtyczki (przeżywa restart, wchodzi do kopii zapasowych). |

Interfejs wtyczki:

```ts
interface JarvisPlugin {
  id: string;      // unikalny, [a-z0-9-], np. "weather-pro"
  name: string;    // nazwa w UI
  version: string; // semver
  register(api: PluginAPI): void;
}
```

## Przykład minimalny (10 linii)

```ts
import type { JarvisPlugin } from "./PluginRegistry";

const hello: JarvisPlugin = {
  id: "hello",
  name: "Hello",
  version: "1.0.0",
  register(api) {
    api.registerTool("say", "Przywitaj się z użytkownikiem.", { type: "object", properties: {}, required: [] },
      () => "Cześć z wtyczki! 👋");
  },
};
export default hello;
```

Po instalacji powiedz JARVIS-owi „przywitaj się przez wtyczkę" — model sam wywoła `hello_say`.

## Przykład zaawansowany

Zobacz `src/plugins/examples/pomodoro.plugin.ts` (~60 linii): narzędzie z argumentem
(`pomodoro_start`, długość sesji), drugie narzędzie odczytu stanu (`pomodoro_status`),
sekcja ustawień (domyślna długość, trwała przez `setMemory`) i toast + natywne
powiadomienie po upływie czasu.

## Zasady

- Nazwy narzędzi: tylko `[a-z0-9_]` (wymóg API Claude/Gemini/OpenAI).
- `handler` może być async; rzucony wyjątek wraca do modelu jako czytelny błąd narzędzia.
- Wtyczki działają lokalnie, w tym samym sandboxie co aplikacja — nie dostają kluczy API.
