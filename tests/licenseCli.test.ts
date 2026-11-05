import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { expect, it } from 'vitest';

const script = resolve('scripts/license.mjs');
it('inicjalizuje lokalnego wystawcę, nie nadpisuje sekretu, wydaje i niezależnie weryfikuje token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-issuer-test-'));
  const keyDir = join(dir, 'owner'), publicFile = join(dir, 'public.json'), tokenFile = join(dir, 'license.txt');
  const common = ['--key-dir', keyDir, '--public-file', publicFile];
  try {
    const output = execFileSync(process.execPath, [script, 'init', ...common], { encoding: 'utf8' });
    const privateFile = join(keyDir, 'private.jwk.json'), first = readFileSync(privateFile, 'utf8'), priv = JSON.parse(first), pub = JSON.parse(readFileSync(publicFile, 'utf8'));
    expect(pub.d).toBeUndefined(); expect(output).not.toContain(priv.d);
    if (process.platform !== 'win32') expect(statSync(privateFile).mode & 0o777).toBe(0o600);
    execFileSync(process.execPath, [script, 'init', ...common]);
    expect(readFileSync(privateFile, 'utf8')).toBe(first);
    execFileSync(process.execPath, [script, 'sign', 'Zażółć gęślą jaźń', '30', ...common, '--output', tokenFile]);
    const [data, signature] = readFileSync(tokenFile, 'utf8').trim().split('.');
    const key = await webcrypto.subtle.importKey('jwk', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(signature, 'base64url'), Buffer.from(data))).toBe(true);
    const p = JSON.parse(Buffer.from(data, 'base64url').toString());
    expect(p.n).toBe('Zażółć gęślą jaźń'); expect(p.exp - p.iat).toBe(30 * 86400000);
    const inspected = execFileSync(process.execPath, [script, 'inspect', `${data}.${signature}`, ...common], { encoding: 'utf8' });
    expect(JSON.parse(inspected).status).toBe('active');
    expect(spawnSync(process.execPath, [script, 'inspect', `${data}.AAAA`, ...common]).status).toBe(1);
    for (const days of ['-1', 'NaN', '0.5']) expect(spawnSync(process.execPath, [script, 'sign', 'Tester', days, ...common]).status).toBe(1);
    writeFileSync(publicFile, JSON.stringify({ ...pub, x: 'obcy' }));
    expect(spawnSync(process.execPath, [script, 'init', ...common]).status).toBe(1);
    expect(readFileSync(privateFile, 'utf8')).toBe(first);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('sprawdzenie zależności APK nie generuje kluczy i nie uruchamia instalacji', () => {
  const result = spawnSync(process.execPath, [resolve('scripts/install-local.cjs'), '--apk', '--check'], { encoding: 'utf8', env: { ...process.env, ANDROID_HOME: '/nonexistent-orion-sdk', ANDROID_SDK_ROOT: '' } });
  expect(result.status).toBe(2); expect(JSON.parse(result.stdout).requirements.android_sdk).toBe(false);
});
