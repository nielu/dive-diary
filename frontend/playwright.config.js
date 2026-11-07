import { defineConfig, devices } from "@playwright/test";

// Run through ../scripts/test.sh, which starts the server first.
export default defineConfig({
  testDir: "e2e",
  workers: 1, // one shared server and database
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL || "http://127.0.0.1:8090",
    ...devices["Pixel 7"],
    trace: "retain-on-failure",
  },
});
