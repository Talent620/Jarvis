import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { store, uid } from "../lib/store";
import { encryptText, decryptText } from "../lib/cipher";

type Tab = "torch" | "magnify" | "compass" | "level" | "noise" | "timer" | "metro" | "rec" | "nfc" | "pass" | "dice" | "qr" | "cipher" | "radar";

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
  { id: "radar", label: "🛰 Radar" },
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
      const ctx = canvas.getContext("2d")!;
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

  const ta = {
    width: "100%", minHeight: 80, background: "var(--bg)", color: "var(--text)",
    border: "1px solid var(--line)", borderRadius: 10, padding: 10, fontFamily: "inherit", fontSize: 14,
  } as const;

  return (
    <div style={{ paddingTop: 12 }}>
      <p className="muted">
        Szyfr AES-256-GCM (klasa wojskowa), w 100% offline na Twoim urządzeniu. Zaszyfruj
        notatkę/wiadomość hasłem; odszyfruje ją tylko ten, kto zna hasło. Nic nie wychodzi z urządzenia.
      </p>
      <div className="field">
        <textarea value={text} placeholder="Tekst jawny lub szyfrogram (JV1:…)" onChange={(e) => setText(e.target.value)} style={ta} />
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
          <textarea readOnly value={out} style={ta} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn" onClick={() => navigator.clipboard?.writeText(out).catch(() => {})}>📋 Kopiuj</button>
        </div>
      )}
    </div>
  );
}

// --- 🛰 Radar otoczenia: BLE (odległość z RSSI) + EMF/metal (magnetometr) + sieć ---
type Dev = { name: string; rssi: number; dist: number; t: number };

function Radar() {
  const [emf, setEmf] = useState<number | null>(null);
  const [emfBase, setEmfBase] = useState<number | null>(null);
  const [emfOk, setEmfOk] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<Record<string, Dev>>({});
  const [bleMsg, setBleMsg] = useState("");
  const [net, setNet] = useState("");
  const baseRef = useRef<number | null>(null);

  // Magnetometr → pole magnetyczne (µT). Wykrywa metal/elektronikę/magnesy.
  useEffect(() => {
    let sensor: any;
    try {
      const Mag = (window as any).Magnetometer;
      if (!Mag) {
        setEmfOk(false);
        return;
      }
      sensor = new Mag({ frequency: 15 });
      sensor.addEventListener("reading", () => {
        const v = Math.hypot(sensor.x || 0, sensor.y || 0, sensor.z || 0);
        setEmf(v);
        setEmfOk(true);
        const b = baseRef.current;
        baseRef.current = b == null ? v : b * 0.97 + v * 0.03;
        setEmfBase(baseRef.current);
      });
      sensor.addEventListener("error", () => setEmfOk(false));
      sensor.start();
    } catch {
      setEmfOk(false);
    }
    return () => {
      try {
        sensor?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // Informacje o sieci (pełny skan LAN wymaga backendu/natywu).
  useEffect(() => {
    const c = (navigator as any).connection;
    const p: string[] = [navigator.onLine ? "online" : "offline"];
    if (c?.effectiveType) p.push(c.effectiveType);
    if (c?.downlink) p.push(`~${c.downlink} Mb/s`);
    setNet(p.join(" · "));
  }, []);

  // Czyść nieaktywne urządzenia (brak sygnału > 15 s).
  useEffect(() => {
    const t = setInterval(() => {
      setDevices((d) => {
        const now = Date.now();
        const out: Record<string, Dev> = {};
        for (const k in d) if (now - d[k].t < 15000) out[k] = d[k];
        return out;
      });
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const scanBle = async () => {
    const bt = (navigator as any).bluetooth;
    if (!bt?.requestLEScan) {
      setBleMsg("Skan BLE niedostępny w tym środowisku (działa na desktopie/Chrome; na telefonie wymaga modułu natywnego — mogę dodać).");
      return;
    }
    try {
      setBleMsg("Skanuję otoczenie…");
      bt.addEventListener("advertisementreceived", (e: any) => {
        const id = e.device?.id || e.device?.name || "?";
        const rssi = e.rssi ?? -80;
        const dist = Math.min(30, Math.pow(10, (-59 - rssi) / 20));
        setDevices((d) => ({ ...d, [id]: { name: e.device?.name || "urządzenie", rssi, dist, t: Date.now() } }));
      });
      await bt.requestLEScan({ acceptAllAdvertisements: true });
      setBleMsg("Skan aktywny — zbliżaj telefon, blip podejdzie do środka.");
    } catch (err: any) {
      setBleMsg("Nie udało się uruchomić skanu: " + (err?.message || err));
    }
  };

  const blipPos = (id: string, dist: number) => {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
    const ang = ((h % 360) * Math.PI) / 180;
    const r = Math.min(46, (dist / 30) * 46);
    return { left: `${50 + r * Math.cos(ang)}%`, top: `${50 + r * Math.sin(ang)}%` };
  };

  const list = Object.entries(devices).sort((a, b) => a[1].dist - b[1].dist);
  const delta = emf != null && emfBase != null ? Math.abs(emf - emfBase) : 0;
  const emfPct = Math.min(100, (delta / 30) * 100); // 30µT odchylenia = pełna skala

  return (
    <div style={{ paddingTop: 8 }}>
      <p className="muted">
        Radar otoczenia: wykrywa pobliskie urządzenia Bluetooth (odległość z siły sygnału) i
        anomalie pola magnetycznego (metal/elektronika/ukryte magnesy). Działa pasywnie i legalnie.
      </p>

      <div className="radar">
        <div className="radar-ring" style={{ width: "33%", height: "33%" }} />
        <div className="radar-ring" style={{ width: "66%", height: "66%" }} />
        <div className="radar-ring" style={{ width: "99%", height: "99%" }} />
        <div className="radar-sweep" />
        <div className="radar-center" />
        {list.map(([id, d]) => (
          <div key={id} className="radar-blip" style={blipPos(id, d.dist)} title={`${d.name} · ${d.dist.toFixed(1)} m`} />
        ))}
      </div>

      <button className="btn primary" onClick={scanBle}>📡 Skanuj otoczenie (BLE)</button>
      {bleMsg && <p className="muted" style={{ marginTop: 6 }}>{bleMsg}</p>}

      {list.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {list.map(([id, d]) => (
            <div key={id} className="list-item">
              <span>📶 {d.name}</span>
              <span className="muted">{d.dist.toFixed(1)} m · {d.rssi} dBm</span>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ marginTop: 16 }}>🧲 Detektor metalu / EMF</h3>
      {emfOk === false ? (
        <p className="muted">Magnetometr niedostępny w tym urządzeniu/WebView.</p>
      ) : (
        <>
          <div style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: 3 }}>
            <div className="emf-bar" style={{ width: `${emfPct}%` }} />
          </div>
          <p className="muted" style={{ marginTop: 6 }}>
            Pole: {emf != null ? `${emf.toFixed(1)} µT` : "…"} · odchylenie {delta.toFixed(1)} µT
            {emfPct > 60 ? " — silna anomalia (metal/elektronika)" : emfPct > 25 ? " — wykryto obiekt" : ""}
          </p>
        </>
      )}

      <h3 style={{ marginTop: 16 }}>🌐 Sieć</h3>
      <p className="muted">
        Łącze: {net || "—"}. Pełny skan urządzeń w sieci domowej wymaga backendu/modułu natywnego
        (mogę dodać jako kolejny krok).
      </p>
    </div>
  );
}

export default function Gadgets({ onClose }: { onClose: () => void }) {
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
          {tab === "radar" && <Radar />}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
