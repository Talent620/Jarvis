import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import {
  buildDownloadsCatalog,
  downloadNativeDesktopUpdate,
  nativeDesktopDownloadSupported,
  releasePageUrl,
} from "../src/lib/updater";
import {
  buildFlowDebriefPrompt,
  computeFlowStats,
  FLOW_PRESETS,
  formatCountdown,
  loadParkedThoughts,
  saveParkedThoughts,
  type FlowSession,
} from "../src/lib/flowEngine";
import { resolveScreen } from "../src/lib/navIntent";
import { allCenterIds, duplicateCenterIds } from "../src/lib/centerModel";

const require = createRequire(import.meta.url);
const updaterNative = require("../electron/updater-native.cjs") as {
  isAllowedInitialUrl: (u: string) => boolean;
  isAllowedRedirectUrl: (u: string) => boolean;
  safeFilenameFromUrl: (u: string) => string;
  isPathInsideDir: (dir: string, target: string) => boolean;
  downloadReleaseAsset: (opts: {
    url: string;
    expectedSha256?: string;
    destDir: string;
    onProgress?: (p: { filename: string; receivedBytes: number; totalBytes: number; pct: number; speedBps: number }) => void;
    platform?: string;
    requestFn?: (url: string, opts: unknown, cb: (res: EventEmitter & { statusCode?: number; headers: Record<string, string>; resume: () => void; pipe?: unknown }) => void) => EventEmitter & { destroy: () => void };
  }) => Promise<{
    ok: boolean;
    filePath?: string;
    filename?: string;
    bytes?: number;
    sha256?: string;
    verifiedSha256?: boolean;
    executableSet?: boolean;
    error?: string;
  }>;
};

describe("JARVIS v6 Pioneer — Native Electron Release Downloader (updater-native.cjs)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-upd-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("enforces strict GitHub Releases URL allowlist and rejects untrusted hosts/paths", () => {
    expect(updaterNative.isAllowedInitialUrl("https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.AppImage")).toBe(true);
    expect(updaterNative.isAllowedInitialUrl("https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.exe")).toBe(true);
    expect(updaterNative.isAllowedInitialUrl("http://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.exe")).toBe(false);
    expect(updaterNative.isAllowedInitialUrl("https://evil.example.com/Talent620/Jarvis/releases/download/latest/JARVIS.exe")).toBe(false);
    expect(updaterNative.isAllowedInitialUrl("https://github.com/OtherOwner/Jarvis/releases/download/latest/JARVIS.exe")).toBe(false);
    expect(updaterNative.isAllowedRedirectUrl("https://objects.githubusercontent.com/github-production-release-asset/123")).toBe(true);
    expect(updaterNative.isAllowedRedirectUrl("https://evil.example.com/redirect")).toBe(false);
  });

  it("extracts safe installer filenames and enforces directory containment", () => {
    expect(updaterNative.safeFilenameFromUrl("https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.AppImage")).toBe("JARVIS.AppImage");
    expect(updaterNative.safeFilenameFromUrl("https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.deb")).toBe("JARVIS.deb");
    expect(updaterNative.safeFilenameFromUrl("https://github.com/Talent620/Jarvis/releases/download/latest/jarvis-apex-v4.apk")).toBe("jarvis-apex-v4.apk");
    expect(updaterNative.safeFilenameFromUrl("https://github.com/Talent620/Jarvis/releases/download/latest/malware.sh")).toBe("");
    expect(updaterNative.isPathInsideDir(tmpDir, path.join(tmpDir, "JARVIS.AppImage"))).toBe(true);
    expect(updaterNative.isPathInsideDir(tmpDir, path.join(tmpDir, "..", "outside.AppImage"))).toBe(false);
  });

  it("streams download, verifies SHA256, writes atomically, and sets chmod 0o755 on Linux .AppImage", async () => {
    const payload = Buffer.from("#!/bin/sh\necho JARVIS-AppImage-Mock\n", "utf8");
    const expectedSha = crypto.createHash("sha256").update(payload).digest("hex");
    const progressEvents: number[] = [];

    const mockReq = (_url: string, _opts: unknown, cb: (res: EventEmitter & { statusCode?: number; headers: Record<string, string>; resume: () => void }) => void) => {
      const req = Object.assign(new EventEmitter(), { destroy: () => {} });
      const res = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headers: { "content-length": String(payload.length) },
        resume: () => {},
        pipe: (dest: fs.WriteStream) => {
          dest.write(payload);
          dest.end();
        },
      });
      queueMicrotask(() => {
        cb(res);
        res.emit("data", payload);
        res.emit("end");
      });
      return req;
    };

    const result = await updaterNative.downloadReleaseAsset({
      url: "https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.AppImage",
      expectedSha256: expectedSha,
      destDir: tmpDir,
      platform: "linux",
      onProgress: (p) => progressEvents.push(p.pct),
      requestFn: mockReq,
    });

    expect(result.ok).toBe(true);
    expect(result.verifiedSha256).toBe(true);
    expect(result.executableSet).toBe(true);
    expect(result.sha256).toBe(expectedSha);
    expect(result.filePath).toBe(path.join(tmpDir, "JARVIS.AppImage"));
    expect(progressEvents.includes(100)).toBe(true);
    const stat = fs.statSync(result.filePath!);
    expect((stat.mode & 0o111) !== 0).toBe(true);
  });

  it("rejects corrupted download on SHA256 mismatch and leaves no target file behind", async () => {
    const payload = Buffer.from("corrupted-binary-bytes", "utf8");
    const wrongSha = "a".repeat(64);

    const mockReq = (_url: string, _opts: unknown, cb: (res: EventEmitter & { statusCode?: number; headers: Record<string, string>; resume: () => void }) => void) => {
      const req = Object.assign(new EventEmitter(), { destroy: () => {} });
      const res = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headers: { "content-length": String(payload.length) },
        resume: () => {},
        pipe: (dest: fs.WriteStream) => {
          dest.write(payload);
          dest.end();
        },
      });
      queueMicrotask(() => {
        cb(res);
        res.emit("data", payload);
        res.emit("end");
      });
      return req;
    };

    const result = await updaterNative.downloadReleaseAsset({
      url: "https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.exe",
      expectedSha256: wrongSha,
      destDir: tmpDir,
      platform: "win32",
      requestFn: mockReq,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/SHA256/i);
    expect(fs.existsSync(path.join(tmpDir, "JARVIS.exe"))).toBe(false);
  });
});

describe("JARVIS v6 Pioneer — Multi-Platform Updater Catalog", () => {
  it("builds full Ubuntu (.AppImage + .deb), Windows (.exe), and Android (Safe + Standard APK) catalog", () => {
    const assets = [
      { name: "JARVIS.AppImage", browser_download_url: "https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.AppImage", size: 95_000_000 },
      { name: "JARVIS.deb", browser_download_url: "https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.deb", size: 70_000_000 },
      { name: "JARVIS.exe", browser_download_url: "https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.exe", size: 80_000_000 },
      { name: "jarvis-apex-v4.apk", browser_download_url: "https://github.com/Talent620/Jarvis/releases/download/latest/jarvis-apex-v4.apk", size: 7_500_000 },
    ];
    const catalog = buildDownloadsCatalog(assets, "linux", { sha256: "b".repeat(64), debSha256: "c".repeat(64) });
    expect(catalog.map((c) => c.id)).toEqual(["ubuntu-appimage", "ubuntu-deb", "windows-exe", "android-safe-apk"]);
    expect(catalog[0].recommended).toBe(true);
    expect(catalog[0].sha256).toBe("b".repeat(64));
    expect(catalog[1].sha256).toBe("c".repeat(64));
    expect(releasePageUrl("latest")).toBe("https://github.com/Talent620/Jarvis/releases/tag/latest");
  });

  it("returns clean error if native desktop download is invoked outside Electron", async () => {
    expect(nativeDesktopDownloadSupported()).toBe(false);
    const res = await downloadNativeDesktopUpdate("https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.AppImage");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Electron/i);
  });
});

describe("JARVIS v6 Pioneer — Flow Engine (Momentum, Streak, Parking Myśli, Debrief)", () => {
  it("computes accurate daily minutes, streak days, completion rate, and Momentum score", () => {
    const now = Date.UTC(2026, 10, 27, 14, 0, 0);
    const DAY = 86_400_000;
    const sessions: FlowSession[] = [
      { id: "s1", goal: "Refactor API", presetId: "flow", plannedMinutes: 45, actualMinutes: 45, completed: true, parkedCount: 2, finishedAt: now - 1000 },
      { id: "s2", goal: "Write tests", presetId: "deep", plannedMinutes: 25, actualMinutes: 25, completed: true, parkedCount: 0, finishedAt: now - 3600_000 },
      { id: "s3", goal: "Short break", presetId: "break", plannedMinutes: 5, actualMinutes: 5, completed: true, parkedCount: 0, finishedAt: now - 7200_000 },
      { id: "s4", goal: "Yesterday work", presetId: "deep", plannedMinutes: 25, actualMinutes: 25, completed: true, parkedCount: 1, finishedAt: now - DAY },
      { id: "s5", goal: "Two days ago", presetId: "spark", plannedMinutes: 15, actualMinutes: 15, completed: false, parkedCount: 0, finishedAt: now - 2 * DAY },
    ];
    const stats = computeFlowStats(sessions, now);
    expect(stats.todayMinutes).toBe(70); // break excluded
    expect(stats.todaySessions).toBe(2);
    expect(stats.streakDays).toBe(3);
    expect(stats.completionRatePct).toBe(75);
    expect(stats.momentumScore).toBeGreaterThanOrEqual(70);
    expect(FLOW_PRESETS.length).toBe(4);
    expect(formatCountdown(1505)).toBe("25:05");
    expect(formatCountdown(-5)).toBe("00:00");
  });

  it("persists Parking Myśli thoughts and builds factual debrief prompt", () => {
    const prevStorage = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    const mem = new Map<string, string>();
    (globalThis as unknown as { localStorage: Partial<Storage> }).localStorage = {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => { mem.set(k, String(v)); },
      removeItem: (k: string) => { mem.delete(k); },
    };
    try {
      saveParkedThoughts([{ id: "p1", text: "Sprawdzić fakturę", createdAt: 1000 }]);
      const loaded = loadParkedThoughts();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].text).toBe("Sprawdzić fakturę");

      const prompt = buildFlowDebriefPrompt(
        { id: "s1", goal: "Build Update Center", presetId: "flow", plannedMinutes: 45, actualMinutes: 45, completed: true, parkedCount: 1, finishedAt: 2000 },
        loaded,
      );
      expect(prompt).toContain("45 min");
      expect(prompt).toContain("Build Update Center");
      expect(prompt).toContain("Sprawdzić fakturę");
    } finally {
      if (prevStorage === undefined) {
        delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
      } else {
        (globalThis as unknown as { localStorage?: Storage }).localStorage = prevStorage;
      }
    }
  });
});

describe("JARVIS v6 Pioneer — Navigation & Taxonomy Integrity", () => {
  it("resolves voice/chat screen intents for Flow and Update Center", () => {
    expect(resolveScreen("aktualizuj")?.id).toBe("update");
    expect(resolveScreen("pobierz aktualizację")?.id).toBe("update");
    expect(resolveScreen("tryb skupienia")?.id).toBe("flow");
    expect(resolveScreen("parking myśli")?.id).toBe("flow");
  });

  it("keeps Center taxonomy duplicate-free and includes flow & update", () => {
    expect(duplicateCenterIds()).toEqual([]);
    const ids = allCenterIds();
    expect(ids).toContain("flow");
    expect(ids).toContain("update");
  });
});
