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

export interface UnfilteredCmd { on: boolean; off: boolean }

/** Czy wiadomość to krótka komenda włączenia/wyłączenia trybu bez ograniczeń (uncensored). */
export function matchUnfilteredCommand(text: string): UnfilteredCmd {
  if (!text || text.trim().length > MAX_COMMAND_LEN) return { on: false, off: false };
  const lc = text.toLowerCase();
  const on = /(tryb|w[łl][aą]?cz|wlacz).{0,24}(bez cenzury|bez ogranicze|nieocenzurow|posłusze|posluszen)|zdejmij.{0,16}ogranicze|wy[łl][aą]?cz.{0,16}(cenzur|filtr|ogranicze|wszelkie)|pe[łl]ne pos[łl]usze/.test(lc);
  const off = /(przywr[oó][cć]|w[łl][aą]?cz|wlacz).{0,24}(cenzur|filtr|ogranicze)|tryb.{0,8}(normaln|standardow|bezpieczn)/.test(lc);
  return { on, off };
}
