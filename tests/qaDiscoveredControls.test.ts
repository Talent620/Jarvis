// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import Composer from '../src/components/Composer';
import { hasUsableBrain } from '../src/lib/brain';
import { store } from '../src/lib/store';
import { isGoalProgressRequest } from '../src/lib/goalProgress';

afterEach(() => vi.unstubAllGlobals());
it('nie myli wybranego modelu z konfiguracją zdolną go uruchomić', () => {
  const settings = { ...store.settings, provider: 'ollama' as const, model: 'auto', ollamaUrl: '', onDeviceOnly: true, webllmEnabled: false };
  expect(hasUsableBrain(settings)).toBe(false);
  expect(hasUsableBrain({ ...settings, ollamaUrl: 'http://127.0.0.1:11435' })).toBe(true);
});
it('przepuszcza prośbę o dotychczasowe wyniki podczas pracy, blokując nowe zwykłe zadanie', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  expect(isGoalProgressRequest('Pokaż dotychczasowe wyniki')).toBe(true);
  const node = document.createElement('div'); document.body.append(node);
  const root = createRoot(node), onSend = vi.fn(), onStop = vi.fn();
  try {
    await act(async () => root.render(createElement(Composer, { onSend, onStop, busy: true, onMic() {}, onAttach() {}, onRemoveImage() {}, imagePreview: null, micOn: false, micSupported: false })));
    const area = node.querySelector('textarea')!;
    const submit = async (text: string) => {
      await act(async () => { area.value = text; Simulate.change(area); });
      await act(async () => Simulate.keyDown(area, { key: 'Enter', shiftKey: false }));
    };
    await submit('Nowe zwykłe zadanie'); expect(onSend).not.toHaveBeenCalled();
    await submit('Pokaż dotychczasowe wyniki'); expect(onSend).toHaveBeenCalledWith('Pokaż dotychczasowe wyniki');
    await submit('Stop'); expect(onStop).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); node.remove(); }
});
