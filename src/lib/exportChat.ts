// === Eksport rozmowy do Markdown — jak „Share/Export" w ChatGPT/Claude ===
// Czysta funkcja: bierze wiadomości i składa schludny, czytelny Markdown do skopiowania
// (notatki, dokumentacja, wysłanie komuś). Pomija puste i systemowe wstawki.

export interface ExportMsg { role: string; text: string }

export function conversationToMarkdown(messages: ExportMsg[], title = "Rozmowa z JARVIS-em"): string {
  const when = (() => { try { return new Date().toLocaleString("pl-PL"); } catch { return ""; } })();
  const out: string[] = [`# ${title}`, "", `_Wyeksportowano: ${when}_`, "", "---", ""];
  let any = false;
  for (const m of messages || []) {
    const t = (m.text || "").trim();
    if (!t) continue;
    any = true;
    const who = m.role === "user" ? "🧑 **Ty**" : "🤖 **JARVIS**";
    out.push(who, "", t, "");
  }
  if (!any) out.push("_(pusta rozmowa)_", "");
  return out.join("\n").trim() + "\n";
}
