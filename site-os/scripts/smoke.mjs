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
const projects = await json("/api/projects", { headers });
if (!projects.body.projects?.length) throw new Error("Brak projektu startowego.");

const projectId = projects.body.projects[0].id;
const project = await json("/api/projects/" + projectId, { headers });
if (!project.body.project?.html?.includes("<html")) throw new Error("Projekt nie zawiera HTML.");

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

const proxiedSession = await json("/api/session", { headers: { "CF-Connecting-IP": "203.0.113.10" } });
if (proxiedSession.response.status !== 403) throw new Error("Tunel uzyskał dostęp do lokalnego tokenu.");

const preview = await fetch(base + "/p/" + projectId);
if (!preview.ok || !(await preview.text()).includes("<html")) throw new Error("Podgląd klienta nie działa.");

console.log(JSON.stringify({
  ok: true,
  version: health.body.version,
  projects: projects.body.projects.length,
  commandQueue: "ok",
  preview: "ok",
  tunnelIsolation: "ok"
}, null, 2));
