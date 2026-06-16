#!/usr/bin/env node
/**
 * End-to-end smoke test for the public integration API used by JARVIS.
 * Hits all four token-authed endpoints against a running, seeded server and
 * asserts status codes + shapes. No deps — uses global fetch (Node 18+).
 *
 *   BASE_URL=http://localhost:3000 INGEST_TOKEN=demo-ingest-token \
 *     node scripts/smoke-public-api.mjs
 *
 * Exit 0 = all good, 1 = a check failed.
 */
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.INGEST_TOKEN || "demo-ingest-token";

let failures = 0;
function check(name, cond, detail = "") {
  const ok = !!cond;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
}

const H = { "content-type": "application/json", "x-ingest-token": TOKEN };
const j = async (res) => { try { return await res.json(); } catch { return {}; } };

async function main() {
  // 1) sync (valid token)
  let r = await fetch(`${BASE}/api/public/sync?limit=5`, { headers: { "x-ingest-token": TOKEN } });
  let d = await j(r);
  check("GET /sync → 200", r.status === 200, `got ${r.status}`);
  check("GET /sync returns leads[]", Array.isArray(d.leads));
  check("GET /sync returns metrics", d.metrics && typeof d.metrics.totalLeads === "number");

  // 2) sync without token → 401
  r = await fetch(`${BASE}/api/public/sync`);
  check("GET /sync no token → 401", r.status === 401, `got ${r.status}`);

  const email = `smoke.${Date.now().toString(36)}@example.com`;

  // 3) inbound lead → 201
  r = await fetch(`${BASE}/api/public/leads`, {
    method: "POST", headers: H,
    body: JSON.stringify({ name: "Smoke Co", companyName: "Smoke Co", email, industry: "fryzjer", region: "Kraków" }),
  });
  d = await j(r);
  check("POST /leads → 201", r.status === 201, `got ${r.status}`);
  check("POST /leads ok:true", d.ok === true);

  // 4) outreach: AI draft + auto-send → 201, sent
  r = await fetch(`${BASE}/api/public/outreach`, {
    method: "POST", headers: H,
    body: JSON.stringify({ email, companyName: "Smoke Co", context: "Smoke test" }),
  });
  d = await j(r);
  check("POST /outreach → 201", r.status === 201, `got ${r.status}`);
  check("POST /outreach sent:true", d.sent === true, JSON.stringify(d));

  // 5) outreach validation: send without email → 422
  r = await fetch(`${BASE}/api/public/outreach`, { method: "POST", headers: H, body: JSON.stringify({ companyName: "No Email" }) });
  check("POST /outreach no email → 422", r.status === 422, `got ${r.status}`);

  // 6) flush queue → 200
  r = await fetch(`${BASE}/api/public/outreach`, { method: "POST", headers: H, body: JSON.stringify({ flushPending: true }) });
  d = await j(r);
  check("POST /outreach flush → 200", r.status === 200, `got ${r.status}`);
  check("POST /outreach flush summary", typeof d.sent === "number");

  // 7) lead-status: won → 200, stage Won
  r = await fetch(`${BASE}/api/public/lead-status`, { method: "POST", headers: H, body: JSON.stringify({ email, status: "won" }) });
  d = await j(r);
  check("POST /lead-status won → 200", r.status === 200, `got ${r.status}`);
  check("POST /lead-status outcome WON", d.outcome === "WON", JSON.stringify(d));

  // 8) lead-status invalid → 422
  r = await fetch(`${BASE}/api/public/lead-status`, { method: "POST", headers: H, body: JSON.stringify({ email, status: "bogus" }) });
  check("POST /lead-status invalid → 422", r.status === 422, `got ${r.status}`);

  // 9) outreach without token → 401
  r = await fetch(`${BASE}/api/public/outreach`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, status: "won" }) });
  check("POST /outreach no token → 401", r.status === 401, `got ${r.status}`);

  console.log(`\n${failures ? "❌" : "✅"} ${failures ? `${failures} check(s) failed` : "All public-API checks passed"}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error("smoke test crashed:", e); process.exit(1); });
