import { useEffect, useRef } from "react";
import type { OrbState } from "./Orb";
import { getLevel, subscribeLevel } from "../lib/audioLevel";
import "../styles/hologram.css";

type Point = { x: number; y: number; z: number };
type ProjectedPoint = { x: number; y: number; depth: number };
type Face = { vertices: [number, number, number]; normal: Point };
type Mesh = { points: Point[]; edges: [number, number][]; faces: Face[] };

export interface HologramProps {
  state: OrbState;
  label?: string;
  compact?: boolean;
  onActivate?: () => void;
  actionLabel?: string;
  accent?: "violet" | "cyan" | "amber";
}

const STATUS: Record<OrbState, string> = {
  idle: "Gotowy do rozmowy",
  listening: "Słucham Cię…",
  thinking: "Pracuję nad odpowiedzią…",
  speaking: "Mówię…",
};

const MODE: Record<OrbState, string> = {
  idle: "GOTOWY",
  listening: "NASŁUCH",
  thinking: "ANALIZA",
  speaking: "GŁOS",
};

const gaussian = (value: number, center: number, width: number) =>
  Math.exp(-(((value - center) / width) ** 2));

// An original, procedural portrait. The front surface has a brow, eye sockets,
// cheekbones, nose and chin; it is not an external model or a video stream.
function makeMesh(sparse: boolean): Mesh {
  const points: Point[] = [];
  const edges: [number, number][] = [];
  const triangles: [number, number, number][] = [];
  const columns = sparse ? 30 : 48;
  const profile = [
    [-1.13, 0.08, 0.10], [-1.06, 0.27, 0.23], [-0.90, 0.43, 0.33],
    [-0.68, 0.49, 0.38], [-0.44, 0.49, 0.38], [-0.20, 0.46, 0.37],
    [0.02, 0.40, 0.34], [0.23, 0.34, 0.30], [0.42, 0.25, 0.24],
    [0.50, 0.13, 0.17],
  ];
  const rows = sparse ? 21 : 34;
  for (let row = 0; row < rows; row++) {
    const y = -1.13 + (row / (rows - 1)) * 1.63;
    let segment = 0;
    while (segment < profile.length - 2 && y > profile[segment + 1][0]) segment++;
    const a = profile[segment];
    const b = profile[segment + 1];
    const blend = (y - a[0]) / (b[0] - a[0]);
    const radiusX = a[1] + (b[1] - a[1]) * blend;
    const radiusZ = a[2] + (b[2] - a[2]) * blend;
    for (let column = 0; column < columns; column++) {
      const angle = (column / columns) * Math.PI * 2;
      const x = Math.sin(angle) * radiusX;
      const front = Math.max(0, Math.cos(angle));
      let z = Math.cos(angle) * radiusZ;
      z += front ** 5 * (
        0.18 * gaussian(x, 0, 0.10) * gaussian(y, -0.15, 0.29)
        + 0.17 * gaussian(x, 0, 0.11) * gaussian(y, 0.02, 0.09)
        + 0.04 * gaussian(y, -0.48, 0.07)
        - 0.07 * gaussian(Math.abs(x), 0.22, 0.11) * gaussian(y, -0.34, 0.09)
        + 0.05 * gaussian(Math.abs(x), 0.29, 0.12) * gaussian(y, -0.06, 0.12)
        + 0.05 * gaussian(x, 0, 0.18) * gaussian(y, 0.25, 0.05)
      );
      const index = points.length;
      points.push({ x, y, z });
      edges.push([index, row * columns + (column + 1) % columns]);
      if (row > 0) {
        edges.push([index - columns, index]);
        const right = row * columns + (column + 1) % columns;
        if ((column + row) % 2 === 0) edges.push([index - columns, right]);
        triangles.push([index - columns, right - columns, index], [right - columns, right, index]);
      }
    }
  }
  // Neck and shoulders form a second continuous surface below the portrait.
  const shoulders = [[0.41, 0.14, 0.15], [0.60, 0.17, 0.17], [0.77, 0.23, 0.20],
    [0.83, 0.45, 0.25], [0.94, 0.75, 0.28], [1.08, 1.02, 0.31], [1.20, 1.13, 0.33]];
  const offset = points.length;
  shoulders.forEach(([y, radiusX, radiusZ], row) => {
    for (let column = 0; column < columns; column++) {
      const angle = (column / columns) * Math.PI * 2;
      const index = points.length;
      points.push({ x: Math.sin(angle) * radiusX, y, z: Math.cos(angle) * radiusZ - 0.05 });
      edges.push([index, offset + row * columns + (column + 1) % columns]);
      if (row > 0) {
        edges.push([index - columns, index]);
        const right = offset + row * columns + (column + 1) % columns;
        if (column % 2 === 0) edges.push([index - columns, right]);
        triangles.push([index - columns, right - columns, index], [right - columns, right, index]);
      }
    }
  });
  const faces = triangles.map((vertices): Face => {
    const [a, b, c] = vertices.map(index => points[index]);
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const normal = { x: ab.y * ac.z - ab.z * ac.y, y: ab.z * ac.x - ab.x * ac.z, z: ab.x * ac.y - ab.y * ac.x };
    const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
    return { vertices, normal: { x: normal.x / length, y: normal.y / length, z: normal.z / length } };
  });
  return { points, edges, faces };
}

export default function Hologram({ state, label, compact = false, onActivate, accent = "violet",
  actionLabel = "Włącz mikrofon JARVIS-a" }: HologramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    stateRef.current = state;
    redrawRef.current();
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    let lowPower = document.documentElement.classList.contains("low-power");
    let sparse = lowPower || compact;
    let mesh = makeMesh(sparse);
    let width = 1;
    let height = 1;
    let ratio = 1;
    let frame = 0;
    let lastFrame = 0;
    let inView = true;
    let disposed = false;
    const initialLevel = getLevel();
    let level = Number.isFinite(initialLevel) ? Math.max(0, Math.min(1, initialLevel)) : 0;
    let amplitude = 0;
    let pointerX = 0;
    let pointerY = 0;
    let gazeX = 0;
    let gazeY = 0;

    function render(now: number) {
      if (!ctx) return;
      const mode = stateRef.current;
      const t = reduced ? 0 : now / 1000;
      const speaking = mode === "speaking";
      // SpeechSynthesis/native TTS may not expose samples. In that case the
      // speaking state is visible, but we do not invent audio or phoneme data.
      amplitude = reduced ? 0 : amplitude + ((speaking ? level : 0) - amplitude) * 0.30;
      gazeX += (pointerX - gazeX) * 0.055;
      gazeY += (pointerY - gazeY) * 0.055;
      const yaw = reduced ? 0.10 : 0.10 + Math.sin(t * 0.36) * 0.055 + gazeX * 0.18;
      const pitch = reduced ? 0 : Math.sin(t * 0.28) * 0.025 + gazeY * 0.07;
      const bob = reduced ? 0 : Math.sin(t * 1.15) * (mode === "listening" ? 0.008 : 0.015);
      const size = Math.min(width * 0.38, height * 0.34);
      const originX = width / 2;
      const originY = height * 0.425;
      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);
      const project = ({ x, y, z }: Point): ProjectedPoint => {
        const rx = x * cosYaw + z * sinYaw;
        const rz = z * cosYaw - x * sinYaw;
        const ry = y * cosPitch - rz * sinPitch + bob;
        const depth = rz * cosPitch + y * sinPitch;
        const perspective = 3.8 / (3.8 - depth);
        return { x: originX + rx * size * perspective, y: originY + ry * size * perspective, depth };
      };

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const gold = mode === "thinking";
      const primary = gold
        ? (accent === "amber" ? "247, 230, 193" : "218, 181, 107")
        : accent === "violet" ? "184, 185, 255" : accent === "amber" ? "239, 196, 134" : "105, 224, 237";
      const surface = gold
        ? (accent === "amber" ? [52, 49, 40, 90, 82, 70] : [24, 27, 24, 77, 63, 39])
        : accent === "violet" ? [25, 30, 58, 64, 62, 95]
          : accent === "amber" ? [35, 30, 23, 86, 60, 36] : [8, 31, 45, 18, 86, 91];
      const glow = ctx.createRadialGradient(originX, originY, 0, originX, originY, height * 0.57);
      glow.addColorStop(0, `rgba(${primary}, ${speaking ? 0.095 + amplitude * 0.055 : 0.065})`);
      glow.addColorStop(0.68, `rgba(${primary}, 0.018)`);
      glow.addColorStop(1, `rgba(${primary}, 0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // Quiet measurement arcs frame the portrait without competing with it.
      const radius = Math.min(width * 0.30, height * 0.37);
      ctx.lineWidth = 0.65;
      ctx.strokeStyle = `rgba(${primary}, 0.14)`;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        const start = side === 1 ? -0.82 : Math.PI - 0.82;
        ctx.arc(originX, height * 0.40, radius, start, start + 1.64);
        ctx.stroke();
      }
      for (let tick = 0; tick < 48; tick++) {
        const angle = tick * Math.PI / 24;
        const outer = radius + (tick % 4 === 0 ? 7 : 3);
        ctx.beginPath();
        ctx.moveTo(originX + Math.cos(angle) * (radius + 1), height * 0.40 + Math.sin(angle) * (radius + 1));
        ctx.lineTo(originX + Math.cos(angle) * outer, height * 0.40 + Math.sin(angle) * outer);
        ctx.strokeStyle = `rgba(${primary}, ${tick % 4 === 0 ? 0.24 : 0.10})`;
        ctx.stroke();
      }

      const floorY = height * 0.86;
      const floorRadius = Math.min(width * 0.31, height * 0.37);
      const beam = ctx.createLinearGradient(0, floorY - height * 0.46, 0, floorY);
      beam.addColorStop(0, `rgba(${primary}, 0)`);
      beam.addColorStop(1, `rgba(${primary}, 0.045)`);
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(originX - floorRadius * 0.68, floorY);
      ctx.lineTo(originX - floorRadius * 0.45, height * 0.28);
      ctx.lineTo(originX + floorRadius * 0.45, height * 0.28);
      ctx.lineTo(originX + floorRadius * 0.68, floorY);
      ctx.fill();
      for (let ring = 0; ring < 3; ring++) {
        ctx.beginPath();
        ctx.ellipse(originX, floorY, floorRadius * (1 - ring * 0.20), height * (0.060 - ring * 0.013), 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${primary}, ${0.30 - ring * 0.075})`;
        ctx.lineWidth = ring === 0 ? 1 : 0.6;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(originX, floorY, floorRadius, height * 0.060, 0, t * 0.38, t * 0.38 + 0.70);
      ctx.strokeStyle = `rgba(${primary}, 0.85)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (mode === "listening") {
        const pulse = reduced ? 0.5 : (Math.sin(t * 1.8) + 1) / 2;
        ctx.beginPath();
        ctx.ellipse(originX, floorY, floorRadius * (1.06 + pulse * 0.07), height * (0.065 + pulse * 0.004), 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${primary}, ${0.38 - pulse * 0.16})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const projected = mesh.points.map(project);
      // Lit translucent facets give the portrait volume instead of a flat,
      // see-through lattice. Back-facing polygons are omitted entirely.
      mesh.faces.sort((a, b) => a.vertices.reduce((sum, index) => sum + projected[index].depth, 0)
        - b.vertices.reduce((sum, index) => sum + projected[index].depth, 0));
      for (const face of mesh.faces) {
        const { normal } = face;
        const nx = normal.x * cosYaw + normal.z * sinYaw;
        const rotatedZ = normal.z * cosYaw - normal.x * sinYaw;
        const ny = normal.y * cosPitch - rotatedZ * sinPitch;
        const nz = rotatedZ * cosPitch + normal.y * sinPitch;
        if (nz < 0.025) continue;
        const light = Math.max(0, nx * -0.38 + ny * -0.40 + nz * 0.83);
        const [a, b, c] = face.vertices.map(index => projected[index]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
        ctx.fillStyle = `rgba(${Math.round(surface[0] + light * surface[3])}, ${Math.round(surface[1] + light * surface[4])}, ${Math.round(surface[2] + light * surface[5])}, 0.91)`;
        ctx.fill();
      }
      ctx.lineWidth = 0.65;
      // Draw the far side first; restrained transparency preserves facial depth.
      for (const front of [false, true]) {
        ctx.beginPath();
        for (const [from, to] of mesh.edges) {
          const a = projected[from];
          const b = projected[to];
          if ((a.depth + b.depth > 0.12) !== front) continue;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.strokeStyle = `rgba(${primary}, ${front ? 0.12 + amplitude * 0.08 : 0.012})`;
        ctx.stroke();
      }
      for (let index = 0; index < projected.length; index++) {
        const point = projected[index];
        if (point.depth < 0.03 || index % (lowPower ? 3 : 2) !== 0) continue;
        const shimmer = reduced ? 0.5 : (Math.sin(index * 1.7 + t * 0.7) + 1) / 2;
        ctx.fillStyle = `rgba(${primary}, ${0.16 + shimmer * 0.35})`;
        ctx.fillRect(point.x, point.y, shimmer > 0.92 ? 1.6 : 1, shimmer > 0.92 ? 1.6 : 1);
      }

      const path = (points: Point[], color: string, lineWidth = 1) => {
        ctx.beginPath();
        points.forEach((point, index) => {
          const p = project(point);
          if (index === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = color;
        ctx.stroke();
      };
      // Eye contours, light pupils and brows make the mesh read as a face.
      const blinkTime = t % 6.7;
      const eyeOpen = !reduced && blinkTime > 6.50 ? Math.abs(blinkTime - 6.60) * 10 : 1;
      for (const side of [-1, 1]) {
        const eyeX = side * 0.205;
        const socket = project({ x: eyeX, y: -0.35, z: 0.398 });
        ctx.beginPath();
        ctx.ellipse(socket.x, socket.y, size * 0.10, Math.max(0.5, size * 0.038 * eyeOpen), side * -0.07, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(2, 16, 25, 0.88)";
        ctx.fill();
        path([
          { x: eyeX - 0.095, y: -0.35, z: 0.375 },
          { x: eyeX, y: -0.35 - 0.033 * eyeOpen, z: 0.398 },
          { x: eyeX + 0.095, y: -0.35, z: 0.375 },
          { x: eyeX, y: -0.35 + 0.024 * eyeOpen, z: 0.398 },
          { x: eyeX - 0.095, y: -0.35, z: 0.375 },
        ], `rgba(${primary}, 0.90)`, 1.15);
        if (eyeOpen > 0.25) {
          const pupil = project({ x: eyeX + (reduced ? 0 : gazeX * 0.02), y: -0.35, z: 0.405 });
          ctx.shadowColor = gold ? "#e9c483" : accent === "violet" ? "#b8b9ff" : accent === "amber" ? "#efc486" : "#76f2f3";
          ctx.shadowBlur = lowPower ? 0 : 9;
          ctx.fillStyle = accent === "violet" && !gold ? "rgba(223, 235, 255, 0.95)" : `rgba(${primary}, 0.90)`;
          ctx.beginPath();
          ctx.ellipse(pupil.x, pupil.y, Math.max(1, size * 0.026), Math.max(0.5, size * 0.029 * eyeOpen), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "rgba(230, 255, 255, 0.96)";
          ctx.beginPath();
          ctx.ellipse(pupil.x - size * 0.005, pupil.y - size * 0.007, Math.max(0.6, size * 0.009), Math.max(0.5, size * 0.013 * eyeOpen), 0, 0, Math.PI * 2);
          ctx.fill();
        }
        path([
          { x: eyeX - 0.105, y: -0.455, z: 0.385 },
          { x: eyeX, y: -0.48, z: 0.405 },
          { x: eyeX + 0.105, y: -0.455, z: 0.385 },
        ], `rgba(${primary}, 0.52)`, 0.9);
        // Temple accents and cheek contours reinforce the silhouette.
        path([{ x: side * 0.44, y: -0.49, z: 0.19 }, { x: side * 0.46, y: -0.22, z: 0.19 },
          { x: side * 0.39, y: -0.02, z: 0.25 }, { x: side * 0.28, y: 0.10, z: 0.30 }],
        `rgba(${primary}, 0.36)`, 1);
        path([{ x: side * 0.33, y: 0.23, z: 0.15 }, { x: side * 0.21, y: 0.41, z: 0.19 },
          { x: side * 0.075, y: 0.49, z: 0.20 }], `rgba(${primary}, 0.48)`, 1.1);
      }
      path([{ x: -0.055, y: 0.015, z: 0.50 }, { x: 0, y: 0.055, z: 0.555 },
        { x: 0.055, y: 0.015, z: 0.50 }], `rgba(${primary}, 0.63)`, 0.8);
      const mouthOpen = amplitude * 0.085;
      path([{ x: -0.135, y: 0.245, z: 0.31 }, { x: -0.045, y: 0.232 - mouthOpen * 0.2, z: 0.355 },
        { x: 0, y: 0.242 - mouthOpen * 0.2, z: 0.365 }, { x: 0.045, y: 0.232 - mouthOpen * 0.2, z: 0.355 },
        { x: 0.135, y: 0.245, z: 0.31 }], `rgba(${primary}, 0.75)`, 1);
      path([{ x: -0.135, y: 0.245, z: 0.31 }, { x: 0, y: 0.272 + mouthOpen, z: 0.355 },
        { x: 0.135, y: 0.245, z: 0.31 }], `rgba(${primary}, 0.55)`, 0.8);

      // A narrow scan accent communicates analysis; audio bars use real samples.
      if (mode === "thinking" && !reduced) {
        const scanY = originY + Math.sin(t * 0.90) * size * 0.75;
        const scan = ctx.createLinearGradient(originX - size * 0.62, 0, originX + size * 0.62, 0);
        scan.addColorStop(0, `rgba(${primary}, 0)`);
        scan.addColorStop(0.5, `rgba(${primary}, 0.64)`);
        scan.addColorStop(1, `rgba(${primary}, 0)`);
        ctx.fillStyle = scan;
        ctx.fillRect(originX - size * 0.62, scanY, size * 1.24, 1);
      }
      if (speaking) {
        const barWidth = compact ? 2 : 3;
        const gap = compact ? 4 : 5;
        for (let bar = 0; bar < 17; bar++) {
          const envelope = Math.sin((bar + 1) * Math.PI / 18);
          const barHeight = 2 + amplitude * envelope * height * 0.055;
          ctx.fillStyle = `rgba(${primary}, ${0.38 + envelope * 0.37})`;
          ctx.fillRect(originX + (bar - 8) * gap - barWidth / 2, height * 0.965 - barHeight / 2, barWidth, barHeight);
        }
      }
    }

    function tick(now: number) {
      frame = 0;
      if (disposed || document.hidden || !inView) return;
      if (reduced || now - lastFrame >= (lowPower ? 1000 / 18 : 1000 / 30)) {
        render(now);
        lastFrame = now;
      }
      if (!reduced) frame = window.requestAnimationFrame(tick);
    }
    function invalidate() {
      lastFrame = 0;
      if (!disposed && !frame && !document.hidden && inView) frame = window.requestAnimationFrame(tick);
    }
    function pause() {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
    function resize() {
      if (!canvas || !stage) return;
      const bounds = stage.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      const nextSparse = lowPower || width < 360 || height < 240;
      if (nextSparse !== sparse) {
        sparse = nextSparse;
        mesh = makeMesh(sparse);
      }
      ratio = Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 1.75);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      invalidate();
    }
    function visibility() {
      if (document.hidden) pause();
      else invalidate();
    }
    function motionChanged() {
      reduced = motion.matches;
      pause();
      invalidate();
    }
    function pointerMoved(event: PointerEvent) {
      if (reduced || event.pointerType === "touch" || !stage) return;
      const bounds = stage.getBoundingClientRect();
      pointerX = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
      pointerY = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
    }
    function pointerLeft() { pointerX = 0; pointerY = 0; }

    const unsubscribe = subscribeLevel((value) => {
      level = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    });
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(stage);
    const intersectionObserver = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (inView) invalidate();
      else pause();
    }, { threshold: 0.01 }) : null;
    intersectionObserver?.observe(stage);
    const profileObserver = new MutationObserver(() => {
      const next = document.documentElement.classList.contains("low-power");
      if (next === lowPower) return;
      lowPower = next;
      resize();
    });
    profileObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("resize", resize);
    motion.addEventListener("change", motionChanged);
    stage.addEventListener("pointermove", pointerMoved);
    stage.addEventListener("pointerleave", pointerLeft);
    redrawRef.current = invalidate;
    resize();

    return () => {
      disposed = true;
      pause();
      unsubscribe();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      profileObserver.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("resize", resize);
      motion.removeEventListener("change", motionChanged);
      stage.removeEventListener("pointermove", pointerMoved);
      stage.removeEventListener("pointerleave", pointerLeft);
      redrawRef.current = () => {};
    };
  }, [compact, accent]);

  const status = label || STATUS[state];
  const portrait = <>
    <div className="hologram__stage" ref={stageRef} aria-hidden="true">
      <div className="hologram__eyebrow"><span>J / AVATAR</span><span className="hologram__mode"><i />{MODE[state]}</span></div>
      <canvas className="hologram__canvas" ref={canvasRef} />
      <div className="hologram__coordinate hologram__coordinate--left">AI<br /><span>INTERFEJS<br />GŁOSOWY</span></div>
      <div className="hologram__coordinate hologram__coordinate--right"><span>JARVIS</span><br />PRO</div>
      <span className="hologram__corner hologram__corner--tl" /><span className="hologram__corner hologram__corner--tr" />
      <span className="hologram__corner hologram__corner--bl" /><span className="hologram__corner hologram__corner--br" />
    </div>
    <span className="hologram__status" role="status" aria-live="polite"><span className="hologram__status-dot" />{status}</span>
  </>;

  return onActivate ? (
    <button type="button" className={`hologram hologram--accent-${accent} hologram--${state}${compact ? " hologram--compact" : ""} hologram--interactive`}
      onClick={onActivate} aria-label={`${actionLabel}. ${status}`}>
      {portrait}
    </button>
  ) : (
    <div className={`hologram hologram--accent-${accent} hologram--${state}${compact ? " hologram--compact" : ""}`}>{portrait}</div>
  );
}
