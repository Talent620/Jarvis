import { store } from "./store";
import { toolDefs, runTool } from "./tools";

const API_URL = "https://api.anthropic.com/v1/messages";

// Blok treści w odpowiedzi Claude (uproszczony).
interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

interface ClaudeResponse {
  content: Block[];
  stop_reason: string;
  error?: { message: string };
}

type Msg = { role: "user" | "assistant"; content: any };

function systemPrompt(): string {
  const { userName, memory } = { userName: store.settings.userName, memory: store.data.memory };
  const facts = memory.length
    ? "\n\nZapamiętane fakty o użytkowniku:\n" + memory.map((m) => `- ${m.key}: ${m.value}`).join("\n")
    : "";

  const now = new Date();
  return [
    `Jesteś JARVIS — zaawansowany, autonomiczny asystent AI w stylu filmowego asystenta Tony'ego Starka.`,
    `Zwracasz się do użytkownika per „${userName}”. Mówisz po polsku, chyba że użytkownik użyje innego języka.`,
    `Twój charakter: uprzejmy, lekko dowcipny, niezwykle kompetentny i konkretny. Bez zbędnego lania wody.`,
    ``,
    `Zasady:`,
    `- Gdy użytkownik o coś prosi, DZIAŁAJ przez narzędzia (zadania, notatki, przypomnienia, kalendarz, zakupy, otwieranie aplikacji, dzwonienie, nawigacja).`,
    `- Gdy potrzeba aktualnych informacji (pogoda, wiadomości, kursy, fakty po dacie treningu), korzystaj z wyszukiwania w sieci.`,
    `- Proaktywnie zapamiętuj trwałe preferencje i fakty o użytkowniku narzędziem remember_fact.`,
    `- Odpowiedzi trzymaj zwięzłe i naturalne — będą czytane na głos. Unikaj długich list, chyba że użytkownik o nie prosi.`,
    `- Po wykonaniu akcji potwierdź ją krótko, jednym–dwoma zdaniami.`,
    `- Aktualny czas: ${now.toLocaleString("pl-PL")}.`,
    facts,
  ].join("\n");
}

function buildTools() {
  const list: any[] = toolDefs.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.input_schema,
  }));
  if (store.settings.webSearch) {
    list.push({ type: "web_search_20260209", name: "web_search" });
  }
  return list;
}

async function post(messages: Msg[]): Promise<ClaudeResponse> {
  const { anthropicApiKey, model } = store.settings;
  if (!anthropicApiKey) {
    throw new Error("Brak klucza API Anthropic. Wprowadź go w ustawieniach (ikona koła zębatego).");
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model || "claude-opus-4-8",
      max_tokens: 4096,
      system: systemPrompt(),
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      tools: buildTools(),
      messages,
    }),
  });

  const data = (await res.json()) as ClaudeResponse;
  if (!res.ok) {
    throw new Error(data?.error?.message || `Błąd API (${res.status}).`);
  }
  return data;
}

export interface JarvisReply {
  text: string;
  tools: string[];
}

/**
 * Agentowa pętla: woła Claude, wykonuje narzędzia klienta, obsługuje serwerowe
 * wyszukiwanie (pause_turn), aż model zakończy turę.
 */
export async function askJarvis(history: Msg[]): Promise<JarvisReply> {
  const messages: Msg[] = [...history];
  const usedTools = new Set<string>();
  let guard = 0;

  while (guard++ < 8) {
    const resp = await post(messages);
    messages.push({ role: "assistant", content: resp.content });

    for (const b of resp.content) {
      if (b.type === "tool_use" && b.name) usedTools.add(b.name);
      if (b.type === "server_tool_use" && b.name) usedTools.add(b.name);
    }

    // Serwerowe narzędzie (web search) przekroczyło limit iteracji — wznów.
    if (resp.stop_reason === "pause_turn") continue;

    // Narzędzia klienta do wykonania.
    const toolUses = resp.content.filter((b) => b.type === "tool_use");
    if (resp.stop_reason === "tool_use" && toolUses.length) {
      const results = [];
      for (const tu of toolUses) {
        const out = await runTool(tu.name!, tu.input);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    // Koniec tury — zbierz tekst.
    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return { text: text || "…", tools: [...usedTools] };
  }

  return { text: "Przepraszam, zapętliłem się przy realizacji zadania. Spróbujmy inaczej.", tools: [...usedTools] };
}
