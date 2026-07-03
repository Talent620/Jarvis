// === Rdzeń lokalnego węzła Windows EXE (Project Horizon) — CZYSTA logika ===
// Zero zależności od Electron/http, żeby testować w Vitest adwersarialnie. Warstwa
// transportu (serwer HTTP na 127.0.0.1, tray, autostart, realne akcje) mieszka w
// horizon-listener.cjs i importuje ten rdzeń. Kontrakt odpowiedzi zgodny z MCP
// (tools/call → { content:[{type:"text",text}], isError? }), więc od strony Sztafety
// to „zwykły" węzeł MCP na loopbacku — ten sam adapter co emulator/ESP32.
//
// FAIL-CLOSED wszędzie: brak tokenu, zły token, obcy origin, narzędzie spoza allowlisty,
// bind poza loopbackiem → odmowa. Nic „domyślnie otwartego".

// Jedyne dozwolone narzędzia lokalnego EXE (minimalna, jawna powierzchnia).
const ALLOWED_TOOLS = ["show_window", "set_clipboard", "read_state"];

// Adresy loopback — serwer NIGDY nie binduje się poza nimi (zakaz 0.0.0.0/LAN).
const LOOPBACK = ["127.0.0.1", "::1", "localhost"];

/** Wymuś bind wyłącznie na loopback. Zwraca 127.0.0.1 dla loopbacku, inaczej null (odmowa). */
function resolveBindHost(requested) {
  const h = String(requested || "127.0.0.1").trim().toLowerCase();
  if (LOOPBACK.includes(h)) return "127.0.0.1";
  return null; // 0.0.0.0, adres LAN, cokolwiek innego → NIE bindujemy
}

/** Czy Origin (jeśli podany) jest lokalny? Brak Origin = OK (klient nie-przeglądarkowy). */
function originAllowed(origin, port) {
  if (!origin) return true;
  const o = String(origin).trim().toLowerCase();
  return LOOPBACK.some((h) => o === `http://${h}:${port}` || o === `http://${h}`);
}

function ok(text) {
  return { content: [{ type: "text", text }] };
}
function err(text) {
  return { content: [{ type: "text", text }], isError: true };
}

// Kanoniczny string podpisu — MUSI być identyczny jak w src/lib/horizon/pairing.ts
// (jedno źródło prawdy kontraktu; tu duplikat dla warstwy Node bez importu TS).
function canonicalString(method, path, timestamp, nonce, body) {
  return [String(method).toUpperCase(), path, String(timestamp), nonce, body].join("\n");
}

/**
 * Zdecyduj o żądaniu HTTP do węzła EXE. Czyste: bez sieci, bez efektów ubocznych poza
 * mutacją przekazanego `state` (stan węzła: widoczność okna, ostatni schowek).
 *
 * @param req  { method, path, headers:{...}, body:obj, rawBody?:string }
 * @param ctx  { token, port, state, actions, pairingSecret?, verifyHmac?(secret,canonical,sig):boolean,
 *               seenNonce?(nonce):boolean, markNonce?(nonce):void, now?:number }
 * @returns { status:number, json:object }
 *
 * Gdy `ctx.pairingSecret` jest ustawiony, KAŻDE tools/call musi być podpisane HMAC
 * (nagłówki x-horizon-ts / x-horizon-nonce / x-horizon-sig), inaczej 401 — to broni
 * węzeł, gdyby kiedyś wyszedł poza loopback (podsłuch/replay). Bez sekretu (tryb
 * loopback-only) zostaje sam token.
 */
function handleHorizonRequest(req, ctx) {
  const method = String(req.method || "").toUpperCase();
  const pathName = String(req.path || "/");
  const headers = req.headers || {};
  const port = ctx.port || 4318;

  // Health — jedyny GET, bez tokenu (tylko potwierdza, że proces żyje). Zero danych wrażliwych.
  if (method === "GET" && pathName === "/health") {
    return { status: 200, json: { ok: true, service: "jarvis-horizon", loopbackOnly: true } };
  }

  // Wszystko inne to POST / (JSON-RPC-ish MCP tools/call).
  if (method !== "POST" || pathName !== "/") {
    return { status: 404, json: err("nieznany endpoint") };
  }

  // Origin: jeśli podany, musi być lokalny (obrona przed przeglądarką z obcej strony).
  if (!originAllowed(headers.origin, port)) {
    return { status: 403, json: err("obcy origin — odrzucono") };
  }

  // Token: Bearer albo x-horizon-token; MUSI zgadzać się z losowym tokenem sesji EXE.
  const bearer = /^Bearer\s+(.+)$/i.exec(String(headers.authorization || ""));
  const provided = (bearer && bearer[1]) || headers["x-horizon-token"] || "";
  if (!ctx.token || provided !== ctx.token) {
    return { status: 401, json: err("brak lub zły token") };
  }

  // Podpis HMAC — WYMAGANY, gdy węzeł jest sparowany (pairingSecret ustawiony).
  // Broni przed podsłuchem tokenu i replay, gdyby węzeł wyszedł poza loopback.
  if (ctx.pairingSecret) {
    const ts = Number(headers["x-horizon-ts"]);
    const nonce = String(headers["x-horizon-nonce"] || "");
    const sig = String(headers["x-horizon-sig"] || "");
    const now = ctx.now || 0;
    if (!nonce || !sig || !Number.isFinite(ts)) {
      return { status: 401, json: err("brak podpisu żądania (parowanie wymaga HMAC)") };
    }
    if (Math.abs(now - ts) > 5 * 60_000) {
      return { status: 401, json: err("znacznik czasu poza oknem (replay?)") };
    }
    if (typeof ctx.seenNonce === "function" && ctx.seenNonce(nonce)) {
      return { status: 401, json: err("nonce już użyty (replay)") };
    }
    const raw = typeof req.rawBody === "string" ? req.rawBody : JSON.stringify(req.body || {});
    const canonical = canonicalString(method, pathName, ts, nonce, raw);
    const okSig = typeof ctx.verifyHmac === "function" && ctx.verifyHmac(ctx.pairingSecret, canonical, sig);
    if (!okSig) {
      return { status: 401, json: err("zły podpis żądania") };
    }
    if (typeof ctx.markNonce === "function") ctx.markNonce(nonce); // spal nonce PO sukcesie
  }

  const body = req.body || {};
  if (body.method !== "tools/call" || !body.params) {
    return { status: 400, json: err("oczekiwano tools/call") };
  }
  const name = String(body.params.name || "");
  const args = body.params.arguments || {};

  if (!ALLOWED_TOOLS.includes(name)) {
    return { status: 403, json: err(`narzędzie poza allowlistą: ${name}`) };
  }

  const state = ctx.state;
  const actions = ctx.actions || {};
  switch (name) {
    case "show_window": {
      // ACK — NIE twierdzimy o skutku. Widoczność potwierdzi dopiero read_state.
      if (typeof actions.showWindow === "function") actions.showWindow();
      state.windowVisible = true;
      return { status: 200, json: ok(JSON.stringify({ ack: true, tool: "show_window" })) };
    }
    case "set_clipboard": {
      const text = typeof args.text === "string" ? args.text : "";
      if (typeof actions.setClipboard === "function") actions.setClipboard(text);
      state.clipboard = text;
      return { status: 200, json: ok(JSON.stringify({ ack: true, tool: "set_clipboard", len: text.length })) };
    }
    case "read_state": {
      // ODCZYT ZWROTNY — faktyczny stan węzła (dowód dla Drabiny Prawdy).
      const key = args.key != null ? String(args.key) : "";
      const full = { windowVisible: !!state.windowVisible, clipboardLen: (state.clipboard || "").length };
      if (key) return { status: 200, json: ok(JSON.stringify({ [key]: full[key] })) };
      return { status: 200, json: ok(JSON.stringify(full)) };
    }
    default:
      return { status: 403, json: err(`narzędzie poza allowlistą: ${name}`) };
  }
}

module.exports = { handleHorizonRequest, resolveBindHost, originAllowed, canonicalString, ALLOWED_TOOLS, LOOPBACK };
