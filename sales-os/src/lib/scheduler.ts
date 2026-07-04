import { runAcquisitionTickForAllCompanies } from "@/lib/acquisition/autopilot";

/**
 * Tiny in-process scheduler. It lets the autopilot run out of the box with just
 * `npm run dev` — no external cron needed — by ticking on an interval inside the
 * Next.js server process. For real deployments you'd typically disable this and
 * hit `POST /api/cron` from a proper scheduler (Vercel Cron, QStash, GitHub
 * Actions, k8s CronJob…); see the README.
 *
 * Controls (env):
 *   ACQUISITION_AUTOPILOT_INPROCESS = "1" | "0"   (default: on unless explicitly "0")
 *   ACQUISITION_TICK_SECONDS        = interval in seconds (default 300, min 30)
 */

// Survive HMR / multiple imports in dev by stashing state on globalThis.
const g = globalThis as unknown as {
  __acqScheduler?: { timer: NodeJS.Timeout; running: boolean };
};

function intervalMs(): number {
  const raw = Number(process.env.ACQUISITION_TICK_SECONDS ?? "300");
  const secs = Number.isFinite(raw) && raw >= 30 ? raw : 300;
  return secs * 1000;
}

async function tick() {
  if (!g.__acqScheduler || g.__acqScheduler.running) return; // skip if overlapping
  g.__acqScheduler.running = true;
  try {
    const res = await runAcquisitionTickForAllCompanies("CRON");
    if (res.companies > 0) {
      console.log(`[scheduler] autopilot ticked ${res.companies} compan${res.companies === 1 ? "y" : "ies"}`);
    }
  } catch (e) {
    console.error("[scheduler] tick error:", e);
  } finally {
    if (g.__acqScheduler) g.__acqScheduler.running = false;
  }
}

export function startScheduler() {
  if (process.env.ACQUISITION_AUTOPILOT_INPROCESS === "0") {
    console.log("[scheduler] in-process autopilot disabled (ACQUISITION_AUTOPILOT_INPROCESS=0)");
    return;
  }
  if (g.__acqScheduler) return; // already started

  const ms = intervalMs();
  const timer = setInterval(() => void tick(), ms);
  // Don't keep the event loop alive solely for the scheduler.
  if (typeof timer.unref === "function") timer.unref();
  g.__acqScheduler = { timer, running: false };

  console.log(`[scheduler] in-process autopilot started (every ${ms / 1000}s)`);
  // Kick once shortly after boot so the first run doesn't wait a full interval.
  setTimeout(() => void tick(), 8_000);
}
