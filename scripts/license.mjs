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

async function sign(name, days) {
  if (!existsSync(PRIV)) return console.error("Brak", PRIV, "— najpierw: node scripts/license.mjs genkey");
  const prv = JSON.parse(readFileSync(PRIV, "utf8"));
  const key = await c.subtle.importKey("jwk", prv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const payload = { n: name, t: days ? "term" : "perpetual", iat: Date.now() };
  if (days) payload.exp = Date.now() + Number(days) * 86400_000;
  const data = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = await c.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(data));
  console.log("Klucz licencyjny dla:", name, days ? `(ważny ${days} dni)` : "(bezterminowy)");
  console.log(data + "." + b64url(sig));
}

const [cmd, name, days] = process.argv.slice(2);
if (cmd === "genkey") await genkey();
else if (cmd === "sign" && name) await sign(name, days);
else console.log("Użycie: genkey | sign \"Imię Nazwisko\" [dni]");
