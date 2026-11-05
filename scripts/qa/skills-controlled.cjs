/* global window, localStorage */
// Optional mode of the existing agent-smoke runner. Controlled provider != real-model acceptance.
const { chromium } = require('playwright');
const { webcrypto, createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { fs, path, root, which, pause, ownedProcess, stop, environment } = require('./common.cjs');
const { createSkillManager } = require('../../electron/skill-manager.cjs');
const { createSkillIsolation } = require('../../electron/skill-isolation.cjs');
const { createWorkspaceTools } = require('../../electron/workspace-tools.cjs');

async function runControlledSkills({ run, options, send, stored, freePort }) {
  let server, context;
  const sandbox = createSkillIsolation();
  const fixtureRoot = path.join(run.dir, 'skill-fixture');
  const workspace = path.join(run.dir, 'workspace');
  const manager = createSkillManager({ directory: path.join(run.dir, 'native-skill-profile'), sources: [], sandbox });
  const native = createWorkspaceTools({ root: workspace });
  const pending = new Map(); const cancelled = new Set(); const requests = [], operations = [];
  const text = `zażółć gęślą jaźń — ${run.id.slice(-8)}`;
  const outputPath = 'qa-skill-output.txt';
  const command = `Użyj umiejętności qa-transform, aby przetworzyć tekst „${text}”. Zapisz jej wynik w pliku ${outputPath} w katalogu roboczym i odczytaj go dla potwierdzenia.`;
  const report = { mode: 'CONTROLLED_PROVIDER_REAL_SKILL_EXECUTION', model: 'qa-controlled-fixture', originalCommand: command,
    nativeBridge: 'explicit test transport to actual registry/isolation/workspace modules; Electron IPC is tested separately', license: 'required; ephemeral QA issuer and normal activation; production keys unchanged', license_required: true, realModel: false, fixtureSource: 'local QA-only fixture', workspace, taskExecutedByHarness: false };
  run.write('controlled-mode.json', report); run.write('environment.json', environment());
  try {
    const capability = await sandbox.probe(); run.write('isolation.json', capability);
    if (!capability.ok) {
      run.record({ id: 'SKILL-COMPOSER', level: 'controlled provider + actual OS sandbox', status: 'BLOCKED', detail: capability.reason, evidence: ['isolation.json', 'controlled-mode.json'] });
      process.exitCode = 2; return;
    }
    fs.mkdirSync(path.join(fixtureRoot, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, 'SKILL.md'), `---\nname: qa-transform\ndescription: qa-transform przetwarza tekst Unicode do wielkich liter\nlicense: MIT\nmetadata:\n  version: "1.0.0"\n  jarvis:\n    permissions: []\n    platforms: [linux]\n    entrypoint: scripts/transform.cjs\n    test:\n      entrypoint: scripts/transform.cjs\n      input: zażółć\n      expectedOutput: ZAŻÓŁĆ\n---\nUżyj wejścia JSON z polem text. Wynik stdout jest tekstem do zapisania zwykłym autoryzowanym narzędziem plikowym, następnie odczytaj plik.\n`);
    fs.writeFileSync(path.join(fixtureRoot, 'scripts/transform.cjs'), "const input=JSON.parse(require('node:fs').readFileSync(0,'utf8'));const text=typeof input==='string'?input:input.text;if(typeof text!=='string')throw Error('text required');process.stdout.write(text.toLocaleUpperCase('pl-PL'));\n");
    // Test owner policy and candidate preparation are setup only. No stage/test/activation/run or task file is performed here.
    await manager.command({ action: 'policy', source: `local:${fixtureRoot}`, codeKinds: ['executable'], permissions: [], licenses: ['MIT'] }, { trustedUserAction: true });
    await manager.command({ action: 'scan', path: fixtureRoot });
    // The private QA issuer exists only in memory. Normal license validation remains enabled.
    const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicFile = path.join(run.dir, 'qa-license-public.json');
    fs.writeFileSync(publicFile, JSON.stringify(await webcrypto.subtle.exportKey('jwk', keys.publicKey)));
    const { signToken } = await import(pathToFileURL(path.join(root, 'scripts/license.mjs')).href);
    const token = await signToken(await webcrypto.subtle.exportKey('jwk', keys.privateKey), 'QA controlled skills', 1);
    const port = await freePort(), origin = `http://127.0.0.1:${port}`;
    server = ownedProcess(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, JARVIS_LICENSE_REQUIRED: 'true', JARVIS_LICENSE_PUBLIC_KEY_FILE: publicFile, JARVIS_LICENSE_URL: '', JARVIS_LICENSE_STRICT: 'false', APP_BUILD: run.id } }, run, 'vite.log');
    let ready = false;
    for (let i = 0; i < 100; i++) { try { ready = (await fetch(origin, { signal: AbortSignal.timeout(500) })).ok; } catch { /* readiness */ } if (ready) break; await pause(100); }
    if (!ready) throw Error('Isolated Vite startup failed');
    const executablePath = options.chromium || process.env.QA_CHROMIUM || which('chromium') || which('chromium-browser');
    context = await chromium.launchPersistentContext(path.join(run.dir, 'chromium-profile'), { ...(executablePath ? { executablePath } : {}), headless: true, chromiumSandbox: true, args: ['--disable-dev-shm-usage'], viewport: { width: 1100, height: 820 }, serviceWorkers: 'block' });
    await context.exposeBinding('__qaNativeSkill', async (_source, request, taskId, allowNetwork, executionId = taskId) => {
      const controller = new AbortController();
      if (cancelled.has(`${taskId}:${executionId}`)) return { ok: false, error: 'cancelled' };
      pending.set(`${taskId}:${executionId}`, controller);
      try {
        if (!['list', 'search', 'inspect', 'stage', 'test', 'activate', 'run', 'assert_task', 'resource'].includes(request.action)) throw Error('Fixture bridge rejects owner actions');
        const result = await manager.command(request, { taskId, signal: controller.signal, allowNetwork });
        operations.push({ action: request.action, id: request.id, taskId, result }); run.write('native-operations.json', operations);
        return { ...result, ok: result?.ok !== false };
      } catch (error) { return { ok: false, error: error.message }; } finally { pending.delete(`${taskId}:${executionId}`); }
    });
    await context.exposeBinding('__qaNativeSkillCancel', async (_source, taskId, executionId) => { const key = `${taskId}:${executionId}`; cancelled.add(key); pending.get(key)?.abort(); return { ok: true }; });
    await context.exposeBinding('__qaNativeSkillRelease', async (_source, taskId) => { await manager.command({ action: 'release_task' }, { taskId }); return { ok: true }; });
    await context.exposeBinding('__qaNativeTool', async (_source, tool, input) => {
      if (!['status', 'files_write', 'files_read'].includes(tool)) return { ok: false, error: 'Test scope only' };
      const result = await native.call(tool, input); operations.push({ action: `workspace:${tool}`, input, result }); run.write('native-operations.json', operations); return result;
    });
    await context.addInitScript(() => {
      window.jarvisDesktop = { platform: 'linux', skillCommand: (...args) => window.__qaNativeSkill(...args), skillCancel: (...args) => window.__qaNativeSkillCancel(...args), skillRelease: id => window.__qaNativeSkillRelease(id), agentTool: (...args) => window.__qaNativeTool(...args), onClipboard: () => () => {}, onVoiceMode: () => () => {}, clipWatch: async () => false };
    });
    let step = 0, candidateId, skillId, actualSkillOutput;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.origin !== 'http://127.0.0.1:11434') return route.abort();
      if (!url.pathname.endsWith('/api/chat')) return route.fulfill({ json: url.pathname.endsWith('/api/tags') ? { models: [{ name: 'qa-controlled-fixture' }] } : { capabilities: ['tools'], model_info: {} } });
      try {
        const body = route.request().postDataJSON();
        const user = body.messages.filter(message => message.role === 'user').at(-1)?.content;
        if (user !== command) throw Error('Provider fixture received unexpected task');
        const output = name => { const last = body.messages.filter(message => message.role === 'tool' && message.tool_name === name).at(-1); if (!last) throw Error(`Missing tool result ${name}`); const result = JSON.parse(last.content); if (result.ok === false) throw Error(`Tool failed: ${last.content}`); return result; };
        let calls, content = '';
        switch (step++) {
          case 0: calls = [['skill_search', { query: 'qa-transform' }]]; break;
          case 1: candidateId = output('skill_search').candidates[0].candidateId; calls = [['skill_manage', { action: 'inspect', candidateId }], ['skill_manage', { action: 'stage', candidateId }]]; break;
          case 2: skillId = output('skill_manage').id; calls = [['skill_manage', { action: 'test', id: skillId }]]; break;
          case 3: if (!output('skill_manage').test?.ok) throw Error('Skill functional test failed'); calls = [['skill_manage', { action: 'activate', id: skillId }]]; break;
          case 4: if (output('skill_manage').state !== 'ACTIVE') throw Error('Not active'); calls = [['skill_run', { id: skillId, input: { text } }]]; break;
          case 5: actualSkillOutput = output('skill_run').output; if (typeof actualSkillOutput !== 'string') throw Error('No actual stdout'); calls = [['system_files_write', { path: outputPath, content: actualSkillOutput }]]; break;
          case 6: output('system_files_write'); calls = [['system_files_read', { path: outputPath }]]; break;
          case 7: output('system_files_read'); content = `QA_CONTROLLED_COMPLETE: ${actualSkillOutput}`; break;
          default: throw Error('Unexpected extra provider loop');
        }
        for (const [name] of calls || []) if (!body.tools?.some(tool => tool.function.name === name)) throw Error(`Required tool not selected: ${name}`);
        const message = { role: 'assistant', content, ...(calls ? { tool_calls: calls.map(([name, args]) => ({ function: { name, arguments: args } })) } : {}) };
        requests.push({ step, user, offeredTools: body.tools?.map(tool => tool.function.name), toolResults: body.messages.filter(message => message.role === 'tool'), response: message }); run.write('controlled-provider.json', requests);
        return route.fulfill({ json: { message } });
      } catch (error) { run.write('provider-fixture-error.txt', error.stack); return route.fulfill({ status: 500, json: { error: error.message } }); }
    });
    const page = context.pages()[0] || await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => run.write('page-error.txt', error.stack));
    await page.goto(origin);
    await page.getByPlaceholder('Klucz licencyjny…', { exact: true }).fill(token);
    await page.getByRole('button', { name: 'Aktywuj', exact: true }).click();
    await page.getByRole('button', { name: 'Aktywuj', exact: true }).waitFor({ state: 'hidden' });
    if (await page.evaluate(() => localStorage.getItem('jarvis.license.v1')) !== token) throw Error('Normal QA license activation did not persist');
    run.write('license-activation.json', { license_required: true, ephemeral_test_issuer: true, private_key_written: false, normal_activation: true, token_sha256: createHash('sha256').update(token).digest('hex') });
    await page.evaluate(async () => { localStorage.setItem('jarvis.onboarded.v1', '1'); const { store } = await import('/src/lib/store.ts'); store.setSettings({ provider: 'ollama', model: 'qa-controlled-fixture', ollamaUrl: 'http://127.0.0.1:11434', ollamaNumCtx: 32768, onDeviceOnly: true, deepThink: false, expertKnowledge: false, interpreterMode: false, webSearch: false, confidenceGate: false, speculativeMode: false, councilMode: false, webllmEnabled: false, memoryServiceUrl: '', speak: false, tips: false, prewarmLocal: false }); });
    await page.reload(); await page.locator('.boot').waitFor({ state: 'hidden' });
    await send(page, command);
    // Explicit user actions through the ordinary consent dialog for this test's write and read only.
    const consent = [];
    for (let i = 0; i < 2; i++) {
      const allow = page.getByRole('button', { name: 'Zezwól', exact: true }); await allow.waitFor();
      consent.push(await page.locator('.panel').last().innerText().catch(() => 'Dialog visible'));
      await allow.click(); await allow.waitFor({ state: 'hidden' });
    }
    await page.locator('.bubble.assistant').filter({ hasText: 'QA_CONTROLLED_COMPLETE' }).waitFor();
    const disk = fs.readFileSync(path.join(workspace, outputPath), 'utf8'), expected = text.toLocaleUpperCase('pl-PL');
    if (disk !== expected) throw Error(`Independent disk oracle mismatch`);
    if (!operations.some(operation => operation.action === 'run' && operation.result.evidence?.backend === 'bubblewrap-seccomp-node' && operation.result.ok)) throw Error('No OS-isolated execution evidence');
    let after = await manager.command({ action: 'list' });
    for (let i = 0; Object.keys(after.taskPins).length && i < 40; i++) { await pause(50); after = await manager.command({ action: 'list' }); }
    if (Object.keys(after.taskPins).length) throw Error('Task pins were not released after composer completion');
    run.write('independent-oracle.json', { file: outputPath, content: disk, expected, passed: disk === expected, taskPinsAfterCompletion: after.taskPins });
    run.write('ui-consents.json', consent); run.write('persisted-ui.json', await stored(page)); await page.screenshot({ path: path.join(run.dir, 'controlled-composer.png') });
    run.record({ id: 'SKILL-COMPOSER', level: 'controlled provider + real registry + real OS sandbox + actual workspace file', status: 'PASS', detail: 'Normal composer → existing brain/provider loop → search/inspect/stage/test/activate/run → normal user consent → file write/read. Independent disk oracle passed; completed task pins released. Provider decisions are fixtures, not evidence of model autonomy or native Electron IPC.', evidence: ['controlled-mode.json', 'controlled-provider.json', 'native-operations.json', 'isolation.json', 'independent-oracle.json', 'controlled-composer.png', 'ui-consents.json'] });
    run.record({ id: 'REAL-MODEL', level: 'actual model', status: 'BLOCKED', detail: 'This explicit controlled mode does not connect to an actual Ollama model. Run qa:desktop with the existing configured model in the authorized local session.', evidence: ['controlled-mode.json'] });
    process.exitCode = 2;
  } catch (error) {
    run.write('controlled-error.txt', error.stack || error.message);
    const page = context?.pages()[0]; if (page) { await page.screenshot({ path: path.join(run.dir, 'controlled-failure.png'), mask: [page.getByPlaceholder('Klucz licencyjny…', { exact: true })] }).catch(() => {}); await page.locator('body').innerText().then(text => run.write('controlled-ui.txt', text)).catch(() => {}); }
    run.record({ id: 'SKILL-COMPOSER', level: 'controlled provider + actual backend', status: 'FAIL', detail: error.message, evidence: ['controlled-error.txt', 'controlled-provider.json', 'native-operations.json'] }); process.exitCode = 1;
  } finally {
    for (const controller of pending.values()) controller.abort(); sandbox.cancelAll(); native.cancelAll();
    await context?.close().catch(() => {}); await stop(server);
    fs.rmSync(path.join(run.dir, 'chromium-profile'), { recursive: true, force: true });
    run.finish({ ...report, model_fixtures: 'explicit controlled provider decisions; real OS-isolated skill and disk write/read; no real-model success claim', runner_completed: true, required_tests_passed: false });
  }
}
module.exports = { runControlledSkills };
