// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { buildFullPayload, packEncrypted, unpackEncrypted, COLLECTIONS as BACKUP_COLLECTIONS, BACKUP_EXCLUDED, BACKUP_SPECIAL } from "../src/lib/backup";
import { store } from "../src/lib/store";

// Lista wszystkich kluczy AppData (jedno źródło — gdy dojdzie nowa kolekcja, ten test ma ZMUSIĆ
// do świadomej decyzji backupowej: dołożyć do COLLECTIONS, SPECIAL albo EXCLUDED).
const APPDATA_KEYS = [
  "tasks", "notes", "reminders", "shopping", "calendar", "memory", "scenes", "audit",
  "projects", "projectFiles", "tally", "journal", "leads", "flashcards", "bargainWatch",
  "sentMail", "contentPosts", "imageHistory", "siteProjects", "financeProjects", "world",
];

describe("backup — manifest kompletności kolekcji", () => {
  it("każdy klucz AppData jest świadomie sklasyfikowany (kopia / specjalny / wykluczony)", () => {
    const covered = new Set<string>([...BACKUP_COLLECTIONS, ...BACKUP_SPECIAL, ...BACKUP_EXCLUDED] as string[]);
    const missing = APPDATA_KEYS.filter((k) => !covered.has(k));
    expect(missing, `Klucze AppData bez decyzji backupowej:\n${missing.join("\n")}`).toEqual([]);
  });

  it("listy backupu nie nachodzą na siebie", () => {
    const all = [...BACKUP_COLLECTIONS, ...BACKUP_SPECIAL, ...BACKUP_EXCLUDED] as string[];
    expect(all.length).toBe(new Set(all).size);
  });
});

describe("backup — historia rozmów w pełnej kopii (round-trip)", () => {
  it("czaty przeżywają eksport→import (osobny magazyn localStorage)", async () => {
    const { loadChats, saveChats } = await import("../src/lib/chats");
    saveChats([{ id: "c1", title: "Rozmowa", messages: [{ role: "user", text: "cześć" }], updatedAt: 1 } as any]);
    const cipher = await packEncrypted(buildFullPayload(), "h");
    saveChats([]); // wyczyść
    expect(loadChats()).toHaveLength(0);
    await unpackEncrypted(cipher, "h");
    expect(loadChats()[0]?.title).toBe("Rozmowa");
  });
});

describe("backup — World Model w pełnej kopii (round-trip)", () => {
  beforeEach(() => { store.setData((d) => { d.tasks = []; }); });

  it("graf świata przeżywa eksport→import", async () => {
    store.setData((d) => { d.world = { entities: [{ id: "e1", type: "person", name: "Marcin", confidence: 1 }], relations: [], updatedAt: 1 } as any; });
    const cipher = await packEncrypted(buildFullPayload(), "h");
    store.setData((d) => { d.world = undefined; });
    await unpackEncrypted(cipher, "h");
    expect((store.data.world as any)?.entities?.[0]?.name).toBe("Marcin");
  });
});
