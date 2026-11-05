#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRuntime, configureRuntime, defaultDataDir } from './server.mjs';
const [command = 'status', ...args] = process.argv.slice(2);
const dataDir = defaultDataDir();
try {
  if (command === 'configure') {
    const patch = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!args[i + 1]) throw new Error('Brakuje wartości parametru.');
      if (args[i] === '--model') patch.model = args[i + 1];
      else if (args[i] === '--ollama-url') patch.ollamaUrl = args[i + 1];
      else throw new Error(`Nieznany parametr: ${args[i]}`);
    }
    const profile = await configureRuntime(dataDir, patch);
    console.log(JSON.stringify({ profile, next: 'Uruchom ponownie usługę i wykonaj jarvis-runtime test.' }, null, 2));
  } else if (command === 'start') {
    if (args.some(arg => arg !== '--foreground')) throw new Error('Nieznany parametr startu.');
    const runtime = await createRuntime({ dataDir,
      ...(process.env.JARVIS_RUNTIME_MODEL ? { model: process.env.JARVIS_RUNTIME_MODEL } : {}),
      ...(process.env.JARVIS_RUNTIME_OLLAMA_URL ? { ollamaUrl: process.env.JARVIS_RUNTIME_OLLAMA_URL } : {}),
      port: process.env.JARVIS_RUNTIME_PORT ? Number(process.env.JARVIS_RUNTIME_PORT) : 3211,
      autoDiscover: process.env.JARVIS_RUNTIME_AUTO_DISCOVER !== '0',
      autoProbe: process.env.JARVIS_RUNTIME_AUTO_PROBE !== '0',
      allowedOrigins: (process.env.JARVIS_RUNTIME_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
      onError: () => console.error('Nie udało się zapisać stanu kolejki; sprawdź katalog danych.') });
    const url = await runtime.start();
    console.log(`JARVIS Runtime: ${url}\nStan: ${dataDir}\nWybór modelu: jarvis-runtime configure --model NAZWA`);
    process.once('SIGINT', () => { void runtime.close(); }); process.once('SIGTERM', () => { void runtime.close(); });
  } else if (['status', 'test', 'stop', 'archive'].includes(command)) {
    const connection = JSON.parse(await readFile(path.join(dataDir, 'connection.json'), 'utf8'));
    const parsed = new URL(connection.url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password) throw new Error('Nieprawidłowy lokalny adres połączenia.');
    const endpoint = command === 'test' ? 'probe' : command === 'stop' ? 'stop' : command === 'archive' ? 'jobs/archive' : 'status';
    const response = await fetch(`${parsed.origin}/v1/${endpoint}`, { method: command === 'status' ? 'GET' : 'POST', headers: { Authorization: `Bearer ${connection.token}` }, redirect: 'error', signal: AbortSignal.timeout(command === 'test' ? 35000 : 5000) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`);
    console.log(JSON.stringify(body, null, 2));
    if (command === 'test' && body.readiness.state !== 'READY') process.exitCode = 1;
  } else throw new Error('Polecenia: start [--foreground], configure --model NAZWA [--ollama-url URL], status, test, stop, archive.');
} catch (error) {
  console.error(`JARVIS Runtime: ${error.code === 'ENOENT' ? 'Usługa nie jest skonfigurowana lub uruchomiona. Użyj jarvis-runtime start.' : error.message || 'Nie można połączyć się z usługą.'}`);
  process.exitCode = 1;
}
