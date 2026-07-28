import { defineConfig, devices } from "@playwright/test";

const artifactsRoot = "../artifacts/product-reset/playwright";

export function resolvePlaywrightPort(value: string | undefined): string {
  if (value === undefined) return "5173";
  if (!/^\d+$/.test(value)) {
    throw new Error("PLAYWRIGHT_PORT должен быть целым числом от 1 до 65535");
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > 65535) {
    throw new Error("PLAYWRIGHT_PORT должен быть целым числом от 1 до 65535");
  }
  return String(parsed);
}

const port = resolvePlaywrightPort(process.env.PLAYWRIGHT_PORT);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts"],
  testIgnore: ["**/._*"],
  outputDir: `${artifactsRoot}/results`,
  reporter: [
    ["list"],
    ["html", { outputFolder: `${artifactsRoot}/report`, open: "never" }],
  ],
  webServer: port === "5173"
    ? {
      command: "npm run dev -- --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 120_000,
    }
    : {
      command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  use: {
    baseURL,
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
