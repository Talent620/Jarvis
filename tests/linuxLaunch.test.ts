import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { launchLinux } = require("../electron/launch-app.cjs") as { launchLinux: (name: string) => Promise<string> };

describe("Linux — uruchamianie aplikacji", () => {
  it("potwierdza start istniejącego procesu", async () => {
    expect(await launchLinux("/usr/bin/true")).toBe("ok");
  });
  it("nie udaje startu nieistniejącego programu", async () => {
    expect(await launchLinux("jarvis-nieistniejacy-program-2398493")).toBe("err:not-found");
  });
  it("nie wykonuje poleceń powłoki", async () => {
    expect(await launchLinux("echo; touch /tmp/jarvis-unsafe")).toBe("err:unknown");
  });
});
