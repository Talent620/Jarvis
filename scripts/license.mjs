#!/usr/bin/env node
// Narzędzie WŁAŚCICIELA do wydawania kluczy licencyjnych JARVIS-a.
// Wymaga klucza prywatnego (license-private.json) — NIE trzymaj go w repozytorium.
//
// Użycie:
//   node scripts/license.mjs genkey                      # raz: wygeneruj parę kluczy
//   node scripts/license.mjs sign "Jan Kowalski"         # klucz bezterminowy
//   node scripts/license.mjs sign "Jan Kowalski" 365     # klucz ważny 365 dni
//
// Po genkey: WKLEJ wypisany PUBLIC_JWK do src/lib/license.ts (PUBLIC_JWK),
// a license-private.json zachowaj u siebie (poza repo).
import { webcrypto as c } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const PRIV = "license-private.json";
const b64url = (buf) => Buffer.from(buf).toString("base64url");

async function genkey() {
  const kp = await c.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = await c.subtle.exportKey("jwk", kp.publicKey);
  const prv = await c.subtle.exportKey("jwk", kp.privateKey);
  writeFileSync(PRIV, JSON.stringify(prv));
  console.log("Zapisano klucz prywatny do", PRIV, "(trzymaj go w tajemnicy!)");
  console.log("\nWklej do src/lib/license.ts jako PUBLIC_JWK:");
  console.log(JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, null, 2));
}

async function sign(name, days, trial) {
  if (!existsSync(PRIV)) return console.error("Brak", PRIV, "— najpierw: node scripts/license.mjs genkey");
  const prv = JSON.parse(readFileSync(PRIV, "utf8"));
  const key = await c.subtle.importKey("jwk", prv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const t = trial ? "trial" : days ? "term" : "perpetual";
  const payload = { n: name, t, iat: Date.now() };
  if (days) payload.exp = Date.now() + Number(days) * 86400_000;
  const data = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = await c.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(data));
  console.log("Klucz licencyjny dla:", name, trial ? `(TRIAL ${days || 14} dni)` : days ? `(ważny ${days} dni)` : "(bezterminowy)");
  console.log(data + "." + b64url(sig));
}

// Sprawdź, co jest w kluczu (dla kogo, typ, kiedy wydany, kiedy wygasa, ile dni zostało, czy podpis OK).
function fmtDate(ms) {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
async function inspect(token) {
  const [data, sig] = (token || "").trim().split(".");
  if (!data) return console.error("Podaj klucz: node scripts/license.mjs inspect <KLUCZ>");
  let p;
  try { p = JSON.parse(Buffer.from(data, "base64url").toString("utf8")); }
  catch { return console.error("Nie mogę odczytać klucza — wklej PEŁNY ciąg (z kropką w środku)."); }
  const now = Date.now();
  console.log("Dla:        ", p.n || "(brak)");
  console.log("Typ:        ", p.t || "(brak)");
  console.log("Wydany:     ", p.iat ? fmtDate(p.iat) : "(brak)");
  if (p.exp) {
    const left = Math.ceil((p.exp - now) / 86400_000);
    console.log("Wygasa:     ", fmtDate(p.exp), left > 0 ? `(za ${left} dni)` : `(WYGASŁ ${-left} dni temu)`);
  } else {
    console.log("Wygasa:      nigdy (bezterminowy)");
  }
  if (sig && existsSync(PRIV)) {
    try {
      const prv = JSON.parse(readFileSync(PRIV, "utf8"));
      const pub = await c.subtle.importKey("jwk", { kty: prv.kty, crv: prv.crv, x: prv.x, y: prv.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      const ok = await c.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, Buffer.from(sig, "base64url"), Buffer.from(data));
      console.log("Podpis:     ", ok ? "PRAWIDŁOWY ✓" : "NIEPRAWIDŁOWY ✗");
    } catch { console.log("Podpis:      (nie udało się zweryfikować)"); }
  }
  console.log("Status:     ", !p.exp || p.exp > now ? "WAŻNY ✓" : "WYGASŁY ✗");
}

const [cmd, name, days] = process.argv.slice(2);
if (cmd === "genkey") await genkey();
else if (cmd === "sign" && name) await sign(name, days, false);
else if (cmd === "trial" && name) await sign(name, days || 14, true); // domyślnie 14 dni trialu
else if (cmd === "inspect" && name) await inspect(name);
else console.log("Użycie: genkey | sign \"Imię\" [dni] | trial \"Imię\" [dni=14] | inspect <KLUCZ>");
