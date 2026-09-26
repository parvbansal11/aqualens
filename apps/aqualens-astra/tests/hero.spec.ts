import { expect, test } from "@playwright/test";

test("proximity activates the instrument and resets on exit and resize", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const instrument = page.locator(".hero-instrument");
  const bounds = await instrument.boundingBox();
  if (!bounds) throw new Error("Missing hero instrument");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 90);
  await expect
    .poll(() =>
      instrument.evaluate((el) =>
        Number((el as HTMLElement).style.getPropertyValue("--energy")),
      ),
    )
    .toBeCloseTo(0.5, 1);
  await expect(instrument).toHaveAttribute("data-active", "false");
  await page.getByRole("heading", { name: "Aqualens", exact: true }).hover();
  await expect(instrument).toHaveAttribute("data-active", "true");
  await expect(page.locator(".instrument-pulse")).toHaveCSS(
    "animation-name",
    "instrument-pulse",
  );
  await page.mouse.move(0, 0);
  await expect(instrument).toHaveAttribute("data-active", "false");
  await page.getByRole("heading", { name: "Aqualens", exact: true }).hover();
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(instrument).toHaveAttribute("data-active", "false");
});

test("reduced motion keeps static illumination and responds to preference changes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("heading", { name: "Aqualens", exact: true }).hover();
  await expect(page.locator(".instrument-sweep")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.locator(".instrument-pulse")).toHaveCSS("display", "none");
  await expect(page.locator(".wordmark-bloom")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await expect(page.locator(".wordmark-bloom")).toHaveCSS("opacity", "0.4");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.mouse.move(10, 10);
  await page.getByRole("heading", { name: "Aqualens", exact: true }).hover();
  await expect(page.locator(".hero-instrument")).toHaveAttribute(
    "data-active",
    "true",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".hero-instrument")).toHaveAttribute(
    "data-active",
    "false",
  );
  await expect(page.locator(".instrument-sweep")).toHaveCSS(
    "animation-name",
    "none",
  );
});

test("mobile retains heading and CTA without minor details or overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Aqualens", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".instrument-minor").first()).toHaveCSS(
    "display",
    "none",
  );
  await expect(page.locator(".instrument-annotations")).toHaveCSS(
    "display",
    "none",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Launch Workspace", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/intake$/);
});
