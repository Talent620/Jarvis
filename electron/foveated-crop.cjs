// === JARVIS SYMBIONT · Lokalny Wycinek „Pod Kursorem” (Foveated Crop) ===
// Wyciąga wyłącznie mały fragment obrazu wokół kursora (domyślnie 384×384 px) zamiast pełnego ekranu:
// - Sprawdza tarczę poufności (isConfidentialSurface + węzeł OS-Tree pod kursorem) PRZED przechwyceniem pikseli
// - Obsługuje wiele monitorów (także ujemne współrzędne) oraz skalowanie HiDPI (scaleFactor)
// - Na Waylandzie korzysta ze standardowego desktopCapturer (portal XDG ScreenCast po zgodzie użytkownika)

const { computeOverlayGeometry, isConfidentialSurface } = require("./ghost-overlay.cjs");

/**
 * Pure: oblicz prostokąt wycinka (cropRect) w pikselach fizycznych wewnątrz przechwyconego monitora.
 */
function computeFoveatedCropRect(opts = {}) {
  const displays = Array.isArray(opts.displays) && opts.displays.length > 0
    ? opts.displays
    : [{ id: 0, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }];

  const geom = computeOverlayGeometry(
    { x: opts.cursorX ?? 0, y: opts.cursorY ?? 0, coordSpace: opts.coordSpace || "physical" },
    displays,
  );
  const sf = geom.scaleFactor;
  const screenPhysW = Math.max(64, Math.round(geom.displayBounds.width * sf));
  const screenPhysH = Math.max(64, Math.round(geom.displayBounds.height * sf));
  const localPhysX = Math.max(0, Math.min(screenPhysW - 1, Math.round(geom.localX * sf)));
  const localPhysY = Math.max(0, Math.min(screenPhysH - 1, Math.round(geom.localY * sf)));

  const wanted = Math.max(128, Math.min(768, Math.round(Number(opts.cropSize) || 384)));
  const cropWidth = Math.min(wanted, screenPhysW);
  const cropHeight = Math.min(wanted, screenPhysH);

  const cropX = Math.max(0, Math.min(screenPhysW - cropWidth, Math.round(localPhysX - cropWidth / 2)));
  const cropY = Math.max(0, Math.min(screenPhysH - cropHeight, Math.round(localPhysY - cropHeight / 2)));

  return {
    displayId: geom.displayId,
    displayBounds: geom.displayBounds,
    scaleFactor: sf,
    screenPhysW,
    screenPhysH,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    cursorRelX: localPhysX - cropX,
    cursorRelY: localPhysY - cropY,
  };
}

function createFoveatedCropper(deps = {}) {
  const desktopCapturer = deps.desktopCapturer || null;
  const screenApi = deps.screen || null;
  const pilot = deps.pilot || null;
  const uiTree = deps.uiTree || null;
  const getActiveWindowTitle = deps.getActiveWindowTitle || (async () => "");

  async function captureCrop(opts = {}) {
    let cx = Number(opts.x);
    let cy = Number(opts.y);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      const cur = pilot?.cursorPosition ? await pilot.cursorPosition() : null;
      if (!cur || !cur.ok) {
        return { ok: false, error: cur?.error || "err:no-cursor" };
      }
      cx = Number(cur.x) || 0;
      cy = Number(cur.y) || 0;
    }

    const [activeWinTitle, hitRes] = await Promise.all([
      Promise.resolve(getActiveWindowTitle()).catch(() => ""),
      uiTree?.nodeAtPoint ? uiTree.nodeAtPoint(cx, cy).catch(() => null) : Promise.resolve(null),
    ]);

    const node = hitRes?.found ? hitRes.node : null;
    const winTitle = hitRes?.windowTitle || activeWinTitle || "";

    // TWARDA BRAMKA POUFNOŚCI PRZED POBRANIEM OBRAZU!
    if (
      isConfidentialSurface({
        windowTitle: winTitle,
        targetLabel: node?.name,
        role: node?.role,
        isPassword: node?.isPassword,
      })
    ) {
      return {
        ok: false,
        blocked: true,
        error: "err:confidential-blocked",
        reason: "RiskGuard: zablokowano wycinek obrazu — kursor znajduje się nad polem hasła, 2FA lub oknem uwierzytelniania.",
        cursorX: cx,
        cursorY: cy,
        windowTitle: winTitle,
      };
    }

    const displays = screenApi?.getAllDisplays?.() || [];
    const rect = computeFoveatedCropRect({
      cursorX: cx,
      cursorY: cy,
      cropSize: opts.cropSize || 384,
      coordSpace: opts.coordSpace || "physical",
      displays,
    });

    if (!desktopCapturer?.getSources) {
      return { ok: false, error: "err:no-capturer", cursorX: cx, cursorY: cy, node, windowTitle: winTitle };
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: rect.screenPhysW, height: rect.screenPhysH },
      });
      if (!Array.isArray(sources) || sources.length === 0) {
        return { ok: false, error: "err:no-screen-source", cursorX: cx, cursorY: cy };
      }

      const matched =
        sources.find((s) => String(s.display_id || "") === String(rect.displayId)) ||
        sources[0];
      if (!matched?.thumbnail) {
        return { ok: false, error: "err:empty-thumbnail", cursorX: cx, cursorY: cy };
      }

      const cropped = matched.thumbnail.crop({
        x: rect.cropX,
        y: rect.cropY,
        width: rect.cropWidth,
        height: rect.cropHeight,
      });
      const pngBase64 = cropped.toPNG().toString("base64");

      return {
        ok: true,
        data: pngBase64,
        mediaType: "image/png",
        width: rect.cropWidth,
        height: rect.cropHeight,
        cursorX: cx,
        cursorY: cy,
        cursorRelX: rect.cursorRelX,
        cursorRelY: rect.cursorRelY,
        displayId: rect.displayId,
        scaleFactor: rect.scaleFactor,
        windowTitle: winTitle,
        backend: hitRes?.backend || undefined,
        node: node || undefined,
      };
    } catch (e) {
      return {
        ok: false,
        error: `err:${e && e.message ? e.message : e}`,
        cursorX: cx,
        cursorY: cy,
      };
    }
  }

  return { captureCrop };
}

module.exports = {
  computeFoveatedCropRect,
  createFoveatedCropper,
};
