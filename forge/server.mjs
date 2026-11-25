#!/usr/bin/env node
/**
 * JARVIS FORGE — Lokalny serwer HTTP + SSE (Loopback-only, 127.0.0.1:3220).
 *
 * Wzorowany na utwardzonym `site-os/server.mjs`:
 * - Wyłącznie loopback (`127.0.0.1`), ochrona przed DNS rebinding (`Host`),
 *   brak akceptacji `Origin: null` i obcych originów, wymagany nagłówek `X-Forge-Client`,
 *   losowy token sesyjny zapisywany w `.jarvis-forge/runtime/connection.json` (dla Electrona IPC).
 * - Twardy limit klientów SSE (`MAX_SSE_CLIENTS = 16`) i czyste zwalnianie timerów.
 * - Klucze API przekazane z UI Jarvisa w `POST /api/runs` żyją wyłącznie w pamięci RAM na czas runu
 *   i NIGDY nie są zapisywane w logach, checkpointach ani pamięci doświadczeń.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteFile, redactDeep, safeEqual } from "./security.mjs";
import { buildRepoMap, scanRepository } from "./repo-intel.mjs";
import { createExperienceMemory } from "./memory.mjs";
import { createProviderPool } from "./providers.mjs";
import { verifyModalPromoStatus } from "./budget.mjs";
import { createForgeStore, executeCompetitiveForgeRun, executeForgeRun, rollbackForgeRun } from "./engine.mjs";

const VERSION = "1.0.0";
const MAX_BODY_BYTES = 1_500_000;
const MAX_SSE_CLIENTS = Math.max(4, Number(process.env.FORGE_MAX_SSE_CLIENTS || 16));
const ALLOWED_CLIENTS = new Set(["jarvis-ui", "cli", "electron"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isLoopbackAddress(addr) {
  const ip = String(addr || "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function isLocalOrigin(origin) {
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    const u = new URL(origin);
    return (u.protocol === "http:" || u.protocol === "https:") && LOOPBACK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function isAllowedHostHeader(hostHeader) {
  if (!hostHeader) return false;
  const host = String(hostHeader).trim().toLowerCase().replace(/:\d+$/, "");
  return LOOPBACK_HOSTS.has(host);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Forge-Token, X-Forge-Client, Authorization",
    Vary: "Origin",
  };
  if (origin && isLocalOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function isTrustedSessionRequest(req) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return false;
  if (!isAllowedHostHeader(req.headers.host)) return false;
  if (req.headers["x-forwarded-for"] || req.headers["cf-connecting-ip"] || req.headers.forwarded) return false;
  const client = String(req.headers["x-forge-client"] || "").trim().toLowerCase();
  if (!ALLOWED_CLIENTS.has(client)) return false;
  if (!isLocalOrigin(req.headers.origin)) return false;
  return true;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Payload przekracza limit 1.5 MB."));
        return;
      }
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!raw.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("Niepoprawny JSON w treści żądania.")); }
    });
    req.on("error", reject);
  });
}

function sendJson(req, res, status, payload) {
  const safe = redactDeep(payload).value;
  const body = JSON.stringify(safe, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(req),
  });
  res.end(body);
}

/** Utwórz instancję serwera Jarvis Forge (eksportowalne do testów integracyjnych bez zamykania procesu). */
export function createForgeServer({
  defaultRepoRoot = process.cwd(),
  port = Number(process.env.FORGE_PORT || 3220),
  host = "127.0.0.1",
  runtimeDir = process.env.FORGE_RUNTIME_DIR || path.join(defaultRepoRoot, ".jarvis-forge", "runtime"),
  providerPool: injectedPool = null,
} = {}) {
  const rootDefault = path.resolve(defaultRepoRoot);
  const token = crypto.randomBytes(24).toString("hex");
  const pool = injectedPool || createProviderPool({ memory: createExperienceMemory(rootDefault) });
  const activeRuns = new Map(); // runId -> { controller, pauseRequested, repoRoot }
  const sseClients = new Set(); // { res, runId, keepAlive }

  const broadcastSse = (runId, event, state) => {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(redactDeep({ event, state }).value)}\n\n`;
    for (const client of [...sseClients]) {
      if (client.runId && client.runId !== runId) continue;
      try {
        if (client.res.writableEnded || client.res.destroyed) {
          clearInterval(client.keepAlive);
          sseClients.delete(client);
          continue;
        }
        client.res.write(payload);
      } catch {
        clearInterval(client.keepAlive);
        sseClients.delete(client);
      }
    }
  };

  const resolveRepoRoot = (requested) => {
    const candidate = requested ? path.resolve(String(requested)) : rootDefault;
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      throw new Error(`Katalog repozytorium nie istnieje: ${candidate}`);
    }
    return candidate;
  };

  const isAuthorized = (req) => {
    if (!isLoopbackAddress(req.socket?.remoteAddress) || !isAllowedHostHeader(req.headers.host)) return false;
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const headerTok = String(req.headers["x-forge-token"] || "").trim();
    return safeEqual(headerTok, token) || safeEqual(bearer, token);
  };

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const pathname = urlObj.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }

    if (!isLoopbackAddress(req.socket?.remoteAddress) || !isAllowedHostHeader(req.headers.host)) {
      sendJson(req, res, 403, { ok: false, error: "Dostęp do Jarvis Forge jest ograniczony wyłącznie do lokalnego loopback (127.0.0.1)." });
      return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      const store = createForgeStore(rootDefault);
      const mem = createExperienceMemory(rootDefault).getSnapshot();
      sendJson(req, res, 200, {
        ok: true,
        name: "JARVIS Forge",
        version: VERSION,
        defaultRepoRoot: rootDefault,
        hardware: pool.hardware,
        activeRuns: activeRuns.size,
        storedRuns: store.listRuns(50).length,
        lessonsCount: mem.lessons.length,
        decisionsCount: mem.decisions.length,
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/session") {
      if (!isTrustedSessionRequest(req)) {
        sendJson(req, res, 403, { ok: false, error: "Odmowa sesji — wymagany zaufany lokalny klient (X-Forge-Client)." });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...corsHeaders(req),
      });
      res.end(JSON.stringify({ ok: true, token, defaultRepoRoot: rootDefault, version: VERSION }));
      return;
    }

    // Wszystkie poniższe trasy wymagają tokenu sesyjnego
    if (!isAuthorized(req)) {
      sendJson(req, res, 401, { ok: false, error: "Wymagany poprawny token X-Forge-Token." });
      return;
    }

    try {
      if (req.method === "GET" && pathname === "/api/providers") {
        const costPolicy = urlObj.searchParams.get("costPolicy") || "zero_cost";
        const probe = urlObj.searchParams.get("probe") !== "0";
        const providers = await pool.getProviderMatrix({ costPolicy, probeLocal: probe });
        sendJson(req, res, 200, { ok: true, hardware: pool.hardware, costPolicy, providers });
        return;
      }

      if (req.method === "POST" && pathname === "/api/providers/status") {
        const body = await readJsonBody(req);
        const costPolicy = String(body.costPolicy || "zero_cost");
        const providers = await pool.getProviderMatrix({
          costPolicy,
          overrideKeys: body.providerKeys || {},
          probeLocal: body.probe !== false,
        });
        sendJson(req, res, 200, { ok: true, hardware: pool.hardware, costPolicy, providers });
        return;
      }

      if (req.method === "GET" && pathname === "/api/repo/inspect") {
        const targetRepo = resolveRepoRoot(urlObj.searchParams.get("path"));
        const query = urlObj.searchParams.get("query") || "";
        const idx = scanRepository(targetRepo);
        const map = buildRepoMap(idx, { query, maxChars: 4500 });
        sendJson(req, res, 200, {
          ok: true,
          repoRoot: targetRepo,
          profile: idx.profile,
          totalFiles: idx.totalFiles,
          edgeCount: idx.edgeCount,
          coreModules: idx.coreModules,
          repoMap: map.text,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/memory") {
        const targetRepo = resolveRepoRoot(urlObj.searchParams.get("path"));
        const mem = createExperienceMemory(targetRepo);
        sendJson(req, res, 200, { ok: true, repoRoot: targetRepo, memory: mem.getSnapshot() });
        return;
      }

      if (req.method === "GET" && pathname === "/api/budget/modal") {
        const status = verifyModalPromoStatus();
        sendJson(req, res, 200, { ok: true, modalPromoStatus: status });
        return;
      }

      if (req.method === "GET" && pathname === "/api/runs") {
        const targetRepo = resolveRepoRoot(urlObj.searchParams.get("path"));
        const store = createForgeStore(targetRepo);
        sendJson(req, res, 200, { ok: true, repoRoot: targetRepo, runs: store.listRuns(30) });
        return;
      }

      if (req.method === "POST" && pathname === "/api/runs") {
        const body = await readJsonBody(req);
        const goal = String(body.goal || "").trim();
        if (!goal) {
          sendJson(req, res, 400, { ok: false, error: "Podaj cel zadania (pole 'goal')." });
          return;
        }
        const targetRepo = resolveRepoRoot(body.repoPath);
        const useWorktree = body.useWorktree === true;
        // Ochrona współbieżności: 2 zadania bez izolacji worktree NIE mogą modyfikować tego samego katalogu roboczego!
        if (!useWorktree) {
          const conflicting = [...activeRuns.entries()].find(([, meta]) => meta.repoRoot === targetRepo && !meta.useWorktree);
          if (conflicting) {
            sendJson(req, res, 409, {
              ok: false,
              error: `W katalogu "${targetRepo}" trwa już aktywne zadanie (${conflicting[0]}). Użyj useWorktree: true dla równoległej izolacji lub poczekaj na zakończenie.`,
            });
            return;
          }
        }
        const costPolicy = String(body.costPolicy || "zero_cost");
        const controller = new AbortController();
        const runControl = { controller, pauseRequested: false, repoRoot: targetRepo, useWorktree };
        let assignedId = null;

        // Uruchom asynchronicznie (lub synchronicznie gdy `wait: true` — wygodne w testach/CLI)
        const promise = executeForgeRun({
          goal,
          repoRoot: targetRepo,
          providerPool: pool,
          costPolicy,
          promoBudget: body.promoBudget || null,
          useWorktree,
          adaptive: body.adaptive !== false,
          leanSimple: body.leanSimple === true,
          overrideKeys: body.providerKeys || {},
          maxIterations: Math.min(30, Math.max(2, Number(body.maxIterations) || 12)),
          maxRepairCycles: Math.min(6, Math.max(1, Number(body.maxRepairCycles) || 3)),
          verifyCommands: Array.isArray(body.verifyCommands) ? body.verifyCommands : null,
          signal: controller.signal,
          shouldPause: () => runControl.pauseRequested,
          onEvent: (ev, st) => {
            if (!assignedId) {
              assignedId = st.id;
              activeRuns.set(st.id, runControl);
            }
            broadcastSse(st.id, ev, st);
          },
        }).finally(() => {
          if (assignedId) activeRuns.delete(assignedId);
        });

        if (body.wait === true) {
          const finalState = await promise;
          sendJson(req, res, 200, { ok: true, run: finalState });
          return;
        }

        const deadline = Date.now() + 2000;
        while (!assignedId && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 25));
        }
        const store = createForgeStore(targetRepo);
        const snapshot = assignedId ? store.loadRun(assignedId) : null;
        sendJson(req, res, 202, { ok: true, runId: assignedId, run: snapshot });
        return;
      }

      if (req.method === "POST" && pathname === "/api/runs/competitive") {
        const body = await readJsonBody(req);
        const goal = String(body.goal || "").trim();
        if (!goal) {
          sendJson(req, res, 400, { ok: false, error: "Podaj cel zadania (pole 'goal')." });
          return;
        }
        const targetRepo = resolveRepoRoot(body.repoPath);
        const result = await executeCompetitiveForgeRun({
          goal,
          repoRoot: targetRepo,
          providerPool: pool,
          candidates: Array.isArray(body.candidates) ? body.candidates : [],
          costPolicy: String(body.costPolicy || "zero_cost"),
          promoBudget: body.promoBudget || null,
          overrideKeys: body.providerKeys || {},
          maxIterations: Math.min(24, Math.max(2, Number(body.maxIterations) || 12)),
          maxRepairCycles: Math.min(4, Math.max(1, Number(body.maxRepairCycles) || 2)),
          verifyCommands: Array.isArray(body.verifyCommands) ? body.verifyCommands : null,
          applyWinner: body.applyWinner !== false,
        });
        sendJson(req, res, 200, { ok: result.ok, competitive: result });
        return;
      }

      const runMatch = pathname.match(/^\/api\/runs\/([A-Za-z0-9._-]+)(?:\/(events|pause|resume|cancel|rollback))?$/);
      if (runMatch) {
        const [, runId, action] = runMatch;
        const targetRepo = resolveRepoRoot(urlObj.searchParams.get("path"));
        const store = createForgeStore(targetRepo);

        if (!action && req.method === "GET") {
          const run = store.loadRun(runId);
          if (!run) { sendJson(req, res, 404, { ok: false, error: "Nie znaleziono zadania." }); return; }
          sendJson(req, res, 200, { ok: true, run, events: store.readEvents(runId, 150) });
          return;
        }

        if (action === "events" && req.method === "GET") {
          if (sseClients.size >= MAX_SSE_CLIENTS) {
            res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "5", ...corsHeaders(req) });
            res.end(JSON.stringify({ ok: false, error: "Przekroczono limit równoległych strumieni SSE." }));
            return;
          }
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            ...corsHeaders(req),
          });
          res.write(`event: connected\ndata: ${JSON.stringify({ runId, at: new Date().toISOString() })}\n\n`);
          const keepAlive = setInterval(() => {
            if (res.writableEnded || res.destroyed) { clearInterval(keepAlive); sseClients.delete(client); return; }
            try { res.write(": keep-alive\n\n"); } catch { clearInterval(keepAlive); sseClients.delete(client); }
          }, 20_000);
          const client = { res, runId, keepAlive };
          sseClients.add(client);
          const cleanup = () => { clearInterval(keepAlive); sseClients.delete(client); };
          req.on("close", cleanup);
          res.on("close", cleanup);
          res.on("error", cleanup);
          return;
        }

        if (action === "pause" && req.method === "POST") {
          const active = activeRuns.get(runId);
          if (active) active.pauseRequested = true;
          sendJson(req, res, 200, { ok: true, runId, pauseRequested: Boolean(active) });
          return;
        }

        if (action === "cancel" && req.method === "POST") {
          const active = activeRuns.get(runId);
          if (active) active.controller.abort();
          sendJson(req, res, 200, { ok: true, runId, aborted: Boolean(active) });
          return;
        }

        if (action === "rollback" && req.method === "POST") {
          const body = await readJsonBody(req);
          const repoForRollback = resolveRepoRoot(body.repoPath || urlObj.searchParams.get("path"));
          const resRollback = rollbackForgeRun({ repoRoot: repoForRollback, runId });
          sendJson(req, res, 200, { ok: true, runId, rollback: resRollback });
          return;
        }

        if (action === "resume" && req.method === "POST") {
          const body = await readJsonBody(req);
          const repoForResume = resolveRepoRoot(body.repoPath || urlObj.searchParams.get("path"));
          const controller = new AbortController();
          const runControl = { controller, pauseRequested: false, repoRoot: repoForResume, useWorktree: false };
          activeRuns.set(runId, runControl);
          const promise = executeForgeRun({
            repoRoot: repoForResume,
            providerPool: pool,
            resumeRunId: runId,
            costPolicy: String(body.costPolicy || "zero_cost"),
            promoBudget: body.promoBudget || null,
            overrideKeys: body.providerKeys || {},
            signal: controller.signal,
            shouldPause: () => runControl.pauseRequested,
            onEvent: (ev, st) => broadcastSse(st.id, ev, st),
          }).finally(() => activeRuns.delete(runId));

          if (body.wait === true) {
            const finalState = await promise;
            sendJson(req, res, 200, { ok: true, run: finalState });
            return;
          }
          sendJson(req, res, 202, { ok: true, runId, resumed: true });
          return;
        }
      }

      sendJson(req, res, 404, { ok: false, error: `Nieznana trasa Forge: ${req.method} ${pathname}` });
    } catch (e) {
      sendJson(req, res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  async function start() {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    });
    const addr = server.address();
    const actualPort = typeof addr === "object" && addr ? addr.port : port;
    if (runtimeDir) {
      atomicWriteFile(
        path.join(runtimeDir, "connection.json"),
        JSON.stringify({ url: `http://${host}:${actualPort}`, port: actualPort, token, pid: process.pid, startedAt: new Date().toISOString() }, null, 2) + "\n",
      );
    }
    return { port: actualPort, host, token, url: `http://${host}:${actualPort}` };
  }

  async function close() {
    for (const active of activeRuns.values()) active.controller.abort();
    pool.close?.();
    for (const c of [...sseClients]) {
      clearInterval(c.keepAlive);
      try { c.res.end(); } catch { /* ignore */ }
    }
    sseClients.clear();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, start, close, token, pool };
}

// Bezpośrednie uruchomienie: `node forge/server.mjs`
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const srv = createForgeServer();
  srv.start().then(({ url }) => {
    console.log(`⚒ JARVIS Forge Server v${VERSION} działa na ${url} (loopback-only, 0-USD default)`);
  }).catch((err) => {
    console.error(`❌ Nie udało się uruchomić JARVIS Forge Server: ${err.message}`);
    process.exit(1);
  });
  const shutdown = () => srv.close().finally(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
