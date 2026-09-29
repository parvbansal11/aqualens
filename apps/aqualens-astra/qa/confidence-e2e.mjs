// Product confidence acceptance: every operator surface shows display_confidence, raw stays technical.
// usage: node qa/confidence-e2e.mjs <w>x<h> [mission-name-regex]
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const [size = "1440x900", pattern = "Epitome v4"] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const BASE = process.env.AQUALENS_WEB ?? "http://127.0.0.1:5320";
const API = process.env.AQUALENS_API ?? "http://127.0.0.1:8000/api/v1";
const out = new URL(`./out/confidence-${size}/`, import.meta.url).pathname;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const R = [];
const ck = (l, ok, i = "") => { R.push(`${ok ? "PASS" : "FAIL"} ${l}${i ? ` | ${i}` : ""}`); return ok; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (p) => fetch(API + p).then((r) => r.json());
/** The historical SagarDrishti mapping (DEMO_BOUNDED_SIGMOID_V1). */
const historical = (x) => 0.70 + 0.20 / (1 + Math.exp(-28 * (x - 0.3139777305538386)));
const name = (c) => `C-${c.contact_id.slice(-6).toUpperCase()}`;
const OLD_COPY = /Detector score|Raw score from the frozen detector/;

const missions = await api("/missions?limit=200");
const mission = missions.filter((m) => new RegExp(pattern).test(m.name)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
if (!mission) throw new Error(`No mission matching ${pattern}`);
const contacts = (await api(`/missions/${mission.mission_id}/contacts?limit=200`)).items.filter((c) => c.machine);

// ---------- API: both values, historical mapping, monotonic, same raw → same display ----------
ck("API exposes raw_detector_score and display_confidence on every Contact", contacts.length > 0 && contacts.every((c) => typeof c.machine.raw_detector_score === "number" && typeof c.machine.display_confidence === "number"), `${contacts.length} Contacts`);
ck("display = historical mapping of the raw score", contacts.every((c) => Math.abs(c.machine.display_confidence - historical(c.machine.raw_detector_score)) < 1e-9));
ck("display within 0.70..0.90", contacts.every((c) => c.machine.display_confidence >= 0.70 && c.machine.display_confidence <= 0.90), `${Math.min(...contacts.map((c) => c.machine.display_confidence)).toFixed(3)}..${Math.max(...contacts.map((c) => c.machine.display_confidence)).toFixed(3)}`);
const byRaw = [...contacts].sort((a, b) => a.machine.raw_detector_score - b.machine.raw_detector_score);
ck("ordering monotonic in raw score", byRaw.every((c, i) => i === 0 || c.machine.display_confidence >= byRaw[i - 1].machine.display_confidence));
const groups = new Map();
for (const c of contacts) groups.set(c.machine.raw_detector_score, [...(groups.get(c.machine.raw_detector_score) ?? []), c.machine.display_confidence]);
ck("same raw score → same display", [...groups.values()].every((v) => new Set(v).size === 1));

const crab = byRaw.filter((c) => c.machine.supervised_class === "CRAB_POT");
const pipe = byRaw.filter((c) => c.machine.supervised_class === "PIPELINE");
const samples = [
  ["CRAB_POT (typical)", crab[Math.floor(crab.length / 2)]],
  ["PIPELINE", pipe.at(-1)],
  ["lowest raw score", byRaw[0]],
  ["highest raw score", byRaw.at(-1)],
].filter(([, c]) => c);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width, height });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.evaluate((id) => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem("aqualens.workspace.liveMission", id); localStorage.setItem("aqualens.workspace.role", "sonar-analyst"); }, mission.mission_id);

// ---------- Review ----------
for (const [label, c] of samples) {
  await page.goto(`${BASE}/workspace/review/${c.contact_id}`, { waitUntil: "networkidle2" });
  await page.waitForSelector(".machine__score-value", { timeout: 20000 });
  await wait(500);
  const r = await page.evaluate(() => ({ label: document.querySelector(".machine__score-label")?.textContent.trim(), value: document.querySelector(".machine__score-value")?.textContent.trim(), note: document.querySelector(".insp__note")?.textContent, main: document.querySelector("#ws-main")?.innerText ?? "" }));
  ck(`Review ${label} ${name(c)}: Confidence ${c.machine.display_confidence.toFixed(2)} (raw ${c.machine.raw_detector_score.toFixed(4)})`, /^Confidence/.test(r.label) && r.value === c.machine.display_confidence.toFixed(2) && !OLD_COPY.test(r.main), `${r.label} ${r.value}`);
}
await page.evaluate(() => document.querySelector(".insp__tech")?.setAttribute("open", ""));
await wait(300);
const tech = await page.evaluate(() => document.querySelector(".insp__tech")?.innerText ?? "");
const last = samples.at(-1)[1];
ck("Review technical details keep the raw score, display value and mapping", tech.includes(last.machine.raw_detector_score.toFixed(4)) && tech.includes(last.machine.display_confidence.toFixed(4)) && /Historical product normalization/.test(tech), tech.replace(/\n/g, " · ").slice(0, 140));
await page.screenshot({ path: `${out}review.png` });

// ---------- Contacts ----------
await page.goto(`${BASE}/workspace/contacts`, { waitUntil: "networkidle2" });
await wait(1500);
const rowsText = await page.evaluate(() => [...document.querySelectorAll("tbody tr")].map((r) => r.innerText.replace(/\s+/g, " ")));
const listText = await page.evaluate(() => document.querySelector("#ws-main")?.innerText ?? "");
const rowOk = contacts.every((c) => rowsText.some((r) => r.includes(name(c)) && r.includes(c.machine.display_confidence.toFixed(2)) && !r.includes(c.machine.raw_detector_score.toFixed(4))));
ck("Contacts: every row shows its display confidence, no raw-score copy", rowOk && !OLD_COPY.test(listText), rowsText[0]);
await page.screenshot({ path: `${out}contacts.png` });

// ---------- Map inspector ----------
await page.goto(`${BASE}/workspace/map`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__aqMap && window.__aqMap.isStyleLoaded(), { timeout: 30000 }).catch(() => {});
await page.waitForSelector(".mm-row", { timeout: 20000 });
await page.evaluate((n) => [...document.querySelectorAll(".mm-row")].find((r) => r.textContent.includes(n))?.click(), name(pipe.at(-1) ?? byRaw.at(-1)));
await wait(1500);
const insp = await page.evaluate(() => document.querySelector(".mm-insp")?.innerText ?? "");
const mc = pipe.at(-1) ?? byRaw.at(-1);
ck("Map inspector: Confidence equals display_confidence, raw not shown", new RegExp(`Confidence\\s+${mc.machine.display_confidence.toFixed(2)}`).test(insp) && !insp.includes(mc.machine.raw_detector_score.toFixed(2)) && !OLD_COPY.test(insp), insp.split("\n").slice(0, 8).join(" · "));
await page.screenshot({ path: `${out}map.png` });

// ---------- Report ----------
await page.goto(`${BASE}/workspace/report`, { waitUntil: "networkidle2" });
await page.waitForSelector("#r-contacts", { timeout: 30000 });
await wait(1200);
const rep = await page.evaluate(() => ({ contacts: document.querySelector("#r-contacts")?.innerText ?? "", model: document.querySelector("#r-model")?.innerText ?? "" }));
ck("Report contacts table shows confidence, not raw", contacts.every((c) => rep.contacts.includes(`confidence ${c.machine.display_confidence.toFixed(2)}`)) && !contacts.some((c) => rep.contacts.includes(c.machine.raw_detector_score.toFixed(4))));
ck("Report technical provenance keeps every raw score", contacts.every((c) => rep.model.includes(c.machine.raw_detector_score.toFixed(4))));
await page.evaluate(() => document.querySelector("#r-model")?.scrollIntoView());
await wait(500);
await page.screenshot({ path: `${out}report-model.png` });

ck("no console errors", errors.length === 0, errors.join(" | "));
R.push(`INFO mission ${mission.mission_id} "${mission.name}"`);
for (const c of byRaw) R.push(`INFO ${name(c)} ${c.machine.supervised_class} raw ${c.machine.raw_detector_score.toFixed(4)} → ${c.machine.display_confidence.toFixed(3)}`);
fs.writeFileSync(`${out}results.txt`, R.join("\n"));
console.log(R.join("\n"));
await browser.close();
