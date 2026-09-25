import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Regression guard for the leaked Android keystore (M0): no literal passwords, a loud
// non-production fallback without secrets, and no publishing of a non-production APK.
const read = (p: string) => readFileSync(p, "utf8");
const gradle = read("android/app/build.gradle");

describe("android signing", () => {
  it("build.gradle has no literal keystore passwords", () => {
    expect(gradle).not.toMatch(/(?:store|key)Password\s+["']/);
    expect(gradle).not.toContain("jarvis2026");
  });

  it("production signing requires every secret once the store file is set", () => {
    for (const name of ["JARVIS_RELEASE_STORE_PASSWORD", "JARVIS_RELEASE_KEY_ALIAS", "JARVIS_RELEASE_KEY_PASSWORD"]) {
      expect(gradle).toContain(`"${name}"`);
    }
    expect(gradle).toMatch(/throw new GradleException\("JARVIS_RELEASE_STORE_FILE is set but/);
  });

  it("without secrets the release build is debug-signed and marked -nonprod", () => {
    const fallback = gradle.slice(gradle.indexOf("} else {\n                signingConfig signingConfigs.debug"));
    expect(fallback).toContain("signingConfig signingConfigs.debug");
    expect(fallback).toContain('versionNameSuffix "-nonprod"');
    expect(gradle).toContain('resValue "bool", "jarvis_production_signing"');
  });

  it("release workflow refuses to publish without signing secrets, before building", () => {
    const wf = read(".github/workflows/release.yml");
    const guard = wf.indexOf("Require production signing secrets");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(wf.indexOf("assembleRelease"));
    expect(guard).toBeLessThan(wf.indexOf("action-gh-release"));
    expect(wf.slice(guard, wf.indexOf("actions/checkout"))).toMatch(/exit 1/);
  });

  it("no workflow carries a keystore password", () => {
    for (const f of ["android.yml", "android-v2.yml", "release.yml"]) {
      const wf = read(`.github/workflows/${f}`);
      expect(wf).not.toContain("jarvis2026");
      expect(wf).toContain("secrets.JARVIS_RELEASE_STORE_PASSWORD");
    }
  });

  it("secret scan flags a reintroduced literal keystore password", () => {
    const src = read("scripts/secret-scan.mjs");
    const m = src.match(/name: "Hardcoded keystore password", re: (\/.*\/)\s*}/);
    expect(m).not.toBeNull();
    const re = new Function(`return ${m![1]}`)() as RegExp;
    expect(re.test('storePassword "hunter2"')).toBe(true);
    expect(re.test("keyPassword 'x'")).toBe(true);
    expect(re.test('storePassword releaseSecret("JARVIS_RELEASE_STORE_PASSWORD")')).toBe(false);
    expect(re.test('storePassword "${env.PASS}"')).toBe(false);
  });

  it("tracked files pass the secret scan", () => {
    expect(() => execFileSync(process.execPath, ["scripts/secret-scan.mjs", "--all"], { stdio: "pipe" })).not.toThrow();
  });
});
