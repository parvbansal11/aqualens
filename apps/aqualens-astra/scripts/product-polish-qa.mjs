/* Product surfaces only. Uses bundled illustrative surveys; never calls a backend. */
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";
import process from "node:process";

const base = process.env.QA_BASE_URL ?? "http://127.0.0.1:4173";
const output = "qa/product-polish";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = { screens: [], errors: [], accessibility: [], interactions: [] };
const forbidden =
  /smart india hackathon|\bsih\b|seamantics|\bprototype\b|hackathon|built for india.s ocean science/i;
const routes = [
  ["landing", "/"],
  ["intake", "/intake"],
  ["roles", "/roles"],
  ["workspace", "/workspace"],
  ["upload", "/workspace/upload"],
  ["processing", "/intake/processing?preview=1"],
  ["contacts", "/workspace/results"],
  ["contact", "/workspace/contact/CT-01"],
  ["map", "/workspace/map"],
  ["review", "/workspace/review"],
  ["review-desk", "/workspace/review/CT-01"],
  ["report", "/workspace/report"],
  ["memory", "/workspace/memory"],
  ["model-lab", "/workspace/model-lab"],
  ["change", "/workspace/change"],
];

async function capture(page, name, width, height, theme) {
  await page.evaluate(() => document.fonts.ready);
  const surface = await page.evaluate(() => ({
    text: document.body.innerText,
    metadata: [
      document.title,
      ...Array.from(document.querySelectorAll("meta"), (e) => e.content),
      ...Array.from(
        document.querySelectorAll("[alt], [title], [aria-label]"),
        (e) =>
          `${e.getAttribute("alt")} ${e.getAttribute("title")} ${e.getAttribute("aria-label")}`,
      ),
    ].join(" "),
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    brokenImages: Array.from(document.images)
      .filter((img) => img.complete && img.naturalWidth === 0)
      .map((img) => img.src),
    overlay: !!document.querySelector("vite-error-overlay"),
  }));
  expect(surface.text, `${name}: visible branding`).not.toMatch(forbidden);
  expect(surface.metadata, `${name}: metadata branding`).not.toMatch(forbidden);
  expect(surface.overflow, `${name}: ${width} ${theme} overflow`).toBe(false);
  expect(surface.brokenImages, `${name}: broken images`).toEqual([]);
  expect(surface.overlay).toBe(false);
  report.screens.push({
    name,
    width,
    height,
    theme,
    overflow: false,
    forbiddenBranding: false,
    brokenImages: [],
  });
  await page.screenshot({
    path: `${output}/${name}-${theme}-${width}.png`,
    fullPage: name === "landing",
  });
}

try {
  for (const [width, height] of [
    [1920, 1080],
    [1512, 982],
    [1440, 900],
    [1180, 820],
    [860, 900],
  ]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      await context.addInitScript((theme) => {
        sessionStorage.setItem("astra.role", "analyst");
        sessionStorage.setItem("astra.survey", "epitomeNavigated");
        sessionStorage.setItem("astra.theme", theme);
      }, theme);
      const page = await context.newPage();
      page.on("pageerror", (error) =>
        report.errors.push({ width, theme, error: error.message }),
      );
      page.on("console", (message) => {
        if (message.type() === "error")
          report.errors.push({ width, theme, error: message.text() });
      });
      for (const [name, path] of routes) {
        await page.goto(base + path);
        await page.locator("main:not(.app-loading)").waitFor();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (name === "landing") {
          await page.locator(".launch-section").scrollIntoViewIfNeeded();
          await page.locator(".landing-map-frame .leaflet-container").waitFor();
          await page.evaluate(() => window.scrollTo(0, 0));
        }
        if (name === "intake")
          await page.locator(".presentation-choices > summary").click();
        if (name === "upload")
          await page
            .getByLabel("Choose sonar survey file")
            .setInputFiles("tests/fixtures/intake.zip");
        if (name === "report")
          await page
            .getByText("Provenance & scientific limitations", { exact: true })
            .click();
        if (name === "model-lab")
          await page.getByText("Frozen evaluation", { exact: true }).click();
        if (name === "map") {
          await page.locator(".map-contact-row").first().click();
          await expect(page.locator(".contact-popup")).toBeVisible();
        }
        await capture(page, name, width, height, theme);
        if (name === "contact") {
          await page
            .getByRole("button", { name: "Inspect evidence", exact: true })
            .click();
          await page
            .locator(".evidence-channel > summary")
            .evaluateAll((nodes) => nodes.forEach((e) => e.click()));
          await capture(page, "evidence-drawer", width, height, theme);
          const drawer = await page.getByRole("dialog").boundingBox();
          expect(drawer.x).toBeGreaterThanOrEqual(0);
          expect(drawer.x + drawer.width).toBeLessThanOrEqual(width);
          await page.keyboard.press("Escape");
        }
        if (name === "workspace") {
          const menu = page.getByRole("button", { name: "More", exact: true });
          await menu.click();
          await page
            .locator(".workspace-header .wordmark")
            .click({ trial: true });
          await capture(page, "navigation-menu", width, height, theme);
          await page.keyboard.press("Escape");
          await expect(menu).toBeFocused();
          await expect(page.locator(".nav-dropdown")).toHaveCount(0);
          await menu.click();
          await page.locator("h1").click();
          await expect(page.locator(".nav-dropdown")).toHaveCount(0);
        }
        if (name === "map") {
          await page
            .getByRole("button", { name: "Map layers", exact: true })
            .click();
          await capture(page, "map-layers", width, height, theme);
          await page.getByRole("button", { name: "Close map layers" }).click();
        }
        if (
          width === 1440 &&
          [
            "landing",
            "intake",
            "roles",
            "workspace",
            "contacts",
            "contact",
            "review-desk",
            "report",
            "model-lab",
          ].includes(name)
        ) {
          const audit = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze();
          report.accessibility.push({
            name,
            theme,
            violations: audit.violations,
          });
          expect(audit.violations, `${name} ${theme}: accessibility`).toEqual(
            [],
          );
        }
      }
      await context.close();
      console.log(`Verified ${width}×${height} ${theme}`);
      await fs.writeFile(
        `${output}/report.json`,
        JSON.stringify(report, null, 2),
      );
    }
  }
  const page = await browser.newPage({
    viewport: { width: 860, height: 900 },
    reducedMotion: "no-preference",
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("astra.role", "analyst");
    sessionStorage.setItem("astra.survey", "epitomeNavigated");
  });
  await page.goto(base + "/roles");
  const role = page.getByRole("button", { name: /Mission Supervisor/ });
  await role.click();
  await expect(role).toHaveAttribute("aria-pressed", "true");
  expect(
    await role.evaluate((e) => window.getComputedStyle(e).transitionDuration),
  ).toContain("0.18s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await role.evaluate((e) => window.getComputedStyle(e).transitionDuration),
  ).toBe("0s");
  report.interactions.push("Role selection and reduced motion verified");
  await page.goto(base + "/workspace/contact/CT-01");
  expect(
    await page
      .locator(".workspace-header")
      .evaluate((e) => window.getComputedStyle(e).backdropFilter),
  ).toContain("blur");
  expect(
    await page
      .locator(".sonar-viewer")
      .evaluate((e) => window.getComputedStyle(e).backdropFilter),
  ).toBe("none");
  report.interactions.push("Glass chrome and solid sonar surface verified");
  await page.close();
  expect(report.errors).toEqual([]);
} finally {
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(
  `PASS: ${report.screens.length} surfaces, ${report.accessibility.length} accessibility audits, no overflow or forbidden branding.`,
);
