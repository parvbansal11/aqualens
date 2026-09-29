/**
 * The How It Works stage cycle as a small state machine, kept free of React so it can be tested.
 * Every index the landing page renders goes through `wrap`, so no out-of-range stage can exist.
 */

/** Always a valid index 0..count-1, for any integer (or non-finite) input. */
export function wrap(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0;
  const i = Math.trunc(index) % count;
  return i < 0 ? i + count : i;
}

export const nextStage = (index: number, count: number) => wrap(index + 1, count);
export const previousStage = (index: number, count: number) => wrap(index - 1, count);

/** Reading time per stage while the cycle runs on its own. */
export const STAGE_MS = 6500;
/** After a person chooses a stage, it stays this long before the cycle continues. */
export const HOLD_MS = 12000;

export interface Clock {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const windowClock: Clock = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (handle) => window.clearTimeout(handle as number),
};

/**
 * Owns at most one pending timer. `schedule` always replaces the previous one; `cancel` clears it.
 * A timer that fires is released before its callback runs, so it can schedule the next one.
 */
export class AutoAdvance {
  private handle: unknown = null;
  private readonly clock: Clock;
  private readonly onTick: () => void;

  constructor(clock: Clock, onTick: () => void) {
    this.clock = clock;
    this.onTick = onTick;
  }

  schedule(ms: number) {
    this.cancel();
    this.handle = this.clock.set(() => {
      this.handle = null;
      this.onTick();
    }, ms);
  }

  cancel() {
    if (this.handle !== null) {
      this.clock.clear(this.handle);
      this.handle = null;
    }
  }

  get pending() {
    return this.handle !== null;
  }
}
