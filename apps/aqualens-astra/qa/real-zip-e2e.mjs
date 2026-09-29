// External-evaluator walkthrough with the real raster-only ZIP. Real browser, real local API, no mocks.
// usage: node qa/real-zip-e2e.mjs <w>x<h> <zip> <second-real-raster>
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const [size = "1440x900", zip, second, mode] = process.argv.slice(2);
// --track: the bundle supplies its own navigation (e.g. SYNTHETIC_DEMO); the map must draw it.
const track = mode === "--track";
const [width, height] = size.split("x").map(Number);
const BASE = "http://127.0.0.1:5320";
const API = "http://127.0.0.1:8000/api/v1";
const out = new URL(`./out/${track ? "track" : "real"}-zip-${size}/`, import.meta.url).pathname;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const zipName = path.basename(zip);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 1 });
const errors = [];
const net = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("request", (r) => r.url().startsWith(API) && net.push({ id: r, method: r.method(), url: r.url().slice(API.length) }));
page.on("response", (r) => { const n = net.find((x) => x.id === r.request()); if (n) n.status = r.status(); });
page.on("requestfailed", (r) => { const n = net.find((x) => x.id === r); if (n) n.status = "FAILED " + r.failure()?.errorText; });

const R = [];
const ck = (l, ok, i = "") => { R.push(`${ok ? "PASS" : "FAIL"} ${l}${i ? ` | ${i}` : ""}`); return ok; };
const info = (s) => R.push(`INFO ${s}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const shot = (l) => page.screenshot({ path: `${out}${String(n++).padStart(2, "0")}-${l}.png` });
const text = (sel) => page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim() ?? null, sel);
const click = (sel, t) => page.evaluate((sel, t) => { const e = [...document.querySelectorAll(sel)].find((x) => !t || x.textContent.trim().includes(t)); e?.click(); return !!e; }, sel, t);
const api = (p) => fetch(API + p).then((r) => r.json());
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const finish = async () => { fs.writeFileSync(`${out}results.txt`, R.join("\n")); console.log(R.join("\n")); await browser.close(); };
const abort = async (e) => { R.push("ABORT " + String(e?.message ?? e).split("\n")[0]); await shot("abort").catch(() => {}); await finish(); process.exit(1); };
process.on("uncaughtException", abort);
process.on("unhandledRejection", abort);
const pick = async (p) => (await page.$('.intake input[type="file"]')).uploadFile(p);
const drop = async (p) => {
  const b64 = fs.readFileSync(p).toString("base64");
  await page.evaluate(async (b64, name) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type: name.endsWith(".zip") ? "application/zip" : "image/png" }));
    const zone = document.querySelector(".drop");
    for (const t of ["dragenter", "dragover", "drop"]) zone.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, b64, path.basename(p));
};
const card = () => page.evaluate(() => ({ name: document.querySelector(".drop__name")?.textContent, facts: document.querySelector(".drop__facts")?.innerText.replace(/\n/g, " · "), state: document.querySelector(".drop__state")?.textContent }));
const rail = () => page.evaluate(() => [...document.querySelectorAll(".rail li")].map((l) => `${l.textContent}${l.className ? ":" + l.className.replace("is-", "") : ""}`).join(" "));
const bar = () => page.evaluate(() => ({ path: location.pathname, role: document.querySelector(".viewer-pill__role")?.textContent, mission: document.querySelector(".bar__mission")?.textContent, demoTag: !!document.querySelector(".bar .demo-tag"), tabs: [...document.querySelectorAll(".bar__tabs a")].map((a) => a.textContent) }));
const noDemoOnScreen = () => page.evaluate(() => !document.querySelector(".ws .demo-tag") && !/demo_contact|DEMO_FIXTURE|Arabian Sea Survey|synthetic|demo mission/i.test(document.querySelector("#ws-main, .intake, .roles")?.innerText ?? ""));

// ---------- Landing → Launch Workspace → Survey Intake ----------
await page.evaluateOnNewDocument(() => { if (!sessionStorage.getItem("k")) { localStorage.clear(); sessionStorage.setItem("k", "1"); } });
await page.goto(BASE + "/", { waitUntil: "networkidle0" });
await wait(700);
ck("landing loads", !!(await page.$("#hero-title")) && !(await overflow()));
await shot("landing");
await click(".cl-hero a.cta", "Launch Workspace");
await page.waitForSelector(".intake", { timeout: 10000 });
await wait(900);
ck("Launch Workspace opens Survey Intake", (await text(".intake__crumb")) === "Survey Intake" && !!(await page.$(".drop__empty")));
ck("intake has no demo in Previous surveys", !(await page.evaluate(() => [...document.querySelectorAll(".previous__row")].some((r) => /demo/i.test(r.textContent)))));
await shot("intake");

// ---------- drag and drop the ZIP, change file, drop again ----------
await drop(zip);
await wait(400);
let c = await card();
ck("dropped ZIP acknowledged", c.name === zipName && c.facts === "1.9 MB · ZIP survey bundle" && c.state === "Selected · ready to process", JSON.stringify(c));
await shot("zip-selected");
await pick(second);
await wait(300);
c = await card();
ck("change file replaces selection", c.name === path.basename(second) && /PNG raster/.test(c.facts), JSON.stringify(c));
await drop(zip);
await wait(300);
ck("ZIP selected again", (await card()).name === zipName);

// ---------- Process, observe real states, refresh while processing ----------
const mark = net.length;
await click(".intake__actions .btn--primary", "Process survey");
const rails = [];
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  const r = await rail();
  if (r && rails.at(-1) !== r) rails.push(r);
  if (/Processing:active/.test(r)) break;
  if (await page.$(".drop.is-failed")) break;
  await wait(100);
}
ck("no warning or failure state on a valid bundle", !(await page.$(".drop.is-failed")) && !/synthetic|demo/i.test(await page.evaluate(() => document.querySelector(".intake").innerText)), (await text(".drop__state")) ?? "");
await shot("processing");
const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("aqualens.intake.pending") ?? "null"));
ck("states: Uploading, Received, Ingested, Processing", rails[0]?.startsWith("Uploading:active") && rails.some((r) => /Received:done Ingested:done Processing:active/.test(r)), rails.join(" || "));
await page.reload({ waitUntil: "domcontentloaded" });
const afterReload = net.length;
await page.waitForSelector(".drop__name", { timeout: 10000 });
ck("refresh during processing resumes the same file", (await text(".drop__name")) === zipName);
await page.waitForFunction(() => !!document.querySelector(".ready__facts") || !!document.querySelector(".drop.is-failed"), { timeout: 600000 });
await wait(700);
const polled = [...new Set(net.slice(afterReload).filter((q) => q.url.startsWith("/jobs/")).map((q) => q.url))];
ck("resume polls only the active job", polled.length === 1 && polled[0] === `/jobs/${pending?.jobId}`, polled.join(","));
ck("processed", (await rail()) === "Received:done Ingested:done Processed:done" && (await text(".drop__state")) === "Processed · survey ready");
await shot("processed");

// ---------- the backend owns a real, non-demo Mission ----------
const reqs = net.slice(mark);
const upload = reqs.find((q) => q.method === "POST" && /\/uploads$/.test(q.url));
const missionId = upload?.url.split("/")[2];
const [mission, surveys, uploads, jobs, contacts, map] = await Promise.all([`/missions/${missionId}`, `/missions/${missionId}/surveys`, `/missions/${missionId}/uploads`, `/missions/${missionId}/jobs`, `/missions/${missionId}/contacts?limit=200`, `/missions/${missionId}/map`].map(api));
const job = jobs.items[0];
ck("upload accepted (202) into a new Mission", upload?.status === 202 && reqs.some((q) => q.method === "POST" && q.url === "/missions" && q.status === 201));
ck("uploaded bytes SHA-256 match", uploads.items[0]?.sha256 === sha(zip), uploads.items[0]?.sha256);
ck("Mission is real, not demo", mission.demo === false && mission.provenance === "REAL" && !missionId.startsWith("demo_"), missionId);
ck("Surveys created and READY", surveys.items.length > 0 && surveys.items.every((s) => s.status === "READY" && !s.demo), `${surveys.items.length} surveys, ${surveys.items.reduce((n, s) => n + s.frames.length, 0)} frames`);
ck("processing job COMPLETED", job?.state === "COMPLETED", `${job?.job_id} ${job?.state}`);
if (track) {
  ck("supplied navigation kept with its provenance", uploads.items[0]?.navigation_provenance === "SYNTHETIC_DEMO" && surveys.items.every((s) => s.navigation_provenance === "SYNTHETIC_DEMO") && job?.metadata?.navigation === "AVAILABLE", `${uploads.items[0]?.navigation_provenance}, job nav ${job?.metadata?.navigation}`);
  ck("map carries the supplied track, display-only", map.platform_context.length === surveys.items.reduce((n, s) => n + s.frames.length, 0) && map.platform_context.every((f) => f.properties.provenance === "SYNTHETIC_DEMO" && f.properties.verification === "DISPLAY_ONLY_NOT_EVIDENCE") && map.features.length === 0, `${map.platform_context.length} track points, ${map.features.length} contact positions`);
  ck("nothing serialized as MEASURED", !JSON.stringify([mission, surveys, uploads, map]).includes("MEASURED"));
  ck("no persistence from synthetic navigation", contacts.items.every((x) => x.look_count === 1 && x.evidence.persistence.status !== "AVAILABLE" && x.evidence.navigation.status !== "AVAILABLE"));
  ck("mission is a normal Mission", mission.demo === false && mission.provenance === "REAL");
} else ck("navigation unavailable, nothing invented", uploads.items[0]?.navigation_provenance == null && job?.metadata?.navigation === "UNAVAILABLE" && map.availability !== "AVAILABLE" && surveys.items.every((s) => s.navigation_provenance == null), `map ${map.availability}: ${map.reason ?? ""}`);
const ui = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ready__facts > div")].map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent])));
ck("ready summary equals backend", Number(ui.Surveys) === surveys.items.length && Number(ui.Contacts) === contacts.items.length && ui.Mission === mission.name, JSON.stringify(ui));
const classes = contacts.items.map((x) => x.machine?.supervised_class ?? "none");
info(`mission ${missionId} "${mission.name}"; surveys ${surveys.items.map((s) => s.survey_id).join(", ")}; contacts ${contacts.items.length} ${JSON.stringify(classes)}; positions ${contacts.items.filter((x) => x.position && x.position.availability === "AVAILABLE").length}`);
ck("no demo requests after upload", !net.slice(mark).some((q) => /demo/.test(q.url)));

// ---------- refresh after processing, Previous surveys ----------
await page.reload({ waitUntil: "networkidle0" });
await wait(1200);
const first = await page.$$eval(".previous__row", (e) => e.map((x) => x.innerText.replace(/\n/g, " | ")));
ck("refresh after processing: Previous surveys shows it first", first[0]?.includes(mission.name) && first[0]?.includes(zipName) && first[0]?.includes("Open") && first[0]?.includes("Ready"), first[0]);
ck("Previous row survey count from backend", first[0]?.includes(`${surveys.items.length} survey`));
await shot("previous-after-refresh");

// ---------- role selection ----------
await click(".previous__row", mission.name);
await page.waitForSelector(".roles__title", { timeout: 10000 });
await wait(800);
const names = await page.$$eval(".role__name", (e) => e.map((x) => x.textContent));
ck("role screen shows all four roles", JSON.stringify(names) === JSON.stringify(["Field Officer", "Sonar Analyst", "Mission Supervisor", "Decision Viewer"]));
ck("role screen names this Mission", ((await text(".roles__mission")) ?? "").includes(mission.name) && !(await page.$(".roles__mission .demo-tag")));
await shot("roles");
const enter = async (name) => {
  if (!(await page.$(".roles"))) {
    await click(".viewer-pill");
    await wait(250);
    await click('.menu [role="menuitem"]', "Change role");
    await page.waitForSelector(".roles__title", { timeout: 8000 });
    await wait(400);
  }
  await click(".role", name);
  await page.waitForSelector(".viewer-pill__role", { timeout: 10000 });
  await wait(1500);
  return bar();
};
const contactNames = contacts.items.map((x) => `C-${x.contact_id.slice(-6).toUpperCase()}`);

let b = await enter("Sonar Analyst");
const analystText = await page.evaluate(() => document.querySelector("#ws-main")?.innerText ?? "");
ck("Sonar Analyst: this Mission, Review", b.path.startsWith("/workspace/review") && b.mission === mission.name && !b.demoTag && b.role === "Sonar Analyst", JSON.stringify(b));
ck("Sonar Analyst shows this Mission's Contacts only", contacts.items.length === 0 ? /No |no Contact/i.test(analystText) : contactNames.some((cn) => analystText.includes(cn)), contactNames.join(","));
ck("Sonar Analyst: no demo on screen", await noDemoOnScreen());
ck("Sonar Analyst: no overflow", !(await overflow()));
await shot("sonar-analyst");
const analystTabs = b.tabs;

b = await enter("Field Officer");
const fieldText = await page.evaluate(() => document.querySelector("#ws-main")?.innerText ?? "");
ck("Field Officer: same Mission, Mission view", b.path.startsWith("/workspace/mission") && b.mission === mission.name && fieldText.includes(zipName), JSON.stringify(b));
ck("Field Officer: interface differs from Analyst", JSON.stringify(b.tabs) !== JSON.stringify(analystTabs), `${analystTabs.join("/")} → ${b.tabs.join("/")}`);
ck("Field Officer: no demo on screen", await noDemoOnScreen());
await shot("field-officer");
await click(".bar__tabs a", "Map");
await wait(1500);
const mapText = await page.evaluate(() => document.querySelector("#ws-main")?.innerText ?? "");
if (track) {
  await page.waitForFunction(() => !!window.__aqMap && window.__aqMap.isStyleLoaded() && window.__aqMap.getZoom() > 12, { timeout: 30000 });
  await page.waitForFunction(() => !window.__aqMap.isMoving(), { timeout: 20000 });
  await wait(600);
  const drawn = await page.evaluate(() => ({ track: window.__aqMap.queryRenderedFeatures({ layers: ["track-line"] }).length, pins: document.querySelectorAll(".mm-pin:not(.is-hidden)").length }));
  const mapUi = await page.evaluate(() => document.querySelector(".mm")?.innerText ?? "");
  ck("Map draws the survey track and this Mission's Contacts", drawn.track > 0 && drawn.pins === contacts.items.length && /Provided survey track/i.test(mapUi) && !/Navigation unavailable/i.test(mapUi), JSON.stringify(drawn));
  ck("Map shows no synthetic warning", !/synthetic|demo/i.test(mapUi));
  await page.evaluate(() => document.querySelectorAll(".mm-pin")[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await wait(500);
  info("map card: " + (await page.evaluate(() => document.querySelector(".mm-insp__note")?.textContent)));
  await shot("map-track");
} else ck("Map says navigation unavailable, draws no positions", /Navigation unavailable/.test(mapText) && !(await page.$(".mm-pin")) && !(await page.$(".mm__canvas")), mapText.split("\n").slice(0, 3).join(" / "));
await shot("map-unavailable");

b = await enter("Mission Supervisor");
const reportTitle = await page.evaluate(() => document.querySelector("#ws-main h1")?.textContent);
ck("Mission Supervisor: same Mission, Report", b.path.startsWith("/workspace/report") && b.mission === mission.name && reportTitle === mission.name, `${b.path} ${reportTitle}`);
// The provenance code belongs in the Report's technical Map section, once, and nowhere else.
const reportProv = await page.evaluate(() => {
  const main = document.querySelector("#ws-main").cloneNode(true);
  const map = main.querySelector("#r-map")?.innerText ?? main.querySelector("#r-map")?.textContent ?? "";
  main.querySelector("#r-map")?.remove();
  return { inMap: map, elsewhere: /synthetic|demo mission|demo_contact|DEMO_FIXTURE/i.test(main.textContent) };
});
ck("Mission Supervisor: provenance only in the technical Map section", !reportProv.elsewhere && (!track || /SYNTHETIC_DEMO/.test(reportProv.inMap)), reportProv.inMap.replace(/\s+/g, " ").slice(0, 160));
await shot("mission-supervisor");

b = await enter("Decision Viewer");
const overviewTitle = await page.evaluate(() => document.querySelector("#ws-main h1")?.textContent);
ck("Decision Viewer: same Mission, Overview", b.path.startsWith("/workspace/overview") && b.mission === mission.name && overviewTitle === mission.name, `${b.path} ${overviewTitle}`);
ck("Decision Viewer: no demo on screen", await noDemoOnScreen());
await shot("decision-viewer");

// Quick switcher keeps the Mission too.
await click(".viewer-pill");
await wait(250);
await click('.menu [role="menuitemradio"]', "Sonar Analyst");
await wait(1200);
b = await bar();
ck("quick switcher: same Mission", b.role === "Sonar Analyst" && b.mission === mission.name);
const missionsNow = (await api("/missions?limit=200")).filter((m) => !m.legacy).length;
const jobsNow = (await api(`/missions/${missionId}/jobs`)).items.length;
ck("role switching created no Mission and reran nothing", jobsNow === 1, `jobs ${jobsNow}, real missions ${missionsNow}`);

// Refresh inside the workspace.
await page.reload({ waitUntil: "networkidle0" });
await wait(1500);
ck("refresh inside workspace keeps the Mission", (await bar()).mission === mission.name);

// ---------- Back to Survey Intake, reopen, second real upload ----------
await click(".viewer-pill");
await wait(250);
await click('.menu [role="menuitem"]', "Change role");
await page.waitForSelector(".roles__foot a", { timeout: 8000 });
await click(".roles__foot a", "Back to Survey Intake");
await page.waitForSelector(".previous__row", { timeout: 8000 });
await wait(800);
ck("Back to Survey Intake: survey still listed", ((await page.$$eval(".previous__row", (e) => e.map((x) => x.innerText)))[0] ?? "").includes(mission.name));
await pick(second);
await wait(300);
await click(".intake__actions .btn--primary", "Process survey");
await page.waitForFunction(() => !!document.querySelector(".ready__facts") || !!document.querySelector(".drop.is-failed"), { timeout: 300000 });
await wait(800);
const secondMission = await page.evaluate(() => document.querySelector(".ready__name")?.textContent);
ck("second real upload processed", !!(await page.$(".ready__facts")) && secondMission !== mission.name, secondMission);
if ((await text(".ready__facts > div:last-child dd")) === "0") ck("zero Contacts stated honestly", (await text(".ready__empty")) === "No supervised Contacts detected.");
await page.goto(BASE + "/workspace", { waitUntil: "networkidle0" });
await wait(1000);
const both = await page.$$eval(".previous__row", (e) => e.map((x) => x.innerText.split("\n")[0]));
ck("Previous surveys lists both real uploads", both.includes(secondMission) && both.includes(mission.name), both.slice(0, 3).join(" / "));
await click(".previous__row", mission.name);
await page.waitForSelector(".roles__title", { timeout: 8000 });
await wait(600);
b = await enter("Sonar Analyst");
ck("reopening the first survey restores its context", b.mission === mission.name);

// ---------- AQUALENS home → landing → Launch Workspace ----------
await page.evaluate(() => (window.__spa = true));
await click(".bar__mark");
await page.waitForSelector("#hero-title", { timeout: 8000 });
ck("AQUALENS top-left returns to landing", await page.evaluate(() => location.pathname === "/" && window.__spa === true));
await click(".cl-nav a.cta", "Launch Workspace");
await page.waitForSelector(".intake", { timeout: 8000 });
await wait(900);
const again = await page.$$eval(".previous__row", (e) => e.map((x) => x.innerText.split("\n")[0]));
ck("after round trip both surveys still listed", again.includes(mission.name) && again.includes(secondMission));
await shot("intake-final");

// ---------- global ----------
ck("no demo request anywhere in the real session", !net.some((q) => /demo/.test(q.url)), net.filter((q) => /demo/.test(q.url)).map((q) => q.url).join(","));
const bad = net.filter((q) => typeof q.status === "string" || q.status >= 400);
ck("no failed or unexpected network requests", bad.length === 0, bad.map((q) => `${q.method} ${q.url} ${q.status}`).join(", "));
ck("no console errors", errors.length === 0, errors.join(" | "));
info(`REAL_MISSION_ID=${missionId} REAL_SURVEY_IDS=${surveys.items.map((s) => s.survey_id).join(",")}`);
await finish();
