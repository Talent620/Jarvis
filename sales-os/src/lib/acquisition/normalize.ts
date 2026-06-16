import type { NormalizedLeadInput } from "./ingest";

type AnyObj = Record<string, unknown>;

function asObj(v: unknown): AnyObj {
  return v && typeof v === "object" ? (v as AnyObj) : {};
}
function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

const EMAIL_KEYS = ["email", "e-mail", "email_address", "work_email", "mail"];
const NAME_KEYS = ["name", "full_name", "fullname", "full name", "first_name", "firstname", "contact_name"];
const PHONE_KEYS = ["phone", "phone_number", "phonenumber", "tel", "mobile", "telephone"];
const COMPANY_KEYS = ["company", "company_name", "companyname", "organization", "organisation", "business"];
const POSITION_KEYS = ["position", "title", "job_title", "jobtitle", "role"];
const WEBSITE_KEYS = ["website", "url", "site", "company_website"];
const INDUSTRY_KEYS = ["industry", "sector", "vertical"];
const REGION_KEYS = ["region", "city", "location", "country", "state"];
const MESSAGE_KEYS = ["message", "notes", "comments", "comment", "enquiry", "inquiry", "how_can_we_help"];

/** Pull a value out of a flat object trying several candidate keys (case-insensitive). */
function pick(flat: AnyObj, keys: string[]): string | undefined {
  const lowerMap: AnyObj = {};
  for (const [k, v] of Object.entries(flat)) lowerMap[k.toLowerCase().replace(/\s+/g, "_")] = v;
  for (const key of keys) {
    const hit = str(lowerMap[key.toLowerCase().replace(/\s+/g, "_")]);
    if (hit) return hit;
  }
  return undefined;
}

/** Flatten provider-specific "field arrays" into a flat {key: value} object. */
function flattenFields(payload: AnyObj): AnyObj {
  const flat: AnyObj = { ...payload };

  // Meta / Facebook Lead Ads: { field_data: [{ name, values: [..] }] }
  const fieldData = (payload.field_data ?? asObj(payload.entry)?.field_data) as unknown;
  if (Array.isArray(fieldData)) {
    for (const f of fieldData) {
      const o = asObj(f);
      const key = str(o.name);
      const val = Array.isArray(o.values) ? str(o.values[0]) : str(o.value);
      if (key && val) flat[key] = val;
    }
  }

  // Google Lead Form: { user_column_data: [{ column_id, string_value }] }
  if (Array.isArray(payload.user_column_data)) {
    for (const f of payload.user_column_data) {
      const o = asObj(f);
      const key = str(o.column_id) ?? str(o.column_name);
      const val = str(o.string_value);
      if (key && val) flat[key] = val;
    }
  }

  // Typeform: { form_response: { answers: [{ field:{ref}, type, email/text/phone_number }] } }
  const answers = asObj(payload.form_response).answers;
  if (Array.isArray(answers)) {
    for (const a of answers) {
      const o = asObj(a);
      const ref = str(asObj(o.field).ref) ?? str(o.type);
      const val =
        str(o.email) ?? str(o.text) ?? str(o.phone_number) ?? str(o.url) ?? str(o.choice);
      if (ref && val) flat[ref] = val;
    }
  }

  // Tally: { data: { fields: [{ label, value }] } }
  const tallyFields = asObj(payload.data).fields;
  if (Array.isArray(tallyFields)) {
    for (const f of tallyFields) {
      const o = asObj(f);
      const key = str(o.label) ?? str(o.key);
      const val = str(o.value);
      if (key && val) flat[key] = val;
    }
  }

  // Calendly: { payload: { invitee: { name, email } } } or { invitee: {...} }
  const invitee = asObj(asObj(payload.payload).invitee ?? payload.invitee);
  if (Object.keys(invitee).length) {
    if (str(invitee.name)) flat.name = str(invitee.name);
    if (str(invitee.email)) flat.email = str(invitee.email);
  }

  return flat;
}

/**
 * Convert a raw webhook body from a known (or unknown) provider into a
 * normalized lead. Falls back to flat key heuristics for custom/Zapier/Make.
 */
export function normalizeWebhook(provider: string, body: unknown): NormalizedLeadInput {
  const payload = asObj(body);
  const flat = flattenFields(payload);

  return {
    name: pick(flat, NAME_KEYS) ?? null,
    email: pick(flat, EMAIL_KEYS) ?? null,
    phone: pick(flat, PHONE_KEYS) ?? null,
    companyName: pick(flat, COMPANY_KEYS) ?? null,
    position: pick(flat, POSITION_KEYS) ?? null,
    website: pick(flat, WEBSITE_KEYS) ?? null,
    industry: pick(flat, INDUSTRY_KEYS) ?? null,
    region: pick(flat, REGION_KEYS) ?? null,
    message: pick(flat, MESSAGE_KEYS) ?? null,
    sourceDetail: `Webhook · ${provider}`,
  };
}
