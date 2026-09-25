// Append-only task journal (mission 5.1), stored outside the store blob. Only durable events
// (task, action and consent lifecycle) are written; speech partials and observations never are.

import Dexie, { type Table } from "dexie";
import type { KernelEvent } from "./events";

export interface TaskJournal {
  append(events: KernelEvent[]): Promise<void>;
  load(): Promise<KernelEvent[]>;
  clear(): Promise<void>;
}

/** In-memory journal for tests and environments without IndexedDB. */
export class MemoryJournal implements TaskJournal {
  readonly events: KernelEvent[] = [];
  appendCalls = 0;
  failNext = false;
  async append(events: KernelEvent[]): Promise<void> {
    this.appendCalls++;
    if (this.failNext) { this.failNext = false; throw new Error("journal write failed"); }
    this.events.push(...events.map((e) => structuredCloneSafe(e)));
  }
  async load(): Promise<KernelEvent[]> {
    return this.events.map((e) => structuredCloneSafe(e));
  }
  async clear(): Promise<void> {
    this.events.length = 0;
  }
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

interface JournalRow {
  seq?: number;
  at: number;
  taskId: string;
  event: KernelEvent;
}

class RuntimeDB extends Dexie {
  events!: Table<JournalRow, number>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ events: "++seq, taskId, at" });
  }
}

const taskIdOf = (e: KernelEvent): string => ("taskId" in e && typeof e.taskId === "string" ? e.taskId : "");

/** IndexedDB journal (Dexie), in its own database so it never touches the store blob. */
export class DexieJournal implements TaskJournal {
  private db: RuntimeDB;
  constructor(name = "jarvis-runtime", private readonly maxEvents = 5000) {
    this.db = new RuntimeDB(name);
  }
  async append(events: KernelEvent[]): Promise<void> {
    if (!events.length) return;
    await this.db.events.bulkAdd(events.map((event) => ({ at: event.at, taskId: taskIdOf(event), event })));
    const count = await this.db.events.count();
    if (count > this.maxEvents * 1.2) {
      const excess = count - this.maxEvents;
      const oldest = await this.db.events.orderBy("seq").limit(excess).primaryKeys();
      await this.db.events.bulkDelete(oldest);
    }
  }
  async load(): Promise<KernelEvent[]> {
    const rows = await this.db.events.orderBy("seq").toArray();
    return rows.map((r) => r.event);
  }
  async clear(): Promise<void> {
    await this.db.events.clear();
  }
  close(): void {
    this.db.close();
  }
}

export function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}
