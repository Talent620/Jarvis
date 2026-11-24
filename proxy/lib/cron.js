// === proxy/lib/cron.js — proaktywny Cron Trigger (Cloudflare Workers scheduled) ===
// Poranny briefing generowany WYŁĄCZNIE wtedy, gdy w zsynchronizowanych danych użytkownika
// istnieją istotne zdarzenia (spotkania w ciągu 24h, pilne/zaległe zadania, przypomnienia,
// follow-upy leadów). Gdy brak zdarzeń → ciche pominięcie (zero spamu).
import { fetchT } from "./auth.js";

const DAY_MS = 86_400_000;

/** Pure: wyłuskaj istotne zdarzenia na najbliższe 24h / zaległe ze zsynchronizowanego stanu. */
export function collectBriefingEvents(data, now = Date.now()) {
  if (!data || typeof data !== "object") return [];
  const horizon = now + DAY_MS;
  const events = [];

  for (const ev of Array.isArray(data.calendar) ? data.calendar : []) {
    const t = Date.parse(ev?.start || "");
    if (Number.isFinite(t) && t >= now - 3600_000 && t <= horizon) {
      events.push({ kind: "calendar", title: String(ev.title || "Wydarzenie"), at: t });
    }
  }

  for (const task of Array.isArray(data.tasks) ? data.tasks : []) {
    if (!task || task.done) continue;
    const due = task.due ? Date.parse(task.due) : NaN;
    if (task.priority || (Number.isFinite(due) && due <= horizon)) {
      events.push({
        kind: "task",
        title: String(task.title || "Zadanie"),
        at: Number.isFinite(due) ? due : now,
        urgent: !!task.priority || (Number.isFinite(due) && due < now),
      });
    }
  }

  for (const rem of Array.isArray(data.reminders) ? data.reminders : []) {
    if (!rem || rem.fired) continue;
    const at = Date.parse(rem.at || "");
    if (Number.isFinite(at) && at <= horizon) {
      events.push({ kind: "reminder", title: String(rem.text || "Przypomnienie"), at });
    }
  }

  for (const lead of Array.isArray(data.leads) ? data.leads : []) {
    if (!lead || lead.doNotContact || lead.optOut) continue;
    if (lead.status === "won" || lead.status === "lost") continue;
    if (typeof lead.nextFollowUpAt === "number" && lead.nextFollowUpAt <= horizon) {
      events.push({
        kind: "lead",
        title: `Follow-up: ${String(lead.company || lead.name || "Klient")}`,
        at: lead.nextFollowUpAt,
      });
    }
  }

  return events.sort((a, b) => (a.at || 0) - (b.at || 0)).slice(0, 15);
}

/** Pure: czy warto wysłać briefing (tylko gdy są realne, istotne zdarzenia). */
export function shouldSendBriefing(events) {
  return Array.isArray(events) && events.length > 0;
}

/** Pure: zbuduj zwięzły poranny briefing po polsku z listy zdarzeń. */
export function buildMorningBriefing(events, now = Date.now()) {
  if (!shouldSendBriefing(events)) return null;
  const dateLabel = new Date(now).toISOString().slice(0, 10);
  const icons = { calendar: "📅", task: "✅", reminder: "⏰", lead: "🧲" };
  const lines = events.map((e) => `- ${icons[e.kind] || "•"} ${e.title}`);
  return {
    date: dateLabel,
    generatedAt: now,
    count: events.length,
    summary: `Poranny briefing JARVIS (${dateLabel}) — istotne zdarzenia (${events.length}):\n${lines.join("\n")}`,
    events,
  };
}

/**
 * Handler Cloudflare Workers Cron Trigger (`scheduled`).
 * Przegląda przestrzenie `sync:*` w KV i generuje briefing TYLKO dla kont z istotnymi zdarzeniami.
 */
export async function handleScheduled(event, env) {
  const now = typeof event?.scheduledTime === "number" ? event.scheduledTime : Date.now();
  if (!env?.JARVIS_KV) return { generated: 0, skipped: 0, reason: "no_kv" };

  const list = await env.JARVIS_KV.list({ prefix: "sync:", limit: 100 });
  let generated = 0;
  let skipped = 0;

  for (const k of list?.keys || []) {
    const raw = await env.JARVIS_KV.get(k.name);
    if (!raw) { skipped++; continue; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { skipped++; continue; }
    const events = collectBriefingEvents(parsed?.data, now);
    if (!shouldSendBriefing(events)) {
      skipped++;
      continue;
    }
    const briefing = buildMorningBriefing(events, now);
    const token = k.name.slice("sync:".length);
    await env.JARVIS_KV.put(`briefing:${token}`, JSON.stringify(briefing), { expirationTtl: 86400 });
    generated++;

    if (env.PROACTIVE_WEBHOOK_URL) {
      try {
        await fetchT(env.PROACTIVE_WEBHOOK_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "morning_briefing", ...briefing }),
        }, 8000);
      } catch {
        /* best-effort webhook */
      }
    }
  }

  return { generated, skipped, at: now };
}
