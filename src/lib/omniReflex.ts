// === JARVIS OMNI-PILOT · Warstwa 2: Natychmiastowy Refleks Głosowy (<30 ms, offline, 0 USD) ===
// Rozpoznaje polskie komendy głosowe (również bez polskich znaków z STT) do natychmiastowego
// sterowania kursorem, myszą, przewijaniem, oknami, skrótami, głośnością, mediami oraz
// komendy wizyjne („przesuń kursor na ikonę X", „kliknij Y") i wielokrokowe zadania autopilota.
// 100% zgodny z ES2019 / Chrome 79 (bez lookbehind i klas Unicode property).

export type OmniIntent =
  | { kind: "abort" }
  | { kind: "cursor_relative"; dx: number; dy: number; label: string }
  | { kind: "cursor_named"; preset: string; label: string }
  | { kind: "mouse"; action: "click" | "double" | "right" | "middle"; label: string }
  | { kind: "scroll"; direction: "up" | "down" | "left" | "right"; amount: number; label: string }
  | { kind: "windows_list" }
  | { kind: "window_focus"; query: string }
  | { kind: "launch"; app: string }
  | { kind: "volume"; action: string }
  | { kind: "media"; action: "playpause" | "next" | "prev" | "stop" }
  | { kind: "hotkey"; combo: string; label: string }
  | { kind: "type_text"; text: string }
  | { kind: "visual"; action: "move" | "click" | "double" | "right" | "locate"; target: string }
  | { kind: "omni_goal"; goal: string };

/** Pure: usuń polskie znaki i znormalizuj spacje (odporność na niedoskonałości STT). */
export function foldPolish(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/ą/g, "a")
    .replace(/ć/g, "c")
    .replace(/ę/g, "e")
    .replace(/ł/g, "l")
    .replace(/ń/g, "n")
    .replace(/ó/g, "o")
    .replace(/ś/g, "s")
    .replace(/ź/g, "z")
    .replace(/ż/g, "z")
    .replace(/[!?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripWakePrefix(folded: string): string {
  return folded.replace(/^(?:hej |ok |ej )?jarvis\s+/, "").trim();
}

function parseMagnitude(folded: string): number {
  const px = folded.match(/(?:o\s+)?(\d{1,4})\s*(?:px|piks|punkt)/);
  if (px) return Math.max(15, Math.min(1200, Number(px[1])));
  if (/\b(minimalnie|odrobine|kawalek|lekko|troche|delikatnie)\b/.test(folded)) return 95;
  if (/\b(mocno|daleko|bardzo|duzo|maksymalnie)\b/.test(folded)) return 480;
  return 240;
}

/**
 * Pure: rozpoznaj komendę sterowania komputerem z naturalnej mowy po polsku.
 * Zwraca `null`, gdy wypowiedź nie jest bezpośrednią komendą pulpitu (idzie wtedy do normalnego mózgu AI).
 */
export function parseOmniVoiceCommand(rawText: string): OmniIntent | null {
  const original = (rawText || "").trim();
  if (!original) return null;
  const f = stripWakePrefix(foldPolish(original));
  if (!f) return null;

  // 0) Awaryjny STOP
  if (/^(?:stop|stoj|przerwij|zatrzymaj kursor|zatrzymaj autopilota|anuluj ruch)$/.test(f)) {
    return { kind: "abort" };
  }

  // 1) Wielokrokowy komputerowy autopilot ("zrób na komputerze...", "napraw na ekranie...", "autopilot...")
  const omniMatch = original.match(/^(?:(?:hej|ok|ej)\s+)?(?:jarvis[,:\s]+)?(?:zrób na komputerze|zrob na komputerze|wykonaj na komputerze|wykonaj na ekranie|napraw na ekranie|autopilot(?:\s+pulpitu)?|omni\s*pilot)[:\s,-]+(.+)$/i);
  if (omniMatch && omniMatch[1].trim().length >= 4) {
    return { kind: "omni_goal", goal: omniMatch[1].trim() };
  }

  // 2) WIZYJNE NAMIERZANIE (PRZED ruchem kierunkowym, bo „przesuń kursor na ikonę Firefox" jest bardziej szczegółowe!)
  const visDouble = original.match(/^(?:(?:hej|ok|ej)\s+)?(?:jarvis[,:\s]+)?(?:kliknij\s+(?:dwukrotnie|dwa razy)\s+(?:na|w)|otwórz ikon[ęe]|otworz ikone|uruchom ikon[ęe])\s+(.+)$/i);
  if (visDouble && visDouble[1].trim()) {
    return { kind: "visual", action: "double", target: visDouble[1].trim() };
  }
  const visRight = original.match(/^(?:(?:hej|ok|ej)\s+)?(?:jarvis[,:\s]+)?(?:kliknij\s+prawym(?:\s+przyciskiem)?\s+(?:na|w)|prawy\s+klik\s+(?:na|w))\s+(.+)$/i);
  if (visRight && visRight[1].trim()) {
    return { kind: "visual", action: "right", target: visRight[1].trim() };
  }
  const visMove = original.match(/^(?:(?:hej|ok|ej)\s+)?(?:jarvis[,:\s]+)?(?:przesu[ńn]\s+(?:kursor|myszk[ęe]|wska[źz]nik)|najed[źz](?:\s+kursorem)?|kursor)\s+(?:na|nad)\s+(.+)$/i);
  if (visMove && visMove[1].trim()) {
    const tgt = visMove[1].trim();
    const tgtFold = foldPolish(tgt);
    // Jeśli to nazwany punkt ekranu (środek / rogi / pasek) → natychmiastowy refleks 0 USD!
    if (/^(?:srodek|centrum)(?:\s+ekranu)?$/.test(tgtFold)) return { kind: "cursor_named", preset: "center", label: "środek ekranu" };
    if (/^(?:lewy gorny|gorny lewy)(?:\s+rog)?$/.test(tgtFold)) return { kind: "cursor_named", preset: "top-left", label: "lewy górny róg" };
    if (/^(?:prawy gorny|gorny prawy)(?:\s+rog)?$/.test(tgtFold)) return { kind: "cursor_named", preset: "top-right", label: "prawy górny róg" };
    if (/^(?:lewy dolny|dolny lewy)(?:\s+rog)?$/.test(tgtFold)) return { kind: "cursor_named", preset: "bottom-left", label: "lewy dolny róg" };
    if (/^(?:prawy dolny|dolny prawy)(?:\s+rog)?$/.test(tgtFold)) return { kind: "cursor_named", preset: "bottom-right", label: "prawy dolny róg" };
    if (/^(?:gorny pasek|pasek gorny)$/.test(tgtFold)) return { kind: "cursor_named", preset: "topbar", label: "górny pasek" };
    if (/^(?:dolny pasek|dock|pasek zadan)$/.test(tgtFold)) return { kind: "cursor_named", preset: "dock", label: "dolny pasek" };
    return { kind: "visual", action: "move", target: tgt };
  }
  const visClick = original.match(/^(?:(?:hej|ok|ej)\s+)?(?:jarvis[,:\s]+)?(?:kliknij(?:\s+(?:na|w))?|naci[śs]nij(?:\s+(?:na|przycisk))?|wybierz na ekranie)\s+(.+)$/i);
  if (visClick && visClick[1].trim()) {
    const t = foldPolish(visClick[1]);
    if (!/^(?:prawym|prawy|dwa razy|dwukrotnie|srodkowym|lewym|lewy|tutaj|tu)$/.test(t)) {
      return { kind: "visual", action: "click", target: visClick[1].trim() };
    }
  }
  const visFind = original.match(/^(?:(?:hej|ok|ej)\s+)?(?:jarvis[,:\s]+)?(?:znajd[źz]\s+na\s+ekranie|gdzie\s+(?:jest|na\s+ekranie\s+jest)|wska[źz]\s+na\s+ekranie)\s+(.+)$/i);
  if (visFind && visFind[1].trim()) {
    return { kind: "visual", action: "locate", target: visFind[1].trim() };
  }

  // 3) KIERUNKOWY RUCH KURSORA (natychmiastowy refleks <30 ms)
  if (/\b(?:kursor|myszke|mysz|wskaznik)\b/.test(f) || /^(?:przesun|rusz)\s+(?:w\s+)?(?:prawo|lewo|gore|dol|wyzej|nizej)/.test(f)) {
    const dist = parseMagnitude(f);
    let dx = 0;
    let dy = 0;
    const dirs: string[] = [];
    if (/\b(prawo|w prawo|prawa)\b/.test(f)) { dx += dist; dirs.push("w prawo"); }
    if (/\b(lewo|w lewo|lewa)\b/.test(f)) { dx -= dist; dirs.push("w lewo"); }
    if (/\b(gore|w gore|do gory|wyzej)\b/.test(f)) { dy -= dist; dirs.push("w górę"); }
    if (/\b(dol|w dol|nizej)\b/.test(f)) { dy += dist; dirs.push("w dół"); }
    if (dx !== 0 || dy !== 0) {
      return { kind: "cursor_relative", dx, dy, label: `${dirs.join(" i ")} (${dist} px)` };
    }
    if (/\b(srodek|centrum)\b/.test(f)) return { kind: "cursor_named", preset: "center", label: "środek ekranu" };
  }

  // 4) KLIKNIĘCIA MYSZĄ
  if (/^(?:podwojny klik|kliknij dwa razy|kliknij dwukrotnie|dwuklik)$/.test(f)) {
    return { kind: "mouse", action: "double", label: "podwójny klik" };
  }
  if (/^(?:prawy klik|kliknij prawym|kliknij prawym przyciskiem|menu kontekstowe)$/.test(f)) {
    return { kind: "mouse", action: "right", label: "prawy klik" };
  }
  if (/^(?:srodkowy klik|kliknij srodkowym)$/.test(f)) {
    return { kind: "mouse", action: "middle", label: "środkowy klik" };
  }
  if (/^(?:klik|kliknij|kliknij tu|kliknij tutaj|lewy klik|kliknij lewym)$/.test(f)) {
    return { kind: "mouse", action: "click", label: "kliknięcie" };
  }

  // 5) PRZEWIJANIE (SCROLL)
  if (/\b(przewin|scroll|zjedz|podjedz)\b/.test(f)) {
    const amount = /\b(mocno|duzo|daleko|bardzo)\b/.test(f) ? 11 : /\b(lekko|troche)\b/.test(f) ? 2 : 5;
    if (/\b(gore|do gory|wyzej)\b/.test(f)) return { kind: "scroll", direction: "up", amount, label: "w górę" };
    if (/\b(lewo|w lewo)\b/.test(f)) return { kind: "scroll", direction: "left", amount, label: "w lewo" };
    if (/\b(prawo|w prawo)\b/.test(f)) return { kind: "scroll", direction: "right", amount, label: "w prawo" };
    if (/\b(dol|w dol|nizej)\b/.test(f)) return { kind: "scroll", direction: "down", amount, label: "w dół" };
  }

  // 6) OKNA PULPITU
  if (/^(?:jakie mam otwarte okna|pokaz otwarte okna|lista okien|otwarte okna)$/.test(f)) {
    return { kind: "windows_list" };
  }
  const focusMatch = original.match(/^(?:(?:hej|ok|ej)\s+)?(?:jarvis[,:\s]+)?(?:prze[łl][ąa]cz\s+(?:si[ęe]\s+)?na|przejd[źz]\s+(?:do|na)|poka[żz]\s+okno|aktywuj\s+okno)\s+(.+)$/i);
  if (focusMatch && focusMatch[1].trim()) {
    return { kind: "window_focus", query: focusMatch[1].trim() };
  }

  // 7) URUCHAMIANIE APLIKACJI (krótki refleks — tylko konkretne znane polecenia, bez blokowania pytań ogólnych)
  const launchMatch = original.match(/^(?:(?:hej|ok|ej)\s+)?(?:jarvis[,:\s]+)?(?:uruchom|odpal|otw[óo]rz\s+program|w[łl][ąa]cz\s+program)\s+([a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ._+-]{2,40})$/i);
  if (launchMatch && launchMatch[1].trim()) {
    const app = launchMatch[1].trim();
    if (!/^(?:to|go|ja|je|ten|ta)$/i.test(foldPolish(app))) {
      return { kind: "launch", app };
    }
  }

  // 8) GŁOŚNOŚĆ I MULTIMEDIA
  const volSet = f.match(/^(?:ustaw glosnosc|glosnosc)\s+(?:na\s+)?(\d{1,3})(?:\s*%| procent)?$/);
  if (volSet) return { kind: "volume", action: `set:${Math.min(100, Number(volSet[1]))}` };
  if (/^(?:glosniej|podglosnij|zwieksz glosnosc)$/.test(f)) return { kind: "volume", action: "up" };
  if (/^(?:ciszej|scisz|zmniejsz glosnosc)$/.test(f)) return { kind: "volume", action: "down" };
  if (/^(?:wycisz|wycisz dzwiek|odcisz)$/.test(f)) return { kind: "volume", action: "mute" };
  if (/^(?:pauza|zatrzymaj muzyke|wznow muzyke|odtwarzaj)$/.test(f)) return { kind: "media", action: "playpause" };
  if (/^(?:nastepny utwor|nastepna piosenka|dalej muzyka)$/.test(f)) return { kind: "media", action: "next" };
  if (/^(?:poprzedni utwor|poprzednia piosenka|wroc utwor)$/.test(f)) return { kind: "media", action: "prev" };

  // 9) SKRÓTY KLAWISZOWE I PISANIE UTF-8
  if (/^(?:cofnij|cofnij to)$/.test(f)) return { kind: "hotkey", combo: "ctrl+z", label: "Cofnij (Ctrl+Z)" };
  if (/^(?:ponow|przywr[óo]c)$/.test(f)) return { kind: "hotkey", combo: "ctrl+y", label: "Ponów (Ctrl+Y)" };
  if (/^(?:zapisz|zapisz plik)$/.test(f)) return { kind: "hotkey", combo: "ctrl+s", label: "Zapisz (Ctrl+S)" };
  if (/^(?:skopiuj|kopiuj|skopiuj to)$/.test(f)) return { kind: "hotkey", combo: "ctrl+c", label: "Kopiuj (Ctrl+C)" };
  if (/^(?:wklej|wklej to)$/.test(f)) return { kind: "hotkey", combo: "ctrl+v", label: "Wklej (Ctrl+V)" };
  if (/^(?:zaznacz wszystko)$/.test(f)) return { kind: "hotkey", combo: "ctrl+a", label: "Zaznacz wszystko (Ctrl+A)" };
  if (/^(?:nowa karta)$/.test(f)) return { kind: "hotkey", combo: "ctrl+t", label: "Nowa karta (Ctrl+T)" };
  if (/^(?:zamknij karte)$/.test(f)) return { kind: "hotkey", combo: "ctrl+w", label: "Zamknij kartę (Ctrl+W)" };
  if (/^(?:nastepne okno|przelacz okno)$/.test(f)) return { kind: "hotkey", combo: "alt+tab", label: "Przełącz okno (Alt+Tab)" };
  if (/^(?:odswiez strone|odswiez)$/.test(f)) return { kind: "hotkey", combo: "f5", label: "Odśwież (F5)" };
  if (/^(?:pelny ekran)$/.test(f)) return { kind: "hotkey", combo: "f11", label: "Pełny ekran (F11)" };
  if (/^(?:nacisnij enter|wcisnij enter|enter)$/.test(f)) return { kind: "hotkey", combo: "enter", label: "Enter" };
  if (/^(?:nacisnij escape|wcisnij escape|escape)$/.test(f)) return { kind: "hotkey", combo: "escape", label: "Escape" };

  const typeMatch = original.match(/^(?:(?:hej|ok|ej)\s+)?(?:jarvis[,:\s]+)?(?:wpisz|napisz na ekranie|dyktuj)[:\s]+(.+)$/i);
  if (typeMatch && typeMatch[1].trim()) {
    return { kind: "type_text", text: typeMatch[1].trim() };
  }

  return null;
}
