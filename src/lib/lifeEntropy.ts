// === Life Entropy — wskaźnik CHAOSU życia (nie produktywności) ===
// CZYSTY, klient-side. Z realnych danych (zadania, leady, projekty) liczy poziom „rozproszenia"
// i wskazuje JEDNĄ zmianę o największym wpływie — to, co najbardziej rozładuje napięcie. To nie
// licznik zrobionych rzeczy: mierzy bałagan i podpowiada następny ruch. Nieinwazyjne, S9-safe.

import type { AppData } from "../types";

const DAY = 86_400_000;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface EntropyDriver {
  key: string;
  severity: number; // 0..1 — udział w chaosie
  label: string; // krótki opis źródła
  fix: string; // konkretna, jedna rzecz do zrobienia
}

export interface LifeEntropy {
  score: number; // 0..100 (wyżej = większy chaos)
  level: "spokój" | "ogarnięte" | "napięcie" | "chaos";
  drivers: EntropyDriver[]; // posortowane wg severity malejąco
  topFix: string; // jedna zmiana o największym wpływie
}

/** Pure: policz entropię życia + wskaż największy pojedynczy ruch. */
export function lifeEntropy(d: AppData, now = Date.now()): LifeEntropy {
  const drivers: EntropyDriver[] = [];
  const tasks = d.tasks || [];
  const open = tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && new Date(t.due).getTime() < now);
  const backlog = open.filter((t) => !t.due && !t.priority); // bez kierunku
  const leads = d.leads || [];
  const stale = leads.filter((l) => (l.status === "contacted" || l.status === "offer") && (l.lastContactedAt || 0) > 0 && now - (l.lastContactedAt || 0) > 5 * DAY);
  const activeProjects = new Set(open.map((t) => t.projectId).filter(Boolean));

  if (overdue.length)
    drivers.push({ key: "overdue", severity: clamp01(overdue.length / 8), label: `${overdue.length} zadań po terminie`, fix: `Przejrzyj ${overdue.length} zaległych zadań i przełóż je realnie (albo świadomie odpuść) — to najsilniej rozładuje napięcie.` });
  if (backlog.length >= 8)
    drivers.push({ key: "backlog", severity: clamp01(backlog.length / 25), label: `${backlog.length} zadań bez terminu i priorytetu`, fix: `Nadaj priorytet 3 najważniejszym zadaniom na dziś — reszta backlogu przestanie ciążyć.` });
  if (stale.length)
    drivers.push({ key: "leads", severity: clamp01(stale.length / 6), label: `${stale.length} leadów bez kontaktu >5 dni`, fix: `Odśwież ${stale.length} leadów follow-upem — okazje sprzedażowe stygną najszybciej.` });
  if (activeProjects.size >= 4)
    drivers.push({ key: "spread", severity: clamp01((activeProjects.size - 3) / 5), label: `${activeProjects.size} projektów w toku naraz`, fix: `Wybierz 1–2 projekty na ten tydzień, resztę zaparkuj — rozproszenie uwagi to ukryty koszt.` });

  drivers.sort((a, b) => b.severity - a.severity);
  const score = Math.round(Math.min(100, drivers.reduce((s, x) => s + x.severity * 40, 0)));
  const level: LifeEntropy["level"] = score < 20 ? "spokój" : score < 45 ? "ogarnięte" : score < 70 ? "napięcie" : "chaos";
  const topFix = drivers[0]?.fix || "Jest spokojnie — dobry moment, by ruszyć jedną rzecz, którą odkładasz.";
  return { score, level, drivers, topFix };
}
