import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const dataDir = process.env.SITE_OS_DATA_DIR ? path.resolve(process.env.SITE_OS_DATA_DIR) : path.join(rootDir, "data");
const runtimeDir = process.env.SITE_OS_RUNTIME_DIR ? path.resolve(process.env.SITE_OS_RUNTIME_DIR) : path.join(rootDir, ".runtime");
const toolsDir = process.env.SITE_OS_TOOLS_DIR ? path.resolve(process.env.SITE_OS_TOOLS_DIR) : path.join(rootDir, ".tools");
const projectsFile = path.join(dataDir, "projects.json");
const commandsFile = path.join(dataDir, "commands.json");
const leadsFile = path.join(dataDir, "leads.json");
const runtimeFile = path.join(runtimeDir, "connection.json");
const host = process.env.SITE_OS_HOST || "127.0.0.1";
const port = Number(process.env.SITE_OS_PORT || 3210);
const version = "0.2.1";
const localUrl = "http://" + host + ":" + port;
const maxBodyBytes = 8 * 1024 * 1024;

let tunnelProcess = null;
let tunnelUrl = "";
let tunnelError = "";
let tunnelStarting = null;
const leadRate = new Map();

async function connectToRunningInstance() {
  const healthResponse = await fetch(localUrl + "/api/health", {
    signal: AbortSignal.timeout(3000)
  });
  const health = await healthResponse.json();
  if (!healthResponse.ok || health?.ok !== true || health?.name !== runtime.name) {
    throw new Error("Port jest zajęty przez inną aplikację.");
  }

  if (process.argv.includes("--tunnel")) {
    const sessionResponse = await fetch(localUrl + "/api/session", {
      signal: AbortSignal.timeout(3000)
    });
    const session = await sessionResponse.json();
    if (!sessionResponse.ok || !session?.token) {
      throw new Error("Nie udało się pobrać lokalnej sesji Site OS.");
    }
    const tunnelResponse = await fetch(localUrl + "/api/tunnel/start", {
      method: "POST",
      headers: { "X-Jarvis-Token": session.token },
      signal: AbortSignal.timeout(5000)
    });
    if (!tunnelResponse.ok) {
      throw new Error("Nie udało się uruchomić tunelu w działającym Site OS.");
    }
  }

  console.log("");
  console.log("JARVIS Site OS już działa.");
  console.log("Edytor: " + localUrl);
  if (process.argv.includes("--tunnel")) console.log("Tunel jest uruchamiany w działającej instancji.");
}

function starterHtml() {
  return `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Northstar Studio</title>
  <meta name="description" content="Projektujemy miejsca, do których chce się wracać.">
  <style>
    :root{--ink:#10201c;--paper:#f5f3ed;--green:#1f6b52;--coral:#e76f51;--line:#c8cec7}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;overflow-x:hidden;background:var(--paper);color:var(--ink);font:16px/1.55 Arial,sans-serif}
    nav{height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 6vw;border-bottom:1px solid var(--line)}
    nav strong{font-size:18px}nav a{color:inherit;text-decoration:none;margin-left:24px}
    .hero{min-height:72vh;display:grid;grid-template-columns:1.05fr .95fr;align-items:stretch}
    .hero-copy{padding:9vw 6vw 6vw;display:flex;flex-direction:column;justify-content:center}
    .eyebrow{text-transform:uppercase;font-size:12px;font-weight:700;color:var(--green)}
    h1{font:700 clamp(44px,7vw,96px)/.98 Georgia,serif;margin:18px 0 24px;letter-spacing:0}
    .lead{font-size:20px;max-width:580px;overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
    .button{display:inline-flex;padding:13px 18px;background:var(--green);color:white;text-decoration:none;font-weight:700}
    .button.alt{background:transparent;color:var(--ink);border:1px solid var(--ink)}
    .hero-image{min-height:520px;background:url("https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1400&q=85") center/cover}
    .proof{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .proof article{padding:34px 6vw;border-right:1px solid var(--line)}.proof article:last-child{border:0}.proof b{font:700 34px Georgia,serif}
    @media(max-width:760px){nav div{display:none}.hero{grid-template-columns:1fr}.hero-copy{padding:70px 24px}.hero-image{min-height:340px}.proof{grid-template-columns:1fr}.proof article{border-right:0;border-bottom:1px solid var(--line)}}
  </style>
</head>
<body>
  <nav><strong>NORTHSTAR</strong><div><a href="#oferta">Oferta</a><a href="#kontakt">Kontakt</a></div></nav>
  <main>
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">Strategia, przestrzeń, wzrost</span>
        <h1>Marka, którą widać i czuć.</h1>
        <p class="lead">Tworzymy dopracowane miejsca i doświadczenia, które zamieniają pierwsze wrażenie w długą relację.</p>
        <div class="actions"><a class="button" href="#kontakt">Umów rozmowę</a><a class="button alt" href="#oferta">Zobacz realizacje</a></div>
      </div>
      <div class="hero-image" role="img" aria-label="Nowoczesna przestrzeń biurowa"></div>
    </section>
    <section class="proof" id="oferta">
      <article><b>42</b><p>zrealizowane marki</p></article>
      <article><b>18%</b><p>średni wzrost zapytań</p></article>
      <article><b>4.9</b><p>ocena współpracy</p></article>
    </section>
  </main>
</body>
</html>`;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  const temp = file + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, file);
}

async function ensureState() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  const projects = await readJson(projectsFile, []);
  if (!Array.isArray(projects) || projects.length === 0) {
    const now = Date.now();
    await writeJson(projectsFile, [{
      id: randomUUID(),
      name: "Northstar Studio",
      html: starterHtml(),
      brief: { source: "starter" },
      createdAt: now,
      updatedAt: now,
      versions: []
    }]);
  }
  const previous = await readJson(runtimeFile, {});
  const runtime = {
    name: "JARVIS Site OS",
    version,
    localUrl,
    token: typeof previous.token === "string" && previous.token.length > 20
      ? previous.token
      : randomBytes(32).toString("hex"),
    pairingCode: String(randomInt(100000, 999999)),
    startedAt: new Date().toISOString(),
    tunnelUrl: "",
    lastJarvisSeen: Number(previous.lastJarvisSeen || 0)
  };
  await writeJson(runtimeFile, runtime);
  return runtime;
}

const runtime = await ensureState();

function isLoopback(req) {
  // Tunel łączy się z serwerem lokalnie, dlatego sam remoteAddress nie wystarcza.
  // Każdy nagłówek proxy oznacza, że żądanie przyszło z zewnątrz.
  if (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.headers.forwarded) return false;
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function corsHeaders(req) {
  const origin = req.headers.origin || "";
  const allowed = !origin
    || origin === "null"
    || /^(capacitor|ionic):\/\/localhost$/i.test(origin)
    || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  return {
    ...(allowed && origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Jarvis-Token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Vary": "Origin"
  };
}

function send(req, res, status, body, extra = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...corsHeaders(req),
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extra
  });
  res.end(payload);
}

function bearer(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : String(req.headers["x-jarvis-token"] || "").trim();
}

function authorized(req) {
  return bearer(req) === runtime.token;
}

async function bodyJson(req) {
  const declaredSize = Number(req.headers["content-length"] || 0);
  if (declaredSize > maxBodyBytes) {
    const error = new Error("Projekt jest zbyt duży. Zmniejsz liczbę lub rozmiar grafik.");
    error.statusCode = 413;
    throw error;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("Projekt jest zbyt duży. Zmniejsz liczbę lub rozmiar grafik.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Dane żądania mają nieprawidłowy format.");
    error.statusCode = 400;
    throw error;
  }
}

async function projects() {
  const value = await readJson(projectsFile, []);
  return Array.isArray(value) ? value : [];
}

async function saveProjects(value) {
  await writeJson(projectsFile, value.slice(0, 200));
}

function leadClientKey(req) {
  return String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local").split(",")[0].trim();
}

function allowLead(req) {
  const key = leadClientKey(req);
  const now = Date.now();
  const recent = (leadRate.get(key) || []).filter((at) => now - at < 10 * 60 * 1000);
  if (recent.length >= 8) return false;
  recent.push(now);
  leadRate.set(key, recent);
  return true;
}

function cleanLeadValue(value, limit) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, limit);
}

function captureScript(projectId) {
  return `<script>(function(){document.addEventListener("submit",async function(event){var form=event.target.closest&&event.target.closest("[data-siteos-form]");if(!form)return;event.preventDefault();var status=form.querySelector(".siteos-form__status");var button=form.querySelector("[type=submit]");if(button)button.disabled=true;if(status)status.textContent="Wysyłanie…";try{var data=Object.fromEntries(new FormData(form).entries());var response=await fetch("/api/leads/${projectId}",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});var result=await response.json();if(!response.ok)throw new Error(result.error||"Nie udało się wysłać formularza.");form.reset();if(status)status.textContent="Dziękujemy. Wiadomość została wysłana."}catch(error){if(status)status.textContent=error.message||"Spróbuj ponownie za chwilę."}finally{if(button)button.disabled=false}},true)})();</script>`;
}

function withCapture(html, projectId) {
  const script = captureScript(projectId);
  return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, script + "</body>") : html + script;
}

function cleanProject(input, existing) {
  const now = Date.now();
  const html = typeof input.html === "string" ? input.html : existing?.html || starterHtml();
  const versions = Array.isArray(existing?.versions) ? [...existing.versions] : [];
  if (existing?.html && existing.html !== html) {
    versions.unshift({ at: now, html: existing.html });
    versions.length = Math.min(20, versions.length);
    while (versions.length > 1 && versions.reduce((sum, item) => sum + item.html.length, 0) > 8 * 1024 * 1024) versions.pop();
  }
  return {
    id: existing?.id || (typeof input.id === "string" && input.id) || randomUUID(),
    name: String(input.name || existing?.name || "Nowy projekt").slice(0, 120),
    html,
    brief: input.brief ?? existing?.brief ?? null,
    lead: input.lead ?? existing?.lead ?? null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    versions
  };
}

async function updateRuntime() {
  await writeJson(runtimeFile, { ...runtime, tunnelUrl });
}

async function ensureCloudflared() {
  if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH;
  if (process.platform !== "win32") return "cloudflared";

  const executable = path.join(toolsDir, "cloudflared.exe");
  if (existsSync(executable)) return executable;

  await mkdir(toolsDir, { recursive: true });
  const temp = executable + ".download";
  const source = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
  console.log("Pobieram oficjalny Cloudflare Tunnel…");
  const response = await fetch(source, { redirect: "follow" });
  if (!response.ok) throw new Error("Nie udało się pobrać Cloudflare Tunnel (HTTP " + response.status + ").");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 5_000_000) throw new Error("Pobrany plik Cloudflare Tunnel jest nieprawidłowy.");
  await writeFile(temp, bytes);
  await rename(temp, executable);
  console.log("Cloudflare Tunnel jest gotowy.");
  return executable;
}

async function startTunnel() {
  if (tunnelProcess && !tunnelProcess.killed) return;
  if (tunnelStarting) return tunnelStarting;

  tunnelStarting = (async () => {
    tunnelError = "";
    try {
      const executable = await ensureCloudflared();
      tunnelProcess = spawn(executable, ["tunnel", "--url", localUrl, "--no-autoupdate"], {
        cwd: rootDir,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const inspect = async (chunk) => {
        const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (match) {
          tunnelUrl = match[0];
          await updateRuntime();
          console.log("Publiczny podgląd: " + tunnelUrl);
        }
      };
      tunnelProcess.stdout.on("data", inspect);
      tunnelProcess.stderr.on("data", inspect);
      tunnelProcess.on("error", (error) => {
        tunnelUrl = "";
        tunnelError = error.message;
        updateRuntime().catch(() => {});
        console.error("Nie udało się uruchomić tunelu: " + error.message);
      });
      tunnelProcess.on("exit", () => {
        tunnelProcess = null;
        tunnelUrl = "";
        updateRuntime().catch(() => {});
      });
    } catch (error) {
      tunnelProcess = null;
      tunnelUrl = "";
      tunnelError = error instanceof Error ? error.message : String(error);
      await updateRuntime();
      throw error;
    } finally {
      tunnelStarting = null;
    }
  })();

  return tunnelStarting;
}
function stopTunnel() {
  if (tunnelProcess && !tunnelProcess.killed) tunnelProcess.kill();
  tunnelProcess = null;
  tunnelUrl = "";
  return updateRuntime();
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const target = path.resolve(publicDir, relative);
  if (!target.startsWith(path.resolve(publicDir)) || !existsSync(target)) return false;
  const ext = path.extname(target).toLowerCase();
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
  res.end(await readFile(target));
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", localUrl);
    const pathname = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }

    if (req.method === "GET" && pathname === "/api/health") {
      return send(req, res, 200, {
        ok: true,
        name: runtime.name,
        version,
        localUrl,
        tunnelUrl,
        tunnelError,
        pairingRequired: true
      });
    }

    if (req.method === "GET" && pathname === "/api/session") {
      if (!isLoopback(req)) return send(req, res, 403, { ok: false, error: "Edytor jest dostępny tylko lokalnie." });
      return send(req, res, 200, { ok: true, token: runtime.token, pairingCode: runtime.pairingCode });
    }

    if (req.method === "POST" && pathname === "/api/pair") {
      const input = await bodyJson(req);
      if (String(input.code || "") !== runtime.pairingCode) return send(req, res, 401, { ok: false, error: "Nieprawidłowy kod parowania." });
      runtime.pairingCode = String(randomInt(100000, 999999));
      await updateRuntime();
      return send(req, res, 200, { ok: true, token: runtime.token, url: localUrl, version });
    }

    const previewMatch = pathname.match(/^\/p\/([a-f0-9-]+)$/i);
    if (req.method === "GET" && previewMatch) {
      const project = (await projects()).find((item) => item.id === previewMatch[1]);
      if (!project) return send(req, res, 404, "Nie znaleziono projektu.");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "frame-ancestors *",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      });
      return res.end(withCapture(project.html, project.id));
    }

    const publicLeadMatch = pathname.match(/^\/api\/leads\/([a-f0-9-]+)$/i);
    if (req.method === "POST" && publicLeadMatch) {
      if (!allowLead(req)) return send(req, res, 429, { ok: false, error: "Za dużo prób. Spróbuj ponownie za kilka minut." });
      const projectExists = (await projects()).some((item) => item.id === publicLeadMatch[1]);
      if (!projectExists) return send(req, res, 404, { ok: false, error: "Nie znaleziono projektu." });
      const input = await bodyJson(req);
      if (cleanLeadValue(input.website, 200)) return send(req, res, 202, { ok: true });
      const lead = {
        id: randomUUID(),
        projectId: publicLeadMatch[1],
        name: cleanLeadValue(input.name, 160),
        email: cleanLeadValue(input.email, 240),
        phone: cleanLeadValue(input.phone, 80),
        message: cleanLeadValue(input.message, 4000),
        createdAt: Date.now()
      };
      if (!lead.name || !/^\S+@\S+\.\S+$/.test(lead.email) || !lead.message) {
        return send(req, res, 400, { ok: false, error: "Uzupełnij imię, poprawny e-mail i wiadomość." });
      }
      const list = await readJson(leadsFile, []);
      await writeJson(leadsFile, [lead, ...(Array.isArray(list) ? list : [])].slice(0, 2000));
      return send(req, res, 201, { ok: true, id: lead.id });
    }

    if (pathname.startsWith("/api/") && !authorized(req)) {
      return send(req, res, 401, { ok: false, error: "Brak autoryzacji Site OS." });
    }

    if (req.method === "POST" && pathname === "/api/commands") {
      const input = await bodyJson(req);
      const projectExists = (await projects()).some((item) => item.id === input.projectId);
      if (!projectExists || typeof input.prompt !== "string" || !input.prompt.trim()) {
        return send(req, res, 400, { ok: false, error: "Projekt i polecenie są wymagane." });
      }
      const list = await readJson(commandsFile, []);
      const command = {
        id: randomUUID(),
        projectId: input.projectId,
        prompt: input.prompt.trim().slice(0, 4000),
        selection: input.selection || null,
        status: "pending",
        createdAt: Date.now()
      };
      await writeJson(commandsFile, [command, ...(Array.isArray(list) ? list : [])].slice(0, 200));
      return send(req, res, 201, {
        ok: true,
        command,
        connected: Date.now() - Number(runtime.lastJarvisSeen || 0) < 45000
      });
    }

    if (req.method === "GET" && publicLeadMatch) {
      const list = await readJson(leadsFile, []);
      const leads = (Array.isArray(list) ? list : []).filter((lead) => lead.projectId === publicLeadMatch[1]).slice(0, 500);
      return send(req, res, 200, { ok: true, leads });
    }

    if (req.method === "GET" && pathname === "/api/public/commands") {
      runtime.lastJarvisSeen = Date.now();
      await updateRuntime();
      const list = await readJson(commandsFile, []);
      const pending = (Array.isArray(list) ? list : []).filter((item) => item.status === "pending");
      return send(req, res, 200, { ok: true, commands: pending });
    }

    const commandMatch = pathname.match(/^\/api\/public\/commands\/([a-f0-9-]+)$/i);
    if (req.method === "PUT" && commandMatch) {
      const input = await bodyJson(req);
      const list = await readJson(commandsFile, []);
      const command = (Array.isArray(list) ? list : []).find((item) => item.id === commandMatch[1]);
      if (!command) return send(req, res, 404, { ok: false, error: "Nie znaleziono polecenia." });
      command.status = input.status === "failed" ? "failed" : "done";
      command.error = typeof input.error === "string" ? input.error.slice(0, 1000) : null;
      command.completedAt = Date.now();
      if (typeof input.html === "string" && input.html.trim()) {
        const projectList = await projects();
        const existing = projectList.find((item) => item.id === command.projectId);
        if (existing) {
          const project = cleanProject({ html: input.html }, existing);
          await saveProjects([project, ...projectList.filter((item) => item.id !== project.id)]);
        }
      }
      await writeJson(commandsFile, list);
      return send(req, res, 200, { ok: true, command });
    }

    if (req.method === "GET" && pathname === "/api/projects") {
      const list = await projects();
      return send(req, res, 200, { ok: true, projects: list.map(({ html, versions, ...item }) => ({
        ...item,
        size: html.length,
        versionCount: versions?.length || 0
      })) });
    }

    if (req.method === "POST" && (pathname === "/api/projects" || pathname === "/api/public/projects")) {
      const input = await bodyJson(req);
      const list = await projects();
      const project = cleanProject(input);
      await saveProjects([project, ...list.filter((item) => item.id !== project.id)]);
      return send(req, res, 201, { ok: true, project });
    }

    const projectMatch = pathname.match(/^\/api\/(?:public\/)?projects\/([a-f0-9-]+)$/i);
    if (projectMatch) {
      const list = await projects();
      const existing = list.find((item) => item.id === projectMatch[1]);
      if (!existing) return send(req, res, 404, { ok: false, error: "Nie znaleziono projektu." });
      if (req.method === "GET") return send(req, res, 200, { ok: true, project: existing });
      if (req.method === "PUT") {
        const input = await bodyJson(req);
        const project = cleanProject(input, existing);
        await saveProjects([project, ...list.filter((item) => item.id !== project.id)]);
        return send(req, res, 200, { ok: true, project });
      }
      if (req.method === "DELETE") {
        await saveProjects(list.filter((item) => item.id !== existing.id));
        return send(req, res, 200, { ok: true });
      }
    }

    if (req.method === "POST" && pathname === "/api/tunnel/start") {
      await startTunnel();
      return send(req, res, 202, { ok: true, status: "starting", tunnelUrl, error: tunnelError });
    }

    if (req.method === "POST" && pathname === "/api/tunnel/stop") {
      await stopTunnel();
      return send(req, res, 200, { ok: true, status: "stopped" });
    }

    if (req.method === "GET" && pathname === "/api/tunnel") {
      return send(req, res, 200, { ok: true, active: Boolean(tunnelUrl), tunnelUrl, error: tunnelError });
    }

    if (await serveStatic(req, res, pathname)) return;
    send(req, res, 404, { ok: false, error: "Nie znaleziono." });
  } catch (error) {
    console.error(error);
    const status = Number(error?.statusCode) || 500;
    send(req, res, status, { ok: false, error: error instanceof Error ? error.message : "Błąd Site OS." });
  }
});

server.on("error", async (error) => {
  if (error?.code !== "EADDRINUSE") {
    console.error("Nie udało się uruchomić JARVIS Site OS:", error instanceof Error ? error.message : error);
    process.exit(1);
  }

  try {
    await connectToRunningInstance();
    process.exit(0);
  } catch (connectionError) {
    console.error(
      "Port " + port + " jest już zajęty:",
      connectionError instanceof Error ? connectionError.message : connectionError
    );
    process.exit(1);
  }
});

server.listen(port, host, () => {
  console.log("");
  console.log("JARVIS Site OS " + version);
  console.log("Edytor: " + localUrl);
  console.log("Kod parowania: " + runtime.pairingCode);
  if (process.argv.includes("--tunnel")) void startTunnel();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await stopTunnel();
    server.close(() => process.exit(0));
  });
}
