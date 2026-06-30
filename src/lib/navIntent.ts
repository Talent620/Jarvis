// === Most nawigacyjny: czat → otwórz dowolny moduł (Jeden Jarvis) ===
// Cel: czat (i głos) ma być JEDYNYM pilotem do całej aplikacji — bez szukania zakładek.
// Tu jest lekki pub/sub „intencji otwarcia ekranu" + czyste dopasowanie nazwy do modułu.
// App.tsx subskrybuje i mapuje id → istniejące setShowX. Nieinwazyjne (nowy kanał obok dotychczasowych).

export interface ScreenDef {
  id: string;
  label: string;
  aliases: string[];
}

// Rejestr modułów dostępnych do otwarcia z czatu. Każdy ma id (= klucz w App.tsx), etykietę i aliasy PL.
export const SCREENS: ScreenDef[] = [
  { id: "finance", label: "Finanse", aliases: ["finanse", "finansowy", "pieniądze", "pieniadze", "budżet", "budzet", "zysk", "kpi", "zeszyt finansowy", "dashboard finansowy"] },
  { id: "studio", label: "Studio Obrazów", aliases: ["studio", "obraz", "obrazy", "zdjęcie", "zdjecie", "grafika", "generuj obraz", "edytuj zdjęcie"] },
  { id: "web", label: "Kreator stron", aliases: ["strona", "strony", "kreator", "kreator stron", "www", "landing", "sklep www"] },
  { id: "mail", label: "Wyślij e-mail", aliases: ["mail", "email", "e-mail", "poczta", "napisz maila", "wyślij maila", "wyslij maila"] },
  { id: "sales", label: "Pulpit Sprzedaży", aliases: ["sprzedaż", "sprzedaz", "leady", "lead", "crm", "klienci", "pulpit", "pulpit sprzedaży"] },
  { id: "content", label: "Maszynka do kontentu", aliases: ["kontent", "content", "post", "social", "instagram", "facebook", "tiktok"] },
  { id: "ads", label: "Generator reklam", aliases: ["reklama", "reklamy", "ads", "kampania", "google ads", "meta ads"] },
  { id: "brand", label: "Dusza Marki", aliases: ["marka", "brand", "dusza marki", "ton marki", "kolory marki"] },
  { id: "money", label: "Zarabianie", aliases: ["zarabianie", "autopilot dochodu", "dochód", "dochod"] },
  { id: "sent", label: "Skrzynka wysłanych", aliases: ["wysłane", "wyslane", "skrzynka wysłanych", "wysłane maile"] },
  { id: "costs", label: "Koszty AI", aliases: ["koszty", "koszty ai", "wydatki ai", "ile wydałem na ai"] },
  { id: "memory", label: "Pamięć", aliases: ["pamięć", "pamiec", "wspomnienia", "centrum pamięci"] },
  { id: "tasks", label: "Zadania", aliases: ["zadania", "todo", "lista zadań", "lista zadan"] },
  { id: "cards", label: "Fiszki", aliases: ["fiszki", "nauka", "powtórki"] },
  { id: "translator", label: "Tłumacz", aliases: ["tłumacz", "tlumacz", "translator", "tłumaczenie"] },
  { id: "transcribe", label: "Transkrypcja", aliases: ["transkrypcja", "transkrybuj", "nagranie na tekst", "audio na tekst"] },
  { id: "bargain", label: "Łowca okazji", aliases: ["okazje", "promocje", "bargain", "łowca okazji"] },
  { id: "boss", label: "Tryb Szefa", aliases: ["szef", "tryb szefa", "boss", "agent"] },
  { id: "mind", label: "Umysł", aliases: ["umysł", "umysl", "mind", "rozumowanie"] },
  { id: "journal", label: "Dziennik", aliases: ["dziennik", "journal"] },
  { id: "projects", label: "Projekty", aliases: ["projekty", "projekt"] },
  { id: "profile", label: "Profil", aliases: ["profil", "o mnie"] },
  { id: "settings", label: "Ustawienia", aliases: ["ustawienia", "settings", "konfiguracja", "opcje"] },
  { id: "status", label: "Status systemu", aliases: ["status", "diagnostyka", "stan systemu"] },
  { id: "gadgets", label: "Gadżety", aliases: ["gadżety", "gadzety"] },
  { id: "hud", label: "HUD / Wizja", aliases: ["hud", "wizja", "kamera ai"] },
];

type Cb = (id: string) => void;
const subs = new Set<Cb>();

/** Subskrybuj prośby o otwarcie ekranu (App.tsx). Zwraca funkcję odpinającą. */
export function onScreenRequest(cb: Cb): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

/** Poproś o otwarcie ekranu po id (woła narzędzie czatu). Błąd jednego listenera nie blokuje reszty. */
export function requestScreen(id: string): void {
  subs.forEach((cb) => { try { cb(id); } catch { /* izoluj */ } });
}

/** Pure: dopasuj nazwę/intencję do modułu (po id, etykiecie, aliasach). Dokładne trafienie wygrywa,
 *  inaczej najdłuższy alias zawarty w pytaniu. S9-safe (bez /u). Zwraca null, gdy nic nie pasuje. */
export function resolveScreen(query: string): ScreenDef | null {
  const q = (query || "").toLowerCase().trim();
  if (!q) return null;
  let best: ScreenDef | null = null;
  let bestLen = 0;
  for (const s of SCREENS) {
    const cands = [s.id, s.label.toLowerCase(), ...s.aliases];
    for (const c of cands) {
      if (q === c) return s; // dokładne dopasowanie ma pierwszeństwo
      if (c.length >= 3 && q.includes(c) && c.length > bestLen) { best = s; bestLen = c.length; }
    }
  }
  return best;
}
