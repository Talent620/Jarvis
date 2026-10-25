// Gmail through the app's backend (BFF) for acceptance runs with --send. Node side of the same
// endpoints the app uses; credentials come from the environment and are never printed.

import type { GmailTransport } from "../../lib/runtime/gmailService";

export function backendGmailTransport(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): GmailTransport {
  const base = baseUrl.replace(/\/$/, "");
  const call = async (path: string, body: unknown) => {
    const res = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: String((data as { error?: string }).error ?? `HTTP ${res.status}`) };
    return data as Record<string, unknown>;
  };
  return {
    id: "backend",
    connected: async () => true,
    send: (m) => call("/v1/gmail/send", { to: m.to, subject: m.subject, body: m.body }),
    list: (o) => call("/v1/gmail/list", { query: o.query, max: o.max }),
  };
}
