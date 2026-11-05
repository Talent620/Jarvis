#!/usr/bin/env node
// Owner-side issuer. Private material is never printed, embedded, uploaded, or overwritten.
import { webcrypto, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function options(argv) {
  const opts = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (['--key-dir', '--private-key', '--public-file', '--output'].includes(value)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error(`Brak wartości ${value}`);
      opts[value.slice(2)] = resolve(argv[++i]);
    } else if (value.startsWith('--')) throw Error(`Nieznana opcja ${value}`);
    else opts.positional.push(value);
  }
  return opts;
}
export function issuerPaths(opts = {}) {
  const directory = opts['key-dir'] || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'jarvis', 'license-issuer');
  return { directory, privateFile: opts['private-key'] || join(directory, 'private.jwk.json'), publicFile: opts['public-file'] || join(root, 'license-public.local.json') };
}
const publicPart = key => ({ kty: key.kty, crv: key.crv, x: key.x, y: key.y });
async function validatePair(jwk) {
  const privateKey = await webcrypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const publicKey = await webcrypto.subtle.importKey('jwk', publicPart(jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const message = webcrypto.getRandomValues(new Uint8Array(32));
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, message);
  if (!await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, message)) throw Error('Niezgodny materiał klucza prywatnego.');
  return privateKey;
}
export async function initIssuer(opts = {}) {
  const paths = issuerPaths(opts);
  let jwk;
  if (existsSync(paths.privateFile)) {
    jwk = JSON.parse(readFileSync(paths.privateFile, 'utf8'));
    await validatePair(jwk);
  } else {
    if (existsSync(paths.publicFile)) throw Error('Istnieje klucz publiczny bez wskazanego klucza prywatnego. Wskaż właściwy --key-dir; nie nadpisuję wystawcy.');
    mkdirSync(dirname(paths.privateFile), { recursive: true, mode: 0o700 });
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
    writeFileSync(paths.privateFile, JSON.stringify(jwk), { flag: 'wx', mode: 0o600 });
  }
  const publicJwk = publicPart(jwk);
  if (existsSync(paths.publicFile)) {
    const current = JSON.parse(readFileSync(paths.publicFile, 'utf8'));
    if (current.d || current.x !== jwk.x || current.y !== jwk.y) throw Error('Istniejący klucz publiczny jest inny. Nie nadpisuję go ani nie rotuję wystawcy automatycznie.');
  } else {
    mkdirSync(dirname(paths.publicFile), { recursive: true });
    writeFileSync(paths.publicFile, JSON.stringify(publicJwk, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
  }
  return { ...paths, fingerprint: createHash('sha256').update(JSON.stringify(publicJwk)).digest('hex') };
}
export async function signToken(jwk, name, days = 0, trial = false) {
  name = String(name || '').trim(); days = Number(days);
  if (!name || name.length > 200) throw Error('Podaj właściciela (1–200 znaków).');
  if (!Number.isSafeInteger(days) || days < 0 || days > 36500 || trial && days === 0) throw Error('Dni: liczba całkowita 0–36500; trial wymaga terminu.');
  const key = await validatePair(jwk);
  const payload = { n: name, t: trial ? 'trial' : days ? 'term' : 'perpetual', iat: Date.now() };
  if (days) payload.exp = payload.iat + days * 86400000;
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(data));
  return data + '.' + Buffer.from(signature).toString('base64url');
}
async function inspect(token, paths) {
  const parts = token.trim().split('.');
  if (parts.length !== 2) throw Error('Niepełny token: wymagane dane.podpis.');
  const pub = JSON.parse(readFileSync(paths.publicFile, 'utf8'));
  if (pub.d) throw Error('Do inspect wymagany jest publiczny plik klucza.');
  const key = await webcrypto.subtle.importKey('jwk', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(parts[1], 'base64url'), Buffer.from(parts[0]));
  if (!valid) throw Error('Podpis NIEPRAWIDŁOWY.');
  const p = JSON.parse(Buffer.from(parts[0], 'base64url'));
  const active = p.exp === undefined || Number.isFinite(p.exp) && p.exp > Date.now();
  console.log(JSON.stringify({ owner: p.n, type: p.t, issued: p.iat, expires: p.exp || null, signature: 'valid', status: active ? 'active' : 'expired' }, null, 2));
  if (!active) process.exitCode = 1;
}
export async function main(argv) {
  const opts = options(argv), [cmd, name, rawDays] = opts.positional;
  const paths = issuerPaths(opts);
  if (cmd === 'init' || cmd === 'genkey') {
    const result = await initIssuer(opts);
    console.log(`Wystawca gotowy. Klucz prywatny (tylko lokalnie): ${result.privateFile}\nKlucz publiczny do budowy desktop/APK: ${result.publicFile}\nSHA-256 wystawcy: ${result.fingerprint}\nZachowaj bezpieczną kopię pliku prywatnego. Kolejne instalacje używają tej samej pary.`);
  } else if (['sign', 'trial'].includes(cmd) && name) {
    const privateFile = opts['private-key'] || (existsSync(join(root, 'license-private.json')) ? join(root, 'license-private.json') : paths.privateFile);
    const jwk = JSON.parse(readFileSync(privateFile, 'utf8'));
    if (existsSync(paths.publicFile)) {
      const pub = JSON.parse(readFileSync(paths.publicFile, 'utf8'));
      if (pub.x !== jwk.x || pub.y !== jwk.y || pub.d) throw Error('Klucz prywatny nie pasuje do publicznej konfiguracji tej instalacji.');
    }
    const token = await signToken(jwk, name, rawDays ?? (cmd === 'trial' ? 14 : 0), cmd === 'trial');
    if (opts.output) { writeFileSync(opts.output, token + '\n', { flag: 'wx', mode: 0o600 }); console.log(`Zapisano licencję: ${opts.output}`); }
    else console.log(token);
  } else if (cmd === 'inspect' && name) await inspect(name, paths);
  else if (cmd === 'help' || !cmd) console.log('Użycie: init | genkey | sign "Właściciel" [dni=0] | trial "Właściciel" [dni=14] | inspect TOKEN\nOpcje: --key-dir KATALOG --private-key PLIK --public-file PLIK --output PLIK');
  else throw Error('Nieznane polecenie. Użyj: npm run license -- help');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`Licencje: ${error.message}`); process.exitCode = 1; });
}
