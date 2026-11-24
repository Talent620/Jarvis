#!/usr/bin/env node
// Zdalna blokada współbieżności dla odizolowanych agentów (git ref refs/heads/lock/<task>).
// Atomowa na dowolnym zdalnym repozytorium git dzięki `--force-with-lease=refs/heads/lock/<task>:`.
// Użycie:
//   node scripts/agent-lock.mjs claim <task> [--remote origin] [--agent antigravity]
//   node scripts/agent-lock.mjs release <task> [--remote origin]
//   node scripts/agent-lock.mjs list [--remote origin]

import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const cmd = args[0];
const task = args[1] && !args[1].startsWith("--") ? args[1] : "";

function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const remote = flag("--remote", "origin");
const agent = flag("--agent", "unknown");

function git(argv, allowFail = false) {
  try {
    return { ok: true, out: execFileSync("git", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (e) {
    if (allowFail) return { ok: false, out: String(e.stderr || e.message || "") };
    throw e;
  }
}

function sanitizeTask(t) {
  const clean = (t || "").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  if (!clean) { console.error("Podaj nazwę zadania (np. autocore-ui)."); process.exit(1); }
  return clean;
}

if (cmd === "list") {
  const r = git(["ls-remote", "--heads", remote, "refs/heads/lock/*"]);
  const rows = r.out ? r.out.split(/\r?\n/).filter(Boolean) : [];
  if (!rows.length) { console.log("Brak aktywnych blokad."); process.exit(0); }
  for (const row of rows) {
    const [sha, ref] = row.split(/\s+/);
    console.log(`${ref.replace("refs/heads/lock/", "")}\t${sha.slice(0, 8)}`);
  }
  process.exit(0);
}

if (cmd === "claim") {
  const id = sanitizeTask(task);
  const ref = `refs/heads/lock/${id}`;
  const existing = git(["ls-remote", "--heads", remote, ref]);
  if (existing.out) {
    console.error(`Blokada '${id}' jest już zajęta na ${remote} (${existing.out.split(/\s+/)[0].slice(0, 8)}).`);
    process.exit(2);
  }
  // Atomowe zajęcie refa: oczekuje pustego stanu na zdalnym repozytorium.
  const push = git(["push", remote, `HEAD:${ref}`, `--force-with-lease=${ref}:`], true);
  if (!push.ok) {
    console.error(`Nie udało się zająć blokady '${id}' (wyścig lub błąd push): ${push.out}`);
    process.exit(2);
  }
  console.log(`Zajęto blokadę '${id}' (agent=${agent}, remote=${remote}).`);
  process.exit(0);
}

if (cmd === "release") {
  const id = sanitizeTask(task);
  const ref = `refs/heads/lock/${id}`;
  const del = git(["push", remote, `:${ref}`], true);
  if (!del.ok) {
    console.error(`Nie udało się zwolnić blokady '${id}': ${del.out}`);
    process.exit(1);
  }
  console.log(`Zwolniono blokadę '${id}' (remote=${remote}).`);
  process.exit(0);
}

console.error("Użycie: node scripts/agent-lock.mjs <claim|release|list> [task] [--remote origin] [--agent name]");
process.exit(1);
