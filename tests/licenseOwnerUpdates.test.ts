// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/lib/licenseAuthority', () => ({ ownerManagedBuild: true, ownerUpdateMessage: 'Aktualizuj lokalnym instalatorem właściciela.' }));
import { checkForUpdate, applyUpdate } from '../src/lib/updater';
import { checkLiveUpdate, applyLiveUpdate } from '../src/lib/liveUpdate';
afterEach(() => vi.unstubAllGlobals());
it('nie zastępuje publicznego klucza właściciela oficjalną aktualizacją lub OTA', async () => {
  const network = vi.fn(); vi.stubGlobal('fetch', network);
  expect(await checkForUpdate()).toHaveProperty('error');
  expect(await checkLiveUpdate()).toHaveProperty('error');
  expect((await applyUpdate({ platform: 'android', url: 'https://example.org/a.apk', assetAvailable: true } as any)).ok).toBe(false);
  expect((await applyLiveUpdate({ version: 'new', iso: '2026-01-01', url: 'https://example.org/a.zip' })).ok).toBe(false);
  expect(network).not.toHaveBeenCalled();
});
