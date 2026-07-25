import { defineConfig, devices } from "@playwright/test";

const artifactsRoot = "../artifacts/product-reset/playwright";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts"],
  testIgnore: ["**/._*"],
  outputDir: `${artifactsRoot}/results`,
  reporter: [
    ["list"],
    ["html", { outputFolder: `${artifactsRoot}/report`, open: "never" }],
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    deviceScaleFactor: 1,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-1366",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 768 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "chromium-1920",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
