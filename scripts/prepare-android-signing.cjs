#!/usr/bin/env node
'use strict';
// Only runs in explicitly configured CI. Never prints or commits signing secrets.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const configurationKeys = ['JARVIS_RELEASE_KEYSTORE_BASE64', 'JARVIS_RELEASE_STORE_PASSWORD', 'JARVIS_RELEASE_KEY_ALIAS', 'JARVIS_RELEASE_KEY_PASSWORD', 'JARVIS_BUILD_NUMBER', 'JARVIS_PREVIOUS_VERSION_CODE', 'JARVIS_RELEASE_CERT_SHA256', 'RUNNER_TEMP', 'GITHUB_ENV'];

function failureSummary(error) {
  if (error.message?.startsWith('Missing signing configuration: ')) {
    const missing = configurationKeys.filter((key) => error.message.includes(key));
    return `Android release signing blocked: missing configuration names ${missing.join(', ')}. No development-key fallback.`;
  }
  return 'Android release signing verification failed. Inspect the signing step; existing signing identity remains required.';
}

function verifySigningCertificate(file, env, execute = execFileSync) {
  let details;
  try { details = execute('keytool', ['-J-Duser.language=en', '-J-Duser.country=US', '-list', '-v', '-keystore', file, '-storepass:env', 'JARVIS_RELEASE_STORE_PASSWORD', '-alias', env.JARVIS_RELEASE_KEY_ALIAS], { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error('Cannot verify the configured Android signing certificate. Check the explicit key, alias and credentials.'); }
  const actual = details.match(/SHA256:\s*([A-Fa-f0-9:]+)/)?.[1].replace(/:/g, '').toLowerCase();
  const expected = env.JARVIS_RELEASE_CERT_SHA256.replace(/:/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected) || actual !== expected) throw new Error('Android signing certificate does not match the approved existing certificate SHA-256.');
}

function prepare(env = process.env, verifyCertificate = verifySigningCertificate) {
  const missing = configurationKeys.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing signing configuration: ${missing.join(', ')}. No development-key fallback.`);
  const next = Number(env.JARVIS_BUILD_NUMBER), previous = Number(env.JARVIS_PREVIOUS_VERSION_CODE);
  if (!Number.isSafeInteger(next) || !Number.isSafeInteger(previous) || next <= previous || previous < 1 || next > 2100000000) throw new Error('Release versionCode must be an integer greater than the previous installed versionCode.');
  const encoded = env.JARVIS_RELEASE_KEYSTORE_BASE64.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid encoded keystore.');
  const material = Buffer.from(encoded, 'base64');
  if (material.length < 64 || material.length > 1024 * 1024) throw new Error('Invalid keystore size.');
  const signingDir = fs.mkdtempSync(path.join(env.RUNNER_TEMP, 'jarvis-signing-'));
  fs.chmodSync(signingDir, 0o700);
  const file = path.join(signingDir, 'release.keystore');
  fs.writeFileSync(file, material, { mode: 0o600, flag: 'wx' });
  try { verifyCertificate(file, env); } catch (error) { fs.rmSync(signingDir, { recursive: true, force: true }); throw error; }
  // Passwords stay exclusively in the step environment; only public numbering/path go here.
  fs.appendFileSync(env.GITHUB_ENV, `JARVIS_RELEASE_STORE_FILE=${file}\nJARVIS_BUILD_NUMBER=${next}\nJARVIS_PREVIOUS_VERSION_CODE=${previous}\n`);
  return file;
}
module.exports = { prepare, verifySigningCertificate, failureSummary };
if (require.main === module) {
  try { prepare(); console.log('Explicit release signing configured; identity must match the installed application.'); }
  catch (error) {
    const summary = failureSummary(error);
    console.error(summary);
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.error(`::error title=Android release signing::${summary}`);
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n\n`);
    }
    process.exitCode = 2;
  }
}
