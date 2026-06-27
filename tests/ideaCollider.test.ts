import { describe, it, expect } from "vitest";
import { ideaCollider, colliderTopics, dayNumber } from "../src/lib/ideaCollider";
import type { AppData } from "../src/types";

const base = (): AppData => ({
  tasks: [], notes: [], reminders: [], shopping: [], calendar: [], memory: [], scenes: [],
  audit: [], projects: [], projectFiles: [], tally: [], journal: [], leads: [], flashcards: [],
  bargainWatch: [], sentMail: [], contentPosts: [],
});

describe("ideaCollider — topics", () => {
  it("wyłuskuje tematy z projektów, pamięci, leadów, notatek; bez duplikatów", () => {
    const d = base();
    d.projects = [{ id: "1", name: "Sklep rowerowy", instructions: "", createdAt: 0, updatedAt: 0 }];
    d.memory = [{ id: "m", key: "hobby", value: "fotografia" } as any];
    d.leads = [{ id: "l", company: "F", niche: "gastronomia", createdAt: 0, updatedAt: 0, status: "new" } as any];
    d.notes = [{ id: "n", text: "pomysł na aplikację treningową", createdAt: 0 }];
    const tt = colliderTopics(d);
    expect(tt).toContain("Sklep rowerowy");
    expect(tt).toContain("fotografia");
    expect(tt).toContain("gastronomia");
    expect(tt.length).toBe(new Set(tt.map((x) => x.toLowerCase())).size); // bez duplikatów
  });
});

describe("ideaCollider — zderzenie", () => {
  it("przy <2 tematach → null", () => {
    expect(ideaCollider(base(), 0)).toBeNull();
    const d = base();
    d.projects = [{ id: "1", name: "Tylko jeden", instructions: "", createdAt: 0, updatedAt: 0 }];
    expect(ideaCollider(d, 0)).toBeNull();
  });

  it("łączy dwa różne tematy w iskrę (a ≠ b, spark zawiera oba)", () => {
    const d = base();
    d.projects = [
      { id: "1", name: "Kawiarnia", instructions: "", createdAt: 0, updatedAt: 0 },
      { id: "2", name: "Druk 3D", instructions: "", createdAt: 0, updatedAt: 0 },
      { id: "3", name: "Joga", instructions: "", createdAt: 0, updatedAt: 0 },
    ];
    const c = ideaCollider(d, 5)!;
    expect(c).not.toBeNull();
    expect(c.a).not.toBe(c.b);
    expect(c.spark).toContain(c.a);
    expect(c.spark).toContain(c.b);
  });

  it("ten sam dzień → to samo zderzenie; inny dzień → może być inne", () => {
    const d = base();
    d.projects = ["A", "B", "C", "D"].map((n, i) => ({ id: String(i), name: n, instructions: "", createdAt: 0, updatedAt: 0 }));
    expect(ideaCollider(d, 10)).toEqual(ideaCollider(d, 10)); // deterministyczne w dniu
  });
});

describe("ideaCollider — dayNumber", () => {
  it("rośnie o 1 co dobę", () => {
    const t = 1_700_000_000_000;
    expect(dayNumber(t + 86_400_000) - dayNumber(t)).toBe(1);
  });
});
