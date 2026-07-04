import { defineConfig } from "@playwright/test";

// Testy e2e = jedyna miara postępu runu (eval.md). Serwer: build produkcyjny przez
// `vite preview` (uczciwość: testujemy to, co dostanie użytkownik, nie dev-server).
// Chromium preinstalowany w środowisku (/opt/pw-browsers) — bez `playwright install`.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  workers: 4,
  reporter: [["list"], ["json", { outputFile: "EVIDENCE/e2e-latest.json" }]],
  use: {
    baseURL: "http://localhost:4317",
    launchOptions: { executablePath: "/opt/pw-browsers/chromium" },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run preview",
    port: 4317,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
