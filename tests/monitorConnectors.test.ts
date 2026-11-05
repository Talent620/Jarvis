// Controlled local HTTP contracts, real transport/encrypted files/runtime. Not a live provider test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { createMonitorConnectors, baseUrl, request } = require('../electron/monitor-connectors.cjs');
const { createGoalService } = require('../electron/goal-service.cjs');
const owner = { trustedUserAction: true };
const watchId = 'b8266333-03c2-4231-9c03-9870f2303c8b';
let directory: string, endpoint: string, now: number, server: Server, connectors: any, runtime: any;
let snapshot: string, sourceStatus: number, notifyStatus: number, disconnect: boolean;
let holdPost: boolean, onPost: (() => void) | undefined;
let holdMeta: boolean, onMeta: (() => void) | undefined;
let reads: string[], posts: any[], seenHeaders: Array<Record<string, unknown>>;
const vaultKey = randomBytes(32), token = randomBytes(30).toString('hex'), topic = 'owner-controlled-fixture';
const vault = {
  encrypt(value: string) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', vaultKey, iv); return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]); },
  decrypt(value: Buffer) { const decipher = createDecipheriv('aes-256-gcm', vaultKey, value.subarray(0,12)); decipher.setAuthTag(value.subarray(-16)); return Buffer.concat([decipher.update(value.subarray(12,-16)), decipher.final()]).toString('utf8'); },
};
const configure = (kind = 'changedetection', overrides = {}) => connectors.configure({ kind, label: `Controlled ${kind}`, baseUrl: endpoint, allowLocal: true, token, ...(kind === 'ntfy' ? { topic, publicTopicConsent: true } : {}), ...overrides }, owner);
const createMonitor = async (notification = true) => {
  const cd = await configure(), ntfy = notification ? await configure('ntfy') : null;
  const source = { kind: 'changedetection', connectorId: cd.id, watchId };
  await runtime.command({ action: 'grant', source, ...(ntfy ? { ntfyNotification: ntfy.id } : {}) }, owner);
  const goal = await runtime.command({ action: 'create', title: 'Zmiana cennika', originalCommand: 'Powiadom o zmianie cennika', source, criteria: { contains: '*' }, intervalMs: 60000, stopAfterFirst: false, notification: ntfy ? { ntfy: ntfy.id } : {} });
  return { source, cd, ntfy, goal };
};
const state = () => runtime.command({ action: 'list' });
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'jarvis-connector-contract-'));
  now = Date.parse('2026-11-05T13:00:00Z'); snapshot = 'Wersja pierwsza'; sourceStatus = 200; notifyStatus = 200; disconnect = false; holdPost = false; onPost = undefined; holdMeta = false; onMeta = undefined; reads = []; posts = []; seenHeaders = [];
  server = createServer(async (req, res) => {
    seenHeaders.push(req.headers);
    if (req.method === 'POST') {
      let data = ''; for await (const chunk of req) data += chunk;
      posts.push(JSON.parse(data));
      onPost?.(); if (holdPost) return;
      if (disconnect) { req.socket.destroy(); return; }
      res.writeHead(notifyStatus, { 'content-type': 'application/json', 'retry-after': '120' });
      res.end(JSON.stringify({ event: 'message', id: `provider-${posts.length}`, topic })); return;
    }
    reads.push(req.url || '');
    if (sourceStatus !== 200) { res.writeHead(sourceStatus, { location: `${endpoint}escape`, 'retry-after': '120' }); res.end(''); return; }
    if (req.url?.endsWith('/history/latest')) { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(snapshot); return; }
    onMeta?.(); if (holdMeta) return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ title: 'Publiczny cennik', url: 'https://example.org/prices', last_checked: now / 1000 - 120, paused: false, last_error: '' }));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  endpoint = `http://127.0.0.1:${(server.address() as any).port}/`;
  connectors = createMonitorConnectors({ directory, ...vault });
  runtime = createGoalService({ directory, connectors, now: () => now });
});
afterEach(async () => { await runtime?.stop(); server?.closeAllConnections(); if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });

describe('changedetection + ntfy: controlled HTTP contracts, no provider installation', () => {
  it('requires owner configuration, secure vault, separate loopback scope and explicit topic disclosure', async () => {
    await expect(connectors.configure({ kind: 'ntfy', label: 'x', baseUrl: endpoint })).rejects.toThrow(/właściciel/);
    await expect(configure('changedetection', { allowLocal: false })).rejects.toThrow(/osobnej zgody/);
    await expect(configure('ntfy', { publicTopicConsent: false })).rejects.toThrow(/danych alertu/);
    await expect(createMonitorConnectors({ directory }).configure({ kind: 'changedetection', label: 'x', baseUrl: endpoint, allowLocal: true }, owner)).rejects.toThrow(/magazynu/);
    expect(() => baseUrl('https://10.0.0.1')).toThrow();
    expect(() => baseUrl('https://example.org/?token=hidden')).toThrow();
    const config = await configure('ntfy');
    expect(JSON.stringify(await connectors.list())).not.toContain(token);
    expect(JSON.stringify(await connectors.list())).not.toContain(topic);
    const stored = await readFile(join(directory, 'monitor-connectors.enc'));
    expect(stored.toString()).not.toContain(token); expect(stored.toString()).not.toContain(topic);
    expect((await stat(join(directory, 'monitor-connectors.enc'))).mode & 0o777).toBe(0o600);
    expect((await createMonitorConnectors({ directory, ...vault }).list())[0].id).toBe(config.id);
    expect(reads).toEqual([]); expect(posts).toEqual([]);
  });
  it('polls exact watch read-only; persists baseline, then one changed snapshot and ACK across restart', async () => {
    await createMonitor(); await runtime.tick();
    expect((await state()).goals[0]).toMatchObject({ lastResult: 'BASELINE_RECORDED', lastSourceCheckAt: now - 120000 });
    expect((await state()).events).toEqual([]);
    now += 60000; await runtime.tick(); expect((await state()).goals[0].lastResult).toBe('NO_CHANGE');
    await runtime.stop(); runtime = createGoalService({ directory, connectors, now: () => now });
    snapshot = 'Nowa wersja — Zażółć gęślą jaźń'; now += 60000; await runtime.tick();
    let saved = await state(); expect(saved.goals[0].lastResult).toBe('MATCH'); expect(saved.events).toHaveLength(1);
    expect(saved.events[0]).toMatchObject({ state: 'ACCEPTED', channel: 'ntfy', providerId: 'provider-1', readAt: null, deliveredAt: null, sourceCheckedAt: now - 120000 });
    expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ topic }); expect(posts[0].message).toContain(saved.events[0].id);
    expect(reads.every(url => url === `/api/v1/watch/${watchId}` || url === `/api/v1/watch/${watchId}/history/latest`)).toBe(true);
    expect(seenHeaders.some(headers => headers['x-api-key'] === token)).toBe(true);
    expect(seenHeaders.some(headers => headers.authorization === `Bearer ${token}`)).toBe(true);
    now += 60000; await runtime.tick(); expect(posts).toHaveLength(1);
    saved = await state(); expect(JSON.stringify(saved)).not.toContain(token); expect(JSON.stringify(saved)).not.toContain(topic);
    expect((await readFile(join(directory, 'goals-v1.json'), 'utf8'))).not.toContain(snapshot);
  });
  it('refuses another notification connector until separately granted; removal stops future delivery', async () => {
    const { source, ntfy } = await createMonitor();
    const other = await configure('ntfy');
    await expect(runtime.command({ action: 'create', title: 'x', originalCommand: 'x', source, criteria: { contains: '*' }, notification: { ntfy: other.id } })).rejects.toThrow(/zgody/);
    await runtime.tick(); await connectors.remove(ntfy.id, owner); snapshot = 'Zmiana'; now += 60000; await runtime.tick();
    expect(posts).toHaveLength(0); expect((await state()).events[0].state).toBe('BLOCKED');
  });
  it('removing a connector aborts an active metadata GET, discards its result and prevents the snapshot GET', async () => {
    const { cd } = await createMonitor(); holdMeta = true;
    const started = new Promise<void>(resolve => { onMeta = resolve; });
    const pending = runtime.tick(); await started; await connectors.remove(cd.id, owner); await pending;
    expect(reads).toEqual([`/api/v1/watch/${watchId}`]); expect(posts).toEqual([]);
    expect((await state()).goals[0]).toMatchObject({ state: 'WAITING_INPUT', lastError: { code: 'SOURCE_AUTH' }, observations: {} });
  });
  it('fences a revoked connector even after source I/O returned but before goal persistence', async () => {
    const { cd } = await createMonitor();
    await runtime.stop();
    runtime = createGoalService({ directory, now: () => now, connectors: { ...connectors, readSource: async (...args: any[]) => { const result = await connectors.readSource(...args); await connectors.remove(cd.id, owner); return result; } } });
    await runtime.tick();
    expect((await state()).goals[0]).toMatchObject({ state: 'WAITING_INPUT', observations: {} }); expect(posts).toEqual([]);
  });
  it('removing ntfy aborts an already dispatched POST as uncertain and blocks later sends', async () => {
    const { ntfy } = await createMonitor(); await runtime.tick(); snapshot = 'Zmiana'; now += 60000; holdPost = true;
    const started = new Promise<void>(resolve => { onPost = resolve; });
    const pending = runtime.tick(); await started; await connectors.remove(ntfy.id, owner); await pending;
    expect((await state()).events[0]).toMatchObject({ state: 'UNCERTAIN', acceptedAt: null });
    snapshot = 'Kolejna zmiana'; now += 60000; await runtime.tick();
    expect(posts).toHaveLength(1); expect((await state()).events[1].state).toBe('BLOCKED');
  });
  it('retains the same event on explicit 429, honors Retry-After, and retries only known rejection', async () => {
    await createMonitor(); await runtime.tick(); snapshot = 'Zmiana'; now += 60000; notifyStatus = 429; await runtime.tick();
    const event = (await state()).events[0]; expect(event.state).toBe('RETRY');
    expect(event.nextAttemptAt).toBeGreaterThanOrEqual(Date.now() + 118000);
    now = event.nextAttemptAt - 1; await runtime.tick(); expect(posts).toHaveLength(1);
    now += 1; notifyStatus = 200; await runtime.tick();
    expect(posts).toHaveLength(2); expect((await state()).events[0]).toMatchObject({ id: event.id, attempts: 2, state: 'ACCEPTED' });
  });
  it('reports a lost POST acknowledgement as uncertain and never sends it twice', async () => {
    await createMonitor(); await runtime.tick(); snapshot = 'Zmiana'; now += 60000; disconnect = true; await runtime.tick();
    expect((await state()).events[0]).toMatchObject({ state: 'UNCERTAIN', attempts: 1, acceptedAt: null, deliveredAt: null, readAt: null });
    now += 3600000; await runtime.tick(); expect(posts).toHaveLength(1);
  });
  it('STOP aborts an in-flight HTTP notification without claiming to undo its side effect', async () => {
    await createMonitor(); await runtime.tick(); snapshot = 'Zmiana'; now += 60000; holdPost = true;
    const started = new Promise<void>(resolve => { onPost = resolve; });
    const pending = runtime.tick(); await started; await runtime.command({ action: 'stop_all' }); await pending;
    expect((await state()).goals[0].state).toBe('CANCELLED');
    expect((await state()).events[0]).toMatchObject({ state: 'UNCERTAIN', attempts: 1, acceptedAt: null });
    now += 3600000; await runtime.tick(); expect(posts).toHaveLength(1);
  });
  it('rejects private DNS answers for a public endpoint and pins a permitted loopback lookup', async () => {
    const dns = require('node:dns').promises;
    const lookup = vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    try {
      await expect(request('https://public.example.org/')).rejects.toThrow(/nieautoryzowany/);
      expect(reads).toEqual([]); lookup.mockClear();
      const result = await request(endpoint.replace('127.0.0.1', 'localhost'), { allowLocal: true });
      expect(result.status).toBe(200); expect(lookup).toHaveBeenCalledTimes(1); expect(reads).toEqual(['/']);
    } finally { lookup.mockRestore(); }
  });
  it('blocks redirects and unauthorized loopback without sending any follow-up request', async () => {
    const { source } = await createMonitor(false); sourceStatus = 302;
    await runtime.tick(); expect(reads).toEqual([`/api/v1/watch/${watchId}`]);
    expect((await state()).goals[0]).toMatchObject({ state: 'BLOCKED', lastError: { code: 'SOURCE_BLOCKED' } });
    await expect(request(endpoint)).rejects.toThrow(/nieautoryzowany/);
    await connectors.remove(source.connectorId, owner);
    await expect(connectors.readSource(source, { now, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'SOURCE_AUTH', message: 'Dostęp do integracji został odwołany.' });
    expect(posts).toHaveLength(0);
  });
  it('revoked source grant fences a subsequent changed snapshot before any read or POST', async () => {
    const { goal } = await createMonitor(); await runtime.tick(); const count = reads.length;
    await runtime.command({ action: 'revoke', id: goal.grantId }); snapshot = 'Nie wysyłaj'; now += 60000; await runtime.tick();
    expect(reads).toHaveLength(count); expect(posts).toEqual([]); expect((await state()).goals[0].state).toBe('WAITING_APPROVAL');
  });
});
