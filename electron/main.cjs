// Główny proces Electrona — JARVIS na komputer (Windows .exe), pełna wersja.
const { app, BrowserWindow, shell, session, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

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
