// ⬢ Przycisk „Tryb Szefa" — przeciągalny (drag) po ekranie, z zapamiętaną pozycją.
// Klik = otwórz agenta głosowego; przeciągnięcie = przesuń ikonę. Pozycja trzymana w
// localStorage (lsJson) i przycinana do widocznego obszaru po zmianie rozmiaru okna.
// Domyślnie (brak zapisanej pozycji) zostaje miejsce z CSS (prawy dół) — zero zmian dla
// nowych użytkowników. Idiom wskaźnika (setPointerCapture) jak w Studio.tsx.

import React, { useEffect, useRef, useState } from "react";
import { loadJson, saveJson } from "../lib/lsJson";

const POS_KEY = "jarvis.bossFab.pos";
const DRAG_THRESHOLD = 5; // px — poniżej tego ruch traktujemy jako klik, nie przeciąganie
const FAB_SIZE = 48;
const MARGIN = 4;

type Pos = { x: number; y: number };

function clampToViewport(p: Pos): Pos {
  const maxX = (typeof window !== "undefined" ? window.innerWidth : 9999) - FAB_SIZE - MARGIN;
  const maxY = (typeof window !== "undefined" ? window.innerHeight : 9999) - FAB_SIZE - MARGIN;
  return {
    x: Math.max(MARGIN, Math.min(maxX, p.x)),
    y: Math.max(MARGIN, Math.min(maxY, p.y)),
  };
}

export default function BossFab({ onOpen }: { onOpen: () => void }): React.ReactElement {
  // null → użyj domyślnej pozycji z CSS; obiekt → użytkownik przeciągnął ikonę.
  const [pos, setPos] = useState<Pos | null>(() => loadJson<Pos | null>(POS_KEY, null));
  const [dragging, setDragging] = useState(false);
  const elRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ sx: number; sy: number; dx: number; dy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const posRef = useRef<Pos | null>(pos);
  posRef.current = pos;

  // Po zmianie rozmiaru okna utrzymaj przycisk w widoku (i zapisz skorygowaną pozycję).
  useEffect(() => {
    if (!pos) return;
    const onResize = () => {
      const clamped = clampToViewport(posRef.current!);
      setPos(clamped);
      saveJson(POS_KEY, clamped);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pos]);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>): void {
    const rect = elRef.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = { sx: e.clientX, sy: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false };
    elRef.current?.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>): void {
    const d = drag.current;
    if (!d || !e.buttons) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
    }
    setPos(clampToViewport({ x: e.clientX - d.dx, y: e.clientY - d.dy }));
  }

  function onPointerUp(): void {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      setDragging(false);
      suppressClick.current = true; // przeciąganie nie ma otwierać Trybu Szefa
      if (posRef.current) saveJson(POS_KEY, posRef.current);
    }
  }

  function onClick(): void {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onOpen();
  }

  return (
    <button
      ref={elRef}
      className={"boss-fab" + (dragging ? " dragging" : "")}
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      title={'Tryb Szefa — agent głosowy (powiedz „szef”). Przeciągnij, by przesunąć.'}
      aria-label="Tryb Szefa"
    >
      ⬢
    </button>
  );
}
