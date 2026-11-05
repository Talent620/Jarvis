// Główny proces Electrona — JARVIS na komputer (Windows .exe), pełna wersja.
const { app, BrowserWindow, shell, session, Menu, ipcMain, desktopCapturer, screen, globalShortcut, clipboard, Notification, dialog, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, exec } = require("child_process");
const os = require("os");
const { launchLinux } = require("./launch-app.cjs");
const { createLinuxKeyboard } = require("./linux-keyboard.cjs");
const linuxKeyboard = createLinuxKeyboard({
  consentWindowId: () => mainWindow && !mainWindow.isDestroyed()
    ? String(mainWindow.getNativeWindowHandle().readUInt32LE(0)) : null,
});
const { createWorkspaceTools } = require("./workspace-tools.cjs");
const { createStdioMcpManager } = require("./mcp-stdio.cjs");
const { createConfiguredLocalOllamaManager } = require("./local-ollama.cjs");
const { createLocalSiteOsManager } = require("./local-siteos.cjs");
const localOllama = createConfiguredLocalOllamaManager();
const { createGoalService } = require("./goal-service.cjs");
const { createSkillManager } = require("./skill-manager.cjs");
const { createSkillIsolation } = require("./skill-isolation.cjs");
const { createMonitorConnectors } = require("./monitor-connectors.cjs");
const { createBrowserSession } = require("./browser-session.cjs");

if (process.env.JARVIS_PROFILE_DIR) app.setPath("userData", path.resolve(process.env.JARVIS_PROFILE_DIR));

const STATE_FILE = path.join(app.getPath("userData"), "window-state.json");

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { width: 1100, height: 820 };
  }
}
function saveState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    fs.writeFileSync(STATE_FILE, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

let mainWindow = null;
let siteOsManager = null;
let stdioMcp = null;
let closingStdioMcp = false;
let monitorService = null;
let monitorConnectorService = null;
let skillService = null;
let skillSandbox = null;
let browserService = null;
const skillOperations = new Map();
const skillReleaseRequests = new Set();
const cancelledSkillTasks = new Set();
const cancelledSkillExecutions = new Set();
let ownerConsentEpoch = 0;
let monitorConsentPending = 0;
async function confirmMonitorScope(options) {
  monitorConsentPending++;
  try { return await dialog.showMessageBox(mainWindow, options); }
  finally { monitorConsentPending--; }
}

const MONITOR_SETTINGS_FILE = path.join(app.getPath("userData"), "monitor-settings.json");
let backgroundMonitoring = false;
try { backgroundMonitoring = JSON.parse(fs.readFileSync(MONITOR_SETTINGS_FILE, "utf8")).backgroundEnabled === true; } catch { /* default opt-out */ }

function monitors() {
  if (!monitorService) monitorService = createGoalService({
    directory: path.join(app.getPath("userData"), "goals"),
    connectors: connectors(),
    notify: async (event) => {
      if (!Notification.isSupported()) return { accepted: false };
      const reason = typeof event.reason === "string" ? event.reason : [event.reason?.contains, event.reason?.variant, event.reason?.condition].filter(Boolean).join(" · ");
      const notification = new Notification({ title: `JARVIS — ${event.title || "dopasowanie"}`,
        body: `${reason}\n${event.total != null ? `${event.total} ${event.currency || ""} · ` : ""}${event.url || ""}\nSprawdzono: ${new Date(event.observedAt).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}\nCel: ${event.goalId} · zdarzenie: ${event.id}` });
      notification.on("click", summonWindow);
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({}), 3000); // unknown OS result; outbox retains UNCERTAIN
        notification.once("show", () => { clearTimeout(timer); resolve({ accepted: true }); });
        notification.once("failed", () => { clearTimeout(timer); resolve({ accepted: false }); });
        try { notification.show(); } catch { clearTimeout(timer); resolve({}); }
      }); // OS show event; no claim of delivery to or reading by the user.
    },
  });
  return monitorService;
}

function connectors() {
  if (!monitorConnectorService) monitorConnectorService = createMonitorConnectors({
    directory: path.join(app.getPath("userData"), "connectors"),
    encrypt: value => {
      if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === "basic_text") throw new Error("Brak bezpiecznego magazynu kluczy systemu. Konfiguracja nie została zapisana.");
      return safeStorage.encryptString(value);
    },
    decrypt: value => {
      if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === "basic_text") throw new Error("Bezpieczny magazyn kluczy jest niedostępny.");
      return safeStorage.decryptString(value);
    },
  });
  return monitorConnectorService;
}
function skills() {
  if (!skillService) {
    skillSandbox = createSkillIsolation();
    skillService = createSkillManager({ directory: path.join(app.getPath("userData"), "skills"), sandbox: skillSandbox });
  }
  return skillService;
}
function cancelSkillTask(taskId, executionId) {
  const cancelled = executionId ? cancelledSkillExecutions : cancelledSkillTasks;
  cancelled.add(executionId ? `${taskId}:${executionId}` : taskId);
  // IDs are random and never reused. Bound cancelled-task retention independently of pins.
  if (cancelled.size > 2000) cancelled.delete(cancelled.values().next().value);
  for (const controller of skillOperations.get(taskId) || []) if (!executionId || controller.executionId === executionId) controller.abort();
}
function stopNativeSkills() {
  for (const taskId of skillOperations.keys()) cancelSkillTask(taskId);
  skillService?.stopAll();
  return skillSandbox?.cancelAll();
}


function siteOsPaths() {
  const base = path.join(app.getPath("userData"), "site-os");
  return {
    script: app.isPackaged
      ? path.join(process.resourcesPath, "site-os", "server.mjs")
      : path.join(__dirname, "..", "site-os", "server.mjs"),
    data: path.join(base, "data"),
    runtime: path.join(base, "runtime"),
    tools: path.join(base, "tools"),
  };
}

function localSiteOs() {
  if (!siteOsManager) siteOsManager = createLocalSiteOsManager({ paths: siteOsPaths() });
  return siteOsManager;
}

async function startSiteOs({ tunnel = false } = {}) {
  const result = await localSiteOs().ensure("http://127.0.0.1:3210", { tunnel });
  if (!result.ok) return result;
  await shell.openExternal(result.url);
  return result;
}

// Przywołanie JARVIS-a nad każdą aplikacją (globalny skrót systemowy).
function summonWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Obserwator schowka (opt-in z ustawień aplikacji): co 1,5 s sprawdza, czy
// skopiowano NOWY tekst i wysyła go do interfejsu — JARVIS proaktywnie
// proponuje akcję w dyskretnym widgecie. Nic nie wychodzi do sieci samo.
let clipTimer = null;
let clipLast = "";
function setClipWatch(enabled) {
  if (clipTimer) {
    clearInterval(clipTimer);
    clipTimer = null;
  }
  if (!enabled) return;
  clipLast = clipboard.readText() || ""; // baza — nie reagujemy na to, co już jest
  clipTimer = setInterval(() => {
    try {
      const t = (clipboard.readText() || "").trim();
      if (!t || t === clipLast || t.length < 12 || t.length > 8000) {
        if (t && t !== clipLast) clipLast = t;
        return;
      }
      clipLast = t;
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
        mainWindow.webContents.send("jarvis:clipboard", t.slice(0, 4000));
      }
    } catch {
      /* schowek chwilowo niedostępny */
    }
  }, 1500);
}

function createWindow() {
  monitors().start();
  const st = loadState();
  mainWindow = new BrowserWindow({
    width: st.width || 1100,
    height: st.height || 820,
    x: st.x,
    y: st.y,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: "#04070f",
    autoHideMenuBar: true,
    title: "JARVIS",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // izolacja renderera (mostek IPC przez preload pozostaje)
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // QA builds stay outside dist and never replace the user's production bundle.
  const rendererDir = !app.isPackaged && process.env.JARVIS_QA_RENDERER_DIR
    ? path.resolve(process.env.JARVIS_QA_RENDERER_DIR) : path.join(__dirname, "../dist");
  mainWindow.loadFile(path.join(rendererDir, "index.html"));

  // Twarda blokada nawigacji: renderer nie może opuścić własnego file:// (inaczej
  // wroga strona przejęłaby cały mostek jarvisDesktop — uruchamianie, klawiatura, tokeny).
  const allowNav = (e, url) => { if (!url.startsWith("file://")) e.preventDefault(); };
  mainWindow.webContents.on("will-navigate", allowNav);
  mainWindow.webContents.on("will-redirect", allowNav);

  // Linki zewnętrzne (Spotify, YouTube, mapy itd.) → przeglądarka systemowa.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  ["resize", "move", "close"].forEach((ev) => mainWindow.on(ev, () => saveState(mainWindow)));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: "JARVIS",
      submenu: [
        { role: "reload", label: "Odśwież" },
        // DevTools tylko w buildzie deweloperskim — w produkcji ułatwiają wyciek kluczy/tokenów.
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools", label: "Narzędzia deweloperskie" }]),
        { type: "separator" },
        { role: "quit", label: "Zamknij" },
      ],
    },
    {
      label: "Edycja",
      submenu: [
        { role: "undo", label: "Cofnij" },
        { role: "redo", label: "Ponów" },
        { type: "separator" },
        { role: "cut", label: "Wytnij" },
        { role: "copy", label: "Kopiuj" },
        { role: "paste", label: "Wklej" },
        { role: "selectAll", label: "Zaznacz wszystko" },
      ],
    },
    {
      label: "Widok",
      submenu: [
        { role: "zoomIn", label: "Powiększ" },
        { role: "zoomOut", label: "Pomniejsz" },
        { role: "resetZoom", label: "Reset powiększenia" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Pełny ekran" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- Sterowanie komputerem (most z renderer → system) ---

// Mapowanie przyjaznych nazw na polecenia/protokoły Windows.
const WIN_APPS = {
  spotify: "spotify:", chrome: "chrome", firefox: "firefox", edge: "msedge",
  notatnik: "notepad", notepad: "notepad", kalkulator: "calc", calc: "calc", calculator: "calc",
  eksplorator: "explorer", explorer: "explorer", pliki: "explorer", files: "explorer",
  cmd: "cmd", terminal: "wt", word: "winword", excel: "excel", powerpoint: "powerpnt",
  paint: "mspaint", malowanie: "mspaint", ustawienia: "ms-settings:", settings: "ms-settings:",
  aparat: "microsoft.windows.camera:", camera: "microsoft.windows.camera:",
  sklep: "ms-windows-store:", store: "ms-windows-store:", task: "taskmgr", menedzer: "taskmgr",
};

// Naciśnięcie klawisza systemowego (głośność/multimedia) przez keybd_event.
// SendKeys nie obsługuje klawiszy multimedialnych — używamy P/Invoke z pliku .ps1
// (omija problemy z cudzysłowami) i działa globalnie, niezależnie od aktywnego okna.
let keyScriptPath = null;
function ensureKeyScript() {
  if (keyScriptPath) return keyScriptPath;
  const p = path.join(os.tmpdir(), "jarvis-key.ps1");
  const ps =
    "param([int]$Vk)\n" +
    "Add-Type -Name JK -Namespace W -MemberDefinition '[DllImport(\"user32.dll\")]public static extern void keybd_event(byte b,byte s,uint f,System.UIntPtr e);'\n" +
    "[W.JK]::keybd_event($Vk,0,0,[System.UIntPtr]::Zero)\n";
  fs.writeFileSync(p, ps, { mode: 0o600 });
  keyScriptPath = p;
  return p;
}
function pressVk(vk) {
  const p = ensureKeyScript();
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${p}" ${vk}`);
}

// Wysyłanie tekstu/skrótów przez SendKeys (.ps1 + base64 = brak problemów z cudzysłowami).
// Opcjonalna aktywacja okna po tytule (AppActivate) — pozwala pisać do innej aplikacji.
let sendScriptPath = null;
function ensureSendScript() {
  if (sendScriptPath) return sendScriptPath;
  const p = path.join(os.tmpdir(), "jarvis-send.ps1");
  const ps =
    "param([string]$B64,[string]$Win)\n" +
    "$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($B64))\n" +
    "Add-Type -AssemblyName System.Windows.Forms\n" +
    "if($Win){ try { (New-Object -ComObject WScript.Shell).AppActivate($Win) | Out-Null; Start-Sleep -Milliseconds 350 } catch {} }\n" +
    "[System.Windows.Forms.SendKeys]::SendWait($t)\n";
  fs.writeFileSync(p, ps, { mode: 0o600 });
  sendScriptPath = p;
  return p;
}
function sendKeys(sk, win) {
  const p = ensureSendScript();
  const b64 = Buffer.from(String(sk), "utf8").toString("base64");
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", p, b64];
  if (win) args.push(win);
  spawn("powershell", args, { stdio: "ignore" }).unref();
}

// Tekst → łańcuch SendKeys (escape znaków specjalnych, Enter/Tab).
function escapeSendKeys(s) {
  return String(s)
    .replace(/[+^%~(){}[\]]/g, "{$&}")
    .replace(/\r\n|\r|\n/g, "{ENTER}")
    .replace(/\t/g, "{TAB}");
}

const SK_KEYS = {
  enter: "{ENTER}", tab: "{TAB}", esc: "{ESC}", escape: "{ESC}", space: " ",
  up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
  home: "{HOME}", end: "{END}", del: "{DEL}", delete: "{DEL}", backspace: "{BACKSPACE}", bksp: "{BACKSPACE}",
  pageup: "{PGUP}", pagedown: "{PGDN}", ins: "{INSERT}", insert: "{INSERT}",
  f1: "{F1}", f2: "{F2}", f3: "{F3}", f4: "{F4}", f5: "{F5}", f6: "{F6}",
  f7: "{F7}", f8: "{F8}", f9: "{F9}", f10: "{F10}", f11: "{F11}", f12: "{F12}",
};
// Kombinacja typu "ctrl+shift+s" → łańcuch SendKeys "^+s" (bez klawisza Win).
function buildHotkey(combo) {
  const parts = String(combo).toLowerCase().split("+").map((x) => x.trim()).filter(Boolean);
  let mods = "";
  let key = "";
  for (const p of parts) {
    if (p === "ctrl" || p === "control") mods += "^";
    else if (p === "alt") mods += "%";
    else if (p === "shift") mods += "+";
    else key = SK_KEYS[p] || (p.length === 1 ? p : "");
  }
  return key ? mods + key : null;
}

// Wysyłka e-maili przez SMTP — moduł electron/smtp.cjs (testowalny bez Electrona).
const { smtpSend } = require("./smtp.cjs");

// Natywna synchronizacja z Kalendarzem Google (OAuth loopback) — moduł electron/google.cjs.
const googleDesk = require("./google.cjs");
const GTOK_FILE = path.join(app.getPath("userData"), "google-tokens.json");
function readGoogleTok() { try { return JSON.parse(fs.readFileSync(GTOK_FILE, "utf8")); } catch { return null; } }
function writeGoogleTok(o) { try { fs.writeFileSync(GTOK_FILE, JSON.stringify(o)); } catch { /* ignore */ } }
async function googleAccess() {
  const t = readGoogleTok();
  if (!t || !t.refresh_token) return null;
  return googleDesk.refreshAccessToken(t);
}

function registerDesktopControl() {
  // Zaufane źródło IPC: aplikacja ładuje się z file://…/dist/index.html (loadFile).
  // Uprzywilejowane akcje OS (uruchamianie aplikacji, zasilanie, klawiatura, zrzut ekranu)
  // wykonujemy TYLKO dla własnej ramki — żeby kompromitacja renderera nie sterowała komputerem.
  const isTrustedIpc = (event) => {
    const url = event?.senderFrame?.url || event?.sender?.getURL?.() || "";
    return url.startsWith("file://");
  };
  const workspaceTools = createWorkspaceTools({
    root: process.env.JARVIS_WORKSPACE_DIR ? path.resolve(process.env.JARVIS_WORKSPACE_DIR) : path.join(app.getPath("documents"), "JARVIS Workspace"),
    openExternal: (url) => shell.openExternal(url),
    generatedTool: async request => {
      const taskId = `skill-generated-${require("node:crypto").randomUUID()}`;
      const controller = new AbortController(); skillOperations.set(taskId, new Set([controller]));
      try { return await skills().command({ action: "author", files: request.files }, { taskId, signal: controller.signal }); }
      finally { skillOperations.delete(taskId); }
    },
  });
  app.once("before-quit", () => workspaceTools.cancelAll());
  ipcMain.handle("jarvis:stop-workspace-processes", async (event) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "forbidden" };
    ownerConsentEpoch++;
    stopNativeSkills();
    await Promise.allSettled([browserService?.stop(), stdioMcp?.abortAll()]);
    return workspaceTools.cancelAll();
  });
  let monitorStopVersion = 0;
  const monitorActions = new Set(["list", "create", "pause", "resume", "cancel", "update", "revoke", "mute", "stop_all"]);
  const trustedMonitorSender = (event) => isTrustedIpc(event) && event.sender === mainWindow?.webContents && event.senderFrame === mainWindow?.webContents.mainFrame;
  const skillActions = new Set(["list", "search", "scan", "inspect", "stage", "test", "activate", "disable", "revoke", "remove", "rollback", "resource", "run", "update", "assert_task", "author"]);
  ipcMain.handle("jarvis:skill-command", async (event, envelope) => {
    if (!trustedMonitorSender(event) || !skillActions.has(envelope?.request?.action)) return { ok: false, error: "forbidden" };
    const taskId = String(envelope.taskId || "");
    const executionId = String(envelope.executionId || taskId);
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(taskId) || !/^[a-zA-Z0-9-]{1,100}$/.test(executionId) || cancelledSkillTasks.has(taskId) || cancelledSkillExecutions.has(`${taskId}:${executionId}`)) return { ok: false, error: "Zadanie lub próba anulowana albo identyfikator jest nieprawidłowy." };
    const controller = new AbortController();
    controller.executionId = executionId;
    if (!skillOperations.has(taskId)) skillOperations.set(taskId, new Set());
    skillOperations.get(taskId).add(controller);
    try {
      const { trustedUserAction: _trusted, signal: _signal, taskId: _task, ...request } = envelope.request;
      const result = await skills().command(request, { taskId, signal: controller.signal, allowNetwork: envelope.allowNetwork !== false });
      if (controller.signal.aborted) return { ok: false, error: "STOP: nie potwierdzono wyniku operacji." };
      return { ...result, ok: result?.ok !== false };
    } catch (error) { return { ok: false, error: error.message, code: error.code }; }
    finally {
      const pending = skillOperations.get(taskId); pending?.delete(controller);
      if (!pending?.size) {
        skillOperations.delete(taskId);
        if (skillReleaseRequests.delete(taskId)) await skills().command({ action: "release_task" }, { taskId }).catch(() => {});
      }
    }
  });
  ipcMain.handle("jarvis:skill-release", async (event, taskId) => {
    if (!trustedMonitorSender(event) || !/^[a-zA-Z0-9-]{1,100}$/.test(String(taskId))) return { ok: false };
    if (skillOperations.has(taskId)) { skillReleaseRequests.add(taskId); return { ok: true, deferred: true }; }
    try { await skills().command({ action: "release_task" }, { taskId }); return { ok: true }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("jarvis:skill-cancel", (event, payload) => {
    const taskId = typeof payload === "string" ? payload : payload?.taskId;
    const executionId = typeof payload === "object" ? payload?.executionId : undefined;
    if (!trustedMonitorSender(event) || !/^[a-zA-Z0-9-]{1,100}$/.test(String(taskId)) || (executionId && !/^[a-zA-Z0-9-]{1,100}$/.test(executionId))) return { ok: false };
    cancelSkillTask(taskId, executionId); return { ok: true };
  });
  ipcMain.handle("jarvis:skill-policy", async (event, payload) => {
    if (!trustedMonitorSender(event)) return { ok: false, error: "forbidden" };
    const epoch = ownerConsentEpoch;
    if (typeof payload?.source !== "string" || payload.source.length > 2048 || !Array.isArray(payload.codeKinds) || !Array.isArray(payload.permissions) || !Array.isArray(payload.licenses)) return { ok: false, error: "Wymagane dokładne źródło, rodzaje kodu, uprawnienia i licencje." };
    const policy = { source: payload.source, codeKinds: payload.codeKinds, permissions: payload.permissions, licenses: payload.licenses, enabled: payload.enabled !== false };
    const choice = await confirmMonitorScope({ type: "question", title: "Polityka umiejętności JARVIS", message: policy.enabled ? "Zezwolić na umiejętności z tego źródła w podanym zakresie?" : "Cofnąć politykę tego źródła?",
      detail: `Źródło: ${policy.source}\nKod: ${policy.codeKinds.join(", ")}\nUprawnienia: ${policy.permissions.join(", ") || "brak"}\nLicencje: ${policy.licenses.join(", ")}\nZgoda nie omija uprawnień narzędzi ani izolacji kodu. Nowa wersja musi osobno przejść test.`, buttons: ["Anuluj", "Potwierdź"], defaultId: 0, cancelId: 0 });
    if (choice.response !== 1 || epoch !== ownerConsentEpoch || !trustedMonitorSender(event)) return { ok: false, error: "Zgoda anulowana." };
    try { return { ...(await skills().command({ ...policy, action: "policy" }, { trustedUserAction: true })), ok: true }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("jarvis:monitor-connector-list", async event => {
    if (!trustedMonitorSender(event)) return { ok: false, error: "forbidden" };
    try { return { ok: true, connectors: await connectors().list() }; } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("jarvis:monitor-connector-configure", async (event, payload) => {
    if (!trustedMonitorSender(event)) return { ok: false, error: "forbidden" };
    const epoch = ownerConsentEpoch;
    if (!["changedetection", "ntfy"].includes(payload?.kind) || typeof payload.baseUrl !== "string" || payload.baseUrl.length > 2048) return { ok: false, error: "Wymagany typ i adres integracji." };
    let target; try { target = new URL(payload.baseUrl); if (target.username || target.password || target.search || target.hash) throw new Error(); } catch { return { ok: false, error: "Podaj adres bez danych logowania i parametrów." }; }
    const choice = await confirmMonitorScope({ type: "question", title: "Konfiguracja integracji", message: `Połączyć ${payload.kind} z JARVIS-em?`, detail: `Adres: ${target.href}\nDostęp loopback: ${payload.allowLocal === true ? "tak" : "nie"}\n${payload.kind === "ntfy" ? `Temat: ${String(payload.topic || "").slice(0, 256)}\nPowiadomienia będą przekazywane temu serwerowi. Zgoda na temat publiczny: ${payload.publicTopicConsent === true ? "tak" : "nie"}.` : "JARVIS będzie odczytywał wskazane obserwacje."}\nDane logowania pozostaną zaszyfrowane w profilu aplikacji.`, buttons: ["Anuluj", "Zapisz"], defaultId: 0, cancelId: 0 });
    if (choice.response !== 1 || epoch !== ownerConsentEpoch || !trustedMonitorSender(event)) return { ok: false, error: "Konfiguracja anulowana." };
    try { return { ...(await connectors().configure(payload, { trustedUserAction: true })), ok: true }; } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("jarvis:monitor-connector-remove", async (event, id) => {
    if (!trustedMonitorSender(event)) return { ok: false, error: "forbidden" };
    try { await connectors().remove(String(id), { trustedUserAction: true }); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; }
  });
  function browser() {
    if (!browserService) browserService = createBrowserSession({
      directory: path.join(app.getPath("userData"), "browser"), downloadDirectory: path.join(workspaceTools.root, "browser-downloads"),
      // Browser executable is deployment configuration, never a model argument.
      executablePath: process.env.JARVIS_BROWSER_EXECUTABLE || undefined,
      approveMutation: async request => {
        const epoch = ownerConsentEpoch;
        const choice = await confirmMonitorScope({ type: "question", title: "Wysłanie danych z przeglądarki", message: "Zatwierdzić tę konkretną operację?", detail: `${request.method} ${request.url}\nTreść:\n${request.bodyPreview}\nSkrót treści: ${request.bodyHash}\nZgoda dotyczy jednego żądania.`, buttons: ["Anuluj", "Wyślij"], defaultId: 0, cancelId: 0 });
        return choice.response === 1 && epoch === ownerConsentEpoch;
      },
    });
    return browserService;
  }
  const browserActions = new Set(["status", "open", "read", "fill", "click", "download", "revoke", "stop"]);
  ipcMain.handle("jarvis:browser-command", async (event, payload) => {
    if (!trustedMonitorSender(event) || !browserActions.has(payload?.action)) return { ok: false, error: "forbidden" };
    if (payload.action === "stop") ownerConsentEpoch++;
    try { const result = await browser().command(payload); return { ...result, ok: result?.ok !== false }; } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("jarvis:browser-grant", async (event, payload) => {
    if (!trustedMonitorSender(event)) return { ok: false, error: "forbidden" };
    const epoch = ownerConsentEpoch;
    let target; try { target = new URL(payload?.origin); if (target.username || target.password || !["http:", "https:"].includes(target.protocol) || target.origin !== payload.origin) throw new Error(); } catch { return { ok: false, error: "Podaj dokładne origin, np. https://example.org." }; }
    if (!Array.isArray(payload.actions) || !payload.actions.length || payload.actions.some(action => !["read", "interact", "download"].includes(action))) return { ok: false, error: "Wybierz zakres działań." };
    const choice = await confirmMonitorScope({ type: "question", title: "Dostęp przeglądarki", message: "Zezwolić na działania w tym serwisie?", detail: `Serwis: ${target.origin}\nDziałania: ${payload.actions.join(", ")}\nLokalny serwis: ${payload.allowLocal === true ? "tak" : "nie"}\nKatalog pobrań: ${path.join(workspaceTools.root, "browser-downloads")}\nWysyłanie formularzy wymaga zatwierdzenia konkretnego żądania. Profil jest oddzielony od prywatnej przeglądarki.`, buttons: ["Anuluj", "Zezwól"], defaultId: 0, cancelId: 0 });
    if (choice.response !== 1 || epoch !== ownerConsentEpoch || !trustedMonitorSender(event)) return { ok: false, error: "Zgoda anulowana." };
    try { return { ...(await browser().command({ action: "grant", origin: target.origin, actions: payload.actions, allowLocal: payload.allowLocal === true }, { trustedUserAction: true })), ok: true }; } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("jarvis:monitor-command", async (event, payload) => {
    if (!trustedMonitorSender(event) || !monitorActions.has(payload?.action)) return { ok: false, error: "forbidden" };
    if (payload.action === "stop_all") { monitorStopVersion++; ownerConsentEpoch++; }
    try { return { ok: true, ...(await monitors().command(payload)) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("jarvis:monitor-read-event", async (event, id) => {
    if (!trustedMonitorSender(event)) return { ok: false, error: "forbidden" };
    try { return { ok: true, ...(await monitors().command({ action: "read_event", id: String(id) }, { trustedUserAction: true })) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  // No model tool exposes grant. A native dialog confirms the exact source scope.
  ipcMain.handle("jarvis:monitor-grant", async (event, payload) => {
    if (!trustedMonitorSender(event)) return { ok: false, error: "forbidden" };
    const grantEpoch = monitorStopVersion;
    const source = payload?.source;
    if (!source || !["json", "directory", "changedetection"].includes(source.kind)) return { ok: false, error: "Nieobsługiwane źródło." };
    const resource = String(source.kind === "json" ? source.url || "" : source.kind === "directory" ? source.path || "" : `${source.connectorId || ""}/${source.watchId || ""}`);
    if (!resource || resource.length > 2048) return { ok: false, error: "Podaj konkretne źródło." };
    const scope = { source, desktopNotification: payload.desktopNotification === true, ...(payload.ntfyNotification ? { ntfyNotification: String(payload.ntfyNotification) } : {}) };
    let connectorDetails = "";
    if (source.kind === "changedetection" || scope.ntfyNotification) {
      try {
        const configured = await connectors().list();
        const selected = configured.filter(item => item.id === source.connectorId || item.id === scope.ntfyNotification);
        connectorDetails = selected.map(item => `${item.id}: ${item.label || item.kind} — ${item.baseUrl}`).join("\n");
      } catch { return { ok: false, error: "Nie można odczytać konfiguracji integracji." }; }
    }
    const decision = await confirmMonitorScope({ type: "question", title: "Zgoda na monitorowanie źródła",
      message: "Zezwolić na cykliczny odczyt tego źródła?",
      detail: `${source.kind}: ${resource}\n${connectorDetails}\nPowiadomienia systemowe: ${scope.desktopNotification ? "tak" : "nie"}.\nPrzekazywanie powiadomień do ntfy: ${scope.ntfyNotification || "nie"}.\nZgoda obowiązuje do jej cofnięcia w panelu Celów. Nie obejmuje zakupów, wysyłania wiadomości ani innych źródeł.`,
      buttons: ["Anuluj", "Zezwól"], defaultId: 0, cancelId: 0 });
    if (decision.response !== 1 || !trustedMonitorSender(event) || grantEpoch !== monitorStopVersion) return { ok: false, error: "Nie udzielono zgody lub żądanie anulowano przez STOP." };
    try { return { ok: true, ...(await monitors().command({ action: "grant", ...scope }, { trustedUserAction: true })) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle("jarvis:monitor-settings", async (event, payload) => {
    if (!trustedMonitorSender(event)) return { ok: false, error: "forbidden" };
    if (typeof payload?.backgroundEnabled === "boolean") {
      const settingsEpoch = monitorStopVersion;
      if (payload.backgroundEnabled && !backgroundMonitoring) {
        const decision = await confirmMonitorScope({ type: "question", title: "Praca po zamknięciu okna",
          message: "Pozostawić JARVIS-a uruchomionego po zamknięciu okna?",
          detail: "Monitory działają tylko przy uruchomionym komputerze. Wyjście z menu JARVIS kończy proces. Ctrl+Alt+J przywołuje okno. To ustawienie nie włącza autostartu.",
          buttons: ["Anuluj", "Włącz"], defaultId: 0, cancelId: 0 });
        if (decision.response !== 1 || settingsEpoch !== monitorStopVersion) return { ok: false, error: "Nie włączono pracy w tle lub żądanie anulowano przez STOP.", backgroundEnabled: backgroundMonitoring };
      }
      const next = payload.backgroundEnabled;
      fs.mkdirSync(path.dirname(MONITOR_SETTINGS_FILE), { recursive: true });
      const temporary = `${MONITOR_SETTINGS_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, backgroundEnabled: next }), { mode: 0o600 });
      fs.renameSync(temporary, MONITOR_SETTINGS_FILE);
      backgroundMonitoring = next;
    }
    return { ok: true, backgroundEnabled: backgroundMonitoring, autostart: false };
  });
  stdioMcp = createStdioMcpManager({ root: workspaceTools.root });
  ipcMain.handle("jarvis:agent-tool", async (event, payload) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "forbidden" };
    return workspaceTools.call(String(payload && payload.tool || ""), payload && payload.input);
  });
  ipcMain.handle("jarvis:mcp-stdio-connect", async (event, payload) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "forbidden" };
    return stdioMcp.connect(payload);
  });
  ipcMain.handle("jarvis:mcp-stdio-call", async (event, payload) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "forbidden" };
    return stdioMcp.call(payload?.server, payload?.tool, payload?.input);
  });
  ipcMain.handle("jarvis:mcp-stdio-disconnect", async (event, payload) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "forbidden" };
    return stdioMcp.close(String(payload?.server || ""));
  });
  ipcMain.handle("jarvis:hardware-info", async (event) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "forbidden" };
    try {
      const gpuInfo = await app.getGPUInfo("basic");
      const active = (gpuInfo.gpuDevice || []).find((device) => device.active) || (gpuInfo.gpuDevice || [])[0] || {};
      const gpu = String(active.deviceString || active.device_string || "");
      const knownVram = /1050\s*ti/i.test(gpu) ? 4 : 0;
      return {
        ok: true,
        platform: process.platform,
        cpu: os.cpus()[0] ? os.cpus()[0].model : "",
        cores: os.cpus().length,
        ramGb: Math.round((os.totalmem() / 1073741824) * 10) / 10,
        gpu,
        vramGb: knownVram,
      };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) };
    }
  });
  ipcMain.handle("jarvis:ollama-ensure-local", async (event, url) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "forbidden" };
    return localOllama.ensure(url);
  });
  ipcMain.handle("jarvis:site-os-ensure-local", async (event, url) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "forbidden" };
    return localSiteOs().ensure(url);
  });
  ipcMain.handle("jarvis:site-os-start", async (event, options) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "forbidden" };
    try {
      return await startSiteOs({ tunnel: Boolean(options && options.tunnel) });
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : String(error) };
    }
  });

  // --- Kalendarz Google (natywnie, bez serwera) ---
  ipcMain.handle("jarvis:google-connect", async (event, payload) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "forbidden" };
    const clientId = String((payload && payload.clientId) || "").trim();
    const clientSecret = String((payload && payload.clientSecret) || "").trim();
    if (!clientId || !clientSecret) return { ok: false, error: "Brak Client ID / Client Secret." };
    const r = await googleDesk.connectGoogle({ clientId, clientSecret, openUrl: (u) => shell.openExternal(u) });
    if (r.ok && r.refresh_token) { writeGoogleTok({ clientId, clientSecret, refresh_token: r.refresh_token }); return { ok: true }; }
    return { ok: false, error: r.error || "Nie udało się połączyć." };
  });
  ipcMain.handle("jarvis:google-status", () => ({ connected: !!(readGoogleTok() && readGoogleTok().refresh_token) }));
  ipcMain.handle("jarvis:google-disconnect", () => { try { fs.unlinkSync(GTOK_FILE); } catch { /* ignore */ } return { ok: true }; });
  ipcMain.handle("jarvis:gcal-add", async (event, ev) => {
    if (!isTrustedIpc(event)) return { error: "forbidden" };
    try {
      const at = await googleAccess();
      if (!at) return { error: "Google niepołączone." };
      await googleDesk.calAdd({ accessToken: at, ...(ev || {}) });
      return { ok: true };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });
  ipcMain.handle("jarvis:gcal-list", async (event, opts) => {
    if (!isTrustedIpc(event)) return { error: "forbidden" };
    try {
      const at = await googleAccess();
      if (!at) return { error: "Google niepołączone." };
      const events = await googleDesk.calList({ accessToken: at, ...(opts || {}) });
      return { events };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });
  ipcMain.handle("jarvis:gmail-send", async (event, msg) => {
    if (!isTrustedIpc(event)) return { error: "forbidden" };
    try {
      const at = await googleAccess();
      if (!at) return { error: "Google niepołączone." };
      await googleDesk.gmailSend({ accessToken: at, ...(msg || {}) });
      return { ok: true };
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });
  ipcMain.handle("jarvis:gmail-list", async (event, opts) => {
    if (!isTrustedIpc(event)) return { error: "forbidden" };
    try {
      const at = await googleAccess();
      if (!at) return { error: "Google niepołączone." };
      return await googleDesk.gmailList({ accessToken: at, ...(opts || {}) });
    } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
  });

  // Prawdziwa wysyłka e-maila (SMTP) — z Pulpitu Sprzedaży jednym potwierdzeniem.
  ipcMain.handle("jarvis:sendmail", async (event, payload) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
    const { host, port, user, pass, to, subject, body } = payload || {};
    if (!user || !pass) return "err:Skonfiguruj pocztę w ⚙ → Poczta (adres + hasło aplikacji).";
    if (!to || !to.includes("@")) return "err:Brak poprawnego adresu odbiorcy.";
    return smtpSend({ host, port, user, pass, to, subject: String(subject || ""), body: String(body || "") });
  });

  // Sprawdzenie połączenia z pocztą (bez wysyłania testowego maila) — łączy się,
  // loguje hasłem aplikacji i rozłącza. Zwraca "ok" lub "err:<powód>".
  ipcMain.handle("jarvis:verifymail", async (event, payload) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
    const { host, port, user, pass } = payload || {};
    if (!user || !pass) return "err:Wpisz adres e-mail i hasło aplikacji.";
    return smtpSend({ host, port, user, pass, verifyOnly: true });
  });

  // Natywne powiadomienie Windows (przypomnienia, minutnik, pomodoro, leady).
  ipcMain.handle("jarvis:notify", (event, payload) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
    try {
      if (!Notification.isSupported()) return "err:unsupported";
      const title = String((payload && payload.title) || "JARVIS");
      const body = String((payload && payload.body) || "");
      const n = new Notification({ title, body, silent: false });
      n.on("click", () => summonWindow());
      n.show();
      return "ok";
    } catch (e) {
      return `err:${e}`;
    }
  });

  ipcMain.handle("jarvis:open", async (event, target) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
    if (!target) return "err:empty";
    // URL/protokół (http, mailto, spotify:, ms-settings:) → powłoka; inaczej ścieżka.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      await shell.openExternal(target);
      return "ok";
    }
    const err = await shell.openPath(target); // plik lub folder
    return err ? `err:${err}` : "ok";
  });

  ipcMain.handle("jarvis:launch", async (event, name) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
    const raw = String(name || "").trim();
    const key = raw.toLowerCase();
    if (!key) return "err:empty";
    if (process.platform === "linux") return launchLinux(raw);
    const mapped = WIN_APPS[key] || key;
    if (process.platform === "win32") {
      // Protokoły (spotify:, ms-settings:) otwieramy przez powłokę.
      if (/^[a-z]+:/.test(mapped)) {
        await shell.openExternal(mapped);
        return "ok";
      }
      spawn("cmd", ["/c", "start", "", mapped], { detached: true, stdio: "ignore" }).unref();
      return "ok";
    }
    if (process.platform === "darwin") {
      spawn("open", ["-a", mapped], { detached: true, stdio: "ignore" }).unref();
      return "ok";
    }
    // Bez powłoki — bezpośredni exec (sh -c z interpolacją groził wstrzyknięciem poleceń).
    const [cmd, ...args] = String(mapped).split(/\s+/).filter(Boolean);
    if (!cmd) return "err:unknown";
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    return "ok";
  });

  ipcMain.handle("jarvis:power", async (event, action) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
    const a = String(action || "").toLowerCase();
    if (process.platform !== "win32") return "err:unsupported";
    const map = {
      lock: "rundll32.exe user32.dll,LockWorkStation",
      sleep: "rundll32.exe powrprof.dll,SetSuspendState 0,1,0",
      shutdown: "shutdown /s /t 0",
      restart: "shutdown /r /t 0",
      logoff: "shutdown /l",
    };
    const cmd = map[a];
    if (!cmd) return "err:unknown";
    exec(cmd);
    return "ok";
  });

  ipcMain.handle("jarvis:volume", async (event, action) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
    const a = String(action || "").toLowerCase();
    if (process.platform !== "win32") return "err:unsupported";
    // VK: 175 = głośniej, 174 = ciszej, 173 = wycisz.
    const vk = { up: 175, down: 174, mute: 173 }[a];
    if (!vk) return "err:unknown";
    pressVk(vk);
    return "ok";
  });

  ipcMain.handle("jarvis:media", async (event, action) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
    const a = String(action || "").toLowerCase();
    if (process.platform !== "win32") return "err:unsupported";
    // VK multimedialne: play/pause 179, next 176, prev 177, stop 178.
    const vk = { playpause: 179, play: 179, pause: 179, next: 176, prev: 177, previous: 177, stop: 178 }[a];
    if (!vk) return "err:unknown";
    pressVk(vk);
    return "ok";
  });

  // Zrzut ekranu → base64 PNG (do analizy wizyjnej „co mam na ekranie?").
  ipcMain.handle("jarvis:screenshot", async (event) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
    try {
      const d = screen.getPrimaryDisplay();
      const maxW = 1600;
      const scale = Math.min(1, maxW / d.size.width);
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: Math.round(d.size.width * scale), height: Math.round(d.size.height * scale) },
      });
      const src = sources[0];
      if (!src) return "err:no-source";
      return src.thumbnail.toPNG().toString("base64");
    } catch (e) {
      return `err:${e && e.message ? e.message : e}`;
    }
  });

  ipcMain.handle("jarvis:active-window", async (event) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "err:forbidden" };
    if (process.platform !== "linux") return { ok: false, error: "err:unsupported" };
    return linuxKeyboard.activeWindow();
  });

  // Współrzędne wymagają aktywnego okna i osobnej zgody w warstwie narzędzi.
  ipcMain.handle("jarvis:click", async (event, payload) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
    if (monitorConsentPending) return "err:owner-confirmation-pending";
    if (process.platform !== "linux") return "err:unsupported";
    return linuxKeyboard.click(payload?.x, payload?.y, payload?.window);
  });

  // Pisanie tekstu (opcjonalnie do okna o podanym tytule).
  ipcMain.handle("jarvis:type", async (event, payload) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
    if (monitorConsentPending) return "err:owner-confirmation-pending";
    const { text, window } = payload || {};
    if (process.platform === "linux") return linuxKeyboard.type(text, window);
    if (process.platform !== "win32") return "err:unsupported";
    if (!text) return "err:empty";
    sendKeys(escapeSendKeys(text), window);
    return "ok";
  });

  ipcMain.handle("jarvis:clipboard-read", async (event) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "forbidden" };
    try { const text = clipboard.readText(); return { ok: true, text: text.slice(0, 8000), truncated: text.length > 8000 }; }
    catch { return { ok: false, error: "Schowek jest niedostępny." }; }
  });
  ipcMain.handle("jarvis:list-windows", async (event) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "forbidden" };
    if (process.platform !== "linux") return { ok: false, error: "err:unsupported" };
    return linuxKeyboard.listWindows();
  });
  ipcMain.handle("jarvis:focus-window", async (event, payload) => {
    if (!isTrustedIpc(event)) return { ok: false, error: "forbidden" };
    if (monitorConsentPending) return { ok: false, error: "err:owner-confirmation-pending" };
    if (process.platform !== "linux") return { ok: false, error: "err:unsupported" };
    return linuxKeyboard.focusWindow(payload?.id, payload?.title);
  });

  // Skrót klawiszowy (opcjonalnie do okna o podanym tytule).
  ipcMain.handle("jarvis:hotkey", async (event, payload) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
    if (monitorConsentPending) return "err:owner-confirmation-pending";
    const { combo, window } = payload || {};
    if (process.platform === "linux") return linuxKeyboard.hotkey(combo, window);
    if (process.platform !== "win32") return "err:unsupported";
    const sk = buildHotkey(combo);
    if (!sk) return "err:unknown";
    sendKeys(sk, window);
    return "ok";
  });
}

// Tylko jedna instancja aplikacji.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", summonWindow);

  app.whenReady().then(() => {
    // Mikrofon/kamera (rozmowa na żywo, HUD) — tylko media; inne prośby odrzucamy.
    const ALLOWED_PERMISSIONS = new Set(["media", "audioCapture", "videoCapture", "mediaKeySystem", "speaker-selection"]);
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(ALLOWED_PERMISSIONS.has(perm)));

    // Naprawa CORS — wstrzykuj nagłówki, by zapytania do API działały jak w aplikacji
    // mobilnej (Gemini, Claude, Groq, OpenRouter, NVIDIA, GitHub, Tavily, Home Assistant).
    //
    // Utwardzenie: NIE nadpisujemy już na ślepo cudzej polityki CORS. Gdy serwer sam
    // przysłał `Access-Control-Allow-Origin` (świadoma, często restrykcyjna polityka),
    // zostawiamy ją bez zmian. Permisywne nagłówki dokładamy WYŁĄCZNIE, gdy odpowiedź
    // ich nie ma (czyli tam, gdzie i tak były potrzebne, by zapytanie zadziałało) —
    // zero regresji wobec dotychczasowego zachowania, a koniec blankietowego „*".
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      const headers = details.responseHeaders || {};
      const hasAcao = Object.keys(headers).some((h) => h.toLowerCase() === "access-control-allow-origin");
      if (hasAcao) {
        cb({ responseHeaders: headers }); // serwer ma własną politykę — nie ruszamy
        return;
      }
      cb({
        responseHeaders: {
          ...headers,
          "Access-Control-Allow-Origin": ["*"],
          "Access-Control-Allow-Headers": ["*"],
          "Access-Control-Allow-Methods": ["GET, POST, OPTIONS, PUT, DELETE"],
          // Odsłoń nagłówki limitów (anthropic-ratelimit-*, x-ratelimit-*) —
          // dzięki temu Ustawienia pokazują % zużycia API.
          "Access-Control-Expose-Headers": ["*"],
        },
      });
    });

    registerDesktopControl();
    buildMenu();
    createWindow();

    // Globalny skrót: Ctrl+Alt+J przywołuje JARVIS-a nad każdą aplikacją.
    try {
      globalShortcut.register("CommandOrControl+Alt+J", summonWindow);
      // Ctrl+Alt+V: przywołaj okno i przełącz pełnoekranowy tryb głosowy.
      globalShortcut.register("CommandOrControl+Alt+V", () => {
        summonWindow();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("jarvis:voicemode");
      });
    } catch {
      /* skrót zajęty przez inny program — trudno */
    }
    ipcMain.handle("jarvis:clipwatch", (_e, enabled) => {
      setClipWatch(!!enabled);
      return true;
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (backgroundMonitoring) return;
    if (monitorService) void monitorService.stop();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (closingStdioMcp) return;
    event.preventDefault();
    closingStdioMcp = true;
    stopNativeSkills();
    void Promise.allSettled([stdioMcp?.closeAll(), monitorService?.stop(), browserService?.stop()]).finally(() => app.quit());
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    localOllama.close();
    setClipWatch(false);
    if (siteOsManager) siteOsManager.close();
  });
}
