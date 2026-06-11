// Domyślne klucze wstrzykiwane przy budowie (z Secrets repo) — patrz vite.config.ts.
// Nigdy nie trafiają do źródeł; w dev są pustymi stringami.
declare const __DEFAULT_KEYS__: Record<string, string>;
// Czy build wymaga aktywacji licencją (domyślnie true; można wyłączyć przez env).
declare const __LICENSE_REQUIRED__: boolean;
