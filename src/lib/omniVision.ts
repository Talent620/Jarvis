// === JARVIS OMNI-PILOT · Warstwa 3: Silnik Wizyjnego Namierzania (Visual Grounding 0..1000) + RiskGuard ===
// Zamienia zrzut ekranu + opis elementu (np. „ikona Firefox", „przycisk Zapisz") w dokładne
// współrzędne ekranowe (px) przy użyciu przestrzeni znormalizowanej [0..1000, 0..1000] (niezależnej
// od rozdzielczości i skalowania HiDPI) oraz chroni użytkownika twardym Desktop RiskGuardem.

import { aiRequest } from "./autocore/gateway";
import type { DetailedScreenshot } from "./desktop";

export type DesktopRiskKind = "none" | "password" | "payment" | "destructive" | "send";

export interface GroundedTarget {
  found: boolean;
  /** Znormalizowane współrzędne 0..1000 (do retikuli HUD i niezależne od skali). */
  xNorm: number;
  yNorm: number;
  /** Rzeczywiste piksele ekranu (przeliczone z screenWidth × screenHeight). */
  x: number;
  y: number;
  label: string;
  confidence: number;
  risk: DesktopRiskKind;
  reason: string;
}

export interface DesktopRiskVerdict {
  blocked: boolean;
  requiresConfirmation: boolean;
  reason?: string;
}

export interface OmniPlanStep {
  action:
    | "visual_click"
    | "visual_double"
    | "visual_right"
    | "move_cursor"
    | "type"
    | "hotkey"
    | "scroll"
    | "focus_window"
    | "launch_app"
    | "wait"
    | "done"
    | "need_human";
  target?: string;
  xNorm?: number;
  yNorm?: number;
  text?: string;
  combo?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  app?: string;
  window?: string;
  risk?: DesktopRiskKind;
  summary: string;
}

export const VISUAL_GROUNDING_SYSTEM = [
  "Jesteś precyzyjnym silnikiem wizyjnego namierzania UI (Visual Grounding) dla systemu JARVIS OMNI-PILOT.",
  "Otrzymujesz zrzut ekranu pulpitu oraz opis docelowego elementu (ikona, przycisk, pole, zakładka, link, okno).",
  "Twoim zadaniem jest znalezienie DOKŁADNEGO środka tego elementu w układzie znormalizowanym 0..1000:",
  "- x = 0 to lewa krawędź ekranu, x = 1000 to prawa krawędź ekranu;",
  "- y = 0 to górna krawędź ekranu, y = 1000 to dolna krawędź ekranu.",
  "OCEŃ BEZPIECZEŃSTWO elementu w polu risk: 'password' (pole hasła/PIN/2FA/klucz), 'payment' (zapłać/przelew/kup), 'destructive' (usuń/formatuj/wyłącz), 'send' (wyślij wiadomość/opublikuj), 'none' (bezpieczne).",
  "Zwróć WYŁĄCZNIE czysty obiekt JSON bez komentarzy i bez markdown:",
  '{"found":true,"x":512,"y":340,"label":"co dokładnie widzisz","confidence":0.92,"risk":"none","reason":"krótko gdzie to jest"}',
  'Jeśli elementu NIE widać na ekranie, zwróć: {"found":false,"x":0,"y":0,"label":"","confidence":0,"risk":"none","reason":"dlaczego nie widać"}.',
].join("\n");

export const OMNI_PLANNER_SYSTEM = [
  "Jesteś autonomicznym operatorem komputera JARVIS OMNI-PILOT (pętla Obserwuj → Zaplanuj → Wykonaj → Zweryfikuj).",
  "Otrzymujesz aktualny zrzut ekranu, listę otwartych okien, cel użytkownika i historię poprzednich kroków.",
  "Zwróć WYŁĄCZNIE JEDEN następny atomowy krok jako czysty JSON (bez markdown):",
  '{"action":"visual_click|visual_double|visual_right|move_cursor|type|hotkey|scroll|focus_window|launch_app|wait|done|need_human","target":"opis elementu","xNorm":500,"yNorm":500,"text":"...","combo":"ctrl+s","direction":"down","amount":5,"app":"firefox","window":"Firefox","risk":"none|password|payment|destructive|send","summary":"krótkie zdanie po polsku co robisz"}',
  "Zasady:",
  "- Jeśli widzisz dokładnie element do kliknięcia, podaj xNorm (0..1000) i yNorm (0..1000) ORAZ target.",
  "- Jeśli cel jest już osiągnięty na ekranie → action:'done' z krótkim podsumowaniem.",
  "- Jeśli na ekranie jest CAPTCHA, logowanie/hasło, 2FA albo płatność → action:'need_human' (NIGDY nie omijaj!).",
  "- Nie powtarzaj dokładnie tego samego kroku, który już nie przyniósł efektu — spróbuj innej drogi albo need_human.",
].join("\n");

const PASSWORD_RE = /\b(hasl|hasł|password|passcode|pin\b|2fa|otp|tajny klucz|seed phrase|private key|klucz prywatny|passwd)\b/i;
const PAYMENT_RE = /\b(zaplac|zapłać|przelew|kup teraz|buy now|checkout|pay now|potwierdz platnosc|potwierdź płatność|blik|karta kredytowa)\b/i;
const DESTRUCTIVE_RE = /\b(usun trwale|usuń trwale|delete forever|formatuj|format disk|wyczysc dysk|wyczyść dysk|odinstaluj|shutdown|poweroff|reboot|wylacz komputer|wyłącz komputer|mkfs|fdisk|diskpart|rm\s+-rf)\b/i;
const SEND_RE = /\b(wyslij teraz|wyślij teraz|send email|opublikuj|publish now|post now|prześlij dalej)\b/i;
const RISKY_HOTKEY_RE = /^(?:ctrl\+w|alt\+f4|ctrl\+q|ctrl\+shift\+q|shift\+delete|ctrl\+alt\+del(?:ete)?|super\+l|win\+l)$/i;
const BLOCKED_HOTKEY_RE = /^(?:ctrl\+alt\+del(?:ete)?|ctrl\+alt\+backspace)$/i;
const RISKY_LAUNCH_RE = /\b(terminal|konsole|alacritty|kitty|xterm|bash|zsh|sh\b|powershell|pwsh|cmd|sudo|regedit|gparted|disks|format|fdisk|diskpart|dd\b|mkfs|rm\b|shutdown|reboot|poweroff|systemctl)\b/i;

/** Pure: Desktop RiskGuard — twarda blokada haseł i zgoda przed płatnościami/destrukcją/wysyłką/ryzykownymi skrótami i aplikacjami. */
export function assessDesktopActionRisk(
  targetLabel: string,
  action: string,
  modelRisk: DesktopRiskKind = "none",
): DesktopRiskVerdict {
  const act = String(action || "").toLowerCase().trim();
  const label = String(targetLabel || "").trim();
  const txt = `${label} ${act}`;
  if (modelRisk === "password" || PASSWORD_RE.test(txt)) {
    return {
      blocked: true,
      requiresConfirmation: false,
      reason: "RiskGuard: pole hasła / 2FA / klucza prywatnego jest twardo zablokowane — wpisz dane ręcznie.",
    };
  }
  if (act === "move" || act === "locate") {
    return { blocked: false, requiresConfirmation: false };
  }
  if (act === "hotkey") {
    const combo = label.toLowerCase().replace(/\s+/g, "");
    if (BLOCKED_HOTKEY_RE.test(combo)) {
      return {
        blocked: true,
        requiresConfirmation: false,
        reason: `RiskGuard: krytyczny skrót systemowy „${label}” jest zablokowany.`,
      };
    }
    if (RISKY_HOTKEY_RE.test(combo)) {
      return {
        blocked: false,
        requiresConfirmation: true,
        reason: `Potwierdź ryzykowny skrót klawiszowy (zamknięcie/usunięcie): „${label}”`,
      };
    }
  }
  if (act === "launch" || act === "launch_app") {
    if (DESTRUCTIVE_RE.test(label)) {
      return {
        blocked: true,
        requiresConfirmation: false,
        reason: `RiskGuard: destrukcyjne polecenie/aplikacja „${label}” jest zablokowane.`,
      };
    }
    if (RISKY_LAUNCH_RE.test(label)) {
      return {
        blocked: false,
        requiresConfirmation: true,
        reason: `Potwierdź uruchomienie narzędzia systemowego/powłoki: „${label}”`,
      };
    }
  }
  if (modelRisk === "payment" || PAYMENT_RE.test(txt)) {
    return { blocked: false, requiresConfirmation: true, reason: `Potwierdź akcję płatniczą: „${targetLabel}"` };
  }
  if (modelRisk === "destructive" || DESTRUCTIVE_RE.test(txt)) {
    return { blocked: false, requiresConfirmation: true, reason: `Potwierdź akcję nieodwracalną: „${targetLabel}"` };
  }
  if (modelRisk === "send" || SEND_RE.test(txt)) {
    return { blocked: false, requiresConfirmation: true, reason: `Potwierdź wysłanie/publikację: „${targetLabel}"` };
  }
  return { blocked: false, requiresConfirmation: false };
}

function extractFirstJson(raw: string): Record<string, unknown> | null {
  const cleaned = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Pure: sparsuj odpowiedź modelu wizyjnego (0..1000) na dokładne piksele ekranu. */
export function parseGroundedTarget(raw: string, screenWidth: number, screenHeight: number): GroundedTarget {
  const obj = extractFirstJson(raw);
  if (!obj || obj.found !== true) {
    return {
      found: false,
      xNorm: 0,
      yNorm: 0,
      x: 0,
      y: 0,
      label: "",
      confidence: 0,
      risk: "none",
      reason: String(obj?.reason || "Nie udało się odnaleźć wskazanego elementu na ekranie."),
    };
  }
  const xNorm = Math.max(0, Math.min(1000, Number(obj.x ?? obj.xNorm ?? 0)));
  const yNorm = Math.max(0, Math.min(1000, Number(obj.y ?? obj.yNorm ?? 0)));
  const sw = Math.max(320, Number(screenWidth) || 1920);
  const sh = Math.max(240, Number(screenHeight) || 1080);
  const x = Math.max(0, Math.min(sw - 1, Math.round((xNorm / 1000) * sw)));
  const y = Math.max(0, Math.min(sh - 1, Math.round((yNorm / 1000) * sh)));
  const confRaw = Number(obj.confidence);
  const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0.75;
  const riskRaw = String(obj.risk || "none");
  const risk: DesktopRiskKind = ["none", "password", "payment", "destructive", "send"].includes(riskRaw)
    ? (riskRaw as DesktopRiskKind)
    : "none";
  return {
    found: true,
    xNorm,
    yNorm,
    x,
    y,
    label: String(obj.label || ""),
    confidence,
    risk,
    reason: String(obj.reason || ""),
  };
}

/** Pure: sparsuj następny atomowy krok planu z modelu wizyjnego. */
export function parseOmniPlanStep(raw: string): OmniPlanStep {
  const obj = extractFirstJson(raw);
  const validActions = new Set([
    "visual_click", "visual_double", "visual_right", "move_cursor",
    "type", "hotkey", "scroll", "focus_window", "launch_app", "wait", "done", "need_human",
  ]);
  const act = String(obj?.action || "");
  if (!obj || !validActions.has(act)) {
    return { action: "need_human", summary: "Model nie zwrócił jednoznacznego kroku — potrzebne wskazanie użytkownika." };
  }
  const riskRaw = String(obj.risk || "none");
  const risk: DesktopRiskKind = ["none", "password", "payment", "destructive", "send"].includes(riskRaw)
    ? (riskRaw as DesktopRiskKind)
    : "none";
  return {
    action: act as OmniPlanStep["action"],
    target: obj.target ? String(obj.target) : undefined,
    xNorm: Number.isFinite(Number(obj.xNorm ?? obj.x)) ? Math.max(0, Math.min(1000, Number(obj.xNorm ?? obj.x))) : undefined,
    yNorm: Number.isFinite(Number(obj.yNorm ?? obj.y)) ? Math.max(0, Math.min(1000, Number(obj.yNorm ?? obj.y))) : undefined,
    text: obj.text !== undefined ? String(obj.text) : undefined,
    combo: obj.combo ? String(obj.combo) : undefined,
    direction: ["up", "down", "left", "right"].includes(String(obj.direction)) ? (String(obj.direction) as OmniPlanStep["direction"]) : undefined,
    amount: Number.isFinite(Number(obj.amount)) ? Math.max(1, Math.min(20, Number(obj.amount))) : undefined,
    app: obj.app ? String(obj.app) : undefined,
    window: obj.window ? String(obj.window) : undefined,
    risk,
    summary: String(obj.summary || act),
  };
}

/**
 * Namierz element wizyjnie na zrzucie ekranu przez AutoCore AI Gateway (automatyczny routing do modelu z wizją).
 */
export async function locateVisualTarget(
  target: string,
  shot: DetailedScreenshot,
  opts: { askVision?: (system: string, prompt: string, img: { data: string; mediaType: string }) => Promise<string> } = {},
): Promise<GroundedTarget> {
  const prompt = `Znajdź na ekranie (${shot.screenWidth}x${shot.screenHeight}, aktualny kursor: ${shot.cursorX},${shot.cursorY}) dokładny środek elementu: "${target}".`;
  const raw = opts.askVision
    ? await opts.askVision(VISUAL_GROUNDING_SYSTEM, prompt, { data: shot.data, mediaType: shot.mediaType })
    : (
        await aiRequest({
          task: "E_vision",
          system: VISUAL_GROUNDING_SYSTEM,
          history: [{ role: "user", content: prompt, image: { data: shot.data, mediaType: shot.mediaType } }],
        })
      ).text;
  return parseGroundedTarget(raw, shot.screenWidth, shot.screenHeight);
}

/** Zaplanuj jeden atomowy krok w wielokrokowej pętli Computer Use. */
export async function planNextOmniStep(
  goal: string,
  shot: DetailedScreenshot,
  context: { windows: string[]; history: string[]; step: number; maxSteps: number },
  opts: { askVision?: (system: string, prompt: string, img: { data: string; mediaType: string }) => Promise<string> } = {},
): Promise<OmniPlanStep> {
  const prompt = [
    `Cel użytkownika: ${goal}`,
    `Krok ${context.step} z ${context.maxSteps}. Ekran: ${shot.screenWidth}x${shot.screenHeight}, kursor: (${shot.cursorX}, ${shot.cursorY}).`,
    context.windows.length ? `Otwarte okna: ${context.windows.slice(0, 12).join(" | ")}` : "",
    context.history.length ? `Dotychczasowe kroki:\n${context.history.map((h, i) => `${i + 1}. ${h}`).join("\n")}` : "Brak wcześniejszych kroków.",
    "Zwróć następny pojedynczy krok w formacie JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = opts.askVision
    ? await opts.askVision(OMNI_PLANNER_SYSTEM, prompt, { data: shot.data, mediaType: shot.mediaType })
    : (
        await aiRequest({
          task: "E_vision",
          system: OMNI_PLANNER_SYSTEM,
          history: [{ role: "user", content: prompt, image: { data: shot.data, mediaType: shot.mediaType } }],
        })
      ).text;
  return parseOmniPlanStep(raw);
}
