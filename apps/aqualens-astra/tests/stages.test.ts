// How It Works stage cycle: bounds, wrap-around and timer ownership. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AutoAdvance, nextStage, previousStage, wrap, type Clock } from "../src/lib/stages.ts";

const N = 9;

test("next from the last stage returns to the first; previous from the first returns to the last", () => {
  assert.equal(nextStage(8, N), 0);
  assert.equal(previousStage(0, N), 8);
});

test("every index stays within 0..8 through long random manual navigation", () => {
  let i = 0;
  let seed = 7;
  for (let k = 0; k < 20000; k++) {
    seed = (seed * 16807) % 2147483647;
    const r = seed % 5;
    i = r === 0 ? nextStage(i, N) : r === 1 ? previousStage(i, N) : r === 2 ? wrap(seed % 40 - 20, N) : r === 3 ? wrap(i + 9 * k, N) : wrap(i - 9 * k, N);
    assert.ok(Number.isInteger(i) && i >= 0 && i < N, `index ${i} after step ${k}`);
  }
});

test("wrap never produces an empty stage for any input", () => {
  for (const v of [-1, -9, -10, 9, 17, 1e9, -1e9, 3.7, -0.2, NaN, Infinity, -Infinity]) {
    const i = wrap(v, N);
    assert.ok(i >= 0 && i < N, `${v} → ${i}`);
  }
});

/** A manual clock that records live timers. */
function fakeClock() {
  let id = 0;
  const live = new Map<number, () => void>();
  const clock: Clock = {
    set: (fn) => {
      live.set(++id, fn);
      return id;
    },
    clear: (h) => void live.delete(h as number),
  };
  const fire = () => {
    const [[h, fn]] = [...live];
    live.delete(h);
    fn();
  };
  return { clock, live, fire };
}

test("rescheduling repeatedly keeps exactly one pending timer", () => {
  const { clock, live } = fakeClock();
  const cycle = new AutoAdvance(clock, () => {});
  for (let k = 0; k < 50; k++) cycle.schedule(k % 2 ? 6500 : 12000);
  assert.equal(live.size, 1);
  assert.equal(cycle.pending, true);
});

test("a fired timer advances once and can schedule the next without accumulating", () => {
  const { clock, live, fire } = fakeClock();
  let stage = 8;
  const cycle = new AutoAdvance(clock, () => {
    stage = nextStage(stage, N);
    cycle.schedule(6500);
  });
  cycle.schedule(6500);
  for (let k = 0; k < 18; k++) {
    fire();
    assert.equal(live.size, 1);
  }
  assert.equal(stage, wrap(8 + 18, N));
});

test("cancel (unmount) leaves no timer behind", () => {
  const { clock, live } = fakeClock();
  const cycle = new AutoAdvance(clock, () => {});
  cycle.schedule(6500);
  cycle.cancel();
  cycle.cancel();
  assert.equal(live.size, 0);
  assert.equal(cycle.pending, false);
});
