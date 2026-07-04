import { defineConfig } from "vitest/config";

export default defineConfig({
  // __DEFAULT_KEYS__ jest wstrzykiwany przy buildzie (vite.config) — w testach pusty.
  define: { __DEFAULT_KEYS__: "{}" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
