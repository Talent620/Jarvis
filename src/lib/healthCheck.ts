import { store } from "./store";
import { PROVIDERS, PROVIDER_LIST } from "./providers/registry";
import { resolveProvider, testProvider } from "./brain";
import { primaryKey, keyCount } from "./keys";
import { isDesktop, isSpeechSupported } from "./voice";
import { fetchTimeout } from "./http";
import { Capacitor } from "@capacitor/core";
import { wakeSupported } from "./wakeword";
import { canSendMail, canRelaySmtp, hasBackendGmail } from "./mailer";
import { getRouterStats } from "./modelRouter";
import { testBackend } from "./sync";

// === Centrum Sprawdzania ===
// Przegląd WSZYSTKICH kluczowych funkcji JARVIS-a: co działa, co nie i DLACZEGO —
// po ludzku, po polsku. Autonomia: co się da, JARVIS naprawia sam (przycisk
// „Napraw"), a gdy potrzebny jest Twój ruch — mówi dokładnie, co zrobić.

export interface HealthItem {
  id: string;
  icon: string;
  title: string;
  status: "ok" | "warn" | "err" | "info";
  detail: string;
  /** Automatyczna naprawa — JARVIS sam ustawia poprawną wartość. */
  fix?: { label: string; apply: () => void };
}

const STATUS_ICON: Record<HealthItem["status"], string> = { ok: "✅", warn: "⚠️", err: "❌", info: "💡" };
export const statusIcon = (s: HealthItem["status"]) => STATUS_ICON[s];

/** Czyste poprawki ustawień (testowalne): wykryj niespójności i zwróć naprawy. */
export function settingsFixes(s = store.settings): HealthItem[] {
  const out: HealthItem[] = [];

  // Dostawca wybrany ręcznie, ale bez klucza → czat nie odpowie. Naprawa: auto.
  if (s.provider !== "auto" && s.provider !== "ollama" && !s.keys[s.provider]?.trim()) {
    out.push({
      id: "provider-nokey", icon: "🧠", title: "Mózg AI — zły wybór dostawcy", status: "err",
      detail: `Wybrany dostawca (${PROVIDERS[s.provider as keyof typeof PROVIDERS]?.label || s.provider}) nie ma wpisanego klucza, więc czat nie odpowie. Przełączę na tryb auto — JARVIS sam weźmie najlepszego dostawcę z kluczem.`,
      fix: { label: "Przełącz na auto", apply: () => store.setSettings({ provider: "auto", model: "auto" }) },
    });
  }

  // Model nie pasuje do dostawcy (np. po zmianie dostawcy) → resetuj na domyślny.
  const meta = PROVIDERS[s.provider as keyof typeof PROVIDERS];
  if (s.provider !== "auto" && meta && s.model !== "auto" && s.model && !meta.models.some((m) => m.id === s.model)) {
    out.push({
      id: "model-mismatch", icon: "🧠", title: "Model nie pasuje do dostawcy", status: "warn",
      detail: `Ustawiony model „${s.model}" nie należy do ${meta.label} — zapytania mogą padać. Ustawię domyślny model tego dostawcy.`,
      fix: { label: "Ustaw poprawny model", apply: () => store.setSettings({ model: "auto" }) },
    });
  }

  // Port poczty inny niż szyfrowane 465/587 → wysyłka nie zadziała.
  if (s.smtpUser?.trim() && s.smtpPort !== 465 && s.smtpPort !== 587) {
    out.push({
      id: "smtp-port", icon: "📨", title: "Poczta — nietypowy port", status: "warn",
      detail: `Port ${s.smtpPort} zwykle nie działa z szyfrowaną wysyłką. Standard to 465.`,
      fix: { label: "Ustaw port 465", apply: () => store.setSettings({ smtpPort: 465 }) },
    });
  }

  // Adres Ollamy ze spacjami/ukośnikiem — częsta literówka.
  if (s.ollamaUrl && s.ollamaUrl !== s.ollamaUrl.trim().replace(/\/+$/, "")) {
    const clean = s.ollamaUrl.trim().replace(/\/+$/, "");
    out.push({
      id: "ollama-url", icon: "🏠", title: "Adres Ollamy do wyczyszczenia", status: "warn",
      detail: "Adres lokalnego modelu ma zbędne spacje/ukośnik na końcu — poprawię.",
      fix: { label: "Popraw adres", apply: () => store.setSettings({ ollamaUrl: clean }) },
    });
  }

  return out;
}

/**
 * Pełny przegląd. Wyniki spływają na żywo przez onUpdate (sprawdzenia sieciowe
 * trwają chwilę). Sprawdzenia z internetem można wyłączyć (offline).
 */
export async function runHealthCheck(onUpdate?: (items: HealthItem[]) => void, live = true): Promise<HealthItem[]> {
  const s = store.settings;
  const items: HealthItem[] = [];
  const push = (i: HealthItem) => { items.push(i); onUpdate?.([...items]); };

  // 0. Automatyczne naprawy ustawień (niespójności).
  for (const f of settingsFixes(s)) push(f);

  // 1. Mózg AI — kto odpowiada.
  const r = resolveProvider();
  if (!r || !r.apiKey?.trim()) {
    push({
      id: "brain", icon: "🧠", title: "Mózg AI", status: "err",
      detail: "Brak działającego dostawcy AI. Wklej dowolny klucz w polu wyżej (najlepiej Claude: sk-ant-… z platform.claude.com) — JARVIS sam go rozpozna.",
    });
  } else {
    const isClaude = r.provider === "anthropic";
    push({
      id: "brain", icon: "🧠", title: "Mózg AI", status: "ok",
      detail: `Odpowiada: ${PROVIDERS[r.provider].label} (model ${r.model}).${isClaude ? " To Claude — najlepszy wybór. 👌" : ""}`,
    });
    // Masz klucz Claude, ale mózgiem jest ktoś inny → zaproponuj naprawę.
    if (!isClaude && s.keys.anthropic?.trim()) {
      push({
        id: "brain-claude", icon: "🧠", title: "Claude czeka w zapasie", status: "warn",
        detail: "Masz klucz Claude, ale odpowiada inny dostawca (ręczny wybór w ustawieniach). Przełączę na auto — Claude ma najwyższy priorytet i przejmie stery.",
        fix: { label: "Ustaw Claude'a jako mózg", apply: () => store.setSettings({ provider: "auto", model: "auto" }) },
      });
    }
  }

  // 1b. Zapasowy mózg — żeby NIGDY nie zabrakło. Failover działa tylko, gdy jest na co
  // przełączyć; przy jednym dostawcy podpowiadamy dodać drugi (darmowy).
  const brainsWithKey = Object.values(s.keys).filter((v) => (v as string)?.trim()).length;
  if (r && r.apiKey?.trim() && brainsWithKey <= 1 && !s.ollamaUrl?.trim()) {
    push({
      id: "backup-brain", icon: "🧠", title: "Dodaj zapasowy mózg (nigdy nie zabraknie)", status: "info",
      detail: "Masz tylko jeden mózg AI. Dodaj drugi DARMOWY klucz (Groq, Cerebras lub Gemini) w ⚙ → AI — gdy jeden wyczerpie limit, JARVIS sam przełączy się na zapas i odpowie dalej. Koniec strachu, że „API się skończy”.",
    });
  }

  // 1c. Serwer inferencji (Ollama) — „czy mój PC-mózg żyje?" (Zadanie 5). Z poziomu telefonu
  // odpowiada na pytanie: czy domowe GPU jest osiągalne (np. przez Tailscale).
  if (s.ollamaUrl?.trim()) {
    if (live) {
      const url = s.ollamaUrl.trim().replace(/\/$/, "");
      const host = (() => { try { return new URL(url).host; } catch { return url; } })();
      try {
        const res = await fetchTimeout(`${url}/api/tags`, { method: "GET" }, 6000);
        if (res.ok) {
          const d = await res.json().catch(() => null);
          const n = Array.isArray(d?.models) ? d.models.length : 0;
          let loaded = "";
          try {
            const ps = await fetchTimeout(`${url}/api/ps`, { method: "GET" }, 4000);
            if (ps.ok) {
              const pd = await ps.json().catch(() => null);
              const names = (pd?.models || []).map((m: { name?: string; model?: string }) => String(m.name || m.model)).filter(Boolean);
              if (names.length) loaded = ` · w pamięci: ${names.join(", ")}`;
            }
          } catch { /* /api/ps opcjonalne — pomiń łagodnie */ }
          push({ id: "ollama", icon: "🖥", title: "Serwer inferencji aktywny", status: "ok", detail: `${n} model(i) na ${host}${loaded}` });
        } else {
          push({ id: "ollama", icon: "🖥", title: "Serwer inferencji nie odpowiada", status: "warn", detail: `Ollama na ${host} zwróciła ${res.status}. Sprawdź, czy działa i czy ustawiono OLLAMA_ORIGINS=* (CORS).` });
        }
      } catch {
        push({ id: "ollama", icon: "🖥", title: "Serwer inferencji nieosiągalny", status: "warn", detail: `Nie łączę z ${host}. W terenie najprościej: Tailscale (PC + telefon w jednym tailnecie) i adres 100.x.x.x; na telefonie użyj APK.` });
      }
    }
  } else {
    push({ id: "ollama", icon: "🖥", title: "Lokalny serwer AI (opcjonalnie)", status: "info", detail: "Możesz postawić własny mózg na PC (Ollama) i łączyć się z telefonu — patrz JARVIS-Ollama-Server.exe lub server/ollama/. Wtedy refleks działa offline i prywatnie." });
  }

  // 1d. Router uczący się (Z12) — podgląd skuteczności tras (refleks vs kora), gdy są dane.
  const rstats = getRouterStats();
  if (rstats.length) {
    const top = rstats
      .slice(0, 4)
      .map((s) => `${s.kind}/${s.tier}: ${Math.round(s.successRate * 100)}% bez eskalacji (${s.count}${s.medianLatencyMs != null ? `, ~${s.medianLatencyMs} ms` : ""})`)
      .join(" · ");
    push({ id: "router-stats", icon: "🧭", title: "Skuteczność tras (router)", status: "info", detail: top });
  }

  // 2. Claude — żywy test klucza (to samo co na Windowsie, działa wszędzie).
  if (live) {
    const claudeKey = primaryKey("anthropic");
    if (claudeKey) {
      push({ id: "claude", icon: "🤖", title: "Claude API", status: "info", detail: "⏳ Sprawdzam połączenie…" });
      const res = await testProvider("anthropic", claudeKey);
      items[items.length - 1] = {
        id: "claude", icon: "🤖", title: "Claude API",
        status: /✅|ok/i.test(res) ? "ok" : "err",
        detail: res.replace(/^✅\s*/, "Połączenie działa — ").replace(/^❌\s*/, ""),
      };
      onUpdate?.([...items]);
    } else {
      push({ id: "claude", icon: "🤖", title: "Claude API", status: "info", detail: "Brak klucza Claude. Opcjonalny, ale to najmocniejszy mózg — klucz znajdziesz na platform.claude.com." });
    }
  }

  // 3. Mikrofon (rozpoznawanie mowy) — zależnie od platformy.
  if (isDesktop()) {
    if (!isSpeechSupported()) {
      push({ id: "mic", icon: "🎙", title: "Mikrofon", status: "err", detail: "Brak dostępu do nagrywania w tym środowisku." });
    } else if (primaryKey("groq")) {
      push({ id: "mic", icon: "🎙", title: "Mikrofon (Whisper)", status: "ok", detail: "Rozpoznawanie mowy przez Groq Whisper — gotowe. Mów śmiało." });
    } else {
      push({ id: "mic", icon: "🎙", title: "Mikrofon", status: "warn", detail: "Na komputerze mowa idzie przez Groq (darmowy). Dodaj klucz Groq (gsk_… z console.groq.com) w polu wyżej, by mówić do JARVIS-a." });
    }
  } else {
    push(
      isSpeechSupported()
        ? { id: "mic", icon: "🎙", title: "Mikrofon", status: "ok", detail: "Rozpoznawanie mowy wspierane — możesz rozmawiać głosowo." }
        : { id: "mic", icon: "🎙", title: "Mikrofon", status: "warn", detail: "To środowisko nie wspiera rozpoznawania mowy — użyj aplikacji na telefonie lub Windows." },
    );
  }

  // 4. Głos (czytanie odpowiedzi).
  const ttsAvailable = Capacitor.isNativePlatform() || typeof window.speechSynthesis !== "undefined" || !!primaryKey("gemini") || !!s.elevenLabsApiKey || !!s.fishAudioApiKey;
  if (!s.speak) {
    push({
      id: "tts", icon: "🔊", title: "Głos JARVIS-a wyłączony", status: "info",
      detail: "Odpowiedzi nie są czytane na głos. Mogę włączyć.",
      fix: { label: "Włącz głos", apply: () => store.setSettings({ speak: true }) },
    });
  } else {
    push(
      ttsAvailable
        ? { id: "tts", icon: "🔊", title: "Głos JARVIS-a", status: "ok", detail: "Synteza mowy dostępna — JARVIS odpowiada na głos." }
        : { id: "tts", icon: "🔊", title: "Głos JARVIS-a", status: "warn", detail: "Brak syntezy w tym środowisku — dodaj klucz Gemini (darmowy głos premium) albo użyj telefonu." },
    );
  }

  // 5. Szukanie leadów — żywy test map (geokodowanie).
  if (live) {
    push({ id: "leads", icon: "🔎", title: "Szukanie leadów (mapy)", status: "info", detail: "⏳ Sprawdzam połączenie z mapami…" });
    try {
      const res = await fetchTimeout("https://nominatim.openstreetmap.org/search?city=Krak%C3%B3w&format=json&limit=1", {}, 8000);
      const d = await res.json().catch(() => null);
      items[items.length - 1] = d?.[0]
        ? { id: "leads", icon: "🔎", title: "Szukanie leadów (mapy)", status: "ok", detail: "Mapy odpowiadają — wyszukiwarka firm gotowa (za darmo, bez klucza). Powiedz: znajdź leady." }
        : { id: "leads", icon: "🔎", title: "Szukanie leadów (mapy)", status: "warn", detail: "Mapy odpowiedziały nietypowo — spróbuj za chwilę." };
    } catch {
      items[items.length - 1] = { id: "leads", icon: "🔎", title: "Szukanie leadów (mapy)", status: "err", detail: "Brak połączenia z mapami (internet/zapora). Wyszukiwarka leadów wymaga internetu." };
    }
    onUpdate?.([...items]);
  }

  // 6. Poczta — wysyłka ofert jednym kliknięciem. Desktop: SMTP. Telefon: przekaźnik
  //    SMTP przez backend (hasło aplikacji, bez Gmaila) lub Gmail OAuth.
  if (canSendMail()) {
    push({ id: "mail", icon: "📨", title: "Poczta (wysyłka z aplikacji)", status: "ok", detail: `SMTP skonfigurowany (${s.smtpUser}). Oferty wysyłasz jednym kliknięciem, bez otwierania Gmaila. Pewność? ⚙ → Poczta → Sprawdź połączenie.` });
  } else if (canRelaySmtp()) {
    push({ id: "mail", icon: "📨", title: "Poczta (wysyłka w tle przez backend)", status: "ok", detail: `Telefon wysyła w tle hasłem aplikacji (${s.smtpUser}), bez otwierania Gmaila. Pewność? ⚙ → Poczta → Sprawdź połączenie.` });
  } else if (hasBackendGmail()) {
    push({ id: "mail", icon: "📨", title: "Poczta (Gmail przez backend)", status: "ok", detail: "Backend podłączony — jeśli połączyłeś konto Google, oferty wyślesz jednym kliknięciem (też na telefonie). Pewność? Kliknij Sprawdź Gmaila w Synchronizacji." });
  } else if (isDesktop()) {
    push({ id: "mail", icon: "📨", title: "Poczta (wysyłka z aplikacji)", status: "info", detail: "Maile otwierają się w Gmailu (też OK). Chcesz wysyłać jednym kliknięciem? ⚙ → Poczta (Gmail + hasło aplikacji)." });
  } else {
    push({ id: "mail", icon: "📨", title: "Poczta", status: "info", detail: "Na telefonie maile otwierają się gotowe w Gmailu (jedno tapnięcie). Chcesz wysyłać w tle bez otwierania apki? ⚙ → Poczta (adres + hasło aplikacji) + ⚙ → Synchronizacja (backend)." });
  }

  // 7. Wyszukiwanie w sieci dla AI.
  if (!s.webSearch) {
    push({
      id: "websearch", icon: "🌐", title: "Wyszukiwanie w sieci wyłączone", status: "info",
      detail: "AI nie sięga do aktualnych informacji z internetu. Mogę włączyć (Claude i Gemini mają to wbudowane).",
      fix: { label: "Włącz wyszukiwanie", apply: () => store.setSettings({ webSearch: true }) },
    });
  } else {
    push({ id: "websearch", icon: "🌐", title: "Wyszukiwanie w sieci", status: "ok", detail: "Włączone — JARVIS sięga po aktualne informacje, gdy potrzeba." });
  }

  // 8. Kopia/synchronizacja (opcjonalna).
  push(
    s.syncUrl?.trim()
      ? { id: "sync", icon: "☁", title: "Synchronizacja", status: "ok", detail: "Backend ustawiony — dane synchronizują się między urządzeniami." }
      : { id: "sync", icon: "☁", title: "Synchronizacja", status: "info", detail: "Dane trzymane lokalnie na tym urządzeniu (prywatnie). Sync między telefonem a komputerem to opcjonalny backend — instrukcja w proxy/README." },
  );

  for (const f of featureChecks(s)) push(f);

  return items;
}

/**
 * Dodatkowe pozycje statusu funkcji (czyste, bez sieci — łatwe do testów). Każda
 * mówi wprost: działa (ok), do skonfigurowania (info) albo niedostępne tu (warn).
 */
export function featureChecks(s = store.settings): HealthItem[] {
  const native = Capacitor.isNativePlatform();
  const out: HealthItem[] = [];

  // Studio obrazów — darmowo z kluczem Gemini, premium z fal.ai.
  out.push(
    primaryKey("gemini") || s.studioKeys?.trim() || s.falApiKey?.trim()
      ? { id: "studio", icon: "🎨", title: "Studio obrazów", status: "ok", detail: "Edycja zdjęć gotowa (Gemini Nano Banana za darmo, premium przez fal.ai)." }
      : { id: "studio", icon: "🎨", title: "Studio obrazów", status: "info", detail: "Dodaj darmowy klucz Gemini (w Studiu: 🔑 albo ⚙ → AI), by edytować zdjęcia opisem." },
  );

  // Research (Tavily) — opcjonalny.
  out.push(
    s.tavilyApiKey?.trim()
      ? { id: "research", icon: "📚", title: "Research ze źródłami", status: "ok", detail: "Tavily podłączony — odpowiedzi mają źródła [1][2]." }
      : { id: "research", icon: "📚", title: "Research ze źródłami", status: "info", detail: "Opcjonalny darmowy klucz Tavily (⚙ → AI). Claude ma własne wyszukiwanie." },
  );

  // Smart home (Home Assistant).
  out.push(
    s.homeAssistantUrl?.trim() && s.homeAssistantToken?.trim()
      ? { id: "smarthome", icon: "🏠", title: "Smart home", status: "ok", detail: "Home Assistant podłączony — sterujesz domem głosem." }
      : { id: "smarthome", icon: "🏠", title: "Smart home", status: "info", detail: "Opcjonalne. Podłącz Home Assistant w ⚙ → Integracje, by sterować urządzeniami." },
  );

  // Automatyzacja (n8n).
  out.push(
    s.n8nUrl?.trim() && s.n8nToken?.trim()
      ? { id: "n8n", icon: "⚙", title: "Automatyzacje (n8n)", status: "ok", detail: "n8n podłączony — JARVIS uruchamia Twoje scenariusze." }
      : { id: "n8n", icon: "⚙", title: "Automatyzacje (n8n)", status: "info", detail: "Opcjonalne. Podłącz n8n w ⚙ → Integracje, by odpalać własne automatyzacje." },
  );

  // Słowo-klucz (wybudzanie głosem) — tylko na urządzeniu.
  out.push(
    !wakeSupported()
      ? { id: "wake", icon: "📢", title: "Słowo-klucz „Jarvis”", status: "warn", detail: "Dostępne w aplikacji na telefonie (Android). Tu nieaktywne." }
      : s.wakeWord || s.backgroundWake
        ? { id: "wake", icon: "📢", title: "Słowo-klucz „Jarvis”", status: "ok", detail: "Wybudzanie głosem włączone — powiedz „Jarvis”." }
        : { id: "wake", icon: "📢", title: "Słowo-klucz „Jarvis”", status: "info", detail: "Wyłączone. Włącz w ⚙ → Głos, by budzić asystenta słowem „Jarvis”.",
            fix: { label: "Włącz słowo-klucz", apply: () => store.setSettings({ wakeWord: true }) } },
  );

  // Powiadomienia — tylko na urządzeniu.
  out.push(
    native
      ? { id: "notifs", icon: "🔔", title: "Powiadomienia", status: "ok", detail: "Przypomnienia i alerty działają w tle." }
      : { id: "notifs", icon: "🔔", title: "Powiadomienia", status: "info", detail: "Pełne powiadomienia w tle działają w aplikacji na telefonie." },
  );

  // Telefon/SMS/Kalendarz/Kontakty na urządzeniu.
  out.push(
    native
      ? { id: "device", icon: "📱", title: "Telefon, SMS, kalendarz, kontakty", status: "ok", detail: "Dzwonienie, SMS, dodawanie wydarzeń i kontaktów — gotowe." }
      : { id: "device", icon: "📱", title: "Telefon, SMS, kalendarz, kontakty", status: "info", detail: "Funkcje telefonu dostępne w aplikacji na telefonie (Android)." },
  );

  // Sterowanie komputerem (tylko Windows/.exe).
  if (isDesktop())
    out.push({ id: "desktop", icon: "🖥", title: "Sterowanie komputerem", status: "ok", detail: "Otwieranie aplikacji, pisanie, skróty, głośność, zrzut ekranu — gotowe." });

  return out;
}

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
    const n = keyCount(p.id);
    push(`⏳ ${p.label}${n > 1 ? ` (${n} klucze)` : ""}…`);
    lines[lines.length - 1] = await testProvider(p.id, primaryKey(p.id));
    onStep?.([...lines]);
  }

  // 4) Research (Tavily)
  if (s.tavilyApiKey?.trim()) {
    push("⏳ Research (Tavily)…");
    try {
      const res = await fetchTimeout("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: s.tavilyApiKey.trim(), query: "ping", max_results: 1 }),
      }, 12000);
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

  // 6) Głos (synteza + mikrofon). Na urządzeniu działa natywny TTS; z kluczem
  // Gemini dostępny jest też darmowy głos premium (Gemini TTS).
  const tts =
    Capacitor.isNativePlatform() ||
    s.geminiTts !== false && !!s.keys.gemini?.trim() ||
    typeof window.speechSynthesis !== "undefined" ||
    !!s.elevenLabsApiKey ||
    !!s.fishAudioApiKey;
  push(tts ? "✅ Głos (czytanie odpowiedzi) — dostępny." : "⚠️ Głos — brak syntezy w tym środowisku.");
  // Na desktopie (Windows .exe) rozpoznawanie mowy idzie przez Groq Whisper —
  // Web Speech w Electronie nie działa (mikrofon zapala się i gaśnie).
  if (isDesktop()) {
    push(
      !isSpeechSupported()
        ? "⚠️ Mikrofon — brak dostępu do nagrywania w tym środowisku."
        : primaryKey("groq")
          ? "✅ Mikrofon (rozpoznawanie mowy przez Whisper/Groq) — gotowy."
          : "⚠️ Mikrofon — dodaj klucz Groq (darmowy) w ⚙ → AI, by mówić na komputerze.",
    );
  } else {
    push(
      isSpeechSupported()
        ? "✅ Mikrofon (rozpoznawanie mowy) — wspierany."
        : "⚠️ Mikrofon — to środowisko nie wspiera rozpoznawania mowy (użyj aplikacji Android).",
    );
  }

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
