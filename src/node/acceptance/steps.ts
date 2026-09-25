// Acceptance steps (mission M6), progressive: capabilities, a real browser, the golden steps 1-7,
// selection and clipboard, voice latency, the full scenario 1-8. Mail is safe by default: a mock
// on the fixture, a draft (consent answered "no") on a real site, a real send only with --send.

import { Kernel } from "../../lib/runtime/kernel";
import { JarvisRuntime, type RuntimeTurn } from "../../lib/runtime/lanes/runtime";
import type { MailService, OutgoingMail, SendOutcome, SentRecord } from "../../lib/runtime/mail";
import type { Contact } from "../../lib/runtime/contacts";
import type { ComputerEnvironment } from "../../lib/runtime/env/types";
import type { CapabilityState } from "../../lib/runtime/types";
import { VoiceSession } from "../../lib/runtime/voice/session";
import type { StreamingSTT, StreamingTTS, SttEvent } from "../../lib/runtime/voice/types";
import type { AcceptanceArgs, Capability, StepResult, StepSpec } from "./core";

export const GOLDEN_1_7 = [
  "Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube.", "Otwórz pierwszy film.", "Zjedź trochę niżej.",
  "Znajdź komentarze.", "Pierwszy komentarz.", "Zaznacz pierwsze cztery litery.", "Skopiuj.",
];
export const SEND_LINE = "Wyślij to mailem Marcinowi.";

export type AcceptanceBrowser = ComputerEnvironment & { screenshot(path: string): Promise<boolean>; close(): Promise<void> };

export interface AcceptanceDeps {
  args: AcceptanceArgs;
  capabilities: Capability[];
  /** The fixture server, or the real site in managed-browser mode. */
  startSite: () => Promise<{ url: string; close: () => Promise<void> }>;
  makeBrowser: () => AcceptanceBrowser;
  /** Mail for the full scenario: mock on the fixture, real Gmail only with --send. */
  mail: () => MailService;
  /** A path under reports/ for a failure screenshot. */
  shotPath: (stepId: string) => string;
  /** The OS clipboard (local-desktop), when a tool for it exists. */
  readSystemClipboard?: () => Promise<string | null>;
  /** The desktop adapter (local-desktop on Linux). */
  desktop?: () => ComputerEnvironment;
}

/** Mail service for draft mode: any send attempt is a bug, so it throws. */
export class DraftOnlyMail implements MailService {
  readonly id = "draft-only";
  sends = 0;
  async capabilities(): Promise<CapabilityState[]> {
    return [{ id: "mail.send", status: "available", checkedAt: Date.now(), provider: this.id }, { id: "mail.sent_readback", status: "available", checkedAt: Date.now(), provider: this.id }];
  }
  async send(_m: OutgoingMail): Promise<SendOutcome> { this.sends++; throw new Error("draft mode: sending is disabled (use --send)"); }
  async findSent(_q: OutgoingMail & { since: number }): Promise<SentRecord | null> { return null; }
}

interface ScenarioRun {
  turns: RuntimeTurn[];
  kernel: Kernel;
  perCommandMs: number[];
  consentSummary?: string;
}

async function waitFor(cond: () => boolean, ms: number): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for the runtime");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function scenario(env: ComputerEnvironment, youtubeUrl: string, lines: string[], mail?: MailService, contacts?: Contact[], consent?: "tak" | "nie"): Promise<ScenarioRun> {
  const kernel = new Kernel();
  const rt = new JarvisRuntime({
    kernel, env,
    session: { youtubeUrl, mail, contacts: async () => contacts ?? [], mailOptions: { timeoutMs: 15_000, recheckDelayMs: 2_000 } },
  });
  const perCommandMs: number[] = [];
  try {
    await rt.start();
    for (const l of lines) {
      const t0 = Date.now();
      rt.onText(l);
      await rt.idle();
      perCommandMs.push(Date.now() - t0);
    }
    let consentSummary: string | undefined;
    if (consent) {
      rt.onText(SEND_LINE);
      await waitFor(() => Object.keys(kernel.state.consents).length > 0 || rt.turns.some((t) => t.text === SEND_LINE && t.result), 60_000);
      consentSummary = Object.values(kernel.state.consents)[0]?.summary;
      if (consentSummary) rt.onText(consent);
      await rt.idle();
    }
    return { turns: rt.turns, kernel, perCommandMs, consentSummary };
  } finally {
    rt.stop();
  }
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : 0; };
const truths = (turns: RuntimeTurn[]) => turns.filter((t) => t.route === "action").map((t) => t.result?.truth ?? "none");

export function acceptanceSteps(d: AcceptanceDeps): StepSpec[] {
  let site: { url: string; close: () => Promise<void> } | null = null;
  let lastRun: ScenarioRun | null = null;
  const cap = (id: string) => d.capabilities.find((c) => c.id === id);

  const withBrowser = async <T>(stepId: string, fn: (b: AcceptanceBrowser) => Promise<T>): Promise<{ value?: T; shot?: string; error?: string }> => {
    const b = d.makeBrowser();
    try {
      return { value: await fn(b) };
    } catch (e) {
      const path = d.shotPath(stepId);
      const shot = (await b.screenshot(path).catch(() => false)) ? path : undefined;
      return { error: e instanceof Error ? e.message.split("\n")[0] : String(e), shot };
    } finally {
      await b.close().catch(() => undefined);
    }
  };

  return [
    {
      id: "capabilities", title: "1. Capabilities detected",
      run: async () => {
        const missing = d.capabilities.filter((c) => c.status !== "available").map((c) => `${c.id}=${c.status}`);
        if (cap("browser.chromium")?.status !== "available") return { status: "FAIL", error: "no Chromium: install Chrome/Chromium or run npx playwright install chromium" };
        if (d.args.mode === "managed-browser" && cap("network.youtube")?.status === "blocked") return { status: "BLOCKED", error: "YouTube is not reachable from this machine" };
        return { status: "PASS", evidence: missing.length ? `not available: ${missing.join(", ")}` : "all probed capabilities available" };
      },
    },
    {
      id: "browser", title: "2. Real browser starts and reaches the site", needs: ["capabilities"],
      run: async () => {
        site = await d.startSite();
        const r = await withBrowser("browser", async (b) => {
          const launch = await b.act({ kind: "browser.launch" });
          if (launch.status !== "done") throw new Error(`launch: ${launch.error ?? launch.status}`);
          const nav = await b.act({ kind: "browser.navigate", url: site!.url });
          if (nav.status !== "done") throw new Error(`navigate: ${nav.error ?? nav.status}`);
          const page = await b.read({ kind: "page" }) as { url?: string; title?: string };
          return `${page.url} (${page.title ?? "no title"})`;
        });
        return r.error ? { status: "FAIL", error: r.error, screenshot: r.shot } : { status: "PASS", evidence: r.value };
      },
    },
    {
      id: "golden-1-7", title: `3. Golden steps 1-7 (${d.args.runs} run${d.args.runs > 1 ? "s" : ""})`, needs: ["browser"],
      run: async () => {
        const times: number[] = [];
        const perCommand: number[] = [];
        for (let i = 0; i < d.args.runs; i++) {
          const t0 = Date.now();
          const r = await withBrowser("golden-1-7", (b) => scenario(b, site!.url, GOLDEN_1_7));
          if (r.error) return { status: "FAIL", error: `run ${i + 1}: ${r.error}`, screenshot: r.shot };
          const t = truths(r.value!.turns);
          const bad = r.value!.turns.filter((x) => x.route === "action" && x.result?.truth !== "CONFIRMED");
          if (bad.length || t.length !== GOLDEN_1_7.length) {
            return { status: "FAIL", error: `run ${i + 1}: ${bad.map((x) => `${x.text} -> ${x.result?.truth}: ${x.say}`).join("; ") || `${t.length} actions`}` };
          }
          lastRun = r.value!;
          perCommand.push(...r.value!.perCommandMs);
          times.push(Date.now() - t0);
        }
        return {
          status: "PASS", evidence: `every step CONFIRMED by read-back; run ms: ${times.join(", ")}`,
          latency: { command_to_confirmed: { count: perCommand.length, p50: pct(perCommand, 50), p95: pct(perCommand, 95) } },
        };
      },
    },
    {
      id: "selection-clipboard", title: "4. Selection and clipboard read back", needs: ["golden-1-7"],
      run: async () => {
        const k = lastRun!.kernel;
        const copy = Object.values(k.state.actions).find((a) => a.kind === "clipboard.copy" && a.status === "CONFIRMED");
        const select = Object.values(k.state.actions).find((a) => a.kind === "text.select" && a.status === "CONFIRMED");
        if (!copy || !select) return { status: "FAIL", error: "selection or copy not confirmed" };
        const evidence = `${select.evidence}; ${copy.evidence}`;
        if (d.args.mode !== "local-desktop") return { status: "PASS", evidence };
        // In local-desktop the copy read-back already came from the OS clipboard, while the
        // browser that owns the X11 selection was still open (without a clipboard manager the
        // content disappears when it closes, so a later read would prove nothing).
        if (!d.readSystemClipboard) return { status: "NEEDS_HARDWARE", evidence: `${evidence}; system clipboard tool missing (wl-clipboard or xclip), browser clipboard used` };
        return { status: "PASS", evidence: `${evidence} (read from the system clipboard during the run)` };
      },
    },
    {
      id: "voice", title: "5. Voice session latency (scripted recognizer)", needs: ["browser"],
      run: async () => {
        const r = await withBrowser("voice", (b) => voiceRun(b, site!.url));
        if (r.error) return { status: "FAIL", error: r.error, screenshot: r.shot };
        // A scripted recognizer: runtime and browser latency are real, microphone and audio are not.
        const mic = cap("audio.microphone")?.status === "available" ? "microphone tool present; live audio is tested in the app" : "no microphone here";
        return { status: "SIMULATED", evidence: `${r.value!.confirmed} actions confirmed by voice; ${mic}`, latency: r.value!.latency };
      },
    },
    {
      id: "full-1-8", title: "6. Full scenario 1-8 with mail", needs: ["golden-1-7"],
      run: async () => {
        const fixture = d.args.mode === "fixture";
        if (!fixture && d.args.send && (!d.args.to || cap("mail.gmail")?.status !== "available")) {
          return { status: "BLOCKED", error: "--send needs --to (or JARVIS_ACCEPTANCE_TO) and a configured Gmail backend" };
        }
        const real = !fixture && d.args.send;
        const mail = fixture || real ? d.mail() : new DraftOnlyMail();
        const to = fixture ? "marcin.kubicki@example.com" : d.args.to ?? "draft@example.invalid";
        const contacts: Contact[] = [{ id: "m1", name: "Marcin Kubicki", emails: [to], source: fixture ? "fixture" : "acceptance" }];
        const answer = fixture || real ? "tak" : "nie";
        const r = await withBrowser("full-1-8", (b) => scenario(b, site!.url, GOLDEN_1_7, mail, contacts, answer));
        if (r.error) return { status: "FAIL", error: r.error, screenshot: r.shot };
        const run = r.value!;
        if (!run.consentSummary) return { status: "FAIL", error: "no consent was asked before sending" };
        const sendAction = Object.values(run.kernel.state.actions).find((a) => a.kind === "mail.send");
        if (answer === "nie") {
          const sends = (mail as DraftOnlyMail).sends ?? 0;
          return sends === 0 && !sendAction
            ? { status: "SIMULATED", evidence: `draft mode: consent "${run.consentSummary}" answered no; nothing sent (use --send for a real mail)` }
            : { status: "FAIL", error: "draft mode tried to send" };
        }
        return sendAction?.status === "CONFIRMED"
          ? { status: "PASS", evidence: `${run.consentSummary} -> ${sendAction.evidence}` }
          : { status: "FAIL", error: `mail ${sendAction?.status ?? "not attempted"}: ${sendAction?.reason ?? ""}` };
      },
    },
    {
      id: "desktop", title: "7. Desktop adapters (clipboard round trip, active window)", needs: ["capabilities"],
      run: async () => {
        if (d.args.mode !== "local-desktop") return { status: "SKIP", evidence: "local-desktop mode only" };
        if (!d.desktop) return { status: "NEEDS_HARDWARE", evidence: "no desktop adapter for this platform (Linux only; Windows and Android are M9)" };
        const env = d.desktop();
        try {
          const caps = await env.capabilities();
          const missing = caps.filter((c) => c.status !== "available").map((c) => `${c.id}=${c.status}`);
          const clipOk = caps.find((c) => c.id === "desktop.clipboard")?.status === "available";
          if (!clipOk) return { status: "NEEDS_HARDWARE", evidence: `desktop capabilities: ${missing.join(", ")}` };
          // Round trip on the real clipboard, then put back what was there.
          const before = (await env.read({ kind: "clipboard" })) as { ok: boolean; text?: string };
          const probe = `JARVIS acceptance ${Date.now()}`;
          await env.act({ kind: "clipboard.write", text: probe });
          const after = (await env.read({ kind: "clipboard" })) as { ok: boolean; text?: string };
          if (before.ok && before.text !== undefined) await env.act({ kind: "clipboard.write", text: before.text });
          if (!after.ok || after.text !== probe) return { status: "FAIL", error: `clipboard read back ${JSON.stringify(after.text)}` };
          const win = (await env.read({ kind: "window" })) as { found: boolean; window?: { title: string; app?: string } };
          return {
            status: "PASS",
            evidence: `clipboard round trip ok (restored); active window ${win.found ? `"${win.window?.title}" (${win.window?.app ?? "?"})` : "unreadable"}${missing.length ? `; not available: ${missing.join(", ")}` : ""}`,
          };
        } finally {
          await env.close();
        }
      },
    },
    {
      id: "cleanup", title: "8. Cleanup",
      run: async () => {
        await (site as { close: () => Promise<void> } | null)?.close().catch(() => undefined);
        return { status: "PASS", evidence: "site and browsers closed" };
      },
    },
  ];
}

/** Scripted recognizer: finals for a few golden lines through the voice session. */
class ScriptedRecognizer implements StreamingSTT {
  readonly id = "scripted";
  emit: (e: SttEvent) => void = () => undefined;
  async start(onEvent: (e: SttEvent) => void) { this.emit = onEvent; }
  pushAudio() { /* no audio */ }
  async stop() { /* nothing */ }
}

class SilentTTS implements StreamingTTS {
  readonly id = "silent";
  async speak(_t: string, hooks?: { onFirstAudio?: () => void }) { hooks?.onFirstAudio?.(); }
  cancel() { /* nothing playing */ }
}

async function voiceRun(env: ComputerEnvironment, youtubeUrl: string): Promise<{ confirmed: number; latency: StepResult["latency"] }> {
  const stt = new ScriptedRecognizer();
  const voice = new VoiceSession({ stt, tts: new SilentTTS(), holdOnMs: 0 });
  const kernel = new Kernel();
  const rt = new JarvisRuntime({ kernel, env, speaker: voice, session: { youtubeUrl } });
  voice.attach(rt);
  try {
    await rt.start();
    await voice.start();
    let n = 0;
    for (const line of GOLDEN_1_7.slice(0, 5)) {
      const id = `acc-${++n}`;
      const at = Date.now();
      stt.emit({ type: "speech_start", at });
      stt.emit({ type: "partial", utteranceId: id, text: line.split(" ")[0], stability: 0.5, at });
      stt.emit({ type: "final", utteranceId: id, text: line, confidence: 0.9, at: Date.now() });
      await rt.idle();
    }
    const confirmed = rt.turns.filter((t) => t.route === "action" && t.result?.truth === "CONFIRMED").length;
    if (confirmed !== 5) throw new Error(`voice: ${confirmed}/5 actions confirmed`);
    return { confirmed, latency: voice.latency.summary() };
  } finally {
    await voice.stop();
    rt.stop();
  }
}
