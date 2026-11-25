// === JARVIS SYMBIONT · Faza 1: Percepcja Deiktyczna „Pod Kursorem” (Foveated Perception) ===
// Obsługuje naturalne polecenia wskazujące kursorem:
// - „co to jest?”, „wyjaśnij to”, „napraw to”, „kliknij tutaj”, „odpisz na to”
// Zasady architektoniczne (ADR-0007):
// 1. Najpierw pozycja kursora + geometryczny odczyt OS-Tree (AT-SPI2 / Windows UIA, 0 USD).
// 2. W razie potrzeby wyłącznie lokalny wycinek 384×384 px wokół kursora (NIGDY cały ekran!).
// 3. Twarda blokada poufnych okien/pól (hasła, 2FA, Polkit, Pinentry, menedżery haseł) PRZED wycinkiem i AI.
// 4. Local-first (preferencja lokalnej Ollamy; respektowanie onDeviceOnly i budżetu AutoCore).
// 5. Wizualizacja zamiaru w Ghost AR PRZED działaniem + pełny RiskGuard + weryfikacja rezultatu kliknięcia.
// 6. S9-safe (ES2019, bez lookbehind i \p{...}).

import { aiRequest } from "./autocore/gateway";
import { providerSupportsVision } from "./autocore/catalog";
import { discoveredModelsFor } from "./autocore/discovery";
import {
  captureFoveatedCropOnPc,
  desktop,
  findUiNodeAtPointOnPc,
  hideGhostOverlayOnPc,
  isDesktop,
  mouseActionOnPc,
  showGhostTargetOnPc,
  type FoveatedCropResult,
  type GhostShowResult,
  type GhostSourceKind,
  type GhostTargetPayload,
  type UiFindResult,
} from "./desktop";
import { foldPolish } from "./omniReflex";
import { assessDesktopActionRisk, type DesktopRiskKind } from "./omniVision";
import { askConsentUI, recordSystemActionEvent } from "./permissions";
import { confirmed as outcomeConfirmed, draft as outcomeDraft, failed as outcomeFailed } from "./actionOutcome";
import { verifyResult } from "./resultVerifier";
import { shortenForVoice } from "./voiceCognition";
import { store } from "./store";

export type DeicticIntent =
  | { kind: "inspect" }
  | { kind: "explain" }
  | { kind: "fix" }
  | { kind: "reply"; instruction?: string }
  | { kind: "click_here"; mouseAction: "click" | "double" | "right" };

export interface FoveatedActuator {
  isDesktop: () => boolean;
  cursorPos: () => Promise<{ ok: boolean; x?: number; y?: number; error?: string }>;
  nodeAtPoint: (x: number, y: number) => Promise<UiFindResult>;
  foveatedCrop: (opts?: { x?: number; y?: number; cropSize?: number }) => Promise<FoveatedCropResult>;
  mouseAction: typeof mouseActionOnPc;
  ghostShow: (payload: GhostTargetPayload) => Promise<GhostShowResult>;
  ghostHide: (reason?: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
}

export interface FoveatedExecOptions {
  actuator?: Partial<FoveatedActuator>;
  askModel?: (opts: {
    system: string;
    prompt: string;
    image?: { data: string; mediaType: string };
  }) => Promise<string>;
  onConfirm?: (req: { reason: string; target: string; action: string }) => Promise<boolean>;
  aborted?: () => boolean;
}

export interface FoveatedCommandResult {
  handled: boolean;
  ok?: boolean;
  blocked?: boolean;
  denied?: boolean;
  aborted?: boolean;
  kind?: DeicticIntent["kind"];
  source?: GhostSourceKind;
  confidence?: number;
  verified?: boolean;
  text?: string;
  spokenText?: string;
}

const CONFIDENTIAL_RE =
  /(?:\bpolkit\b|pkexec|gcr-prompter|pinentry|ssh-askpass|1password|bitwarden|keepass|keepassxc|gnome-keyring|kwallet|seahorse|\buac\b|user account control|windows security|credential|\bsudo\b|has[łl][oa]|password|passwd|\b2fa\b|\botp\b|totp|authenticator|kod jednorazowy|\bcvv\b|\bcvc\b|\bpin\b|seed phrase|klucz prywatny|private key|secret key|autoryzacj|uwierzytelnian)/i;

/** Pure: sprawdź, czy kontekst pod kursorem jest poufny (hasła, 2FA, Polkit, sejfy). */
export function isConfidentialContext(info: {
  windowTitle?: string;
  label?: string;
  role?: string;
  isPassword?: boolean;
}): boolean {
  if (info.isPassword === true) return true;
  if (String(info.role || "").toLowerCase().indexOf("password") >= 0) return true;
  const combined = `${info.windowTitle || ""} ${info.label || ""}`.trim();
  return CONFIDENTIAL_RE.test(combined);
}

/**
 * Pure: rozpoznaj polecenie deiktyczne odnoszące się do elementu pod kursorem („to”, „tutaj”, „pod kursorem”).
 * Nie przechwytuje ogólnych pytań typu „wyjaśnij teorię względności”.
 */
export function parseDeicticCommand(rawText: string): DeicticIntent | null {
  const orig = String(rawText || "").trim();
  if (!orig) return null;
  const f = foldPolish(orig).replace(/^(?:hej |ok |ej )?jarvis\s+/, "").trim();
  if (!f) return null;

  // 1) Kliknięcie w miejscu kursora („kliknij tutaj”, „kliknij prawym tutaj”, „kliknij dwa razy tutaj”)
  if (/^(?:kliknij|nacisnij)\s+(?:prawym(?:\s+przyciskiem)?)\s+(?:tutaj|tu|w to|pod kursorem)$/.test(f)) {
    return { kind: "click_here", mouseAction: "right" };
  }
  if (/^(?:kliknij|nacisnij)\s+(?:dwa razy|dwukrotnie|podwojnie)\s+(?:tutaj|tu|w to|pod kursorem)$/.test(f)) {
    return { kind: "click_here", mouseAction: "double" };
  }
  if (/^(?:kliknij|nacisnij)\s+(?:tutaj|tu|w to|ten element|pod kursorem)$/.test(f)) {
    return { kind: "click_here", mouseAction: "click" };
  }

  // 2) Odpowiedź na wskazany element („odpisz na to”, „odpisz na to że jutro o 10”)
  const replyMatch = orig.match(
    /^(?:(?:hej|ok|ej)\s+)?(?:jarvis[,:\s]+)?(?:odpisz|odpowiedz)\s+na\s+to(?:\s*[:, -]\s*|\s+)(.+)$/i,
  );
  if (replyMatch && replyMatch[1].trim()) {
    return { kind: "reply", instruction: replyMatch[1].trim() };
  }
  if (/^(?:odpisz|odpowiedz)\s+na\s+to$/.test(f)) {
    return { kind: "reply" };
  }

  // 3) Naprawa wskazanego problemu („napraw to”, „napraw ten błąd”, „rozwiąż to pod kursorem”)
  if (
    /^(?:napraw to(?:\s+pod kursorem)?|napraw ten (?:blad|problem|komunikat)|rozwiaz to(?:\s+pod kursorem)?|jak to naprawic)$/.test(
      f,
    )
  ) {
    return { kind: "fix" };
  }

  // 4) Wyjaśnienie („wyjaśnij to”, „wytłumacz to”, „przetłumacz to pod kursorem”)
  if (
    /^(?:wyjasnij to(?:\s+pod kursorem)?|wytlumacz to(?:\s+pod kursorem)?|o co (?:tu|tutaj) chodzi|przetlumacz to(?:\s+pod kursorem)?)$/.test(
      f,
    )
  ) {
    return { kind: "explain" };
  }

  // 5) Inspekcja („co to jest?”, „co jest pod kursorem?”, „co tu widać?”)
  if (
    /^(?:co to jest(?:\s+pod kursorem)?|co to(?:\s+jest)?\s+tutaj|co jest pod kursorem|co (?:tu|tutaj) widac|sprawdz co jest pod kursorem)$/.test(
      f,
    )
  ) {
    return { kind: "inspect" };
  }

  return null;
}

const DEFAULT_ACTUATOR: FoveatedActuator = {
  isDesktop,
  cursorPos: async () => {
    const d = desktop();
    if (!d?.pilotCursorPos) return { ok: false, error: "err:not-desktop" };
    return d.pilotCursorPos().catch((e) => ({ ok: false, error: String(e) }));
  },
  nodeAtPoint: findUiNodeAtPointOnPc,
  foveatedCrop: captureFoveatedCropOnPc,
  mouseAction: mouseActionOnPc,
  ghostShow: showGhostTargetOnPc,
  ghostHide: hideGhostOverlayOnPc,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

function pickLocalOllamaVisionPref(): { provider: "ollama"; model: string } | undefined {
  const s = store.settings;
  if (!s.ollamaUrl?.trim()) return undefined;
  const configured = s.ollamaModelVision?.trim();
  if (configured && providerSupportsVision("ollama", configured)) {
    return { provider: "ollama", model: configured };
  }
  const disc = discoveredModelsFor("ollama").find((m) => providerSupportsVision("ollama", m.id));
  if (disc) return { provider: "ollama", model: disc.id };
  return undefined;
}

function pickLocalOllamaTextPref(): { provider: "ollama"; model: string } | undefined {
  const s = store.settings;
  if (!s.ollamaUrl?.trim()) return undefined;
  const model = s.ollamaModelComplex?.trim() || s.ollamaModelSimple?.trim();
  return model ? { provider: "ollama", model } : undefined;
}

async function runLocalFirstModel(
  opts: FoveatedExecOptions,
  req: { system: string; prompt: string; image?: { data: string; mediaType: string } },
): Promise<string> {
  if (opts.askModel) {
    return opts.askModel(req);
  }
  const s = store.settings;
  if (req.image) {
    const localVl = pickLocalOllamaVisionPref();
    if (s.onDeviceOnly && !localVl && !s.webllmEnabled) {
      throw new Error("Tryb on-device aktywny: skonfiguruj lokalny model wizyjny w Ollamie (np. qwen2.5-vl / llava), aby analizować wycinki ekranu lokalnie.");
    }
    const reply = await aiRequest({
      task: "E_vision",
      system: req.system,
      history: [{ role: "user", content: req.prompt, image: req.image }],
      ...(localVl ? { prefer: localVl } : {}),
    });
    return reply.text;
  }

  const localTxt = pickLocalOllamaTextPref();
  const reply = await aiRequest({
    task: "A_reasoning",
    system: req.system,
    history: [{ role: "user", content: req.prompt }],
    ...(localTxt ? { prefer: localTxt } : {}),
  });
  return reply.text;
}

function parseClickProbeJson(raw: string): { label: string; confidence: number; risk: DesktopRiskKind } {
  const cleaned = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return { label: "Element pod kursorem", confidence: 0.5, risk: "none" };
  try {
    const obj = JSON.parse(m[0]) as Record<string, unknown>;
    const confNum = Number(obj.confidence);
    const confidence = Number.isFinite(confNum) ? Math.max(0, Math.min(1, confNum)) : 0.55;
    const r = String(obj.risk || "none");
    const risk: DesktopRiskKind = ["none", "password", "payment", "destructive", "send"].indexOf(r) >= 0
      ? (r as DesktopRiskKind)
      : "none";
    return {
      label: String(obj.label || "Element pod kursorem").slice(0, 100),
      confidence,
      risk,
    };
  } catch {
    return { label: "Element pod kursorem", confidence: 0.5, risk: "none" };
  }
}

/**
 * Wykonaj polecenie deiktyczne („co to jest?”, „napraw to”, „wyjaśnij to”, „kliknij tutaj”, „odpisz na to”).
 */
export async function executeFoveatedCommand(
  rawText: string,
  opts: FoveatedExecOptions = {},
): Promise<FoveatedCommandResult> {
  const intent = parseDeicticCommand(rawText);
  if (!intent) return { handled: false };

  const act: FoveatedActuator = { ...DEFAULT_ACTUATOR, ...(opts.actuator || {}) };
  if (!act.isDesktop()) {
    return {
      handled: true,
      ok: false,
      kind: intent.kind,
      text: "Wskazywanie kursorem („to / tutaj”) działa w aplikacji desktopowej JARVIS (Linux / Windows).",
      spokenText: "Ta funkcja działa na komputerze.",
    };
  }

  const ghostAllowed = store.settings.ghostArEnabled !== false;
  const pos = await act.cursorPos();
  if (!pos.ok || typeof pos.x !== "number" || typeof pos.y !== "number") {
    return {
      handled: true,
      ok: false,
      kind: intent.kind,
      text: `Nie udało się odczytać pozycji kursora (${pos.error || "brak danych"}).`,
      spokenText: "Nie mogę odczytać pozycji kursora.",
    };
  }

  const cx = pos.x;
  const cy = pos.y;

  // 1) Najpierw semantyczne Drzewo OS pod punktem kursora (0 USD, lokalnie)
  const treeHit = await act.nodeAtPoint(cx, cy).catch(() => ({ ok: false, found: false } as UiFindResult));
  if (opts.aborted?.()) {
    await act.ghostHide("aborted");
    return { handled: true, ok: false, aborted: true, kind: intent.kind, text: "⏹ Przerwano.", spokenText: "Przerwano." };
  }

  const node = treeHit.found ? treeHit.node : undefined;
  const winTitle = treeHit.windowTitle || "";

  // 2) Twarda blokada poufnych powierzchni PRZED wycinkiem obrazu i AI
  if (
    isConfidentialContext({
      windowTitle: winTitle,
      label: node?.name,
      role: node?.role,
      isPassword: node?.isPassword,
    })
  ) {
    await act.ghostHide("confidential-blocked");
    const msg = "🛡️ RiskGuard: kursor znajduje się nad polem hasła, 2FA lub oknem uwierzytelniania — zablokowano odczyt i działanie.";
    recordSystemActionEvent({
      tool: "foveated_perception",
      risk: intent.kind === "click_here" ? "outbound" : "read",
      input: { kind: intent.kind, blockedReason: "confidential-surface" },
      output: msg,
      ok: false,
      security: true,
    });
    return {
      handled: true,
      ok: false,
      blocked: true,
      kind: intent.kind,
      text: msg,
      spokenText: "Zablokowano — kursor jest nad polem poufnym lub hasłem.",
    };
  }

  const treeSource: GhostSourceKind | null =
    treeHit.found && node
      ? treeHit.backend === "win-uia"
        ? "win-uia"
        : "at-spi2"
      : null;

  // === ŚCIEŻKA A: „KLIKNIJ TUTAJ” ===
  if (intent.kind === "click_here") {
    let label = node?.name || "";
    let confidence = node ? 0.96 : 0;
    let source: GhostSourceKind = treeSource || "cursor";
    let modelRisk: DesktopRiskKind = "none";

    // Jeśli Drzewo OS nie rozpoznało elementu pod kursorem, pobierz lokalny wycinek 384x384 i sprawdź kontekst
    if (!node) {
      const crop = await act.foveatedCrop({ x: cx, y: cy, cropSize: 384 });
      if (crop.blocked) {
        await act.ghostHide("confidential-blocked");
        const msg = `🛡️ ${crop.reason || "RiskGuard zablokował dostęp do poufnego obszaru pod kursorem."}`;
        recordSystemActionEvent({
          tool: "foveated_click",
          risk: "outbound",
          input: { x: cx, y: cy },
          output: msg,
          ok: false,
          security: true,
        });
        return { handled: true, ok: false, blocked: true, kind: intent.kind, text: msg, spokenText: "Zablokowano poufny obszar." };
      }

      if (crop.ok && crop.data) {
        try {
          const rawProbe = await runLocalFirstModel(opts, {
            system:
              'Rozpoznaj element interfejsu dokładnie w punkcie kursora wewnątrz wycinka. Zwróć WYŁĄCZNIE JSON: {"label":"nazwa elementu","confidence":0.85,"risk":"none|password|payment|destructive|send"}',
            prompt: `Wycinek ${crop.width}x${crop.height} px (okno: "${crop.windowTitle || winTitle || "?"}"). Kursor wskazuje punkt (${crop.cursorRelX}, ${crop.cursorRelY}). Co znajduje się dokładnie pod kursorem?`,
            image: { data: crop.data, mediaType: crop.mediaType || "image/png" },
          });
          const parsed = parseClickProbeJson(rawProbe);
          label = parsed.label;
          confidence = parsed.confidence;
          modelRisk = parsed.risk;
          source = "vision";
        } catch {
          label = "Nierozpoznany element pod kursorem";
          confidence = 0.45;
          source = "cursor";
        }
      } else {
        label = "Punkt pod kursorem (brak Drzewa OS i wycinka)";
        confidence = 0.4;
        source = "cursor";
      }
    }

    if (opts.aborted?.()) {
      await act.ghostHide("aborted");
      return { handled: true, ok: false, aborted: true, kind: intent.kind, text: "⏹ Przerwano.", spokenText: "Przerwano." };
    }

    const actionPl =
      intent.mouseAction === "double"
        ? "Podwójne kliknięcie"
        : intent.mouseAction === "right"
          ? "Prawy klik"
          : "Kliknięcie";
    const risk = assessDesktopActionRisk(`${winTitle} ${label}`, intent.mouseAction, modelRisk);
    const lowConfidence = confidence < 0.65;
    const needsConsent = risk.requiresConfirmation || lowConfidence || store.settings.requireConsentAlways === true;

    if (risk.blocked || isConfidentialContext({ windowTitle: winTitle, label })) {
      if (ghostAllowed) await act.ghostHide("riskguard-blocked");
      const reason = risk.reason || `RiskGuard zablokował kliknięcie w „${label}”.`;
      recordSystemActionEvent({
        tool: "foveated_click",
        risk: "outbound",
        input: { x: cx, y: cy, label, source },
        output: reason,
        ok: false,
        security: true,
      });
      return {
        handled: true,
        ok: false,
        blocked: true,
        kind: intent.kind,
        source,
        confidence,
        text: `🛡️ ${reason}`,
        spokenText: "Zablokowano kliknięcie ze względów bezpieczeństwa.",
      };
    }

    // Pokaż celownik i zamiar działania w Ghost AR PRZED wykonaniem kliknięcia!
    if (ghostAllowed) {
      await act.ghostShow({
        x: cx,
        y: cy,
        ...(node ? { width: node.width, height: node.height, boxX: node.x, boxY: node.y, role: node.role } : {}),
        windowTitle: winTitle,
        label: label || "Punkt kursora",
        source,
        confidence,
        plannedAction: actionPl,
        approvalStatus: needsConsent ? "pending_consent" : "confirmed",
        approvalLabel: lowConfidence
          ? `⚠ Niska pewność (${Math.round(confidence * 100)}%) — wymagane potwierdzenie`
          : needsConsent
            ? "🛡️ Wymaga Twojej zgody"
            : "✓ Bezpieczny cel — wykonuję",
        ttlMs: needsConsent ? 15000 : 3200,
      });
    }

    if (needsConsent) {
      const reason =
        risk.reason ||
        (lowConfidence
          ? `Niska pewność rozpoznania pod kursorem (${Math.round(confidence * 100)}%: „${label}”). Czy na pewno wykonać ${actionPl.toLowerCase()} w (${cx}, ${cy})?`
          : `Potwierdź ${actionPl.toLowerCase()} na „${label}” (${cx}, ${cy})`);
      const approved = opts.onConfirm
        ? await opts.onConfirm({ reason, target: label, action: intent.mouseAction })
        : Boolean(
            (
              await askConsentUI({
                tool: "desktop_mouse_action",
                input: { x: cx, y: cy, label, reason },
                risk: "outbound",
              })
            )?.allow,
          );

      if (!approved) {
        await act.ghostHide("consent-denied");
        const denyMsg = `🛡️ Anulowano kliknięcie w „${label}” (${cx}, ${cy}) — brak zgody użytkownika.`;
        recordSystemActionEvent({
          tool: "foveated_click",
          risk: "outbound",
          input: { x: cx, y: cy, label, source, confidence },
          output: denyMsg,
          ok: false,
          security: true,
        });
        return {
          handled: true,
          ok: false,
          denied: true,
          kind: intent.kind,
          source,
          confidence,
          text: denyMsg,
          spokenText: "Anulowano kliknięcie.",
        };
      }
    }

    if (ghostAllowed) {
      await act.ghostShow({
        x: cx,
        y: cy,
        ...(node ? { width: node.width, height: node.height, boxX: node.x, boxY: node.y } : {}),
        windowTitle: winTitle,
        label,
        source,
        confidence,
        plannedAction: actionPl,
        approvalStatus: "confirmed",
        approvalLabel: "⚡ Wykonuję kliknięcie…",
        ttlMs: 1800,
      });
    }

    const clickRes = await act.mouseAction({ action: intent.mouseAction, x: cx, y: cy, smooth: false });
    await act.sleep(160);

    // Weryfikacja rzeczywistego rezultatu po kliknięciu
    const afterTree = await act.nodeAtPoint(cx, cy).catch(() => ({ ok: false, found: false } as UiFindResult));
    const uiChanged =
      Boolean(afterTree.windowTitle && winTitle && afterTree.windowTitle !== winTitle) ||
      Boolean(afterTree.node?.name && node?.name && afterTree.node.name !== node.name) ||
      Boolean(node && afterTree.ok && !afterTree.found);

    const stepOutcome = clickRes.ok
      ? outcomeConfirmed({
          source: `foveated:${source}`,
          message: uiChanged ? `${clickRes.message} (potwierdzono zmianę stanu UI)` : clickRes.message,
        })
      : outcomeFailed(clickRes.message, "foveated_click");
    const verdict = verifyResult({
      goal: `${actionPl}: ${label}`,
      steps: [{ id: "click_here", successCriteria: `${actionPl} ${label}`, outcome: stepOutcome, claimedSuccess: clickRes.ok }],
    });

    recordSystemActionEvent({
      tool: "foveated_click",
      risk: "outbound",
      input: { x: cx, y: cy, action: intent.mouseAction, label, source, confidence },
      output: `${clickRes.message} [verified=${verdict.complete}, uiChanged=${uiChanged}]`,
      ok: clickRes.ok,
    });

    const srcBadge = source === "at-spi2" ? "AT-SPI2 · lokalnie" : source === "win-uia" ? "Windows UIA · lokalnie" : source === "vision" ? "Vision (wycinek)" : "Kursor";
    const text = clickRes.ok
      ? `🎯 **${actionPl}** w „${label}” \`(${cx}, ${cy})\` · źródło: **${srcBadge}** · pewność: **${Math.round(confidence * 100)}%**${uiChanged ? " · wykryto reakcję interfejsu" : ""}.`
      : `⚠ ${clickRes.message}`;

    return {
      handled: true,
      ok: clickRes.ok,
      kind: intent.kind,
      source,
      confidence,
      verified: verdict.complete,
      text,
      spokenText: clickRes.ok ? `${actionPl}: ${label}.` : clickRes.message,
    };
  }

  // === ŚCIEŻKA B: ANALIZA DEIKTYCZNA („co to jest?”, „wyjaśnij to”, „napraw to”, „odpisz na to”) ===
  const crop = await act.foveatedCrop({ x: cx, y: cy, cropSize: 384 });
  if (crop.blocked) {
    await act.ghostHide("confidential-blocked");
    const msg = `🛡️ ${crop.reason || "RiskGuard zablokował odczyt poufnego elementu pod kursorem."}`;
    recordSystemActionEvent({
      tool: "foveated_perception",
      risk: "read",
      input: { kind: intent.kind, x: cx, y: cy },
      output: msg,
      ok: false,
      security: true,
    });
    return {
      handled: true,
      ok: false,
      blocked: true,
      kind: intent.kind,
      text: msg,
      spokenText: "Zablokowano odczyt poufnego pola.",
    };
  }

  const effectiveSource: GhostSourceKind = treeSource || (crop.ok && crop.data ? "vision" : "cursor");
  const effectiveConfidence = node ? 0.95 : crop.ok && crop.data ? 0.84 : 0.5;
  const targetLabel = node?.name || (winTitle ? `Obszar w „${winTitle}”` : `Punkt (${cx}, ${cy})`);
  const actionTitleMap: Record<Exclude<DeicticIntent["kind"], "click_here">, string> = {
    inspect: "Identyfikacja pod kursorem",
    explain: "Wyjaśnienie elementu",
    fix: "Diagnoza i plan naprawy",
    reply: "Szkic odpowiedzi (DRAFT)",
  };

  // Pokaż w Ghost AR co dokładnie analizuje JARVIS!
  if (ghostAllowed) {
    await act.ghostShow({
      x: cx,
      y: cy,
      ...(node ? { width: node.width, height: node.height, boxX: node.x, boxY: node.y, role: node.role } : {}),
      windowTitle: crop.windowTitle || winTitle,
      label: targetLabel,
      source: effectiveSource,
      confidence: effectiveConfidence,
      plannedAction: actionTitleMap[intent.kind],
      approvalStatus: "preview",
      approvalLabel: intent.kind === "reply" ? "✍ Przygotowuję szkic (bez wysyłania)" : "👁 Analizuję lokalny wycinek…",
      ttlMs: 5000,
    });
  }

  if (!node && (!crop.ok || !crop.data)) {
    const noCtxMsg = `Pod kursorem \`(${cx}, ${cy})\` brak dostępnego węzła Drzewa OS oraz lokalnego wycinka obrazu (${crop.error || "brak źródła"}).`;
    return {
      handled: true,
      ok: false,
      kind: intent.kind,
      source: effectiveSource,
      confidence: effectiveConfidence,
      text: noCtxMsg,
      spokenText: "Nie mogę odczytać zawartości pod kursorem.",
    };
  }

  const osContextLines = [
    `Pozycja kursora: (${cx}, ${cy}).`,
    crop.windowTitle || winTitle ? `Aktywne okno: "${crop.windowTitle || winTitle}".` : "",
    node ? `Węzeł OS-Tree (${treeSource}): rola="${node.role}", etykieta="${node.name}", wymiary=${node.width}x${node.height}.` : "Brak węzła w Drzewie OS — oprzyj się na załączonym wycinku wokół kursora.",
    crop.ok && crop.data ? `Załączono wyłącznie lokalny wycinek ${crop.width}x${crop.height} px wokół kursora (punkt kursora wewnątrz wycinka: ${crop.cursorRelX},${crop.cursorRelY}).` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const taskInstruction =
    intent.kind === "inspect"
      ? "Powiedz krótko i konkretnie po polsku (2–3 zdania), czym jest wskazany element/komunikat i do czego służy."
      : intent.kind === "explain"
        ? "Wyjaśnij jasno po polsku znaczenie wskazanego elementu, komunikatu lub fragmentu tekstu/kodu."
        : intent.kind === "fix"
          ? "Zdiagnozuj wskazany błąd/problem widoczny pod kursorem i podaj konkretny, bezpieczny sposób naprawy krok po kroku."
          : `Przygotuj gotowy SZKIC odpowiedzi (DRAFT — nic nie wysyłaj automatycznie) na widoczną pod kursorem wiadomość/komentarz${intent.instruction ? ` zgodnie z wytyczną: "${intent.instruction}"` : ""}.`;

  let answer = "";
  try {
    answer = await runLocalFirstModel(opts, {
      system:
        "Jesteś modułem Foveated Perception systemu JARVIS SYMBIONT. Odpowiadasz zwięźle, konkretnie i po polsku wyłącznie na temat elementu pod kursorem użytkownika. Nie zgaduj faktów niewidocznych w kontekście.",
      prompt: `${osContextLines}\n\nZadanie: ${taskInstruction}`,
      ...(crop.ok && crop.data ? { image: { data: crop.data, mediaType: crop.mediaType || "image/png" } } : {}),
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    recordSystemActionEvent({
      tool: "foveated_perception",
      risk: "read",
      input: { kind: intent.kind, x: cx, y: cy, source: effectiveSource },
      output: errMsg,
      ok: false,
    });
    return {
      handled: true,
      ok: false,
      kind: intent.kind,
      source: effectiveSource,
      confidence: effectiveConfidence,
      text: `⚠ Nie udało się przeanalizować wycinka pod kursorem: ${errMsg}`,
      spokenText: shortenForVoice(errMsg),
    };
  }

  const cleanAnswer = answer.trim();
  const outcomeObj =
    intent.kind === "reply"
      ? outcomeDraft("Przygotowano szkic odpowiedzi — wymaga Twojej akceptacji przed wysłaniem.")
      : outcomeConfirmed({ source: `foveated:${effectiveSource}`, message: "Przeanalizowano kontekst pod kursorem." });

  if (ghostAllowed) {
    await act.ghostShow({
      x: cx,
      y: cy,
      ...(node ? { width: node.width, height: node.height, boxX: node.x, boxY: node.y, role: node.role } : {}),
      windowTitle: crop.windowTitle || winTitle,
      label: targetLabel,
      source: effectiveSource,
      confidence: effectiveConfidence,
      plannedAction: actionTitleMap[intent.kind],
      approvalStatus: intent.kind === "reply" ? "pending_consent" : "confirmed",
      approvalLabel:
        intent.kind === "reply"
          ? "✍ Szkic DRAFT gotowy w czacie (nic nie wysłano)"
          : `✓ Rozpoznano (${effectiveSource === "at-spi2" ? "AT-SPI2" : effectiveSource === "win-uia" ? "UIA" : "Wycinek 384px"})`,
      ttlMs: 4200,
    });
  }

  recordSystemActionEvent({
    tool: "foveated_perception",
    risk: "read",
    input: { kind: intent.kind, x: cx, y: cy, source: effectiveSource, cropOnly: Boolean(crop.ok && crop.data) },
    output: `${actionTitleMap[intent.kind]}: ${cleanAnswer.slice(0, 180)}`,
    ok: outcomeObj.state === "CONFIRMED" || outcomeObj.state === "DRAFT",
  });

  const header =
    intent.kind === "reply"
      ? `✍ **Szkic odpowiedzi (DRAFT — wymaga Twojej akceptacji przed wysłaniem):**\n\n${cleanAnswer}`
      : cleanAnswer;

  return {
    handled: true,
    ok: true,
    kind: intent.kind,
    source: effectiveSource,
    confidence: effectiveConfidence,
    text: header,
    spokenText: shortenForVoice(cleanAnswer),
  };
}
