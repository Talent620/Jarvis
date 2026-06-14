// Główny proces Electrona — JARVIS na komputer (Windows .exe), pełna wersja.
const { app, BrowserWindow, shell, session, Menu, ipcMain, desktopCapturer, screen, globalShortcut, clipboard, Notification } = require("electron");
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
    .replace(/[+^%~(){}\[\]]/g, "{$&}")
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

function registerDesktopControl() {
  // Prawdziwa wysyłka e-maila (SMTP) — z Pulpitu Sprzedaży jednym potwierdzeniem.
  ipcMain.handle("jarvis:sendmail", async (_e, payload) => {
    const { host, port, user, pass, to, subject, body } = payload || {};
    if (!user || !pass) return "err:Skonfiguruj pocztę w ⚙ → Poczta (adres + hasło aplikacji).";
    if (!to || !to.includes("@")) return "err:Brak poprawnego adresu odbiorcy.";
    return smtpSend({ host, port, user, pass, to, subject: String(subject || ""), body: String(body || "") });
  });

  // Sprawdzenie połączenia z pocztą (bez wysyłania testowego maila) — łączy się,
  // loguje hasłem aplikacji i rozłącza. Zwraca "ok" lub "err:<powód>".
  ipcMain.handle("jarvis:verifymail", async (_e, payload) => {
    const { host, port, user, pass } = payload || {};
    if (!user || !pass) return "err:Wpisz adres e-mail i hasło aplikacji.";
    return smtpSend({ host, port, user, pass, verifyOnly: true });
  });

  // Natywne powiadomienie Windows (przypomnienia, minutnik, pomodoro, leady).
  ipcMain.handle("jarvis:notify", (_e, payload) => {
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

  // Zrzut ekranu → base64 PNG (do analizy wizyjnej „co mam na ekranie?").
  ipcMain.handle("jarvis:screenshot", async () => {
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

  // Pisanie tekstu (opcjonalnie do okna o podanym tytule).
  ipcMain.handle("jarvis:type", async (_e, payload) => {
    if (process.platform !== "win32") return "err:unsupported";
    const { text, window } = payload || {};
    if (!text) return "err:empty";
    sendKeys(escapeSendKeys(text), window);
    return "ok";
  });

  // Skrót klawiszowy (opcjonalnie do okna o podanym tytule).
  ipcMain.handle("jarvis:hotkey", async (_e, payload) => {
    if (process.platform !== "win32") return "err:unsupported";
    const { combo, window } = payload || {};
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
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Mikrofon/kamera (rozmowa na żywo, HUD) — tylko media; inne prośby odrzucamy.
    const ALLOWED_PERMISSIONS = new Set(["media", "audioCapture", "videoCapture", "mediaKeySystem", "speaker-selection"]);
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(ALLOWED_PERMISSIONS.has(perm)));

    // Naprawa CORS — wstrzykuj nagłówki, by zapytania do API działały jak w aplikacji
    // mobilnej (Gemini, Claude, Groq, OpenRouter, NVIDIA, GitHub, Tavily, Home Assistant).
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
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
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    setClipWatch(false);
  });
}
