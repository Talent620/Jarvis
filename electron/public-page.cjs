// Public, unauthenticated GET-only page retrieval. No browser profile, cookies or scripts.
const dns = require("node:dns/promises");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

function isPublicIPv4(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

function createPublicPageReader({ allowLocal = false, maxBytes = 512 * 1024, timeoutMs = 12000, lookup = dns.lookup, get = null } = {}) {
  async function readPage(raw) {
    let url = new URL(String(raw || ""));
    const deadline = Date.now() + timeoutMs;
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("Dozwolone są tylko publiczne adresy HTTP/HTTPS bez danych logowania.");
      if (!allowLocal && url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443'))) throw new Error("Niestandardowy port jest niedozwolony.");
      if (url.hostname.includes(':')) throw new Error("Adresy IPv6 nie są obsługiwane przez bezpieczny odczyt.");
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Upłynął czas oczekiwania na stronę.");
      const addresses = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Upłynął czas oczekiwania na DNS.")), remaining);
        lookup(url.hostname, { all: true, family: 4 }).then(
          (value) => { clearTimeout(timer); resolve(value); },
          (error) => { clearTimeout(timer); reject(error); },
        );
      });
      if (!addresses.length || (!allowLocal && addresses.some(({ address }) => !isPublicIPv4(address)))) throw new Error("Adres lokalny, prywatny lub zastrzeżony jest niedozwolony.");
      const pinned = addresses[0].address;
      const result = await new Promise((resolve, reject) => {
        const request = (get || (url.protocol === 'https:' ? https.get : http.get))(url, {
          lookup: (_host, _options, callback) => callback(null, pinned, 4),
          headers: { accept: 'text/html,text/plain;q=0.9', 'user-agent': 'JARVIS-PageReader/1.0' },
          timeout: timeoutMs,
        }, (res) => {
          const status = res.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) { res.resume(); resolve({ redirect: res.headers.location }); return; }
          if (status < 200 || status >= 300) { res.resume(); reject(new Error(`Strona zwróciła HTTP ${status}.`)); return; }
          const contentType = String(res.headers['content-type'] || '').toLowerCase();
          if (!contentType.startsWith('text/html') && !contentType.startsWith('text/plain')) { res.resume(); reject(new Error('Strona nie zwróciła tekstu ani HTML.')); return; }
          let total = 0; const parts = [];
          res.on('data', (chunk) => { total += chunk.length; if (total > maxBytes) { reject(new Error('Strona przekracza limit rozmiaru.')); res.destroy(); } else parts.push(chunk); });
          res.on('aborted', () => reject(new Error('Odpowiedź została przerwana.')));
          res.on('error', reject);
          res.on('end', () => resolve({ url: url.toString(), status, contentType, body: Buffer.concat(parts).toString('utf8') }));
        });
        request.on('timeout', () => request.destroy(new Error('Upłynął czas oczekiwania na stronę.')));
        request.on('error', reject);
      });
      if (!result.redirect) return result;
      if (redirects === 3) throw new Error('Zbyt wiele przekierowań.');
      url = new URL(result.redirect, url);
    }
    throw new Error('Nie udało się odczytać strony.');
  }
  return { readPage };
}
module.exports = { createPublicPageReader, isPublicIPv4 };
