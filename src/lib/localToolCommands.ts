/** Explicit local commands: everything after the colon is literal title/text, without inference. */
export function parseLocalToolCommand(text: string): { name: "add_task" | "add_note"; input: { title: string } | { text: string } } | null {
  const match = /^\s*(?:Jarvis[, ]+)?dodaj\s+(zadanie|notatk[ęe])\s*:\s*([^]+?)\s*$/i.exec(text);
  if (!match || !match[2].trim() || match[2].length > 4000) return null;
  return match[1].toLowerCase() === "zadanie"
    ? { name: "add_task", input: { title: match[2].trim() } }
    : { name: "add_note", input: { text: match[2].trim() } };
}
