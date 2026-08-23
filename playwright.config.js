import { defineConfig } from "@playwright/test";

const fakePort = 18642;
const appPort = 4180;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "*.spec.js",
  testIgnore: "baseline-record.spec.js",
  snapshotPathTemplate: "tests/visual/baseline/{arg}{ext}",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["line"]],
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `FAKE_HERMES_PORT=${fakePort} node tests/fixtures/fake-hermes-server.mjs`,
      url: `http://127.0.0.1:${fakePort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `PORT=${appPort} HERMES_API_URL=http://127.0.0.1:${fakePort} HERMES_API_KEY=fixture-hermes-key HERMES_AGENT_OS_CONFIG_PATH=test-results/e2e-config.json node server/index.mjs --dev`,
      url: `http://127.0.0.1:${appPort}/api/os/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
