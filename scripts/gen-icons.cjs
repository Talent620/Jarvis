#!/usr/bin/env node
/**
 * Generator ikon PNG dla PWA/iOS (bez zewnętrznych zależności — czysty Node + zlib).
 * Rysuje „arc reactor" JARVISA (zgodnie z public/favicon.svg) z supersamplingiem (gładkie krawędzie)
 * i zapisuje icon-180/192/512.png oraz icon-512-maskable.png do public/.
 * Uruchom: `node scripts/gen-icons.cjs`
 */
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtr 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

// scale = ile „promienia" zajmuje reaktor (1 = do krawędzi; <1 = margines dla maskable).
function renderIcon(size, scale = 1) {
  const SS = 4, W = size * SS;
  const acc = new Float32Array(W * W * 4);
  const cx = W / 2, cy = W / 2, R = (W / 2) * scale;
  const bg = [4, 7, 15], outerStroke = [29, 111, 165];
  const gradIn = [127, 239, 255], gradMid = [47, 182, 255], gradEdge = [10, 58, 102];
  const coreRing = [159, 243, 255];
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const dx = (x - cx) / R, dy = (y - cy) / R, r = Math.hypot(dx, dy);
    let col = bg.slice();
    if (r < 0.281) { // tarcza z gradientem radialnym
      const t = Math.min(1, r / 0.281);
      const g = t < 0.6 ? mix(gradIn, gradMid, t / 0.6) : mix(gradMid, gradEdge, (t - 0.6) / 0.4);
      col = mix(col, g, 0.92);
    }
    if (r < 0.141) col = bg.slice(); // ciemny rdzeń
    if (Math.abs(r - 0.141) < 0.014) col = mix(col, coreRing, 0.9); // obwódka rdzenia
    const onAxis = Math.abs(dx) < 0.028 || Math.abs(dy) < 0.028;
    if (onAxis && r > 0.27 && r < 0.42) col = mix(col, coreRing, 0.75); // 4 szprychy
    if (Math.abs(r - 0.469) < 0.016) col = mix(col, outerStroke, 1); // pierścień zewnętrzny
    const i = (y * W + x) * 4; col = col.map((v) => Math.max(0, Math.min(255, v)));
    acc[i] = col[0]; acc[i + 1] = col[1]; acc[i + 2] = col[2]; acc[i + 3] = 255;
  }
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const i = ((y * SS + sy) * W + (x * SS + sx)) * 4; r += acc[i]; g += acc[i + 1]; b += acc[i + 2]; a += acc[i + 3];
    }
    const n = SS * SS, o = (y * size + x) * 4;
    out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
  }
  return out;
}

const pub = path.join(__dirname, "..", "public");
const jobs = [
  ["icon-180.png", 180, 1],
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["icon-512-maskable.png", 512, 0.72], // safe zone dla maskowanych ikon
];
for (const [name, size, scale] of jobs) {
  fs.writeFileSync(path.join(pub, name), encodePNG(size, renderIcon(size, scale)));
  console.log("✓", name, `${size}×${size}`);
}
