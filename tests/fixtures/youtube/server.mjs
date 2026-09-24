// Local YouTube look-alike for browser tests and local acceptance (mission M2). No external
// requests, no dependencies. Mimics the parts JARVIS must cope with on the real site: the EU
// consent wall, a watch page, lazily loaded comments with continuation, a pinned comment,
// nested replies, live counters, periodic full re-renders of the comment list and a comment
// that tries prompt injection.
//
// Usage: node tests/fixtures/youtube/server.mjs [--port 4173]
// Or:    import { startYoutubeFixture } from "./server.mjs"

import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { COMMENTS, PAGE_SIZE, VIDEOS } from "./data.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_JS = readFileSync(path.join(here, "client.js"), "utf8");
const STYLE_CSS = readFileSync(path.join(here, "style.css"), "utf8");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function page(title, body, config) {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/style.css">
<script>window.__FIXTURE__ = ${JSON.stringify(config)};</script>
<script src="/client.js" defer></script>
</head>
<body>${body}</body>
</html>`;
}

function consentPage(cont) {
  return page("Zanim przejdziesz do YouTube", `
<main id="consent" class="consent">
  <div role="dialog" aria-modal="true" aria-labelledby="consent-title" class="consent-box">
    <h1 id="consent-title">Zanim przejdziesz do YouTube</h1>
    <p>Używamy plików cookie i danych, aby dostarczać i utrzymywać usługi Google, śledzić przerwy w ich działaniu i chronić przed spamem, oszustwami oraz nadużyciami.</p>
    <form method="post" action="/consent?choice=reject&continue=${encodeURIComponent(cont)}">
      <button type="submit" id="reject-all">Odrzuć wszystko</button>
    </form>
    <form method="post" action="/consent?choice=accept&continue=${encodeURIComponent(cont)}">
      <button type="submit" id="accept-all">Zaakceptuj wszystko</button>
    </form>
    <a href="#" id="more-options">Więcej opcji</a>
  </div>
</main>`, { page: "consent" });
}

function header() {
  return `<header id="masthead" role="banner">
  <a href="/" id="logo" aria-label="YouTube Strona główna">YouTube</a>
  <form role="search" action="/results"><input type="search" name="q" aria-label="Szukaj" placeholder="Szukaj"><button type="submit">Szukaj</button></form>
</header>`;
}

function homePage() {
  const items = VIDEOS.map((v) => `
    <ytd-rich-item-renderer class="video-card">
      <a id="video-title" href="/watch?v=${v.id}">${esc(v.title)}</a>
      <span class="channel">${esc(v.channel)}</span> <span class="views">${esc(v.views)}</span>
    </ytd-rich-item-renderer>`).join("");
  return page("YouTube", `${header()}
<main id="content">
  <h1 class="visually-hidden">Strona główna</h1>
  <section id="contents" aria-label="Polecane filmy">${items}</section>
</main>`, { page: "home" });
}

function watchPage(v, opts) {
  const related = VIDEOS.filter((x) => x.id !== v.id).map((x) => `<li><a href="/watch?v=${x.id}">${esc(x.title)}</a></li>`).join("");
  const filler = Array.from({ length: 6 }, (_, i) => `<p>Opis, akapit ${i + 1}. Nagranie powstało nocą, z ręki, bez stabilizatora.</p>`).join("");
  return page(`${v.title} - YouTube`, `${header()}
<main id="content">
  <div id="player" role="region" aria-label="Odtwarzacz"><button id="play" aria-label="Odtwórz">▶</button><div class="progress" aria-hidden="true"></div></div>
  <h1 id="video-title-h1">${esc(v.title)}</h1>
  <div id="owner"><a href="/${esc(v.channel)}">${esc(v.channel)}</a> <button id="subscribe">Subskrybuj</button></div>
  <div id="description" aria-label="Opis">${filler}</div>
  <aside id="related" aria-label="Następne filmy"><ul>${related}</ul></aside>
  <ytd-comments id="comments" role="region" aria-label="Komentarze">
    <h2 id="comments-header">Komentarze <span id="comment-count">${COMMENTS[v.id]?.length ?? 0}</span></h2>
    <div id="contents" aria-live="off"></div>
    <div id="continuation"><span class="spinner" role="status">Ładowanie komentarzy…</span></div>
  </ytd-comments>
  <footer id="page-end">Koniec strony</footer>
</main>`, { page: "watch", videoId: v.id, ...opts });
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...extra });
  res.end(body);
}

/**
 * Start the fixture. Options: port (0 = random), commentDelayMs, rerenderMs (0 disables full
 * re-renders), likeTickMs (0 disables live counters), noCommentIds (true: comments carry no
 * stable id attribute, like the real site, so identity must come from content).
 */
export function startYoutubeFixture(options = {}) {
  const opts = { port: 0, commentDelayMs: 250, rerenderMs: 3000, likeTickMs: 1500, noCommentIds: false, ...options };
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://fixture.local");
    requests.push(`${req.method} ${url.pathname}${url.search}`);
    const consent = cookies(req).jarvis_yt_consent;
    const runtime = {
      commentDelayMs: Number(url.searchParams.get("delay") ?? opts.commentDelayMs),
      rerenderMs: Number(url.searchParams.get("rerender") ?? opts.rerenderMs),
      likeTickMs: Number(url.searchParams.get("tick") ?? opts.likeTickMs),
      noCommentIds: url.searchParams.has("noids") || !!opts.noCommentIds,
    };

    if (url.pathname === "/client.js") return send(res, 200, "text/javascript; charset=utf-8", CLIENT_JS);
    if (url.pathname === "/style.css") return send(res, 200, "text/css; charset=utf-8", STYLE_CSS);
    if (url.pathname === "/favicon.ico") return send(res, 204, "image/x-icon", "");

    if (url.pathname === "/consent" && req.method === "POST") {
      const choice = url.searchParams.get("choice") === "accept" ? "accept" : "reject";
      const cont = url.searchParams.get("continue") || "/";
      const safe = cont.startsWith("/") && !cont.startsWith("//") ? cont : "/";
      return send(res, 303, "text/plain", "", { location: safe, "set-cookie": `jarvis_yt_consent=${choice}; Path=/; SameSite=Lax` });
    }

    if (url.pathname === "/api/comments") {
      const list = COMMENTS[url.searchParams.get("v") || ""] || [];
      const pageNo = Math.max(0, Number(url.searchParams.get("page") || 0));
      const items = list.slice(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE).map(({ replies, ...c }) => ({ ...c, replyCount: replies?.length ?? 0 }));
      const next = (pageNo + 1) * PAGE_SIZE < list.length ? pageNo + 1 : null;
      setTimeout(() => send(res, 200, "application/json; charset=utf-8", JSON.stringify({ items, next })), runtime.commentDelayMs);
      return;
    }

    if (url.pathname === "/api/replies") {
      const c = (COMMENTS[url.searchParams.get("v") || ""] || []).find((x) => x.id === url.searchParams.get("c"));
      setTimeout(() => send(res, 200, "application/json; charset=utf-8", JSON.stringify({ items: c?.replies ?? [] })), runtime.commentDelayMs);
      return;
    }

    const pagePath = `${url.pathname}${url.search}`;
    if (!consent && (url.pathname === "/" || url.pathname === "/watch")) {
      return send(res, 200, "text/html; charset=utf-8", consentPage(pagePath));
    }
    if (url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", homePage());
    if (url.pathname === "/watch") {
      const v = VIDEOS.find((x) => x.id === url.searchParams.get("v"));
      if (!v) return send(res, 404, "text/plain; charset=utf-8", "Nie znaleziono filmu");
      return send(res, 200, "text/html; charset=utf-8", watchPage(v, runtime));
    }
    return send(res, 404, "text/plain; charset=utf-8", "404");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        requests,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r(undefined)); }),
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const i = process.argv.indexOf("--port");
  const port = i > 0 ? Number(process.argv[i + 1]) : 4173;
  startYoutubeFixture({ port }).then((f) => console.log(`YouTube fixture on ${f.url}`));
}
