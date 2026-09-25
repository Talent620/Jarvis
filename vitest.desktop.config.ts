import { defineConfig } from "vitest/config";

// Linux desktop adapter tests on a throwaway Xvfb session (tests/desktop). Run: npm run test:desktop
// Needs Xvfb, dbus-x11, openbox, xdotool, xclip, wmctrl, at-spi2-core and python3-gi with GTK 3.
export default defineConfig({
  define: { __DEFAULT_KEYS__: "{}" },
  test: {
    environment: "node",
    include: ["tests/desktop/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
