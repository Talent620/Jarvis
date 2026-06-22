// === Wiedza Szefa o całym JARVISIE „w pigułce" + uczciwa samoocena ===
// Daje agentowi głosowemu pełen obraz programu: co potrafi, gdzie to jest, jakich narzędzi
// użyć — oraz co AKTUALNIE wymaga poprawki (z realnych testów ustawień/funkcji). Dzięki temu
// Szef ma „znakomity kontakt": wie wszystko o aplikacji i mówi wprost, co nie gra.
import { settingsFixes, featureChecks } from "./healthCheck";

// Skondensowana mapa możliwości (utrzymywana ręcznie — krótka, ale pełna). Pogrupowana, by
// model szybko trafiał do właściwej funkcji/narzędzia zamiast zgadywać.
export function capabilitiesDigest(): string {
  return [
    "WIEDZA O JARVISIE (Twój program — znasz każdy zakątek):",
    "• Czat AI: wielu dostawców (Claude, Gemini, Groq, Cerebras, Mistral, Cohere, OpenRouter, NVIDIA, lokalnie Ollama/WebLLM), tryb auto, badanie w sieci (🔬), konsylium kilku modeli (⚖), czat prywatny.",
    "• Głos: Tryb Słuchawki (hands-free), Rozmowa na żywo (Gemini Live + kamera), Ty (Szef). Głosy: systemowy, Gemini, ElevenLabs, Fish, lokalny.",
    "• Sprzedaż/biznes: Pulpit Sprzedaży (leady/CRM), generator ofert, maile (Gmail), skrzynka wysłanych, maszynka do kontentu, generator reklam, kreator stron, autopilot zarabiania.",
    "• Zakupy: Łowca Okazji (najtaniej), Gdzie kupię w pobliżu, Lista zakupów.",
    "• Organizacja: Zadania Pro (GTD), Plan Dnia, Projekty/dokumenty, Dziennik, Kapsuły Wiedzy (fiszki), Powiadomienia, przypomnienia, timery.",
    "• Narzędzia AI: Tłumacz na żywo, Transkrypcja spotkań, Wizja HUD (kamera), Studio Obrazów (generuj/edytuj), analiza ekranu (desktop).",
    "• Pamięć: profil użytkownika, pamięć długoterminowa (fakty + Mem0), Umysł JARVISA, World Model, 🔎 Recall (przeszukaj wszystko lokalnie).",
    "• System: Stan systemu (zielone/czerwone), Koszty AI, Dziennik działań (audyt + cofanie), Strażnik (diagnoza/naprawa), ⌘K (szybkie polecenia), Gadżety, Admin/licencje.",
    "• Działania (narzędzia agenta): zadania, notatki, przypomnienia, kalendarz, lista zakupów, pamięć, leady, research w sieci, Gmail (szukaj/wyślij), telefon/SMS, otwieranie stron/aplikacji, nawigacja, smart-home, sterowanie pulpitem (Windows).",
    "Gdy użytkownik chce coś zrobić — użyj właściwego narzędzia albo otwórz właściwy ekran; nie zmyślaj funkcji, których nie ma.",
  ].join("\n");
}

/** Uczciwa samoocena: co teraz wymaga poprawki (z realnych, lokalnych testów). Zwięźle. */
export function selfCheckDigest(): string {
  let items;
  try {
    items = [...settingsFixes(), ...featureChecks()];
  } catch {
    return "";
  }
  const bad = items.filter((i) => i.status === "err" || i.status === "warn");
  if (!bad.length) return "STAN PROGRAMU: wszystko skonfigurowane poprawnie — nic pilnego do poprawki.";
  const lines = bad.slice(0, 8).map((i) => `• ${i.status === "err" ? "❌" : "⚠️"} ${i.title}: ${i.detail}`);
  return [
    "DO POPRAWKI W JARVISIE (mów o tym wprost, gdy pyta „co poprawić”; możesz zaproponować naprawę):",
    ...lines,
  ].join("\n");
}

/** Pełen blok wiedzy + stanu, doklejany do promptu Szefa. */
export function jarvisBriefing(): string {
  return `${capabilitiesDigest()}\n\n${selfCheckDigest()}`;
}
