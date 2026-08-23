import { test, expect } from "@playwright/test";
import assert from "node:assert/strict";

function connection(mode) {
  return {
    configured: true,
    mode,
    baseUrl: mode === "live" ? "http://127.0.0.1:18643" : "http://127.0.0.1:18642",
    apiKeyConfigured: mode === "live",
    backendManaged: true,
    pollMs: 10_000,
    pruneEmpty: true,
  };
}

async function setMode(page, mode) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("hermes-agent-os:connection-v6", JSON.stringify(value));
    window.localStorage.removeItem("hermes-agent-os:connection-v5");
    window.localStorage.removeItem("hermes-agent-os:org-live-v5");
  }, connection(mode));
}

test("Demo stays local and keeps the frozen interaction model", async ({ page }) => {
  await setMode(page, "runtime");
  const osRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/os/")) osRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator("#connection-pill")).toContainText("Demo org");
  await expect(page.getByText("Demo campus", { exact: false })).toBeVisible();
  await page.locator("#dispatch-task-button").click();
  await page.locator("#dispatch-task").fill("Local demo verification");
  await page.locator("#dispatch-module").fill("Engineering");
  await page.getByRole("button", { name: "Dispatch", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agent Details" })).toBeVisible();
  await expect(page.getByText("No API usage.", { exact: false })).toBeVisible();
  expect(osRequests).toEqual([]);
});

test("Live mode uses official sessions, preserves selection, dispatches runs, approves, and stops", async ({ page }) => {
  await setMode(page, "live");
  const osRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/os/")) {
      osRequests.push({ method: request.method(), pathname: url.pathname });
    }
  });
  await page.goto("/");
  await expect(page.locator("#connection-pill")).toContainText("Hermes live", { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => JSON.parse(
    window.localStorage.getItem("hermes-agent-os:connection-v6") || "{}",
  ).baseUrl)).toBe("http://127.0.0.1:18642");
  await expect.poll(() => osRequests.filter((request) => request.pathname === "/api/os/snapshot").length).toBe(1);
  assert.equal(osRequests.filter((request) => request.method === "POST" && request.pathname === "/api/os/config").length, 0);
  const healthIndex = osRequests.findIndex((request) => request.method === "GET" && request.pathname === "/api/os/health");
  const snapshotIndex = osRequests.findIndex((request) => request.method === "GET" && request.pathname === "/api/os/snapshot");
  assert.ok(healthIndex >= 0);
  assert.ok(snapshotIndex >= 0);
  assert.ok(healthIndex < snapshotIndex);
  await expect.poll(() => page.evaluate(() => window.hermesDashboard.getState().floors
    .flatMap((floor) => floor.agents)
    .some((agent) => agent.sessionId === "session-2"))).toBe(true);
  await expect(page.locator(".demo-chip")).toBeHidden();

  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await page.locator('[data-jump-agent="hermes-session-2"]').click();
  await expect(page.getByRole("heading", { name: "Agent Details" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.hermesDashboard.getState().selectedAgentId)).toBe("hermes-session-2");
  await page.evaluate(() => window.dispatchEvent(new Event("hermes-agent-os:refresh")));
  await page.evaluate(() => window.dispatchEvent(new Event("hermes-agent-os:refresh")));
  await expect.poll(() => page.evaluate(() => window.hermesDashboard.getState().selectedAgentId)).toBe("hermes-session-2");
  await expect.poll(() => page.evaluate(() => window.hermesDashboard.getState().detailsOpen)).toBe(true);

  await page.locator("#dispatch-task-button").click();
  await page.locator("#dispatch-task").fill("approval lifecycle task");
  await page.locator("#dispatch-module").fill("API Server");
  await page.getByRole("button", { name: "Dispatch", exact: true }).click();
  await expect(page.getByText("Hermes run started", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Approvals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  const resolve = page.getByRole("button", { name: "Resolve" }).first();
  await expect(resolve).toBeVisible({ timeout: 15_000 });
  await resolve.click();
  await expect(page.getByText("Approved in Hermes", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.locator("#dispatch-task-button").click();
  await page.locator("#dispatch-task").fill("stop lifecycle task");
  await page.locator("#dispatch-module").fill("API Server");
  await page.getByRole("button", { name: "Dispatch", exact: true }).click();
  await expect(page.getByText("Hermes run started", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  const stopAgent = page.getByRole("button", { name: /stop lifecycle task/i });
  await expect(stopAgent).toBeVisible({ timeout: 15_000 });
  await stopAgent.click();
  await expect(page.getByRole("heading", { name: "Agent Details" })).toBeVisible();
  await page.locator('[data-action="run-task"]').click();
  await expect(page.getByText("Stop requested", { exact: true })).toBeVisible();

  const browserStorage = await page.evaluate(() => JSON.stringify(window.localStorage));
  expect(browserStorage).not.toContain("fixture-hermes-key");
});

test("blocked BFF state never presents itself as Hermes live", async ({ page }) => {
  await setMode(page, "live");
  await page.route("**/api/os/snapshot", (route) => route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "BLOCKED_WRONG_SERVICE", message: "Wrong Hermes service" } }),
  }));
  await page.goto("/");
  await expect(page.locator("#connection-pill")).toContainText("Offline");
  await expect(page.locator("#connection-pill")).not.toContainText("Hermes live");
  await expect(page.locator("#building [data-floor-id]")).toHaveCount(0);
});
