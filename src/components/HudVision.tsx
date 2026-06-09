import { useEffect, useRef, useState } from "react";
import { askJarvis } from "../lib/brain";
import { speak, stopSpeaking } from "../lib/voice";
import { store } from "../lib/store";

const PROMPT =
  "Jesteś wizją JARVIS-a (interfejs HUD). Zwięźle, w 1–2 zdaniach po polsku opisz co widać na obrazie, zidentyfikuj kluczowe obiekty i odczytaj widoczny tekst, jeśli jest. Bez wstępów.";

export default function HudVision({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [caption, setCaption] = useState("Inicjalizacja sensorów…");
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const autoRef = useRef<number | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play();
        }
        setCaption("Gotowy. Naciśnij przycisk Skanuj.");
      } catch {
        setErr("Brak dostępu do aparatu.");
      }
    })();
    return () => {
      if (autoRef.current) clearInterval(autoRef.current);
      stopSpeaking();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const grabBase64 = (): { data: string; mediaType: string } | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1024 / v.videoWidth);
    canvas.width = v.videoWidth * scale;
    canvas.height = v.videoHeight * scale;
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.7);
    return { data: url.slice(url.indexOf(",") + 1), mediaType: "image/jpeg" };
  };

  const scan = async () => {
    if (busy) return;
    const img = grabBase64();
    if (!img) return;
    setBusy(true);
    setCaption("Analizuję obraz…");
    try {
      const reply = await askJarvis([{ role: "user", content: PROMPT, image: img }]);
      setCaption(reply.text);
      if (store.settings.speak) speak(reply.text, store.settings);
    } catch (e) {
      setCaption(`Błąd analizy: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleAuto = () => {
    if (auto) {
      if (autoRef.current) clearInterval(autoRef.current);
      autoRef.current = null;
      setAuto(false);
    } else {
      setAuto(true);
      autoRef.current = window.setInterval(() => {
        if (!busy) scan();
      }, 7000);
      scan();
    }
  };

  return (
    <div className="sheet hud" onClick={(e) => e.stopPropagation()}>
      <video ref={videoRef} playsInline className="hud-video" />
      <div className="hud-overlay">
        <div className="hud-bracket tl" />
        <div className="hud-bracket tr" />
        <div className="hud-bracket bl" />
        <div className="hud-bracket br" />
        <div className="hud-scan" />
        <div className="hud-top">JARVIS · WIZJA {auto ? "· AUTO" : ""}{busy ? " · SKAN…" : ""}</div>
      </div>
      <div className="hud-caption">{err || caption}</div>
      <div className="hud-controls">
        <button className="btn" onClick={onClose}>Zakończ</button>
        <button className="btn" onClick={toggleAuto}>{auto ? "Auto: wł." : "Auto: wył."}</button>
        <button className="btn primary" onClick={scan} disabled={busy}>Skanuj</button>
      </div>
    </div>
  );
}
