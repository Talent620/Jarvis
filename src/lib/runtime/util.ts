// Small deterministic helpers shared by the runtime.

/** JSON with sorted object keys, so equal arguments always hash the same. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

/**
 * 64-bit hash as 16 hex chars: two independent 32-bit FNV-1a lanes (different offset bases).
 * Not cryptographic; used for dedup keys and change detection. No BigInt (target ES2019).
 */
export function fnv1a64(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

export const hashArgs = (args: unknown): string => fnv1a64(stableStringify(args));

/** Lowercase, strip diacritics and punctuation, collapse spaces. For comparing utterances. */
export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let counter = 0;
export function defaultId(prefix: string): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return `${prefix}_${c.randomUUID()}`;
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Short single-line preview for logs, snapshots and consent screens. */
export function preview(text: string, max = 60): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${Array.from(one).slice(0, max - 1).join("")}…`;
}
