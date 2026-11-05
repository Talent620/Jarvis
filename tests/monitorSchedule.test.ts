// Real durable store and IANA timezone calculations; controlled clock/source, not real-time waiting.
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { createGoalService, nextScheduledAt, normalizeSchedule } = require('../electron/goal-service.cjs');
const zone = 'Europe/Warsaw';
const next = (schedule: any, after: string) => new Date(nextScheduledAt(normalizeSchedule(schedule), Date.parse(after), zone)).toISOString();
let directory: string | undefined, service: any;
afterEach(async () => { await service?.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });
describe('calendar checks in existing durable runtime', () => {
  it('skips the missing Warsaw spring hour rather than inventing another execution time', () => {
    expect(next({ kind: 'daily', time: '02:30' }, '2026-03-28T02:00:00Z')).toBe('2026-03-30T00:30:00.000Z');
    expect(next({ kind: 'weekly', weekdays: [0], time: '02:30' }, '2026-03-28T02:00:00Z')).toBe('2026-04-05T00:30:00.000Z');
  });
  it('executes the repeated Warsaw autumn time once, at its first occurrence', () => {
    const schedule = { kind: 'daily', time: '02:30' };
    expect(next(schedule, '2026-10-24T23:00:00Z')).toBe('2026-10-25T00:30:00.000Z');
    expect(next(schedule, '2026-10-25T00:30:00Z')).toBe('2026-10-26T01:30:00.000Z');
    expect(next(schedule, '2026-10-25T01:00:00Z')).toBe('2026-10-26T01:30:00.000Z');
  });
  it('preserves monthly day boundaries and rejects empty or invalid schedules', () => {
    expect(next({ kind: 'monthly', day: 31, time: '09:00' }, '2026-01-31T08:00:00Z')).toBe('2026-03-31T07:00:00.000Z');
    expect(() => normalizeSchedule({ kind: 'weekly', weekdays: [], time: '09:00' })).toThrow();
    expect(() => normalizeSchedule({ kind: 'monthly', day: 0, time: '09:00' })).toThrow();
    expect(() => normalizeSchedule({ kind: 'daily', time: '25:01' })).toThrow();
  });
  it('persists the schedule, catches up once after restart and preserves STOP without replacing interval grants', async () => {
    directory = await mkdtemp(join(tmpdir(), 'jarvis-calendar-'));
    let now = Date.parse('2026-11-05T07:00:00Z'), reads = 0;
    const options = { directory, now: () => now, fetch: async () => { reads++; return { status: 200, headers: { get: () => 'application/json' }, text: async () => '{"items":[]}' }; } };
    service = createGoalService(options);
    const source = { kind: 'json', url: 'https://example.org/calendar-feed' };
    const grant = await service.command({ action: 'grant', source }, { trustedUserAction: true });
    const goal = await service.command({ action: 'create', title: 'Regularny odczyt', originalCommand: 'Sprawdzaj cennik w poniedziałki o 09:00', source, criteria: { contains: '*' }, intervalMs: 60000, schedule: { kind: 'weekly', weekdays: [1], time: '09:00' } });
    expect(goal.grantId).toBe(grant.id); expect(new Date(goal.nextCheckAt).toISOString()).toBe('2026-11-09T08:00:00.000Z');
    await service.tick(); expect(reads).toBe(0); await service.stop();
    now = Date.parse('2026-12-01T08:00:00Z'); service = createGoalService(options); await service.tick(); await service.tick();
    expect(reads).toBe(1);
    let saved = (await service.command({ action: 'list' })).goals[0];
    expect(saved.lastResult).toBe('NO_MATCH'); expect(new Date(saved.nextCheckAt).toISOString()).toBe('2026-12-07T08:00:00.000Z');
    await service.command({ action: 'stop_all' }); now += 60 * 86400000; await service.tick();
    saved = (await service.command({ action: 'list' })).goals[0]; expect(saved.state).toBe('CANCELLED'); expect(reads).toBe(1);
  });
});
