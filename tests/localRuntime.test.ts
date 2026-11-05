import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error Runtime is standalone Node ESM, intentionally usable without TS compilation.
import { configureRuntime, createRuntime, validateProfile } from '../server/runtime/server.mjs';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function directory() { const dir = await mkdtemp(path.join(tmpdir(), 'jarvis-runtime-')); cleanups.push(() => rm(dir, { recursive: true, force: true })); return dir; }
async function modelServer(options: { delay?: number; remote?: boolean; empty?: boolean; malformed?: boolean; models?: Array<Record<string, unknown>>; tagsDelay?: number; showDelay?: (model: string) => number; metadata?: (model: string) => Record<string, unknown> } = {}) {
  const chats: Array<{ model: string; prompt: string }> = [];
  const requests: Array<{ endpoint: string; model?: string }> = [];
  const sockets = new Set<import('node:net').Socket>();
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    requests.push({ endpoint: req.url || '', model: body.model });
    if (req.url === '/api/tags') {
      if (options.tagsDelay) await new Promise(resolve => setTimeout(resolve, options.tagsDelay));
      return res.end(JSON.stringify({ models: options.models ?? [{ name: 'local-model', details: { format: 'gguf' } }, { name: 'relay', remote_host: 'cloud.example', details: { format: 'gguf' } }] }));
    }
    if (req.url === '/api/show') {
      const delay = options.showDelay?.(body.model);
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      return res.end(JSON.stringify(options.metadata?.(body.model) ?? (options.remote ? { remote_host: 'https://cloud.example', remote_model: 'remote' } : { details: { format: 'gguf' }, model_info: { 'general.architecture': 'llama' } })));
    }
    chats.push({ model: body.model, prompt: body.messages?.at(-1)?.content });
    if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    res.end(options.malformed ? 'invalid' : JSON.stringify({ message: { content: options.empty ? '' : `Odpowiedź ${body.model}: ${body.messages.at(-1).content}` } }));
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>(resolve => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }));
  return { url: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, chats, requests };
}
async function runtime(options: Record<string, unknown> = {}) {
  const dataDir = options.dataDir || await directory();
  const instance = await createRuntime({ dataDir, port: 0, autoDiscover: false, autoProbe: false, ...options });
  cleanups.push(() => instance.close());
  const url = await instance.start();
  const call = async (endpoint: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(url + endpoint, { method, headers: { Authorization: `Bearer ${instance.token}`, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  return { ...instance, url, call, dataDir };
}
async function until(fn: () => Promise<boolean>, limit = 3000) {
  const end = Date.now() + limit;
  while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('condition timed out');
}

describe('local durable runtime', () => {
  it('requires authentication, restricts browser origins and keeps token files private', async () => {
    const app = await runtime();
    expect((await fetch(app.url + '/v1/status')).status).toBe(401);
    expect((await app.call('/v1/status', 'GET', undefined, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await app.call('/v1/status', 'GET', undefined, { Origin: 'null' })).status).toBe(200);
    const status = await app.call('/v1/status');
    expect(status.body.readiness.state).toBe('SETUP');
    expect(status.body.capabilities).toMatchObject({ coding: false, voice: false, processSandbox: false });
    expect(JSON.stringify(status.body)).not.toContain(app.token);
    expect((await stat(path.join(app.dataDir, 'token'))).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(app.dataDir, 'connection.json'))).mode & 0o777).toBe(0o600);
    expect((await app.call('/v1/jobs', 'POST', { prompt: 'test', idempotencyKey: 'missing-model' })).status).toBe(422);
  });

  it('uses actual model requests before READY and expires readiness', async () => {
    const model = await modelServer();
    const app = await runtime({ model: 'local-model', ollamaUrl: model.url, probeTtlMs: 100 });
    expect((await app.call('/v1/status')).body.readiness.state).toBe('NEEDS_ACTION');
    expect((await app.call('/v1/probe', 'POST')).body.readiness.state).toBe('READY');
    expect(model.chats).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 120));
    expect((await app.call('/v1/status')).body.readiness.state).toBe('NEEDS_ACTION');
  });

  it('rejects remote model metadata before any chat request', async () => {
    const model = await modelServer({ remote: true });
    const app = await runtime({ model: 'innocent-name', ollamaUrl: model.url });
    const probe = await app.call('/v1/probe', 'POST');
    expect(probe.body.readiness.state).toBe('DEGRADED');
    expect(probe.body.readiness.reason).toContain('chmury');
    expect(model.chats).toHaveLength(0);
  });

  it('durably finishes submitted tasks independently of the HTTP response and deduplicates concurrent requests', async () => {
    const model = await modelServer({ delay: 70 });
    const app = await runtime({ model: 'local-model', ollamaUrl: model.url });
    const input = { prompt: 'Przeanalizuj plan', idempotencyKey: 'same-request-123' };
    const responses = await Promise.all(Array.from({ length: 4 }, () => app.call('/v1/jobs', 'POST', input)));
    expect(new Set(responses.map(response => response.body.job.id)).size).toBe(1);
    expect(responses.filter(response => response.status === 201)).toHaveLength(1);
    expect((await app.call('/v1/jobs', 'POST', { ...input, prompt: 'Inny cel' })).status).toBe(409);
    await until(async () => (await app.call('/v1/jobs')).body.jobs[0].status === 'completed');
    expect(model.chats).toHaveLength(1);
    const state = JSON.parse(await readFile(path.join(app.dataDir, 'state.json'), 'utf8'));
    expect(state.jobs[0]).toMatchObject({ status: 'completed', result: 'Odpowiedź local-model: Przeanalizuj plan' });
    await app.close();
    const resumed = await runtime({ dataDir: app.dataDir });
    expect((await resumed.call('/v1/jobs', 'POST', input)).body.reused).toBe(true);
    expect(model.chats).toHaveLength(1);
  });

  it('gracefully requeues interrupted analysis on shutdown and resumes it after restart', async () => {
    const model = await modelServer({ delay: 300 });
    const app = await runtime({ model: 'local-model', ollamaUrl: model.url });
    await app.call('/v1/jobs', 'POST', { prompt: 'Praca po restarcie', idempotencyKey: 'restart-request' });
    await until(async () => model.chats.length === 1);
    await app.close();
    const state = JSON.parse(await readFile(path.join(app.dataDir, 'state.json'), 'utf8'));
    expect(state.jobs[0].status).toBe('queued');
    const resumed = await runtime({ dataDir: app.dataDir });
    await until(async () => (await resumed.call('/v1/jobs')).body.jobs[0].status === 'completed');
    expect((await resumed.call('/v1/jobs')).body.jobs[0].attempt).toBe(2);
  });

  it('cancels a running request and never promotes the late response to completed', async () => {
    const model = await modelServer({ delay: 150 });
    const app = await runtime({ model: 'local-model', ollamaUrl: model.url });
    const submitted = await app.call('/v1/jobs', 'POST', { prompt: 'Anuluj', idempotencyKey: 'cancel-request' });
    await until(async () => model.chats.length === 1);
    expect((await app.call(`/v1/jobs/${submitted.body.job.id}/cancel`, 'POST')).body.job.status).toBe('cancelled');
    await new Promise(resolve => setTimeout(resolve, 180));
    expect((await app.call('/v1/jobs')).body.jobs[0].status).toBe('cancelled');
  });

  it('rejects empty real responses and leaves explicit failure evidence', async () => {
    const model = await modelServer({ empty: true });
    const app = await runtime({ model: 'local-model', ollamaUrl: model.url });
    await app.call('/v1/jobs', 'POST', { prompt: 'Pusty wynik', idempotencyKey: 'empty-response' });
    await until(async () => (await app.call('/v1/jobs')).body.jobs[0].status === 'failed');
    expect((await app.call('/v1/jobs')).body.jobs[0].error).toContain('treści');
    expect((await app.call('/v1/status')).body.readiness.state).toBe('DEGRADED');
  });

  it('activates a selected model but pins already accepted work to its original profile', async () => {
    const model = await modelServer({ delay: 80 });
    const app = await runtime({ model: 'first-model', ollamaUrl: model.url });
    await app.call('/v1/jobs', 'POST', { prompt: 'Pierwsze', idempotencyKey: 'pinned-first' });
    await app.call('/v1/jobs', 'POST', { prompt: 'Drugie', idempotencyKey: 'pinned-second' });
    const changed = await app.call('/v1/profile', 'PUT', { model: 'second-model' });
    expect(changed.body.active.model).toBe('second-model');
    expect(changed.body.readiness.state).toBe('NEEDS_ACTION');
    await app.call('/v1/jobs', 'POST', { prompt: 'Trzecie', idempotencyKey: 'pinned-third' });
    await until(async () => (await app.call('/v1/jobs')).body.jobs.every((job: { status: string }) => job.status === 'completed'));
    expect(model.chats.map(item => item.model)).toEqual(['first-model', 'first-model', 'second-model']);
    expect((await app.call('/v1/models')).body.models).toEqual([{ name: 'local-model' }]);
  });

  it('rejects non-loopback configuration and refuses a corrupt state instead of resetting it', async () => {
    expect(() => validateProfile({ ollamaUrl: 'https://external.example' })).toThrow('loopback');
    expect(() => validateProfile({ ollamaUrl: 'http://user:pass@127.0.0.1:11434' })).toThrow('loopback');
    const dir = await directory();
    await writeFile(path.join(dir, 'state.json'), '{broken');
    await expect(createRuntime({ dataDir: dir, port: 0 })).rejects.toThrow('stanu');
    expect(await readFile(path.join(dir, 'state.json'), 'utf8')).toBe('{broken');
  });

  it('refuses a second owner of the same queue', async () => {
    const app = await runtime();
    await expect(createRuntime({ dataDir: app.dataDir, port: 0 })).rejects.toThrow('już korzysta');
    expect((await app.call('/v1/status')).status).toBe(200);
  });

  it('never starts model work when shutdown races the durable running transition', async () => {
    const model = await modelServer();
    const app = await runtime({ model: 'local-model', ollamaUrl: model.url });
    await app.enqueue({ prompt: 'Natychmiast zatrzymaj', idempotencyKey: 'stop-transition' });
    await app.close();
    expect(model.chats).toHaveLength(0);
    const state = JSON.parse(await readFile(path.join(app.dataDir, 'state.json'), 'utf8'));
    expect(state.jobs[0]).toMatchObject({ status: 'queued', attempt: 0 });
  });

  it('fails closed on a tampered recovered endpoint before any model connection', async () => {
    const model = await modelServer();
    const app = await runtime({ model: 'local-model', ollamaUrl: model.url });
    await app.enqueue({ prompt: 'Odzyskaj', idempotencyKey: 'tampered-endpoint' });
    await app.close();
    const file = path.join(app.dataDir, 'state.json');
    const state = JSON.parse(await readFile(file, 'utf8'));
    state.jobs[0].ollamaUrl = 'https://outside.example';
    const original = JSON.stringify(state);
    await writeFile(file, original);
    await expect(createRuntime({ dataDir: app.dataDir })).rejects.toThrow('stan kolejki');
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(model.chats).toHaveLength(0);
  });

  it('elects only one owner while concurrent contenders recover the same dead lock', async () => {
    const dir = await directory();
    await writeFile(path.join(dir, 'runtime.lock'), JSON.stringify({ pid: 2147483647, identity: 'dead-owner' }));
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => createRuntime({ dataDir: dir, port: 0 })));
    const winners = attempts.filter((attempt): attempt is PromiseFulfilledResult<any> => attempt.status === 'fulfilled');
    for (const winner of winners) cleanups.push(() => winner.value.close());
    expect(winners).toHaveLength(1);
  });

  it('recovers a SIGKILL-interrupted process from its durable running record', async () => {
    const model = await modelServer({ delay: 300 });
    const dir = await directory();
    const child = spawn(process.execPath, [path.resolve('server/runtime/cli.mjs'), 'start'], { env: { ...process.env, JARVIS_RUNTIME_DATA_DIR: dir, JARVIS_RUNTIME_MODEL: 'local-model', JARVIS_RUNTIME_OLLAMA_URL: model.url, JARVIS_RUNTIME_PORT: '0', JARVIS_RUNTIME_AUTO_DISCOVER: '0', JARVIS_RUNTIME_AUTO_PROBE: '0' }, stdio: 'ignore' });
    cleanups.push(async () => { if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; } });
    let connection: { url: string; token: string } | undefined;
    await until(async () => { try { connection = JSON.parse(await readFile(path.join(dir, 'connection.json'), 'utf8')); return true; } catch { return false; } });
    const submitted = await fetch(`${connection!.url}/v1/jobs`, { method: 'POST', headers: { Authorization: `Bearer ${connection!.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'Przetrwaj awarię', idempotencyKey: 'kill-recovery-job' }) });
    expect(submitted.status).toBe(201);
    await until(async () => model.chats.length === 1);
    const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
    expect(JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8')).jobs[0].status).toBe('running');
    const recovered = await runtime({ dataDir: dir });
    await until(async () => (await recovered.call('/v1/jobs')).body.jobs[0].status === 'completed');
    expect((await recovered.call('/v1/jobs')).body.jobs[0].attempt).toBe(2);
  });

  it('archives terminal results before removing them and preserves idempotency across restart and crash duplicates', async () => {
    const model = await modelServer();
    const app = await runtime({ model: 'local-model', ollamaUrl: model.url });
    const input = { prompt: 'Zachowaj wynik', idempotencyKey: 'archive-original' };
    await app.call('/v1/jobs', 'POST', input);
    await until(async () => (await app.call('/v1/jobs')).body.jobs[0].status === 'completed');
    const before = await readFile(path.join(app.dataDir, 'state.json'), 'utf8');
    expect((await app.call('/v1/jobs/archive', 'POST')).body).toEqual({ archived: 1, total: 1 });
    expect((await app.call('/v1/jobs')).body.jobs).toHaveLength(0);
    const archivedFiles = await readdir(path.join(app.dataDir, 'archive'));
    expect(archivedFiles).toHaveLength(1);
    expect((await stat(path.join(app.dataDir, 'archive', archivedFiles[0]))).mode & 0o777).toBe(0o600);
    await app.close();
    // Simulate a crash after archive fsync, before removing the old queue entry.
    await writeFile(path.join(app.dataDir, 'state.json'), before);
    const recovered = await runtime({ dataDir: app.dataDir });
    expect((await recovered.call('/v1/jobs', 'POST', input)).body.reused).toBe(true);
    expect((await recovered.call('/v1/jobs/archive', 'POST')).body).toEqual({ archived: 1, total: 1 });
    const replayed = await recovered.call('/v1/jobs', 'POST', input);
    expect(replayed.body).toMatchObject({ reused: true, job: { status: 'completed', result: 'Odpowiedź local-model: Zachowaj wynik' } });
    expect((await recovered.call('/v1/jobs', 'POST', { ...input, prompt: 'Inny prompt' })).status).toBe(409);
    expect(model.chats).toHaveLength(1);
  });

  it('automatically archives completed history at capacity so the 501st task can run', async () => {
    const model = await modelServer();
    const app = await runtime({ model: 'local-model', ollamaUrl: model.url });
    await app.call('/v1/jobs', 'POST', { prompt: 'Szablon', idempotencyKey: 'history-template' });
    await until(async () => (await app.call('/v1/jobs')).body.jobs[0].status === 'completed');
    await app.close();
    const file = path.join(app.dataDir, 'state.json');
    const state = JSON.parse(await readFile(file, 'utf8'));
    state.jobs = Array.from({ length: 500 }, (_, index) => ({ ...state.jobs[0], id: randomUUID(), idempotencyKey: `history-${index}` }));
    await writeFile(file, JSON.stringify(state));
    const recovered = await runtime({ dataDir: app.dataDir });
    expect((await recovered.call('/v1/jobs', 'POST', { prompt: 'Nowe zadanie', idempotencyKey: 'history-new-job' })).status).toBe(201);
    await until(async () => (await recovered.call('/v1/jobs')).body.jobs[0].status === 'completed');
    expect((await recovered.call('/v1/status')).body.archive.count).toBe(500);
    expect((await recovered.call('/v1/jobs', 'POST', { prompt: 'Szablon', idempotencyKey: 'history-499' })).body.reused).toBe(true);
    expect(model.chats).toHaveLength(2);
  });

  it('discovers an installed chat model automatically and only becomes READY after a real response', async () => {
    const model = await modelServer({ delay: 150, models: [
      { name: 'nomic-embed-text', size: 10, details: { format: 'gguf' } },
      { name: 'hidden-relay', size: 20, remote_host: 'cloud.example', details: { format: 'gguf' } },
      { name: 'large-chat', size: 200, details: { format: 'gguf' } },
      { name: 'small-chat', size: 100, details: { format: 'gguf' } },
    ] });
    // undefined leaves the production defaults enabled.
    const app = await runtime({ ollamaUrl: model.url, autoDiscover: undefined, autoProbe: undefined });
    await until(async () => model.chats.length === 1);
    expect((await app.call('/v1/status')).body.readiness).toMatchObject({ state: 'NEEDS_ACTION', inProgress: true });
    await until(async () => (await app.call('/v1/status')).body.readiness.state === 'READY');
    expect((await app.call('/v1/status')).body.readiness.inProgress).toBe(false);
    expect((await app.call('/v1/profile')).body.active.model).toBe('small-chat');
    expect(JSON.parse(await readFile(path.join(app.dataDir, 'profile.json'), 'utf8')).model).toBe('small-chat');
    expect(model.chats).toHaveLength(1);
    expect(model.requests.every(request => ['/api/tags', '/api/show', '/api/chat'].includes(request.endpoint))).toBe(true);
  });

  it('preserves the selected model and probes it without discovery or changing the profile version', async () => {
    const model = await modelServer();
    const app = await runtime({ model: 'user-choice', ollamaUrl: model.url, autoDiscover: true, autoProbe: true });
    const initial = JSON.parse(await readFile(path.join(app.dataDir, 'profile.json'), 'utf8'));
    await until(async () => (await app.call('/v1/status')).body.readiness.state === 'READY');
    const profile = (await app.call('/v1/profile')).body.active;
    expect(profile.model).toBe('user-choice');
    expect(profile.version).toBe(initial.version);
    expect(model.requests.some(request => request.endpoint === '/api/tags')).toBe(false);
    expect(model.chats.map(chat => chat.model)).toEqual(['user-choice']);
  });

  it('lets a user profile update win against discovery that is still checking metadata', async () => {
    const model = await modelServer({ showDelay: name => name === 'local-model' ? 200 : 0 });
    const app = await runtime({ ollamaUrl: model.url, autoDiscover: true, autoProbe: false });
    await until(async () => model.requests.some(request => request.endpoint === '/api/show' && request.model === 'local-model'));
    const chosen = await app.call('/v1/profile', 'PUT', { model: 'user-choice' });
    expect(chosen.status).toBe(200);
    await new Promise(resolve => setTimeout(resolve, 240));
    const profile = (await app.call('/v1/profile')).body.active;
    expect(profile.model).toBe('user-choice');
    expect(profile.version).toBe(chosen.body.active.version);
    expect(JSON.parse(await readFile(path.join(app.dataDir, 'profile.json'), 'utf8')).model).toBe('user-choice');
    expect(model.chats).toHaveLength(0);
  });

  it('rejects non-completion metadata during discovery and tries one further local candidate', async () => {
    const model = await modelServer({ models: [
      { name: 'innocent-model', size: 1, details: { format: 'gguf' } },
      { name: 'actual-chat', size: 2, details: { format: 'gguf' } },
    ], metadata: name => ({ details: { format: 'gguf' }, model_info: { 'general.architecture': 'llama' }, capabilities: name === 'innocent-model' ? ['embedding'] : ['completion'] }) });
    const app = await runtime({ ollamaUrl: model.url, autoDiscover: true, autoProbe: true });
    await until(async () => (await app.call('/v1/status')).body.readiness.state === 'READY');
    expect((await app.call('/v1/profile')).body.active.model).toBe('actual-chat');
    expect(model.chats.map(chat => chat.model)).toEqual(['actual-chat']);
    expect(model.requests.some(request => request.endpoint === '/api/show' && request.model === 'innocent-model')).toBe(true);
  });

  it('serves HTTP while bounded discovery is pending and remains SETUP when discovery times out', async () => {
    const model = await modelServer({ tagsDelay: 250 });
    const app = await runtime({ ollamaUrl: model.url, autoDiscover: true, autoProbe: true, discoveryTimeoutMs: 100 });
    expect((await app.call('/v1/status')).status).toBe(200);
    await until(async () => (await app.call('/v1/status')).body.readiness.reason.includes('przekroczyło czas'));
    const status = (await app.call('/v1/status')).body;
    expect(status.readiness.state).toBe('SETUP');
    expect((await app.call('/v1/profile')).body.active.model).toBe('');
    expect(model.chats).toHaveLength(0);
  });

  it('keeps missing Ollama actionable without failing startup or downloading models', async () => {
    const model = await modelServer();
    // Closing its listening socket leaves a known unused loopback port.
    await cleanups.pop()!();
    const app = await runtime({ ollamaUrl: model.url, autoDiscover: true, autoProbe: true });
    await until(async () => (await app.call('/v1/status')).body.readiness.reason.includes('niedostępna'));
    expect((await app.call('/v1/status')).body.readiness.state).toBe('SETUP');
    expect((await app.call('/v1/profile')).body.active.model).toBe('');
  });

  it('gives accepted jobs priority over an automatic startup probe', async () => {
    const model = await modelServer({ delay: 120 });
    const app = await runtime({ model: 'local-model', ollamaUrl: model.url, autoDiscover: true, autoProbe: true });
    await until(async () => model.chats.length === 1);
    const submitted = await app.call('/v1/jobs', 'POST', { prompt: 'Moje właściwe zadanie', idempotencyKey: 'startup-priority' });
    expect(submitted.status).toBe(201);
    await until(async () => (await app.call('/v1/jobs')).body.jobs[0].status === 'completed');
    expect(model.chats.map(chat => chat.prompt)).toEqual(['Odpowiedz jednym słowem: OK.', 'Moje właściwe zadanie']);
    expect((await app.call('/v1/jobs')).body.jobs[0].attempt).toBe(1);
    expect((await app.call('/v1/status')).body.readiness.state).toBe('READY');
  });

  it('stops discovery cleanly without activating a delayed candidate after shutdown', async () => {
    const model = await modelServer({ showDelay: () => 250 });
    const app = await runtime({ ollamaUrl: model.url, autoDiscover: true, autoProbe: true });
    await until(async () => model.requests.some(request => request.endpoint === '/api/show'));
    await app.close();
    expect(JSON.parse(await readFile(path.join(app.dataDir, 'profile.json'), 'utf8')).model).toBe('');
    expect(model.chats).toHaveLength(0);
  });

  it('resumes persisted work before startup probing without making a redundant inference', async () => {
    const model = await modelServer({ delay: 80 });
    const app = await runtime({ model: 'local-model', ollamaUrl: model.url });
    await app.enqueue({ prompt: 'Oczekujące zadanie', idempotencyKey: 'startup-persisted' });
    await app.close();
    const recovered = await runtime({ dataDir: app.dataDir, autoDiscover: true, autoProbe: true });
    await until(async () => (await recovered.call('/v1/jobs')).body.jobs[0].status === 'completed');
    expect(model.chats.map(chat => chat.prompt)).toEqual(['Oczekujące zadanie']);
    expect((await recovered.call('/v1/status')).body.readiness.state).toBe('READY');
  });

  it('preserves a CLI profile written while automatic discovery was checking metadata', async () => {
    const model = await modelServer({ showDelay: () => 180 });
    const app = await runtime({ ollamaUrl: model.url, autoDiscover: true, autoProbe: true });
    await until(async () => model.requests.some(request => request.endpoint === '/api/show'));
    const saved = await configureRuntime(app.dataDir, { model: 'cli-choice' });
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(JSON.parse(await readFile(path.join(app.dataDir, 'profile.json'), 'utf8'))).toEqual(saved);
    expect((await app.call('/v1/profile')).body.requested.model).toBe('cli-choice');
    expect(model.chats).toHaveLength(0);
  });

  it('recovers a dead profile writer and serializes concurrent profile commits without losing versions', async () => {
    const dir = await directory();
    await writeFile(path.join(dir, 'profile.lock'), JSON.stringify({ pid: 2147483647, identity: 'dead-profile-writer' }));
    const first = await configureRuntime(dir, { model: 'after-crash' });
    expect(first.version).toBe(1);
    const writes = await Promise.all(Array.from({ length: 8 }, (_, index) => configureRuntime(dir, { model: `user-${index}` })));
    expect(writes.map(profile => profile.version).sort((left, right) => left - right)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    const persisted = JSON.parse(await readFile(path.join(dir, 'profile.json'), 'utf8'));
    expect(persisted.version).toBe(9);
    expect((await readdir(dir)).some(name => name.endsWith('.lock') || name.endsWith('.recovery'))).toBe(false);
  });
});
