// Główny proces Electrona — wersja JARVIS na komputer (Windows .exe).
const { app, BrowserWindow, shell, session } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 380,
    backgroundColor: "#04070f",
    autoHideMenuBar: true,
    title: "JARVIS",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "../dist/index.html"));

  // Linki zewnętrzne (Spotify, YouTube, mapy itd.) otwieraj w przeglądarce.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  // Pozwól na mikrofon (rozmowa na żywo / głos).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
