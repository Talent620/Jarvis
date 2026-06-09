// Główny proces Electrona — JARVIS na komputer (Windows .exe), pełna wersja.
const { app, BrowserWindow, shell, session, Menu, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, exec } = require("child_process");
const os = require("os");

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

function createWindow() {
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
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));

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
        { role: "toggleDevTools", label: "Narzędzia deweloperskie" },
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
  fs.writeFileSync(p, ps);
  keyScriptPath = p;
  return p;
}
function pressVk(vk) {
  const p = ensureKeyScript();
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${p}" ${vk}`);
}

function registerDesktopControl() {
  ipcMain.handle("jarvis:open", async (_e, target) => {
    if (!target) return "err:empty";
    // URL/protokół (http, mailto, spotify:, ms-settings:) → powłoka; inaczej ścieżka.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      await shell.openExternal(target);
      return "ok";
    }
    const err = await shell.openPath(target); // plik lub folder
    return err ? `err:${err}` : "ok";
  });

  ipcMain.handle("jarvis:launch", async (_e, name) => {
    const key = String(name || "").toLowerCase().trim();
    if (!key) return "err:empty";
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
    spawn("sh", ["-c", `${mapped} &`], { detached: true, stdio: "ignore" }).unref();
    return "ok";
  });

  ipcMain.handle("jarvis:power", async (_e, action) => {
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

  ipcMain.handle("jarvis:volume", async (_e, action) => {
    const a = String(action || "").toLowerCase();
    if (process.platform !== "win32") return "err:unsupported";
    // VK: 175 = głośniej, 174 = ciszej, 173 = wycisz.
    const vk = { up: 175, down: 174, mute: 173 }[a];
    if (!vk) return "err:unknown";
    pressVk(vk);
    return "ok";
  });

  ipcMain.handle("jarvis:media", async (_e, action) => {
    const a = String(action || "").toLowerCase();
    if (process.platform !== "win32") return "err:unsupported";
    // VK multimedialne: play/pause 179, next 176, prev 177, stop 178.
    const vk = { playpause: 179, play: 179, pause: 179, next: 176, prev: 177, previous: 177, stop: 178 }[a];
    if (!vk) return "err:unknown";
    pressVk(vk);
    return "ok";
  });
}

// Tylko jedna instancja aplikacji.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Mikrofon (rozmowa na żywo / głos).
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));

    // Naprawa CORS — wstrzykuj nagłówki, by zapytania do API działały jak w aplikacji
    // mobilnej (Gemini, Claude, Groq, OpenRouter, NVIDIA, GitHub, Tavily, Home Assistant).
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          "Access-Control-Allow-Origin": ["*"],
          "Access-Control-Allow-Headers": ["*"],
          "Access-Control-Allow-Methods": ["GET, POST, OPTIONS, PUT, DELETE"],
        },
      });
    });

    registerDesktopControl();
    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
