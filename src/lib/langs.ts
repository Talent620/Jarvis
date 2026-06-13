// Lista języków dla Trybu Tłumacza. `name` to polska nazwa (do promptu),
// `stt` to kod rozpoznawania mowy, `tts` do syntezy głosu.
export interface Lang {
  code: string;
  label: string; // natywna nazwa w UI
  flag: string;
  name: string;  // polska nazwa języka (cel tłumaczenia, do promptu)
  stt: string;   // kod do rozpoznawania mowy (np. pl-PL)
  tts: string;   // kod do czytania na głos (np. pl-PL)
}

export const LANGS: Lang[] = [
  { code: "pl", label: "Polski", flag: "🇵🇱", name: "polski", stt: "pl-PL", tts: "pl-PL" },
  { code: "uk", label: "Українська", flag: "🇺🇦", name: "ukraiński", stt: "uk-UA", tts: "uk-UA" },
  { code: "en", label: "English", flag: "🇬🇧", name: "angielski", stt: "en-US", tts: "en-US" },
  { code: "de", label: "Deutsch", flag: "🇩🇪", name: "niemiecki", stt: "de-DE", tts: "de-DE" },
  { code: "ru", label: "Русский", flag: "🇷🇺", name: "rosyjski", stt: "ru-RU", tts: "ru-RU" },
  { code: "es", label: "Español", flag: "🇪🇸", name: "hiszpański", stt: "es-ES", tts: "es-ES" },
  { code: "fr", label: "Français", flag: "🇫🇷", name: "francuski", stt: "fr-FR", tts: "fr-FR" },
  { code: "it", label: "Italiano", flag: "🇮🇹", name: "włoski", stt: "it-IT", tts: "it-IT" },
  { code: "cs", label: "Čeština", flag: "🇨🇿", name: "czeski", stt: "cs-CZ", tts: "cs-CZ" },
  { code: "sk", label: "Slovenčina", flag: "🇸🇰", name: "słowacki", stt: "sk-SK", tts: "sk-SK" },
  { code: "ro", label: "Română", flag: "🇷🇴", name: "rumuński", stt: "ro-RO", tts: "ro-RO" },
  { code: "tr", label: "Türkçe", flag: "🇹🇷", name: "turecki", stt: "tr-TR", tts: "tr-TR" },
];

export const getLang = (code: string): Lang => LANGS.find((l) => l.code === code) || LANGS[0];
