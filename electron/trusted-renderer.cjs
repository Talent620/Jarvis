const path = require("node:path");
const { pathToFileURL } = require("node:url");

const appUrl = pathToFileURL(path.join(__dirname, "../dist/index.html")).href;

function isTrustedAppUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href === appUrl;
  } catch { return false; }
}

function isTrustedAppIpc(event, window) {
  return !!window && !window.isDestroyed() &&
    event?.sender === window.webContents &&
    event?.senderFrame === window.webContents.mainFrame &&
    isTrustedAppUrl(event.senderFrame.url);
}

module.exports = { isTrustedAppUrl, isTrustedAppIpc };
