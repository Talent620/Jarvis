import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, chmodSync, symlinkSync, unlinkSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const dirs: string[] = [];
const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
function fixture(options: { badOwner?: boolean; changed?: boolean; noReceipt?: boolean; alternativesFail?: boolean; unsafeAncestor?: boolean } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "jarvis-postinst-")); dirs.push(dir);
  const app = path.join(dir, "JARVIS"), helper = path.join(app, "chrome-sandbox"), receipt = path.join(dir, "receipt"), log = path.join(dir, "operations");
  mkdirSync(app, { mode: 0o755 });
  const body = "synthetic packaged helper, never executed\n";
  writeFileSync(helper, options.changed ? "tampered helper" : body, { mode: 0o755 });
  chmodSync(helper, 0o755); // Independent from the cloud/user umask.
  if (!options.noReceipt) writeFileSync(receipt, createHash("md5").update(body).digest("hex") + "  opt/JARVIS/chrome-sandbox\n", { mode: 0o644 });
  let script = readFileSync("scripts/linux-after-install.sh", "utf8")
    .replace(/\$\{sanitizedProductName\}/g, "JARVIS").replace(/\$\{executable\}/g, "jarvis-ai-assistant")
    .replace("app_dir='/opt/JARVIS'", `app_dir=${shellQuote(app)}`)
    .replace("receipt='/var/lib/dpkg/info/jarvis-ai-assistant.md5sums'", `receipt=${shellQuote(receipt)}`)
    .replaceAll("/usr/bin/jarvis-ai-assistant", path.join(dir, "launcher"));
  // Simulated dpkg/root boundary: real fixture files, no privileged operations.
  // Neither helper execution nor host configuration is performed by this test.
  const mocks = `\nfixture_helper=${shellQuote(helper)}\nfixture_log=${shellQuote(log)}
id() { if [[ "$1" == '-u' ]]; then echo 0; else /usr/bin/id "$@"; fi; }
stat() {
  if [[ "$2" == '%u' ]]; then ${options.badOwner ? `if [[ "$3" == "$fixture_helper" ]]; then echo 1000; else echo 0; fi` : "echo 0"}
  elif [[ "$2" == '%u:%g:%a' ]]; then echo "0:0:$(/usr/bin/stat -c '%a' "$3")";
  elif [[ "$2" == '%a' && "$3" == '/opt' ]]; then echo ${options.unsafeAncestor ? '777' : '755'};
  elif [[ "$2" == '%a' && ( "$3" == '/' || "$3" == '/var' || "$3" == '/var/lib' || "$3" == '/var/lib/dpkg' || "$3" == '/var/lib/dpkg/info' ) ]]; then echo 755;
  else /usr/bin/stat "$@"; fi
}
chown() { [[ "$1" == 'root:root' && "$2" == "$fixture_helper" ]] || exit 98; echo chown >> "$fixture_log"; }
chmod() { [[ "$2" == "$fixture_helper" ]] || exit 98; echo "chmod $1" >> "$fixture_log"; /usr/bin/chmod "$@"; }
unshare() { echo UNEXPECTED_ROOT_PROBE >> "$fixture_log"; return 0; }
update-alternatives() { echo alternatives >> "$fixture_log"; ${options.alternativesFail ? 'return 1;' : ''} }
update-mime-database() { :; }
update-desktop-database() { :; }
`;
  script = script.replace("export PATH", "export PATH\n" + mocks);
  const file = path.join(dir, "postinst"); writeFileSync(file, script);
  return { helper, app, receipt, log, launcher: path.join(dir, "launcher"), run: () => spawnSync("bash", [file, "configure"], { encoding: "utf8", timeout: 5000 }) };
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("Debian package sandbox configuration", () => {
  it("sets the verified helper to 4755 even when root can create user namespaces", () => {
    const f = fixture(); const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(statSync(f.helper).mode & 0o7777).toBe(0o4755);
    expect(readFileSync(f.log, "utf8")).toBe("chown\nchmod 4755\nalternatives\n");
  });
  it("retains the launch-link fallback when update-alternatives fails", () => {
    const f = fixture({ alternativesFail: true }); const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(statSync(f.helper).mode & 0o7777).toBe(0o4755);
    expect(readlinkSync(f.launcher)).toBe(path.join(f.app, 'jarvis-ai-assistant'));
  });
  it("rejects a writable installation ancestor before privileged changes", () => {
    const f = fixture({ unsafeAncestor: true }); const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('group/world-writable path: /opt');
    expect(statSync(f.helper).mode & 0o7777).toBe(0o755);
    expect(() => readFileSync(f.log)).toThrow();
  });
  it("rejects a modified helper and missing receipt before privileged changes", () => {
    for (const options of [{ changed: true }, { noReceipt: true }, { badOwner: true }]) {
      const f = fixture(options); expect(f.run().status).not.toBe(0);
      expect(statSync(f.helper).mode & 0o7777).toBe(0o755);
      expect(() => readFileSync(f.log)).toThrow();
    }
  });
  it("rejects symlinks and writable helper or installation directory", () => {
    for (const target of ["symlink", "helper", "directory"]) {
      const f = fixture();
      if (target === "symlink") { const sibling = f.helper + ".original"; writeFileSync(sibling, "synthetic"); unlinkSync(f.helper); symlinkSync(sibling, f.helper); }
      else chmodSync(target === "helper" ? f.helper : f.app, 0o777);
      const result = f.run(); expect(result.status, target).not.toBe(0);
      expect(result.stderr).toMatch(/symlink|writable/);
      expect(() => readFileSync(f.log)).toThrow();
    }
  });
  it("selects the custom postinst without disabling isolation", () => {
    const config = JSON.parse(readFileSync("electron-builder.json", "utf8"));
    expect(config.deb.afterInstall).toBe("scripts/linux-after-install.sh");
    const script = readFileSync(config.deb.afterInstall, "utf8");
    expect(script).not.toMatch(/--no-sandbox|sysctl|chmod 0755|unshare --user true/);
  });
});
