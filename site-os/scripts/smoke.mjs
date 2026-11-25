const base = process.env.SITE_OS_URL || "http://127.0.0.1:3210";

async function json(path, init = {}) {
  const response = await fetch(base + path, init);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

const session = await json("/api/session");
if (!session.response.ok || !session.body.token) throw new Error("Brak lokalnej sesji.");

const headers = {
  "Content-Type": "application/json",
  "X-Jarvis-Token": session.body.token
};

const health = await json("/api/health");
if (health.body.version !== "2.0.0") throw new Error("Serwer zwraca nieprawidłową wersję: " + health.body.version);

const malformed = await json("/api/pair", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{"
});
if (malformed.response.status !== 400) throw new Error("Nieprawidłowy JSON nie zwraca czytelnego błędu.");

// P0-2: Tunel (CF-Connecting-IP) musi blokować /, /api/session oraz /api/pair kodem 403
const proxiedEditor = await fetch(base + "/", { headers: { "CF-Connecting-IP": "203.0.113.10" } });
if (proxiedEditor.status !== 403) throw new Error("Tunel uzyskał dostęp do panelu edytora.");

const proxiedSession = await json("/api/session", { headers: { "CF-Connecting-IP": "203.0.113.10" } });
if (proxiedSession.response.status !== 403) throw new Error("Tunel uzyskał dostęp do lokalnego tokenu.");

const proxiedPair = await json("/api/pair", {
  method: "POST",
  headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
  body: JSON.stringify({ code: "123456" })
});
if (proxiedPair.response.status !== 403) throw new Error("Tunel uzyskał dostęp do endpointu parowania /api/pair.");

// Magic Bytes: odrzucenie surowego SVG XSS (415)
const svgAttack = await json("/api/uploads", {
  method: "POST",
  headers,
  body: JSON.stringify({ dataUrl: "data:image/svg+xml;base64," + Buffer.from("<svg onload=alert(1)>").toString("base64") })
});
if (svgAttack.response.status !== 415) throw new Error("Filtr Magic Bytes nie zablokował pliku SVG.");

const projects = await json("/api/projects", { headers });
if (!projects.body.projects?.length) throw new Error("Brak projektu startowego.");

const projectId = projects.body.projects[0].id;
const project = await json("/api/projects/" + projectId, { headers });
if (!project.body.project?.html?.includes("<html")) throw new Error("Projekt nie zawiera HTML.");

// P1-4: Upsert po jarvisProjectId nie tworzy duplikatów
const upsertA = await json("/api/public/projects", {
  method: "POST",
  headers,
  body: JSON.stringify({ jarvisProjectId: "smoke-jarvis-1", name: "Smoke Boutique", html: project.body.project.html })
});
const upsertB = await json("/api/public/projects", {
  method: "POST",
  headers,
  body: JSON.stringify({ jarvisProjectId: "smoke-jarvis-1", name: "Smoke Boutique v2", html: project.body.project.html + "\n<!-- v2 -->" })
});
if (upsertA.body.project?.id !== upsertB.body.project?.id || !upsertB.body.upserted) {
  throw new Error("Upsert jarvisProjectId utworzył duplikat projektu.");
}
await json("/api/projects/" + upsertA.body.project.id, { method: "DELETE", headers });

const command = await json("/api/commands", {
  method: "POST",
  headers,
  body: JSON.stringify({ projectId, prompt: "Test połączenia JARVIS Site OS" })
});
if (command.body.command?.status !== "pending") throw new Error("Polecenie nie trafiło do kolejki.");

const queue = await json("/api/public/commands", { headers });
if (!queue.body.commands?.some((item) => item.id === command.body.command.id)) throw new Error("Kolejka nie zwróciła polecenia.");

const complete = await json("/api/public/commands/" + command.body.command.id, {
  method: "PUT",
  headers,
  body: JSON.stringify({ status: "done" })
});
if (complete.body.command?.status !== "done") throw new Error("Nie udało się zakończyć polecenia.");

// Podgląd klienta musi działać również przez tunel
const preview = await fetch(base + "/p/" + projectId, { headers: { "CF-Connecting-IP": "203.0.113.10" } });
const previewHtml = await preview.text();
if (!preview.ok || !previewHtml.includes("<html") || !previewHtml.includes("/api/leads/" + projectId)) throw new Error("Podgląd klienta nie działa.");

const lead = await json("/api/leads/" + projectId, {
  method: "POST",
  headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
  body: JSON.stringify({ name: "Test Site OS", email: "site-os@example.com", message: "Test formularza leadowego" })
});
if (!lead.response.ok || !lead.body.id) throw new Error("Formularz leadowy nie zapisuje kontaktów.");

const leads = await json("/api/leads/" + projectId, { headers });
if (!leads.body.leads?.some((item) => item.id === lead.body.id)) throw new Error("Panel nie odczytuje kontaktów.");

console.log(JSON.stringify({
  ok: true,
  version: health.body.version,
  projects: projects.body.projects.length,
  commandQueue: "ok",
  preview: "ok",
  leadCapture: "ok",
  requestValidation: "ok",
  tunnelIsolation: "ok",
  magicBytesGuard: "ok",
  jarvisProjectUpsert: "ok"
}, null, 2));
