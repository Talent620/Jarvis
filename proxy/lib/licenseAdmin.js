// === proxy/lib/licenseAdmin.js — aktywacja/heartbeat licencji + panel administracyjny ===
import { CORS, json, adminOk, verifyToken, signToken, bytesToB64urlW, licPrivKey } from "./auth.js";

const ADMIN_HTML = `<!doctype html><html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>JARVIS — Panel licencji</title>
<style>
:root{--bg:#04070f;--p:#0b1426;--cy:#6ce7ff;--tx:#cfeefb;--dim:#7fa6bd;--line:rgba(108,231,255,.2);--ok:#58e08a;--bad:#ff8585}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 system-ui,sans-serif;padding:18px}
h1{color:var(--cy);font-size:20px}h2{font-size:15px;margin:18px 0 8px}input,select,button{font:inherit;border-radius:10px;border:1px solid var(--line);background:#081020;color:var(--tx);padding:9px 12px}
button{cursor:pointer;background:var(--cy);color:#012;border:none;font-weight:600}button.gh{background:transparent;color:var(--cy);border:1px solid var(--line)}
.card{background:var(--p);border:1px solid var(--line);border-radius:14px;padding:14px;margin:10px 0}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--line)}.k{font-family:monospace;font-size:11px;word-break:break-all}
.pill{font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid var(--line)}.on{color:var(--ok)}.off{color:var(--bad)}.muted{color:var(--dim);font-size:12px}
</style></head><body>
<h1>🔐 JARVIS — Panel licencji</h1>
<div class="card" id="login">
  <div class="row"><input id="tok" type="password" placeholder="Token administratora" style="flex:1"><button onclick="login()">Zaloguj</button></div>
  <div class="muted" id="lerr"></div>
</div>
<div id="app" style="display:none">
  <div class="card"><h2>➕ Wydaj nowy klucz</h2>
    <div class="row">
      <input id="name" placeholder="Imię / firma klienta" style="flex:1">
      <input id="days" type="number" placeholder="Dni (puste = bezterminowy)" style="width:170px">
      <input id="lim" type="number" value="1" min="1" placeholder="Limit urządzeń" style="width:140px">
      <button onclick="issue()">Wygeneruj</button>
    </div>
    <div id="newkey" class="muted" style="margin-top:8px"></div>
  </div>
  <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">📋 Licencje i kto korzysta</h2><button class="gh" onclick="load()">Odśwież</button></div>
    <table id="tbl"><thead><tr><th>Klient</th><th>Typ</th><th>Urządzenia</th><th>Ost. aktywność</th><th>Status</th><th></th></tr></thead><tbody></tbody></table>
  </div>
</div>
<script>
let T=sessionStorage.getItem("jat")||"";
const H=()=>({"x-admin-token":T,"content-type":"application/json"});
function login(){T=document.getElementById("tok").value.trim();sessionStorage.setItem("jat",T);load(true);}
async function load(first){
  const r=await fetch("v1/admin/list",{headers:H()});
  if(!r.ok){document.getElementById("lerr").textContent="❌ Zły token.";return;}
  document.getElementById("login").style.display="none";document.getElementById("app").style.display="block";
  const {licenses}=await r.json();const tb=document.querySelector("#tbl tbody");tb.innerHTML="";
  for(const l of licenses){const tr=document.createElement("tr");
    const last=l.lastSeen?new Date(l.lastSeen).toLocaleString("pl-PL"):"—";
    tr.innerHTML=\`<td>\${l.name}</td><td>\${l.type}\${l.exp?" do "+new Date(l.exp).toLocaleDateString("pl-PL"):""}</td>
    <td>\${l.devices}/\${l.deviceLimit}</td><td class="muted">\${last}</td>
    <td><span class="pill \${l.revoked?'off':'on'}">\${l.revoked?'unieważniona':'aktywna'}</span></td>
    <td class="row"><button class="gh" onclick="rev('\${l.id}',\${!l.revoked})">\${l.revoked?'Przywróć':'Unieważnij'}</button>
    <button class="gh" onclick="resetDev('\${l.id}')">Reset urządzeń</button></td>\`;tb.appendChild(tr);}
}
async function issue(){
  const name=document.getElementById("name").value||"Klient";
  const days=document.getElementById("days").value;const lim=document.getElementById("lim").value||1;
  const r=await fetch("v1/admin/issue",{method:"POST",headers:H(),body:JSON.stringify({name,days:days?+days:0,deviceLimit:+lim})});
  const d=await r.json();
  document.getElementById("newkey").innerHTML=d.key?("✅ Klucz dla <b>"+name+"</b> (skopiuj i wyślij klientowi):<br><span class='k'>"+d.key+"</span>"):("❌ "+(d.error||"błąd"));
  load();
}
async function rev(id,v){await fetch("v1/admin/revoke",{method:"POST",headers:H(),body:JSON.stringify({id,revoked:v})});load();}
async function resetDev(id){if(confirm("Wyzerować urządzenia tej licencji?")){await fetch("v1/admin/reset-devices",{method:"POST",headers:H(),body:JSON.stringify({id})});load();}}
if(T)load(true);
</script></body></html>`;

export async function handleLicenseAdminRoute(path, req, env) {
  if (path === "/v1/license/activate" && req.method === "POST") {
    const { key, device, platform } = await req.json();
    const p = await verifyToken(key);
    if (!p) return json(403, { valid: false, error: "Nieprawidłowy lub wygasły klucz licencyjny." });
    if (!p.id || !env.JARVIS_KV) return json(200, { valid: true, name: p.n, type: p.t });
    const raw = await env.JARVIS_KV.get(`lic:${p.id}`);
    const rec = raw ? JSON.parse(raw) : { id: p.id, name: p.n, type: p.t, exp: p.exp || 0, deviceLimit: 1, revoked: false, devices: [], createdAt: Date.now() };
    if (rec.revoked) return json(403, { valid: false, error: "Licencja została unieważniona przez autora." });
    const dev = String(device || "").slice(0, 64) || "unknown";
    const now = Date.now();
    const ex = rec.devices.find((d) => d.id === dev);
    if (ex) { ex.lastSeen = now; ex.platform = platform || ex.platform; }
    else {
      if (rec.devices.length >= (rec.deviceLimit || 1)) return json(403, { valid: false, error: `Przekroczono limit urządzeń (${rec.deviceLimit}). Skontaktuj się z autorem.` });
      rec.devices.push({ id: dev, platform: platform || "?", firstSeen: now, lastSeen: now });
    }
    rec.lastSeen = now;
    await env.JARVIS_KV.put(`lic:${p.id}`, JSON.stringify(rec));
    return json(200, { valid: true, name: rec.name, type: rec.type, deviceLimit: rec.deviceLimit, devices: rec.devices.length });
  }

  if (path === "/v1/license/check" && req.method === "POST") {
    const { key, device, platform } = await req.json();
    const p = await verifyToken(key);
    if (!p) return json(200, { valid: false });
    if (!p.id || !env.JARVIS_KV) return json(200, { valid: true });
    const raw = await env.JARVIS_KV.get(`lic:${p.id}`);
    if (!raw) return json(200, { valid: true });
    const rec = JSON.parse(raw);
    if (rec.revoked) return json(200, { valid: false, error: "unieważniona" });
    const dev = String(device || "").slice(0, 64);
    const d = rec.devices.find((x) => x.id === dev);
    if (d) { d.lastSeen = Date.now(); d.platform = platform || d.platform; rec.lastSeen = Date.now(); await env.JARVIS_KV.put(`lic:${p.id}`, JSON.stringify(rec)); }
    return json(200, { valid: true });
  }

  if (path === "/admin") {
    return new Response(ADMIN_HTML, { headers: { "content-type": "text/html; charset=utf-8", ...CORS } });
  }
  if (path === "/v1/admin/issue" && req.method === "POST") {
    if (!adminOk(req, env)) return json(401, { error: "Brak uprawnień administratora." });
    const priv = await licPrivKey(env);
    if (!priv) return json(500, { error: "Brak sekretu LICENSE_PRIVATE_JWK w Workerze." });
    const { name, days, deviceLimit } = await req.json();
    const id = bytesToB64urlW(crypto.getRandomValues(new Uint8Array(6)));
    const payload = { n: String(name || "Klient"), t: days ? "term" : "perpetual", id, iat: Date.now() };
    if (days) payload.exp = Date.now() + Number(days) * 86400000;
    const key = await signToken(payload, priv);
    const rec = { id, name: payload.n, type: payload.t, exp: payload.exp || 0, deviceLimit: Number(deviceLimit) || 1, revoked: false, devices: [], createdAt: Date.now() };
    if (env.JARVIS_KV) await env.JARVIS_KV.put(`lic:${id}`, JSON.stringify(rec));
    return json(200, { ok: true, key, ...rec });
  }
  if (path === "/v1/admin/list" && req.method === "GET") {
    if (!adminOk(req, env)) return json(401, { error: "Brak uprawnień." });
    if (!env.JARVIS_KV) return json(200, { licenses: [] });
    const list = await env.JARVIS_KV.list({ prefix: "lic:" });
    const out = [];
    for (const k of list.keys) { const v = await env.JARVIS_KV.get(k.name); if (v) out.push(JSON.parse(v)); }
    out.sort((a, b) => (b.lastSeen || b.createdAt || 0) - (a.lastSeen || a.createdAt || 0));
    return json(200, { licenses: out.map((r) => ({ id: r.id, name: r.name, type: r.type, exp: r.exp, deviceLimit: r.deviceLimit, devices: (r.devices || []).length, lastSeen: r.lastSeen || 0, revoked: r.revoked })) });
  }
  if (path === "/v1/admin/revoke" && req.method === "POST") {
    if (!adminOk(req, env)) return json(401, { error: "Brak uprawnień." });
    const { id, revoked = true } = await req.json();
    const raw = env.JARVIS_KV ? await env.JARVIS_KV.get(`lic:${id}`) : null;
    if (!raw) return json(404, { error: "Nie ma takiej licencji." });
    const rec = JSON.parse(raw); rec.revoked = !!revoked;
    await env.JARVIS_KV.put(`lic:${id}`, JSON.stringify(rec));
    return json(200, { ok: true, revoked: rec.revoked });
  }
  if (path === "/v1/admin/reset-devices" && req.method === "POST") {
    if (!adminOk(req, env)) return json(401, { error: "Brak uprawnień." });
    const { id } = await req.json();
    const raw = env.JARVIS_KV ? await env.JARVIS_KV.get(`lic:${id}`) : null;
    if (!raw) return json(404, { error: "Nie ma takiej licencji." });
    const rec = JSON.parse(raw); rec.devices = [];
    await env.JARVIS_KV.put(`lic:${id}`, JSON.stringify(rec));
    return json(200, { ok: true });
  }

  return null;
}
