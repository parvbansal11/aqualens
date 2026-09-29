// Landing geometry and copy checks. usage: node qa/landing-check.mjs <w>x<h>
import puppeteer from "puppeteer-core";
const [w, h] = (process.argv[2] ?? "1440x900").split("x").map(Number);
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const p = await b.newPage(); await p.setViewport({ width: w, height: h });
const errs = []; p.on("console", (m) => m.type() === "error" && errs.push(m.text())); p.on("pageerror", (e) => errs.push(String(e)));
await p.goto("http://127.0.0.1:5320/", { waitUntil: "networkidle0" }); await p.evaluate(() => document.fonts.ready); await new Promise((r) => setTimeout(r, 800));
const r = await p.evaluate(() => {
  const fit = (el) => { const g = document.createRange(); g.selectNodeContents(el); return { text: Math.round(g.getBoundingClientRect().right), box: Math.round(el.getBoundingClientRect().right) }; };
  return { hero: fit(document.querySelector("#hero-title")), closing: fit(document.querySelector(".cl-closing-word")), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, copy: /Hackathon|SIH|26057|NIOT|Ministry of Earth/i.test(document.body.innerText) };
});
const out = [
  [`hero wordmark fits (${r.hero.text} ≤ ${r.hero.box})`, r.hero.text <= r.hero.box],
  [`closing wordmark fits (${r.closing.text} ≤ ${r.closing.box})`, r.closing.text <= r.closing.box],
  ["no horizontal overflow", !r.overflow], ["no competition copy", !r.copy], ["no console errors", !errs.length],
];
console.log(out.map(([l, ok]) => `${ok ? "PASS" : "FAIL"} ${w}x${h} ${l}`).join("\n"));
await b.close();
