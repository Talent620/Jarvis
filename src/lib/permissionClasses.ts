// Action classes and policies (mission 5.11), pure: no store, no UI. permissions.ts maps tools
// to classes and asks the user; the runtime uses the same policy for its micro-actions.

export type ActionClass = "READ" | "NAVIGATE" | "LOCAL_REVERSIBLE" | "LOCAL_WRITE" | "EXTERNAL_SIDE_EFFECT" | "DESTRUCTIVE";
export type Policy = "AUTO" | "ASK" | "DENY";

export const DEFAULT_POLICIES: Record<ActionClass, Policy> = {
  READ: "AUTO",
  NAVIGATE: "AUTO",
  LOCAL_REVERSIBLE: "AUTO",
  LOCAL_WRITE: "AUTO",
  EXTERNAL_SIDE_EFFECT: "ASK",
  DESTRUCTIVE: "ASK",
};

export interface PermissionContext {
  /** The arguments contain untrusted content (web page, e-mail, clipboard, tool output). */
  untrustedContent?: boolean;
  /** The arguments contain private data (contacts, messages, files). */
  privateData?: boolean;
}

/**
 * Final policy for an action class under the user's settings and the data involved.
 * DESTRUCTIVE is never AUTO; untrusted or private data with an external effect is always ASK.
 */
export function decidePolicy(cls: ActionClass, ctx: PermissionContext = {}, overrides?: Partial<Record<ActionClass, Policy>>): Policy {
  const configured = overrides?.[cls] ?? DEFAULT_POLICIES[cls];
  if (configured === "DENY") return "DENY";
  if (cls === "DESTRUCTIVE") return "ASK";
  if (cls === "EXTERNAL_SIDE_EFFECT" && (ctx.untrustedContent || ctx.privateData)) return "ASK";
  return configured;
}
