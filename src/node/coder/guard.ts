// Policy for coding agents (M11): what an agent may never do on its own, checked on every event it
// reports, and redaction of anything secret before a line leaves the main process. The agent's
// own sandbox (Codex workspace-write, Claude's working directory) is the first wall; this is the
// second: a violation stops the task at once and is reported, never silently allowed.

import { devNull } from "node:os";
import * as path from "node:path";

export interface GuardPolicy {
  /** The user explicitly allowed pushing this task's branch (never force, never main/master). */
  allowPush?: boolean;
  /** "no release" and similar, in the user's words or as keys ("no-release", "no-commit"). */
  constraints?: string[];
}

const ALWAYS: [RegExp, string][] = [
  [/\bgit\s+push\b[^|;&]*(?:\s--force(?:-with-lease)?\b|\s-f\b|\s\+\S)/, "force push"],
  [/\bgit\s+reset\s+[^|;&]*--hard\b/, "git reset --hard"],
  [/\bgit\s+clean\b[^|;&]*(?:\s-[a-z]*f|\s--force\b)/i, "git clean -f"],
  [/\bgit\s+branch\s+[^|;&]*(?:-f\b|--force\b)/, "moving a branch by force"],
  [/\bgit\s+update-ref\b/, "history rewrite (update-ref)"],
  [/\bgit\s+checkout\s+[^|;&]*--\s+\.(?:\s|$)/, "discarding uncommitted changes"],
  [/\bgit\s+(?:filter-branch|filter-repo)\b/, "history rewrite"],
  [/\bgit\s+rebase\b/, "history rewrite (rebase)"],
  [/\bgit\s+commit\b[^|;&]*--amend\b/, "history rewrite (amend)"],
  [/\bgit\s+(?:checkout|restore)\s+(?:--\s+)?\.(?:\s|$)|\bgit\s+restore\s+[^|;&]*--staged\s+--worktree\s+\./, "discarding uncommitted changes"],
  [/\bgit\s+stash\s+(?:drop|clear)\b/, "dropping stashed changes"],
  [/\bgit\s+branch\s+[^|;&]*-D\b/, "deleting a branch"],
  [/\bgit\s+push\b[^|;&]*\s(?:origin\s+)?(?:HEAD:)?(?:main|master)\b/, "push to main/master"],
  [/\bgit\s+push\b[^|;&]*--tags\b/, "pushing tags (release)"],
  [/\b(?:npm|pnpm|yarn)\s+(?:npm\s+)?publish\b/, "publishing a package (release)"],
  [/\bgh\s+release\s+(?:create|upload|edit)\b/, "publishing a release"],
  [/\bgh\s+pr\s+merge\b/, "merging a pull request"],
  [/\b(?:vercel\s+[^|;&]*--prod|netlify\s+deploy\s+[^|;&]*--prod|fly\s+deploy|firebase\s+deploy|kubectl\s+apply)\b/, "production deploy"],
  [/\brm\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*[rR][a-zA-Z]*\s+(?:-[a-zA-Z]+\s+)*["']?(?:\/|~|\$HOME|\.\.)/, "deleting outside the workspace"],
  [/\b(?:printenv|env)\s*(?:$|\|)|\bcat\s+[^|;&]*(?:\.env\b|\.codex\/auth\.json|\.claude\/\.credentials)/, "reading secrets"],
];

const RELEASE: [RegExp, string][] = [
  [/\bnpm\s+version\b/, "version bump (release)"],
  [/\bgit\s+tag\b/, "tagging a release"],
  [/\b(?:npm|pnpm|yarn)\s+run\s+(?:release|publish|deploy)\b/, "release script"],
  [/\belectron-builder\b[^|;&]*--publish\s+always/, "publishing a build"],
];

const COMMIT: [RegExp, string][] = [[/\bgit\s+commit\b/, "commit (the user said not to commit)"]];

export function constraintKeys(constraints: string[] = []): Set<string> {
  const keys = new Set<string>();
  for (const c of constraints) {
    const n = c.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");
    if (/no-release|release|wydan|publik|deploy/.test(n)) keys.add("no-release");
    if (/no-commit|nie (?:rob )?commit|bez commit|nie commituj/.test(n)) keys.add("no-commit");
    if (/tests-first|najpierw (?:prze)?testuj|najpierw test/.test(n)) keys.add("tests-first");
  }
  return keys;
}

/** A command the agent is about to run or ran: the violation, or null. */
/**
 * The same command without git's global options (`git -C x`, `git -c k=v`, `--no-pager`,
 * `--git-dir=..`), which would otherwise hide `push -f` or `reset --hard` from the patterns.
 */
export function normalizeCommand(command: string): string {
  let cmd = command.replace(/\s+/g, " ");
  const opt = /\bgit((?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)|-c\s+\S+|--no-pager|--paginate|-p|--no-replace-objects|--bare|--literal-pathspecs|--(?:git-dir|work-tree|namespace|exec-path)(?:=\S+|\s+\S+)))+)(?=\s)/g;
  cmd = cmd.replace(opt, "git");
  return cmd;
}

export function commandViolation(command: string, policy: GuardPolicy = {}): string | null {
  const cmd = normalizeCommand(command);
  for (const [re, what] of ALWAYS) if (re.test(cmd)) return what;
  if (/\bgit\s+push\b/.test(cmd) && !policy.allowPush) return "push without your permission";
  const keys = constraintKeys(policy.constraints);
  if (keys.has("no-release")) for (const [re, what] of RELEASE) if (re.test(cmd)) return what;
  if (keys.has("no-commit")) for (const [re, what] of COMMIT) if (re.test(cmd)) return what;
  return null;
}

/** A file the agent touched: outside the workspace is a violation. */
export function pathViolation(file: string, root: string): string | null {
  if (!file) return null;
  const abs = path.isAbsolute(file) ? path.resolve(file) : path.resolve(root, file);
  const rel = path.relative(path.resolve(root), abs);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return `a file outside the workspace (${file})`;
  if (/(^|[\\/])\.git[\\/]/.test(rel)) return `writing inside .git (${file})`;
  return null;
}

// ------------------------------------------------------------------------------- redaction

const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAIza[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
];
const ASSIGN = /\b([A-Za-z_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS?)[A-Za-z_]*)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s"',;]+)/gi;
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

/** Values of secret-looking environment variables of this process (to mask if an agent prints them). */
export function secretEnvValues(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(env)
    .filter(([k, v]) => !!v && v.length >= 8 && /(TOKEN|SECRET|PASSWORD|API_?KEY|PRIVATE|CREDENTIAL|AUTH)/i.test(k))
    .map(([, v]) => v as string);
}

export function redactSecrets(text: string, known: string[] = []): string {
  let s = text;
  for (const v of known) if (v) s = s.split(v).join("[ukryte]");
  for (const re of PATTERNS) s = s.replace(re, "[ukryte]");
  s = s.replace(ASSIGN, (_m, k: string) => `${k}=[ukryte]`);
  s = s.replace(URL_USERINFO, "$1[ukryte]@");
  return s;
}

/** Environment for an agent process: what a CLI needs to run and to find its own login, nothing else. */
export function agentEnv(backend: "codex" | "claude" | "local" | "fake", env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TERM", "TMPDIR", "TEMP", "TMP", "SHELL", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "SystemRoot", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "ComSpec", "PATHEXT", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"];
  // The backend's own login mechanism, handed to that backend's process only (never logged).
  const auth: Record<string, string[]> = {
    codex: ["CODEX_HOME", "OPENAI_API_KEY", "CODEX_API_KEY"],
    claude: ["CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
    local: ["OLLAMA_HOST"],
    fake: ["JARVIS_FAKE_CODER_SCRIPT"],
  };
  const out: NodeJS.ProcessEnv = {};
  for (const k of [...keep, ...auth[backend]]) if (env[k] !== undefined) out[k] = env[k];
  out.NO_COLOR = "1";
  return out;
}

/**
 * JARVIS's own git calls in a workspace: no fsmonitor or hook from the repository can run code
 * with JARVIS's environment, and that environment carries no secret.
 */
export function gitArgs(root: string, args: string[]): string[] {
  return ["-C", root, "-c", "core.fsmonitor=false", "-c", `core.hooksPath=${devNull}`, ...args];
}

export function gitEnv(): NodeJS.ProcessEnv {
  return { ...agentEnv("local"), GIT_TERMINAL_PROMPT: "0" };
}
