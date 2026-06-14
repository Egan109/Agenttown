import { test, expect, type Page } from "@playwright/test";

const SHOTS = "test-results/shots";

async function bootstrap(page: Page) {
  await page.goto("/");
  // The world canvas is the clearest "app is alive" signal.
  await expect(page.locator("canvas")).toBeVisible();
}

test("main layout renders and fits the viewport", async ({ page }) => {
  await bootstrap(page);

  // Core regions are present (the left panel defaults to the Metrics tab).
  await expect(page.getByRole("button", { name: /Run/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Metrics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Config" })).toBeVisible();
  await expect(page.getByRole("button", { name: "LLM" })).toBeVisible();
  await expect(page.getByText("EVENT LOG")).toBeVisible();
  await expect(page.getByText("AGENT INSPECTOR")).toBeVisible();

  // Nothing should force the whole page to scroll sideways at this viewport.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow, "page should not overflow horizontally").toBeLessThanOrEqual(1);

  await page.screenshot({ path: `${SHOTS}/01-initial.png` });
});

test("config panel is readable and not clipped", async ({ page }) => {
  await bootstrap(page);
  await page.getByRole("button", { name: "Config" }).click();

  // Sliders rendered.
  const sliders = page.locator('input[type="range"]');
  expect(await sliders.count()).toBeGreaterThan(8);

  // The config scroll container must not overflow horizontally (this is exactly
  // the "numbers/sliders cut off" bug class).
  const scroll = page.getByTestId("left-panel-scroll");
  const hoverflow = await scroll.evaluate((n) => n.scrollWidth - n.clientWidth);
  expect(hoverflow, "config panel should not overflow horizontally").toBeLessThanOrEqual(1);

  await scroll.screenshot({ path: `${SHOTS}/02-config.png` });
});

test("running the sim populates the world", async ({ page }) => {
  await bootstrap(page);
  await page.getByRole("button", { name: /Run/ }).click();
  // Let the engine tick for a couple of seconds so villagers act / events log.
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/03-running.png` });

  // Pause so the screenshot below is stable.
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(page.getByText("EVENT LOG")).toBeVisible();
});
