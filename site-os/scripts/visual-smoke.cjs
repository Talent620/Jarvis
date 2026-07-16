const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const url = process.env.SITE_OS_URL || "http://127.0.0.1:3210";
const output = path.join(__dirname, "..", ".runtime", "site-os-smoke.png");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    backgroundColor: "#0c1110",
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      sandbox: true
    }
  });

  try {
    await window.loadURL(url);
    await wait(1800);
    const metrics = await window.webContents.executeJavaScript(`(() => {
      const app = document.querySelector("#app");
      const workspace = document.querySelector(".workspace");
      const inspector = document.querySelector(".inspector");
      const frame = document.querySelector("#siteFrame");
      return {
        ready: app?.dataset.ready,
        viewport: [innerWidth, innerHeight],
        bodyWidth: document.body.getBoundingClientRect().width,
        scrollWidth: document.documentElement.scrollWidth,
        workspaceWidth: workspace?.getBoundingClientRect().width || 0,
        inspectorWidth: inspector?.getBoundingClientRect().width || 0,
        projects: document.querySelectorAll(".project-item").length,
        frameLoaded: Boolean(frame?.contentDocument?.documentElement)
      };
    })()`);

    if (metrics.ready !== "true") throw new Error("Edytor nie osiągnął stanu gotowości.");
    if (!metrics.projects) throw new Error("Lista projektów jest pusta.");
    if (!metrics.frameLoaded) throw new Error("Podgląd strony nie został załadowany.");
    if (metrics.scrollWidth > metrics.bodyWidth + 1) throw new Error("Interfejs ma niekontrolowany poziomy overflow.");
    if (metrics.workspaceWidth < 600 || metrics.inspectorWidth < 280) throw new Error("Układ edytora ma nieprawidłowe proporcje.");

    mkdirSync(path.dirname(output), { recursive: true });
    const image = await window.webContents.capturePage();
    writeFileSync(output, image.toPNG());
    console.log(JSON.stringify({ ok: true, output, metrics }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
