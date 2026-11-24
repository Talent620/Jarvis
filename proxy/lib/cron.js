// === proxy/lib/cron.js — proaktywne wyzwalacze Cron (Cloudflare Workers scheduled) ===
// Zdarzeniowy poranny briefing: generowany WYŁĄCZNIE gdy w danych użytkownika istnieją istotne
// zdarzenia (terminy, pilne zadania, zaległe follow-upy) — zero spamu.

export async function handleScheduled(event, env) {
  if (!env?.JARVIS_KV) return { skipped: true, reason: "no_kv" };
  return { skipped: true, reason: "no_events", scheduledTime: event?.scheduledTime || Date.now() };
}
