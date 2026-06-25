// === Ad Creative Engine — kąty emocjonalne reklamy (Creative OS / PHASE 2) ===
// Czysta biblioteka KĄTÓW przekazu. Każdy kąt to inny hook emocjonalny — generujesz warianty tej
// samej oferty pod różne motywacje zakupowe. Wstrzykiwane jako wytyczna do generatora reklam (opcjonalne).

export interface AdAngle {
  id: string;
  label: string; // etykieta w UI (z emoji)
  guide: string; // wytyczna dla modelu, jak napisać reklamę w tym kącie
}

export const AD_ANGLES: AdAngle[] = [
  { id: "pain", label: "😣 Ból/problem", guide: "Uderz w konkretny ból odbiorcy i pokaż natychmiastową ulgę, jaką daje oferta." },
  { id: "fomo", label: "⏳ FOMO/pilność", guide: "Zbuduj pilność (ograniczony czas/miejsca) — pokaż, co odbiorca traci, jeśli nie zadziała teraz." },
  { id: "aspiration", label: "✨ Aspiracja", guide: "Pokaż pożądany rezultat i status, do którego prowadzi oferta — sprzedaj marzenie, nie cechy." },
  { id: "social", label: "👥 Dowód społeczny", guide: "Oprzyj przekaz na liczbach, opiniach lub znanych markach — inni już skorzystali i polecają." },
  { id: "saving", label: "💰 Oszczędność/ROI", guide: "Postaw na twardy ROI: konkretna oszczędność czasu lub pieniędzy, szybki zwrot z inwestycji." },
  { id: "simple", label: "🪄 Prostota", guide: "Podkreśl, że to banalnie proste — minimalny wysiłek, szybki efekt, zero ryzyka." },
  { id: "curiosity", label: "🤔 Ciekawość", guide: "Otwórz intrygującym pytaniem lub zaskoczeniem, które niemal wymusza kliknięcie." },
];

/** Pure: znajdź wytyczną kąta po id (pusta, gdy brak). */
export function adAngleGuide(id: string): string {
  return AD_ANGLES.find((a) => a.id === id)?.guide || "";
}
