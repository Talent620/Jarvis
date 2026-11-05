// Existing scenario implementation, called by qa:desktop; legacy command is an alias.
const { fs, path, pause } = require('./common.cjs');
function verifiedReply(chats, command, expected) {
  return chats.some(c => {
    const at = c.messages.findIndex(m => m.role === 'user' && m.text === command);
    const replies = c.messages.slice(at + 1).filter(m => m.role === 'assistant');
    return at >= 0 && replies.length === 1 && replies[0].text.includes(expected);
  });
}
async function runScenarios({ run, page, workspace }) {
  const { send, stored } = require('./agent-smoke.cjs');
  let phase = 'setup'; const network = [], consentLog = [];
  const commands = new Map();
  async function issue(text) { commands.set(phase, text); await send(page, text); }
  async function waitForAnswer(command, expected) {
    const started = performance.now();
    while (performance.now() - started < 20000) {
      const snapshot = await stored(page);
      if (verifiedReply(snapshot.chats, command, expected)) return snapshot;
      await pause(100);
    }
    throw Error('The saved assistant answer did not confirm the requested file content');
  }
  try {
    const requestPhases = new WeakMap();
    page.on('request', r => { if (r.url().includes('/api/chat')) {
      let actualPhase = phase;
      try {
        const users = r.postDataJSON()?.messages?.filter(m => m.role === 'user') || [];
        const command = users[users.length - 1]?.content;
        actualPhase = [...commands].find(([, text]) => text === command)?.[0] || phase;
      } catch { /* body cannot be read: retain request-start phase */ }
      requestPhases.set(r, actualPhase); network.push({ phase: actualPhase, event: 'request', at: performance.now(), url: r.url() });
    } });
    page.on('requestfailed', r => { if (r.url().includes('/api/chat')) network.push({ phase: requestPhases.get(r) || 'unknown', event: 'cancel_or_failure', at: performance.now(), error: r.failure()?.errorText }); });
    page.on('response', r => { if (r.url().includes('/api/chat')) network.push({ phase: requestPhases.get(r.request()) || 'unknown', event: 'response', at: performance.now(), status: r.status() }); });
    async function waitTurn(allowedFile, expected, timeout = 180000) {
      const started = performance.now(); let confirmed = false;
      while (performance.now() - started < timeout) {
        const dialog = page.locator('.sheet').filter({ hasText: 'Zgoda na akcję' });
        if (await dialog.count()) {
          const name = await dialog.locator('.panel-body b').first().innerText();
          let input; try { input = await dialog.locator('pre').count() ? JSON.parse(await dialog.locator('pre').innerText()) : {}; } catch { input = null; }
          const resource = typeof input?.path === 'string' ? path.resolve(workspace, input.path) : null;
          const metadata = !!input && typeof input === 'object' && !Array.isArray(input) && (name === 'system_workspace_status' && Object.keys(input).length === 0 || name === 'system_files_list' && typeof (input.path ?? '.') === 'string' && path.resolve(workspace, input.path || '.') === workspace);
          const allowed = !!metadata || ['system_files_read', 'system_files_write'].includes(name) && resource === path.join(workspace, allowedFile) && (name !== 'system_files_write' || input.content === expected);
          const fresh = await dialog.getByText('Ta decyzja dotyczy tylko tej konkretnej akcji.', { exact: true }).count() > 0;
          consentLog.push({ phase, tool: name, input, allowed, fresh, at: performance.now() });
          await dialog.getByRole('button', { name: allowed ? 'Zezwól' : 'Odmów', exact: true }).click();
          if (!allowed) throw Error(`Unexpected operation denied: ${name}`);
        }
        const disk = fs.existsSync(path.join(workspace, allowedFile)) ? fs.readFileSync(path.join(workspace, allowedFile), 'utf8') : null;
        const saved = await stored(page);
        const audit = saved.data.audit || [];
        confirmed = disk === expected && audit.some(a => a.tool === 'system_files_read' && a.status === 'ok' && a.output?.includes(expected));
        const idle = !await page.getByRole('button', { name: 'Zatrzymaj generowanie', exact: true }).count();
        if (confirmed && idle) return saved;
        await pause(100);
      }
      throw Error(`Task timeout; file/read confirmation: ${confirmed}`);
    }
    phase = 'A';
    const textA = 'Zażółć gęślą jaźń.', nameA = 'notatka-orion.txt';
    const commandA = `Utwórz w katalogu testowym plik ${nameA}. Wpisz dokładnie: ${textA} Bez końcowego znaku nowej linii. Odczytaj plik narzędziem i potwierdź zawartość. Test ${run.id}.`;
    await issue(commandA); await waitTurn(nameA, textA);
    run.write('A-result.json', await waitForAnswer(commandA, textA));
    if (!network.some(e => e.phase === 'A' && e.event === 'response' && e.status === 200)) throw Error('A did not use a real model response');
    run.record({ id: 'A', level: 'C + D', status: 'PASS', detail: 'Normal UI → real model → freshly authorized file write/read; independent filesystem and read audit verified.', evidence: ['A-result.json', 'network.json', 'consents.json'] });
    phase = 'B';
    const beforeB = await stored(page);
    const waiting = page.waitForRequest(r => r.url().includes('/api/chat'), { timeout: 20000 });
    await issue(`Przygotuj bardzo obszerną analizę 10000 słów porównującą strategie pracy. Na końcu zapisz podsumowanie do zakazane-po-stop.txt. Test ${run.id}.`);
    await waiting; const stopAt = performance.now();
    await page.getByRole('button', { name: 'STOP — zatrzymaj działania', exact: true }).click();
    await page.getByRole('button', { name: 'Zatrzymaj generowanie', exact: true }).waitFor({ state: 'hidden', timeout: 3000 });
    const acknowledged = performance.now() - stopAt;
    for (let i = 0; i < 30 && !network.some(e => e.phase === 'B' && e.event === 'cancel_or_failure'); i++) await pause(100);
    const cancelled = network.find(e => e.phase === 'B' && e.event === 'cancel_or_failure');
    const beforeQuiet = await stored(page); await pause(2000); const afterQuiet = await stored(page);
    const stable = JSON.stringify(beforeQuiet.data.audit) === JSON.stringify(afterQuiet.data.audit);
    const earlierIds = new Set((beforeB.data.audit || []).map(a => a.id));
    const reconciled = (beforeQuiet.data.audit || []).filter(a => !earlierIds.has(a.id)).map(a => ({ tool: a.tool, status: a.status, at: a.at, input: a.input }));
    const forbidden = fs.existsSync(path.join(workspace, 'zakazane-po-stop.txt'));
    if (!cancelled || !stable || forbidden || fs.readFileSync(path.join(workspace, nameA), 'utf8') !== textA) throw Error('B: cancellation, quiescence, or prior-effect reconciliation failed');
    run.write('B-stop.json', { ui_ack_ms: acknowledged, request_cancel_ms: cancelled.at - stopAt, executor_quiet_observed_after_ms: performance.now() - stopAt, quiet_window_ms: 2000, no_new_audit_entries: stable, previously_completed_A: 'preserved', B_observed_operations_before_quiet_window: reconciled, exact_executor_stop_instant: 'not measured; bounded quiescence observation only', forbidden_file: false, inference_kernel_stop: 'not inferred from client cancellation or model residency' });
    phase = 'B-new';
    const nameC = 'nowe-po-stop.txt', textC = `NOWE ${run.id}`;
    const commandC = `Utwórz plik ${nameC} w katalogu testowym. Dokładna treść: „${textC}” (bez cudzysłowów, bez końcowej nowej linii). Odczytaj go i podaj dokładną zawartość w odpowiedzi.`;
    await issue(commandC);
    await waitTurn(nameC, textC);
    await waitForAnswer(commandC, textC);
    await pause(1000);
    const finalState = await stored(page); run.write('B-new-result.json', finalState);
    const session = finalState.chats.find(c => c.messages.some(m => m.text === commandC && m.role === 'user'));
    const newReplies = session?.messages.slice(session.messages.findIndex(m => m.role === 'user' && m.text === commandC) + 1).filter(m => m.role === 'assistant') || [];
    if (newReplies.length !== 1 || !newReplies[0].text.includes(textC) || network.some(e => e.phase === 'B' && e.event === 'request' && e.at > cancelled.at)) throw Error('Late old response/request contaminated the new task');
    if (fs.existsSync(path.join(workspace, 'zakazane-po-stop.txt')) || !network.some(e => e.phase === 'B-new' && e.event === 'response' && e.status === 200) || !consentLog.some(e => e.phase === 'B-new' && e.tool === 'system_files_write' && e.allowed && e.fresh)) throw Error('C: fresh model request/consent missing, or late old effect');
    run.record({ id: 'B', level: 'Electron + real model', status: 'PASS', detail: 'Real STOP and new task: separate UI/transport/quiescence timings, prior completed effect preserved, fresh scoped consent, independent new file/read and no late old effect.', evidence: ['B-stop.json', 'B-new-result.json', 'network.json', 'consents.json'] });
    run.write('network.json', network); run.write('consents.json', consentLog);
  } catch (e) {
    run.write('model-error.txt', e.stack || e.message);
    const id = run.results.some(r => r.id === 'A' && r.status === 'PASS') ? 'B' : 'A';
    run.record({ id, level: 'Electron + real model', status: 'FAIL', detail: e.message, evidence: ['model-error.txt', 'network.json', 'consents.json'] });
  } finally {
    run.write('network.json', network); run.write('consents.json', consentLog);
  }
}
module.exports = { runScenarios, verifiedReply };
if (require.main === module) require('./desktop.cjs').main();
