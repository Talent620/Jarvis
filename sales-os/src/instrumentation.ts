/**
 * Next.js instrumentation entrypoint. Runs once when the server process starts.
 * We use it to boot the in-process acquisition scheduler. Guarded to the Node.js
 * runtime so it never tries to run on the Edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  }
}
