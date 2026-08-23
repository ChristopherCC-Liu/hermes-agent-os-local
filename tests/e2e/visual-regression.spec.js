import { test, expect } from "@playwright/test";

test("@visual frozen Demo product surfaces remain visually equivalent", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("hermes-agent-os:connection-v6", JSON.stringify({
      configured: true,
      mode: "runtime",
      baseUrl: "http://127.0.0.1:18642",
      apiKeyConfigured: false,
      pollMs: 10_000,
      pruneEmpty: true,
    }));
    window.localStorage.removeItem("hermes-agent-os:org-live-v5");
  });
  await page.goto("/");
  await expect(page.locator("#connection-pill")).toContainText("Demo org");
  await expect(page).toHaveScreenshot("demo-overview-1440x900.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.03,
  });

  const floor = page.locator("#building [data-floor-id]").nth(1);
  await floor.locator(".floor-window").click();
  await expect(page).toHaveScreenshot("floor-selected-1440x900.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.03,
  });
  await floor.locator("[data-agent-id]").first().click();
  await expect(page.getByRole("heading", { name: "Agent Details" })).toBeVisible();
  await expect(page).toHaveScreenshot("agent-details-1440x900.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.03,
  });

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
  await expect(page).toHaveScreenshot("pan-zoom-1440x900.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.03,
  });

  await page.locator("#dispatch-task-button").click();
  await page.locator("#dispatch-task").fill("Record the frozen local product behavior");
  await page.locator("#dispatch-module").fill("Engineering");
  await expect(page).toHaveScreenshot("dispatch-task-1440x900.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.03,
  });
  // Keep the simulated run in its frozen running state while the section
  // screenshots execute; the product completes this Demo timer after 650ms.
  await page.clock.install();
  const clockNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(clockNow + 1_000);
  await page.getByRole("button", { name: "Dispatch", exact: true }).click();

  for (const section of ["Agents", "Tasks", "Approvals", "Analytics", "Settings"]) {
    if (section === "Analytics") await page.clock.fastForward(650);
    await page.getByRole("button", { name: section, exact: true }).click();
    await expect(page.getByRole("heading", { name: section })).toBeVisible();
    await expect(page).toHaveScreenshot(`section-${section.toLowerCase()}-1440x900.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.03,
    });
  }
});
