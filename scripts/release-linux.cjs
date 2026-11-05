#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function validateBuild(metadata, pkg, expectedCommit) {
  if (metadata.schemaVersion !== 1 || metadata.commit !== expectedCommit || !/^[0-9a-f]{40}$/.test(expectedCommit)) throw new Error('Build provenance does not match the requested commit.');
  if (metadata.version !== pkg.version || metadata.licenseRequired !== true) throw new Error('Version mismatch or license gate disabled.');
}
function validatePackagePaths(entries) {
  const forbidden = entries.filter((entry) => /(?:^|\/)(?:\.env(?:\..*)?|license-private\.json|license-public\.local\.json|license-issuer|\.git|QA\/runs)(?:\/|$)/.test(entry) || /\.(?:jks|keystore|p12|pfx)$/i.test(entry));
  if (forbidden.length) throw new Error(`Forbidden private/configuration paths in package: ${forbidden.join(', ')}`);
}
function dependencyLicenses(root) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  return Object.entries(lock.packages).filter(([name, p]) => name && !p.dev).map(([name, p]) => ({
    package: name.replace(/^.*node_modules\//, ''), version: p.version, license: p.license || 'UNDECLARED',
    integrity: p.integrity || null,
  })).sort((a, b) => a.package.localeCompare(b.package));
}
function main(root = path.resolve(__dirname, '..')) {
  const run = (exe, args, options = {}) => execFileSync(exe, args, { cwd: root, stdio: 'inherit', ...options });
  const git = (args) => run('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = git(['rev-parse', 'HEAD']);
  if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('Release packaging requires a clean, committed source tree. Preserve or commit changes first.');
  if (process.env.JARVIS_LICENSE_REQUIRED === 'false') throw new Error('Release packaging refuses a disabled license gate.');
  if (fs.existsSync(path.join(root, 'license-public.local.json')) && !process.env.JARVIS_LICENSE_PUBLIC_KEY_FILE) throw new Error('An implicit local issuer exists. Select an explicit approved public key before release.');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const env = { ...process.env, APP_COMMIT: commit, APP_BUILD: new Date().toISOString().slice(0, 16).replace('T', ' '), JARVIS_LICENSE_REQUIRED: 'true' };
  run(process.execPath, ['scripts/secret-scan.mjs', '--all'], { env });
  run('npm', ['run', 'build'], { env });
  // Artifact output remains ignored and contains only this invocation's packages.
  const output = path.join(root, 'release-desktop', `${pkg.version}-${commit.slice(0, 12)}`);
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}. Preserve it and use a clean output before rebuilding.`);
  run(process.execPath, ['node_modules/electron-builder/cli.js', '--linux', 'AppImage', 'deb', '--publish', 'never', `--config.directories.output=${output}`], { env });
  const asar = require('@electron/asar');
  const archive = path.join(output, 'linux-unpacked', 'resources', 'app.asar');
  validatePackagePaths(asar.listPackage(archive));
  const packagedMeta = JSON.parse(asar.extractFile(archive, 'dist/build-metadata.json').toString());
  const packagedPkg = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  validateBuild(packagedMeta, packagedPkg, commit);
  const provenance = { ...packagedMeta, source: 'https://github.com/Talent620/Jarvis', node: process.version,
    electron: require('electron/package.json').version, artifactVerification: 'archive structure, provenance, license flag, private-path exclusion',
    nativeLaunch: 'NOT_RUN: requires an authorized graphical session with working Electron sandbox',
    dependencyLicenses: dependencyLicenses(root) };
  fs.writeFileSync(path.join(output, 'PROVENANCE.json'), JSON.stringify(provenance, null, 2) + '\n');
  const names = ['JARVIS.AppImage', 'JARVIS.deb', 'PROVENANCE.json'];
  const checksums = names.map((name) => {
    const file = path.join(output, name), body = fs.readFileSync(file);
    if (!body.length) throw new Error(`Empty artifact: ${name}`);
    if (name.endsWith('.AppImage') && body.subarray(0, 4).toString('hex') !== '7f454c46') throw new Error('AppImage is not ELF.');
    if (name.endsWith('.deb') && body.subarray(0, 8).toString() !== '!<arch>\n') throw new Error('Debian artifact is not an ar package.');
    return `${nodeCrypto.createHash('sha256').update(body).digest('hex')}  ${name}`;
  });
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), checksums.join('\n') + '\n');
  console.log(`Verified package structure and provenance: ${output}`);
  console.log('Native installation, upgrade, rollback and real-model acceptance still require their own evidence.');
}
module.exports = { validateBuild, validatePackagePaths, dependencyLicenses, main };
if (require.main === module) {
  try { main(); } catch (error) { console.error(`Release blocked: ${error.message}`); process.exitCode = 2; }
}
