import { test, expect } from "@playwright/test";

const baselineDir = "tests/visual/baseline";

async function screenshot(page, name) {
  await page.screenshot({ path: `${baselineDir}/${name}.png`, fullPage: true });
}

test("records the frozen desktop product and interaction surface", async ({ page }) => {
  await page.addInitScript(() => {
    window.HERMES_CONFIG = { mode: "runtime", baseUrl: "http://127.0.0.1:8642" };
    window.localStorage.setItem(
      "hermes-agent-os:connection-v5",
      JSON.stringify({
        configured: true,
        mode: "runtime",
        baseUrl: "http://127.0.0.1:8642",
        apiKey: "",
        pollMs: 5000,
        pruneEmpty: false,
      }),
    );
  });
  const seenRequests = [];
  const liveSession = {
    id: "session-live-1",
    title: "Live Hermes verification",
    status: "running",
    updated_at: "2026-08-23T04:00:00.000Z",
    created_at: "2026-08-23T03:55:00.000Z",
    messages: [{ role: "user", content: "Verify Agent OS live transition" }],
  };

  await page.route("**/hermes-proxy/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    seenRequests.push(`${request.method()} ${url.pathname}${url.search}`);
    const path = url.pathname.replace(/^\/hermes-proxy/, "") || "/";

    if (path === "/health" || path === "/health/detailed") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
      return;
    }
    if (path === "/v1/capabilities") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ capabilities: ["sessions", "runs", "approvals"] }),
      });
      return;
    }
    if (path.startsWith("/api/sessions")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sessions: [liveSession] }) });
      return;
    }
    if (path === "/v1/skills" || path === "/v1/toolsets") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "unsupported" }) });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Demo campus", { exact: false })).toBeVisible();
  await screenshot(page, "demo-overview-1440x900");

  const floor = page.locator("#building [data-floor-id]").nth(1);
  await floor.locator(".floor-window").click();
  await expect(page.locator("#floor-title")).not.toHaveText("No module selected");
  await screenshot(page, "floor-selected-1440x900");

  const agent = floor.locator("[data-agent-id]").first();
  await agent.click();
  await expect(page.getByRole("heading", { name: "Agent Details" })).toBeVisible();
  await screenshot(page, "agent-details-1440x900");

  const viewport = page.locator("#building-viewport");
  const transformBeforeZoom = await page.locator("#building-world").evaluate((node) => node.style.transform);
  await viewport.hover();
  await page.mouse.wheel(0, -240);
  await expect.poll(() => page.locator("#building-world").evaluate((node) => node.style.transform)).not.toBe(transformBeforeZoom);

  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  const transformBeforePan = await page.locator("#building-world").evaluate((node) => node.style.transform);
  const start = { x: box.x + 32, y: box.y + box.height * 0.5 };
  const end = { x: start.x + 120, y: start.y + 70 };
  await viewport.dispatchEvent("pointerdown", { pointerId: 1, clientX: start.x, clientY: start.y });
  await viewport.dispatchEvent("pointermove", { pointerId: 1, clientX: end.x, clientY: end.y });
  await viewport.dispatchEvent("pointerup", { pointerId: 1, clientX: end.x, clientY: end.y });
  await expect.poll(() => page.locator("#building-world").evaluate((node) => node.style.transform)).not.toBe(transformBeforePan);
  await screenshot(page, "pan-zoom-1440x900");

  await page.locator("#dispatch-task-button").click();
  await expect(page.getByRole("heading", { name: "Dispatch Task" })).toBeVisible();
  await page.locator("#dispatch-task").fill("Record the frozen local product behavior");
  await page.locator("#dispatch-module").fill("Engineering");
  await screenshot(page, "dispatch-task-1440x900");
  await page.getByRole("button", { name: "Dispatch", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agent Details" })).toBeVisible();

  for (const section of ["Agents", "Tasks", "Approvals", "Analytics", "Settings"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    await expect(page.getByRole("heading", { name: section })).toBeVisible();
    await screenshot(page, `section-${section.toLowerCase()}-1440x900`);
  }

  await page.getByRole("button", { name: "Configure" }).click();
  await page.evaluate(() => {
    window.HERMES_CONFIG = { mode: "live", baseUrl: "http://127.0.0.1:8642" };
  });
  await page.getByText("Live Hermes", { exact: true }).click();
  await page.locator("#hermes-url").fill("http://127.0.0.1:8642");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.locator("#connection-pill")).toContainText("Hermes live", { timeout: 10_000 });
  await expect(page.getByText("Live Hermes verification", { exact: false }).first()).toBeVisible();
  await screenshot(page, "live-transition-1440x900");
  expect(seenRequests.some((request) => request.includes("GET /hermes-proxy/api/sessions"))).toBeTruthy();
});
