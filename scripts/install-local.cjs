// Local owner installation: project dependencies and build only; no system package installation.
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const root = resolve(__dirname, '..');
function parse(argv) {
  const options = { desktop: true };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--apk') { options.apk = true; options.desktop = false; }
    else if (flag === '--desktop') { options.desktop = true; options.apk = false; }
    else if (['--check', '--build-only', '--skip-deps', '--install'].includes(flag)) options[flag.slice(2)] = true;
    else if (['--key-dir', '--public-file', '--out-dir', '--serial'].includes(flag) && argv[i + 1]) options[flag.slice(2)] = argv[++i];
    else throw Error(`Nieznana lub niepełna opcja ${flag}`);
  }
  if (options['out-dir'] && (!options['build-only'] || options.apk)) throw Error('--out-dir jest dostępne tylko z --desktop --build-only.');
  if (options.install && !options.apk) throw Error('--install dotyczy instalacji APK przez adb.');
  return options;
}
function run(file, args, env = process.env, cwd = root) {
  const result = spawnSync(file, args, { cwd, env, stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw Error(`${file} zakończył się błędem ${result.status ?? result.error?.code}.`);
}
function existsCommand(file) {
  const result = spawnSync(file, ['--version'], { stdio: 'ignore', timeout: 10000 });
  return !result.error && result.status === 0;
}
async function main(argv) {
  const options = parse(argv);
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
  const javaProbe = options.apk ? spawnSync(java, ['-version'], { encoding: 'utf8', timeout: 10000 }) : null;
  const javaMajor = Number((`${javaProbe?.stderr || ''}${javaProbe?.stdout || ''}`.match(/version "(\d+)/) || [])[1] || 0);
  const adb = sdk ? join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';
  const requirements = { node: Number(process.versions.node.split('.')[0]) >= 20, npm: existsCommand('npm'), java: options.apk ? javaProbe.status === 0 && javaMajor >= 17 : null, android_sdk: options.apk ? !!sdk && existsSync(join(sdk, 'platforms')) : null, adb: options.install ? existsCommand(adb) : null, graphical_session: options.desktop && process.platform === 'linux' ? !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY) : null };
  console.log(JSON.stringify({ mode: options.apk ? 'APK' : 'desktop', requirements }, null, 2));
  if (options.check) { process.exitCode = Object.values(requirements).includes(false) ? 2 : 0; return; }
  if (!requirements.node || !requirements.npm) throw Error('Wymagane Node.js >=20 i npm.');
  if (options.apk && (!requirements.java || !requirements.android_sdk)) throw Error('APK wymaga JDK 17 i zainstalowanego Android SDK. Ustaw ANDROID_HOME. Niczego nie instaluję systemowo.');
  if (options.install && !requirements.adb) throw Error('Brak adb. Sprawdź Android SDK/platform-tools.');
  if (options.desktop && !options['build-only'] && requirements.graphical_session === false) throw Error('Uruchom instalator w swojej sesji graficznej. Nie ustawiaj fikcyjnego DISPLAY i nie wyłączaj sandboxa.');
  if (!options['skip-deps']) run('npm', ['ci']);
  else if (!existsSync(join(root, 'node_modules/vite'))) throw Error('--skip-deps wymaga istniejących zależności projektu.');
  const { initIssuer } = await import(pathToFileURL(join(__dirname, 'license.mjs')).href);
  const issuer = await initIssuer({ ...(options['key-dir'] ? { 'key-dir': resolve(options['key-dir']) } : {}), ...(options['public-file'] ? { 'public-file': resolve(options['public-file']) } : {}) });
  console.log(`Klucz prywatny właściciela: ${issuer.privateFile}\nWystawca SHA-256: ${issuer.fingerprint}`);
  const buildEnv = { ...process.env, JARVIS_LICENSE_PUBLIC_KEY_FILE: issuer.publicFile, JARVIS_LICENSE_REQUIRED: 'true', APP_BUILD: new Date().toISOString().slice(0, 16).replace('T', ' ') };
  if (options['out-dir']) {
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-b'], buildEnv);
    run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', resolve(options['out-dir'])], buildEnv);
  } else run('npm', ['run', 'build'], buildEnv);
  if (options.apk) {
    run(process.execPath, [join(root, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android'], buildEnv);
    const buildNo = process.env.JARVIS_BUILD_NUMBER || String(Math.floor(Date.now() / 1000));
    if (!/^\d+$/.test(buildNo) || Number(buildNo) > 2100000000 || Number(buildNo) < 1) throw Error('Niepoprawny JARVIS_BUILD_NUMBER.');
    const gradleEnv = { ...buildEnv, JARVIS_BUILD_NUMBER: buildNo };
    if (process.platform === 'win32') run('gradlew.bat', ['assembleRelease', '--no-daemon'], gradleEnv, join(root, 'android'));
    else run('bash', ['./gradlew', 'assembleRelease', '--no-daemon'], gradleEnv, join(root, 'android'));
    const apk = join(root, 'android/app/build/outputs/apk/release/app-release.apk');
    if (!existsSync(apk)) throw Error('Gradle nie utworzył oczekiwanego APK.');
    console.log(`APK: ${apk}`);
    if (options.install) run(adb, [...(options.serial ? ['-s', options.serial] : []), 'install', '-r', apk]);
  } else if (!options['build-only']) run('npm', ['run', 'electron:dev'], buildEnv);
  console.log('Panel właściciela → import private.jwk.json → Generuj klucz licencyjny APK. Używaj tej samej pary przy kolejnych aktualizacjach.');
}
module.exports = { parse, main };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
