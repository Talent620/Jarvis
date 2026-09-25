import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // __DEFAULT_KEYS__ jest wstrzykiwany przy buildzie (vite.config) — w testach pusty.
  define: { __DEFAULT_KEYS__: "{}" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Real-browser tests need Chromium and run separately (npm run test:browser).
    exclude: [...configDefaults.exclude, "tests/browser/**", "tests/desktop/**"],
  },
});
