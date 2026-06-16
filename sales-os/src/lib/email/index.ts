/**
 * Outbound email delivery. Fetch-based (no SDK deps) with the same degrade-
 * gracefully pattern as the rest of the app: Resend or Mailgun when a key is
 * configured, otherwise a clearly-labelled simulated send so every flow stays
 * testable end-to-end without credentials.
 */

export interface SendEmailArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
}

export interface SendEmailResult {
  ok: boolean;
  provider: "resend" | "mailgun" | "simulated";
  id?: string;
  error?: string;
  simulated: boolean;
}

function defaultFrom(): string {
  return process.env.EMAIL_FROM ?? "Sales <onboarding@resend.dev>";
}

/** True when a real delivery provider is configured. */
export function isEmailLive(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY ||
      (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN),
  );
}

async function sendViaResend(args: SendEmailArgs, apiKey: string): Promise<SendEmailResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: args.from ?? defaultFrom(),
      to: [args.to],
      subject: args.subject,
      text: args.text,
      html: args.html,
    }),
  });
  if (!res.ok) {
    return { ok: false, provider: "resend", error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`, simulated: false };
  }
  const data = (await res.json()) as { id?: string };
  return { ok: true, provider: "resend", id: data.id, simulated: false };
}

async function sendViaMailgun(
  args: SendEmailArgs,
  apiKey: string,
  domain: string,
): Promise<SendEmailResult> {
  const form = new URLSearchParams({
    from: args.from ?? defaultFrom(),
    to: args.to,
    subject: args.subject,
    text: args.text,
  });
  if (args.html) form.set("html", args.html);
  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) {
    return { ok: false, provider: "mailgun", error: `Mailgun ${res.status}: ${(await res.text()).slice(0, 300)}`, simulated: false };
  }
  const data = (await res.json()) as { id?: string };
  return { ok: true, provider: "mailgun", id: data.id, simulated: false };
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  try {
    if (process.env.RESEND_API_KEY) {
      return await sendViaResend(args, process.env.RESEND_API_KEY);
    }
    if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
      return await sendViaMailgun(args, process.env.MAILGUN_API_KEY, process.env.MAILGUN_DOMAIN);
    }
    console.info(`[email] simulated send → ${args.to}: ${args.subject}`);
    return { ok: true, provider: "simulated", id: `sim_${Date.now().toString(36)}`, simulated: true };
  } catch (e) {
    return {
      ok: false,
      provider: isEmailLive() ? (process.env.RESEND_API_KEY ? "resend" : "mailgun") : "simulated",
      error: e instanceof Error ? e.message : String(e),
      simulated: !isEmailLive(),
    };
  }
}
