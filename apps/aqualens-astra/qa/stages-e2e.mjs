// How It Works regression: autoplay cycles, wrap-around, rapid input, timer ownership, Verify layout.
// usage: node qa/stages-e2e.mjs <w>x<h> [--quick]   (--quick runs one autoplay cycle instead of two)
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const [size = "1440x900", flag] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const BASE = process.env.AQUALENS_WEB ?? "http://127.0.0.1:5320";
const STAGE_MS = 6500;
const HOLD_MS = 12000;
const NAMES = ["Ingest", "Assess", "Detect", "Verify", "Fuse", "Localize", "Review", "Prioritize", "Report"];
const out = new URL(`./out/stages-${size}/`, import.meta.url).pathname;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const R = [];
const ck = (l, ok, i = "") => { R.push(`${ok ? "PASS" : "FAIL"} ${l}${i ? ` | ${i}` : ""}`); return ok; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });

async function open(reduced = false) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  if (reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  // Count pending auto-advance timers (the only timers using these delays).
  await page.evaluateOnNewDocument((delays) => {
    const pending = new Set();
    window.__stageTimers = { max: 0, now: () => pending.size };
    const set = window.setTimeout.bind(window);
    const clear = window.clearTimeout.bind(window);
    window.setTimeout = (fn, ms, ...a) => {
      if (!delays.includes(ms)) return set(fn, ms, ...a);
      const h = set(() => { pending.delete(h); fn(...a); }, ms);
      pending.add(h);
      window.__stageTimers.max = Math.max(window.__stageTimers.max, pending.size);
      return h;
    };
    window.clearTimeout = (h) => { pending.delete(h); clear(h); };
  }, [STAGE_MS, HOLD_MS]);
  await page.goto(BASE + "/", { waitUntil: "networkidle0" });
  await page.evaluate(() => document.querySelector("#method").scrollIntoView({ block: "start" }));
  await wait(1200);
  return { page, errors };
}

const state = (page) => page.evaluate(() => {
  const sec = document.querySelector("#method");
  const text = document.querySelector(".cl-stage-text");
  return {
    stage: Number(sec.dataset.stage),
    autoplay: sec.dataset.autoplay,
    title: document.querySelector(".cl-stage-text h3")?.textContent,
    number: document.querySelector(".cl-stage-number")?.firstChild?.textContent,
    selected: [...document.querySelectorAll('.cl-stage-rail [role="tab"]')].findIndex((t) => t.getAttribute("aria-selected") === "true"),
    scene: document.querySelectorAll(".cl-scene.is-entering > svg").length,
    textOpacity: text ? Number(getComputedStyle(text).opacity) : 0,
    rootChildren: document.getElementById("root").children.length,
    focus: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName,
    y: Math.round(scrollY),
    timers: window.__stageTimers.now(),
    maxTimers: window.__stageTimers.max,
  };
});
const consistent = (s) => s.stage >= 0 && s.stage <= 8 && s.title === NAMES[s.stage] && s.number === String(s.stage + 1).padStart(2, "0") && s.selected === s.stage && s.scene === 1 && s.rootChildren > 0;
const clickBtn = async (page, label, n, delay = 0) => {
  const box = await (await page.$(`button[aria-label="${label}"]`)).boundingBox();
  for (let i = 0; i < n; i++) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay });
};

// ---------- autoplay cycles ----------
{
  const { page, errors } = await open();
  const cycles = flag === "--quick" ? 1 : 2;
  const seen = [];
  const t0 = Date.now();
  let last = null;
  let lastAt = Date.now();
  const gaps = [];
  let everyConsistent = true;
  let maxPending = 0;
  while (seen.length < 9 * cycles + 1 && Date.now() - t0 < (9 * cycles + 3) * STAGE_MS) {
    const s = await state(page);
    maxPending = Math.max(maxPending, s.timers);
    if (s.stage !== last) {
      if (last !== null) gaps.push(Date.now() - lastAt);
      lastAt = Date.now();
      last = s.stage;
      seen.push(s.stage);
      await wait(700);
      const settled = await state(page);
      everyConsistent &&= consistent(settled) && settled.textOpacity > 0.95;
      if (seen.length <= 9) await page.screenshot({ path: `${out}stage-${String(settled.stage + 1).padStart(2, "0")}.png` });
    }
    await wait(200);
  }
  const expected = Array.from({ length: 9 * cycles + 1 }, (_, i) => i % 9);
  ck(`1 autoplay ran ${cycles} full cycle${cycles > 1 ? "s" : ""} in order`, JSON.stringify(seen) === JSON.stringify(expected), seen.map((s) => s + 1).join("→"));
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  ck("1 stage interval is the calm reading time", Math.abs(mean - STAGE_MS) < 700, `mean ${Math.round(mean)} ms over ${gaps.length} steps`);
  ck("2 every stage rendered complete (number, title, rail, scene, visible text)", everyConsistent);
  ck("11 never more than one auto-advance timer", maxPending <= 1 && (await state(page)).maxTimers <= 1, `max ${maxPending}`);
  ck("8 09 → 01 wrap during autoplay", seen.join(",").includes("8,0"));
  ck("autoplay: no console errors", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- manual input ----------
{
  const { page, errors } = await open();
  const y0 = (await state(page)).y;
  let s = await state(page);
  const start = s.stage;
  await clickBtn(page, "Next stage", 30);
  await wait(700);
  s = await state(page);
  ck("3 rapid right ×30 lands on the right stage, complete", s.stage === (start + 30) % 9 && consistent(s) && s.textOpacity > 0.95, `stage ${s.stage + 1}`);
  ck("3 focus stays on the Next button", s.focus === "Next stage", s.focus);
  const before = s.stage;
  await page.keyboard.press("Space");
  await wait(700);
  s = await state(page);
  ck("13 Space on the focused arrow advances, page does not scroll away", s.stage === (before + 1) % 9 && Math.abs(s.y - y0) < 5, `stage ${s.stage + 1}, dy ${s.y - y0}`);

  const b = (await state(page)).stage;
  await clickBtn(page, "Previous stage", 30);
  await wait(700);
  s = await state(page);
  ck("4 rapid left ×30 lands on the right stage, complete", s.stage === ((b - 30) % 9 + 9) % 9 && consistent(s) && s.textOpacity > 0.95, `stage ${s.stage + 1}`);

  const nb = await (await page.$('button[aria-label="Next stage"]')).boundingBox();
  const pb = await (await page.$('button[aria-label="Previous stage"]')).boundingBox();
  const a0 = (await state(page)).stage;
  for (let i = 0; i < 40; i++) {
    const t = i % 2 ? pb : nb;
    await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
  }
  await wait(700);
  s = await state(page);
  ck("5 alternating left/right ×40 returns to the same stage, complete", s.stage === a0 && consistent(s), `stage ${s.stage + 1}`);

  // 9 and 8: explicit wrap in both directions.
  await page.evaluate(() => document.querySelectorAll('.cl-stage-rail [role="tab"]')[0].click());
  await wait(300);
  await clickBtn(page, "Previous stage", 1);
  await wait(700);
  s = await state(page);
  ck("9 01 + left → 09", s.stage === 8 && consistent(s));
  await clickBtn(page, "Next stage", 1);
  await wait(700);
  s = await state(page);
  ck("8 09 + right → 01", s.stage === 0 && consistent(s));

  // 6: every rail item.
  let railOk = true;
  for (let i = 0; i < 9; i++) {
    const tab = await page.$(`#stage-tab-${i}`);
    await tab.click();
    await wait(650);
    const r = await state(page);
    railOk &&= r.stage === i && consistent(r) && r.textOpacity > 0.95;
  }
  ck("6 each rail item selects its stage atomically", railOk);

  // Rapid rail sequence, then left/right/left/09/01 as in the brief.
  for (const i of [3, 7, 1, 8, 0, 5, 2, 8, 0]) await page.evaluate((i) => document.querySelectorAll('.cl-stage-rail [role="tab"]')[i].click(), i);
  await clickBtn(page, "Previous stage", 1);
  await clickBtn(page, "Next stage", 1);
  await clickBtn(page, "Previous stage", 1);
  await page.evaluate(() => document.querySelectorAll('.cl-stage-rail [role="tab"]')[8].click());
  await page.evaluate(() => document.querySelectorAll('.cl-stage-rail [role="tab"]')[0].click());
  await wait(700);
  s = await state(page);
  ck("12 rapid mixed input ends complete, never blank", s.stage === 0 && consistent(s) && s.textOpacity > 0.95 && s.maxTimers <= 1, `max timers ${s.maxTimers}`);

  // 7: a manual choice holds, then the cycle resumes by one step.
  await page.evaluate(() => document.querySelectorAll('.cl-stage-rail [role="tab"]')[3].click());
  const tPick = Date.now();
  await page.waitForFunction(() => document.querySelector("#method").dataset.stage === "4", { timeout: HOLD_MS + 4000, polling: 100 });
  const held = Date.now() - tPick;
  ck("7 manual choice holds for reading, then autoplay resumes to the next stage", held > HOLD_MS - 600 && held < HOLD_MS + 1500, `held ${held} ms`);

  // 10: scroll away pauses (no timer), scroll back resumes.
  await page.evaluate(() => window.scrollTo(0, document.querySelector("#product").offsetTop + 400));
  await wait(1500);
  const away = await state(page);
  await wait(STAGE_MS + 1500);
  const awayLater = await state(page);
  ck("10 away from the section: paused, no pending timer, stage unchanged", away.autoplay === "paused" && awayLater.timers === 0 && awayLater.stage === away.stage);
  await page.evaluate(() => document.querySelector("#method").scrollIntoView({ block: "start" }));
  await wait(1500);
  const back = await state(page);
  ck("10 back on the section: running again with one timer", back.autoplay === "running" && back.timers === 1);

  // Pause control.
  await page.click(".cl-autoplay");
  await wait(300);
  const p1 = await state(page);
  await wait(STAGE_MS + 1000);
  const p2 = await state(page);
  ck("Pause control stops the cycle", p1.autoplay === "paused" && p2.stage === p1.stage && p2.timers === 0);
  await page.click(".cl-autoplay");
  await wait(300);
  ck("Play control resumes", (await state(page)).autoplay === "running");

  // 15: Verify labels occupy separate space.
  await page.evaluate(() => document.querySelectorAll('.cl-stage-rail [role="tab"]')[3].click());
  await wait(900);
  const lay = await page.evaluate(() => {
    const scene = document.querySelector(".cl-scene.is-entering");
    const rect = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, text: e.textContent }; };
    const texts = [...scene.querySelectorAll("text")].map(rect);
    const profile = rect(scene.querySelector("path.profile"));
    const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const overlaps = [];
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) if (hit(texts[i], texts[j])) overlaps.push(`${texts[i].text} × ${texts[j].text}`);
    const intoProfile = texts.filter((t) => hit(t, profile)).map((t) => t.text);
    const visible = texts.every((t) => t.r - t.l > 4 && t.b - t.t > 4);
    const minHeight = Math.min(...texts.map((t) => t.b - t.t));
    return { overlaps, intoProfile, visible, count: texts.length, minHeight: Math.round(minHeight * 10) / 10 };
  });
  ck("15 Verify: no label overlaps another", lay.overlaps.length === 0 && lay.count === 4, lay.overlaps.join(", "));
  ck("15 Verify: labels clear of the intensity profile", lay.intoProfile.length === 0, lay.intoProfile.join(", "));
  ck("15 Verify: all four labels visible", lay.visible, `smallest glyph box ${lay.minHeight}px`);
  const panel = await page.$(".cl-sonar-panel");
  await panel.screenshot({ path: `${out}verify.png` });
  ck("14 manual: no console errors", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------- 16: reduced motion ----------
{
  const { page, errors } = await open(true);
  const s0 = await state(page);
  await wait(STAGE_MS + 1500);
  const s1 = await state(page);
  ck("16 reduced motion: no automatic advance, Play offered", s0.autoplay === "paused" && s1.stage === s0.stage && s1.timers === 0 && (await page.$eval(".cl-autoplay", (b) => b.textContent)) === "Play");
  await clickBtn(page, "Next stage", 3);
  await wait(200);
  const s2 = await state(page);
  ck("16 reduced motion: arrows work, content complete", s2.stage === 3 && consistent(s2));
  ck("16 reduced motion: no progress animation", !(await page.$(".cl-rail-progress")) || (await page.$eval(".cl-rail-progress", (e) => getComputedStyle(e).display)) === "none");
  ck("16 reduced motion: no console errors", errors.length === 0, errors.join(" | "));
  await page.close();
}

fs.writeFileSync(`${out}results.txt`, R.join("\n"));
console.log(R.join("\n"));
await browser.close();
