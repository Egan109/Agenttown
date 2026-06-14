import { defineConfig, devices } from "@playwright/test";

// UI smoke/visual checks for AgentTown. These boot the real Vite dev server in a
// real Chromium so they catch layout bugs (clipping, overflow) that jsdom can't,
// and they save screenshots into test-results/ so the rendered screen is visible.
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1600, height: 900 },
    // Capture a screenshot on failure too, for debugging.
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
