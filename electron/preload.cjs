// Most między aplikacją webową a systemem (Windows/desktop). Wystawia bezpieczne,
// jawne metody sterowania komputerem — JARVIS może otwierać programy, pliki i
// wykonywać akcje systemowe. contextIsolation = true, więc to jedyny kanał.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisDesktop", {
  platform: process.platform,
  // Bezpieczna warstwa narzędzi systemowych (MCP-style): zawsze przez jeden kontrolowany IPC.
  agentTool: (tool, input = {}) => ipcRenderer.invoke("jarvis:agent-tool", { tool: String(tool || ""), input }),
  mcpStdioConnect: (config) => ipcRenderer.invoke("jarvis:mcp-stdio-connect", config),
  mcpStdioCall: (server, tool, input = {}) => ipcRenderer.invoke("jarvis:mcp-stdio-call", { server, tool, input }),
  mcpStdioDisconnect: (server) => ipcRenderer.invoke("jarvis:mcp-stdio-disconnect", { server }),
  hardwareInfo: () => ipcRenderer.invoke("jarvis:hardware-info"),
  systemDiagnostics: () => ipcRenderer.invoke("jarvis:system-diagnostics"),
  secureStorageAvailable: () => ipcRenderer.invoke("jarvis:secure-available"),
  encryptSecret: (plaintext) => ipcRenderer.invoke("jarvis:secure-encrypt", String(plaintext || "")),
  decryptSecret: (b64) => ipcRenderer.invoke("jarvis:secure-decrypt", String(b64 || "")),
  ensureLocalOllama: (url) => ipcRenderer.invoke("jarvis:ollama-ensure-local", String(url || "")),
  // Otwórz URL, plik lub folder w domyślnej aplikacji systemu.
  open: (target) => ipcRenderer.invoke("jarvis:open", String(target || "")),
  ensureLocalSiteOs: (url) => ipcRenderer.invoke("jarvis:site-os-ensure-local", String(url || "")),
  // Uruchom dołączony kreator stron i otwórz go w domyślnej przeglądarce.
  siteOsStart: (tunnel = false) => ipcRenderer.invoke("jarvis:site-os-start", { tunnel: Boolean(tunnel) }),
  ensureLocalForge: (url) => ipcRenderer.invoke("jarvis:forge-ensure-local", String(url || "http://127.0.0.1:3220")),
  // Uruchom lokalny program (po nazwie znanej lub ścieżce/poleceniu).
  launch: (appName) => ipcRenderer.invoke("jarvis:launch", String(appName || "")),
  // Akcja zasilania: lock | sleep | restart | shutdown | logoff.
  power: (action) => ipcRenderer.invoke("jarvis:power", String(action || "")),
  // Sterowanie głośnością / wyciszeniem (Windows): up | down | mute.
  volume: (action) => ipcRenderer.invoke("jarvis:volume", String(action || "")),
  // Multimedia (Windows): playpause | next | prev | stop.
  media: (action) => ipcRenderer.invoke("jarvis:media", String(action || "")),
  // Zrzut ekranu → base64 PNG (analiza wizyjna).
  screenshot: () => ipcRenderer.invoke("jarvis:screenshot"),
  // Natywne powiadomienie systemowe Windows.
  notify: (title, body) => ipcRenderer.invoke("jarvis:notify", { title: String(title || ""), body: String(body || "") }),
  // Prawdziwa wysyłka e-maila przez SMTP (dane z ustawień aplikacji).
  sendMail: (msg) => ipcRenderer.invoke("jarvis:sendmail", msg),
  // Sprawdzenie połączenia z pocztą (logowanie SMTP bez wysyłki testowej).
  verifyMail: (msg) => ipcRenderer.invoke("jarvis:verifymail", msg),
  // Kalendarz Google natywnie (OAuth loopback, bez serwera).
  googleConnect: (clientId, clientSecret) => ipcRenderer.invoke("jarvis:google-connect", { clientId, clientSecret }),
  googleStatus: () => ipcRenderer.invoke("jarvis:google-status"),
  googleDisconnect: () => ipcRenderer.invoke("jarvis:google-disconnect"),
  gcalAdd: (ev) => ipcRenderer.invoke("jarvis:gcal-add", ev),
  gcalList: (opts) => ipcRenderer.invoke("jarvis:gcal-list", opts),
  gmailSend: (msg) => ipcRenderer.invoke("jarvis:gmail-send", msg),
  gmailList: (opts) => ipcRenderer.invoke("jarvis:gmail-list", opts),
  activeWindow: () => ipcRenderer.invoke("jarvis:active-window"),
  // Klik X11: renderer przesyła współrzędne i wymagany tytuł aktywnego okna.
  click: (x, y, window) => ipcRenderer.invoke("jarvis:click", { x, y, window }),
  // Pisanie tekstu / skróty (Windows), opcjonalnie do okna o tytule.
  type: (text, window) => ipcRenderer.invoke("jarvis:type", { text: String(text || ""), window: window || "" }),
  hotkey: (combo, window) => ipcRenderer.invoke("jarvis:hotkey", { combo: String(combo || ""), window: window || "" }),
  // Obserwator schowka (opt-in): włącz/wyłącz + subskrypcja nowych tekstów.
  clipWatch: (enabled) => ipcRenderer.invoke("jarvis:clipwatch", !!enabled),
  onClipboard: (cb) => {
    const listener = (_e, text) => cb(String(text || ""));
    ipcRenderer.on("jarvis:clipboard", listener);
    return () => ipcRenderer.removeListener("jarvis:clipboard", listener);
  },
  // Globalny skrót Ctrl+Alt+V → przełącz tryb głosowy.
  onVoiceMode: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("jarvis:voicemode", listener);
    return () => ipcRenderer.removeListener("jarvis:voicemode", listener);
  },
  // === OMNI-PILOT (płynny kursor, mysz, przewijanie, drag, okna, UTF-8, zrzut ze skalą, Ctrl+Alt+X) ===
  pilotCursorPos: () => ipcRenderer.invoke("jarvis:pilot-cursor-pos"),
  pilotMove: (payload) => ipcRenderer.invoke("jarvis:pilot-move", payload),
  pilotMouse: (payload) => ipcRenderer.invoke("jarvis:pilot-mouse", payload),
  pilotScroll: (payload) => ipcRenderer.invoke("jarvis:pilot-scroll", payload),
  pilotDrag: (payload) => ipcRenderer.invoke("jarvis:pilot-drag", payload),
  pilotWindows: () => ipcRenderer.invoke("jarvis:pilot-windows"),
  pilotFocus: (query) => ipcRenderer.invoke("jarvis:pilot-focus", String(query || "")),
  pilotTypeUnicode: (text) => ipcRenderer.invoke("jarvis:pilot-type-unicode", String(text || "")),
  pilotHotkey: (combo) => ipcRenderer.invoke("jarvis:pilot-hotkey", String(combo || "")),
  pilotAbort: () => ipcRenderer.invoke("jarvis:pilot-abort"),
  screenshotDetailed: () => ipcRenderer.invoke("jarvis:screenshot-detailed"),
  pilotUiTree: (maxNodes) => ipcRenderer.invoke("jarvis:pilot-ui-tree", maxNodes),
  pilotUiFind: (query) => ipcRenderer.invoke("jarvis:pilot-ui-find", String(query || "")),
  desktopDiagnose: () => ipcRenderer.invoke("jarvis:desktop-diagnose"),
  onOmniAbort: (cb) => {
    const listener = () => cb();
    ipcRenderer.on("jarvis:omni-abort", listener);
    return () => ipcRenderer.removeListener("jarvis:omni-abort", listener);
  },
});
