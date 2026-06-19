/** @type {import('tailwindcss').Config} */
// Tailwind ograniczony WYŁĄCZNIE do nowego interfejsu (jarvis-ui):
// - `content` skanuje tylko jarvis-ui,
// - `important: ".neural-root"` → wszystkie utility działają TYLKO wewnątrz .neural-root
//   (zero wpływu na istniejący design system w src/styles/index.css),
// - `preflight: false` → brak globalnego resetu CSS.
export default {
  content: ["./src/components/jarvis-ui/**/*.{ts,tsx}"],
  important: ".neural-root",
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        neural: {
          0: "#09090b",
          1: "#18181b",
          glass: "rgba(24, 24, 27, 0.55)",
          line: "rgba(148, 163, 184, 0.14)",
          cyan: "#22d3ee",
          blue: "#3b82f6",
          green: "#34d399",
          amber: "#fbbf24",
        },
      },
      fontFamily: {
        mono: ["'Share Tech Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(34, 211, 238, 0.5)",
        "glow-strong": "0 0 70px -4px rgba(34, 211, 238, 0.7)",
      },
      keyframes: {
        "neural-grid": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "40px 40px" },
        },
        "scan-line": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
      },
      animation: {
        "neural-grid": "neural-grid 6s linear infinite",
        "scan-line": "scan-line 4s linear infinite",
      },
    },
  },
  plugins: [],
};
