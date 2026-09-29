// Hero video lifecycle QA under default autoplay policy. usage: node qa/hero-video.mjs [source: webm|mp4]
import puppeteer from "puppeteer-core";
const force = process.argv[2];
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
const errs = []; p.on("console", (m) => m.type() === "error" && errs.push(m.text())); p.on("pageerror", (e) => errs.push(String(e)));
if (force === "mp4") {
  // Refuse the WebM so the element falls through to the H.264 source, as a browser without VP9 would.
  await p.setRequestInterception(true);
  p.on("request", (r) => (r.url().endsWith(".webm") ? r.respond({ status: 404, body: "" }) : r.continue()));
}
const R = []; const ck = (l, ok, i = "") => R.push(`${ok ? "PASS" : "FAIL"} ${l}${i ? " — " + i : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const v = () => p.evaluate(() => { const e = document.querySelector(".cl-ocean video"); return e && { paused: e.paused, t: +e.currentTime.toFixed(2), src: e.currentSrc.split("/").pop(), muted: e.muted, loop: e.loop, inline: e.playsInline, auto: e.autoplay }; });
const btn = (label) => p.evaluate((label) => { const b = [...document.querySelectorAll(".cl-text-button")].find((x) => x.textContent.includes(label)); b?.click(); return !!b; }, label);
await p.goto("http://127.0.0.1:5320/", { waitUntil: "networkidle2" });
await wait(1500);
const a = await v(); ck("A starts automatically", a && !a.paused && a.t > 0 && a.muted && a.loop && a.inline && a.auto, JSON.stringify(a));
// B: sample through the first natural end (16.37s) without seeking.
let wrapped = false, prev = a.t;
for (let i = 0; i < 26; i++) { await wait(1000); const s = await v(); if (s.t < prev) wrapped = true; prev = s.t; }
const b2 = await v(); ck("B plays past its first natural end and loops", wrapped && !b2.paused, JSON.stringify(b2));
await p.evaluate(() => scrollTo(0, 2600)); await wait(2500); const c1 = await v();
await p.evaluate(() => scrollTo(0, 0)); await wait(1500); const c2 = await v();
ck("C scroll down and up, still playing", !c1.paused && !c2.paused && c2.t !== c1.t, `${c1.t}→${c2.t}`);
await p.evaluate(() => scrollTo(0, innerHeight * 0.6)); const d1 = await v(); await wait(2000); const d2 = await v();
ck("D hero partially off-screen, playing", !d2.paused && d2.t !== d1.t);
await p.evaluate(() => scrollTo(0, 0)); await wait(400);
await btn("Pause background"); await wait(500); const e = await v();
ck("E Pause background pauses", e.paused && (await p.evaluate(() => document.querySelector(".cl-text-button").textContent)) === "Resume background");
for (const y of [900, 2400, 300, 0]) { await p.evaluate((y) => scrollTo(0, y), y); await wait(900); }
await wait(2500); const f = await v(); ck("F scroll while paused, stays paused", f.paused && f.t === e.t, `${e.t}/${f.t}`);
await btn("Resume background"); await wait(1200); const g = await v(); ck("G Resume background plays", !g.paused && g.t > f.t);
await p.evaluate(() => { const a = document.querySelector('.cl-hero a.cta[href="/workspace"]'); a.click(); }); await wait(1500);
ck("H1 left landing (video unmounted)", !(await p.$(".cl-ocean video")) && (await p.evaluate(() => location.pathname)) === "/workspace");
await p.evaluate(() => document.querySelector(".home-mark").click()); await wait(1800); const h = await v();
ck("H leave landing and return, autoplay resumes", h && !h.paused && h.t > 0, JSON.stringify(h));
// Fallbacks: an engine that ends instead of looping, and a stall the browser never reports.
await p.evaluate(() => { const e = document.querySelector(".cl-ocean video"); e.loop = false; e.currentTime = e.duration - 0.5; });
await wait(2500); const j = await v(); ck("J ended fallback restarts from 0", !j.paused && j.t < 3, JSON.stringify(j));
await p.evaluate(() => { const e = document.querySelector(".cl-ocean video"); e.loop = true; e.play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.pause.call(e); });
await wait(2200); const k = await v(); ck("K external pause is resumed (not user-chosen)", !k.paused);
const ignoreMissingWebm = (m) => !(force === "mp4" && /404|webm/i.test(m));
ck("I no console errors", errs.filter(ignoreMissingWebm).length === 0, errs.join(" | "));
console.log(R.join("\n")); await b.close();
