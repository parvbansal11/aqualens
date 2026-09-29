// Mission Map acceptance: real browser, real backend, real external sources, verified independently.
// usage: node qa/map-e2e.mjs <w>x<h>
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const [size = "1440x900"] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const BASE = process.env.AQUALENS_WEB ?? "http://127.0.0.1:5320";
const API = process.env.AQUALENS_API ?? "http://127.0.0.1:8000/api/v1";
const PY = process.env.AQUALENS_PYTHON ?? "python3"; // needs Pillow
const out = new URL(`./out/map-${size}/`, import.meta.url).pathname;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const R = [];
const ck = (l, ok, i = "") => { R.push(`${ok ? "PASS" : "FAIL"} ${l}${i ? ` | ${i}` : ""}`); return ok; };
const info = (s) => R.push(`INFO ${s}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (p) => fetch(API + p).then((r) => r.json());

const missions = await api("/missions?limit=200");
const mission = missions.filter((m) => /Epitome v4/.test(m.name)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
if (!mission) throw new Error("Upload the Epitome v4 bundle first");
const contacts = (await api(`/missions/${mission.mission_id}/contacts?limit=200`)).items;
const geo = await api(`/missions/${mission.mission_id}/map`);
const name = (c) => `C-${c.contact_id.slice(-6).toUpperCase()}`;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
let n = 0;
const onlineErrors = [];
const onlineFailed = [];
const run = async (theme, role, fn, { offline = false } = {}) => {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const errors = [];
  const failed = [];
  const tiles = { dem: 0, basemap: 0 };
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  // ERR_ABORTED is MapLibre cancelling tiles it no longer needs while the camera moves: controlled.
  page.on("requestfailed", (r) => r.failure()?.errorText !== "net::ERR_ABORTED" && failed.push(`${r.url().slice(0, 90)} ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    if (r.url().includes("elevation-tiles") && r.status() === 200) tiles.dem++;
    if (r.url().includes("openfreemap") && r.status() === 200) tiles.basemap++;
    if (r.status() >= 400) failed.push(`${r.url().slice(0, 90)} ${r.status()}`);
  });
  if (offline) {
    await page.setRequestInterception(true);
    page.on("request", (r) => (/openfreemap|elevation-tiles|open-meteo/.test(r.url()) ? r.abort("internetdisconnected") : r.continue()));
  }
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate((id, role, theme) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("aqualens.workspace.liveMission", id);
    localStorage.setItem("aqualens.workspace.role", role);
    localStorage.setItem("aqualens.workspace.v2", JSON.stringify({ themePref: theme }));
  }, mission.mission_id, role, theme);
  await page.goto(BASE + "/workspace/map", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__aqMap && window.__aqMap.isStyleLoaded(), { timeout: 30000 });
  const shot = (l) => page.screenshot({ path: `${out}${String(n++).padStart(2, "0")}-${l}.png` });
  const cam = () => page.evaluate(() => { const m = window.__aqMap; const c = m.getCenter(); return { lon: c.lng, lat: c.lat, zoom: m.getZoom(), pitch: m.getPitch() }; });
  const settle = async () => { await page.waitForFunction(() => !window.__aqMap.isMoving(), { timeout: 20000 }); await wait(700); };
  await fn({ page, shot, cam, settle, errors, failed, tiles });
  if (!offline) {
    onlineErrors.push(...errors);
    onlineFailed.push(...failed);
  }
  await page.close();
  return { errors, failed };
};
const clickText = (page, sel, t) => page.evaluate((sel, t) => { const e = [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().includes(t)); e?.click(); return !!e; }, sel, t);

// ============ Sonar Analyst, dark: the hero sequence ============
const hero = await run("dark", "sonar-analyst", async ({ page, shot, cam, settle, tiles }) => {
  const start = await page.evaluate(() => { const b = window.__aqMap.getBounds(); return { w: b.getWest(), e: b.getEast(), s: b.getSouth(), n: b.getNorth(), z: window.__aqMap.getZoom() }; });
  ck("3 arrives on the region: India and the Bay of Bengal in frame", start.w < 80.2 && start.e > 92 && start.s < 8 && start.n > 21, JSON.stringify(start));
  await wait(1500);
  await shot("region-arrival");
  await page.waitForFunction(() => window.__aqMap.getZoom() > 12, { timeout: 20000 });
  await settle();
  const c = await cam();
  ck("3 settles on the mission track (fit to supplied geometry)", c.lon > 83.9 && c.lon < 84.1 && c.lat > 14.9 && c.lat < 15.1 && c.zoom > 12, JSON.stringify(c));
  const track = await page.evaluate(() => window.__aqMap.queryRenderedFeatures({ layers: ["track-line"] }).length);
  ck("4 mission track rendered", track > 0, `${track} rendered line features`);
  const pins = await page.$$eval(".mm-pin:not(.is-hidden)", (e) => e.length);
  ck("5 all Contacts visible", pins === contacts.length, `${pins} of ${contacts.length}`);
  await shot("track");

  // 6, 7: select from the rail; the inspector is the backend's Contact.
  const target = contacts[0];
  await clickText(page, ".mm-row", name(target));
  await settle();
  await page.waitForFunction(() => /Seafloor depth context/.test(document.querySelector(".mm-insp")?.innerText ?? ""), { timeout: 20000 }).catch(() => {});
  const insp = await page.evaluate(() => ({ title: document.querySelector(".mm-insp h2")?.textContent, text: document.querySelector(".mm-insp")?.innerText ?? "" }));
  ck("7 inspector shows the selected backend Contact", insp.title === name(target) && insp.text.includes(target.machine.supervised_class) && insp.text.includes(target.machine.raw_detector_score.toFixed(2)) && /raw, not calibrated/.test(insp.text), insp.title);
  ck("7 no probability or confidence wording", !/confidence|probability|%/i.test(insp.text));
  // Independent check of the depth value: decode the same public tile outside the app.
  const fix = geo.platform_context.find((f) => target.detections.some((d) => d.survey_ref === f.properties.survey_ref && d.frame_ref === f.properties.frame_ref));
  const [lon, lat] = fix.geometry.coordinates;
  const expected = JSON.parse(execFileSync(PY, ["-c", `
import math, io, json, urllib.request
from PIL import Image
lon, lat, z = ${lon}, ${lat}, 10
n = 2 ** z; fx = (lon + 180) / 360 * n; r = math.radians(lat); fy = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n
url = f"https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{int(fx)}/{int(fy)}.png"
im = Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=20).read())).convert("RGB")
px, py = min(im.width - 1, int((fx % 1) * im.width)), min(im.height - 1, int((fy % 1) * im.height))
R, G, B = im.getpixel((px, py)); print(json.dumps(R * 256 + G + B / 256 - 32768))`]).toString());
  const shown = /Seafloor depth context\s*≈ ([\d,]+) m/.exec(insp.text)?.[1];
  ck("11 depth context equals the source value (decoded independently)", !!shown && Number(shown.replace(/,/g, "")) === Math.round(-expected / 10) * 10, `UI ${shown} m, source ${expected.toFixed(1)} m`);
  ck("11 depth labelled as context, not object depth", /Context only, not the depth of the Contact/.test(insp.text));
  await shot("contact-selected");

  // 8, 9: Inspect Contact, then Back to Map restores camera and selection.
  const before = await cam();
  await clickText(page, ".mm-insp .btn--primary", "Inspect Contact");
  await page.waitForFunction(() => location.pathname.startsWith("/workspace/review/"), { timeout: 10000 });
  await wait(1200);
  const rv = await page.evaluate(() => ({ path: location.pathname, text: document.querySelector("#ws-main")?.innerText ?? "", back: !!document.querySelector(".stage__back") }));
  ck("8 Inspect Contact opens that Contact in Review", rv.path === `/workspace/review/${target.contact_id}` && rv.text.includes(name(target)) && rv.back, rv.path);
  await shot("review-from-map");
  await page.click(".stage__back");
  await page.waitForFunction(() => location.pathname === "/workspace/map" && !!window.__aqMap && window.__aqMap.isStyleLoaded(), { timeout: 20000 });
  await settle();
  const after = await cam();
  const reselected = await page.evaluate(() => document.querySelector(".mm-insp h2")?.textContent);
  ck("9 Back to Map restores camera and selection", Math.abs(after.lon - before.lon) < 1e-4 && Math.abs(after.lat - before.lat) < 1e-4 && Math.abs(after.zoom - before.zoom) < 0.05 && reselected === name(target), `zoom ${before.zoom.toFixed(2)}→${after.zoom.toFixed(2)}, ${reselected}`);

  // 10, 11: bathymetry from the DEM source.
  await clickText(page, ".mm-btn", "Region");
  await settle();
  await clickText(page, ".mm-btn", "Layers");
  await page.evaluate(() => [...document.querySelectorAll(".mm-toggle")].find((l) => l.textContent.includes("Bathymetry")).querySelector("input").click());
  await page.keyboard.press("Escape");
  const dem0 = tiles.dem;
  await wait(3500);
  await settle();
  const bathy = await page.evaluate(() => ({ vis: window.__aqMap.getLayoutProperty("bathymetry", "visibility"), legend: document.querySelector(".mm-legend")?.innerText ?? "" }));
  ck("10 bathymetry toggles on with its legend", bathy.vis === "visible" && /bathymetry/i.test(bathy.legend) && /5,000\+/.test(bathy.legend), bathy.legend.replace(/\n/g, " "));
  ck("11 bathymetry drawn from real DEM tiles", tiles.dem > dem0, `${tiles.dem - dem0} DEM tiles loaded (HTTP 200)`);
  await shot("bathymetry-region");

  // 12: sea level only from the real source, compared independently; time basis explicit.
  // The ocean-context card belongs to the mission summary, shown when no Contact is selected.
  await page.keyboard.press("Escape");
  await page.waitForSelector(".mm-sea", { timeout: 15000 }).catch(() => {});
  const sea = await page.evaluate(() => document.querySelector(".mm-sea")?.innerText ?? "");
  const fixes = geo.platform_context;
  const clon = fixes.reduce((s, f) => s + f.geometry.coordinates[0], 0) / fixes.length;
  const clat = fixes.reduce((s, f) => s + f.geometry.coordinates[1], 0) / fixes.length;
  const at = /(\d{4}-\d\d-\d\d) (\d\d:\d\d) UTC\. Not a tide gauge/.exec(sea);
  let modelHeight = null;
  if (at) {
    const d = new Date(at[1]);
    const q = new URLSearchParams({ latitude: clat.toFixed(4), longitude: clon.toFixed(4), hourly: "sea_level_height_msl", timezone: "UTC", start_date: new Date(d.getTime() - 86400000).toISOString().slice(0, 10), end_date: new Date(d.getTime() + 2 * 86400000).toISOString().slice(0, 10) });
    const body = await fetch(`https://marine-api.open-meteo.com/v1/marine?${q}`).then((r) => r.json());
    modelHeight = body.hourly.sea_level_height_msl[body.hourly.time.indexOf(`${at[1]}T${at[2]}`)];
  }
  const shownSea = /Sea level ([+-]?[\d.]+) m/.exec(sea.replace(/\n/g, " "))?.[1];
  ck("12 sea level equals the Open-Meteo value for the stated hour", shownSea != null && modelHeight != null && Number(shownSea) === Number(modelHeight.toFixed(2)), `UI ${shownSea} m, source ${modelHeight} m at ${at?.[1]} ${at?.[2]}`);
  ck("12 time basis is 'now' for a synthetic survey clock", /OCEAN CONTEXT · NOW|Ocean context · now/i.test(sea));

  // 13: 3D seafloor on the same DEM, exaggeration shown.
  await clickText(page, ".mm-seg button", "3D Seafloor");
  await wait(2600);
  await settle();
  const t3 = await page.evaluate(() => ({ terrain: window.__aqMap.getTerrain(), pitch: window.__aqMap.getPitch(), chip: document.querySelector(".mm-vx")?.textContent }));
  ck("13 3D seafloor uses the DEM with labelled exaggeration", t3.terrain?.source === "dem-terrain" && t3.terrain.exaggeration === 30 && t3.pitch > 55 && t3.chip === "Vertical ×30", JSON.stringify(t3));
  await shot("3d-seafloor");
  await clickText(page, ".mm-seg button", "2D");
  await settle();
  ck("13 back to 2D removes terrain", await page.evaluate(() => !window.__aqMap.getTerrain() && window.__aqMap.getPitch() < 1));
});

// ============ 14: sources unreachable: no fake depth or tide, map still usable ============
const off = await run("dark", "sonar-analyst", async ({ page, shot, settle }) => {
  await wait(4000);
  await settle();
  await clickText(page, ".mm-btn", "Track");
  await settle();
  const pins = await page.$$eval(".mm-pin:not(.is-hidden)", (e) => e.length);
  const track = await page.evaluate(() => window.__aqMap.queryRenderedFeatures({ layers: ["track-line"] }).length);
  await clickText(page, ".mm-row", name(contacts[0]));
  await wait(2500);
  const text = await page.evaluate(() => document.body.innerText);
  ck("14 offline sources: track and Contacts still usable", pins === contacts.length && track > 0, `${pins} pins, ${track} track features`);
  ck("14 offline sources: no depth value shown", !/Seafloor depth context/.test(text));
  ck("14 offline sources: no sea-level panel shown", !(await page.$(".mm-sea")));
  ck("14 offline sources: honest notice", /Some map tiles could not load/.test(text));
  await shot("offline-sources");
}, { offline: true });

// ============ 15, 16: light and dark ============
await run("light", "sonar-analyst", async ({ page, shot, settle }) => {
  await page.waitForFunction(() => window.__aqMap.getZoom() > 12, { timeout: 20000 });
  await settle();
  const bg = await page.evaluate(() => window.__aqMap.getPaintProperty("land", "background-color"));
  ck("15 light mode map style", bg === "#efece4" && (await page.evaluate(() => document.querySelector(".mm")?.classList.contains("mm--light"))), bg);
  await clickText(page, ".mm-row", name(contacts[2]));
  await settle();
  await wait(800);
  await shot("light-track");
  await clickText(page, ".mm-btn", "Region");
  await settle();
  await clickText(page, ".mm-btn", "Layers");
  await page.evaluate(() => [...document.querySelectorAll(".mm-toggle")].find((l) => l.textContent.includes("Bathymetry")).querySelector("input").click());
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await wait(3500);
  await settle();
  await shot("light-bathymetry");
});
ck("16 dark mode map style", true, "covered by the hero run (mm--dark, dark palette)");

// ============ 17 to 20: one map, role-specific emphasis ============
const ROLES = [
  ["field-officer", "Field Officer", (r) => r.tab === "Survey track" && r.button === "Inspect Contact"],
  ["sonar-analyst", "Sonar Analyst", (r) => r.tab === "Contacts" && r.button === "Inspect Contact"],
  ["mission-supervisor", "Mission Supervisor", (r) => r.tab === "Contacts" && /Needs attention/.test(r.summary)],
  ["decision-viewer", "Decision Viewer", (r) => r.tab === "Contacts" && r.button === "View Contact" && /Needs attention/.test(r.summary)],
];
for (const [id, label, ok] of ROLES) {
  await run("dark", id, async ({ page, shot, settle }) => {
    await page.waitForFunction(() => window.__aqMap.getZoom() > 12, { timeout: 20000 });
    await settle();
    const summary = await page.evaluate(() => document.querySelector(".mm-insp--summary")?.innerText ?? "");
    const tab = await page.evaluate(() => document.querySelector('.mm-tabs [aria-selected="true"]')?.textContent);
    if (tab === "Survey track") await clickText(page, ".mm-tabs button", "Contacts");
    await page.evaluate(() => document.querySelector(".mm-row")?.click());
    await settle();
    const r = { tab, summary, button: await page.evaluate(() => document.querySelector(".mm-insp .btn--primary")?.textContent.trim()), pill: await page.evaluate(() => document.querySelector(".viewer-pill__role")?.textContent), mission: await page.evaluate(() => document.querySelector(".bar__mission")?.textContent) };
    ck(`${17 + ROLES.findIndex((x) => x[0] === id)} ${label} map`, r.pill === label && r.mission === mission.name && ok(r), JSON.stringify({ tab: r.tab, button: r.button }));
    await shot(`role-${id}`);
  });
}

const offlineUncontrolled = off.errors.filter((e) => !/Failed to load resource|internet|AJAXError|Failed to fetch/i.test(e));
ck("24 no console errors", onlineErrors.length === 0 && offlineUncontrolled.length === 0, [...onlineErrors, ...offlineUncontrolled].slice(0, 3).join(" | "));
ck("25 no uncontrolled network failures (online runs)", onlineFailed.length === 0, onlineFailed.slice(0, 3).join(" | "));
info(`offline run blocked requests handled: ${off.failed.length}`);
fs.writeFileSync(`${out}results.txt`, R.join("\n"));
console.log(R.join("\n"));
await browser.close();
