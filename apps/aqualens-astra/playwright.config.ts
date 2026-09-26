import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5273",
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: [
    {
      command: "npm run dev -- --port 5273",
      env: { VITE_API_BASE_URL: "" },
      url: "http://127.0.0.1:5273",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 5274",
      env: {
        VITE_API_BASE_URL: "/api/v1",
        ASTRA_BACKEND_URL: "http://127.0.0.1:9",
      },
      url: "http://127.0.0.1:5274",
      reuseExistingServer: false,
    },
  ],
});
