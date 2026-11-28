// Bezpieczny, natywny downloader aktualizacji JARVIS dla Electron (Linux / Windows).
// Twarda allowlista hostów GitHub Releases, weryfikacja SHA256 w locie, atomowy zapis (.part → rename)
// oraz automatyczne `chmod 0o755` dla plików `.AppImage` na Ubuntu/Linuksie. Zero zewnętrznych zależności.
const nodeCrypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const ALLOWED_REPO_PREFIX = "/Talent620/Jarvis/releases/download/";
const ALLOWED_CDN_HOSTS = new Set([
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

function isAllowedInitialUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ""));
    return (
      u.protocol === "https:"
      && u.hostname === "github.com"
      && !u.username
      && !u.password
      && u.pathname.startsWith(ALLOWED_REPO_PREFIX)
    );
  } catch {
    return false;
  }
}

function isAllowedRedirectUrl(rawUrl) {
  if (isAllowedInitialUrl(rawUrl)) return true;
  try {
    const u = new URL(String(rawUrl || ""));
    if (u.protocol !== "https:" || u.username || u.password) return false;
    if (ALLOWED_CDN_HOSTS.has(u.hostname)) return true;
    return u.hostname.endsWith(".githubusercontent.com");
  } catch {
    return false;
  }
}

function safeFilenameFromUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ""));
    const base = path.basename(decodeURIComponent(u.pathname || ""));
    if (!base || base === "." || base === ".." || /[\\/\0<>:"|?*]/.test(base)) return "";
    if (!/\.(?:AppImage|deb|exe|apk|zip)$/i.test(base)) return "";
    return base;
  } catch {
    return "";
  }
}

function isPathInsideDir(dir, targetPath) {
  const base = path.resolve(String(dir || ""));
  const resolved = path.resolve(String(targetPath || ""));
  const rel = path.relative(base, resolved);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function downloadReleaseAsset({
  url,
  expectedSha256 = "",
  destDir,
  onProgress,
  maxRedirects = 5,
  timeoutMs = 120_000,
  platform = process.platform,
  requestFn = https.get,
}) {
  if (!isAllowedInitialUrl(url)) {
    return Promise.resolve({
      ok: false,
      error: "Odmowa bezpieczeństwa: dozwolone jest wyłącznie pobieranie z oficjalnych wydań GitHub (Talent620/Jarvis).",
    });
  }
  const filename = safeFilenameFromUrl(url);
  if (!filename) {
    return Promise.resolve({ ok: false, error: "Nieprawidłowa nazwa pliku instalatora w adresie wydania." });
  }
  if (!destDir) {
    return Promise.resolve({ ok: false, error: "Brak katalogu docelowego do zapisu aktualizacji." });
  }

  const finalPath = path.join(path.resolve(destDir), filename);
  const partPath = `${finalPath}.part-${process.pid}-${Date.now()}`;
  const cleanExpected = String(expectedSha256 || "").trim().toLowerCase();

  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const cleanupPart = () => {
      try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch { /* ignore */ }
    };

    const fetchUrl = (currentUrl, redirectsLeft) => {
      let req;
      try {
        req = requestFn(
          currentUrl,
          { headers: { "User-Agent": "JARVIS-Desktop-Updater/6.0", Accept: "application/octet-stream" }, timeout: timeoutMs },
          (res) => {
            const status = res.statusCode || 0;
            if (status >= 300 && status < 400 && res.headers.location) {
              res.resume();
              if (redirectsLeft <= 0) {
                cleanupPart();
                done({ ok: false, error: "Zbyt wiele przekierowań podczas pobierania z GitHub." });
                return;
              }
              const nextUrl = new URL(res.headers.location, currentUrl).toString();
              if (!isAllowedRedirectUrl(nextUrl)) {
                cleanupPart();
                done({ ok: false, error: "Zablokowano przekierowanie poza zaufany serwer GitHub." });
                return;
              }
              fetchUrl(nextUrl, redirectsLeft - 1);
              return;
            }

            if (status !== 200) {
              res.resume();
              cleanupPart();
              done({ ok: false, error: `Serwer GitHub zwrócił kod HTTP ${status}.` });
              return;
            }

            try {
              fs.mkdirSync(path.dirname(finalPath), { recursive: true });
            } catch (e) {
              res.resume();
              done({ ok: false, error: `Nie można utworzyć katalogu pobrania: ${e.message}` });
              return;
            }

            const totalBytes = Number(res.headers["content-length"] || 0) || 0;
            const hash = nodeCrypto.createHash("sha256");
            const out = fs.createWriteStream(partPath, { mode: 0o644 });
            let receivedBytes = 0;
            let lastEmit = 0;
            const startedAt = Date.now();

            res.on("data", (chunk) => {
              receivedBytes += chunk.length;
              hash.update(chunk);
              const now = Date.now();
              if (onProgress && (now - lastEmit >= 120 || (totalBytes > 0 && receivedBytes >= totalBytes))) {
                lastEmit = now;
                const elapsedSec = Math.max(0.05, (now - startedAt) / 1000);
                onProgress({
                  filename,
                  receivedBytes,
                  totalBytes,
                  pct: totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : 0,
                  speedBps: Math.round(receivedBytes / elapsedSec),
                });
              }
            });

            res.on("error", (err) => {
              out.destroy();
              cleanupPart();
              done({ ok: false, error: `Przerwane pobieranie: ${err.message}` });
            });

            out.on("error", (err) => {
              res.destroy();
              cleanupPart();
              done({ ok: false, error: `Błąd zapisu pliku: ${err.message}` });
            });

            out.on("finish", () => {
              const sha256 = hash.digest("hex");
              if (cleanExpected && /^[0-9a-f]{64}$/.test(cleanExpected) && sha256 !== cleanExpected) {
                cleanupPart();
                done({
                  ok: false,
                  error: "Suma kontrolna SHA256 pobranego pliku nie zgadza się z manifestem wydania — plik odrzucony.",
                });
                return;
              }
              try {
                fs.renameSync(partPath, finalPath);
                let executableSet = false;
                if (platform === "linux" && /\.AppImage$/i.test(filename)) {
                  fs.chmodSync(finalPath, 0o755);
                  executableSet = true;
                }
                if (onProgress) {
                  onProgress({
                    filename,
                    receivedBytes,
                    totalBytes: totalBytes || receivedBytes,
                    pct: 100,
                    speedBps: 0,
                  });
                }
                done({
                  ok: true,
                  filePath: finalPath,
                  filename,
                  bytes: receivedBytes,
                  sha256,
                  verifiedSha256: Boolean(cleanExpected && /^[0-9a-f]{64}$/.test(cleanExpected)),
                  executableSet,
                });
              } catch (err) {
                cleanupPart();
                done({ ok: false, error: `Nie udało się zapisać pobranego pliku: ${err.message}` });
              }
            });

            res.pipe(out);
          },
        );
      } catch (err) {
        cleanupPart();
        done({ ok: false, error: `Błąd połączenia z GitHub: ${err.message}` });
        return;
      }

      req.on("timeout", () => {
        req.destroy();
        cleanupPart();
        done({ ok: false, error: "Przekroczono limit czasu pobierania z GitHub." });
      });
      req.on("error", (err) => {
        cleanupPart();
        done({ ok: false, error: `Błąd sieci podczas pobierania: ${err.message}` });
      });
    };

    fetchUrl(url, maxRedirects);
  });
}

module.exports = {
  isAllowedInitialUrl,
  isAllowedRedirectUrl,
  safeFilenameFromUrl,
  isPathInsideDir,
  downloadReleaseAsset,
};
