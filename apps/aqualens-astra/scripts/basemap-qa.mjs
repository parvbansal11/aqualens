// Verify real raster responses and map interactions against a production build.
// PREVIEW_URL=http://127.0.0.1:4173 serves local build assets at the production
// browser origin, so the existing production API's CORS policy stays intact.
// Without PREVIEW_URL, verifies the live deployment. All API requests are reads.
import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";

const origin = "https://aqualens-web.vercel.app";
const surveyId = process.env.SURVEY_ID || "survey_upload_21f01173ef3c";
const output = process.env.QA_OUTPUT || "/tmp/aqualens-basemap-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
const errors = [];
const responses = [];
const reads = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (request.url().includes("aqualens-api.onrender.com"))
    reads.push(request.method());
});
page.on("response", (response) => {
  if (response.url().includes("/MapServer/tile/"))
    responses.push({ url: response.url(), status: response.status() });
});
if (process.env.PREVIEW_URL)
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await page.request.get(
      `${process.env.PREVIEW_URL}${url.pathname}${url.search}`,
    );
    await route.fulfill({ response });
  });
await page.addInitScript(
  ({ surveyId }) => {
    if (!sessionStorage.getItem("astra.role")) {
      sessionStorage.setItem("astra.role", "analyst");
      sessionStorage.setItem("astra.survey", surveyId);
      sessionStorage.setItem("astra.theme", "light");
    }
  },
  { surveyId },
);

async function loaded(theme) {
  await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("img.leaflet-tile")
        .evaluateAll(
          (images) =>
            images.length > 0 &&
            images.every(
              (image) => image.complete && image.naturalWidth === 256,
            ),
        ),
    )
    .toBe(true);
  const urls = await page
    .locator("img.leaflet-tile")
    .evaluateAll((images) => images.map((image) => image.src));
  for (const url of urls) {
    expect(url).toContain(
      theme === "dark" ? "World_Dark_Gray_Base" : "World_Light_Gray_Base",
    );
    expect(Number(url.match(/tile\/(\d+)/)[1])).toBeLessThanOrEqual(
      theme === "dark" ? 10 : 13,
    );
  }
  await expect(page.locator(".map-tile-error")).toHaveCount(0);
  return urls;
}
async function geometry() {
  return page.evaluate(() => ({
    pane: document.querySelector(".leaflet-map-pane").style.transform,
    markers: Array.from(document.querySelectorAll(".contact-map-marker")).map(
      (el) => ({ title: el.title, position: el.style.transform }),
    ),
    paths: Array.from(
      document.querySelectorAll(".leaflet-overlay-pane path"),
    ).map((el) => el.getAttribute("d")),
  }));
}
async function closePopup() {
  await page.locator(".leaflet-map").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
}

try {
  await page.goto(`${origin}/workspace/map`);
  await expect(page.locator(".contact-map-marker").first()).toBeVisible({
    timeout: 60000,
  });
  const original = await geometry();
  expect(original.markers.length).toBeGreaterThan(0);
  expect(original.paths.length).toBeGreaterThan(0);
  const report = {
    build: process.env.PREVIEW_URL || "live",
    surveyId,
    contacts: original.markers.length,
    checks: [],
  };
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
    const urls = await loaded(theme);
    expect(await geometry()).toEqual(original);
    if (await page.locator(".leaflet-popup-close-button").count())
      await closePopup();
    // Esri's missing-data image is a successful JPEG. Compare decoded pixels,
    // not just status codes, to catch the original failure.
    const missingUrl = urls[0].replace(
      /tile\/\d+\/\d+\/\d+$/,
      "tile/16/30005/48059",
    );
    const imageCheck = await page.evaluate(
      async ({ missingUrl }) => {
        async function pixels(src) {
          const img = new window.Image();
          img.crossOrigin = "anonymous";
          img.src = src;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 256;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          return canvas.toDataURL();
        }
        const placeholder = await pixels(missingUrl);
        const visible = await Promise.all(
          Array.from(document.querySelectorAll("img.leaflet-tile"), (img) =>
            pixels(img.src),
          ),
        );
        return visible.every((image) => image !== placeholder);
      },
      { missingUrl },
    );
    expect(imageCheck).toBe(true);
    await page.screenshot({ path: `${output}/${theme}.png` });
    await page.getByRole("button", { name: "Zoom in map" }).click();
    await loaded(theme);
    expect(await geometry()).not.toEqual(original);
    await page.getByRole("button", { name: "Zoom out map" }).click();
    await loaded(theme);
    await page.locator(".leaflet-map").focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(geometry).not.toEqual(original);
    await loaded(theme);
    await page.getByRole("button", { name: "Fit survey to map" }).click();
    await loaded(theme);
    expect(await geometry()).toEqual(original);
    await page.locator(".map-contact-row").first().click();
    await expect(page.locator(".leaflet-popup")).toBeVisible();
    await expect(page.locator(".map-contact-row").first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await closePopup();
    await page.getByRole("button", { name: "Map layers", exact: true }).click();
    await page.getByLabel("Mission track", { exact: true }).uncheck();
    await expect(page.locator(".leaflet-overlay-pane path")).toHaveCount(0);
    await page.getByLabel("Mission track", { exact: true }).check();
    await page.getByLabel("Contacts", { exact: true }).uncheck();
    await expect(page.locator(".contact-map-marker")).toHaveCount(0);
    await page.getByLabel("Contacts", { exact: true }).check();
    await expect(page.locator(".contact-map-marker")).toHaveCount(
      original.markers.length,
    );
    await page.getByRole("button", { name: "Close map layers" }).click();
    // Existing map has a fit control, no dedicated fullscreen button. Exercise
    // browser fullscreen and its ResizeObserver without changing the map UI.
    await page.evaluate(() =>
      document.querySelector(".survey-map").requestFullscreen(),
    );
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(true);
    await loaded(theme);
    await page.screenshot({ path: `${output}/${theme}-fullscreen.png` });
    await page.evaluate(() => document.exitFullscreen());
    await page.getByRole("button", { name: "Fit survey to map" }).click();
    await loaded(theme);
    if (await page.locator(".leaflet-popup-close-button").count())
      await closePopup();
    for (let zoom = 0; zoom < 11; zoom++)
      await page.getByRole("button", { name: "Zoom out map" }).click();
    await loaded(theme);
    await page.screenshot({ path: `${output}/${theme}-coastline.png` });
    await page.getByRole("button", { name: "Fit survey to map" }).click();
    await loaded(theme);
    report.checks.push(
      `${theme}: tiles, decoded imagery, unchanged geometry, zoom, pan, fit, selection, layers, browser fullscreen PASS`,
    );
  }
  await page
    .getByRole("combobox", { name: "Current survey" })
    .selectOption("epitomeNavigated");
  await page.goto(`${origin}/workspace/map`);
  await loaded("dark");
  await expect(page.locator(".contact-map-marker")).toHaveCount(3);
  await page.getByRole("button", { name: "Map layers", exact: true }).click();
  await page.getByLabel("Supplied depth", { exact: true }).uncheck();
  await expect(page.locator(".depth-profile")).toHaveCount(0);
  await page.getByLabel("Supplied depth", { exact: true }).check();
  await expect(page.locator(".depth-profile")).toBeVisible();
  await page.getByRole("button", { name: "Close map layers" }).click();
  await page
    .getByRole("combobox", { name: "Current survey" })
    .selectOption("epitomeNoNavigation");
  await page.goto(`${origin}/workspace/map`);
  await expect(
    page.getByText("Navigation not supplied for this survey."),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Current survey" })
    .selectOption(surveyId);
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("astra.survey")), {
      timeout: 60000,
    })
    .toBe(surveyId);
  await page.goto(`${origin}/workspace/map`);
  await loaded("dark");
  report.checks.push(
    "survey switching, no-navigation state, supplied depth control PASS",
  );
  const realResponses = responses.filter(
    (r) => !r.url.endsWith("/16/30005/48059"),
  );
  expect(realResponses.length).toBeGreaterThan(0);
  expect(realResponses.every((r) => r.status === 200)).toBe(true);
  await page.route("**/MapServer/tile/**", (route) => route.abort());
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.getByText(/Basemap connection interrupted/)).toBeVisible();
  await expect(page.locator(".contact-map-marker")).toHaveCount(
    original.markers.length,
  );
  expect((await geometry()).paths.length).toBeGreaterThan(0);
  await page.unroute("**/MapServer/tile/**");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await loaded("dark");
  report.checks.push("network failure fallback and recovery PASS");
  expect(errors).toEqual([]);
  expect(reads.every((method) => method === "GET")).toBe(true);
  report.geometryHash = createHash("sha256")
    .update(JSON.stringify(original))
    .digest("hex");
  report.tileResponses = realResponses;
  report.pageErrors = errors;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      { ...report, tileResponses: `${realResponses.length} HTTP 200` },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
