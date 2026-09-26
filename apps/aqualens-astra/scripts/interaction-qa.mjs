/* Browser-only verification of the production artifact. No backend requests or writes. */
/* global WebGLRenderingContext */
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const base = "http://127.0.0.1:4173";
const report = { errors: [], audits: [], water: {}, assets: [] };
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "no-preference",
});
const page = await context.newPage();
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") report.errors.push(message.text());
});
await page.addInitScript(() => {
  window.waterQA = { frames: 0, strength: 0, peak: 0, clickAge: 0 };
  const names = new WeakMap();
  const proto = WebGLRenderingContext.prototype;
  const locate = proto.getUniformLocation;
  proto.getUniformLocation = function (program, name) {
    const loc = locate.call(this, program, name);
    if (loc) names.set(loc, name);
    return loc;
  };
  const uniform = proto.uniform1f;
  proto.uniform1f = function (loc, value) {
    if (names.get(loc) === "strength") {
      window.waterQA.strength = value;
      window.waterQA.peak = Math.max(window.waterQA.peak, value);
      window.waterQA.frames++;
    }
    if (names.get(loc) === "clickAge") window.waterQA.clickAge = value;
    return uniform.call(this, loc, value);
  };
});
await page.goto(base);
await expect(page.locator(".water-canvas")).toHaveClass(/is-ready/);
await page.mouse.move(1030, 270);
for (let i = 0; i < 30; i++) {
  await page.mouse.move(
    1060 + Math.sin(i / 4) * 200,
    310 + Math.cos(i / 4) * 120,
  );
  await page.waitForTimeout(20);
}
await page.mouse.click(1120, 340);
await page.waitForTimeout(80);
report.water.active = await page.evaluate(() => ({
  ...window.waterQA,
  playing: !document.querySelector("video").paused,
  ready: document.querySelector("video").readyState,
  resolution: [
    document.querySelector("canvas").width,
    document.querySelector("canvas").height,
  ],
}));
expect(report.water.active.peak).toBeGreaterThan(0.1);
expect(report.water.active.clickAge).toBeLessThan(1);
await page.screenshot({ path: "qa/screenshots/landing-water-active.png" });
await page.waitForTimeout(2000);
report.water.afterRest = await page.evaluate(() => ({ ...window.waterQA }));
expect(report.water.afterRest.strength).toBeLessThan(0.01);
await page.evaluate(() =>
  window.scrollTo({ top: window.innerHeight + 40, behavior: "instant" }),
);
await page.waitForTimeout(400);
report.water.pausesOffscreen = await page
  .locator("video")
  .evaluate((v) => v.paused);
expect(report.water.pausesOffscreen).toBe(true);
await page.evaluate(() => window.scrollTo(0, 0));
await page.emulateMedia({ reducedMotion: "reduce" });
await page.waitForTimeout(200);
expect(await page.locator("video").evaluate((v) => v.paused)).toBe(true);
await page.screenshot({ path: "qa/screenshots/landing-reduced-motion.png" });
await page.emulateMedia({ reducedMotion: "no-preference" });
await expect(page.locator(".water-canvas")).toHaveClass(/is-ready/);
report.water.motionPreferenceResumes = true;
await context.close();

const auditContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
const p = await auditContext.newPage();
p.on("pageerror", (error) => report.errors.push(error.message));
p.on("console", (message) => {
  if (message.type() === "error") report.errors.push(message.text());
});
await p.addInitScript(() => {
  sessionStorage.setItem("astra.role", "analyst");
  sessionStorage.setItem("astra.survey", "epitomeNavigated");
  sessionStorage.setItem("astra.theme", "dark");
});
async function audit(name) {
  const a = await new AxeBuilder({ page: p })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  report.audits.push({
    name,
    violations: a.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  });
}
for (const [name, path] of [
  ["landing", "/"],
  ["roles", "/roles"],
  ["home", "/workspace"],
  ["upload", "/workspace/upload"],
  ["processing", "/workspace/processing?preview=1"],
  ["results", "/workspace/results"],
  ["contact", "/workspace/contact/CT-01"],
  ["map", "/workspace/map"],
]) {
  await p.goto(base + path);
  await p.locator("main:not(.app-loading)").waitFor();
  await p.waitForTimeout(name === "map" ? 1400 : 200);
  await audit(name + "-dark");
  if (name === "contact") {
    await p
      .getByRole("button", { name: "Inspect evidence", exact: true })
      .click();
    await p.getByText("Open-set", { exact: true }).click();
    await audit("evidence-drawer-dark");
    await p.keyboard.press("Escape");
    await p.getByRole("button", { name: "Detections", exact: true }).click();
    await p.screenshot({ path: "qa/screenshots/contact-detections-dark.png" });
    await p.getByRole("button", { name: "Enhanced", exact: true }).click();
    await p.screenshot({ path: "qa/screenshots/contact-enhanced-dark.png" });
  }
  if (name === "map") {
    await p.locator(".map-contact-row").first().click();
    await audit("selected-map-dark");
    await p.getByRole("button", { name: "Switch to light mode" }).click();
    await p.waitForTimeout(1200);
    await audit("selected-map-light");
  }
}
await p.goto(base + "/workspace/contact/CT-01");
await p.getByRole("button", { name: "Switch to light mode" }).click();
await p.getByRole("button", { name: "Inspect evidence", exact: true }).click();
await p.getByText("Detector", { exact: true }).click();
await audit("evidence-drawer-light");
await p.keyboard.press("Escape");
await p.emulateMedia({ forcedColors: "active" });
await p.screenshot({ path: "qa/screenshots/contact-forced-colors.png" });
await p.emulateMedia({ forcedColors: "none" });
await auditContext.close();

const fallback = await browser.newContext({
  viewport: { width: 860, height: 900 },
});
const f = await fallback.newPage();
// Block media deliberately to exercise the still-image fallback. Network aborts are expected here.
await f.route("**/media/*.webm", (r) => r.abort());
await f.route("**/media/*.mp4", (r) => r.abort());
await f.goto(base);
await expect(f.locator(".ocean-poster")).toBeVisible();
expect(
  await f
    .locator(".ocean-poster")
    .evaluate((img) => img.complete && img.naturalWidth > 0),
).toBe(true);
await f.screenshot({ path: "qa/screenshots/landing-static-fallback-860.png" });
report.water.staticFallback = true;
await fallback.close();

for (const asset of [
  "media/oceaneye-hero.mp4",
  "media/oceaneye-hero.webm",
  "media/oceaneye-poster.jpg",
  "sonar/viator-detail.png",
  "sonar/barge-detail.png",
  "sonar/viator-03.png",
  "sonar/barge-01.png",
  "sonar/barge-02.png",
  "favicon.svg",
]) {
  const response = await browser.newContext().then(async (c) => {
    const r = await c.request.get(base + "/" + asset);
    const item = {
      asset,
      status: r.status(),
      type: r.headers()["content-type"],
    };
    await c.close();
    return item;
  });
  report.assets.push(response);
  expect(response.status).toBe(200);
}
await browser.close();
await fs.writeFile(
  "qa/interaction-report.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      ...report,
      audits: report.audits.map((a) => ({
        name: a.name,
        violations: a.violations.length,
      })),
    },
    null,
    2,
  ),
);
