#!/usr/bin/env node
// JARVIS — offline license key toolkit (Ed25519).
//
//   node scripts/license.mjs genkeys
//       Tworzy parę kluczy. Klucz PRYWATNY -> license-private.pem (TRZYMAJ W TAJEMNICY),
//       klucz PUBLICZNY wstrzykuje do ios/App/App/AppDelegate.swift (LicenseConfig).
//
//   node scripts/license.mjs issue --name "Jan Kowalski" [--days 365] [--features pro,beta]
//       Wystawia podpisany klucz licencyjny (token) dla danego użytkownika.
//       Bez --days = licencja bezterminowa.
//
//   node scripts/license.mjs verify <token>
//       Sprawdza poprawność tokenu kluczem publicznym.
//
// Format tokenu: base64url(payloadJSON) + "." + base64url(signature)
//   payload = {"n":<name>,"exp":<unix seconds, 0 = lifetime>,"f":[features]}

import crypto from "node:crypto";
import fs from "node:fs";

const PRIV = "license-private.pem";
const PUB = "license-public.txt";
const SWIFT = "ios/App/App/AppDelegate.swift";

const [, , cmd, ...rest] = process.argv;

function arg(name, def = undefined) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : def;
}

function rawPublicBase64(publicKey) {
  const jwk = publicKey.export({ format: "jwk" }); // { crv: 'Ed25519', x: <b64url> }
  return Buffer.from(jwk.x, "base64url").toString("base64"); // raw 32 bytes -> std base64
}

function publicKeyFromRawBase64(b64) {
  const xB64url = Buffer.from(b64, "base64").toString("base64url");
  return crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: xB64url }, format: "jwk" });
}

switch (cmd) {
  case "genkeys": {
    if (fs.existsSync(PRIV) && arg("force") === undefined && !rest.includes("--force")) {
      console.error(`✗ ${PRIV} już istnieje. Użyj --force, aby nadpisać (UWAGA: unieważni dotychczasowe klucze).`);
      process.exit(1);
    }
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    fs.writeFileSync(PRIV, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    const pubB64 = rawPublicBase64(publicKey);
    fs.writeFileSync(PUB, pubB64 + "\n");

    // Wstrzyknij klucz publiczny do kodu iOS.
    if (fs.existsSync(SWIFT)) {
      let s = fs.readFileSync(SWIFT, "utf8");
      const re = /(static let publicKeyBase64 = ")[^"]*(" *\/\/ *JARVIS_LICENSE_PUBLIC_KEY)/;
      if (re.test(s)) {
        s = s.replace(re, `$1${pubB64}$2`);
        fs.writeFileSync(SWIFT, s);
        console.log(`✓ Klucz publiczny wstrzyknięty do ${SWIFT}`);
      } else {
        console.warn(`! Nie znalazłem znacznika JARVIS_LICENSE_PUBLIC_KEY w ${SWIFT} — wklej klucz ręcznie.`);
      }
    }
    console.log("✓ Wygenerowano parę kluczy.");
    console.log(`  • prywatny: ${PRIV}  (NIE commituj, trzymaj bezpiecznie)`);
    console.log(`  • publiczny (base64): ${pubB64}`);
    console.log("\nTeraz przebuduj aplikację (CI) — od tej pory wymaga klucza licencyjnego.");
    break;
  }

  case "issue": {
    if (!fs.existsSync(PRIV)) { console.error(`✗ Brak ${PRIV}. Najpierw: node scripts/license.mjs genkeys`); process.exit(1); }
    const name = arg("name");
    if (!name) { console.error('✗ Podaj --name "Imię Nazwisko / email"'); process.exit(1); }
    const days = parseInt(arg("days", "0"), 10) || 0;
    const features = (arg("features", "") || "").split(",").map(s => s.trim()).filter(Boolean);
    const exp = days > 0 ? Math.floor(Date.now() / 1000) + days * 86400 : 0;

    const payload = Buffer.from(JSON.stringify({ n: name, exp, f: features }));
    const priv = crypto.createPrivateKey(fs.readFileSync(PRIV));
    const sig = crypto.sign(null, payload, priv);
    const token = payload.toString("base64url") + "." + sig.toString("base64url");

    console.log(token);
    console.error(`\n(ℹ) dla: ${name} | ważność: ${exp === 0 ? "bezterminowa" : new Date(exp * 1000).toISOString()}` +
                  (features.length ? ` | funkcje: ${features.join(", ")}` : ""));
    break;
  }

  case "verify": {
    const token = rest[0];
    if (!token) { console.error("✗ Podaj token: node scripts/license.mjs verify <token>"); process.exit(1); }
    if (!fs.existsSync(PUB)) { console.error(`✗ Brak ${PUB}. Najpierw: genkeys`); process.exit(1); }
    const [p, sg] = token.split(".");
    if (!p || !sg) { console.log("INVALID (zły format)"); process.exit(2); }
    const pub = publicKeyFromRawBase64(fs.readFileSync(PUB, "utf8").trim());
    const ok = crypto.verify(null, Buffer.from(p, "base64url"), pub, Buffer.from(sg, "base64url"));
    let extra = "";
    try {
      const pl = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
      const expired = pl.exp && pl.exp > 0 && Date.now() / 1000 > pl.exp;
      extra = ` | dla: ${pl.n} | ${pl.exp ? "wygasa " + new Date(pl.exp * 1000).toISOString() : "bezterminowa"}` + (expired ? " (WYGASŁA)" : "");
      if (ok && expired) { console.log("EXPIRED" + extra); process.exit(2); }
    } catch {}
    console.log((ok ? "VALID" : "INVALID") + extra);
    process.exit(ok ? 0 : 2);
  }

  default:
    console.log("Użycie:\n  node scripts/license.mjs genkeys\n  node scripts/license.mjs issue --name \"...\" [--days N] [--features a,b]\n  node scripts/license.mjs verify <token>");
}
