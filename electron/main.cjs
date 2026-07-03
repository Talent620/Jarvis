// Główny proces Electrona — JARVIS na komputer (Windows .exe), pełna wersja.
const { app, BrowserWindow, shell, session, Menu, ipcMain, desktopCapturer, screen, globalShortcut, clipboard, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, exec } = require("child_process");
const os = require("os");

const { Tray, nativeImage } = require("electron");
const horizonListener = require("./horizon-listener.cjs");

const STATE_FILE = path.join(app.getPath("userData"), "window-state.json");

let tray = null;         // ikona w zasobniku systemowym (Project Horizon)
let isQuitting = false;  // true tylko przy jawnym „Zakończ" — inaczej zamknięcie chowa do traya

// Zaufane źródło IPC (wersja modułowa): tylko własna ramka file://…/dist może
// odczytać token/status węzła — kompromitacja renderera nie wyciągnie tokenu.
function isTrustedIpcGlobal(event) {
  const url = event?.senderFrame?.url || event?.sender?.getURL?.() || "";
  return url.startsWith("file://");
}

// Tray + autostart: zamknięcie okna chowa aplikację (listener EXE zostaje aktywny),
// a JARVIS wraca skrótem / z ikony. Autostart zmienia WYŁĄCZNIE jawny checkbox.
function autoStartEnabled() {
  try { return !!app.getLoginItemSettings().openAtLogin; } catch { return false; }
}
function setAutoStart(on) {
  try { app.setLoginItemSettings({ openAtLogin: !!on }); } catch { /* platforma bez wsparcia */ }
}
function buildTrayMenu() {
  const st = horizonListener.listenerStatus();
  return Menu.buildFromTemplate([
    { label: "Pokaż JARVIS", click: () => summonWindow() },
    { type: "separator" },
    { label: st.listening ? `Węzeł lokalny: aktywny (127.0.0.1:${st.port})` : "Węzeł lokalny: nieaktywny", enabled: false },
    { label: "Uruchamiaj przy starcie systemu", type: "checkbox", checked: autoStartEnabled(), click: (mi) => setAutoStart(mi.checked) },
    { type: "separator" },
    { label: "Zakończ", click: () => { isQuitting = true; app.quit(); } },
  ]);
}
function createTray() {
  if (tray) return;
  try {
    // Ikona z małego przezroczystego PNG (brak zewnętrznego pliku) — tray i tak działa.
    const img = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    );
    tray = new Tray(img);
    tray.setToolTip("JARVIS — węzeł lokalny (Project Horizon)");
    tray.setContextMenu(buildTrayMenu());
    tray.on("click", () => summonWindow());
  } catch {
    tray = null; // brak traya (np. środowisko bez GUI) — aplikacja działa dalej
  }
}
function refreshTray() {
  if (tray) { try { tray.setContextMenu(buildTrayMenu()); } catch { /* ignore */ } }
}

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
      sandbox: true, // izolacja renderera (mostek IPC przez preload pozostaje)
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));

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
  // Zamknięcie okna (X) chowa do traya zamiast kończyć — węzeł lokalny zostaje aktywny.
  // Realny koniec: „Zakończ" z traya (isQuitting) albo Cmd+Q na macOS.
  mainWindow.on("close", (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
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

  // Pisanie tekstu (opcjonalnie do okna o podanym tytule).
  ipcMain.handle("jarvis:type", async (event, payload) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
    if (process.platform !== "win32") return "err:unsupported";
    const { text, window } = payload || {};
    if (!text) return "err:empty";
    sendKeys(escapeSendKeys(text), window);
    return "ok";
  });

  // Skrót klawiszowy (opcjonalnie do okna o podanym tytule).
  ipcMain.handle("jarvis:hotkey", async (event, payload) => {
    if (!isTrustedIpc(event)) return "err:forbidden";
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

    // Project Horizon — lokalny węzeł EXE: serwer HTTP wyłącznie na 127.0.0.1:4318
    // z losowym tokenem sesji. Realne akcje wstrzykiwane (rdzeń pozostaje czysty).
    try {
      horizonListener.startHorizonListener({
        showWindow: () => summonWindow(),
        setClipboard: (t) => { try { clipboard.writeText(String(t || "")); } catch { /* schowek zajęty */ } },
        onStatus: () => refreshTray(),
      });
    } catch { /* listener nie wstał — aplikacja działa normalnie, węzeł po prostu nieaktywny */ }

    // Token węzła EXE dostępny WYŁĄCZNIE dla własnego renderera przez zaufany IPC.
    ipcMain.handle("jarvis:horizon-token", (event) => {
      if (!isTrustedIpcGlobal(event)) return null;
      return horizonListener.currentToken() || null;
    });
    ipcMain.handle("jarvis:horizon-status", (event) => {
      if (!isTrustedIpcGlobal(event)) return { listening: false };
      return horizonListener.listenerStatus();
    });
    // Parowanie QR (generuj sekret) + kontrolowane wyjście na LAN (jawna zgoda).
    ipcMain.handle("jarvis:horizon-pair", (event, payload) => {
      if (!isTrustedIpcGlobal(event)) return null;
      return horizonListener.startPairing((payload && payload.lanUrl) || "", (payload && payload.name) || "");
    });
    ipcMain.handle("jarvis:horizon-unpair", (event) => {
      if (!isTrustedIpcGlobal(event)) return { ok: false };
      horizonListener.clearPairing();
      horizonListener.disableLan();
      return { ok: true };
    });
    ipcMain.handle("jarvis:horizon-lan", (event, payload) => {
      if (!isTrustedIpcGlobal(event)) return { ok: false, reason: "forbidden" };
      const on = !!(payload && payload.enable);
      return on ? horizonListener.enableLan((payload && payload.ip) || "") : horizonListener.disableLan();
    });

    buildMenu();
    createTray();
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
    // Z aktywnym trayem (Windows/Linux) NIE kończymy — węzeł lokalny żyje w tle,
    // JARVIS wraca z ikony. Bez traya albo po jawnym „Zakończ" — jak dotąd.
    if (tray && !isQuitting) return;
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    setClipWatch(false);
    try { horizonListener.stopHorizonListener(); } catch { /* już zamknięty */ }
  });
}
