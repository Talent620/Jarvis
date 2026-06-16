/**
 * Seed for "AI Sales & Client Acquisition OS".
 *
 * Idempotent: wipes and recreates the demo company (cascade) on every run.
 * Demo login →  owner@northstar.studio  /  demo1234
 *
 * Scoring is inlined here (not imported from src/lib) so the script stays
 * dependency-free under `tsx` without needing tsconfig path resolution. It
 * mirrors src/lib/scoring.ts so seeded scores match the live engine.
 */
import { PrismaClient, type LeadSource, type Priority, type LeadOutcome, type ScoreGrade } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ----------------------------- helpers -----------------------------

const DAY = 86_400_000;
const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * DAY);
const daysFromNow = (n: number) => new Date(now + n * DAY);
const midnight = (d: Date) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};
const pick = <T,>(arr: T[], i: number) => arr[i % arr.length];

const SOURCE_POINTS: Record<string, number> = {
  REFERRAL: 22, INBOUND_FORM: 20, WEBSITE: 16, EVENT: 16, GOOGLE_MAPS: 14,
  BUSINESS_REGISTRY: 12, LINKEDIN: 12, MARKETPLACE: 10, ADS: 10,
  FACEBOOK_GROUP: 8, COLD_OUTREACH: 6, OTHER: 4,
};
const PRIORITY_POINTS: Record<string, number> = { URGENT: 18, HIGH: 13, MEDIUM: 7, LOW: 2 };

function gradeFromScore(score: number): ScoreGrade {
  if (score >= 75) return "A";
  if (score >= 50) return "B";
  if (score >= 25) return "C";
  return "D";
}

interface ScoreInput {
  source: LeadSource;
  priority: Priority;
  outcome: LeadOutcome;
  budget: number | null;
  estimatedValue: number | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  industry: string | null;
  lastContactedAt: Date | null;
  expectedCloseAt: Date | null;
  createdAt: Date;
}

function scoreLead(lead: ScoreInput) {
  const b: Record<string, number> = {};
  b["Source"] = SOURCE_POINTS[lead.source] ?? 4;
  b["Priority"] = PRIORITY_POINTS[lead.priority] ?? 7;
  const budget = lead.budget ?? 0;
  b["Budget"] = budget >= 50000 ? 18 : budget >= 20000 ? 13 : budget >= 5000 ? 8 : budget > 0 ? 4 : 0;
  const value = lead.estimatedValue ?? 0;
  b["Deal value"] = value >= 50000 ? 12 : value >= 15000 ? 8 : value > 0 ? 4 : 0;
  let completeness = 0;
  if (lead.email) completeness += 5;
  if (lead.phone) completeness += 4;
  if (lead.companyName) completeness += 3;
  if (lead.industry) completeness += 2;
  b["Profile completeness"] = completeness;
  if (lead.lastContactedAt) {
    const days = (now - lead.lastContactedAt.getTime()) / DAY;
    b["Recent engagement"] = days <= 3 ? 12 : days <= 7 ? 8 : days <= 21 ? 4 : 0;
  } else b["Recent engagement"] = 0;
  if (lead.expectedCloseAt) {
    const days = (lead.expectedCloseAt.getTime() - now) / DAY;
    b["Close timeline"] = days <= 14 ? 8 : days <= 45 ? 5 : 2;
  } else b["Close timeline"] = 0;
  const ageDays = (now - lead.createdAt.getTime()) / DAY;
  if (!lead.lastContactedAt && ageDays > 14) b["Stale (no contact)"] = -10;
  if (lead.outcome === "WON") b["Won"] = 100;
  if (lead.outcome === "LOST") b["Lost"] = -100;
  const raw = Object.values(b).reduce((s, n) => s + n, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const grade = gradeFromScore(score);
  const top = Object.entries(b).filter(([, v]) => v > 0).sort((a, c) => c[1] - a[1]).slice(0, 3).map(([k]) => k);
  const reason =
    lead.outcome === "WON" ? "Closed-won."
      : lead.outcome === "LOST" ? "Closed-lost."
        : top.length ? `Driven by ${top.join(", ").toLowerCase()}.`
          : "Limited signal — enrich this lead to improve scoring.";
  return { score, grade, breakdown: b, reason };
}

const STAGES: {
  name: string;
  order: number;
  probability: number;
  color: string;
  isWon?: boolean;
  isLost?: boolean;
}[] = [
  { name: "New", order: 1, probability: 0.05, color: "#94a3b8" },
  { name: "Contacted", order: 2, probability: 0.15, color: "#0ea5e9" },
  { name: "Qualified", order: 3, probability: 0.35, color: "#6366f1" },
  { name: "Proposal", order: 4, probability: 0.55, color: "#a855f7" },
  { name: "Negotiation", order: 5, probability: 0.75, color: "#f59e0b" },
  { name: "Won", order: 6, probability: 1, color: "#16a34a", isWon: true },
  { name: "Lost", order: 7, probability: 0, color: "#ef4444", isLost: true },
];

// ----------------------------- lead data ---------------------------

interface LeadSpec {
  name: string;
  email: string;
  phone?: string;
  position?: string;
  companyName: string;
  industry: string;
  region: string;
  source: LeadSource;
  priority: Priority;
  budget?: number;
  estimatedValue?: number;
  stage: string;
  outcome?: LeadOutcome;
  lastContactedDays?: number; // days ago
  closeInDays?: number;
  createdDaysAgo: number;
  tags?: string[];
  note?: string;
}

const LEADS: LeadSpec[] = [
  { name: "Tomasz Wój­cik", email: "t.wojcik@stalmont.pl", phone: "+48 601 220 145", position: "Marketing Director", companyName: "Stalmont S.A.", industry: "Steel fabrication", region: "Śląskie", source: "REFERRAL", priority: "URGENT", budget: 60000, estimatedValue: 72000, stage: "Negotiation", lastContactedDays: 1, closeInDays: 10, createdDaysAgo: 26, tags: ["enterprise", "warm"], note: "CEO loved the booth-lead concept. Wants contract by end of month." },
  { name: "Anna Kowalska", email: "anna@medexpo.eu", phone: "+48 512 880 332", position: "CEO", companyName: "MedExpo Group", industry: "Medical devices", region: "Mazowieckie", source: "INBOUND_FORM", priority: "HIGH", budget: 40000, estimatedValue: 48000, stage: "Proposal", lastContactedDays: 2, closeInDays: 21, createdDaysAgo: 19, tags: ["inbound"], note: "Sent proposal v2. Decision after their board meeting." },
  { name: "Piotr Nowak", email: "p.nowak@autoparts24.pl", phone: "+48 698 114 220", position: "Owner", companyName: "AutoParts24", industry: "Automotive", region: "Wielkopolskie", source: "EVENT", priority: "HIGH", budget: 25000, estimatedValue: 30000, stage: "Qualified", lastContactedDays: 4, closeInDays: 30, createdDaysAgo: 22 },
  { name: "Katarzyna Lewandowska", email: "k.lewandowska@greenpack.pl", position: "Head of Sales", companyName: "GreenPack", industry: "Packaging", region: "Pomorskie", source: "WEBSITE", priority: "MEDIUM", budget: 15000, estimatedValue: 18000, stage: "Contacted", lastContactedDays: 6, createdDaysAgo: 14 },
  { name: "Michał Zieliński", email: "michal@brewtech.io", phone: "+48 660 778 901", position: "Founder", companyName: "BrewTech", industry: "Food & beverage", region: "Małopolskie", source: "LINKEDIN", priority: "MEDIUM", budget: 12000, estimatedValue: 16000, stage: "Qualified", lastContactedDays: 8, closeInDays: 40, createdDaysAgo: 18 },
  { name: "Magdalena Wiśniewska", email: "m.wisniewska@furnipol.pl", position: "CMO", companyName: "FurniPol", industry: "Furniture", region: "Kujawsko-Pomorskie", source: "REFERRAL", priority: "HIGH", budget: 35000, estimatedValue: 42000, stage: "Proposal", lastContactedDays: 3, closeInDays: 18, createdDaysAgo: 20, tags: ["warm"] },
  { name: "Robert Kamiński", email: "r.kaminski@hydroflex.pl", phone: "+48 605 332 118", position: "Procurement", companyName: "HydroFlex", industry: "Industrial equipment", region: "Dolnośląskie", source: "COLD_OUTREACH", priority: "LOW", estimatedValue: 8000, stage: "New", createdDaysAgo: 3 },
  { name: "Ewa Dąbrowska", email: "ewa@cleanlab.pl", position: "Lab Manager", companyName: "CleanLab", industry: "Chemicals", region: "Łódzkie", source: "MARKETPLACE", priority: "MEDIUM", budget: 10000, estimatedValue: 14000, stage: "Contacted", lastContactedDays: 9, createdDaysAgo: 12 },
  { name: "Grzegorz Mazur", email: "g.mazur@solartech.pl", phone: "+48 514 009 887", position: "CEO", companyName: "SolarTech", industry: "Renewable energy", region: "Podkarpackie", source: "INBOUND_FORM", priority: "URGENT", budget: 55000, estimatedValue: 65000, stage: "Negotiation", lastContactedDays: 2, closeInDays: 12, createdDaysAgo: 24, tags: ["enterprise", "hot"], note: "Budget approved. Finalising scope of the retainer." },
  { name: "Joanna Krawczyk", email: "j.krawczyk@texstyle.pl", position: "Brand Manager", companyName: "TexStyle", industry: "Textiles", region: "Łódzkie", source: "FACEBOOK_GROUP", priority: "LOW", estimatedValue: 6000, stage: "New", createdDaysAgo: 5 },
  { name: "Paweł Jankowski", email: "p.jankowski@buildpro.pl", phone: "+48 692 551 770", position: "Director", companyName: "BuildPro", industry: "Construction", region: "Mazowieckie", source: "EVENT", priority: "HIGH", budget: 30000, estimatedValue: 36000, stage: "Qualified", lastContactedDays: 5, closeInDays: 35, createdDaysAgo: 16 },
  { name: "Aleksandra Wojciechowska", email: "ola@petfoodlab.pl", position: "Marketing Lead", companyName: "PetFood Lab", industry: "Pet products", region: "Wielkopolskie", source: "WEBSITE", priority: "MEDIUM", budget: 14000, estimatedValue: 17000, stage: "Contacted", lastContactedDays: 7, createdDaysAgo: 11 },
  { name: "Marek Kaczmarek", email: "m.kaczmarek@coldchain.pl", phone: "+48 600 121 343", position: "COO", companyName: "ColdChain Logistics", industry: "Logistics", region: "Pomorskie", source: "REFERRAL", priority: "HIGH", budget: 45000, estimatedValue: 50000, stage: "Proposal", lastContactedDays: 4, closeInDays: 22, createdDaysAgo: 21 },
  { name: "Natalia Piotrowska", email: "n.piotrowska@aerofit.pl", position: "Founder", companyName: "AeroFit", industry: "Sports equipment", region: "Małopolskie", source: "ADS", priority: "MEDIUM", budget: 11000, estimatedValue: 13000, stage: "Qualified", lastContactedDays: 10, closeInDays: 50, createdDaysAgo: 17 },
  { name: "Krzysztof Grabowski", email: "k.grabowski@vinomak.pl", position: "Owner", companyName: "VinoMak", industry: "Food & beverage", region: "Lubuskie", source: "COLD_OUTREACH", priority: "LOW", estimatedValue: 7000, stage: "New", createdDaysAgo: 2 },
  { name: "Monika Zając", email: "m.zajac@printwave.pl", phone: "+48 511 884 220", position: "CMO", companyName: "PrintWave", industry: "Printing", region: "Śląskie", source: "LINKEDIN", priority: "MEDIUM", budget: 13000, estimatedValue: 15000, stage: "Contacted", lastContactedDays: 12, createdDaysAgo: 15 },
  { name: "Łukasz Król", email: "l.krol@robotix.pl", phone: "+48 668 220 551", position: "CTO", companyName: "Robotix", industry: "Robotics", region: "Dolnośląskie", source: "INBOUND_FORM", priority: "HIGH", budget: 38000, estimatedValue: 44000, stage: "Negotiation", lastContactedDays: 3, closeInDays: 15, createdDaysAgo: 23, tags: ["warm"] },
  { name: "Agnieszka Wróbel", email: "a.wrobel@ecohome.pl", position: "Director", companyName: "EcoHome", industry: "Home & garden", region: "Zachodniopomorskie", source: "MARKETPLACE", priority: "LOW", estimatedValue: 9000, stage: "New", createdDaysAgo: 4 },
  // Won
  { name: "Bartosz Szymański", email: "b.szymanski@megatools.pl", phone: "+48 602 990 110", position: "CEO", companyName: "MegaTools", industry: "Industrial equipment", region: "Śląskie", source: "REFERRAL", priority: "HIGH", budget: 50000, estimatedValue: 58000, stage: "Won", outcome: "WON", lastContactedDays: 14, createdDaysAgo: 60, tags: ["closed"], note: "Signed the full-funnel package. Kickoff next week." },
  { name: "Karolina Lis", email: "k.lis@bioplast.pl", position: "Marketing Director", companyName: "BioPlast", industry: "Packaging", region: "Mazowieckie", source: "INBOUND_FORM", priority: "MEDIUM", budget: 28000, estimatedValue: 32000, stage: "Won", outcome: "WON", lastContactedDays: 20, createdDaysAgo: 75 },
  { name: "Damian Olszewski", email: "d.olszewski@truckparts.pl", phone: "+48 696 110 442", position: "Owner", companyName: "TruckParts", industry: "Automotive", region: "Wielkopolskie", source: "EVENT", priority: "HIGH", budget: 42000, estimatedValue: 47000, stage: "Won", outcome: "WON", lastContactedDays: 28, createdDaysAgo: 90 },
  // Lost
  { name: "Sylwia Adamczyk", email: "s.adamczyk@quickfit.pl", position: "CMO", companyName: "QuickFit", industry: "Sports equipment", region: "Łódzkie", source: "ADS", priority: "LOW", estimatedValue: 10000, stage: "Lost", outcome: "LOST", lastContactedDays: 35, createdDaysAgo: 70, note: "Went with an in-house hire instead." },
  { name: "Rafał Pawlak", email: "r.pawlak@oldtimer.pl", position: "Director", companyName: "OldTimer Restorations", industry: "Automotive", region: "Małopolskie", source: "COLD_OUTREACH", priority: "LOW", estimatedValue: 8000, stage: "Lost", outcome: "LOST", lastContactedDays: 45, createdDaysAgo: 80 },
];

async function main() {
  // Idempotency: remove any prior demo company (cascade clears children).
  await prisma.company.deleteMany({ where: { slug: "northstar-studio" } });

  const passwordHash = await bcrypt.hash("demo1234", 10);

  const company = await prisma.company.create({
    data: {
      name: "Northstar Studio",
      slug: "northstar-studio",
      industry: "Trade fairs & exhibitions",
      website: "https://northstar.studio",
      timezone: "Europe/Warsaw",
      currency: "PLN",
      aiContext:
        "Northstar Studio helps B2B manufacturers and exhibitors turn trade-fair presence into a predictable lead pipeline. We sell done-for-you booth lead capture, follow-up campaigns and acquisition retainers. Tone: confident, concise, consultative — never spammy. Ideal customers: mid-size Polish manufacturers (50–500 staff) exhibiting at industry fairs.",
    },
  });

  const owner = await prisma.user.create({
    data: {
      email: "owner@northstar.studio",
      name: "Marcin",
      passwordHash,
      role: "OWNER",
      companyId: company.id,
    },
  });

  const member = await prisma.user.create({
    data: {
      email: "weronika@northstar.studio",
      name: "Weronika",
      passwordHash,
      role: "MEMBER",
      companyId: company.id,
    },
  });

  // Funnel stages
  await prisma.funnelStage.createMany({
    data: STAGES.map((s) => ({
      name: s.name,
      order: s.order,
      probability: s.probability,
      color: s.color,
      isWon: s.isWon ?? false,
      isLost: s.isLost ?? false,
      companyId: company.id,
    })),
  });
  const stages = await prisma.funnelStage.findMany({ where: { companyId: company.id } });
  const stageByName = new Map(stages.map((s) => [s.name, s.id]));

  // Offers (value ladder)
  const offers = await Promise.all([
    prisma.offer.create({
      data: {
        companyId: company.id, name: "Booth Lead Engine", tier: 1, priceFrom: 4000, priceCurrency: "PLN",
        summary: "Capture and qualify every booth visitor automatically.",
        description: "QR-based lead capture, instant scoring and same-day follow-up for a single trade fair.",
        deliverables: ["Lead capture setup", "Real-time scoring", "Same-day follow-up sequence", "Post-show report"],
      },
    }),
    prisma.offer.create({
      data: {
        companyId: company.id, name: "Full-Funnel Expo Campaign", tier: 2, priceFrom: 12000, priceCurrency: "PLN",
        summary: "Pre-show, at-show and post-show campaign that books meetings.",
        description: "End-to-end campaign covering audience building, outreach, booth capture and nurture.",
        deliverables: ["Audience research", "Pre-show outreach", "At-show capture", "30-day nurture", "Meeting booking"],
      },
    }),
    prisma.offer.create({
      data: {
        companyId: company.id, name: "Done-For-You Acquisition Retainer", tier: 3, priceFrom: 30000, priceCurrency: "PLN",
        summary: "We run your entire trade-fair acquisition engine, monthly.",
        description: "A managed retainer: multi-fair strategy, content, outreach and a dedicated acquisition manager.",
        deliverables: ["Quarterly strategy", "Multi-channel outreach", "Dedicated manager", "Monthly reporting", "CRM management"],
      },
    }),
  ]);

  // Audiences
  const [audManufacturers, audFirstTimers, audServiceFirms] = await Promise.all([
    prisma.audience.create({
      data: {
        companyId: company.id, name: "Mid-size manufacturers", industry: "Manufacturing", companySize: "50–500",
        region: "Poland", description: "Established manufacturers exhibiting at industry fairs.",
        painPoints: ["Booth traffic doesn't convert", "Slow follow-up", "No attribution"],
      },
    }),
    prisma.audience.create({
      data: {
        companyId: company.id, name: "First-time exhibitors", industry: "Various", companySize: "10–100",
        region: "Poland", description: "Companies exhibiting for the first time and unsure how to capture ROI.",
        painPoints: ["No process", "Limited team", "Fear of wasted spend"],
      },
    }),
    prisma.audience.create({
      data: {
        companyId: company.id, name: "B2B service firms", industry: "Professional services", companySize: "10–200",
        region: "Poland", description: "Agencies and B2B service providers attending trade fairs to win clients.",
        painPoints: ["Thin pipeline", "Ad-hoc outreach", "No nurture system"],
      },
    }),
  ]);
  void audServiceFirms;

  // Segments
  await prisma.segment.createMany({
    data: [
      { companyId: company.id, name: "Hot inbound", color: "#16a34a", description: "Inbound leads scoring B or above." },
      { companyId: company.id, name: "Re-engage", color: "#f59e0b", description: "Leads with no contact in 14+ days." },
    ],
  });

  // Templates
  await prisma.template.createMany({
    data: [
      {
        companyId: company.id, name: "Intro email — manufacturers", kind: "EMAIL", channel: "EMAIL",
        subject: "A quick idea for {{company}}’s next fair",
        body: "Hi {{name}},\n\nI noticed {{company}} is exhibiting this season. Most manufacturers capture plenty of booth traffic but lose 60–70% of it to slow follow-up.\n\nWe set up automatic capture + same-day follow-up so your team only talks to qualified buyers. Worth a 15-minute look?\n\nBest,\nMarcin",
        variables: ["name", "company"], tags: ["outreach", "manufacturing"], isFavorite: true, usageCount: 24,
      },
      {
        companyId: company.id, name: "Follow-up — no reply", kind: "FOLLOW_UP", channel: "EMAIL",
        subject: "Re: {{company}} — still worth a look?",
        body: "Hi {{name}},\n\nJust floating this back to the top of your inbox. If capturing more qualified leads from your next fair is on the radar, I can share a one-page plan tailored to {{company}}.\n\nShould I send it over?\n\nMarcin",
        variables: ["name", "company"], tags: ["follow-up"], usageCount: 41,
      },
      {
        companyId: company.id, name: "LinkedIn DM — opener", kind: "DM", channel: "LINKEDIN",
        body: "Hi {{name}} — saw {{company}} will be at the fair. We help exhibitors turn booth traffic into booked meetings without adding headcount. Open to a quick idea?",
        variables: ["name", "company"], tags: ["linkedin"], usageCount: 33,
      },
      {
        companyId: company.id, name: "Ad — retargeting", kind: "AD", channel: "FACEBOOK",
        body: "Exhibiting soon? Don't let 70% of your booth leads go cold. Northstar sets up capture + instant follow-up so you close more from the same floor traffic. → Book a 15-min call.",
        variables: [], tags: ["ads", "retargeting"],
      },
    ],
  });

  // Leads + scores + activities + notes
  const createdLeads: { id: string; name: string; score: number; stage: string; outcome: LeadOutcome }[] = [];
  for (const spec of LEADS) {
    const createdAt = daysAgo(spec.createdDaysAgo);
    const lastContactedAt = spec.lastContactedDays != null ? daysAgo(spec.lastContactedDays) : null;
    const expectedCloseAt = spec.closeInDays != null ? daysFromNow(spec.closeInDays) : null;
    const outcome = spec.outcome ?? "OPEN";

    const sc = scoreLead({
      source: spec.source, priority: spec.priority, outcome,
      budget: spec.budget ?? null, estimatedValue: spec.estimatedValue ?? null,
      email: spec.email, phone: spec.phone ?? null, companyName: spec.companyName,
      industry: spec.industry, lastContactedAt, expectedCloseAt, createdAt,
    });

    const lead = await prisma.lead.create({
      data: {
        companyId: company.id,
        name: spec.name, email: spec.email, phone: spec.phone, position: spec.position,
        companyName: spec.companyName, industry: spec.industry, region: spec.region,
        source: spec.source, priority: spec.priority, outcome,
        budget: spec.budget, estimatedValue: spec.estimatedValue,
        expectedCloseAt, lastContactedAt,
        score: sc.score, scoreGrade: sc.grade,
        nextActionAt: outcome === "OPEN" ? daysFromNow(Math.max(1, 3 - (spec.lastContactedDays ?? 3))) : null,
        nextActionNote: outcome === "OPEN" ? "Follow up on last conversation" : null,
        tags: spec.tags ?? [],
        stageId: stageByName.get(spec.stage),
        ownerId: spec.createdDaysAgo % 3 === 0 ? member.id : owner.id,
        createdAt,
      },
    });

    await prisma.leadScore.create({
      data: {
        companyId: company.id, leadId: lead.id,
        score: sc.score, grade: sc.grade, breakdown: sc.breakdown, reason: sc.reason,
        createdAt,
      },
    });

    // Activities
    await prisma.leadActivity.create({
      data: {
        companyId: company.id, leadId: lead.id, userId: owner.id,
        type: "SYSTEM", title: "Lead created", body: `Captured from ${spec.source.toLowerCase().replace("_", " ")}.`,
        createdAt,
      },
    });
    if (lastContactedAt) {
      await prisma.leadActivity.create({
        data: {
          companyId: company.id, leadId: lead.id, userId: owner.id,
          type: pick(["EMAIL", "CALL", "MEETING"], spec.createdDaysAgo) as "EMAIL" | "CALL" | "MEETING",
          title: "Touchpoint logged", body: "Discussed scope and next steps.",
          createdAt: lastContactedAt,
        },
      });
    }

    if (spec.note) {
      await prisma.note.create({
        data: {
          companyId: company.id, leadId: lead.id, authorId: owner.id,
          body: spec.note, pinned: sc.score >= 75, createdAt: lastContactedAt ?? createdAt,
        },
      });
    }

    createdLeads.push({ id: lead.id, name: lead.name, score: sc.score, stage: spec.stage, outcome });
  }

  // Tasks
  const negLeads = createdLeads.filter((l) => l.stage === "Negotiation" || l.stage === "Proposal");
  await prisma.task.createMany({
    data: [
      { companyId: company.id, assigneeId: owner.id, leadId: negLeads[0]?.id, title: `Send contract to ${negLeads[0]?.name ?? "lead"}`, priority: "URGENT", status: "TODO", dueDate: daysAgo(1) },
      { companyId: company.id, assigneeId: owner.id, leadId: negLeads[1]?.id, title: `Follow up on proposal — ${negLeads[1]?.name ?? "lead"}`, priority: "HIGH", status: "TODO", dueDate: daysAgo(2) },
      { companyId: company.id, assigneeId: member.id, leadId: negLeads[2]?.id, title: "Prepare pricing options", priority: "HIGH", status: "IN_PROGRESS", dueDate: new Date() },
      { companyId: company.id, assigneeId: owner.id, title: "Plan next month's outreach batch", priority: "MEDIUM", status: "TODO", dueDate: daysFromNow(2) },
      { companyId: company.id, assigneeId: member.id, title: "Refresh LinkedIn DM template", priority: "LOW", status: "TODO", dueDate: daysFromNow(5) },
      { companyId: company.id, assigneeId: owner.id, leadId: createdLeads[2]?.id, title: "Qualify budget on discovery call", priority: "MEDIUM", status: "DONE", dueDate: daysAgo(4), completedAt: daysAgo(3) },
      { companyId: company.id, assigneeId: owner.id, title: "Review post-show report", priority: "MEDIUM", status: "DONE", dueDate: daysAgo(6), completedAt: daysAgo(6) },
      { companyId: company.id, assigneeId: member.id, leadId: createdLeads[4]?.id, title: "Send case study", priority: "LOW", source: "AI", status: "TODO", dueDate: daysFromNow(1) },
    ],
  });

  // Campaigns + messages
  const campA = await prisma.campaign.create({
    data: {
      companyId: company.id, name: "Q3 Manufacturing Outreach", channel: "MULTI", status: "ACTIVE",
      goal: "Book 15 discovery calls with mid-size manufacturers ahead of the autumn fairs.",
      audienceId: audManufacturers.id, offerId: offers[1].id,
      sentCount: 124, repliedCount: 19, convertedCount: 4,
      startAt: daysAgo(21),
    },
  });
  const campB = await prisma.campaign.create({
    data: {
      companyId: company.id, name: "First-Timer Nurture", channel: "EMAIL", status: "ACTIVE",
      goal: "Educate first-time exhibitors and convert to the Booth Lead Engine.",
      audienceId: audFirstTimers.id, offerId: offers[0].id,
      sentCount: 60, repliedCount: 9, convertedCount: 2,
      startAt: daysAgo(14),
    },
  });

  const msg1 = await prisma.campaignMessage.create({
    data: {
      companyId: company.id, campaignId: campA.id, leadId: negLeads[0]?.id, offerId: offers[1].id,
      kind: "EMAIL", subject: "A quick idea for Stalmont’s next fair",
      body: "Hi Tomasz,\n\nFollowing our chat — here's the one-page plan to turn Stalmont's booth traffic into booked meetings. Can we lock the contract this week so we're set before the autumn fair?\n\nBest,\nMarcin",
      isAiGenerated: true, approved: true, sentAt: daysAgo(2),
    },
  });
  await prisma.campaignMessage.create({
    data: {
      companyId: company.id, campaignId: campB.id, kind: "EMAIL",
      subject: "Exhibiting for the first time?",
      body: "Hi there,\n\nFirst fair can feel like a gamble. Here's how first-time exhibitors capture ROI without a big team…",
      isAiGenerated: true, approved: true, sentAt: daysAgo(5),
    },
  });

  // Pending approvals (the human-in-the-loop queue)
  const draftFor = (i: number) => createdLeads.filter((l) => l.outcome === "OPEN")[i];
  const a1 = draftFor(0), a2 = draftFor(1), a3 = draftFor(2);
  await prisma.approvalRequest.create({
    data: {
      companyId: company.id, requestedById: owner.id, leadId: a1?.id, campaignMessageId: msg1.id,
      type: "AI_MESSAGE", status: "PENDING",
      title: `Follow-up email for ${a1?.name ?? "lead"}`,
      summary: "AI-drafted follow-up ready to send.",
      payload: {
        kind: "EMAIL", channel: "EMAIL",
        subject: `Re: next steps for ${a1?.name ?? "your team"}`,
        body: "Hi,\n\nJust making sure this didn't slip — happy to walk your team through the plan this week. Does Thursday work for a quick 15-minute call?\n\nBest,\nMarcin",
      },
    },
  });
  await prisma.approvalRequest.create({
    data: {
      companyId: company.id, requestedById: member.id, leadId: a2?.id,
      type: "AI_FOLLOWUP", status: "PENDING",
      title: `LinkedIn DM for ${a2?.name ?? "lead"}`,
      summary: "AI-drafted LinkedIn opener.",
      payload: {
        kind: "DM", channel: "LINKEDIN",
        body: `Hi ${a2?.name?.split(" ")[0] ?? "there"} — we help exhibitors turn booth traffic into booked meetings. Saw your team is at the fair this season; open to a quick idea?`,
      },
    },
  });
  await prisma.approvalRequest.create({
    data: {
      companyId: company.id, requestedById: owner.id, leadId: a3?.id,
      type: "AI_AD", status: "PENDING",
      title: "Retargeting ad copy",
      summary: "AI-drafted ad variant for the autumn push.",
      payload: {
        kind: "AD", channel: "FACEBOOK",
        body: "70% of booth leads go cold within 48 hours. Northstar fixes that with instant capture + same-day follow-up. Book a 15-min call →",
      },
    },
  });

  // Notifications for the owner
  const topHot = createdLeads.filter((l) => l.outcome === "OPEN").sort((a, b) => b.score - a.score)[0];
  await prisma.notification.createMany({
    data: [
      { companyId: company.id, userId: owner.id, type: "HOT_LEAD", title: "🔥 Hot lead", body: `${topHot?.name ?? "A lead"} is scoring ${topHot?.score ?? 80}. Reach out today.`, link: topHot ? `/leads/${topHot.id}` : "/leads", read: false },
      { companyId: company.id, userId: owner.id, type: "APPROVAL_PENDING", title: "3 AI drafts awaiting approval", body: "Review and approve to send.", link: "/approvals", read: false },
      { companyId: company.id, userId: owner.id, type: "PERFORMANCE_ALERT", title: "Reply rate dipped", body: "Q3 Manufacturing Outreach reply rate is below your 15% target.", link: "/analytics", read: false },
      { companyId: company.id, userId: owner.id, type: "REPORT_READY", title: "Weekly report ready", body: "Your weekly performance summary is available.", link: "/analytics", read: true },
    ],
  });

  // Metric snapshots — 30 day series
  const metricRows: { companyId: string; key: string; value: number; date: Date }[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = midnight(daysAgo(i));
    const t = (29 - i) / 29; // 0..1 over time
    const noise = (seed: number) => ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1;
    metricRows.push({ companyId: company.id, key: "leads.new", value: Math.round(1 + noise(i + 1) * 4), date });
    metricRows.push({ companyId: company.id, key: "reply.rate", value: Math.round((14 + t * 8 + noise(i + 7) * 6) * 10) / 10, date });
    metricRows.push({ companyId: company.id, key: "pipeline.value", value: Math.round(180000 + t * 240000 + noise(i + 3) * 30000), date });
    metricRows.push({ companyId: company.id, key: "revenue.won", value: Math.round(noise(i + 5) > 0.8 ? 40000 + noise(i) * 20000 : 0), date });
  }
  await prisma.metricSnapshot.createMany({ data: metricRows });

  // Weekly report
  await prisma.report.create({
    data: {
      companyId: company.id, type: "WEEKLY", title: "Weekly performance — this week",
      periodStart: daysAgo(7), periodEnd: new Date(),
      summary:
        "Pipeline grew steadily this week with two deals entering negotiation. Reply rate on the Q3 Manufacturing Outreach dipped slightly below target — consider refreshing the follow-up angle. Three AI drafts are awaiting approval.",
      data: { newLeads: 6, hotLeads: createdLeads.filter((l) => l.score >= 75).length, deltaPipeline: 42000 },
    },
  });

  // AI decision log (audit trail)
  await prisma.aiDecisionLog.createMany({
    data: [
      { companyId: company.id, userId: owner.id, actionType: "GENERATE_MESSAGE", status: "FALLBACK", provider: "mock", promptKey: "email", inputSummary: "Follow-up for Stalmont", relatedLeadId: negLeads[0]?.id },
      { companyId: company.id, userId: member.id, actionType: "GENERATE_FOLLOWUP", status: "FALLBACK", provider: "mock", promptKey: "dm", inputSummary: "LinkedIn opener" },
      { companyId: company.id, userId: owner.id, actionType: "SCORE_LEAD", status: "SUCCESS", provider: "rules", inputSummary: "Recomputed score" },
      { companyId: company.id, userId: owner.id, actionType: "COPILOT_QUERY", status: "FALLBACK", provider: "mock", inputSummary: "What should I focus on today?" },
    ],
  });

  // Integrations
  await prisma.integration.createMany({
    data: [
      { companyId: company.id, type: "AI_PROVIDER", provider: "openai", status: "DISCONNECTED" },
      { companyId: company.id, type: "EMAIL", provider: "smtp", status: "DISCONNECTED" },
      {
        companyId: company.id,
        type: "WEBHOOK",
        provider: "inbound-capture",
        status: "CONNECTED",
        config: { token: "demo-ingest-token", autoDraft: true },
      },
    ],
  });

  // --- Acquisition Autopilot ---
  await prisma.acquisitionSettings.create({
    data: {
      companyId: company.id,
      enabled: true,
      cadenceMinutes: 60,
      dailyLeadCap: 25,
      targetPerDay: 10,
      perRunBatch: 5,
      autoDraftInbound: true,
      autoDraftOutbound: true,
      autoEnroll: true,
      enrichLeads: true,
      channels: ["EMAIL", "LINKEDIN"],
      quietHoursStart: 21,
      quietHoursEnd: 7,
    },
  });

  // Default 4-touch cadence (intro → bump → LinkedIn → break-up).
  const sequence = await prisma.sequence.create({
    data: {
      companyId: company.id,
      name: "Default outbound cadence",
      description: "4-touch cold sequence. Every step is drafted into Approvals — nothing sends automatically.",
      channel: "MULTI",
      active: true,
      isDefault: true,
      offerId: offers[0].id,
      audienceId: audManufacturers.id,
      steps: {
        create: [
          { order: 1, dayOffset: 0, channel: "EMAIL", kind: "EMAIL", name: "Intro email", prompt: "First-touch cold email. Open with relevance to their context/signals, one specific value point, soft CTA. Under 110 words." },
          { order: 2, dayOffset: 2, channel: "EMAIL", kind: "FOLLOW_UP", name: "Value bump", prompt: "Short follow-up. One new proof point, single soft CTA. Under 60 words." },
          { order: 3, dayOffset: 3, channel: "LINKEDIN", kind: "DM", name: "LinkedIn touch", prompt: "Friendly LinkedIn DM, same value point, one qualifying question." },
          { order: 4, dayOffset: 4, channel: "EMAIL", kind: "FOLLOW_UP", name: "Break-up", prompt: "Polite break-up email. Leave the door open. Under 70 words." },
        ],
      },
    },
  });

  // Enroll a few open outbound leads so the cadence has something to advance.
  const enrollable = createdLeads.filter((l) => l.outcome === "OPEN").slice(0, 4);
  if (enrollable.length) {
    await prisma.sequenceEnrollment.createMany({
      data: enrollable.map((l, i) => ({
        companyId: company.id,
        sequenceId: sequence.id,
        leadId: l.id,
        status: "ACTIVE" as const,
        currentStep: i === 0 ? 1 : 0,
        // First one is mid-cadence; the rest are due now so the first run drafts them.
        nextRunAt: i === 0 ? daysFromNow(1) : daysAgo(0),
        startedAt: daysAgo(i),
      })),
    });
  }

  // A little run history so the autopilot feed isn't empty on first load.
  await prisma.acquisitionRun.createMany({
    data: [
      {
        companyId: company.id, trigger: "CRON", status: "SUCCESS",
        discovered: 5, created: 4, deduped: 1, enriched: 3, drafted: 2, enrolled: 4, advanced: 2, hotDetected: 1,
        durationMs: 1840, createdAt: daysAgo(1),
        detail: { providers: ["mock"], live: false, perAudience: [{ audience: "Mid-size manufacturers", found: 5, created: 4, deduped: 1 }] },
      },
      {
        companyId: company.id, trigger: "CRON", status: "SKIPPED",
        durationMs: 12, createdAt: daysAgo(1),
        detail: { reason: "cadence: 41m to next run" },
      },
    ],
  });


  // --- Lead Finder demo: local businesses with phone numbers + call history ---
  const noSiteLead = await prisma.lead.create({
    data: {
      companyId: company.id, ownerId: owner.id,
      name: "Fryzjer Z\u0142ote No\u017cyczki", companyName: "Fryzjer Z\u0142ote No\u017cyczki",
      phone: "+48 512 304 776", industry: "fryzjer", region: "Warszawa",
      source: "GOOGLE_MAPS", sourceDetail: "Google Places",
      priority: "HIGH", score: 62, scoreGrade: "B",
      stageId: stageByName.get("Contacted"),
      tags: ["local-business", "no-website"],
      hasWebsite: false, callStatus: "INTERESTED", callAttempts: 2,
      lastCallAt: daysAgo(1), lastContactedAt: daysAgo(1),
      nextActionAt: daysFromNow(2), nextActionNote: "Send the offer they asked for, then call Friday",
      createdAt: daysAgo(4),
    },
  });
  await prisma.callLog.createMany({
    data: [
      { companyId: company.id, leadId: noSiteLead.id, userId: owner.id, status: "NO_ANSWER", createdAt: daysAgo(3) },
      {
        companyId: company.id, leadId: noSiteLead.id, userId: owner.id, status: "INTERESTED",
        note: "Spoke with the owner \u2014 no website, books everything by phone. Very interested in a simple site with online booking. Send offer by SMS/email, call back Friday.",
        durationSec: 380, nextCallAt: daysFromNow(2), createdAt: daysAgo(1),
      },
    ],
  });

  const weakSiteLead = await prisma.lead.create({
    data: {
      companyId: company.id, ownerId: member.id,
      name: "Auto-Serwis Perfekt", companyName: "Auto-Serwis Perfekt",
      phone: "+48 604 118 392", website: "http://autoserwisperfekt.com.pl",
      industry: "mechanik samochodowy", region: "Warszawa",
      source: "GOOGLE_MAPS", sourceDetail: "Google Places",
      priority: "MEDIUM", score: 48, scoreGrade: "C",
      stageId: stageByName.get("New"),
      tags: ["local-business", "modernization"],
      hasWebsite: true, auditScore: 31, callStatus: "NOT_CALLED",
      nextActionAt: daysFromNow(0), nextActionNote: "Call with audit findings (site loads 8.4s, no HTTPS)",
      createdAt: daysAgo(2),
    },
  });
  await prisma.websiteAudit.create({
    data: {
      companyId: company.id, leadId: weakSiteLead.id,
      url: "http://autoserwisperfekt.com.pl", reachable: true, https: false,
      mobileFriendly: false, performance: 24, seo: 41, overall: 31, loadTimeMs: 8400,
      issues: [
        "Page takes 8.4s to load on mobile",
        "No HTTPS \u2014 browsers flag the site as 'Not secure'",
        "Not mobile-friendly (no responsive viewport)",
      ],
      opportunities: [
        "Speed optimisation \u2014 visitors leave after ~3s",
        "SSL certificate + secure redesign",
        "Responsive redesign \u2014 most local searches are mobile",
      ],
      summary:
        "Website health 31/100 \u00b7 responds in 8.4s \u00b7 NO HTTPS \u00b7 not mobile-friendly. Key problems: page takes 8.4s to load on mobile; no HTTPS; not mobile-friendly.",
      provider: "heuristic", createdAt: daysAgo(2),
    },
  });

  // --- Social Studio demo posts ---
  await prisma.socialPost.createMany({
    data: [
      {
        companyId: company.id, channel: "FACEBOOK", kind: "AD",
        title: "36% of local businesses still have no website",
        body: "Your customers are searching on Google right now \u2014 and finding your competitors.\n\nWe build fast, mobile-first websites for local businesses in 7 days, with online booking included.",
        cta: "Send message", link: "https://northstar.studio", hashtags: ["#stronywww", "#ma\u0142afirma"],
        status: "PUBLISHED", publishedAt: daysAgo(1), externalId: "sim_fb_demo1",
        meta: { simulated: true }, createdAt: daysAgo(1),
      },
      {
        companyId: company.id, channel: "INSTAGRAM", kind: "POST",
        title: "Before / after: from 9s load time to 0.8s",
        body: "Slow websites lose customers. This week we rebuilt a local auto shop's site \u2014 Google PageSpeed went from 24 to 96.",
        hashtags: ["#webdesign", "#beforeafter", "#lokalnybiznes", "#www"],
        status: "DRAFT", createdAt: daysAgo(0),
      },
    ],
  });

  const counts = {
    leads: createdLeads.length + 2,
    hot: createdLeads.filter((l) => l.score >= 75).length,
    won: createdLeads.filter((l) => l.outcome === "WON").length,
  };
  console.log(`✓ Seeded Northstar Studio: ${counts.leads} leads (${counts.hot} hot, ${counts.won} won)`);
  console.log("✓ Login →  owner@northstar.studio  /  demo1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
