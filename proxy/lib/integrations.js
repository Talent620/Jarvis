// === proxy/lib/integrations.js — Sync KV, Tavily, Site Audit, PageSpeed, Embeddings, Google OAuth/Gmail/Calendar, SMTP ===
import { connect } from "cloudflare:sockets";
import {
  json,
  bearer,
  b64,
  b64url,
  noCRLF,
  fetchT,
  appTokenBad,
  rateLimited,
  blocksCloudMetadata,
  isPrivateHost,
} from "./auth.js";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
].join(" ");

async function smtpRelay({ host, port, user, pass, to, subject, body, verifyOnly }) {
  const HOST = String(host || "smtp.gmail.com");
  const PORT = Number(port) || 465;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const fail = (error) => ({ ok: false, error });

  let socket, writer, reader, buf = "";
  try {
    socket = connect({ hostname: HOST, port: PORT }, { secureTransport: "on", allowHalfOpen: false });
    writer = socket.writable.getWriter();
    reader = socket.readable.getReader();
  } catch (e) {
    return fail(`Nie udało się połączyć z serwerem poczty: ${e?.message || e}`);
  }
  const close = async () => {
    try { await writer.close(); } catch { /* ignore */ }
    try { await reader.cancel(); } catch { /* ignore */ }
  };
  const readResp = async () => {
    for (let i = 0; i < 60; i++) {
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (/^\d{3} /.test(last)) { buf = ""; return last; }
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
    const lines = buf.split(/\r?\n/).filter(Boolean);
    buf = "";
    return lines[lines.length - 1] || "";
  };
  const send = (s) => writer.write(enc.encode(s + "\r\n"));
  const authErr = "Logowanie odrzucone — sprawdź adres i HASŁO APLIKACJI (nie zwykłe hasło Gmaila).";

  try {
    let r = await readResp(); if (!/^220/.test(r)) return fail(`Serwer: ${r.slice(0, 120)}`);
    await send("EHLO jarvis.worker"); r = await readResp(); if (!/^250/.test(r)) return fail(`EHLO: ${r.slice(0, 120)}`);
    await send("AUTH LOGIN"); r = await readResp(); if (!/^334/.test(r)) return fail(`AUTH: ${r.slice(0, 120)}`);
    await send(b64(user)); r = await readResp(); if (!/^334/.test(r)) return fail(`Login: ${r.slice(0, 120)}`);
    await send(b64(pass)); r = await readResp(); if (!/^235/.test(r)) return fail(authErr);
    if (verifyOnly) { await send("QUIT"); await close(); return { ok: true }; }
    const sUser = noCRLF(user), sTo = noCRLF(to);
    await send(`MAIL FROM:<${sUser}>`); r = await readResp(); if (!/^250/.test(r)) return fail(`MAIL FROM: ${r.slice(0, 120)}`);
    await send(`RCPT TO:<${sTo}>`); r = await readResp(); if (!/^250/.test(r)) return fail(`RCPT TO: ${r.slice(0, 120)}`);
    await send("DATA"); r = await readResp(); if (!/^354/.test(r)) return fail(`DATA: ${r.slice(0, 120)}`);
    const bodyB64 = b64(body).replace(/(.{76})/g, "$1\r\n");
    const data = [
      `From: <${sUser}>`, `To: <${sTo}>`,
      `Subject: =?UTF-8?B?${b64(noCRLF(subject))}?=`,
      "MIME-Version: 1.0", 'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64", "", bodyB64, ".",
    ].join("\r\n");
    await send(data); r = await readResp(); if (!/^250/.test(r)) return fail(`Wysyłka: ${r.slice(0, 120)}`);
    await send("QUIT"); await close();
    return { ok: true };
  } catch (e) {
    await close();
    return fail(`Błąd SMTP: ${e?.message || e}`);
  }
}

async function googleAccessToken(env, token) {
  if (!env.JARVIS_KV) return null;
  const rec = await env.JARVIS_KV.get(`google:${token}`);
  if (!rec) return null;
  const { refresh_token } = JSON.parse(rec);
  const r = await fetchT("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const d = await r.json();
  return d.access_token || null;
}

export async function handleIntegrationRoute(path, url, req, env) {
  // --- SYNC (KV) ---
  if (path === "/v1/sync") {
    const token = bearer(req);
    if (!token) return json(401, { error: "Brak tokenu sync." });
    if (!env.JARVIS_KV) return json(500, { error: "Brak bindingu KV (JARVIS_KV)." });
    const key = `sync:${token}`;
    if (req.method === "GET") {
      const blob = await env.JARVIS_KV.get(key);
      return json(200, blob ? JSON.parse(blob) : { data: null, updatedAt: 0 });
    }
    if (req.method === "POST") {
      const body = await req.json();
      const existing = await env.JARVIS_KV.get(key);
      const prev = existing ? JSON.parse(existing) : { updatedAt: 0 };
      if ((body.updatedAt || 0) < (prev.updatedAt || 0)) {
        return json(409, { error: "Nowsza wersja na serwerze.", server: prev });
      }
      await env.JARVIS_KV.put(key, JSON.stringify({ data: body.data, updatedAt: body.updatedAt || Date.now() }));
      return json(200, { ok: true });
    }
  }

  // --- RESEARCH (Tavily) ---
  if (path === "/v1/search" && req.method === "POST") {
    if (appTokenBad(req, env)) return json(401, { error: "Brak lub zły token aplikacji (x-app-token)." });
    if (await rateLimited(req, env)) return json(429, { error: "Za dużo zapytań — spróbuj za chwilę." });
    if (!env.TAVILY_API_KEY) return json(500, { error: "Brak TAVILY_API_KEY." });
    const { query, max_results = 5 } = await req.json();
    const r = await fetchT("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query, max_results, include_answer: true, search_depth: "advanced" }),
    });
    const data = await r.json();
    const citations = (data.results || []).map((x) => ({ title: x.title || x.url, url: x.url }));
    return json(r.ok ? 200 : 502, { answer: data.answer, results: data.results, citations });
  }

  // --- AUDYT STRONY LEADA (SSRF-safe) ---
  if (path === "/v1/site-audit" && req.method === "POST") {
    if (appTokenBad(req, env)) return json(401, { error: "Brak lub zły token aplikacji (x-app-token)." });
    let body;
    try { body = await req.json(); } catch { return json(400, { error: "Zły JSON." }); }
    let u = typeof body?.url === "string" ? body.url.trim() : "";
    if (!u) return json(400, { error: "Brak url." });
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    let parsed;
    try { parsed = new URL(u); } catch { return json(400, { error: "Zły URL." }); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return json(400, { error: "Tylko http/https." });
    if (blocksCloudMetadata(u) || isPrivateHost(u)) return json(403, { error: "Adres niedozwolony." });
    try {
      const r = await fetchT(u, { method: "GET", redirect: "follow", headers: { "user-agent": "JARVIS-SiteAudit/1.0 (+sprzedaz)", accept: "text/html,application/xhtml+xml,*/*" } }, 12000);
      if (r.url && (blocksCloudMetadata(r.url) || isPrivateHost(r.url))) return json(403, { error: "Przekierowanie na niedozwolony adres." });
      const buf = await r.arrayBuffer();
      const html = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 400_000));
      return json(200, { ok: r.ok, status: r.status, finalUrl: r.url || u, contentType: r.headers.get("content-type") || "", bytes: buf.byteLength, html });
    } catch (e) {
      return json(200, { ok: false, error: String((e && e.message) || e) });
    }
  }

  // --- AUDYT WYDAJNOŚCI (Google PageSpeed Insights) ---
  if (path === "/v1/pagespeed" && req.method === "POST") {
    if (appTokenBad(req, env)) return json(401, { error: "Brak lub zły token aplikacji (x-app-token)." });
    let body;
    try { body = await req.json(); } catch { return json(400, { error: "Zły JSON." }); }
    let u = typeof body?.url === "string" ? body.url.trim() : "";
    if (!u) return json(400, { error: "Brak url." });
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    if (blocksCloudMetadata(u) || isPrivateHost(u)) return json(403, { error: "Adres niedozwolony." });
    const strat = body?.strategy === "desktop" ? "desktop" : "mobile";
    const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    api.searchParams.set("url", u);
    api.searchParams.set("strategy", strat);
    for (const c of ["performance", "accessibility", "seo", "best-practices"]) api.searchParams.append("category", c);
    if (env.PAGESPEED_API_KEY) api.searchParams.set("key", env.PAGESPEED_API_KEY);
    try {
      const r = await fetchT(api.toString(), {}, 30000);
      const data = await r.json();
      if (!r.ok) return json(502, { ok: false, error: data?.error?.message || `PageSpeed HTTP ${r.status}` });
      const lr = data.lighthouseResult || {};
      const cats = lr.categories || {};
      const au = lr.audits || {};
      const num = (id) => (typeof au[id]?.numericValue === "number" ? au[id].numericValue : null);
      const pct = (c) => (typeof cats[c]?.score === "number" ? Math.round(cats[c].score * 100) : null);
      const field = data.loadingExperience?.metrics || {};
      return json(200, {
        ok: true, strategy: strat, finalUrl: data.id || u,
        scores: { performance: pct("performance"), accessibility: pct("accessibility"), seo: pct("seo"), bestPractices: pct("best-practices") },
        lab: { lcpMs: num("largest-contentful-paint"), cls: num("cumulative-layout-shift"), tbtMs: num("total-blocking-time"), fcpMs: num("first-contentful-paint"), ttfbMs: num("server-response-time"), speedIndexMs: num("speed-index") },
        field: { lcpMs: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null, cls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile ?? null, inpMs: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null },
      });
    } catch (e) {
      return json(502, { ok: false, error: String((e && e.message) || e) });
    }
  }

  // --- EMBEDDINGS (Gemini) ---
  if (path === "/v1/embed" && req.method === "POST") {
    if (appTokenBad(req, env)) return json(401, { error: "Brak lub zły token aplikacji (x-app-token)." });
    if (await rateLimited(req, env)) return json(429, { error: "Za dużo zapytań — spróbuj za chwilę." });
    if (!env.GEMINI_API_KEY) return json(500, { error: "Brak GEMINI_API_KEY." });
    const { texts } = await req.json();
    const list = Array.isArray(texts) ? texts.slice(0, 64) : [];
    const vectors = [];
    for (const t of list) {
      const r = await fetchT(
        "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent",
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({ model: "models/text-embedding-004", content: { parts: [{ text: t }] } }),
        },
      );
      const d = await r.json();
      vectors.push(d?.embedding?.values || []);
    }
    return json(200, { vectors });
  }

  // --- GOOGLE OAUTH ---
  if (path === "/v1/google/start") {
    const token = url.searchParams.get("token");
    if (!token) return json(400, { error: "Brak token." });
    const redirect = `${url.origin}/v1/google/callback`;
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id", env.GOOGLE_CLIENT_ID || "");
    auth.searchParams.set("redirect_uri", redirect);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", GOOGLE_SCOPES);
    auth.searchParams.set("access_type", "offline");
    auth.searchParams.set("prompt", "consent");
    auth.searchParams.set("state", token);
    return Response.redirect(auth.toString(), 302);
  }
  if (path === "/v1/google/callback") {
    const code = url.searchParams.get("code");
    const token = url.searchParams.get("state");
    if (!code || !token) return new Response("Brak code/state.", { status: 400 });
    const redirect = `${url.origin}/v1/google/callback`;
    const r = await fetchT("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        redirect_uri: redirect,
        grant_type: "authorization_code",
      }),
    });
    const d = await r.json();
    if (!d.refresh_token) {
      return new Response("Brak refresh_token (odłącz aplikację w koncie Google i spróbuj ponownie).", { status: 400 });
    }
    if (!env.JARVIS_KV) return new Response("Brak bindingu KV — nie mogę zapisać połączenia.", { status: 500 });
    await env.JARVIS_KV.put(`google:${token}`, JSON.stringify({ refresh_token: d.refresh_token }));
    return new Response(
      "<html><body style='background:#04070f;color:#6ce7ff;font-family:sans-serif;text-align:center;padding-top:60px'><h2>✅ Połączono z Google</h2><p>Możesz wrócić do JARVIS-a.</p></body></html>",
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  if (path === "/v1/google/status") {
    const token = bearer(req) || url.searchParams.get("token");
    const rec = env.JARVIS_KV && token ? await env.JARVIS_KV.get(`google:${token}`) : null;
    return json(200, { connected: !!rec });
  }

  // --- GMAIL ---
  if (path === "/v1/gmail/list" && req.method === "POST") {
    const at = await googleAccessToken(env, bearer(req));
    if (!at) return json(401, { error: "Google niepołączone." });
    const { query = "", max = 10 } = await req.json();
    const list = await (
      await fetchT(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(query)}`,
        { headers: { authorization: `Bearer ${at}` } },
      )
    ).json();
    const messages = [];
    for (const m of list.messages || []) {
      const msg = await (
        await fetchT(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { authorization: `Bearer ${at}` } },
        )
      ).json();
      const h = (n) => (msg.payload?.headers || []).find((x) => x.name === n)?.value || "";
      messages.push({ id: m.id, threadId: msg.threadId || m.threadId, from: h("From"), subject: h("Subject"), date: h("Date"), snippet: msg.snippet || "" });
    }
    return json(200, { messages });
  }
  if (path === "/v1/gmail/get" && req.method === "POST") {
    const at = await googleAccessToken(env, bearer(req));
    if (!at) return json(401, { error: "Google niepołączone." });
    const { id } = await req.json();
    if (!id) return json(400, { error: "Brak id wiadomości." });
    const msg = await (
      await fetchT(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, {
        headers: { authorization: `Bearer ${at}` },
      })
    ).json();
    const h = (n) => (msg.payload?.headers || []).find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value || "";
    const decode = (data) => { try { return decodeURIComponent(escape(atob(String(data).replace(/-/g, "+").replace(/_/g, "/")))); } catch { return ""; } };
    const findPlain = (p) => {
      if (!p) return "";
      if (p.mimeType === "text/plain" && p.body?.data) return decode(p.body.data);
      for (const part of p.parts || []) { const t = findPlain(part); if (t) return t; }
      return "";
    };
    const findHtml = (p) => {
      if (!p) return "";
      if (p.mimeType === "text/html" && p.body?.data) return decode(p.body.data);
      for (const part of p.parts || []) { const t = findHtml(part); if (t) return t; }
      return "";
    };
    let bodyText = findPlain(msg.payload);
    if (!bodyText && msg.payload?.body?.data) bodyText = decode(msg.payload.body.data);
    if (!bodyText) {
      const html = findHtml(msg.payload);
      if (html) {
        bodyText = html
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
          .replace(/<br\s*\/?>(?=)/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
          .replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      }
    }
    return json(200, {
      id: msg.id, threadId: msg.threadId,
      from: h("From"), to: h("To"), subject: h("Subject"), date: h("Date"),
      messageId: h("Message-ID"),
      body: (bodyText || msg.snippet || "").slice(0, 16000),
    });
  }
  if (path === "/v1/gmail/send" && req.method === "POST") {
    const at = await googleAccessToken(env, bearer(req));
    if (!at) return json(401, { error: "Google niepołączone." });
    const { to, subject, body, threadId, inReplyTo } = await req.json();
    const sTo = noCRLF(to), sSubject = noCRLF(subject);
    // eslint-disable-next-line no-control-regex -- celowy zakres ASCII do detekcji znaków nie-ASCII
    const subjHeader = /[^\x00-\x7F]/.test(sSubject) ? `=?UTF-8?B?${b64(sSubject)}?=` : sSubject;
    const headers = [`To: ${sTo}`, `Subject: ${subjHeader}`];
    if (inReplyTo) {
      const mid = noCRLF(inReplyTo);
      const norm = /^<.*>$/.test(mid) ? mid : `<${mid}>`;
      headers.push(`In-Reply-To: ${norm}`, `References: ${norm}`);
    }
    headers.push("Content-Type: text/plain; charset=UTF-8", "", body);
    const raw = b64url(headers.join("\r\n"));
    const payload = threadId ? { raw, threadId } : { raw };
    const r = await fetchT("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return json(r.ok ? 200 : 502, r.ok ? { ok: true } : { error: "Nie udało się wysłać." });
  }

  // --- SMTP RELAY ---
  if (path === "/v1/smtp/send" && req.method === "POST") {
    if (!bearer(req)) return json(401, { error: "Brak tokenu synchronizacji." });
    const { host, port, user, pass, to, subject, body } = await req.json();
    if (!user || !pass) return json(400, { error: "Brak danych poczty (adres + hasło aplikacji)." });
    if (!to || !String(to).includes("@")) return json(400, { error: "Brak poprawnego adresu odbiorcy." });
    const r = await smtpRelay({ host, port, user, pass, to, subject: String(subject || ""), body: String(body || "") });
    return json(r.ok ? 200 : 502, r.ok ? { ok: true } : { error: r.error });
  }
  if (path === "/v1/smtp/verify" && req.method === "POST") {
    if (!bearer(req)) return json(401, { error: "Brak tokenu synchronizacji." });
    const { host, port, user, pass } = await req.json();
    if (!user || !pass) return json(400, { error: "Brak danych poczty (adres + hasło aplikacji)." });
    const r = await smtpRelay({ host, port, user, pass, verifyOnly: true });
    return json(r.ok ? 200 : 502, r.ok ? { ok: true } : { error: r.error });
  }

  // --- GOOGLE CALENDAR ---
  if (path === "/v1/gcal/list" && req.method === "POST") {
    const at = await googleAccessToken(env, bearer(req));
    if (!at) return json(401, { error: "Google niepołączone." });
    const { max = 10, timeMin, timeMax } = await req.json();
    const params = new URLSearchParams({
      maxResults: String(max), singleEvents: "true", orderBy: "startTime",
      timeMin: timeMin || new Date().toISOString(),
    });
    if (timeMax) params.set("timeMax", timeMax);
    const d = await (
      await fetchT(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
        { headers: { authorization: `Bearer ${at}` } },
      )
    ).json();
    const events = (d.items || []).map((e) => ({
      summary: e.summary || "(bez tytułu)",
      start: e.start?.dateTime || e.start?.date,
      location: e.location || "",
    }));
    return json(200, { events });
  }
  if (path === "/v1/gcal/add" && req.method === "POST") {
    const at = await googleAccessToken(env, bearer(req));
    if (!at) return json(401, { error: "Google niepołączone." });
    const { summary, start, end, location } = await req.json();
    const r = await fetchT("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary,
        location,
        start: { dateTime: new Date(start).toISOString() },
        end: { dateTime: new Date(end || new Date(new Date(start).getTime() + 3600000)).toISOString() },
      }),
    });
    return json(r.ok ? 200 : 502, r.ok ? { ok: true } : { error: "Nie udało się dodać wydarzenia." });
  }

  return null;
}
