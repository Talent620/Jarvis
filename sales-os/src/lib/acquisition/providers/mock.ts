import type { LeadSource } from "@prisma/client";
import type { ProspectCandidate, ProspectingProvider, ProspectQuery } from "./types";

const FIRST = [
  "Anna", "Piotr", "Katarzyna", "Marek", "Magdalena", "Tomasz", "Agnieszka",
  "Paweł", "Joanna", "Krzysztof", "Ewa", "Michał", "Karolina", "Jakub",
  "Natalia", "Grzegorz", "Aleksandra", "Łukasz", "Monika", "Bartosz",
];
const LAST = [
  "Nowak", "Kowalski", "Wiśniewski", "Wójcik", "Kowalczyk", "Kamiński",
  "Lewandowski", "Zieliński", "Szymański", "Woźniak", "Dąbrowski", "Mazur",
  "Krawczyk", "Piotrowski", "Grabowski", "Pawłowski", "Michalski", "Adamczyk",
];
const ROLES = [
  "Owner", "Managing Director", "Head of Operations", "Procurement Manager",
  "Marketing Lead", "Founder", "Commercial Director", "Plant Manager",
  "Head of Sales", "CEO", "VP Marketing", "Business Development Manager",
];
const SENIOR = new Set(["Owner", "Founder", "CEO", "Managing Director", "Commercial Director", "VP Marketing"]);
const STEMS = ["Nordic", "Vertex", "Aurora", "Helios", "Atlas", "Lumen", "Forge", "Cobalt", "Meridian", "Kappa", "Solstice", "Orbital"];
const SUFFIX = ["Group", "Sp. z o.o.", "Studio", "Works", "Industries", "Partners", "Labs", "Systems"];
const REGIONS = ["Warszawa", "Kraków", "Wrocław", "Poznań", "Gdańsk", "Katowice", "Łódź", "Rzeszów", "Lublin", "Szczecin"];
const SIZES = ["10–50", "50–200", "200–500", "500–1000"];
const SIGNALS = [
  "Hiring sales staff",
  "Exhibiting at an upcoming fair",
  "Recently expanded headcount",
  "New product launch",
  "Active on LinkedIn",
  "Visited pricing page",
  "Recent funding round",
  "Opened a new location",
];
const CHANNELS: LeadSource[] = ["COLD_OUTREACH", "LINKEDIN", "MARKETPLACE", "FACEBOOK_GROUP"];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

/**
 * Deterministic-ish synthetic prospects derived from the ICP. Lets the outbound
 * engine work end-to-end with zero configuration; clearly marked as samples so
 * nobody mistakes them for real data until a provider key is added. Now emits
 * company size, buying-intent signals, a channel and a coarse intent score so
 * the autopilot has something realistic to prioritise and enrich.
 */
export const mockProvider: ProspectingProvider = {
  name: "mock",
  live: false,
  async search(q: ProspectQuery): Promise<ProspectCandidate[]> {
    const industry = q.industry?.trim() || "Professional services";
    const out: ProspectCandidate[] = [];
    const base = Date.now();

    for (let i = 0; i < q.limit; i++) {
      const s = base + i * 97;
      const first = pick(FIRST, s);
      const last = pick(LAST, Math.floor(s / 7));
      const stem = `${pick(STEMS, s)} ${pick(SUFFIX, Math.floor(s / 3))}`;
      const domain = `${slugify(stem)}.pl`;
      const role = pick(ROLES, s);

      const sigCount = s % 3 === 0 ? 0 : s % 2 === 0 ? 1 : 2;
      const signals: string[] = [];
      for (let k = 0; k < sigCount; k++) signals.push(pick(SIGNALS, s + k * 31));

      const intentScore = Math.min(
        100,
        20 + signals.length * 22 + (SENIOR.has(role) ? 18 : 0) + (i % 5 === 0 ? 12 : 0),
      );

      out.push({
        name: `${first} ${last}`,
        email: `${slugify(first)}.${slugify(last)}@${domain}`,
        companyName: stem,
        position: role,
        website: `https://${domain}`,
        industry,
        region: q.region?.trim() || pick(REGIONS, s),
        companySize: q.companySize?.trim() || pick(SIZES, s),
        signals,
        intentScore,
        source: pick(CHANNELS, s),
        sourceDetail: "Mock prospecting (sample data — add APOLLO_API_KEY or HUNTER_API_KEY for real sourcing)",
      });
    }
    return out.sort((a, b) => (b.intentScore ?? 0) - (a.intentScore ?? 0));
  },
};
