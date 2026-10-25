import { defineConfig } from "vitest/config";

// Browser tests (real Chromium via Playwright against local fixtures). Run: npm run test:browser
export default defineConfig({
  define: { __DEFAULT_KEYS__: "{}" },
  test: {
    environment: "node",
    include: ["tests/browser/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
