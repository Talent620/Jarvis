// Data provenance (mission 5.12). Every value that reaches the runtime carries where it came
// from. Untrusted content is data, never instructions: it cannot pick tools, recipients,
// permissions or goals.

export type Provenance =
  | "USER_INSTRUCTION"
  | "TRUSTED_CONFIG"
  | "LOCAL_STATE"
  | "UNTRUSTED_WEB"
  | "UNTRUSTED_EMAIL"
  | "UNTRUSTED_DOCUMENT"
  | "UNTRUSTED_CLIPBOARD"
  | "TOOL_OUTPUT";

const UNTRUSTED: ReadonlySet<Provenance> = new Set([
  "UNTRUSTED_WEB", "UNTRUSTED_EMAIL", "UNTRUSTED_DOCUMENT", "UNTRUSTED_CLIPBOARD", "TOOL_OUTPUT",
]);

export const isUntrusted = (p: Provenance | undefined): boolean => p === undefined || UNTRUSTED.has(p);

/** A value tagged with its provenance. */
export interface Tagged<T = string> {
  value: T;
  provenance: Provenance;
}

export const tag = <T>(value: T, provenance: Provenance): Tagged<T> => ({ value, provenance });
