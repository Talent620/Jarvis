// Szybkie dodawanie zadań w stylu Nozbe — naturalny zapis z jednej linii:
//   "Zadzwoń do Kowalskiego #Strona-Kowalski @telefon ! jutro +Marek"
//      → tytuł, projekt, kontekst, priorytet, termin, osoba odpowiedzialna.
// Czyste, w pełni testowalne (bez stanu, bez sieci).

export interface ParsedTask {
  title: string;
  projectName?: string; // po # (komponent dopasuje/utworzy projekt)
  category?: string;    // po @
  owner?: string;       // po +
  priority: boolean;    // token !
  due?: string;         // ISO data (YYYY-MM-DD) z naturalnego słowa lub zapisu
  repeat?: "daily" | "weekly" | "monthly";
}

const WEEKDAYS: Record<string, number> = {
  niedziela: 0, niedz: 0, nd: 0,
  poniedzialek: 1, poniedziałek: 1, pon: 1, pn: 1,
  wtorek: 2, wt: 2,
  sroda: 3, środa: 3, sr: 3, śr: 3,
  czwartek: 4, czw: 4, cz: 4,
  piatek: 5, piątek: 5, pt: 5, pia: 5,
  sobota: 6, sob: 6, sb: 6,
};

const norm = (s: string) => s.toLowerCase().normalize("NFC");

/** Zamień słowo terminu na datę ISO (YYYY-MM-DD) względem `today`. */
export function resolveDueWord(word: string, today = new Date()): string | null {
  const w = norm(word);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w);
  if (iso) return w;
  // dd.mm lub dd.mm.yyyy
  const dm = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/.exec(w);
  if (dm) {
    const day = +dm[1], mon = +dm[2] - 1;
    let year = dm[3] ? +dm[3] : today.getFullYear();
    if (year < 100) year += 2000;
    const d = new Date(year, mon, day);
    if (!dm[3] && d.getTime() < startOfDay(today).getTime()) d.setFullYear(year + 1); // przeszłe → przyszły rok
    return toISO(d);
  }
  if (w === "dzis" || w === "dziś" || w === "today") return toISO(today);
  if (w === "jutro" || w === "tomorrow") return toISO(addDays(today, 1));
  if (w === "pojutrze") return toISO(addDays(today, 2));
  if (w in WEEKDAYS) return toISO(nextWeekday(today, WEEKDAYS[w]));
  return null;
}

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d: Date, n: number) { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; }
function toISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function nextWeekday(from: Date, target: number) {
  const x = startOfDay(from);
  let diff = (target - x.getDay() + 7) % 7;
  if (diff === 0) diff = 7; // „w poniedziałek" = najbliższy przyszły
  x.setDate(x.getDate() + diff);
  return x;
}

/**
 * Sparsuj jedną linię na zadanie. Tokeny: `#projekt`, `@kontekst`, `+osoba`,
 * `!` (priorytet), słowa terminu (dziś/jutro/pon…/dd.mm/ISO), `*dziennie|co tydzień`.
 * Tytuł = reszta. Tokeny mogą być w dowolnym miejscu.
 */
export function parseQuickTask(input: string, today = new Date()): ParsedTask {
  const out: ParsedTask = { title: "", priority: false };
  const titleWords: string[] = [];

  for (const raw of input.trim().split(/\s+/)) {
    if (!raw) continue;
    const tok = raw;
    if (tok === "!" || tok === "!!" || norm(tok) === "priorytet") { out.priority = true; continue; }
    if (tok.startsWith("#") && tok.length > 1) { out.projectName = tok.slice(1).replace(/[_-]+/g, " ").trim(); continue; }
    if (tok.startsWith("@") && tok.length > 1) { out.category = tok.slice(1).toLowerCase(); continue; }
    if (tok.startsWith("+") && tok.length > 1) { out.owner = tok.slice(1); continue; }
    if (tok.startsWith("*") && tok.length > 1) {
      const r = norm(tok.slice(1));
      if (/dzien|codz|daily/.test(r)) out.repeat = "daily";
      else if (/tydz|tyg|week/.test(r)) out.repeat = "weekly";
      else if (/mies|month/.test(r)) out.repeat = "monthly";
      continue;
    }
    const due = resolveDueWord(tok, today);
    if (due && !out.due) { out.due = due; continue; }
    titleWords.push(tok);
  }
  out.title = titleWords.join(" ").trim();
  return out;
}

/** Następny termin powtarzalnego zadania po wykonaniu (ISO). */
export function nextRepeat(due: string | undefined, repeat: "daily" | "weekly" | "monthly", from = new Date()): string {
  const base = due ? new Date(due + "T00:00:00") : startOfDay(from);
  const d = new Date(base);
  if (repeat === "daily") d.setDate(d.getDate() + 1);
  else if (repeat === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  // Nie cofaj w przeszłość — gdy zaległe, przeskocz do najbliższego przyszłego.
  const todayStart = startOfDay(from);
  while (d.getTime() < todayStart.getTime()) {
    if (repeat === "daily") d.setDate(d.getDate() + 1);
    else if (repeat === "weekly") d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
  }
  return toISO(d);
}
