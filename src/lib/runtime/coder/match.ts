// Which registered project do the user's words name? "Sterownik Studio", "w sterowniku studio",
// "projekt Marty": Polish endings are cut off (a simple stem), and at least half of the name's
// words must be there. Shared by the main process (registry) and the renderer (voice routing).

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, " ").trim();
const stem = (w: string) => (w.length > 5 ? w.slice(0, w.length - 2) : w.length >= 4 ? w.slice(0, -1) : w);

const GENERIC = new Set(["projekt", "project", "repo", "repozytorium", "app", "aplikacja", "kod", "code", "src", "the", "my", "moj"]);

export function matchWorkspace<T extends { name: string }>(list: readonly T[], words: string): T | undefined {
  const n = ` ${norm(words)} `;
  let best: { w: T; score: number } | undefined;
  for (const w of list) {
    // "Projekt", "repo", "app" in a name say nothing about which project: "w projekcie Zeta" is not
    // "Mini Projekt". They count only when the name has nothing else.
    const all = norm(w.name).split(" ").filter((p) => p.length > 1);
    const specific = all.filter((p) => !GENERIC.has(p));
    const parts = specific.length ? specific : all;
    if (!parts.length) continue;
    const hits = parts.filter((p) => n.includes(` ${stem(p)}`)).length;
    const score = hits / parts.length;
    if (hits && score > (best?.score ?? 0)) best = { w, score };
  }
  return best && best.score >= 0.5 ? best.w : undefined;
}
