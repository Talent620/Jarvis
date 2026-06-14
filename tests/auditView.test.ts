import { describe, it, expect } from "vitest";
import { filterAudit, auditStats, inputPreview } from "../src/lib/auditView";
import type { AuditEntry } from "../src/types";

const E = (over: Partial<AuditEntry>): AuditEntry => ({
  id: Math.random().toString(36).slice(2), tool: "x", input: {}, status: "ok", at: Date.now(), ...over,
});

const sample: AuditEntry[] = [
  E({ tool: "add_task", input: { title: "Faktura" }, status: "ok" }),
  E({ tool: "send_email", input: { to: "jan@x.pl" }, status: "denied" }),
  E({ tool: "web_research", input: "pogoda Kraków", output: "błąd sieci", status: "error" }),
];

describe("auditView — podgląd dziennika", () => {
  it("auditStats liczy statusy", () => {
    expect(auditStats(sample)).toEqual({ total: 3, ok: 1, error: 1, denied: 1 });
  });

  it("filterAudit po statusie", () => {
    expect(filterAudit(sample, { status: "denied" }).map((e) => e.tool)).toEqual(["send_email"]);
  });

  it("filterAudit po treści (narzędzie/wejście/wynik)", () => {
    expect(filterAudit(sample, { q: "faktura" })).toHaveLength(1);
    expect(filterAudit(sample, { q: "jan@x.pl" })).toHaveLength(1);
    expect(filterAudit(sample, { q: "błąd" })).toHaveLength(1); // z output
  });

  it("filterAudit bez kryteriów zwraca wszystko", () => {
    expect(filterAudit(sample)).toHaveLength(3);
  });

  it("inputPreview skraca długie i serializuje obiekty", () => {
    expect(inputPreview({ a: 1 })).toBe('{"a":1}');
    expect(inputPreview("x".repeat(200), 10)).toBe("xxxxxxxxxx…");
    expect(inputPreview(null)).toBe("");
  });
});
