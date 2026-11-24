// === proxy/lib/cron.js — Nocny Sen (sleep_consolidate) + Budżet Ciszy + proaktywny Cron ===
// Cloudflare Workers Cron Trigger (`scheduled`):
// 1) Konsoliduje miniony dzień: aktualizuje `open_loops` i `user_lessons` w zsynchronizowanym stanie.
// 2) Respektuje „Budżet Ciszy” (max 3 zaczepki/dzień + cisza nocna 22:00–07:00).
// 3) Przygotowuje krótki 30-sekundowy poranny briefing głosowy TYLKO jeśli istnieje realnie pilny powód.
import { fetchT } from "./auth.js";

const DAY_MS = 86_400_000;
const DEFAULT_DAILY_LIMIT = 3;
const DEFAULT_QUIET_START = 22;
const DEFAULT_QUIET_END = 7;

const OPEN_LOOP_RE =
  /(musz[ęe]|obieca[łl]em|obieca[łl]am|pami[ęe]taj[, ]+[żz]eby|przypomnij mi[, ]+[żz]eby|wy[śs]l[ęe]|oddzwoni[ęe]|odezw[ęe] si[ęe]|wr[óo][ćc]my do|doko[ńn]cz[ęe]|do za[łl]atwienia)\s+(.{6,140})/i;
const CLOSE_LOOP_RE = /(za[łl]atwione|zrobione|wys[łl]a[łl]em|wys[łl]ane|oddzwoni[łl]em|zamknij temat|ogarni[ęe]te)/i;
const HIGH_PRIO_RE = /(pilne|natychmiast|dzisiaj|dzi[śs]|jutro|faktur|umow|klient|termin|przelew|awari)/i;

const LESSON_RULES = [
  { re: /(za d[łl]ug|za du[żz]o gadasz|kr[óo]cej|skr[óo][ćc]|streszczaj|do rzeczy)/i, rule: "Odpowiadaj maksymalnie zwięźle (1–2 zdania).", trigger: "za długo / krócej" },
  { re: /(konkretniej|sam konkret|bez wst[ęe]p[óo]w|nie owijaj|wprost)/i, rule: "Zero wstępów — zacznij od razu od sedna lub komendy.", trigger: "konkretniej" },
  { re: /(bez list|nie r[óo]b list|bez punktor)/i, rule: "Nie używaj list punktowanych — mów naturalnymi zdaniami.", trigger: "bez list" },
];

function dayIso(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/** Pure: sprawdź ciszę nocną (domyślnie 22:00–07:00 UTC/lokalnie wg przesunięcia). */
export function isQuietHours(now = Date.now(), startHour = DEFAULT_QUIET_START, endHour = DEFAULT_QUIET_END) {
  const h = new Date(now).getUTCHours();
  if (startHour === endHour) return false;
  if (startHour > endHour) return h >= startHour || h < endHour;
  return h >= startHour && h < endHour;
}

/** Pure: znormalizuj Budżet Ciszy na bieżący dzień i sprawdź, czy można wysłać zaczepkę. */
export function checkProactiveBudget(budget, now = Date.now()) {
  const today = dayIso(now);
  const dailyLimit = typeof budget?.dailyLimit === "number" && budget.dailyLimit >= 0 ? Math.floor(budget.dailyLimit) : DEFAULT_DAILY_LIMIT;
  const quietStartHour = typeof budget?.quietStartHour === "number" ? budget.quietStartHour : DEFAULT_QUIET_START;
  const quietEndHour = typeof budget?.quietEndHour === "number" ? budget.quietEndHour : DEFAULT_QUIET_END;
  const usedToday = budget?.date === today && typeof budget?.usedToday === "number" ? Math.floor(budget.usedToday) : 0;
  const remaining = Math.max(0, dailyLimit - usedToday);
  const state = { date: today, usedToday, dailyLimit, quietStartHour, quietEndHour };

  if (isQuietHours(now, quietStartHour, quietEndHour)) {
    return { allowed: false, reason: "quiet_hours", remaining, state };
  }
  if (remaining <= 0) {
    return { allowed: false, reason: "budget_exhausted", remaining: 0, state };
  }
  return { allowed: true, reason: "ok", remaining, state };
}

/** Pure: wyłuskaj istotne zdarzenia na najbliższe 24h / zaległe ze zsynchronizowanego stanu. */
export function collectBriefingEvents(data, now = Date.now()) {
  if (!data || typeof data !== "object") return [];
  const horizon = now + DAY_MS;
  const events = [];

  for (const ev of Array.isArray(data.calendar) ? data.calendar : []) {
    const t = Date.parse(ev?.start || "");
    if (Number.isFinite(t) && t >= now - 3600_000 && t <= horizon) {
      events.push({ kind: "calendar", title: String(ev.title || "Wydarzenie"), at: t, urgent: true });
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
      events.push({ kind: "reminder", title: String(rem.text || "Przypomnienie"), at, urgent: true });
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
        urgent: true,
      });
    }
  }

  for (const loop of Array.isArray(data.open_loops) ? data.open_loops : []) {
    if (!loop || loop.status !== "open" || loop.priority !== "high") continue;
    events.push({
      kind: "open_loop",
      title: String(loop.topic || loop.promise || "Niedomknięta sprawa"),
      at: typeof loop.updatedAt === "number" ? loop.updatedAt : now,
      urgent: true,
    });
  }

  return events.sort((a, b) => (a.at || 0) - (b.at || 0)).slice(0, 15);
}

/** Pure: czy warto wysłać briefing (tylko gdy są realne, istotne zdarzenia). */
export function shouldSendBriefing(events) {
  return Array.isArray(events) && events.length > 0;
}

/** Pure: zbuduj zwięzły poranny briefing po polsku z listy zdarzeń (tekst + wersja głosowa <=30 s). */
export function buildMorningBriefing(events, now = Date.now()) {
  if (!shouldSendBriefing(events)) return null;
  const dateLabel = dayIso(now);
  const icons = { calendar: "📅", task: "✅", reminder: "⏰", lead: "🧲", open_loop: "🔁" };
  const lines = events.map((e) => `- ${icons[e.kind] || "•"} ${e.title}`);
  const top3 = events.slice(0, 3).map((e) => e.title);
  return {
    date: dateLabel,
    generatedAt: now,
    count: events.length,
    summary: `Poranny briefing JARVIS (${dateLabel}) — istotne zdarzenia (${events.length}):\n${lines.join("\n")}`,
    spokenBriefing: `Dzień dobry, masz ${events.length} pilne sprawy na dziś. Najważniejsze to ${top3.join(", ")}. Od czego zaczynamy?`,
    events,
  };
}

/**
 * Pure: Nocna konsolidacja (`sleep_consolidate`):
 * - podsumowuje miniony dzień,
 * - aktualizuje `open_loops` i `user_lessons` na podstawie ostatnich wiadomości/notatek,
 * - zwraca 30-sekundowy briefing głosowy TYLKO gdy istnieje realnie pilny powód.
 */
export function sleepConsolidate(data, now = Date.now()) {
  const safe = data && typeof data === "object" ? data : {};
  const messages = Array.isArray(safe.recentMessages) ? safe.recentMessages : [];

  // 1) Konsolidacja open_loops
  const loopMap = new Map();
  for (const l of Array.isArray(safe.open_loops) ? safe.open_loops : []) {
    if (!l?.topic) continue;
    loopMap.set(String(l.topic).toLowerCase().trim().slice(0, 64), { ...l });
  }
  for (const m of messages) {
    if (!m || m.role !== "user" || typeof m.content !== "string") continue;
    if (CLOSE_LOOP_RE.test(m.content)) {
      const words = m.content.toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
      for (const loop of loopMap.values()) {
        if (loop.status !== "open") continue;
        if (words.some((w) => String(loop.topic).toLowerCase().includes(w))) {
          loop.status = "closed";
          loop.updatedAt = now;
        }
      }
    }
    const match = OPEN_LOOP_RE.exec(m.content);
    if (match) {
      const topic = (match[2] || "").split(/[.!?\n]/)[0].trim().slice(0, 60);
      if (topic.length >= 5) {
        const key = topic.toLowerCase();
        const prev = loopMap.get(key);
        if (!prev) {
          loopMap.set(key, {
            id: `loop_${now}_${loopMap.size}`,
            topic,
            promise: `${match[1].trim()} ${topic}`,
            priority: HIGH_PRIO_RE.test(m.content) ? "high" : "medium",
            status: "open",
            createdAt: typeof m.createdAt === "number" ? m.createdAt : now,
            updatedAt: now,
          });
        } else if (prev.status === "open") {
          prev.updatedAt = now;
          if (HIGH_PRIO_RE.test(m.content)) prev.priority = "high";
        }
      }
    }
  }
  const open_loops = [...loopMap.values()].slice(0, 40);

  // 2) Konsolidacja user_lessons
  const lessonMap = new Map();
  for (const l of Array.isArray(safe.user_lessons) ? safe.user_lessons : []) {
    if (!l?.rule) continue;
    lessonMap.set(String(l.rule).toLowerCase().trim(), { ...l });
  }
  for (const m of messages) {
    if (!m || m.role !== "user" || typeof m.content !== "string") continue;
    for (const r of LESSON_RULES) {
      if (r.re.test(m.content)) {
        const key = r.rule.toLowerCase();
        const prev = lessonMap.get(key);
        if (prev) {
          prev.hits = (prev.hits || 1) + 1;
          prev.updatedAt = now;
        } else {
          lessonMap.set(key, {
            id: `lesson_${now}_${lessonMap.size}`,
            rule: r.rule,
            trigger: r.trigger,
            source: "sleep",
            hits: 1,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }
  }
  const user_lessons = [...lessonMap.values()].slice(0, 30);

  // 3) Ocena pilności + poranny briefing <= 30 s TYLKO gdy jest pilny powód
  const events = collectBriefingEvents({ ...safe, open_loops }, now);
  const urgent = shouldSendBriefing(events);
  const briefing = urgent ? buildMorningBriefing(events, now) : null;
  const openCount = open_loops.filter((l) => l.status === "open").length;

  return {
    date: dayIso(now),
    consolidatedAt: now,
    open_loops,
    user_lessons,
    daySummary: `Nocna konsolidacja (${dayIso(now)}): otwarte sprawy ${openCount}, lekcje stylu ${user_lessons.length}, pilne ${events.length}.`,
    urgent,
    spokenBriefing: briefing ? briefing.spokenBriefing : null,
    briefing,
  };
}

/**
 * Handler Cloudflare Workers Cron Trigger (`scheduled`).
 * 1) Wykonuje nocną konsolidację `sleep_consolidate` dla każdej przestrzeni `sync:*`.
 * 2) Zapisuje poranny briefing i wywołuje webhook TYLKO jeśli istnieje pilny powód
 *    ORAZ pozwala na to Budżet Ciszy (max 3/dzień + poza ciszą nocną).
 */
export async function handleScheduled(event, env) {
  const now = typeof event?.scheduledTime === "number" ? event.scheduledTime : Date.now();
  if (!env?.JARVIS_KV) return { generated: 0, consolidated: 0, skipped: 0, reason: "no_kv" };

  const list = await env.JARVIS_KV.list({ prefix: "sync:", limit: 100 });
  let generated = 0;
  let consolidated = 0;
  let skipped = 0;

  for (const k of list?.keys || []) {
    const raw = await env.JARVIS_KV.get(k.name);
    if (!raw) { skipped++; continue; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { skipped++; continue; }

    const token = k.name.slice("sync:".length);
    const sleepResult = sleepConsolidate(parsed?.data, now);
    consolidated++;

    await env.JARVIS_KV.put(
      `sleep:${token}`,
      JSON.stringify({
        date: sleepResult.date,
        consolidatedAt: sleepResult.consolidatedAt,
        daySummary: sleepResult.daySummary,
        open_loops: sleepResult.open_loops,
        user_lessons: sleepResult.user_lessons,
        urgent: sleepResult.urgent,
        spokenBriefing: sleepResult.spokenBriefing,
      }),
      { expirationTtl: 7 * 86400 },
    );

    if (!sleepResult.urgent || !sleepResult.briefing) {
      skipped++;
      continue;
    }

    const budgetCheck = checkProactiveBudget(parsed?.data?.proactive_budget, now);
    await env.JARVIS_KV.put(`briefing:${token}`, JSON.stringify(sleepResult.briefing), { expirationTtl: 86400 });
    generated++;

    // Zewnętrzny push/webhook tylko poza ciszą nocną i w ramach Budżetu Ciszy
    if (env.PROACTIVE_WEBHOOK_URL && budgetCheck.allowed) {
      try {
        await fetchT(env.PROACTIVE_WEBHOOK_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "morning_briefing",
            ...sleepResult.briefing,
            daySummary: sleepResult.daySummary,
          }),
        }, 8000);
      } catch {
        /* best-effort webhook */
      }
    }
  }

  return { generated, consolidated, skipped, at: now };
}
