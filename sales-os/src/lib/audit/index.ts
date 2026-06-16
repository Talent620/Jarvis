import type { WebsiteAudit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { WEAK_WEBSITE_THRESHOLD } from "@/lib/constants";

export interface AuditMetrics {
  reachable: boolean;
  https: boolean;
  mobileFriendly: boolean | null;
  performance: number | null;
  seo: number | null;
  bestPractices: number | null;
  accessibility: number | null;
  loadTimeMs: number | null;
  issues: string[];
  opportunities: string[];
  provider: "pagespeed" | "heuristic";
  meta?: Record<string, unknown>;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function pct(category: unknown): number | null {
  const score = (category as { score?: number } | undefined)?.score;
  return typeof score === "number" ? Math.round(score * 100) : null;
}

/**
 * Google PageSpeed Insights (free; PAGESPEED_API_KEY raises the quota but is
 * optional). Mobile strategy — that's where weak local-business sites fail.
 */
async function pagespeedAudit(url: string): Promise<AuditMetrics | null> {
  try {
    const params = new URLSearchParams({ url, strategy: "mobile" });
    for (const c of ["PERFORMANCE", "SEO", "BEST_PRACTICES", "ACCESSIBILITY"]) {
      params.append("category", c);
    }
    if (process.env.PAGESPEED_API_KEY) params.set("key", process.env.PAGESPEED_API_KEY);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50_000);
    const res = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      lighthouseResult?: {
        categories?: Record<string, { score?: number }>;
        audits?: Record<string, { numericValue?: number; score?: number }>;
        finalUrl?: string;
      };
    };
    const lh = data.lighthouseResult;
    if (!lh?.categories) return null;

    const performance = pct(lh.categories.performance);
    const seo = pct(lh.categories.seo);
    const bestPractices = pct(lh.categories["best-practices"]);
    const accessibility = pct(lh.categories.accessibility);
    const lcp = lh.audits?.["largest-contentful-paint"]?.numericValue ?? null;
    const viewportOk = (lh.audits?.viewport?.score ?? null) === 1;
    const https = (lh.finalUrl ?? url).startsWith("https://");

    const issues: string[] = [];
    const opportunities: string[] = [];
    if (lcp != null && lcp > 4000) {
      issues.push(`Page takes ${(lcp / 1000).toFixed(1)}s to load on mobile`);
      opportunities.push("Speed optimisation — visitors leave after ~3s");
    }
    if (performance != null && performance < 50) {
      issues.push(`Mobile performance score only ${performance}/100`);
    }
    if (!https) {
      issues.push("No HTTPS — browsers flag the site as 'Not secure'");
      opportunities.push("SSL certificate + secure redesign");
    }
    if (!viewportOk) {
      issues.push("Not mobile-friendly (no responsive viewport)");
      opportunities.push("Responsive redesign — most local searches are mobile");
    }
    if (seo != null && seo < 70) {
      issues.push(`Weak SEO basics (${seo}/100) — hard to find on Google`);
      opportunities.push("On-page SEO as part of a new site");
    }

    return {
      reachable: true,
      https,
      mobileFriendly: viewportOk,
      performance,
      seo,
      bestPractices,
      accessibility,
      loadTimeMs: lcp != null ? Math.round(lcp) : null,
      issues,
      opportunities,
      provider: "pagespeed",
    };
  } catch (e) {
    console.error("[audit] pagespeed failed:", e);
    return null;
  }
}

/**
 * Zero-dependency fallback probe: fetches the page, measures response time and
 * checks HTTPS, responsive viewport and basic SEO tags. Keeps audits working
 * offline / without quota — clearly labelled "heuristic".
 */
async function heuristicAudit(url: string): Promise<AuditMetrics> {
  const issues: string[] = [];
  const opportunities: string[] = [];
  const https = url.startsWith("https://");
  let reachable = false;
  let loadTimeMs: number | null = null;
  let mobileFriendly: boolean | null = null;
  let seo: number | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const start = Date.now();
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SiteAudit/1.0)" },
      redirect: "follow",
    });
    const html = (await res.text()).slice(0, 200_000);
    clearTimeout(timer);
    loadTimeMs = Date.now() - start;
    reachable = res.ok;

    mobileFriendly = /<meta[^>]+name=["']viewport["']/i.test(html);
    const hasTitle = /<title[^>]*>[^<]{3,}/i.test(html);
    const hasDescription = /<meta[^>]+name=["']description["']/i.test(html);
    const hasH1 = /<h1[\s>]/i.test(html);
    seo = [hasTitle, hasDescription, hasH1].filter(Boolean).length * 33;

    if (loadTimeMs > 3000) {
      issues.push(`Server responds in ${(loadTimeMs / 1000).toFixed(1)}s — far too slow`);
      opportunities.push("Modern fast hosting + rebuilt site");
    }
    if (!mobileFriendly) {
      issues.push("Not mobile-friendly (no responsive viewport)");
      opportunities.push("Responsive redesign — most local searches are mobile");
    }
    if (!hasDescription) issues.push("Missing meta description — weak Google snippet");
    if (!hasTitle) issues.push("Missing page title");
  } catch {
    issues.push("Website unreachable or extremely slow");
    opportunities.push("The site is effectively down — easiest pitch there is");
  }

  if (!https) {
    issues.push("No HTTPS — browsers flag the site as 'Not secure'");
    opportunities.push("SSL certificate + secure redesign");
  }

  // Rough performance estimate from response time alone.
  const performance =
    loadTimeMs == null ? 0 : Math.max(5, Math.min(95, Math.round(100 - loadTimeMs / 60)));

  return {
    reachable,
    https,
    mobileFriendly,
    performance,
    seo,
    bestPractices: null,
    accessibility: null,
    loadTimeMs,
    issues,
    opportunities,
    provider: "heuristic",
  };
}

function overallScore(m: AuditMetrics): number {
  if (!m.reachable) return 5;
  const parts = [m.performance, m.seo, m.bestPractices, m.accessibility].filter(
    (v): v is number => v != null,
  );
  let score = parts.length ? Math.round(parts.reduce((s, v) => s + v, 0) / parts.length) : 50;
  if (!m.https) score = Math.min(score, 45) - 10;
  if (m.mobileFriendly === false) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function summarize(url: string, m: AuditMetrics, overall: number): string {
  const head = !m.reachable
    ? `The website ${url} is currently unreachable.`
    : `Website health ${overall}/100${m.loadTimeMs ? ` · responds in ${(m.loadTimeMs / 1000).toFixed(1)}s` : ""}${m.https ? "" : " · NO HTTPS"}${m.mobileFriendly === false ? " · not mobile-friendly" : ""}.`;
  const body = m.issues.length ? ` Key problems: ${m.issues.join("; ")}.` : " No major problems detected.";
  return head + body;
}

/**
 * Audit a lead's website (PageSpeed when possible, heuristic fallback), store
 * a WebsiteAudit row, mirror the result onto the lead (auditScore, hasWebsite,
 * a "modernization" tag for weak sites) and log the timeline activity. The
 * findings feed AI outreach drafts so messages cite concrete facts.
 */
export async function auditLead(args: {
  companyId: string;
  leadId: string;
}): Promise<WebsiteAudit | null> {
  const lead = await prisma.lead.findFirst({
    where: { id: args.leadId, companyId: args.companyId, deletedAt: null },
    select: { id: true, website: true, tags: true, name: true },
  });
  if (!lead) return null;

  if (!lead.website) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        hasWebsite: false,
        tags: Array.from(new Set([...lead.tags, "no-website"])),
      },
    });
    return null;
  }

  const url = normalizeUrl(lead.website);
  const metrics = (await pagespeedAudit(url)) ?? (await heuristicAudit(url));
  const overall = overallScore(metrics);
  const summary = summarize(url, metrics, overall);
  const weak = overall < WEAK_WEBSITE_THRESHOLD;

  const audit = await prisma.websiteAudit.create({
    data: {
      companyId: args.companyId,
      leadId: lead.id,
      url,
      reachable: metrics.reachable,
      https: metrics.https,
      mobileFriendly: metrics.mobileFriendly,
      performance: metrics.performance,
      seo: metrics.seo,
      bestPractices: metrics.bestPractices,
      accessibility: metrics.accessibility,
      overall,
      loadTimeMs: metrics.loadTimeMs,
      issues: metrics.issues,
      opportunities: metrics.opportunities,
      summary,
      provider: metrics.provider,
    },
  });

  const tags = new Set(lead.tags);
  tags.delete("no-website");
  if (weak) tags.add("modernization");

  await prisma.lead.update({
    where: { id: lead.id },
    data: { hasWebsite: true, auditScore: overall, tags: Array.from(tags) },
  });

  await logActivity({
    companyId: args.companyId,
    leadId: lead.id,
    type: "SYSTEM",
    title: `Website audited — ${overall}/100 (${metrics.provider})`,
    body: summary,
    meta: { auditId: audit.id, overall, weak },
  });

  return audit;
}

/** Compact audit facts for AI prompts ("page loads in 9s, no HTTPS…"). */
export function auditDraftContext(audit: Pick<WebsiteAudit, "overall" | "loadTimeMs" | "https" | "mobileFriendly" | "issues">): string {
  const bits = [
    `their website scores ${audit.overall}/100 in our audit`,
    audit.loadTimeMs ? `loads in ${(audit.loadTimeMs / 1000).toFixed(1)}s` : null,
    audit.https ? null : "has no HTTPS (shows 'Not secure')",
    audit.mobileFriendly === false ? "is not mobile-friendly" : null,
    ...audit.issues.slice(0, 2),
  ].filter(Boolean);
  return bits.join("; ");
}
