import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { extractDataUriAssets, restoreDataUriAssets } from "../src/lib/siteOs";
import { pickSiteStyle } from "../src/lib/webgen";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

describe("Master Interface Polish — spójność wszystkich modułów UI", () => {
  it("każdy interaktywny komponent z .panel-head ma przycisk zamykania .panel-close (×)", () => {
    const dir = "src/components";
    const missing: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx")).sort()) {
      if (file === "ScreenSkeleton.tsx") continue;
      const src = readFileSync(path.join(dir, file), "utf8");
      const heads = (src.match(/className="panel-head"/g) || []).length;
      const closes = (src.match(/className="panel-close"/g) || []).length;
      if (heads > 0 && closes < heads) {
        missing.push(`${file} (heads=${heads}, closes=${closes})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("index.css definiuje motyw Editorial Boutique, szerokości desktopowe (.panel-wide/.panel-xl), .num-tab i landscape 520px", () => {
    const css = readFileSync("src/styles/index.css", "utf8");
    expect(css).toContain("body.theme-editorial");
    expect(css).toContain(".panel.panel-wide");
    expect(css).toContain(".panel.panel-xl");
    expect(css).toContain(".num-tab");
    expect(css).toContain(".menu-filter-bar");
    expect(css).toContain("@media (max-height: 520px)");
  });

  it("brak zabronionych na Chrome 79 / S9 konstrukcji regex (lookbehind / \\p{...}) w zmodyfikowanych modułach", () => {
    for (const file of ["src/lib/siteOs.ts", "src/lib/webgen.ts", "src/components/More.tsx", "src/components/Conversation.tsx"]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/\(\?<[=!]/);
      expect(src).not.toMatch(/\\p\{/);
    }
  });

  it("pickSiteStyle rozpoznaje nowy archetyp boutique (ImPULS Quiet Luxury)", () => {
    expect(pickSiteStyle("Pracownia projektowa i butik cyfrowy w stylu quiet luxury")).toBe("boutique");
  });
});

describe("Site OS 2.0 — ochrona przed ścianą 60 KB (extractDataUriAssets / restoreDataUriAssets)", () => {
  it("wycina 720 KB obraz WebP base64 do lekkiego tokenu i wiernie go przywraca po edycji AI", () => {
    const hugeBase64 = "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=".repeat(16_000);
    const dataUri = `data:image/webp;base64,${hugeBase64}`;
    const originalHtml = `<!doctype html><html lang="pl"><body><h1>Pracownia</h1><img src="${dataUri}" alt="Folio"></body></html>`;
    expect(originalHtml.length).toBeGreaterThan(900_000);

    const { strippedHtml, assets } = extractDataUriAssets(originalHtml);
    expect(strippedHtml.length).toBeLessThan(2_000);
    expect(strippedHtml).toContain("__JARVIS_ASSET_0__");
    expect(assets.size).toBe(1);

    const aiEdited = strippedHtml.replace("<h1>Pracownia</h1>", "<h1>Pracownia ImPULS</h1>");
    const restored = restoreDataUriAssets(aiEdited, assets);
    expect(restored).toContain("<h1>Pracownia ImPULS</h1>");
    expect(restored).toContain(dataUri);
    expect(restored.length).toBe(originalHtml.length + " ImPULS".length);
  });
});

describe("Site OS 2.0 — żywy serwer: izolacja tunelu, rate-limit parowania, Magic Bytes, Upsert i SSE", () => {
  it("przechodzi pełny smoke test + blokuje brute-force /api/pair + waliduje PNG vs SVG + wysyła SSE", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "jarvis-siteos2-test-"));
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      SITE_OS_PORT: String(port),
      SITE_OS_DATA_DIR: path.join(tmpDir, "data"),
      SITE_OS_RUNTIME_DIR: path.join(tmpDir, "runtime"),
      SITE_OS_TOOLS_DIR: path.join(tmpDir, "tools"),
      SITE_OS_URL: baseUrl,
    };

    const srv = spawn(process.execPath, ["site-os/server.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Site OS startup timeout")), 8000);
        srv.stdout.on("data", (chunk) => {
          if (String(chunk).includes("Edytor:")) {
            clearTimeout(timer);
            resolve();
          }
        });
        srv.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Site OS exited prematurely: ${code}`));
        });
      });

      // 1. Oficjalny skrypt smoke.mjs (tunel 403, SVG 415, jarvisProjectId upsert, leady)
      const smokeCode = await new Promise<number>((resolve) => {
        const sm = spawn(process.execPath, ["site-os/scripts/smoke.mjs"], { env, stdio: "ignore" });
        sm.once("exit", (code) => resolve(code ?? 1));
      });
      expect(smokeCode).toBe(0);

      // 2. Pobranie sesji lokalnej i weryfikacja prawdziwego 1×1 PNG przez Magic Bytes
      const sessRes = await fetch(`${baseUrl}/api/session`, {
        headers: { "X-SiteOS-Client": "cli" },
      });
      const sess = (await sessRes.json()) as { token: string };
      expect(sess.token.length).toBeGreaterThan(20);

      const onePxPngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      const upRes = await fetch(`${baseUrl}/api/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.token}` },
        body: JSON.stringify({ dataUrl: `data:image/png;base64,${onePxPngBase64}` }),
      });
      expect(upRes.status).toBe(201);
      const upBody = (await upRes.json()) as { ok: boolean; url: string; mime: string };
      expect(upBody.ok).toBe(true);
      expect(upBody.mime).toBe("image/png");

      // Publiczny odczyt zweryfikowanej grafiki również przez tunel (nosniff)
      const pubImg = await fetch(`${baseUrl}${upBody.url}`, {
        headers: { "CF-Connecting-IP": "198.51.100.7" },
      });
      expect(pubImg.status).toBe(200);
      expect(pubImg.headers.get("x-content-type-options")).toBe("nosniff");

      // 3. Strumień SSE /api/events dostarcza powiadomienie command-queued w czasie rzeczywistym
      const projsRes = await fetch(`${baseUrl}/api/projects`, {
        headers: { Authorization: `Bearer ${sess.token}` },
      });
      const projs = (await projsRes.json()) as { projects: { id: string }[] };
      const projectId = projs.projects[0].id;

      const sseCtrl = new AbortController();
      const sseRes = await fetch(`${baseUrl}/api/events?token=${encodeURIComponent(sess.token)}`, {
        signal: sseCtrl.signal,
      });
      expect(sseRes.status).toBe(200);
      const reader = sseRes.body!.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      const readUntilQueued = (async () => {
        while (!sseBuffer.includes("event: command-queued")) {
          const { value, done } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
        }
        return sseBuffer;
      })();

      await fetch(`${baseUrl}/api/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.token}` },
        body: JSON.stringify({ projectId, prompt: "Dodaj kompas decyzyjny" }),
      });

      const receivedSse = await Promise.race([
        readUntilQueued,
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error("SSE timeout")), 3000)),
      ]);
      expect(receivedSse).toContain("event: command-queued");
      sseCtrl.abort();

      // 4. Rate-limit parowania /api/pair (po 5 błędnych kodach → 429)
      let lastStatus = 0;
      for (let i = 0; i < 6; i++) {
        const pairRes = await fetch(`${baseUrl}/api/pair`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: "000000" }),
        });
        lastStatus = pairRes.status;
      }
      expect(lastStatus).toBe(429);
    } finally {
      if (!srv.killed) {
        await new Promise<void>((resolve) => {
          srv.once("exit", () => resolve());
          srv.kill("SIGTERM");
          setTimeout(() => {
            try { srv.kill("SIGKILL"); } catch { /* ignore */ }
            resolve();
          }, 1500);
        });
      }
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);
});
