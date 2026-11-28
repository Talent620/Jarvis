import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import Modal from "./Modal";
import {
  applyUpdate,
  buildLocalTime,
  checkForUpdate,
  currentBuild,
  downloadNativeDesktopUpdate,
  formatUpdateSize,
  nativeDesktopDownloadSupported,
  platform,
  platformLabel,
  releasePageUrl,
  type NativeUpdateDownloadResult,
  type UpdateAssetItem,
  type UpdateInfo,
  type UpdateProgress,
} from "../lib/updater";
import { applyLiveUpdate, checkLiveUpdate, liveUpdateSupported } from "../lib/liveUpdate";
import { CHANGELOG } from "../lib/changelog";
import { desktop } from "../lib/desktop";
import { openUrl } from "../lib/deviceControl";
import { toast } from "../lib/toast";

export interface UpdateModalProps {
  initialInfo?: UpdateInfo | null;
  onInfoChange?: (info: UpdateInfo | null) => void;
  onClose: () => void;
}

const FALLBACK_DOWNLOADS: UpdateAssetItem[] = [
  {
    id: "ubuntu-appimage",
    label: "Ubuntu / Linux (AppImage)",
    platform: "linux",
    filename: "JARVIS.AppImage",
    url: "https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.AppImage",
    note: "Przenośny pakiet Linux — bez instalacji (w Electronie automatyczne chmod +x).",
  },
  {
    id: "ubuntu-deb",
    label: "Ubuntu / Debian (.deb)",
    platform: "linux",
    filename: "JARVIS.deb",
    url: "https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.deb",
    note: "Natywny pakiet systemowy Ubuntu (sudo apt install ./JARVIS.deb).",
  },
  {
    id: "windows-exe",
    label: "Windows (.exe)",
    platform: "windows",
    filename: "JARVIS.exe",
    url: "https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.exe",
    note: "Instalator Windows (NSIS — Dalej → Zainstaluj).",
  },
  {
    id: "android-safe-apk",
    label: "Android APK (Play-Protect Safe)",
    platform: "android",
    filename: "jarvis-apex-v4.apk",
    url: "https://github.com/Talent620/Jarvis/releases/download/latest/jarvis-apex-v4.apk",
    note: "Podpisany V1+V2+V3, instaluje się bez blokady Play Protect.",
  },
];

function formatSpeed(bps: number): string {
  if (!bps || bps < 1024) return "";
  if (bps < 1024 * 1024) return `${Math.round(bps / 1024)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

export default function UpdateModal({ initialInfo = null, onInfoChange, onClose }: UpdateModalProps) {
  const activePlat = platform();
  const canNativeDownload = nativeDesktopDownloadSupported();
  const canOta = liveUpdateSupported();

  const [info, setInfo] = useState<UpdateInfo | null>(initialInfo);
  const [checking, setChecking] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [downloadResult, setDownloadResult] = useState<NativeUpdateDownloadResult | null>(null);

  const [otaBusy, setOtaBusy] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  const runCheck = useCallback(async (silent = false) => {
    setChecking(true);
    setErrorMsg("");
    if (!silent) setStatusMsg("");
    const res = await checkForUpdate();
    setChecking(false);
    if ("error" in res) {
      setErrorMsg(res.error);
      return;
    }
    setInfo(res);
    onInfoChange?.(res);
    if (!silent) {
      setStatusMsg(
        res.newer
          ? res.assetAvailable
            ? `Wykryto nowszą wersję (${buildLocalTime(res.latest) || res.latest}).`
            : "Wykryto nowszą wersję — instalator jeszcze buduje się w GitHub Actions."
          : "Masz już najnowszą opublikowaną wersję JARVISA.",
      );
    }
  }, [onInfoChange]);

  useEffect(() => {
    if (!initialInfo) {
      void runCheck(true);
    }
  }, [initialInfo, runCheck]);

  const handleDownloadAsset = async (item: { id: string; url: string; sha256?: string; filename?: string }) => {
    setErrorMsg("");
    setStatusMsg("");
    setDownloadResult(null);

    if (canNativeDownload) {
      setDownloadingId(item.id);
      setProgress({
        filename: item.filename || "instalator",
        receivedBytes: 0,
        totalBytes: 0,
        pct: 0,
        speedBps: 0,
      });
      const res = await downloadNativeDesktopUpdate(item.url, item.sha256, (p) => setProgress(p));
      setDownloadingId(null);
      setDownloadResult(res);
      if (res.ok) {
        setStatusMsg(res.message);
        toast(res.message);
      } else {
        setErrorMsg(res.message);
      }
      return;
    }

    try {
      await openUrl(item.url);
      const msg = `Rozpoczęto pobieranie ${item.filename || "instalatora"}.`;
      setStatusMsg(msg);
      toast(msg);
    } catch {
      try {
        window.open(item.url, "_blank");
        setStatusMsg("Otwarto pobieranie w nowej karcie.");
      } catch {
        setErrorMsg("Nie udało się otworzyć linku pobierania — użyj przycisku „Kopiuj link”.");
      }
    }
  };

  const handlePrimaryUpdate = async () => {
    setErrorMsg("");
    setStatusMsg("");

    if (canOta) {
      setOtaBusy(true);
      try {
        const chk = await checkLiveUpdate();
        if (chk.available && chk.manifest) {
          setStatusMsg("Pobieram błyskawiczną aktualizację OTA…");
          const applied = await applyLiveUpdate(chk.manifest);
          if (applied.ok) {
            setStatusMsg("Aktualizacja OTA zastosowana — przeładowuję JARVISA.");
            return;
          }
          setErrorMsg(applied.error || "Błąd aktualizacji OTA — możesz pobrać pełny plik APK poniżej.");
          return;
        }
        if (info?.assetAvailable) {
          const r = await applyUpdate(info);
          if (r.ok) setStatusMsg(r.message);
          else setErrorMsg(r.message);
          return;
        }
        setStatusMsg(chk.error || "Brak nowszej paczki OTA — aplikacja jest aktualna.");
      } finally {
        setOtaBusy(false);
      }
      return;
    }

    if (activePlat === "web" && info) {
      const r = await applyUpdate(info);
      if (r.ok) setStatusMsg(r.message);
      else setErrorMsg(r.message);
      return;
    }

    const targetUrl = info?.url || (activePlat === "linux"
      ? "https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.AppImage"
      : activePlat === "windows"
        ? "https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.exe"
        : "https://github.com/Talent620/Jarvis/releases/download/latest/jarvis-apex-v4.apk");
    const targetName = activePlat === "linux" ? "JARVIS.AppImage" : activePlat === "windows" ? "JARVIS.exe" : "jarvis-apex-v4.apk";
    await handleDownloadAsset({ id: "primary", url: targetUrl, sha256: info?.sha256, filename: targetName });
  };

  const handleOpenDownloaded = async () => {
    const filePath = downloadResult?.filePath;
    if (!filePath) return;
    const res = await desktop()?.openDownloadedUpdate?.(filePath);
    if (res?.ok) {
      toast("Uruchamiam pobrany instalator…");
    } else {
      setErrorMsg(res?.error || "Nie udało się uruchomić pliku — otwórz go z folderu Pobrane.");
    }
  };

  const handleRevealDownloaded = async () => {
    const filePath = downloadResult?.filePath;
    if (!filePath) return;
    const res = await desktop()?.revealDownloadedUpdate?.(filePath);
    if (!res?.ok) {
      setErrorMsg(res?.error || "Nie udało się otworzyć folderu Pobrane.");
    }
  };

  const handleCopyUrl = async (url: string, label: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast(`Skopiowano link: ${label}`);
    } catch {
      toast("Nie udało się skopiować — otwórz link bezpośrednio.");
    }
  };

  const curBuild = currentBuild();
  const curLabel = buildLocalTime(curBuild) || curBuild || "wersja lokalna";
  const latestLabel = info ? (buildLocalTime(info.latest) || info.latest) : "—";
  const catalog: UpdateAssetItem[] =
    info?.downloads && info.downloads.length > 0
      ? info.downloads
      : FALLBACK_DOWNLOADS.map((item) => ({
          ...item,
          recommended: item.platform === activePlat && item.id !== "ubuntu-deb",
        }));

  const isUpdateReady = Boolean(info?.newer && info.assetAvailable);
  const busy = checking || Boolean(downloadingId) || otaBusy;

  return (
    <Modal
      title="Centrum Aktualizacji JARVIS"
      ariaLabel="Centrum Aktualizacji JARVIS"
      className="update-modal-panel"
      onClose={onClose}
      foot={
        <div style={{ display: "flex", gap: 8, width: "100%", justifyContent: "space-between", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ minHeight: 44 }}
            onClick={() => void openUrl(info?.releaseUrl || releasePageUrl("latest"))}
          >
            <ExternalLink size={15} /> Strona wydań GitHub
          </button>
          <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={onClose}>
            Zamknij
          </button>
        </div>
      }
    >
      <div className="update-modal-stack">
        {/* Karta stanu bieżącego urządzenia */}
        <section className={`update-hero-card${isUpdateReady ? " is-newer" : ""}`}>
          <div className="update-hero-top">
            <div className="update-hero-badge-row">
              <span className={`update-status-pill${isUpdateReady ? " ready" : info && !info.newer ? " current" : ""}`}>
                {checking ? (
                  <>
                    <RefreshCw size={13} className="spin" /> Sprawdzam GitHub…
                  </>
                ) : isUpdateReady ? (
                  <>
                    <Sparkles size={13} /> Nowa wersja gotowa
                  </>
                ) : info?.newer && !info.assetAvailable ? (
                  <>⏳ Nowa wersja buduje się w CI</>
                ) : info ? (
                  <>
                    <CheckCircle2 size={13} /> Wersja aktualna
                  </>
                ) : (
                  <>Gotowy do sprawdzenia</>
                )}
              </span>
              <span className="update-plat-chip">{platformLabel(activePlat)}</span>
            </div>
            <button
              type="button"
              className="btn-secondary update-check-btn"
              style={{ minHeight: 44 }}
              disabled={busy}
              onClick={() => void runCheck(false)}
            >
              <RefreshCw size={15} className={checking ? "spin" : ""} />
              {checking ? "Sprawdzam…" : "Sprawdź teraz"}
            </button>
          </div>

          <div className="update-version-grid">
            <div className="update-version-cell">
              <span className="muted">Zainstalowana</span>
              <strong>{curLabel}</strong>
            </div>
            <div className="update-version-cell">
              <span className="muted">Najnowsza (GitHub)</span>
              <strong>{latestLabel}</strong>
            </div>
          </div>

          {info?.sha256 && (
            <div className="update-sha-pill" title={info.sha256}>
              <ShieldCheck size={14} />
              <span>SHA256: <code>{info.sha256.slice(0, 16)}…</code></span>
            </div>
          )}

          <div className="update-primary-actions">
            <button
              type="button"
              className="btn-primary update-main-cta"
              style={{ minHeight: 46 }}
              disabled={busy || (Boolean(info?.newer) && !info?.assetAvailable)}
              onClick={() => void handlePrimaryUpdate()}
            >
              {otaBusy ? (
                <>
                  <RefreshCw size={16} className="spin" /> Instaluję aktualizację OTA…
                </>
              ) : downloadingId === "primary" ? (
                <>
                  <RefreshCw size={16} className="spin" /> Pobieram ({progress?.pct ?? 0}%)…
                </>
              ) : canOta ? (
                <>
                  <Zap size={16} /> {isUpdateReady ? "Aktualizuj błyskawicznie (OTA)" : "Sprawdź i wgraj OTA"}
                </>
              ) : activePlat === "web" ? (
                <>
                  <RefreshCw size={16} /> Odśwież i wyczyść pamięć podręczną
                </>
              ) : (
                <>
                  <Download size={16} />
                  {isUpdateReady
                    ? `Pobierz aktualizację (${platformLabel(activePlat)}${info?.size ? ` · ${formatUpdateSize(info.size)}` : ""})`
                    : `Pobierz najnowszy instalator (${platformLabel(activePlat)})`}
                </>
              )}
            </button>
          </div>

          {/* Pasek postępu natywnego pobierania Electron */}
          {downloadingId && progress && (
            <div className="update-progress-box" role="status" aria-live="polite">
              <div className="update-progress-meta">
                <span>Pobieram <b>{progress.filename}</b></span>
                <span>
                  {progress.pct > 0 ? `${progress.pct}%` : formatUpdateSize(progress.receivedBytes)}
                  {progress.speedBps > 0 ? ` · ${formatSpeed(progress.speedBps)}` : ""}
                </span>
              </div>
              <div className="update-progress-track">
                <div className="update-progress-fill" style={{ width: `${Math.max(4, progress.pct)}%` }} />
              </div>
            </div>
          )}

          {/* Karta po zakończeniu natywnego pobrania */}
          {downloadResult?.ok && downloadResult.filePath && (
            <div className="update-done-card">
              <div className="update-done-head">
                <CheckCircle2 size={16} />
                <strong>{downloadResult.filename} gotowy w folderze Pobrane</strong>
              </div>
              <div className="update-done-badges">
                {downloadResult.verifiedSha256 && <span className="update-mini-ok">✓ SHA256 zgodne</span>}
                {downloadResult.executableSet && <span className="update-mini-ok">✓ chmod +x ustawione</span>}
                {downloadResult.bytes ? <span className="update-mini-ok">{formatUpdateSize(downloadResult.bytes)}</span> : null}
              </div>
              <div className="update-done-actions">
                <button
                  type="button"
                  className="btn-primary"
                  style={{ minHeight: 44 }}
                  onClick={() => void handleOpenDownloaded()}
                >
                  <Play size={15} /> Uruchom instalator
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ minHeight: 44 }}
                  onClick={() => void handleRevealDownloaded()}
                >
                  <FolderOpen size={15} /> Pokaż w folderze
                </button>
              </div>
            </div>
          )}

          {statusMsg && !errorMsg && (
            <p className="update-feedback ok" role="status">{statusMsg}</p>
          )}
          {errorMsg && (
            <p className="update-feedback err" role="alert">{errorMsg}</p>
          )}
        </section>

        {/* Multi-platformowy hub pobrań */}
        <section className="update-section">
          <div className="update-section-head">
            <h3>📦 Pobierz na wszystkie urządzenia</h3>
            <span className="muted">Ubuntu · Windows · Android</span>
          </div>
          <div className="update-asset-list">
            {catalog.map((item) => {
              const isThisBusy = downloadingId === item.id;
              return (
                <div key={item.id} className={`update-asset-row${item.recommended ? " is-recommended" : ""}`}>
                  <div className="update-asset-info">
                    <div className="update-asset-title">
                      <strong>{item.label}</strong>
                      {item.recommended && <span className="update-rec-badge">Twoje urządzenie</span>}
                      {item.size ? <span className="muted">{formatUpdateSize(item.size)}</span> : null}
                    </div>
                    <div className="update-asset-note muted">{item.note}</div>
                  </div>
                  <div className="update-asset-btns">
                    <button
                      type="button"
                      className={item.recommended ? "btn-primary" : "btn-secondary"}
                      style={{ minHeight: 44 }}
                      disabled={busy}
                      onClick={() => void handleDownloadAsset(item)}
                    >
                      <Download size={15} /> {isThisBusy ? `${progress?.pct ?? 0}%` : "Pobierz"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ minHeight: 44 }}
                      aria-label={`Kopiuj link do ${item.label}`}
                      title="Kopiuj bezpośredni link"
                      onClick={() => void handleCopyUrl(item.url, item.filename)}
                    >
                      <Copy size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Historia zmian */}
        <section className="update-section">
          <button
            type="button"
            className="btn-secondary update-toggle-btn"
            style={{ minHeight: 44, width: "100%", justifyContent: "space-between" }}
            aria-expanded={showChangelog}
            onClick={() => setShowChangelog((v) => !v)}
          >
            <span>📜 Co nowego w JARVIS ({CHANGELOG[0]?.version || "ostatnie zmiany"})</span>
            <span>{showChangelog ? "▲ Zwiń" : "▼ Rozwiń"}</span>
          </button>
          {showChangelog && (
            <div className="update-changelog-list">
              {CHANGELOG.slice(0, 4).map((entry) => (
                <div key={`${entry.date}-${entry.version}`} className="update-changelog-entry">
                  <div className="update-changelog-head">
                    <strong>{entry.version}</strong>
                    <span className="muted">{entry.date}</span>
                  </div>
                  <ul>
                    {entry.items.slice(0, 6).map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Bezpieczeństwo */}
        <p className="muted update-security-foot">
          <ShieldCheck size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
          Pobieranie akceptuje wyłącznie oficjalne wydania <code>Talent620/Jarvis</code> na GitHub,
          zapisuje atomowo (<code>.part → rename</code>), weryfikuje sumę SHA256 (gdy obecna w manifeście)
          i automatycznie nadaje <code>+x</code> dla plików <code>.AppImage</code> na Ubuntu.
        </p>
      </div>
    </Modal>
  );
}
