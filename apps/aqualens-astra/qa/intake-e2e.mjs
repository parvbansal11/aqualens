// Real-mode product E2E: landing, Survey Intake, real upload through the backend, roles, recovery.
// usage: node qa/intake-e2e.mjs <w>x<h> <inputs-dir> [--full]
// --full also runs every supported format and the failure cases. Every upload is a real request to
// the local Aqualens API; nothing is mocked.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const [size = "1440x900", inputs, flag] = process.argv.slice(2);
const full = flag === "--full";
const [width, height] = size.split("x").map(Number);
const BASE = process.env.AQUALENS_WEB ?? "http://127.0.0.1:5320";
const API = process.env.AQUALENS_API ?? "http://127.0.0.1:8000/api/v1";
const out = new URL(`./out/intake-${size}/`, import.meta.url).pathname;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const file = (n) => path.join(inputs, n);
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 1 });
const errors = [];
const net = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()));
page.on("request", (r) => r.url().startsWith(API) && net.push({ id: r, method: r.method(), url: r.url().slice(API.length), type: r.headers()["content-type"] ?? "", bytes: Number(r.headers()["content-length"] ?? 0) || (r.postData()?.length ?? 0) }));
page.on("response", (r) => { const n = net.find((x) => x.id === r.request()); if (n) n.status = r.status(); });
page.on("requestfailed", (r) => { const n = net.find((x) => x.id === r); if (n) n.status = "FAILED " + r.failure()?.errorText; });

const R = [];
const ck = (label, ok, info = "") => { R.push(`${ok ? "PASS" : "FAIL"} ${label}${info ? ` | ${info}` : ""}`); return ok; };
const info = (s) => R.push(`INFO ${s}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const shot = (label) => page.screenshot({ path: `${out}${String(n++).padStart(2, "0")}-${label}.png` });
const text = (sel) => page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim() ?? null, sel);
const click = (sel, t) => page.evaluate((sel, t) => { const e = [...document.querySelectorAll(sel)].find((x) => !t || x.textContent.trim().includes(t)); e?.click(); return !!e; }, sel, t);
const api = (p) => fetch(API + p).then((r) => r.json());
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const finish = async () => {
  fs.writeFileSync(`${out}results.txt`, R.join("\n"));
  console.log(R.join("\n"));
  await browser.close();
};
const abort = async (e) => { R.push("ABORT " + String(e?.message ?? e).split("\n")[0]); await shot("abort").catch(() => {}); await finish(); process.exit(1); };
process.on("uncaughtException", abort);
process.on("unhandledRejection", abort);

/** Select via the real file input, as the file picker does. */
const pick = async (name) => (await page.$('.intake input[type="file"]')).uploadFile(file(name));
/** A real DOM drop event carrying the file's real bytes, as a drag from Finder produces. */
const drop = async (name) => {
  const b64 = fs.readFileSync(file(name)).toString("base64");
  await page.evaluate(async (b64, name) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type: name.endsWith(".zip") ? "application/zip" : "image/png" }));
    const zone = document.querySelector(".drop");
    for (const type of ["dragenter", "dragover", "drop"]) zone.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, b64, name);
};
/** Process the selected file and wait for the backend's terminal state. Returns what was seen. */
const processSelected = async (tag) => {
  const before = net.length;
  const states = new Set();
  const rails = [];
  let sawPercent = false;
  await click(".intake__actions .btn--primary", "Process survey");
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    const s = await page.evaluate(() => ({ rail: [...document.querySelectorAll(".rail li")].map((l) => `${l.textContent}${l.className ? ":" + l.className.replace("is-", "") : ""}`).join(" "), state: document.querySelector(".drop__state")?.textContent?.trim(), ready: !!document.querySelector(".ready__facts"), failed: !!document.querySelector(".drop.is-failed"), body: document.querySelector(".intake")?.innerText ?? "" }));
    if (s.state) states.add(s.state);
    if (s.rail && rails.at(-1) !== s.rail) rails.push(s.rail);
    if (/\d+\s?%/.test(s.body)) sawPercent = true;
    if (states.size === 3 && tag) await shot(`${tag}-processing`);
    if (s.ready || s.failed) break;
    await wait(150);
  }
  await wait(400);
  return { states: [...states], rails, sawPercent, requests: net.slice(before) };
};

// ================= A: landing to intake =================
await page.evaluateOnNewDocument(() => { if (!sessionStorage.getItem("qa-keep")) { localStorage.clear(); sessionStorage.setItem("qa-keep", "1"); } });
await page.goto(BASE + "/", { waitUntil: "networkidle0" });
await wait(600);
await click(".cl-hero a.cta", "Launch Workspace");
await page.waitForSelector(".intake", { timeout: 10000 });
await wait(900);
ck("A landing, Launch Workspace, Survey Intake", (await text(".intake__crumb")) === "Survey Intake" && (await text(".intake__title")) === "Start with survey data." && !(await page.$(".roles")));
ck("A no demo requests or demo data in real mode", !net.some((r) => r.url.startsWith("/demo")) && !(await page.$(".intake .drop .demo-tag")));
ck("A no horizontal overflow (intake)", !(await overflow()));
await shot("intake-empty");

// ================= B: file picker =================
const main = "qa-subpipe-hf-f08e01eb.png";
const mainBytes = fs.statSync(file(main)).size;
const netBeforePick = net.length;
await pick(main);
await wait(400);
const sel = await page.evaluate(() => ({ name: document.querySelector(".drop__name")?.textContent, facts: document.querySelector(".drop__facts")?.innerText.replace(/\n/g, " · "), state: document.querySelector(".drop__state")?.textContent, process: !!document.querySelector(".intake__actions .btn--primary") }));
ck("B picker shows real filename", sel.name === main, JSON.stringify(sel));
ck("B picker shows real size and type", sel.facts === "724 KB · PNG raster", `${mainBytes} bytes → ${sel.facts}`);
ck("B selected, not ingested", sel.state === "Selected · ready to process" && !/ingest/i.test(sel.state) && sel.process);
ck("B selecting sends nothing", net.length === netBeforePick);
await shot("intake-selected");

// ================= C: drag and drop =================
await click(".drop__tools .icon-btn");
await wait(300);
ck("C remove returns to empty drop target", !!(await page.$(".drop__empty")));
await drop("qa-viator-03.png");
await wait(400);
const dsel = await page.evaluate(() => ({ name: document.querySelector(".drop__name")?.textContent, facts: document.querySelector(".drop__facts")?.innerText.replace(/\n/g, " · "), state: document.querySelector(".drop__state")?.textContent }));
ck("C drop shows same selected state", dsel.name === "qa-viator-03.png" && /KB · PNG raster/.test(dsel.facts) && dsel.state === "Selected · ready to process", JSON.stringify(dsel));
// Back to the main file through the picker for the rest of the journey.
await pick(main);
await wait(300);

// ================= D, E: real backend and processing =================
const run = await processSelected("main");
const create = run.requests.find((r) => r.method === "POST" && r.url === "/missions");
const upload = run.requests.find((r) => r.method === "POST" && /\/missions\/[^/]+\/uploads$/.test(r.url));
const missionId = upload?.url.split("/")[2];
ck("D mission created before upload", create?.status === 201 || create?.status === 200, JSON.stringify(create && { status: create.status }));
// The request body itself is not exposed for multipart file uploads; F proves the bytes by SHA-256.
ck("D multipart upload sent to real API", !!upload && upload.type.startsWith("multipart/form-data") && upload.status === 202, JSON.stringify(upload && { type: upload.type.split(";")[0], status: upload.status }));
ck("D no demo fallback", !run.requests.some((r) => r.url.startsWith("/demo")));
info("D requests: " + run.requests.map((r) => `${r.method} ${r.url.replace(/[0-9a-f]{12,}/g, "…")} ${r.status}`).filter((v, i, a) => a.indexOf(v) === i).join(", "));
ck("E only backend states shown", run.states.every((s) => ["Uploading to the Aqualens service", "Received · waiting for the processing job", "Survey ingested · processing", "Processed · survey ready"].includes(s)), run.states.join(" → "));
ck("E no percentages", !run.sawPercent);
const railSeen = run.rails.join(" || ");
ck("E visible Uploading, Received, Ingested, Processed in order", run.rails[0]?.startsWith("Uploading:active") && run.rails.some((r) => r.startsWith("Received:done")) && run.rails.some((r) => /Ingested:done Processing:active/.test(r)) && run.rails.at(-1) === "Received:done Ingested:done Processed:done", railSeen);
await shot("ready");

// ================= F: result retrievable from backend =================
const [mission, surveys, uploads, contacts] = await Promise.all([api(`/missions/${missionId}`), api(`/missions/${missionId}/surveys`), api(`/missions/${missionId}/uploads`), api(`/missions/${missionId}/contacts?limit=200`)]);
const ui = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ready__facts > div")].map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent])));
ck("F bytes reached backend (sha256 match)", uploads.items[0]?.sha256 === sha(file(main)) && uploads.items[0]?.bytes === mainBytes, uploads.items[0]?.sha256?.slice(0, 16));
ck("F mission and survey exist in backend", mission.mission_id === missionId && !mission.demo && mission.provenance === "REAL" && surveys.items.length >= 1 && surveys.items.every((s) => s.status === "READY"));
ck("F UI counts equal backend counts", Number(ui.Surveys) === surveys.items.length && Number(ui.Contacts) === contacts.items.length, JSON.stringify({ ui, backend: { surveys: surveys.items.length, contacts: contacts.items.length } }));
info(`F real contacts: ${contacts.items.length} ${JSON.stringify(contacts.items.map((c) => c.machine?.label ?? c.machine?.class ?? null))}`);
if (contacts.items.length === 0) ck("F zero shown honestly", (await text(".ready__empty")) === "No supervised Contacts detected.");

// ================= G: roles after ingestion =================
await click(".ready .btn--primary", "Continue");
await page.waitForSelector(".roles__title", { timeout: 10000 });
await wait(700);
const names = await page.$$eval(".role__name", (e) => e.map((x) => x.textContent));
ck("G role selection after survey", (await text(".roles__title")) === "How are you working with this mission?" && JSON.stringify(names) === JSON.stringify(["Field Officer", "Sonar Analyst", "Mission Supervisor", "Decision Viewer"]), names.join(", "));
ck("G mission context visible", ((await text(".roles__mission")) ?? "").includes(mission.name));
await shot("roles");

// ================= H: each role opens its workspace =================
const HOME = { "Field Officer": "/workspace/mission", "Sonar Analyst": "/workspace/review", "Mission Supervisor": "/workspace/report", "Decision Viewer": "/workspace/overview" };
const chooseRole = async (name) => {
  if (!(await page.$(".roles"))) { await page.goto(BASE + "/workspace/roles", { waitUntil: "networkidle0" }); await wait(600); }
  await click(".role", name);
  await page.waitForSelector(".viewer-pill__role", { timeout: 10000 });
  await wait(1300);
  return page.evaluate(() => ({ path: location.pathname, role: document.querySelector(".viewer-pill__role")?.textContent, mission: document.querySelector(".bar__mission")?.textContent }));
};
for (const name of Object.keys(HOME)) {
  const r = await chooseRole(name);
  ck(`H ${name} opens its workspace`, r.path.startsWith(HOME[name]) && r.role === name && r.mission === mission.name, JSON.stringify(r));
  ck(`H ${name} no overflow`, !(await overflow()));
  await shot(`role-${name.replace(/ /g, "-").toLowerCase()}`);
}

// ================= I: change role via the role page =================
const jobsBefore = (await api(`/missions/${missionId}/jobs`)).items.length;
const missionsBefore = (await api("/missions?limit=200")).length;
const a = await chooseRole("Sonar Analyst");
await click(".viewer-pill");
await wait(300);
await click('.menu [role="menuitem"]', "Change role");
await page.waitForSelector(".roles__title", { timeout: 8000 });
await wait(500);
ck("I Change role returns to role selection", (await text(".roles__title")) === "How are you working with this mission?");
const s = await chooseRole("Mission Supervisor");
ck("I same mission after change", s.mission === a.mission && s.path.startsWith("/workspace/report"));
const jobsAfter = (await api(`/missions/${missionId}/jobs`)).items.length;
const missionsAfter = (await api("/missions?limit=200")).length;
ck("I no reprocessing, no new mission", jobsAfter === jobsBefore && missionsAfter === missionsBefore && !net.slice(-40).some((r) => r.method === "POST" && /uploads|missions$/.test(r.url)), `jobs ${jobsBefore}→${jobsAfter}, missions ${missionsBefore}→${missionsAfter}`);

// ================= J: quick role switcher =================
await click(".viewer-pill");
await wait(300);
const quick = await page.$$eval('.menu [role="menuitemradio"]', (e) => e.map((x) => x.firstChild?.nextSibling?.firstChild?.textContent ?? x.textContent));
ck("J switcher lists all four roles", ["Field Officer", "Sonar Analyst", "Mission Supervisor", "Decision Viewer"].every((r) => quick.some((q) => q.startsWith(r))), quick.join(" / "));
await shot("switcher");
await page.keyboard.press("Escape");
for (const name of ["Field Officer", "Decision Viewer", "Sonar Analyst", "Mission Supervisor"]) {
  await click(".viewer-pill");
  await wait(250);
  await click('.menu [role="menuitemradio"]', name);
  await wait(1000);
  const r = await page.evaluate(() => ({ path: location.pathname, role: document.querySelector(".viewer-pill__role")?.textContent, mission: document.querySelector(".bar__mission")?.textContent }));
  ck(`J quick switch to ${name}`, r.role === name && r.path.startsWith(HOME[name]) && r.mission === mission.name, JSON.stringify(r));
}
await page.goto(BASE + "/workspace/roles", { waitUntil: "networkidle0" });
await wait(600);
ck("J switcher and role page stay in sync", ((await text(".role.is-previous .role__name")) ?? "") === "Mission Supervisor");

// ================= K: previous surveys =================
await click(".roles__foot a", "Back to Survey Intake");
await page.waitForSelector(".previous__row", { timeout: 10000 });
await wait(900);
const rows = await page.$$eval(".previous__row", (e) => e.map((x) => x.innerText.replace(/\n/g, " | ")));
ck("K new mission listed first in Previous surveys", rows[0]?.includes(mission.name) && rows[0]?.includes("Open") && rows[0]?.includes(main), rows[0]);
await shot("intake-previous");
await click(".previous__row", mission.name);
await wait(1500);
ck("K opening it returns to that mission", (await page.evaluate(() => document.querySelector(".bar__mission")?.textContent)) === mission.name);

// ================= L: refresh recovery =================
await page.reload({ waitUntil: "networkidle0" });
await wait(1500);
ck("L reload keeps mission (backend reload)", (await page.evaluate(() => document.querySelector(".bar__mission")?.textContent)) === mission.name);
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + "/workspace", { waitUntil: "networkidle0" });
await wait(1500);
const fresh = await page.$$eval(".previous__row", (e) => e.map((x) => x.innerText.replace(/\n/g, " | ")));
ck("L with browser storage cleared, mission recovered from backend", fresh[0]?.includes(mission.name) && !fresh[0]?.includes("Open"), fresh[0]);
await click(".previous__row", mission.name);
await page.waitForSelector(".roles__title", { timeout: 8000 });
await wait(900);
ck("L recovered mission opens role selection", ((await text(".roles__mission")) ?? "").includes(mission.name));
await chooseRole("Sonar Analyst");

// ================= M: home =================
await page.evaluate(() => (window.__spa = true));
await click(".bar__mark");
await page.waitForSelector("#hero-title", { timeout: 8000 });
await wait(700);
ck("M AQUALENS returns to landing without reload", (await page.evaluate(() => location.pathname === "/" && window.__spa === true)));
await click(".cl-nav a.cta", "Launch Workspace");
await page.waitForSelector(".intake", { timeout: 8000 });
await wait(1200);
ck("M existing mission accessible after round trip", ((await page.$$eval(".previous__row", (e) => e.map((x) => x.innerText)))[0] ?? "").includes(mission.name));

// ================= N: failures =================
const failCase = async (name, expectTitle, expectRequest) => {
  const before = net.length;
  await pick(name);
  await wait(300);
  if (await page.$(".intake__actions .btn--primary")) {
    const label = await text(".intake__actions .btn--primary");
    if (label?.includes("Process survey")) await processSelected();
  }
  await wait(500);
  const r = await page.evaluate(() => ({ title: document.querySelector(".drop__state")?.textContent, msg: document.querySelector(".intake__failure p")?.textContent, ready: !!document.querySelector(".ready"), change: [...document.querySelectorAll(".intake__failure button")].map((b) => b.textContent.trim()) }));
  const reqs = net.slice(before);
  const up = reqs.find((q) => /uploads$/.test(q.url));
  ck(`N ${name}: honest error`, r.title === expectTitle && !r.ready && r.change.includes("Change file") && !reqs.some((q) => q.url.startsWith("/demo")), JSON.stringify({ ...r, upload: up?.status ?? "not sent" }));
  ck(`N ${name}: ${expectRequest ? "rejected by backend" : "not sent"}`, expectRequest ? up?.status >= 400 : !up);
  return reqs;
};
await failCase("notes.txt", "Unsupported format", false);
await shot("fail-unsupported");
const brokenReqs = await failCase("broken.png", "Unreadable raster", true);
await shot("fail-broken");
const brokenMission = brokenReqs.find((q) => /uploads$/.test(q.url))?.url.split("/")[2];
// Sending the same file again reuses the Mission its rejected attempt created.
const againReqs = await failCase("broken.png", "Unreadable raster", true);
const againMission = againReqs.find((q) => /uploads$/.test(q.url))?.url.split("/")[2];
ck("N same file again reuses its rejected Mission", !againReqs.some((q) => q.method === "POST" && q.url === "/missions") && againMission === brokenMission, `${brokenMission} / ${againMission}`);
// A different file never inherits it.
const emptyReqs = await failCase("empty-bundle.zip", "Invalid bundle", true);
const emptyMission = emptyReqs.find((q) => /uploads$/.test(q.url))?.url.split("/")[2];
ck("N different file gets its own Mission", emptyReqs.some((q) => q.method === "POST" && q.url === "/missions") && emptyMission !== brokenMission, `${brokenMission} / ${emptyMission}`);
await click(".drop__tools .icon-btn");

// ================= formats =================
if (full) {
  for (const f of ["qa-subpipe-hf-f08e01eb.jpg", "qa-viator-03.pbm", "qa-survey-bundle.zip", "qa-viator-03.png"]) {
    await page.goto(BASE + "/workspace", { waitUntil: "networkidle0" });
    await wait(800);
    await pick(f);
    await wait(300);
    const kind = await page.evaluate(() => document.querySelector(".drop__facts")?.innerText.replace(/\n/g, " · "));
    const res = await processSelected(f === "qa-survey-bundle.zip" ? "zip" : "");
    const up = res.requests.find((q) => /uploads$/.test(q.url));
    const mid = up?.url.split("/")[2];
    const [sv, ct, ups] = mid ? await Promise.all([api(`/missions/${mid}/surveys`), api(`/missions/${mid}/contacts?limit=200`), api(`/missions/${mid}/uploads`)]) : [{ items: [] }, { items: [] }, { items: [] }];
    const ok = !!(await page.$(".ready__facts"));
    ck(`FORMAT ${f} processed`, ok && up?.status === 202 && ups.items[0]?.sha256 === sha(file(f)), `${kind} | upload ${up?.status} | surveys ${sv.items.length} | frames ${sv.items.reduce((n, s) => n + s.frames.length, 0)} | contacts ${ct.items.length}`);
    if (f === "qa-survey-bundle.zip") await shot("zip-ready");
  }
  // Refresh during processing resumes from the backend's job record, and polls only that job.
  await page.goto(BASE + "/workspace", { waitUntil: "networkidle0" });
  await wait(800);
  await drop("qa-survey-bundle.zip");
  await wait(300);
  const mark = net.length;
  await click(".intake__actions .btn--primary", "Process survey");
  await page.waitForFunction(() => /processing|waiting/.test(document.querySelector(".drop__state")?.textContent ?? ""), { timeout: 60000 });
  const activeJob = await page.evaluate(() => JSON.parse(localStorage.getItem("aqualens.intake.pending") ?? "null")?.jobId);
  await page.reload({ waitUntil: "domcontentloaded" });
  const afterReload = net.length;
  await page.waitForSelector(".drop__name", { timeout: 10000 });
  const resumedName = await text(".drop__name");
  await page.waitForFunction(() => !!document.querySelector(".ready__facts") || !!document.querySelector(".drop.is-failed"), { timeout: 240000 });
  const polled = [...new Set(net.slice(afterReload).filter((q) => /^\/jobs\//.test(q.url)).map((q) => q.url))];
  ck("REFRESH resumes the active job from the backend", resumedName === "qa-survey-bundle.zip" && !!(await page.$(".ready__facts")), `${resumedName}, job ${activeJob}`);
  ck("REFRESH polls only the active job", polled.length === 1 && polled[0] === `/jobs/${activeJob}`, polled.join(", "));
  ck("REFRESH resume sends no new upload", !net.slice(afterReload).some((q) => q.method === "POST"));
  info("zip refresh run requests before reload: " + net.slice(mark, afterReload).filter((q) => q.method === "POST").map((q) => `${q.url} ${q.status}`).join(", "));
}

// ================= O: demo separation =================
await page.goto(BASE + "/workspace?demo=1", { waitUntil: "networkidle0" });
await wait(1500);
const demo = await page.evaluate(() => ({ path: location.pathname, intake: !!document.querySelector(".intake"), tag: !!document.querySelector(".demo-tag"), mission: document.querySelector(".roles__mission, .bar__mission")?.textContent }));
ck("O demo opens deterministic demo, labelled", !demo.intake && demo.tag, JSON.stringify(demo));
await shot("demo");
await page.goto(BASE + "/workspace", { waitUntil: "networkidle0" });
await wait(1200);
const realAfter = await page.evaluate(() => ({ intake: !!document.querySelector(".intake"), demoRows: [...document.querySelectorAll(".previous__row")].filter((r) => /demo/i.test(r.textContent)).length }));
ck("O /workspace after demo is real mode, no demo state", realAfter.intake && realAfter.demoRows === 0, JSON.stringify(realAfter));

// ================= appearance =================
for (const scheme of ["light", "dark"]) {
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
  await page.goto(BASE + "/workspace", { waitUntil: "networkidle0" });
  await wait(900);
  await pick(main);
  await wait(400);
  const theme = await page.evaluate(() => document.querySelector(".ws")?.dataset.theme);
  ck(`THEME intake ${scheme}`, theme === scheme && !(await overflow()));
  await shot(`intake-${scheme}`);
}

const unexpected = net.filter((r) => typeof r.status === "string" || (r.status >= 400 && !/uploads$/.test(r.url)));
ck("NETWORK no unexpected errors", unexpected.length === 0, unexpected.map((r) => `${r.method} ${r.url} ${r.status}`).join(", "));
ck("CONSOLE no errors", errors.length === 0, errors.join(" | "));
info("mission under test: " + missionId + " " + mission.name);
await finish();
