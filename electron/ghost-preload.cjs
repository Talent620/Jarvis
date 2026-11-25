// === JARVIS SYMBIONT · Izolowany Preload Warstwy Ghost AR ===
// Ściśle ograniczony mostek jednokierunkowy (tylko odbiór stanu renderowania i czyszczenia).
// Brak dostępu do jarvisDesktop, plików, powłoki ani sieci.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisGhostSurface", {
  onRender: (cb) => {
    const handler = (_event, payload) => {
      if (typeof cb === "function") cb(payload || null);
    };
    ipcRenderer.on("jarvis:ghost-render", handler);
    return () => ipcRenderer.removeListener("jarvis:ghost-render", handler);
  },
  onClear: (cb) => {
    const handler = () => {
      if (typeof cb === "function") cb();
    };
    ipcRenderer.on("jarvis:ghost-clear", handler);
    return () => ipcRenderer.removeListener("jarvis:ghost-clear", handler);
  },
});
