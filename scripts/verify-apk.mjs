#!/usr/bin/env node
// === Weryfikacja realnego stanu APK z GitHub Releases ===
// Pobiera najnowszy asset .apk do /tmp, sprawdza apksigner (V1/V2/V3), zipalign oraz
// brak ryzykownych uprawnień Play Protect (AccessibilityService, QUERY_ALL_PACKAGES).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function run(cmd, argv) {
  try {
    return { ok: true, out: execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (e) {
    return { ok: false, out: String(e.stdout || e.stderr || e.message || "").trim() };
  }
}

const args = process.argv.slice(2);
const tagIdx = args.indexOf("--tag");
const wantTag = tagIdx >= 0 && args[tagIdx + 1] ? args[tagIdx + 1] : null;

const dir = mkdtempSync(join(tmpdir(), "jarvis-apk-"));
try {
  const rel = run("gh", ["release", "view", ...(wantTag ? [wantTag] : []), "--json", "tagName,assets"]);
  if (!rel.ok) {
    console.log(JSON.stringify({ status: "UNKNOWN", reason: `gh release view failed: ${rel.out}` }));
    process.exit(0);
  }
  const meta = JSON.parse(rel.out);
  const dl = run("gh", ["release", "download", meta.tagName, "-p", "*.apk", "-D", dir]);
  if (!dl.ok) {
    console.log(JSON.stringify({ status: "UNKNOWN", tag: meta.tagName, reason: `download failed: ${dl.out}` }));
    process.exit(0);
  }
  const apk = readdirSync(dir).find((f) => f.endsWith(".apk"));
  if (!apk) {
    console.log(JSON.stringify({ status: "FAIL", tag: meta.tagName, reason: "Brak pliku .apk w release" }));
    process.exit(1);
  }
  const apkPath = join(dir, apk);
  const sig = run("apksigner", ["verify", "--verbose", apkPath]);
  const zip = run("zipalign", ["-c", "-v", "4", apkPath]);
  const perms = run("aapt", ["dump", "permissions", apkPath]);
  const badging = run("aapt", ["dump", "badging", apkPath]);

  const hasAccessibility = /BIND_ACCESSIBILITY_SERVICE/i.test(perms.out);
  const hasQueryAll = /QUERY_ALL_PACKAGES/i.test(perms.out);
  const vcMatch = badging.out.match(/versionCode='(\d+)'/);

  const result = {
    status: sig.ok && zip.ok && !hasAccessibility && !hasQueryAll ? "PASS" : "FAIL",
    tag: meta.tagName,
    apk,
    versionCode: vcMatch ? Number(vcMatch[1]) : null,
    apksignerOk: sig.ok,
    zipalignOk: zip.ok,
    playProtectSafe: !hasAccessibility && !hasQueryAll,
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "PASS") process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
