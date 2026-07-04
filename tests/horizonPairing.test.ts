// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import {
  canonicalString,
  signRequest,
  verifyRequest,
  timingSafeEqual,
  makeSignatureHeaders,
  freshNonce,
  encodePairingPayload,
  decodePairingPayload,
  MAX_SKEW_MS,
  type SignableRequest,
} from "../src/lib/horizon/pairing";

// jsdom nie ma crypto.subtle — podstaw Web Crypto z Node (ten sam standard, Chrome 79 ma).
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  (globalThis as any).crypto = webcrypto;
}

const require = createRequire(import.meta.url);
const core = require("../electron/horizon-listener-core.cjs");

const SECRET = "sekret-parowania-hex-1234567890abcdef";
const NOW = 1_700_000_000_000;

const req = (over: Partial<SignableRequest> = {}): SignableRequest => ({
  method: "POST",
  path: "/",
  body: JSON.stringify({ method: "tools/call", params: { name: "show_window" } }),
  timestamp: NOW,
  nonce: "nonce-abc",
  ...over,
});

describe("Podpis HMAC — deterministyczny i zależny od każdego pola", () => {
  it("ten sam sekret+żądanie → ten sam podpis; zmiana pola → inny", async () => {
    const s1 = await signRequest(SECRET, req());
    const s2 = await signRequest(SECRET, req());
    expect(s1).toBe(s2);
    expect(await signRequest(SECRET, req({ body: '{"x":1}' }))).not.toBe(s1);
    expect(await signRequest(SECRET, req({ nonce: "inny" }))).not.toBe(s1);
    expect(await signRequest(SECRET, req({ timestamp: NOW + 1 }))).not.toBe(s1);
    expect(await signRequest("inny-sekret", req())).not.toBe(s1);
  });

  it("canonicalString wiąże metodę/ścieżkę/czas/nonce/ciało w ustalonej kolejności", () => {
    expect(canonicalString(req())).toBe(["POST", "/", String(NOW), "nonce-abc", req().body].join("\n"));
  });
});

describe("verifyRequest — anty-replay i anty-tamper", () => {
  const noSeen = () => false;
  it("poprawny podpis w oknie czasu → OK (null)", async () => {
    const sig = await signRequest(SECRET, req());
    expect(await verifyRequest(SECRET, req(), sig, NOW, noSeen)).toBeNull();
  });
  it("podrobione ciało (ten sam podpis) → odrzut", async () => {
    const sig = await signRequest(SECRET, req());
    const tampered = req({ body: '{"method":"tools/call","params":{"name":"power"}}' });
    expect(await verifyRequest(SECRET, tampered, sig, NOW, noSeen)).toMatch(/zły podpis/);
  });
  it("stary znacznik czasu (poza oknem) → odrzut replay", async () => {
    const sig = await signRequest(SECRET, req());
    expect(await verifyRequest(SECRET, req(), sig, NOW + MAX_SKEW_MS + 1, noSeen)).toMatch(/poza oknem/);
  });
  it("użyty nonce → odrzut replay", async () => {
    const sig = await signRequest(SECRET, req());
    expect(await verifyRequest(SECRET, req(), sig, NOW, () => true)).toMatch(/replay/);
  });
  it("brak sekretu → odrzut", async () => {
    expect(await verifyRequest("", req(), "x", NOW, noSeen)).toMatch(/brak sekretu/);
  });
});

describe("timingSafeEqual", () => {
  it("równe → true; różne długości/treści → false", () => {
    expect(timingSafeEqual("abcd", "abcd")).toBe(true);
    expect(timingSafeEqual("abcd", "abce")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("QR parowania — encode/decode i walidacja", () => {
  it("round-trip zachowuje url/secret/name", () => {
    const p = { v: 1 as const, url: "http://192.168.1.50:4318/", secret: "abcdef0123456789", name: "PC-Marcin" };
    expect(decodePairingPayload(encodePairingPayload(p))).toEqual(p);
  });
  it("odrzuca śmieci, złą wersję, krótki sekret i nie-http URL", () => {
    expect(decodePairingPayload("nie-json")).toBeNull();
    expect(decodePairingPayload(JSON.stringify({ v: 2, url: "http://x/", secret: "abcdef0123456789" }))).toBeNull();
    expect(decodePairingPayload(JSON.stringify({ v: 1, url: "http://x/", secret: "krotki" }))).toBeNull();
    expect(decodePairingPayload(JSON.stringify({ v: 1, url: "javascript:alert(1)", secret: "abcdef0123456789" }))).toBeNull();
  });
});

// Weryfikacja HMAC WEWNĄTRZ rdzenia listenera EXE — używamy PRAWDZIWEGO podpisu z pairing.ts
// jako ctx.verifyHmac (jedno źródło prawdy kontraktu; klient i serwer liczą tak samo).
describe("Rdzeń listenera EXE z wymaganym parowaniem (HMAC)", () => {
  const seen = new Set<string>();
  let state: { windowVisible: boolean; clipboard: string };
  beforeEach(() => {
    seen.clear();
    state = { windowVisible: false, clipboard: "" };
  });

  // Web Crypto HMAC bez async w callbacku rdzenia: rdzeń woła verifyHmac synchronicznie,
  // więc dostarczamy z góry policzony podpis i porównanie stringów (deterministyczne).
  const verifyHmac = (secret: string, canonical: string, sig: string) => sig === signHexSync.get(canonical + "|" + secret);
  const signHexSync = new Map<string, string>();

  const ctx = () => ({
    token: "tok",
    port: 4318,
    state,
    actions: { showWindow: () => { state.windowVisible = true; }, setClipboard: (t: string) => { state.clipboard = t; } },
    pairingSecret: SECRET,
    now: NOW,
    verifyHmac,
    seenNonce: (n: string) => seen.has(n),
    markNonce: (n: string) => seen.add(n),
  });

  async function signedRequest(nonce: string, ts = NOW) {
    const raw = JSON.stringify({ method: "tools/call", params: { name: "show_window" } });
    const canonical = canonicalString({ method: "POST", path: "/", body: raw, timestamp: ts, nonce });
    const sig = await signRequest(SECRET, { method: "POST", path: "/", body: raw, timestamp: ts, nonce });
    signHexSync.set(canonical + "|" + SECRET, sig);
    return {
      method: "POST",
      path: "/",
      headers: { authorization: "Bearer tok", "x-horizon-ts": String(ts), "x-horizon-nonce": nonce, "x-horizon-sig": sig },
      body: JSON.parse(raw),
      rawBody: raw,
    };
  }

  it("sparowany węzeł: żądanie BEZ podpisu → 401, mimo dobrego tokenu", () => {
    const r = core.handleHorizonRequest(
      { method: "POST", path: "/", headers: { authorization: "Bearer tok" }, body: { method: "tools/call", params: { name: "show_window" } } },
      ctx(),
    );
    expect(r.status).toBe(401);
    expect(String(r.json.content[0].text)).toMatch(/podpis/);
  });

  it("poprawnie podpisane żądanie → 200 i realna akcja", async () => {
    const signed = await signedRequest("n1");
    const r = core.handleHorizonRequest(signed, ctx());
    expect(r.status).toBe(200);
    expect(state.windowVisible).toBe(true);
  });

  it("replay tego samego podpisanego żądania (ten sam nonce) → 401", async () => {
    const c = ctx();
    const signed = await signedRequest("n2");
    expect(core.handleHorizonRequest(signed, c).status).toBe(200);
    // drugi raz: nonce już w seen → odrzut
    expect(core.handleHorizonRequest(signed, c).status).toBe(401);
  });

  it("podmieniony podpis → 401", async () => {
    const signed = await signedRequest("n3");
    signed.headers["x-horizon-sig"] = "0".repeat(64);
    expect(core.handleHorizonRequest(signed, ctx()).status).toBe(401);
  });

  it("stary znacznik czasu → 401 (replay)", async () => {
    const signed = await signedRequest("n4", NOW - MAX_SKEW_MS - 1);
    expect(core.handleHorizonRequest(signed, ctx()).status).toBe(401);
  });
});

describe("makeSignatureHeaders + freshNonce (klient)", () => {
  it("nagłówki zawierają ts/nonce/sig zgodny z verifyRequest", async () => {
    const nonce = freshNonce();
    const body = JSON.stringify({ method: "tools/call", params: { name: "read_state" } });
    const h = await makeSignatureHeaders(SECRET, "POST", "/", body, NOW, nonce);
    expect(h["x-horizon-nonce"]).toBe(nonce);
    const r: SignableRequest = { method: "POST", path: "/", body, timestamp: NOW, nonce };
    expect(await verifyRequest(SECRET, r, h["x-horizon-sig"], NOW, () => false)).toBeNull();
    expect(nonce).toHaveLength(32);
  });
});
