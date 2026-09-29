// Regression: a real upload must never inherit Demo context, and a bundle that supplies a synthetic
// survey track is ingested normally with its provenance kept. Real browser UI, real local API, nothing mocked.
// usage: node qa/demo-contamination.mjs <real-raster> <synthetic-navigation-zip>
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const [raster, syntheticZip] = process.argv.slice(2);
const BASE = process.env.AQUALENS_WEB ?? "http://127.0.0.1:5320";
const API = process.env.AQUALENS_API ?? "http://127.0.0.1:8000/api/v1";
const out = new URL("./out/demo-contamination/", import.meta.url).pathname;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
const net = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()));
page.on("request", (r) => r.url().startsWith(API) && net.push({ id: r, method: r.method(), url: r.url().slice(API.length) }));
page.on("response", (r) => { const n = net.find((x) => x.id === r.request()); if (n) n.status = r.status(); });
const R = [];
const ck = (l, ok, i = "") => R.push(`${ok ? "PASS" : "FAIL"} ${l}${i ? ` | ${i}` : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (sel, t) => page.evaluate((sel, t) => { const e = [...document.querySelectorAll(sel)].find((x) => !t || x.textContent.trim().includes(t)); e?.click(); return !!e; }, sel, t);
const api = (p) => fetch(API + p).then((r) => r.json());
const storage = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("aqualens")).map((k) => [k, localStorage.getItem(k)])));
const processAndWait = async () => {
  const before = net.length;
  await click(".intake__actions .btn--primary", "Process survey");
  await page.waitForFunction(() => !!document.querySelector(".ready__facts") || !!document.querySelector(".drop.is-failed"), { timeout: 300000 });
  await wait(500);
  return net.slice(before);
};

// ---- A: open the Demo Mission explicitly ----
await page.evaluateOnNewDocument(() => { if (!sessionStorage.getItem("k")) { localStorage.clear(); sessionStorage.setItem("k", "1"); } });
await page.goto(BASE + "/", { waitUntil: "networkidle0" });
await page.goto(BASE + "/workspace?demo=1", { waitUntil: "networkidle0" });
await wait(1200);
if (await page.$(".roles")) { await click(".role", "Sonar Analyst"); await wait(1500); }
const demoOpen = await page.evaluate(() => ({ mission: document.querySelector(".bar__mission")?.textContent, tag: !!document.querySelector(".bar .demo-tag, .bar__mission .demo-tag") }));
ck("A demo mission explicitly open", /DEMO/i.test(demoOpen.mission ?? "") || demoOpen.tag, JSON.stringify(demoOpen));
const afterDemo = await storage();
ck("A demo visit writes no real-Mission pointer", !("aqualens.workspace.liveMission" in afterDemo), JSON.stringify(afterDemo));
await page.screenshot({ path: `${out}0-demo.png` });

// ---- B: back to Survey Intake the way a person does: AQUALENS home, then Launch Workspace ----
await click(".bar__mark");
await page.waitForSelector("#hero-title", { timeout: 8000 });
await click(".cl-hero a.cta", "Launch Workspace");
await page.waitForSelector(".intake", { timeout: 8000 });
await wait(1000);
ck("B intake shown, no demo row in Previous surveys", !(await page.evaluate(() => [...document.querySelectorAll(".previous__row")].some((r) => /demo/i.test(r.textContent)))));

// ---- C, D, E: a new real file never inherits the Demo Mission ----
await (await page.$('.intake input[type="file"]')).uploadFile(raster);
await wait(300);
const reqs = await processAndWait();
const create = reqs.find((q) => q.method === "POST" && q.url === "/missions");
const upload = reqs.find((q) => q.method === "POST" && /\/uploads$/.test(q.url));
const mid = upload?.url.split("/")[2];
const mission = mid ? await api(`/missions/${mid}`) : {};
const uploads = mid ? await api(`/missions/${mid}/uploads`) : { items: [] };
ck("E a new real Mission is created for the upload", create?.status === 201 && !!mid && !mid.startsWith("demo_"), `${create?.status} ${mid}`);
ck("E the Mission is not Demo", mission.demo === false && mission.provenance === "REAL", JSON.stringify({ demo: mission.demo, provenance: mission.provenance }));
ck("E no request touched a demo record", !reqs.some((q) => /demo/.test(q.url)));
ck("E bytes reached backend", uploads.items[0]?.sha256 === sha(raster), uploads.items[0]?.sha256?.slice(0, 16));
ck("E processed to ready", !!(await page.$(".ready__facts")));
await page.screenshot({ path: `${out}1-real-after-demo.png` });

// ---- The user's bundle that declares synthetic navigation ----
if (syntheticZip && fs.existsSync(syntheticZip)) {
  await page.goto(BASE + "/workspace", { waitUntil: "networkidle0" });
  await wait(800);
  await (await page.$('.intake input[type="file"]')).uploadFile(syntheticZip);
  await wait(300);
  const sel = await page.evaluate(() => ({ name: document.querySelector(".drop__name")?.textContent, facts: document.querySelector(".drop__facts")?.innerText.replace(/\n/g, " · ") }));
  const zreqs = await processAndWait();
  const zc = zreqs.find((q) => q.method === "POST" && q.url === "/missions");
  const zu = zreqs.find((q) => q.method === "POST" && /\/uploads$/.test(q.url));
  const zmid = zu?.url.split("/")[2];
  const zm = zmid ? await api(`/missions/${zmid}`) : {};
  const ui = await page.evaluate(() => ({ state: document.querySelector(".drop__state")?.textContent, message: document.querySelector(".intake__failure p")?.textContent, ready: !!document.querySelector(".ready"), demoRows: [...document.querySelectorAll(".previous__row")].filter((r) => /demo/i.test(r.textContent)).length }));
  R.push(`INFO zip selected: ${JSON.stringify(sel)}`);
  const zu2 = zmid ? await api(`/missions/${zmid}/uploads`) : { items: [] };
  ck("Z upload went to a fresh non-demo Mission", zc?.status === 201 && zm.demo === false && !zmid?.startsWith("demo_"), `${zmid} demo=${zm.demo}`);
  ck("Z bundle with a supplied synthetic track is accepted normally (202)", zu?.status === 202 && ui.ready, `${zu?.status}`);
  ck("Z no warning text in the intake", !/synthetic|demo/i.test(ui.message ?? "") && !/synthetic/i.test(ui.state ?? ""), JSON.stringify(ui));
  ck("Z provenance kept internally, never MEASURED", zu2.items[0]?.navigation_provenance === "SYNTHETIC_DEMO");
  ck("Z no demo fallback", !zreqs.some((q) => /demo/.test(q.url)) && ui.demoRows === 0);
  await page.screenshot({ path: `${out}2-supplied-track-accepted.png` });
}

ck("no console errors", errors.length === 0, errors.join(" | "));
fs.writeFileSync(`${out}results.txt`, R.join("\n"));
console.log(R.join("\n"));
await browser.close();
