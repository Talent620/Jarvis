// Most między aplikacją webową a systemem (Windows/desktop). Wystawia bezpieczne,
// jawne metody sterowania komputerem — JARVIS może otwierać programy, pliki i
// wykonywać akcje systemowe. contextIsolation = true, więc to jedyny kanał.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisDesktop", {
  platform: process.platform,
  // Otwórz URL, plik lub folder w domyślnej aplikacji systemu.
  open: (target) => ipcRenderer.invoke("jarvis:open", String(target || "")),
  // Uruchom lokalny program (po nazwie znanej lub ścieżce/poleceniu).
  launch: (appName) => ipcRenderer.invoke("jarvis:launch", String(appName || "")),
  // Akcja zasilania: lock | sleep | restart | shutdown | logoff.
  power: (action) => ipcRenderer.invoke("jarvis:power", String(action || "")),
  // Sterowanie głośnością / wyciszeniem (Windows): up | down | mute.
  volume: (action) => ipcRenderer.invoke("jarvis:volume", String(action || "")),
  // Multimedia (Windows): playpause | next | prev | stop.
  media: (action) => ipcRenderer.invoke("jarvis:media", String(action || "")),
});
