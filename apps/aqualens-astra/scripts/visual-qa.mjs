import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import process from "node:process";
const base = process.env.QA_BASE_URL ?? "http://127.0.0.1:5174";
const runtime = JSON.parse(
  await fs.readFile("qa/runtime-integration/real-runtime-result.json", "utf8"),
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const output = "qa/final-product";
await fs.mkdir(output, { recursive: true });
const report = { screens: [], errors: [], brokenImages: [] };
const routes = [
  ["landing", "/"],
  ["intake", "/intake"],
  ["roles", "/roles"],
  ["home", "/workspace"],
  ["upload", "/workspace/upload"],
  ["processing", "/intake/processing?preview=1"],
  ["results", "/workspace/results"],
  ["contact", `/workspace/contact/${runtime.contactId}`],
  ["map", "/workspace/map"],
  ["review", "/workspace/review"],
  ["review-desk", `/workspace/review/${runtime.contactId}`],
  ["report", "/workspace/report"],
  ["memory", "/workspace/memory"],
  ["model-lab", "/workspace/model-lab"],
  ["change", "/workspace/change"],
];
for (const [width, height] of [
  [1920, 1080],
  [1512, 982],
  [1440, 900],
  [1180, 820],
  [860, 900],
]) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: "reduce",
  });
  await context.addInitScript((id) => {
    sessionStorage.setItem("astra.role", "analyst");
    sessionStorage.setItem("astra.survey", id);
  }, runtime.surveyId);
  const p = await context.newPage();
  p.on("pageerror", (e) => report.errors.push({ width, error: e.message }));
  p.on("console", (m) => {
    if (m.type() === "error") report.errors.push({ width, error: m.text() });
  });
  for (const [name, path] of routes) {
    await p.goto(base + path);
    await p.locator("main:not(.app-loading)").waitFor();
    await p.evaluate(() => document.fonts.ready);
    if (name === "upload")
      await p
        .getByLabel("Choose sonar survey file")
        .setInputFiles(
          "/Users/parvbansal/Desktop/SagarDrishti_Epitome_v2_RealSonar_FullFeature.zip",
        );
    if (name === "map") {
      await p.locator(".map-contact-row").first().click();
      await p.waitForTimeout(1000);
    }
    if (name === "model-lab")
      await p.getByText("YOLO11s", { exact: true }).waitFor();
    await p.waitForTimeout(250);
    const overflow = await p.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    const broken = await p
      .locator("img")
      .evaluateAll((imgs) =>
        imgs
          .filter((i) => i.complete && i.naturalWidth === 0)
          .map((i) => i.src),
      );
    if (broken.length) report.brokenImages.push({ width, name, broken });
    report.screens.push({ width, height, name, theme: "light", overflow });
    await p.screenshot({ path: `${output}/${name}-${width}.png` });
  }
  if ([1440, 1180, 860].includes(width)) {
    await p.evaluate(() => sessionStorage.setItem("astra.theme", "dark"));
    for (const [name, path] of routes.filter(([name]) =>
      [
        "roles",
        "home",
        "contact",
        "map",
        "review-desk",
        "report",
        "memory",
        "model-lab",
        "change",
      ].includes(name),
    )) {
      await p.goto(base + path);
      await p.locator("main:not(.app-loading)").waitFor();
      if (name === "map") {
        await p.locator(".map-contact-row").first().click();
        await p.waitForTimeout(1000);
      }
      await p.waitForTimeout(250);
      report.screens.push({
        width,
        height,
        name,
        theme: "dark",
        overflow: await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      });
      await p.screenshot({ path: `${output}/${name}-dark-${width}.png` });
    }
  }
  await context.close();
  await fs.writeFile(
    `${output}/visual-report.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(`Rendered ${width}x${height}`);
}
for (const survey of ["epitomeNavigated", "epitomeNoNavigation"]) {
  const p = await browser.newPage({
    viewport: { width: 860, height: 900 },
    reducedMotion: "reduce",
  });
  await p.addInitScript((id) => {
    sessionStorage.setItem("astra.role", "analyst");
    sessionStorage.setItem("astra.survey", id);
  }, survey);
  for (const path of [
    "/workspace",
    "/workspace/contact/CT-01",
    ...(survey === "epitomeNavigated" ? ["/workspace/map"] : []),
  ]) {
    await p.goto(base + path);
    await p.locator("main:not(.app-loading)").waitFor();
    await p.waitForTimeout(600);
    if (path.endsWith("/map"))
      await p.locator(".map-contact-row").first().click();
    await p.screenshot({
      path: `${output}/${survey}-${path.split("/").pop()}.png`,
    });
  }
  await p.close();
}
await browser.close();
console.log(
  JSON.stringify(
    {
      screens: report.screens.length,
      overflow: report.screens.filter((s) => s.overflow),
      errors: report.errors,
      brokenImages: report.brokenImages,
    },
    null,
    2,
  ),
);
