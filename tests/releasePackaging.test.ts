import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
const require = createRequire(import.meta.url);
const { validateBuild, validatePackagePaths, validateDebianPostinstall } = require('../scripts/release-linux.cjs');
const { prepare, verifySigningCertificate, failureSummary } = require('../scripts/prepare-android-signing.cjs');

describe('Release provenance and private material boundaries', () => {
  const commit = 'a'.repeat(40);
  it('refuses unlicensed or different-source builds', () => {
    expect(() => validateBuild({ schemaVersion: 1, commit, version: '2.1.0-alpha.1', licenseRequired: true }, { version: '2.1.0-alpha.1' }, commit)).not.toThrow();
    expect(() => validateBuild({ schemaVersion: 1, commit, version: '2.1.0-alpha.1', licenseRequired: false }, { version: '2.1.0-alpha.1' }, commit)).toThrow(/license/);
    expect(() => validateBuild({ schemaVersion: 1, commit: 'b'.repeat(40), licenseRequired: true }, {}, commit)).toThrow(/commit/);
  });
  it('rejects signing keys, private issuer files and profiles inside packages', () => {
    for (const entry of ['/android/keystore/jarvis.jks', '/license-private.json', '/config/.env.local', '/QA/runs/session/profile']) {
      expect(() => validatePackagePaths(['/dist/index.html', entry])).toThrow(/private/);
    }
    expect(() => validatePackagePaths(['/dist/index.html', '/electron/main.cjs', '/node_modules/pkg/LICENSE'])).not.toThrow();
  });
  it('requires the real deb control script to retain helper-integrity and permission guards', () => {
    const current = readFileSync('scripts/linux-after-install.sh', 'utf8');
    expect(() => validateDebianPostinstall(current)).not.toThrow();
    expect(() => validateDebianPostinstall('if unshare --user true; then chmod 0755 chrome-sandbox; fi')).toThrow(/guard missing/);
    expect(() => validateDebianPostinstall(current.replace('chmod 4755', 'chmod 0755'))).toThrow(/guard missing/);
    expect(() => validateDebianPostinstall(current + '\nsysctl -w unsafe.setting=1')).toThrow(/disable isolation/);
  });
  it('fails closed before writing without signing configuration', () => {
    expect(() => prepare({})).toThrow(/Missing signing configuration/);
  });
  it('reports missing Android configuration names without echoing secret values or arbitrary errors', () => {
    const error = new Error('Missing signing configuration: JARVIS_RELEASE_STORE_PASSWORD, synthetic-password. No development-key fallback.');
    expect(failureSummary(error)).toContain('JARVIS_RELEASE_STORE_PASSWORD');
    expect(failureSummary(error)).not.toContain('synthetic-password');
    expect(failureSummary(new Error('keytool echoed synthetic-secret'))).not.toContain('synthetic-secret');
  });
  it('requires the approved certificate and keeps passwords out of command arguments', () => {
    const env = { JARVIS_RELEASE_CERT_SHA256: 'ab'.repeat(32), JARVIS_RELEASE_KEY_ALIAS: 'synthetic', JARVIS_RELEASE_STORE_PASSWORD: 'synthetic-password' };
    const execute = (_exe: string, args: string[]) => {
      expect(args.join(' ')).not.toContain('synthetic-password');
      expect(args).toContain('-storepass:env');
      return 'SHA256: ' + Array(32).fill('AB').join(':');
    };
    expect(() => verifySigningCertificate('/synthetic/keystore', env, execute)).not.toThrow();
    expect(() => verifySigningCertificate('/synthetic/keystore', { ...env, JARVIS_RELEASE_CERT_SHA256: 'cd'.repeat(32) }, execute)).toThrow(/does not match/);
  });
  it('protects synthetic signing input and never exports passwords to GITHUB_ENV', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'jarvis-signing-test-'));
    const output = path.join(dir, 'env');
    try {
      const file = prepare({ RUNNER_TEMP: dir, GITHUB_ENV: output, JARVIS_RELEASE_KEYSTORE_BASE64: Buffer.alloc(128, 7).toString('base64'), JARVIS_RELEASE_STORE_PASSWORD: 'synthetic-password', JARVIS_RELEASE_KEY_ALIAS: 'synthetic-alias', JARVIS_RELEASE_KEY_PASSWORD: 'synthetic-key-password', JARVIS_BUILD_NUMBER: '123', JARVIS_PREVIOUS_VERSION_CODE: '122', JARVIS_RELEASE_CERT_SHA256: 'a'.repeat(64) }, () => {});
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readFileSync(output, 'utf8')).not.toContain('password');
      expect(readFileSync(output, 'utf8')).toContain('JARVIS_BUILD_NUMBER=123');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
