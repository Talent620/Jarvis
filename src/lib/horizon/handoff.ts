// === Karta Przekazania: twarda granica STOP jako przyjemny rytuał, nie porażka ===
// Granice, których NIGDY nie omijamy (hasło, biometria, MFA, CAPTCHA, regulamin,
// płatność, publikacja, szerokie uprawnienia). Krok z taką granicą nie jest wykonywany
// autonomicznie — zamienia się w Kartę Przekazania: „to zrobię, gdy potwierdzisz na
// telefonie". Czyste, bez efektów ubocznych.
import type { HandoffCard, HardStopKind, Mission, MissionStep } from "./types";

const PROMPTS: Record<HardStopKind, string> = {
  password: "Wpisanie hasła",
  biometrics: "Potwierdzenie biometryczne",
  mfa: "Kod z drugiego składnika (MFA)",
  captcha: "Rozwiązanie CAPTCHA",
  terms: "Akceptacja regulaminu",
  payment: "Płatność",
  publish: "Publikacja treści",
  broad_consent: "Nadanie szerokich uprawnień",
};

const NODE_LABEL: Record<MissionStep["node"], string> = {
  phone: "telefonie",
  exe: "komputerze",
  device: "urządzeniu",
};

/** Zbuduj Kartę Przekazania dla kroku wymagającego człowieka. Czysta. */
export function makeHandoff(mission: Mission, step: MissionStep, now: number): HandoffCard {
  const what = step.hardStop ? PROMPTS[step.hardStop] : "Potwierdzenie";
  const where = NODE_LABEL[step.node];
  return {
    missionId: mission.id,
    stepId: step.id,
    fromNode: step.node,
    kind: step.hardStop || "broad_consent",
    // Krótko, po ludzku, bez straszenia: co czeka i gdzie się to dzieje.
    prompt: `„${step.capability}" na ${where} wymaga: ${what}. Zatwierdź na telefonie, żeby dokończyć.`,
    createdAt: now,
  };
}

/** Czy krok jest twardą granicą STOP? */
export function isHardStop(step: MissionStep): boolean {
  return !!step.hardStop;
}
