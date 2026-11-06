// Controlled service and real durable goal store; never contacts a real seller or provider.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createMonitorConnectors } = require('../electron/monitor-connectors.cjs');
const { createGoalService } = require('../electron/goal-service.cjs');
const uuid = 'b8266333-03c2-4231-9c03-9870f2303c8b';

describe('creating an owner-approved changedetection watch', () => {
  it('records uncertainty after STOP and never sends a duplicate POST after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jarvis-watch-stop-'));
    let postCount = 0;
    let received!: () => void;
    const postReceived = new Promise<void>(resolve => { received = resolve; });
    const server = createServer(async (req, res) => {
      for await (const _chunk of req) { /* consume request */ }
      if (req.method === 'POST') { postCount++; received(); return; }
      res.statusCode = 404; res.end('{}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
    const key = randomBytes(32);
    const vault = {
      encrypt(text: string) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
      decrypt(data: Buffer) { const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(-16)); return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString('utf8'); },
    };
    const options = { directory: root, ...vault, targetLookup: async () => [{ address: '93.184.216.34', family: 4 }] };
    let runtime = createGoalService({ directory: root });
    let connectors = createMonitorConnectors(options);
    try {
      const connection = await connectors.configure({ kind: 'changedetection', label: 'QA', baseUrl: endpoint, allowLocal: true }, { trustedUserAction: true });
      const spec = { connectorId: connection.id, url: 'https://example.org/offers', title: 'QA watch', intervalMs: 60000 };
      const abort = new AbortController();
      const pending = connectors.createWatch(spec, { journal: runtime, taskId: 'task-stop', trustedUserAction: true, signal: abort.signal });
      await postReceived;
      abort.abort();
      expect(await pending).toMatchObject({ ok: false, code: 'WATCH_EFFECT_UNCERTAIN', uncertain: true });
      await runtime.stop();
      runtime = createGoalService({ directory: root });
      connectors = createMonitorConnectors(options);
      expect(await connectors.createWatch(spec, { journal: runtime, taskId: 'task-stop', trustedUserAction: true })).toMatchObject({ ok: false, code: 'WATCH_EFFECT_UNCERTAIN', uncertain: true });
      expect(postCount).toBe(1);
      await expect(connectors.createWatch({ ...spec, intervalMs: 120000 }, { journal: runtime, taskId: 'task-stop', trustedUserAction: true })).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
      expect(postCount).toBe(1);
    } finally { await runtime.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
  });
  it('creates one paused and muted watch, verifies its exact configuration and does not duplicate it after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jarvis-watch-create-'));
    const seen: Array<{ method: string; path: string; body: any }> = []; let watch: any;
    const server = createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      seen.push({ method: req.method || '', path: req.url || '', body: body ? JSON.parse(body) : null });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/api/v1/watch') { watch = JSON.parse(body); res.statusCode = 201; res.end(JSON.stringify({ uuid })); return; }
      if (req.method === 'GET' && req.url === `/api/v1/watch/${uuid}`) { res.end(JSON.stringify({ ...watch, uuid })); return; }
      res.statusCode = 404; res.end('{}');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
    const vaultKey = randomBytes(32);
    const vault = {
      encrypt(text: string) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', vaultKey, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
      decrypt(data: Buffer) { const cipher = createDecipheriv('aes-256-gcm', vaultKey, data.subarray(0,12)); cipher.setAuthTag(data.subarray(-16)); return Buffer.concat([cipher.update(data.subarray(12,-16)), cipher.final()]).toString('utf8'); },
    };
    let runtime = createGoalService({ directory: root });
    let connectors = createMonitorConnectors({ directory: root, ...vault, targetLookup: async () => [{ address: '93.184.216.34', family: 4 }] });
    try {
      const connection = await connectors.configure({ kind: 'changedetection', label: 'QA', baseUrl: endpoint, allowLocal: true }, { trustedUserAction: true });
      const spec = { connectorId: connection.id, url: 'https://example.org/offers', title: 'QA watch', intervalMs: 60000 };
      await expect(connectors.createWatch(spec, { journal: runtime, taskId: 'task-1' })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
      expect(seen).toHaveLength(0);
      const first = await connectors.createWatch(spec, { journal: runtime, taskId: 'task-1', trustedUserAction: true });
      expect(first).toMatchObject({ ok: true, watchId: uuid, verified: true, paused: true, notificationsMuted: true });
      expect(seen[0]).toMatchObject({ method: 'POST', path: '/api/v1/watch', body: { url: spec.url, title: spec.title, paused: true, notification_muted: true, time_between_check: { seconds: 60 }, time_between_check_use_default: false } });
      expect(seen[1]).toMatchObject({ method: 'GET', path: `/api/v1/watch/${uuid}` });
      await runtime.stop(); runtime = createGoalService({ directory: root });
      connectors = createMonitorConnectors({ directory: root, ...vault, targetLookup: async () => [{ address: '93.184.216.34', family: 4 }] });
      const resumed = await connectors.createWatch(spec, { journal: runtime, taskId: 'task-1', trustedUserAction: true });
      expect(resumed).toMatchObject({ ok: true, watchId: uuid, verified: true });
      expect(seen.filter(item => item.method === 'POST')).toHaveLength(1);
      watch.paused = false;
      const changed = await connectors.createWatch(spec, { journal: runtime, taskId: 'task-1', trustedUserAction: true });
      expect(changed).toMatchObject({ ok: false, code: 'WATCH_EFFECT_UNCERTAIN', uncertain: true, watchId: uuid });
      expect(seen.filter(item => item.method === 'POST')).toHaveLength(1);
    } finally { await runtime.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
  });
});
