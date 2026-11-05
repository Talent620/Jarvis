import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { args, configuration, resultExitCode } = require('../scripts/qa/common.cjs');

it('checks both known local ports if the actual profile is unavailable', () => {
  expect(configuration({}, {}).candidates).toEqual(['http://127.0.0.1:11435', 'http://127.0.0.1:11434']);
});
it('honors the application endpoint and model, without returning credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-qa-config-'));
  try {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ 'jarvis.settings.v2': JSON.stringify({ provider: 'ollama', model: 'installed:7b', ollamaUrl: 'http://127.0.0.1:11435', keys: { secret: 'DO_NOT_LOG_THIS' } }) }));
    const result = configuration({ 'settings-file': file }, {});
    expect(result.candidates).toEqual(['http://127.0.0.1:11435']);
    expect(result.model).toBe('installed:7b');
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LOG_THIS');
    expect(configuration({ 'settings-file': file, 'ollama-url': 'http://127.0.0.1:11436', model: 'other:4b' }, {}).candidates).toEqual(['http://127.0.0.1:11436']);
    expect(configuration({ 'settings-file': file }, { QA_OLLAMA_URL: 'http://127.0.0.1:11437' }).candidates).toEqual(['http://127.0.0.1:11437']);
  } finally { rmSync(dir, { recursive: true }); }
});
it('rejects cloud endpoints, credentials, paths and typoed flags', () => {
  for (const url of ['https://ollama.example', 'http://secret@localhost:11435', 'http://127.0.0.1:11435/api/tags']) {
    expect(() => configuration({ 'ollama-url': url }, {})).toThrow();
  }
  expect(() => args(['--no-sandbox'])).toThrow();
  expect(() => args(['--model', '--ollama-url', 'http://127.0.0.1:11435'])).toThrow();
  expect(args(['--license-file', '/tmp/qa-license.local'])).toEqual({ 'license-file': '/tmp/qa-license.local' });
});
it('does not turn independent passes into overall success while the main scenarios are blocked or absent', () => {
  const independent = [{ id: 'independent-local', status: 'PASS' }];
  expect(resultExitCode(independent)).toBe(2);
  expect(resultExitCode([...independent, { id: 'A', status: 'BLOCKED' }, { id: 'B', status: 'NOT_RUN' }, { id: 'C', status: 'BLOCKED' }])).toBe(2);
  expect(resultExitCode([{ id: 'A', status: 'PASS' }, { id: 'B', status: 'PASS' }, { id: 'C', status: 'PASS' }])).toBe(0);
  expect(resultExitCode([{ id: 'A', status: 'FAIL' }])).toBe(1);
});
it('does not accept a user echo, an earlier answer, or a late extra answer as the new task result', () => {
  const { verifiedReply } = require('../scripts/qa/agent-real.cjs');
  const user = { role: 'user', text: 'read file' }, answer = { role: 'assistant', text: 'Zażółć gęślą jaźń.' };
  expect(verifiedReply([{ messages: [answer, user] }], user.text, answer.text)).toBe(false);
  expect(verifiedReply([{ messages: [{ ...user, text: answer.text }] }], answer.text, answer.text)).toBe(false);
  expect(verifiedReply([{ messages: [user, answer] }], user.text, answer.text)).toBe(true);
  expect(verifiedReply([{ messages: [user, answer, { role: 'assistant', text: 'late old result' }] }], user.text, answer.text)).toBe(false);
});
it('requires real selection/copy, clipboard and editor focus, native paste/save, model response and matching disk bytes for C', () => {
  const { clipboardOracle } = require('../scripts/qa/desktop.cjs');
  const fixture = {
    expected: 'Drugi akapit: zażółć', file: 'Drugi akapit: zażółć', modelResponse: true, assistantReply: true,
    copies: [{ trusted: true, focused: true, text: 'Drugi akapit: zażółć' }],
    pasteObservations: [{ editor_focused: true, clipboard: 'Drugi akapit: zażółć', source_copy_observed: true }],
    audit: [{ tool: 'desktop_hotkey', status: 'ok', input: JSON.stringify({ combo: 'ctrl+v' }) }, { tool: 'desktop_hotkey', status: 'ok', input: { combo: 'ctrl+s' } }, { tool: 'system_files_read', status: 'ok', input: {}, output: 'Drugi akapit: zażółć' }],
  };
  expect(clipboardOracle(fixture).passed).toBe(true);
  expect(clipboardOracle({ ...fixture, copies: [] }).passed).toBe(false);
  expect(clipboardOracle({ ...fixture, copies: [{ trusted: false, focused: true, text: fixture.expected }] }).passed).toBe(false);
  expect(clipboardOracle({ ...fixture, pasteObservations: [{ editor_focused: false, clipboard: fixture.expected, source_copy_observed: true }] }).passed).toBe(false);
  expect(clipboardOracle({ ...fixture, file: 'Pierwszy akapit' }).passed).toBe(false);
  expect(clipboardOracle({ ...fixture, modelResponse: false }).passed).toBe(false);
  expect(clipboardOracle({ ...fixture, assistantReply: false }).passed).toBe(false);
  expect(clipboardOracle({ ...fixture, audit: [] }).passed).toBe(false);
  expect(clipboardOracle({ ...fixture, audit: [...fixture.audit, { tool: 'system_files_write', status: 'ok', input: {} }] }).passed).toBe(false);
});
