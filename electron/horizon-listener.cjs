// === Lokalny węzeł Windows EXE (Project Horizon) — warstwa transportu ===
// Serwer HTTP nasłuchujący WYŁĄCZNIE na 127.0.0.1:4318, z losowym tokenem sesji i
// allowlistą narzędzi (show_window / set_clipboard / read_state). Logika decyzji jest
// w horizon-listener-core.cjs (czysta, testowana w Vitest); tu tylko sieć + realne akcje
// Electron + tray + autostart za JAWNĄ zgodą. Fail-closed: bez tokenu/obcy origin/bind
// poza loopbackiem → odmowa. Nie otwiera żadnego portu na świat.
const http = require("http");
const { randomBytes, createHmac, timingSafeEqual } = require("node:crypto");
const { handleHorizonRequest, resolveBindPolicy } = require("./horizon-listener-core.cjs");

const PORT = 4318;

let server = null;
let token = "";
let pairingSecret = ""; // gdy ustawiony (parowanie), żądania muszą być podpisane HMAC
let bindHost = "127.0.0.1"; // domyślnie loopback; LAN tylko przez enableLan (jawna zgoda)
let lastDeps = null;        // zapamiętane akcje — potrzebne do restartu przy zmianie bindu
const state = { windowVisible: true, clipboard: "" };
// Anty-replay: nonce'y widziane w oknie MAX_SKEW; czyszczone leniwie po czasie.
const seenNonces = new Map(); // nonce -> timestamp

/** Losowy, silny token sesji (nowy przy każdym starcie procesu). */
function freshToken() {
  return randomBytes(32).toString("hex");
}

/** HMAC-SHA-256(secret, canonical) === sig, w stałym czasie. Ten sam kontrakt co pairing.ts. */
function verifyHmac(secret, canonical, sig) {
  try {
    const expected = createHmac("sha256", secret).update(canonical).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(String(sig), "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function pruneNonces(now) {
  for (const [n, ts] of seenNonces) if (now - ts > 5 * 60_000) seenNonces.delete(n);
}

/**
 * Uruchom listener. `deps` wstrzykuje realne akcje Electron (żeby rdzeń pozostał czysty):
 *   { showWindow(): void, setClipboard(text): void, onStatus?(info): void }
 * Zwraca { token, port } albo rzuca, gdy bind poza loopbackiem (nie powinno się zdarzyć).
 */
// Uruchom serwer HTTP na module-level `bindHost` (loopback albo — po jawnej zgodzie — LAN).
function bootServer() {
  const deps = lastDeps || {};
  const actions = {
    showWindow: () => {
      try { if (deps.showWindow) deps.showWindow(); } catch { /* okno mogło zniknąć */ }
    },
    setClipboard: (text) => {
      try { if (deps.setClipboard) deps.setClipboard(text); } catch { /* schowek niedostępny */ }
    },
  };

  server = http.createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024) { req.destroy(); return; } // twardy limit ciała (anty-DoS)
      chunks.push(c);
    });
    req.on("end", () => {
      let bodyObj = {};
      if (chunks.length) {
        try { bodyObj = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { bodyObj = {}; }
      }
      const url = new URL(req.url, `http://${bindHost}:${PORT}`);
      const now = Date.now();
      pruneNonces(now);
      const rawBody = chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
      const out = handleHorizonRequest(
        { method: req.method, path: url.pathname, headers: req.headers, body: bodyObj, rawBody },
        {
          token, port: PORT, state, actions, now,
          pairingSecret: pairingSecret || undefined,
          verifyHmac,
          seenNonce: (n) => seenNonces.has(n),
          markNonce: (n) => seenNonces.set(n, now),
        },
      );
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(JSON.stringify(out.json));
    });
  });

  server.listen(PORT, bindHost, () => {
    if (deps.onStatus) deps.onStatus({ listening: true, port: PORT, host: bindHost });
  });
  server.on("error", (e) => {
    if (deps.onStatus) deps.onStatus({ listening: false, error: String(e && e.message) });
    server = null;
  });
}

function startHorizonListener(deps = {}) {
  if (server) return { token, port: PORT };
  lastDeps = deps;
  bindHost = "127.0.0.1"; // start ZAWSZE na loopbacku — LAN wymaga jawnej enableLan
  token = freshToken();
  bootServer();
  return { token, port: PORT };
}

/**
 * Wyjście na LAN — TYLKO za jawną zgodą i po parowaniu. Twarde bariery w resolveBindPolicy
 * (prywatny adres, allowLan, paired; publiczny/0.0.0.0 nigdy). Restartuje serwer na nowym
 * hoście, ROTUJĄC token i sekret (poprzednie parowanie nie działa poza loopbackiem bez
 * ponownego QR — świadoma decyzja użytkownika). Zwraca { ok, host?/reason }.
 */
function enableLan(ip) {
  const policy = resolveBindPolicy(ip, { allowLan: true, paired: !!pairingSecret });
  if (!policy.host || policy.host === "127.0.0.1") {
    return { ok: false, reason: policy.reason || "adres loopback — nie ma po co wychodzić na LAN" };
  }
  if (!pairingSecret) return { ok: false, reason: "najpierw sparuj telefon (podpis HMAC jest wymagany na LAN)" };
  bindHost = policy.host;
  token = freshToken();      // rotacja tokenu przy zmianie ekspozycji
  seenNonces.clear();
  try { if (server) server.close(); } catch { /* ignore */ }
  server = null;
  bootServer();
  return { ok: true, host: bindHost, port: PORT };
}

/** Powrót do loopbacku (odwracalność) — rotuje token, czyści nonce, restart na 127.0.0.1. */
function disableLan() {
  if (bindHost === "127.0.0.1") return { ok: true, host: bindHost };
  bindHost = "127.0.0.1";
  token = freshToken();
  seenNonces.clear();
  try { if (server) server.close(); } catch { /* ignore */ }
  server = null;
  bootServer();
  return { ok: true, host: bindHost, port: PORT };
}

function stopHorizonListener() {
  if (server) { try { server.close(); } catch { /* już zamknięty */ } server = null; }
}

function listenerStatus() {
  return { listening: !!server, port: PORT, hasToken: !!token, paired: !!pairingSecret, host: bindHost, lan: bindHost !== "127.0.0.1" };
}

/**
 * Rozpocznij parowanie: wygeneruj nowy sekret HMAC i zwróć ładunek do QR
 * (adres + sekret). Od tej chwili żądania MUSZĄ być podpisane. `lanUrl` pozwala
 * jawnie wskazać interfejs LAN (np. http://192.168.1.50:4318/); domyślnie loopback.
 */
function startPairing(lanUrl, name) {
  pairingSecret = randomBytes(32).toString("hex");
  seenNonces.clear();
  return {
    v: 1,
    url: String(lanUrl || `http://127.0.0.1:${PORT}/`),
    secret: pairingSecret,
    name: String(name || "JARVIS PC"),
  };
}

/** Rozłącz parowanie: kasuje sekret (żądania znów wymagają tylko tokenu, tryb loopback). */
function clearPairing() {
  pairingSecret = "";
  seenNonces.clear();
}

/** Token wyłącznie dla własnego renderera (przez zaufany IPC) — nigdy nie wychodzi z procesu. */
function currentToken() {
  return token;
}

module.exports = { startHorizonListener, stopHorizonListener, listenerStatus, currentToken, startPairing, clearPairing, enableLan, disableLan, HORIZON_PORT: PORT };
