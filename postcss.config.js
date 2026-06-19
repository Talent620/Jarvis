// PostCSS dla Vite. Tailwind ma wyłączony preflight i jest ograniczony selektorem
// `.neural-root` (tailwind.config.js), więc nie dotyka istniejących stylów aplikacji.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
