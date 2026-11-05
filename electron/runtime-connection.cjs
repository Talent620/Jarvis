const fs = require("fs");
const path = require("path");
const os = require("os");

// Read only our private discovery file. Never probe arbitrary files supplied by the renderer.
function readRuntimeConnection() {
  const base = process.env.JARVIS_RUNTIME_DATA_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "jarvis", "runtime");
  try {
    const file = path.join(base, "connection.json");
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 16384) return null;
    if (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())) return null;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    const url = new URL(value.url);
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (typeof value.token !== "string" || value.token.length < 32 || value.token.length > 512) return null;
    return { url: url.origin, token: value.token };
  } catch { return null; }
}
module.exports = { readRuntimeConnection };
