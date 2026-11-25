/**
 * JARVIS FORGE — Isolated Git Worktree Manager.
 *
 * Zapewnia prawdziwą izolację równoległych zadań / podagentów na tym samym repozytorium:
 * - Każdy worker dostaje własny, odizolowany katalog `git worktree` w `<storageDir>/worktrees/<id>`.
 * - Zmiany w worktree NIE dotykają głównego drzewa roboczego dopóki nie przejdą weryfikacji.
 * - Po weryfikacji wykrywa ewentualne konflikty i aplikuje wyłącznie rozłączne zmiany
 *   (albo zwraca jawny raport konfliktu bez cichego nadpisywania!).
 * - Zawsze gwarantuje bezpieczne posprzątanie worktree (`cleanupWorktree`).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { atomicWriteFile, insideRoot } from "./security.mjs";

function gitExec(cwd, args, timeoutMs = 20_000) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  }).trim();
}

/** Sprawdź, czy katalog jest poprawnym repozytorium Git z co najmniej jednym commitem HEAD. */
export function isGitWorktreeCapable(repoRoot) {
  try {
    const head = gitExec(repoRoot, ["rev-parse", "--verify", "HEAD"]);
    return Boolean(head);
  } catch {
    return false;
  }
}

/** Utwórz odizolowane `git worktree --detach HEAD` w katalogu roboczym Forge. */
export function createIsolatedWorktree({ repoRoot, storageDir, taskId = null }) {
  const root = path.resolve(repoRoot);
  if (!isGitWorktreeCapable(root)) {
    throw new Error(`Katalog "${root}" nie jest repozytorium Git z commitem HEAD — izolacja worktree niedostępna.`);
  }
  const baseStorage = path.resolve(storageDir || path.join(root, ".jarvis-forge"));
  const id = (taskId || `wt-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`).replace(/[^A-Za-z0-9._-]/g, "_");
  const worktreePath = path.join(baseStorage, "worktrees", id);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  const baseHead = gitExec(root, ["rev-parse", "HEAD"]);
  gitExec(root, ["worktree", "add", "--detach", worktreePath, baseHead]);

  // Podlinkuj node_modules (read-only symlink), jeśli istnieje w repo bazowym, aby testy w worktree działały błyskawicznie bez kopiowania GB!
  const srcNodeModules = path.join(root, "node_modules");
  const dstNodeModules = path.join(worktreePath, "node_modules");
  let linkedNodeModules = false;
  if (fs.existsSync(srcNodeModules) && !fs.existsSync(dstNodeModules)) {
    try {
      fs.symlinkSync(srcNodeModules, dstNodeModules, "junction");
      linkedNodeModules = true;
    } catch { /* fallback bez symlinku */ }
  }

  return {
    id,
    repoRoot: root,
    worktreePath,
    baseHead,
    linkedNodeModules,
  };
}

/** Zbierz listę wszystkich zmodyfikowanych, utworzonych i usuniętych plików w worktree (bez symlinku node_modules i .jarvis-forge). */
export function listWorktreeChanges(worktreeInfo) {
  const wt = worktreeInfo.worktreePath;
  const raw = gitExec(wt, ["status", "--porcelain=v1", "-uall"]);
  const changes = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.length < 4) continue;
    const status = line.slice(0, 2);
    const rel = line.slice(3).trim().replace(/^"|"$/g, "");
    if (!rel || rel === "node_modules" || rel.startsWith(".jarvis-forge/") || rel === ".jarvis-forge") continue;
    const action = status.includes("D") ? "deleted" : status.includes("?") || status.includes("A") ? "created" : "modified";
    changes.push({ path: rel, action, status });
  }
  return changes;
}

/**
 * Zastosuj zweryfikowane zmiany z jednego lub wielu odizolowanych worktree z powrotem do `repoRoot`.
 * Wykrywa kolizje między równoległymi workerami PRZED zapisem (atomowe odrzucenie przy konflikcie!).
 */
export function mergeWorktreesIntoRepo(repoRoot, worktrees, { allowOverwriteDirty = false } = {}) {
  const root = path.resolve(repoRoot);
  const fileOwners = new Map(); // relPath -> { worktreeId, worktreePath, action }
  const conflicts = [];

  for (const wt of worktrees) {
    const changes = listWorktreeChanges(wt);
    for (const ch of changes) {
      if (fileOwners.has(ch.path)) {
        const prev = fileOwners.get(ch.path);
        conflicts.push({
          path: ch.path,
          reason: `Konflikt równoległej edycji tego samego pliku przez worktree "${prev.worktreeId}" i "${wt.id}".`,
        });
      } else {
        fileOwners.set(ch.path, { worktreeId: wt.id, worktreePath: wt.worktreePath, action: ch.action });
      }
    }
  }

  if (!allowOverwriteDirty && isGitWorktreeCapable(root)) {
    const mainDirty = gitExec(root, ["status", "--porcelain=v1"])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.slice(3).trim().replace(/^"|"$/g, ""));
    for (const dirtyPath of mainDirty) {
      if (fileOwners.has(dirtyPath)) {
        conflicts.push({
          path: dirtyPath,
          reason: `Plik "${dirtyPath}" ma niezatwierdzone zmiany w głównym drzewie roboczym — odmawiam nadpisania.`,
        });
      }
    }
  }

  if (conflicts.length) {
    return { ok: false, mergedFiles: [], conflicts };
  }

  const mergedFiles = [];
  for (const [relPath, owner] of fileOwners.entries()) {
    const dstAbs = insideRoot(root, relPath);
    const srcAbs = insideRoot(owner.worktreePath, relPath);
    if (owner.action === "deleted") {
      if (fs.existsSync(dstAbs)) fs.rmSync(dstAbs, { force: true });
      mergedFiles.push({ path: relPath, action: "deleted", fromWorktree: owner.worktreeId });
    } else {
      const content = fs.readFileSync(srcAbs, "utf8");
      atomicWriteFile(dstAbs, content);
      mergedFiles.push({ path: relPath, action: owner.action, fromWorktree: owner.worktreeId });
    }
  }

  return { ok: true, mergedFiles, conflicts: [] };
}

/** Posprzątaj worktree bezpiecznie (usuwa tymczasowy symlink node_modules, wykonuje `git worktree remove --force`). */
export function cleanupWorktree(worktreeInfo) {
  if (!worktreeInfo || !worktreeInfo.worktreePath) return { ok: true };
  try {
    if (worktreeInfo.linkedNodeModules) {
      const nm = path.join(worktreeInfo.worktreePath, "node_modules");
      try {
        if (fs.lstatSync(nm).isSymbolicLink()) fs.unlinkSync(nm);
      } catch { /* ignore */ }
    }
    gitExec(worktreeInfo.repoRoot, ["worktree", "remove", "--force", worktreeInfo.worktreePath]);
    return { ok: true };
  } catch (e) {
    try {
      fs.rmSync(worktreeInfo.worktreePath, { recursive: true, force: true });
      gitExec(worktreeInfo.repoRoot, ["worktree", "prune"]);
      return { ok: true, cleanedViaFallback: true };
    } catch {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
