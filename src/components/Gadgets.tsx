import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { store, uid } from "../lib/store";
import { encryptText, decryptText } from "../lib/cipher";
import { estimateBpm, type PpgSample } from "../lib/ppg";
import {
  vaultExists, vaultUnlocked, unlockVault, lockVault, listCreds, saveCred, removeCred, genPassword, type Cred,
} from "../lib/vault";
import { isDesktop, typeText } from "../lib/desktop";
import { useEscape } from "../hooks/useEscape";

type Tab = "torch" | "magnify" | "compass" | "level" | "noise" | "timer" | "metro" | "rec" | "nfc" | "pass" | "dice" | "qr" | "cipher" | "pulse" | "vault";

const TABS: { id: Tab; label: string }[] = [
  { id: "torch", label: "🔦 Latarka" },
  { id: "magnify", label: "🔍 Lupa" },
  { id: "compass", label: "🧭 Kompas" },
  { id: "level", label: "📐 Poziomica" },
  { id: "noise", label: "🔊 Hałas" },
  { id: "timer", label: "⏱ Stoper" },
  { id: "metro", label: "🥁 Metronom" },
  { id: "rec", label: "🎙 Dyktafon" },
  { id: "nfc", label: "📡 NFC" },
  { id: "pass", label: "🔑 Hasła" },
  { id: "dice", label: "🎲 Losowanie" },
  { id: "qr", label: "🔳 QR" },
  { id: "cipher", label: "🔐 Szyfr" },
  { id: "vault", label: "🗝 Sejf haseł" },
  { id: "pulse", label: "❤️ Puls" },
];

// --- 🔦 Latarka + SOS ---
function Flashlight() {
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<any>(null);
  const sosRef = useRef<number | null>(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState("");

  async function ensure(): Promise<any | null> {
    if (trackRef.current) return trackRef.current;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = s;
      trackRef.current = s.getVideoTracks()[0];
      return trackRef.current;
    } catch {
      setErr("Brak dostępu do aparatu / latarki.");
      return null;
    }
  }
  async function set(v: boolean) {
    const t = await ensure();
    if (!t) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: v }] });
      setOn(v);
    } catch {
      setErr("To urządzenie nie pozwala sterować latarką z przeglądarki.");
    }
  }
  function stopSos() {
    if (sosRef.current) {
      clearInterval(sosRef.current);
      sosRef.current = null;
    }
  }
  function sos() {
    stopSos();
    // ... --- ...  (uproszczony rytm)
    const pattern = [200, 200, 200, 200, 200, 600, 600, 200, 600, 200, 600, 600, 200, 200, 200, 200, 200, 1000];
    let i = 0;
    let lit = false;
    const tick = () => {
      lit = !lit;
      set(lit);
      sosRef.current = window.setTimeout(tick, pattern[i % pattern.length]) as unknown as number;
      i++;
    };
    tick();
  }
  useEffect(() => () => {
    stopSos();
    set(false);
    streamRef.current?.getTracks().forEach((x) => x.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: "50%",
          margin: "20px auto",
          background: on ? "radial-gradient(circle,#fff,#9ff3ff)" : "var(--bg)",
          border: "2px solid var(--line-strong)",
          boxShadow: on ? "0 0 40px #9ff3ff" : "none",
        }}
      />
      <button className="btn primary" onClick={() => set(!on)}>
        {on ? "Wyłącz" : "Włącz latarkę"}
      </button>
      <button className="btn" onClick={() => { stopSos(); sos(); }}>
        SOS (miganie)
      </button>
      <button className="btn" onClick={() => { stopSos(); set(false); }}>
        Stop
      </button>
      {err && <p className="muted">{err}</p>}
    </div>
  );
}

// --- 🧭 Kompas ---
function Compass() {
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    const handler = (e: any) => {
      const h = e.webkitCompassHeading ?? (e.alpha != null ? 360 - e.alpha : null);
      if (h != null) setHeading(Math.round(h));
    };
    const start = async () => {
      const anyOri = (window as any).DeviceOrientationEvent;
      if (anyOri?.requestPermission) {
        try {
          await anyOri.requestPermission();
        } catch {
          /* ignore */
        }
      }
      window.addEventListener("deviceorientation", handler, true);
    };
    start();
    return () => window.removeEventListener("deviceorientation", handler, true);
  }, []);
  const dir = heading == null ? "" : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(heading / 45) % 8];
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          width: 160,
          height: 160,
          borderRadius: "50%",
          border: "2px solid var(--line-strong)",
          margin: "20px auto",
          position: "relative",
          transform: `rotate(${heading == null ? 0 : -heading}deg)`,
          transition: "transform 0.2s",
        }}
      >
        <div style={{ position: "absolute", top: 4, left: "50%", transform: "translateX(-50%)", color: "var(--danger)", fontWeight: 700 }}>N</div>
      </div>
      <div style={{ fontSize: 28, fontFamily: "Orbitron", color: "var(--cyan)" }}>
        {heading == null ? "—" : `${heading}° ${dir}`}
      </div>
      {heading == null && <p className="muted">Brak czujnika kierunku na tym urządzeniu.</p>}
    </div>
  );
}

// --- 📐 Poziomica ---
function Level() {
  const [g, setG] = useState({ beta: 0, gamma: 0 });
  useEffect(() => {
    const handler = (e: any) => setG({ beta: e.beta || 0, gamma: e.gamma || 0 });
    window.addEventListener("deviceorientation", handler, true);
    return () => window.removeEventListener("deviceorientation", handler, true);
  }, []);
  const x = Math.max(-1, Math.min(1, g.gamma / 45)) * 70;
  const y = Math.max(-1, Math.min(1, g.beta / 45)) * 70;
  const flat = Math.abs(g.beta) < 2 && Math.abs(g.gamma) < 2;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ width: 180, height: 180, borderRadius: "50%", border: "2px solid var(--line-strong)", margin: "20px auto", position: "relative", display: "grid", placeItems: "center" }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: flat ? "var(--ok)" : "var(--cyan)", transform: `translate(${x}px, ${y}px)`, transition: "0.1s" }} />
      </div>
      <div className="muted">{flat ? "Idealnie w poziomie ✓" : `Nachylenie: ${Math.round(g.beta)}° / ${Math.round(g.gamma)}°`}</div>
    </div>
  );
}

// --- 🔊 Miernik hałasu ---
function NoiseMeter() {
  const [db, setDb] = useState<number | null>(null);
  useEffect(() => {
    let ctx: AudioContext | null = null;
    let raf = 0;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        const loop = () => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          const rms = Math.sqrt(sum / buf.length);
          const val = Math.max(0, Math.min(120, Math.round(20 * Math.log10(rms || 1e-7) + 94)));
          setDb(val);
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        setDb(-1);
      }
    })();
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
    };
  }, []);
  return (
    <div style={{ textAlign: "center", paddingTop: 20 }}>
      {db === -1 ? (
        <p className="muted">Brak dostępu do mikrofonu.</p>
      ) : (
        <>
          <div style={{ fontSize: 56, fontFamily: "Orbitron", color: "var(--cyan)" }}>{db ?? "—"}</div>
          <div className="muted">dB (orientacyjnie)</div>
          <div style={{ height: 10, background: "var(--bg)", borderRadius: 6, margin: "16px 0", overflow: "hidden", border: "1px solid var(--line)" }}>
            <div style={{ height: "100%", width: `${((db || 0) / 120) * 100}%`, background: (db || 0) > 85 ? "var(--danger)" : "var(--cyan)" }} />
          </div>
        </>
      )}
    </div>
  );
}

// --- 🔑 Generator haseł ---
function PasswordGen() {
  const [len, setLen] = useState(16);
  const [sym, setSym] = useState(true);
  const [pwd, setPwd] = useState("");
  const gen = () => {
    const base = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const set = base + (sym ? "!@#$%^&*-_=+?" : "");
    const arr = new Uint32Array(len);
    crypto.getRandomValues(arr);
    setPwd(Array.from(arr, (n) => set[n % set.length]).join(""));
  };
  useEffect(gen, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ paddingTop: 16 }}>
      <div className="field">
        <label>Długość: {len}</label>
        <input type="range" min="8" max="40" value={len} onChange={(e) => setLen(Number(e.target.value))} />
      </div>
      <div className="row">
        <span>Znaki specjalne</span>
        <input type="checkbox" checked={sym} onChange={(e) => setSym(e.target.checked)} style={{ width: 20, height: 20 }} />
      </div>
      <div
        style={{ background: "var(--bg)", border: "1px solid var(--line-strong)", borderRadius: 10, padding: 14, margin: "12px 0", fontFamily: "Share Tech Mono", fontSize: 18, color: "var(--gold)", wordBreak: "break-all" }}
      >
        {pwd}
      </div>
      <button className="btn primary" onClick={gen}>Generuj</button>
      <button className="btn" onClick={() => navigator.clipboard?.writeText(pwd).catch(() => {})}>Kopiuj</button>
    </div>
  );
}

// --- 🎲 Losowanie ---
function DiceCoin() {
  const [out, setOut] = useState("");
  const rnd = (n: number) => 1 + Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * n);
  return (
    <div style={{ textAlign: "center", paddingTop: 16 }}>
      <div style={{ fontSize: 64, fontFamily: "Orbitron", color: "var(--cyan)", minHeight: 80 }}>{out}</div>
      <button className="btn primary" onClick={() => setOut(String(rnd(6)))}>🎲 Kostka (1–6)</button>
      <button className="btn" onClick={() => setOut(rnd(2) === 1 ? "ORZEŁ" : "RESZKA")}>🪙 Moneta</button>
      <button className="btn" onClick={() => setOut(String(rnd(100)))}>🔢 1–100</button>
    </div>
  );
}

// --- 🔳 QR generuj + skanuj ---
function QrTool() {
  const [text, setText] = useState("");
  const [img, setImg] = useState("");
  const [scan, setScan] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanRef = useRef<number | null>(null);

  const make = async () => {
    if (!text.trim()) return;
    try {
      setImg(await QRCode.toDataURL(text, { width: 240, margin: 1, color: { dark: "#04070f", light: "#9ff3ff" } }));
    } catch {
      /* ignore */
    }
  };

  const startScan = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D niedostępny w tym środowisku.");
      const loop = () => {
        if (v.videoWidth) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(data.data, data.width, data.height);
          if (code?.data) {
            setScan(code.data);
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
        }
        scanRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      setScan("Brak dostępu do aparatu.");
    }
  };
  useEffect(() => () => {
    if (scanRef.current) cancelAnimationFrame(scanRef.current);
    const v = videoRef.current;
    (v?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
  }, []);

  return (
    <div style={{ paddingTop: 12 }}>
      <h3>Generuj</h3>
      <div className="field" style={{ display: "flex", gap: 8 }}>
        <input value={text} placeholder="tekst / link / WIFI:..." onChange={(e) => setText(e.target.value)} />
        <button className="btn" style={{ width: "auto", marginTop: 0 }} onClick={make}>Twórz</button>
      </div>
      {img && <img src={img} alt="QR" style={{ display: "block", margin: "8px auto", borderRadius: 10 }} />}

      <h3>Skanuj</h3>
      <video ref={videoRef} playsInline style={{ width: "100%", borderRadius: 10, background: "#000", maxHeight: 240 }} />
      <button className="btn" onClick={startScan}>Skanuj aparatem</button>
      {scan && (
        <div style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, padding: 10, marginTop: 8, wordBreak: "break-all", color: "var(--gold)" }}>
          {scan}
        </div>
      )}
    </div>
  );
}

// --- 🔍 Lupa ---
function Magnifier() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [zoom, setZoom] = useState(2);
  const trackRef = useRef<any>(null);
  const [torch, setTorch] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = videoRef.current!;
        v.srcObject = stream;
        trackRef.current = stream.getVideoTracks()[0];
        await v.play();
      } catch {
        /* ignore */
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);
  const toggleTorch = async () => {
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ torch: !torch }] });
      setTorch(!torch);
    } catch {
      /* brak latarki */
    }
  };
  return (
    <div style={{ paddingTop: 8 }}>
      <div style={{ overflow: "hidden", borderRadius: 12, border: "1px solid var(--line)", background: "#000" }}>
        <video
          ref={videoRef}
          playsInline
          style={{ width: "100%", display: "block", transform: `scale(${zoom})`, transformOrigin: "center", transition: "0.1s" }}
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Powiększenie: {zoom.toFixed(1)}×</label>
        <input type="range" min="1" max="6" step="0.1" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
      </div>
      <button className="btn" onClick={toggleTorch}>{torch ? "Zgaś światło" : "Doświetl"}</button>
    </div>
  );
}

// --- ⏱ Stoper + Minutnik ---
function beep() {
  try {
    const c = new AudioContext();
    const o = c.createOscillator();
    o.frequency.value = 880;
    o.connect(c.destination);
    o.start();
    setTimeout(() => { o.stop(); c.close(); }, 250);
  } catch {
    /* ignore */
  }
}
function Stopwatch() {
  const [ms, setMs] = useState(0);
  const [run, setRun] = useState(false);
  const [laps, setLaps] = useState<number[]>([]);
  const ref = useRef<number | null>(null);
  const start0 = useRef(0);
  useEffect(() => {
    if (run) {
      start0.current = Date.now() - ms;
      ref.current = window.setInterval(() => setMs(Date.now() - start0.current), 50);
    } else if (ref.current) {
      clearInterval(ref.current);
    }
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  const fmt = (t: number) =>
    `${String(Math.floor(t / 60000)).padStart(2, "0")}:${String(Math.floor((t % 60000) / 1000)).padStart(2, "0")}.${String(Math.floor((t % 1000) / 10)).padStart(2, "0")}`;
  return (
    <div style={{ textAlign: "center", paddingTop: 16 }}>
      <div style={{ fontSize: 48, fontFamily: "Share Tech Mono", color: "var(--cyan)" }}>{fmt(ms)}</div>
      <button className="btn primary" onClick={() => setRun(!run)}>{run ? "Pauza" : "Start"}</button>
      <button className="btn" onClick={() => setLaps((l) => [ms, ...l])} disabled={!run}>Międzyczas</button>
      <button className="btn" onClick={() => { setRun(false); setMs(0); setLaps([]); }}>Reset</button>
      {laps.map((l, i) => (
        <div key={i} className="list-item" style={{ justifyContent: "center", gap: 12 }}>
          <span className="muted">#{laps.length - i}</span> <span>{fmt(l)}</span>
        </div>
      ))}
    </div>
  );
}

// --- 🥁 Metronom ---
function Metronome() {
  const [bpm, setBpm] = useState(100);
  const [on, setOn] = useState(false);
  const ref = useRef<number | null>(null);
  useEffect(() => {
    if (on) {
      ref.current = window.setInterval(beep, (60 / bpm) * 1000);
    } else if (ref.current) {
      clearInterval(ref.current);
    }
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
  }, [on, bpm]);
  return (
    <div style={{ textAlign: "center", paddingTop: 16 }}>
      <div style={{ fontSize: 56, fontFamily: "Orbitron", color: "var(--cyan)" }}>{bpm}</div>
      <div className="muted">BPM</div>
      <div className="field" style={{ marginTop: 12 }}>
        <input type="range" min="40" max="220" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
      </div>
      <button className="btn primary" onClick={() => setOn(!on)}>{on ? "Stop" : "Start"}</button>
    </div>
  );
}

// --- 🎙 Dyktafon z transkrypcją na żywo ---
function Recorder() {
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const recRef = useRef<any>(null);
  const finalRef = useRef("");
  const runRef = useRef(false);
  const supported = Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const start = () => {
    finalRef.current = "";
    setText("");
    setSaved("");
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "pl-PL";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalRef.current += res[0].transcript + " ";
        else interim += res[0].transcript;
      }
      setText(finalRef.current + interim);
    };
    r.onend = () => {
      if (runRef.current) {
        try {
          r.start();
        } catch {
          /* ignore */
        }
      }
    };
    runRef.current = true;
    try {
      r.start();
    } catch {
      /* ignore */
    }
    recRef.current = r;
    setRecording(true);
  };

  const stop = () => {
    runRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setRecording(false);
  };

  const saveNote = () => {
    const t = (finalRef.current || text).trim();
    if (!t) return;
    store.setData((d) => d.notes.unshift({ id: uid(), text: `🎙 ${t}`, createdAt: Date.now() }));
    setSaved("Zapisano jako notatkę. Poproś JARVIS-a, by streścił ostatnią notatkę.");
  };

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!supported) return <p className="muted" style={{ paddingTop: 16 }}>Rozpoznawanie mowy niedostępne na tym urządzeniu.</p>;

  return (
    <div style={{ paddingTop: 12 }}>
      <div style={{ textAlign: "center" }}>
        <button className={`btn ${recording ? "" : "primary"}`} onClick={recording ? stop : start}>
          {recording ? "■ Zatrzymaj" : "● Nagrywaj"}
        </button>
      </div>
      <div
        style={{
          minHeight: 120,
          background: "var(--bg)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          padding: 12,
          margin: "12px 0",
          fontSize: 15,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {text || <span className="muted">Transkrypcja pojawi się tutaj…</span>}
      </div>
      <button className="btn" onClick={saveNote} disabled={!text.trim()}>Zapisz jako notatka</button>
      <button className="btn" onClick={() => navigator.clipboard?.writeText(text).catch(() => {})} disabled={!text.trim()}>
        Kopiuj
      </button>
      {saved && <p className="muted">{saved}</p>}
    </div>
  );
}

// --- 📡 NFC (Web NFC) — własne tagi ---
function NfcTool() {
  const supported = "NDEFReader" in window;
  const [out, setOut] = useState("");
  const [val, setVal] = useState("");
  const scan = async () => {
    try {
      const r = new (window as any).NDEFReader();
      await r.scan();
      setOut("Zbliż tag do telefonu…");
      r.onreading = (e: any) => {
        const recs: string[] = [];
        for (const rec of e.message.records) {
          try {
            recs.push(`${rec.recordType}: ${new TextDecoder().decode(rec.data)}`);
          } catch {
            recs.push(rec.recordType);
          }
        }
        setOut(`Serial: ${e.serialNumber || "—"}\n` + (recs.join("\n") || "(pusty tag)"));
      };
      r.onreadingerror = () => setOut("Nie udało się odczytać tagu.");
    } catch {
      setOut("Brak uprawnień lub NFC wyłączone.");
    }
  };
  const write = async () => {
    if (!val.trim()) return;
    try {
      const r = new (window as any).NDEFReader();
      const isUrl = /^https?:|^jarvis:/i.test(val);
      setOut("Zbliż tag, aby zapisać…");
      await r.write({ records: [isUrl ? { recordType: "url", data: val } : { recordType: "text", data: val }] });
      setOut("✅ Zapisano na tagu.");
    } catch {
      setOut("Nie udało się zapisać (przyłóż pusty/zapisywalny tag).");
    }
  };
  if (!supported) return <p className="muted" style={{ paddingTop: 16 }}>To urządzenie/przeglądarka nie obsługuje Web NFC.</p>;
  return (
    <div style={{ paddingTop: 12 }}>
      <button className="btn primary" onClick={scan}>Odczytaj tag</button>
      <h3>Zapisz na własny tag</h3>
      <div className="field" style={{ display: "flex", gap: 8 }}>
        <input value={val} placeholder="tekst, link lub jarvis://run?text=..." onChange={(e) => setVal(e.target.value)} />
        <button className="btn" style={{ width: "auto", marginTop: 0 }} onClick={write}>Zapisz</button>
      </div>
      <p className="muted">
        Wpisz <code>jarvis://run?text=Przedstaw raport poranny</code> i zapisz na tagu — po
        zbliżeniu telefonu tag otworzy JARVIS-a i wykona komendę. Używaj tylko własnych tagów.
      </p>
      {out && (
        <div style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, padding: 10, marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--gold)" }}>
          {out}
        </div>
      )}
    </div>
  );
}

// --- 🔐 Szyfr (AES-256-GCM, offline, pod pełną kontrolą użytkownika) ---
function Cipher() {
  const [text, setText] = useState("");
  const [pass, setPass] = useState("");
  const [out, setOut] = useState("");
  const [msg, setMsg] = useState("");

  const run = async (mode: "enc" | "dec") => {
    setMsg("");
    setOut("");
    if (!text.trim() || !pass) {
      setMsg("Podaj tekst i hasło.");
      return;
    }
    try {
      setOut(mode === "enc" ? await encryptText(text, pass) : await decryptText(text, pass));
    } catch {
      setMsg(mode === "dec" ? "Złe hasło lub uszkodzony szyfrogram." : "Nie udało się zaszyfrować.");
    }
  };


  return (
    <div style={{ paddingTop: 12 }}>
      <p className="muted">
        Szyfr AES-256-GCM (klasa wojskowa), w 100% offline na Twoim urządzeniu. Zaszyfruj
        notatkę/wiadomość hasłem; odszyfruje ją tylko ten, kto zna hasło. Nic nie wychodzi z urządzenia.
      </p>
      <div className="field">
        <textarea value={text} placeholder="Tekst jawny lub szyfrogram (JV1:…)" onChange={(e) => setText(e.target.value)} className="ta" />
      </div>
      <div className="field">
        <input type="password" value={pass} placeholder="Hasło" onChange={(e) => setPass(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => run("enc")}>🔒 Zaszyfruj</button>
        <button className="btn" style={{ flex: 1 }} onClick={() => run("dec")}>🔓 Odszyfruj</button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      {out && (
        <div className="field" style={{ marginTop: 10 }}>
          <textarea readOnly value={out} className="ta" onFocus={(e) => e.currentTarget.select()} />
          <button className="btn" onClick={() => navigator.clipboard?.writeText(out).catch(() => {})}>📋 Kopiuj</button>
        </div>
      )}
    </div>
  );
}


// --- ❤️ Puls (fotopletyzmografia: palec na aparacie + latarka) ---
const MEASURE_SEC = 22;

function HeartRate() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const samplesRef = useRef<PpgSample[]>([]);
  const [bpm, setBpm] = useState<number | null>(null);
  const [status, setStatus] = useState("Zakryj palcem tylny aparat (i latarkę), trzymaj nieruchomo.");
  const [measuring, setMeasuring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [wave, setWave] = useState<number[]>([]);

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    const s = streamRef.current;
    if (s) {
      s.getVideoTracks().forEach((t) => {
        try {
          t.applyConstraints({ advanced: [{ torch: false }] as any });
        } catch {
          /* ignore */
        }
        t.stop();
      });
    }
    streamRef.current = null;
    setMeasuring(false);
  };

  const finish = () => {
    cancelAnimationFrame(rafRef.current);
    const val = estimateBpm(samplesRef.current);
    stop();
    if (val) {
      setBpm(val);
      setStatus(`Tętno: ${val} uderzeń/min.`);
    } else {
      setStatus("Nie udało się zmierzyć — zakryj cały obiektyw palcem i trzymaj nieruchomo. Spróbuj jeszcze raz.");
    }
  };

  const start = async () => {
    setBpm(null);
    setWave([]);
    setProgress(0);
    samplesRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      try {
        await track.applyConstraints({ advanced: [{ torch: true }] as any });
      } catch {
        /* niektóre urządzenia bez sterowania latarką — pomiar nadal możliwy przy świetle */
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setMeasuring(true);
      setStatus("Mierzę… trzymaj palec nieruchomo.");
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        stream.getTracks().forEach((t) => t.stop());
        setStatus("Pomiar niedostępny w tym środowisku.");
        setMeasuring(false);
        return;
      }
      const t0 = Date.now();
      const loop = () => {
        const v = videoRef.current;
        if (v && v.videoWidth) {
          ctx.drawImage(v, 0, 0, 64, 64);
          const data = ctx.getImageData(0, 0, 64, 64).data;
          let r = 0;
          for (let i = 0; i < data.length; i += 4) r += data[i];
          r /= data.length / 4;
          const t = Date.now();
          samplesRef.current.push({ t, v: r });
          setWave((w) => [...w.slice(-99), r]);
          const elapsed = (t - t0) / 1000;
          setProgress(Math.min(1, elapsed / MEASURE_SEC));
          if (elapsed >= MEASURE_SEC) {
            finish();
            return;
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      setStatus("Brak dostępu do aparatu.");
      setMeasuring(false);
    }
  };

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mini-wykres sygnału (PPG) — pokazuje, że bije.
  const wavePath = (() => {
    if (wave.length < 2) return "";
    const min = Math.min(...wave);
    const max = Math.max(...wave);
    const range = max - min || 1;
    return wave
      .map((v, i) => `${(i / (wave.length - 1)) * 100},${30 - ((v - min) / range) * 28 - 1}`)
      .join(" ");
  })();

  return (
    <div style={{ textAlign: "center", paddingTop: 8 }}>
      <p className="muted">
        Pomiar tętna z aparatu (fotopletyzmografia): przyłóż opuszek palca tak, by zakrył tylny
        obiektyw i latarkę. JARVIS odczyta puls z mikro-pulsacji światła w palcu.
      </p>
      <video ref={videoRef} playsInline muted style={{ display: "none" }} />

      <div style={{ fontSize: 64, lineHeight: 1, margin: "8px 0" }}>
        <span style={{ display: "inline-block", animation: measuring ? "pulse 0.8s ease-in-out infinite" : "none" }}>❤️</span>
      </div>
      <div style={{ fontSize: 40, fontFamily: "Orbitron", color: "var(--cyan)", minHeight: 48 }}>
        {bpm ? `${bpm}` : measuring ? "…" : "—"}
        <span style={{ fontSize: 16, color: "var(--text-dim)" }}> BPM</span>
      </div>

      {measuring && (
        <>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: "100%", height: 48, marginTop: 4 }}>
            <polyline points={wavePath} fill="none" stroke="var(--cyan)" strokeWidth="0.7" />
          </svg>
          <div style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 7, padding: 3, marginTop: 6 }}>
            <div style={{ height: 8, borderRadius: 5, background: "var(--cyan)", width: `${Math.round(progress * 100)}%`, transition: "width 0.2s" }} />
          </div>
        </>
      )}

      <p className="muted" style={{ marginTop: 8 }}>{status}</p>
      {!measuring ? (
        <button className="btn primary" onClick={start}>❤️ Zmierz tętno</button>
      ) : (
        <button className="btn" onClick={() => { setStatus("Przerwano."); stop(); }}>Przerwij</button>
      )}
      {bpm && (
        <button
          className="btn"
          onClick={() => store.setData((d) => d.notes.unshift({ id: uid(), text: `❤️ Tętno: ${bpm} BPM (${new Date().toLocaleString("pl-PL")})`, createdAt: Date.now() }))}
        >
          💾 Zapisz w notatkach
        </button>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Orientacyjne, nie do celów medycznych.
      </p>
    </div>
  );
}

// --- 🗝 Sejf haseł (zaszyfrowany, autouzupełnianie) ---
function Vault() {
  const [unlocked, setUnlocked] = useState(vaultUnlocked());
  const [master, setMaster] = useState("");
  const [msg, setMsg] = useState("");
  const [items, setItems] = useState<Cred[]>(unlocked ? listCreds() : []);
  const [form, setForm] = useState<{ name: string; login: string; password: string }>({ name: "", login: "", password: "" });
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [typing, setTyping] = useState("");
  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});

  const refresh = () => setItems(listCreds());

  const unlock = async () => {
    setMsg("");
    if (await unlockVault(master)) {
      setUnlocked(true);
      setMaster("");
      refresh();
    } else {
      setMsg("Złe hasło główne.");
    }
  };

  const add = async () => {
    if (!form.name.trim() || !form.password) {
      setMsg("Podaj nazwę i hasło.");
      return;
    }
    await saveCred({ name: form.name.trim(), login: form.login.trim(), password: form.password });
    setForm({ name: "", login: "", password: "" });
    refresh();
  };

  // Autouzupełnianie na komputerze: po 3 s wpisuje login → TAB → hasło w aktywne pole.
  const autofill = async (c: Cred) => {
    for (let i = 3; i > 0; i--) {
      setTyping(`Kliknij pole logowania… wpisuję za ${i}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setTyping("");
    await typeText(`${c.login}\t${c.password}`);
  };

  if (!unlocked) {
    return (
      <div style={{ paddingTop: 12 }}>
        <p className="muted">
          {vaultExists()
            ? "Podaj hasło główne, by odblokować sejf. Wszystkie dane są zaszyfrowane AES-256 i nie opuszczają urządzenia."
            : "Utwórz sejf: ustaw hasło główne (zapamiętaj je — nie da się go odzyskać). Zaszyfruje Twoje loginy i hasła AES-256, lokalnie."}
        </p>
        <div className="field">
          <input
            type="password"
            value={master}
            placeholder="Hasło główne"
            onChange={(e) => setMaster(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
          />
        </div>
        <button className="btn primary" onClick={unlock} disabled={!master}>
          {vaultExists() ? "🔓 Odblokuj sejf" : "➕ Utwórz sejf"}
        </button>
        {msg && <p className="muted">{msg}</p>}
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="muted">{items.length} zapisanych kont</span>
        <button className="btn" style={{ width: "auto", marginTop: 0 }} onClick={() => { lockVault(); setUnlocked(false); }}>
          🔒 Zablokuj
        </button>
      </div>

      {items.map((c) => (
        <div key={c.id} className="journal-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <b>{c.name}</b>
            <span className="x" style={{ cursor: "pointer" }} onClick={async () => { await removeCred(c.id); refresh(); }}>✕</span>
          </div>
          {c.login && <div className="muted" style={{ fontSize: 13 }}>{c.login}</div>}
          <div className="muted" style={{ fontSize: 13, fontFamily: "Share Tech Mono" }}>
            {reveal[c.id] ? c.password : "••••••••••"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            <button className="chip" onClick={() => setReveal((r) => ({ ...r, [c.id]: !r[c.id] }))}>{reveal[c.id] ? "🙈 Ukryj" : "👁 Pokaż"}</button>
            {c.login && <button className="chip" onClick={() => copy(c.login)}>📋 Login</button>}
            <button className="chip" onClick={() => copy(c.password)}>📋 Hasło</button>
            {isDesktop() && <button className="chip" onClick={() => autofill(c)}>⌨ Wpisz (3s)</button>}
          </div>
        </div>
      ))}
      {typing && <p className="muted">{typing}</p>}

      <h3 style={{ marginTop: 14 }}>➕ Dodaj konto</h3>
      <div className="field"><input value={form.name} placeholder="Nazwa (np. Gmail)" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="field"><input value={form.login} placeholder="Login / e-mail" onChange={(e) => setForm({ ...form, login: e.target.value })} /></div>
      <div className="field" style={{ display: "flex", gap: 8 }}>
        <input value={form.password} placeholder="Hasło" onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ flex: 1 }} />
        <button className="btn" style={{ width: "auto", marginTop: 0 }} onClick={() => setForm({ ...form, password: genPassword(20) })}>🎲 Generuj</button>
      </div>
      <button className="btn primary" onClick={add}>💾 Zapisz konto</button>
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}

export default function Gadgets({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [tab, setTab] = useState<Tab>("torch");
  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🧰 Gadżety — multi-tool</h2>
          <div className="tabs" style={{ marginBottom: 0, marginTop: 12 }}>
            {TABS.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="panel-body">
          {tab === "torch" && <Flashlight />}
          {tab === "magnify" && <Magnifier />}
          {tab === "compass" && <Compass />}
          {tab === "level" && <Level />}
          {tab === "noise" && <NoiseMeter />}
          {tab === "timer" && <Stopwatch />}
          {tab === "metro" && <Metronome />}
          {tab === "rec" && <Recorder />}
          {tab === "nfc" && <NfcTool />}
          {tab === "pass" && <PasswordGen />}
          {tab === "dice" && <DiceCoin />}
          {tab === "qr" && <QrTool />}
          {tab === "cipher" && <Cipher />}
          {tab === "vault" && <Vault />}
          {tab === "pulse" && <HeartRate />}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
