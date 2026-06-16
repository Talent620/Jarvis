// Natywna integracja z Kalendarzem Google dla aplikacji DESKTOP (.exe).
// Używa przepływu OAuth „dla aplikacji desktopowych" (pętla loopback na 127.0.0.1) —
// pasuje do danych typu „installed" (redirect http://localhost). NIE wymaga serwera/BFF.
// Sekret OAuth podaje użytkownik w ustawieniach (nie jest wbudowany w kod).

const http = require("http");
const https = require("https");
const { URL, URLSearchParams } = require("url");

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"].join(" ");

// Mały klient HTTPS zwracający sparsowany JSON (Electron main bywa bez globalnego fetch).
function httpsJson(method, urlStr, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = body == null ? null : Buffer.from(body);
    const req = https.request(
      { method, hostname: u.hostname, path: u.pathname + u.search, headers: { ...headers, ...(data ? { "content-length": data.length } : {}) } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            const j = buf ? JSON.parse(buf) : {};
            if (res.statusCode >= 400) reject(new Error(j.error?.message || j.error_description || j.error || `HTTP ${res.statusCode}`));
            else resolve(j);
          } catch (e) {
            reject(new Error(`Zła odpowiedź Google (${res.statusCode}).`));
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Zbuduj URL zgody Google dla danego portu loopback (czyste — testowalne).
function buildAuthUrl(clientId, port) {
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", `http://localhost:${port}`);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", SCOPES);
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  return auth.toString();
}

function form(obj) {
  return new URLSearchParams(obj).toString();
}

async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  return httpsJson("POST", "https://oauth2.googleapis.com/token", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
}

async function refreshAccessToken({ clientId, clientSecret, refresh_token }) {
  const d = await httpsJson("POST", "https://oauth2.googleapis.com/token", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ client_id: clientId, client_secret: clientSecret, refresh_token, grant_type: "refresh_token" }),
  });
  if (!d.access_token) throw new Error("Brak access_token (połącz Google ponownie).");
  return d.access_token;
}

// Pełna pętla logowania: start serwera loopback, otwarcie przeglądarki, odbiór code,
// wymiana na refresh_token. openUrl = funkcja otwierająca URL w przeglądarce (shell.openExternal).
function connectGoogle({ clientId, clientSecret, openUrl }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; try { server.close(); } catch { /* ignore */ } resolve(r); } };
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, "http://localhost");
        const code = u.searchParams.get("code");
        const err = u.searchParams.get("error");
        if (err) { res.end(`Odmowa dostępu: ${err}. Możesz zamknąć tę kartę.`); return finish({ ok: false, error: err }); }
        if (!code) { res.statusCode = 400; res.end("Brak kodu autoryzacji."); return; }
        const port = server.address().port;
        const tok = await exchangeCode({ clientId, clientSecret, code, redirectUri: `http://localhost:${port}` });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body style='background:#04070f;color:#6ce7ff;font-family:sans-serif;text-align:center;padding-top:60px'><h2>✅ Połączono z Kalendarzem Google</h2><p>Możesz wrócić do JARVIS-a i zamknąć tę kartę.</p></body></html>");
        if (!tok.refresh_token) return finish({ ok: false, error: "Brak refresh_token — w koncie Google odłącz aplikację i spróbuj ponownie." });
        finish({ ok: true, refresh_token: tok.refresh_token });
      } catch (e) {
        try { res.statusCode = 500; res.end("Błąd: " + (e && e.message)); } catch { /* ignore */ }
        finish({ ok: false, error: e && e.message ? e.message : String(e) });
      }
    });
    server.on("error", (e) => finish({ ok: false, error: e.message }));
    server.listen(0, "127.0.0.1", () => {
      openUrl(buildAuthUrl(clientId, server.address().port));
    });
    // Bezpiecznik: jeśli użytkownik nie dokończy w 3 min — sprzątamy.
    setTimeout(() => finish({ ok: false, error: "Upłynął czas logowania (3 min)." }), 180000);
  });
}

async function calAdd({ accessToken, summary, start, end, location }) {
  return httpsJson("POST", "https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary,
      location: location || undefined,
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(end || new Date(new Date(start).getTime() + 3600000)).toISOString() },
    }),
  });
}

async function calList({ accessToken, timeMin, timeMax, max = 10 }) {
  const p = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: String(max) });
  if (timeMin) p.set("timeMin", timeMin); else p.set("timeMin", new Date().toISOString());
  if (timeMax) p.set("timeMax", timeMax);
  const d = await httpsJson("GET", `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return (d.items || []).map((e) => ({ start: e.start?.dateTime || e.start?.date, summary: e.summary, location: e.location }));
}

module.exports = { buildAuthUrl, exchangeCode, refreshAccessToken, connectGoogle, calAdd, calList, SCOPES };
