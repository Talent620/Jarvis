// === Android "Phone Use" Agent — RiskGuard + Parser Drzewa UI + Check-then-Act ===
// Czysta, testowalna warstwa lustrzana do natywnego RiskGuard.java / JarvisAccessibilityService.java.
// Zapewnia głęboką obronę (defense-in-depth): model dostaje skompresowane drzewo ekranu
// `[id] Role "Label" (x,y)`, pola haseł są twardo redagowane/blokowane, a akcje
// money/security/delete/send wymagają jawnego potwierdzenia użytkownika.

export type PhoneRiskCategory = "money" | "security" | "delete" | "send";

export interface UiElement {
  id: number;
  role: string;
  label: string;
  x: number;
  y: number;
  isPassword?: boolean;
}

export interface RiskAssessment {
  /** True = całkowita blokada (np. pole hasła — nigdy nie wolno czytać ani wypełniać). */
  blocked: boolean;
  /** True = wymaga jawnego potwierdzenia użytkownika przed wykonaniem. */
  requiresConfirmation: boolean;
  category: PhoneRiskCategory | null;
  reason: string;
}

export interface CheckThenActExpected {
  id: number;
  signature?: string;
  label?: string;
}

export interface CheckThenActResult {
  ok: boolean;
  aborted?: boolean;
  blocked?: boolean;
  element?: UiElement;
  reason?: string;
}

const PASSWORD_MARKER = "[PASSWORD_BLOCKED]";

const SECURITY_RE =
  /(has[łl][oa]|password|passwd|\bpin\b|cvv|cvc|otp|2fa|autoryz|uprawnieni|permission|dost[ęe]pno[śs][ćc]|accessibility|odinstaluj|uninstall|factory|reset|format|biometr|odcisk|klucz|certyfikat|root|admin)/i;
const MONEY_RE =
  /(przelew|zap[łl]a[ćc]|p[łl]atno[śs][ćc]|\bkup\b|kupuj|blik|karta|got[óo]wk|zam[óo]w|kasa|checkout|\bpay\b|payment|transfer|purchase|\bbuy\b|order|wallet|bank|mbank|pko|\bing\b|revolut|pekao|santander|millennium)/i;
const DELETE_RE =
  /(usu[ńn]|skasuj|wyczy[śs][ćc]|opr[óo][żz]nij|kosz|wyloguj|delete|remove|erase|wipe|trash|destroy|clear all|sign out|log out)/i;
const SEND_RE =
  /(wy[śs]lij|opublikuj|udost[ęe]pnij|zadzwo[ńn]|odpowiedz|przeka[żz]|\bsend\b|publish|\bshare\b|\bpost\b|submit|\bcall\b|\bdial\b|reply)/i;

const UI_LINE_RE = /^\s*\[(\d+)\]\s+([^\s"]+)\s+"([^"]*)"\s+\((-?\d+)\s*,\s*(-?\d+)\)\s*$/;

/** Pure: parsuje skompresowane drzewo UI z Androida (`[id] Role "Label" (x,y)`) do listy elementów. */
export function parseUiTree(compactTree: string): UiElement[] {
  const out: UiElement[] = [];
  for (const line of String(compactTree || "").split(/\r?\n/)) {
    const m = UI_LINE_RE.exec(line);
    if (!m) continue;
    const id = Number(m[1]);
    const role = m[2];
    const label = m[3];
    const x = Number(m[4]);
    const y = Number(m[5]);
    if (!Number.isFinite(id) || id <= 0) continue;
    out.push({
      id,
      role,
      label,
      x,
      y,
      ...(label === PASSWORD_MARKER ? { isPassword: true } : {}),
    });
  }
  return out;
}

/** Pure: formatuje elementy do skompresowanego drzewa `[id] Role "Label" (x,y)` z twardą redakcją haseł. */
export function formatUiTree(elements: UiElement[]): string {
  return (elements || [])
    .map((el) => {
      const safeLabel = el.isPassword
        ? PASSWORD_MARKER
        : String(el.label || "").replace(/[\r\n]+/g, " ").replace(/"/g, "'").trim().slice(0, 80);
      return `[${el.id}] ${el.role} "${safeLabel}" (${Math.round(el.x)},${Math.round(el.y)})`;
    })
    .join("\n");
}

/** Pure: twardy RiskGuard klasyfikujący akcje na telefonie (money/security/delete/send + blokada haseł). */
export function assessPhoneRisk(input: {
  action?: string;
  label?: string;
  packageName?: string;
  extraText?: string;
  isPassword?: boolean;
}): RiskAssessment {
  if (input.isPassword || input.label === PASSWORD_MARKER) {
    return {
      blocked: true,
      requiresConfirmation: false,
      category: "security",
      reason: "RiskGuard: całkowity zakaz odczytu i wypełniania pól haseł (isPassword).",
    };
  }
  const combined = `${input.label || ""} ${input.packageName || ""} ${input.extraText || ""}`;
  if (SECURITY_RE.test(combined)) {
    return {
      blocked: false,
      requiresConfirmation: true,
      category: "security",
      reason: "RiskGuard [security]: akcja dotyczy bezpieczeństwa lub uprawnień — wymaga potwierdzenia.",
    };
  }
  if (MONEY_RE.test(combined)) {
    return {
      blocked: false,
      requiresConfirmation: true,
      category: "money",
      reason: "RiskGuard [money]: akcja dotyczy finansów lub płatności — wymaga potwierdzenia.",
    };
  }
  if (DELETE_RE.test(combined)) {
    return {
      blocked: false,
      requiresConfirmation: true,
      category: "delete",
      reason: "RiskGuard [delete]: akcja usuwa dane lub wylogowuje — wymaga potwierdzenia.",
    };
  }
  if (SEND_RE.test(combined)) {
    return {
      blocked: false,
      requiresConfirmation: true,
      category: "send",
      reason: "RiskGuard [send]: akcja wysyła lub publikuje treść na zewnątrz — wymaga potwierdzenia.",
    };
  }
  return { blocked: false, requiresConfirmation: false, category: null, reason: "" };
}

/** Pure: weryfikacja pętli Check-then-Act (czy ekran się nie zmienił i cel nadal istnieje oraz nie jest hasłem). */
export function verifyCheckThenAct(
  expected: CheckThenActExpected,
  live: { signature: string; elements: UiElement[] },
): CheckThenActResult {
  if (expected.signature && expected.signature.trim() && expected.signature.trim() !== live.signature) {
    return {
      ok: false,
      aborted: true,
      reason: "Ekran zmienił się przed wykonaniem akcji (Check-then-Act) — odśwież drzewo UI.",
    };
  }
  const el = live.elements.find((e) => e.id === expected.id);
  if (!el) {
    return {
      ok: false,
      aborted: true,
      reason: `Element [${expected.id}] nie istnieje już na ekranie (Check-then-Act).`,
    };
  }
  if (el.isPassword || el.label === PASSWORD_MARKER) {
    return {
      ok: false,
      blocked: true,
      reason: "RiskGuard: całkowity zakaz interakcji z polem hasła.",
    };
  }
  if (expected.label && expected.label.trim() && el.label.trim().toLowerCase() !== expected.label.trim().toLowerCase()) {
    return {
      ok: false,
      aborted: true,
      reason: `Etykieta elementu [${expected.id}] zmieniła się na „${el.label}” — przerwano.`,
    };
  }
  return { ok: true, element: el };
}
