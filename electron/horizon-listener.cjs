// === Lokalny węzeł Windows EXE (Project Horizon) — warstwa transportu ===
// Serwer HTTP nasłuchujący WYŁĄCZNIE na 127.0.0.1:4318, z losowym tokenem sesji i
// allowlistą narzędzi (show_window / set_clipboard / read_state). Logika decyzji jest
// w horizon-listener-core.cjs (czysta, testowana w Vitest); tu tylko sieć + realne akcje
// Electron + tray + autostart za JAWNĄ zgodą. Fail-closed: bez tokenu/obcy origin/bind
// poza loopbackiem → odmowa. Nie otwiera żadnego portu na świat.
const http = require("http");
const { randomBytes, createHmac, timingSafeEqual } = require("node:crypto");
const { handleHorizonRequest, resolveBindHost } = require("./horizon-listener-core.cjs");

const PORT = 4318;

let server = null;
let token = "";
let pairingSecret = ""; // gdy ustawiony (parowanie), żądania muszą być podpisane HMAC
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
function startHorizonListener(deps = {}) {
  if (server) return { token, port: PORT };
  const bindHost = resolveBindHost("127.0.0.1");
  if (!bindHost) throw new Error("Horizon listener: odmowa bindu poza loopbackiem");
  token = freshToken();

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
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
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

  // KLUCZOWE: bind wyłącznie na 127.0.0.1 — nigdy 0.0.0.0. Świat nie widzi tego portu.
  server.listen(PORT, bindHost, () => {
    if (deps.onStatus) deps.onStatus({ listening: true, port: PORT, host: bindHost });
  });
  server.on("error", (e) => {
    if (deps.onStatus) deps.onStatus({ listening: false, error: String(e && e.message) });
    server = null;
  });
  return { token, port: PORT };
}

function stopHorizonListener() {
  if (server) { try { server.close(); } catch { /* już zamknięty */ } server = null; }
}

function listenerStatus() {
  return { listening: !!server, port: PORT, hasToken: !!token, paired: !!pairingSecret };
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

module.exports = { startHorizonListener, stopHorizonListener, listenerStatus, currentToken, startPairing, clearPairing, HORIZON_PORT: PORT };
