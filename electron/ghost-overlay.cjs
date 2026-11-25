// === JARVIS SYMBIONT · GhostOverlay Manager (X11 / Windows Native + Wayland Honest Fallback) ===
// Zarządza osobnym, bezramkowym, przezroczystym oknem AR nad pulpitem:
// - 100% click-through (setIgnoreMouseEvents(true, { forward: true })) i zero kradzieży fokusu (focusable: false, showInactive)
// - Poziom alwaysOnTop = "floating" (NIGDY "screen-saver" — nie zasłania systemowych okien bezpieczeństwa Polkit/UAC)
// - Wielomonitorowość (również ujemne offsety monitorów) + przeliczanie HiDPI (physical px <-> DIP)
// - Tarcza poufnych okien (isConfidentialSurface: hasła, 2FA, Polkit, Pinentry, menedżery haseł, bankowość)
// - Uczciwy fallback na Waylandzie (gdzie Electron nie obsługuje globalnego setAlwaysOnTop)
// - Natychmiastowe ukrycie na Kill-Switch (Ctrl+Alt+X) i przy wyłączeniu w ustawieniach

const path = require("path");

const CONFIDENTIAL_SURFACE_RE =
  /(?:\bpolkit\b|pkexec|gcr-prompter|pinentry|ssh-askpass|1password|bitwarden|keepass|keepassxc|gnome-keyring|kwallet|seahorse|\buac\b|user account control|windows security|credential|\bsudo\b|has[łl][oa]|password|passwd|\b2fa\b|\botp\b|totp|authenticator|kod jednorazowy|\bcvv\b|\bcvc\b|\bpin\b|seed phrase|klucz prywatny|private key|secret key|autoryzacj|uwierzytelnian)/i;

/**
 * Pure: sprawdź, czy okno lub element dotyczy uwierzytelniania/sekretów (wtedy nakładka i wycinek są twardo blokowane).
 */
function isConfidentialSurface(info = {}) {
  if (!info || typeof info !== "object") return false;
  if (info.isPassword === true) return true;
  const role = String(info.role || "").toLowerCase();
  if (role.includes("password")) return true;
  const combined = [info.windowTitle, info.targetLabel, info.label, info.appName, info.extraText]
    .filter(Boolean)
    .join(" ");
  return CONFIDENTIAL_SURFACE_RE.test(combined);
}

/**
 * Pure: rozpoznaj rzeczywiste możliwości platformy dla nakładki Ghost AR (nie zakładaj, że Wayland == X11).
 */
function resolveGhostBackend({ platform = process.platform, env = process.env } = {}) {
  if (platform === "win32") {
    return {
      supported: true,
      mode: "native-overlay",
      backend: "win32-dwm",
      alwaysOnTopLevel: "floating",
      reason: "Natywna przezroczysta warstwa DWM (Windows).",
    };
  }
  if (platform === "linux") {
    const sessionType = String(env?.XDG_SESSION_TYPE || "").toLowerCase();
    const hasWayland = sessionType === "wayland" || Boolean(env?.WAYLAND_DISPLAY && sessionType !== "x11");
    if (hasWayland) {
      return {
        supported: false,
        mode: "wayland-fallback",
        backend: "wayland-hud-fallback",
        alwaysOnTopLevel: null,
        portalScreenCastRequired: true,
        reason:
          "Sesja Wayland nie wspiera globalnego setAlwaysOnTop() w Electronie — prezentacja celownika działa uczciwie w HUD-zie aplikacji (zrzuty ekranu przez portal XDG ScreenCast).",
      };
    }
    if (!env?.DISPLAY) {
      return {
        supported: false,
        mode: "headless-fallback",
        backend: "headless",
        alwaysOnTopLevel: null,
        reason: "Brak zmiennej DISPLAY — sesja bez serwera graficznego X11.",
      };
    }
    return {
      supported: true,
      mode: "native-overlay",
      backend: "x11-compositor",
      alwaysOnTopLevel: "floating",
      reason: "Natywna przezroczysta warstwa X11 (poziom floating — poniżej okien systemowych Polkit).",
    };
  }
  return {
    supported: false,
    mode: "unsupported-platform",
    backend: platform,
    alwaysOnTopLevel: null,
    reason: `Platforma ${platform} nie używa desktopowej warstwy Ghost AR.`,
  };
}

/**
 * Pure: wyznacz docelowy monitor oraz przelicz współrzędne fizyczne/DIP (z uwzględnieniem HiDPI scaleFactor
 * i wielomonitorowych offsetów ujemnych/dodatnich) na lokalne współrzędne DIP wewnątrz okna danego monitora.
 */
function computeOverlayGeometry(target = {}, displays = []) {
  const list = Array.isArray(displays) && displays.length > 0
    ? displays
    : [{ id: 0, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }];

  const coordSpace = target.coordSpace === "dip" ? "dip" : "physical";
  const rawX = Number(target.x) || 0;
  const rawY = Number(target.y) || 0;
  const rawW = Math.max(0, Number(target.width) || 0);
  const rawH = Math.max(0, Number(target.height) || 0);
  const rawBoxX = target.boxX !== undefined ? Number(target.boxX) : rawW > 0 ? rawX - rawW / 2 : rawX;
  const rawBoxY = target.boxY !== undefined ? Number(target.boxY) : rawH > 0 ? rawY - rawH / 2 : rawY;

  // Dopasuj monitor (sprawdzamy zarówno w przestrzeni fizycznej, jak i DIP, z fallbackiem do najbliższego środka).
  let chosen = list[0];
  let bestDist = Infinity;

  for (const d of list) {
    const b = d.bounds || { x: 0, y: 0, width: 1920, height: 1080 };
    const sf = Math.max(0.5, Number(d.scaleFactor) || 1);
    const minX = coordSpace === "dip" ? b.x : b.x * sf;
    const minY = coordSpace === "dip" ? b.y : b.y * sf;
    const maxX = minX + (coordSpace === "dip" ? b.width : b.width * sf);
    const maxY = minY + (coordSpace === "dip" ? b.height : b.height * sf);

    if (rawX >= minX && rawX < maxX && rawY >= minY && rawY < maxY) {
      chosen = d;
      bestDist = 0;
      break;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const dist = Math.hypot(rawX - cx, rawY - cy);
    if (dist < bestDist) {
      bestDist = dist;
      chosen = d;
    }
  }

  const bounds = chosen.bounds || { x: 0, y: 0, width: 1920, height: 1080 };
  const scaleFactor = Math.max(0.5, Number(chosen.scaleFactor) || 1);

  const dipGlobalX = coordSpace === "dip" ? rawX : rawX / scaleFactor;
  const dipGlobalY = coordSpace === "dip" ? rawY : rawY / scaleFactor;
  const dipW = coordSpace === "dip" ? rawW : rawW / scaleFactor;
  const dipH = coordSpace === "dip" ? rawH : rawH / scaleFactor;
  const dipBoxGlobalX = coordSpace === "dip" ? rawBoxX : rawBoxX / scaleFactor;
  const dipBoxGlobalY = coordSpace === "dip" ? rawBoxY : rawBoxY / scaleFactor;

  const localX = Math.max(0, Math.min(bounds.width, Math.round(dipGlobalX - bounds.x)));
  const localY = Math.max(0, Math.min(bounds.height, Math.round(dipGlobalY - bounds.y)));
  const localWidth = Math.round(dipW);
  const localHeight = Math.round(dipH);
  const boxLocalX = Math.round(dipBoxGlobalX - bounds.x);
  const boxLocalY = Math.round(dipBoxGlobalY - bounds.y);

  return {
    displayId: chosen.id ?? 0,
    displayBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    scaleFactor,
    localX,
    localY,
    localWidth,
    localHeight,
    boxLocalX,
    boxLocalY,
  };
}

/**
 * Utwórz menedżer okna GhostOverlay (w pełni wstrzykiwalne zależności Electrona do testów jednostkowych).
 */
function createGhostOverlayManager(deps = {}) {
  const platform = deps.platform || process.platform;
  const env = deps.env || process.env;
  const BrowserWindowCtor = deps.BrowserWindow || null;
  const screenApi = deps.screen || null;
  const htmlPath = deps.htmlPath || path.join(__dirname, "ghost-overlay.html");
  const preloadPath = deps.preloadPath || path.join(__dirname, "ghost-preload.cjs");
  const getActiveWindowTitle = deps.getActiveWindowTitle || (async () => "");

  let enabled = deps.enabled !== false;
  let win = null;
  let ready = false;
  let visible = false;
  let pendingPayload = null;
  let hideTimer = null;
  let lastState = null;

  function clearHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function status() {
    const cap = resolveGhostBackend({ platform, env });
    return {
      enabled,
      visible,
      windowCreated: Boolean(win && !win.isDestroyed()),
      ...cap,
      lastState,
    };
  }

  function ensureWindow() {
    const cap = resolveGhostBackend({ platform, env });
    if (!enabled || !cap.supported || !BrowserWindowCtor) return null;
    if (win && !win.isDestroyed()) return win;

    const primary = screenApi?.getPrimaryDisplay?.()?.bounds || { x: 0, y: 0, width: 1920, height: 1080 };
    ready = false;
    win = new BrowserWindowCtor({
      x: primary.x,
      y: primary.y,
      width: primary.width,
      height: primary.height,
      transparent: true,
      frame: false,
      show: false,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      ...(platform === "linux" ? { type: "toolbar" } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        preload: preloadPath,
      },
    });

    // Twarde zabezpieczenie: przepuszczanie 100% kliknięć użytkownika i poziom floating (poniżej okien bezpieczeństwa OS)
    win.setIgnoreMouseEvents(true, { forward: true });
    if (cap.alwaysOnTopLevel) {
      win.setAlwaysOnTop(true, cap.alwaysOnTopLevel);
    }
    if (typeof win.setVisibleOnAllWorkspaces === "function") {
      try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false }); } catch { /* optional */ }
    }

    if (win.webContents?.on) {
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      win.webContents.on("did-finish-load", () => {
        ready = true;
        if (pendingPayload && win && !win.isDestroyed()) {
          win.webContents.send("jarvis:ghost-render", pendingPayload);
          pendingPayload = null;
        }
      });
    }
    if (win.webContents?.setWindowOpenHandler) {
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    }
    if (win.on) {
      win.on("closed", () => {
        win = null;
        ready = false;
        visible = false;
      });
    }

    void win.loadFile(htmlPath);
    return win;
  }

  function hideImmediate(reason = "manual") {
    clearHideTimer();
    pendingPayload = null;
    visible = false;
    lastState = lastState ? { ...lastState, visible: false, hiddenReason: reason } : null;
    if (win && !win.isDestroyed()) {
      try { win.webContents?.send?.("jarvis:ghost-clear"); } catch { /* ignore */ }
      try { win.hide(); } catch { /* ignore */ }
    }
    return { ok: true, hidden: true, reason };
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) {
      hideImmediate("disabled");
      if (win && !win.isDestroyed()) {
        try { win.destroy(); } catch { /* ignore */ }
        win = null;
        ready = false;
      }
    }
    return status();
  }

  async function showTarget(payload = {}) {
    clearHideTimer();
    if (!enabled) {
      return { ok: false, fallback: true, mode: "disabled", reason: "Warstwa Ghost AR jest wyłączona w ustawieniach." };
    }

    const activeWinTitle = payload.windowTitle || (await Promise.resolve(getActiveWindowTitle()).catch(() => "")) || "";
    if (
      isConfidentialSurface({
        windowTitle: activeWinTitle,
        targetLabel: payload.label,
        role: payload.role,
        isPassword: payload.isPassword,
      })
    ) {
      hideImmediate("confidential-surface");
      return {
        ok: false,
        blocked: true,
        mode: "confidential-blocked",
        reason: "Ukryto Ghost AR — wykryto ekran uwierzytelniania lub element poufny.",
      };
    }

    const cap = resolveGhostBackend({ platform, env });
    const displays = screenApi?.getAllDisplays?.() || [];
    const geom = computeOverlayGeometry(payload, displays);

    const renderMsg = {
      ...geom,
      label: String(payload.label || "Element pulpitu").slice(0, 120),
      source: payload.source || "vision",
      sourceLabel:
        payload.sourceLabel ||
        (payload.source === "at-spi2"
          ? "AT-SPI2 · lokalnie"
          : payload.source === "win-uia"
            ? "Windows UIA · lokalnie"
            : payload.source === "cursor"
              ? "Pod kursorem · lokalnie"
              : "Vision"),
      confidence: typeof payload.confidence === "number" ? Math.max(0, Math.min(1, payload.confidence)) : 0.9,
      plannedAction: String(payload.plannedAction || "Wskazanie").slice(0, 80),
      approvalStatus: payload.approvalStatus || "preview",
      approvalLabel: payload.approvalLabel || "",
      ttlMs: Number(payload.ttlMs) > 0 ? Math.min(30000, Number(payload.ttlMs)) : 4500,
    };

    lastState = { ...renderMsg, visible: cap.supported, mode: cap.mode, updatedAt: Date.now() };

    if (!cap.supported) {
      return {
        ok: true,
        fallback: true,
        mode: cap.mode,
        reason: cap.reason,
        geometry: geom,
      };
    }

    const w = ensureWindow();
    if (!w) {
      return { ok: false, fallback: true, mode: "no-window", reason: "Brak konstruktora BrowserWindow." };
    }

    w.setBounds(geom.displayBounds);
    w.setIgnoreMouseEvents(true, { forward: true });
    if (ready) {
      w.webContents.send("jarvis:ghost-render", renderMsg);
    } else {
      pendingPayload = renderMsg;
    }

    if (typeof w.showInactive === "function") w.showInactive();
    else w.show();
    visible = true;

    if (renderMsg.ttlMs > 0) {
      hideTimer = setTimeout(() => {
        hideImmediate("ttl-expired");
      }, renderMsg.ttlMs + 220);
    }

    return {
      ok: true,
      fallback: false,
      mode: cap.mode,
      backend: cap.backend,
      geometry: geom,
    };
  }

  function destroy() {
    clearHideTimer();
    if (win && !win.isDestroyed()) {
      try { win.destroy(); } catch { /* ignore */ }
    }
    win = null;
    ready = false;
    visible = false;
  }

  return {
    status,
    setEnabled,
    showTarget,
    hideImmediate,
    destroy,
  };
}

module.exports = {
  createGhostOverlayManager,
  resolveGhostBackend,
  computeOverlayGeometry,
  isConfidentialSurface,
};
