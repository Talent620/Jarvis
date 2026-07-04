// Domyślne klucze wstrzykiwane przy budowie (z Secrets repo) — patrz vite.config.ts.
// Nigdy nie trafiają do źródeł; w dev są pustymi stringami.
declare const __DEFAULT_KEYS__: Record<string, string>;
// Czy build wymaga aktywacji licencją (domyślnie true; można wyłączyć przez env).
declare const __LICENSE_REQUIRED__: boolean;
// Adres serwera licencji (Cloudflare Worker). Pusty = tryb offline (sam podpis).
declare const __LICENSE_URL__: string;
// Tryb rygorystyczny — wymaga udanej aktywacji online (limit urządzeń, unieważnianie).
declare const __LICENSE_STRICT__: boolean;
// Data/godzina zbudowania (UTC) — pokazywana w ⚙ → Dane, by jednoznacznie poznać wersję.
declare const __APP_BUILD__: string;
// Metryki kodu liczone przy budowie — do wyceny projektu (panel admina).
declare const __PROJECT_STATS__: { modules: number; components: number; tests: number; files: number; loc: number };
