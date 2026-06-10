import { store } from "./store";
import { PROVIDER_LIST, PROVIDERS } from "./providers/registry";
import { resolveProvider, testProvider } from "./brain";
import { testBackend } from "./sync";
import { isSpeechSupported } from "./voice";

// Diagnostyka startowa: sprawdza po kolei każdą usługę/API i mówi wprost,
// co działa, a co i JAK naprawić. Wynik linia po linii (na żywo przez onStep).
export async function systemCheck(onStep?: (lines: string[]) => void): Promise<string[]> {
  const s = store.settings;
  const lines: string[] = [];
  const push = (l: string) => {
    lines.push(l);
    onStep?.([...lines]);
  };

  // 1) Internet
  push(navigator.onLine ? "✅ Internet — połączono." : "❌ Internet — offline. Sprawdź sieć.");

  // 2) Mózg AI (aktywny dostawca)
  const r = resolveProvider();
  if (!r || !r.apiKey?.trim()) {
    push("❌ Mózg AI — brak klucza. Wklej dowolny klucz w 🚀 Szybki start (darmowy: aistudio.google.com/apikey).");
  } else {
    push(`⏳ Mózg AI — testuję ${PROVIDERS[r.provider].label}…`);
    lines[lines.length - 1] = await testProvider(r.provider, r.apiKey, r.model);
    onStep?.([...lines]);
  }

  // 3) Pozostałe wpisane klucze
  const others = PROVIDER_LIST.filter(
    (p) => p.id !== "ollama" && p.id !== r?.provider && s.keys[p.id]?.trim(),
  );
  for (const p of others) {
    push(`⏳ ${p.label}…`);
    lines[lines.length - 1] = await testProvider(p.id, s.keys[p.id]);
    onStep?.([...lines]);
  }

  // 4) Research (Tavily)
  if (s.tavilyApiKey?.trim()) {
    push("⏳ Research (Tavily)…");
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: s.tavilyApiKey, query: "ping", max_results: 1 }),
      });
      lines[lines.length - 1] = res.ok
        ? "✅ Research (Tavily) — działa, odpowiedzi będą miały źródła [1][2]."
        : `❌ Research (Tavily) — klucz odrzucony (${res.status}).`;
    } catch {
      lines[lines.length - 1] = "❌ Research (Tavily) — brak połączenia.";
    }
    onStep?.([...lines]);
  } else {
    push("➖ Research (Tavily) — brak klucza (opcjonalne; darmowy na tavily.com). Claude ma własne wyszukiwanie.");
  }

  // 5) Funkcje Gemini (rozmowa na żywo, Studio obrazów, pamięć semantyczna)
  push(
    s.keys.gemini?.trim()
      ? "✅ Gemini — rozmowa na żywo ☎, Studio obrazów 🎨 i pamięć semantyczna 🧠 dostępne."
      : "➖ Gemini — brak klucza: rozmowa na żywo, Studio obrazów i pamięć semantyczna nieaktywne (klucz darmowy: aistudio.google.com/apikey).",
  );

  // 6) Głos (synteza + mikrofon)
  const tts =
    typeof window.speechSynthesis !== "undefined" || s.elevenLabsApiKey || s.fishAudioApiKey;
  push(tts ? "✅ Głos (czytanie odpowiedzi) — dostępny." : "⚠️ Głos — brak syntezy w tym środowisku.");
  push(
    isSpeechSupported()
      ? "✅ Mikrofon (rozpoznawanie mowy) — wspierany."
      : "⚠️ Mikrofon — to środowisko nie wspiera rozpoznawania mowy (użyj aplikacji Android).",
  );

  // 7) Backend / synchronizacja
  const backendUrl = s.proxyUrl?.trim() || s.syncUrl?.trim();
  if (backendUrl) {
    push("⏳ Backend…");
    lines[lines.length - 1] = await testBackend(backendUrl);
    onStep?.([...lines]);
  } else {
    push("➖ Backend — niewdrożony (opcjonalny; odblokuje Gmail/Kalendarz/sync — patrz proxy/README).");
  }

  // 8) Smart home
  push(
    s.homeAssistantUrl?.trim() && s.homeAssistantToken?.trim()
      ? "✅ Smart home (Home Assistant) — skonfigurowany."
      : "➖ Smart home — nieskonfigurowany (opcjonalne; ⚙ → Integracje).",
  );

  // Podsumowanie
  const fails = lines.filter((l) => l.startsWith("❌")).length;
  const warns = lines.filter((l) => l.startsWith("⚠️")).length;
  push(
    fails === 0
      ? warns === 0
        ? "🟢 Wszystkie systemy sprawne. Do usług."
        : "🟡 Gotowy do pracy — drobne ostrzeżenia powyżej."
      : `🔴 ${fails} problem(y) do naprawienia — wskazówki powyżej.`,
  );
  return lines;
}
