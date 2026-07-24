// Most między aplikacją webową a systemem (Windows/desktop). Wystawia bezpieczne,
// jawne metody sterowania komputerem — JARVIS może otwierać programy, pliki i
// wykonywać akcje systemowe. contextIsolation = true, więc to jedyny kanał.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisDesktop", {
  platform: process.platform,
  // Bezpieczna warstwa narzędzi systemowych (MCP-style): zawsze przez jeden kontrolowany IPC.
  agentTool: (tool, input = {}) => ipcRenderer.invoke("jarvis:agent-tool", { tool: String(tool || ""), input }),
  hardwareInfo: () => ipcRenderer.invoke("jarvis:hardware-info"),
  // Otwórz URL, plik lub folder w domyślnej aplikacji systemu.
  open: (target) => ipcRenderer.invoke("jarvis:open", String(target || "")),
  // Uruchom dołączony kreator stron i otwórz go w domyślnej przeglądarce.
  siteOsStart: (tunnel = false) => ipcRenderer.invoke("jarvis:site-os-start", { tunnel: Boolean(tunnel) }),
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
});
