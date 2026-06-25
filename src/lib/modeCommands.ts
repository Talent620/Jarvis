// === Detekcja KRÓTKICH komend trybu we wpisanej wiadomości ===
// Klucz: komenda trybu jest KRÓTKA („włącz tryb prywatny"). Długi WKLEJONY tekst (dokument, prompt)
// zawierający słowa offline/prywatnie/lokalnie/nieocenzurowany NIE jest komendą i NIE może
// przełączać trybu. To był realny bug: wklejenie długiego tekstu do przeczytania włączało Tryb
// Prywatny i przerywało odpowiedź. Czyste i testowalne.

const MAX_COMMAND_LEN = 100; // dłuższe = treść do przetworzenia, nie komenda do JARVIS-a

/** Czy wiadomość to krótka komenda „włącz Tryb Prywatny / offline / lokalnie". */
export function isPrivateModeCommand(text: string): boolean {
  if (!text || text.trim().length > MAX_COMMAND_LEN) return false;
  return /(tryb|w[łl][aą]?cz|wlacz).{0,16}(prywatn|offline|lokaln)|w pe[łl]ni prywatn|ca[łl]kowicie prywatn/.test(text.toLowerCase());
}

/**
 * Komenda „przeczytaj na głos: <tekst>" — wyłuskaj tekst do DOSŁOWNEGO odczytania (TTS bez mózgu).
 * Dwie formy: z separatorem (dwukropek/myślnik) — dowolna treść; bez separatora — tylko z „na głos"
 * i długą treścią (≥40 zn.), by nie łapać odwołań typu „przeczytaj na głos ostatnią wiadomość".
 * Zwraca tekst do odczytania albo null. Czyste.
 */
export function parseReadAloud(text: string): string | null {
  const t = (text || "").trim();
  let m = t.match(/^(?:przeczytaj|odczytaj|czytaj)(?:\s+mi)?(?:\s+to)?(?:\s+na\s+g[łl]os)?\s*[:\-–]\s*([\s\S]+)$/i);
  if (m && m[1].trim()) return m[1].trim();
  m = t.match(/^(?:przeczytaj|odczytaj|czytaj)(?:\s+mi)?(?:\s+to)?\s+na\s+g[łl]os\s+([\s\S]{40,})$/i);
  if (m && m[1].trim()) return m[1].trim();
  return null;
}

export interface UnfilteredCmd { on: boolean; off: boolean }

/** Czy wiadomość to krótka komenda włączenia/wyłączenia trybu bez ograniczeń (uncensored). */
export function matchUnfilteredCommand(text: string): UnfilteredCmd {
  if (!text || text.trim().length > MAX_COMMAND_LEN) return { on: false, off: false };
  const lc = text.toLowerCase();
  const on = /(tryb|w[łl][aą]?cz|wlacz).{0,24}(bez cenzury|bez ogranicze|nieocenzurow|posłusze|posluszen)|zdejmij.{0,16}ogranicze|wy[łl][aą]?cz.{0,16}(cenzur|filtr|ogranicze|wszelkie)|pe[łl]ne pos[łl]usze/.test(lc);
  const off = /(przywr[oó][cć]|w[łl][aą]?cz|wlacz).{0,24}(cenzur|filtr|ogranicze)|tryb.{0,8}(normaln|standardow|bezpieczn)/.test(lc);
  return { on, off };
}
