const { args, configuration, newRun, environment, inspectOllama, modelBlocker } = require('./common.cjs');
(async () => {
  const run = newRun('preflight');
  try {
    const env = environment(); run.write('environment.json', env);
    const ollama = await inspectOllama(configuration(args()), run);
    run.record({ id: 'environment', level: 'A', status: 'PASS', detail: 'Recorded current checkout, source fingerprint and non-secret session/tool availability.', evidence: ['environment.json', 'source.json'] });
    run.record({ id: 'Ollama-discovery', level: 'D prerequisite', status: ollama.selected_origin ? 'PASS' : 'BLOCKED', detail: `Source: ${ollama.url_source}; selected: ${ollama.selected_origin || 'none'}. No generation claimed.`, evidence: ['ollama.json'], ...(!ollama.selected_origin ? { blocker: modelBlocker(ollama) } : {}) });
    if (ollama.selected_origin) {
      run.record({ id: 'installed-model', level: 'D prerequisite', status: ollama.stages.model, detail: `Explicit model: ${ollama.model || 'none'}.`, evidence: ['ollama.json'], ...(ollama.stages.model !== 'PASS' ? { blocker: modelBlocker(ollama) } : {}) });
      if (ollama.stages.model === 'PASS') run.record({ id: 'tool-capabilities', level: 'D prerequisite', status: ollama.stages.capabilities, detail: 'Installed model metadata must declare tools support; no tool execution claimed.', evidence: ['ollama.json'], ...(ollama.stages.capabilities !== 'PASS' ? { blocker: { dependency: 'confirmed tools capability in model metadata', command: `POST ${ollama.selected_origin}/api/show`, evidence: ['ollama.json'], scenarios: ['D2', 'S2', 'S3', 'S4', 'S5', 'S6'], action: 'Choose an already installed model declaring tools support, or resolve the concrete /api/show failure. No model download is performed.' } } : {}) });
    }
    run.finish({ environment: env, ollama });
    process.exitCode = ollama.stages.model === 'PASS' && ollama.stages.capabilities === 'PASS' ? 0 : 2;
  } catch (e) {
    run.record({ id: 'preflight', level: 'A', status: 'FAIL', detail: e.message }); run.finish(); process.exitCode = 1;
  }
})();
