import { useEffect, useId, useRef } from "react";
import "../styles/hero-instrument.css";

// Original connected lettering: broad open counters and a current-like baseline.
const lettering = [
  "M20 133 C48 122 72 49 111 26 C131 14 134 30 124 56 L96 128 C91 143 103 149 121 130 M51 106 C78 98 103 99 130 101",
  "M190 89 C177 68 151 82 137 107 C119 139 148 150 171 123 L193 84 C182 112 172 152 155 168 C142 180 141 164 158 145 C172 130 190 124 208 111",
  "M220 84 C208 105 194 132 207 138 C220 145 239 118 257 86 C247 107 232 135 245 138 C256 141 268 125 278 114",
  "M331 91 C320 71 294 83 281 108 C265 139 289 148 312 123 L336 84 C326 108 312 133 326 138 C339 142 352 123 363 109",
  "M358 116 C381 93 420 41 410 27 C399 12 375 58 363 88 C349 123 354 141 369 138 C382 136 393 123 402 111",
  "M397 118 C421 117 445 92 432 83 C419 74 398 99 394 116 C387 145 417 145 440 121 L452 108",
  "M463 85 L437 138 C452 115 480 76 493 85 C503 92 472 126 483 137 C492 146 510 124 519 112",
  "M570 88 C558 72 532 82 528 97 C523 112 552 113 551 126 C550 142 520 147 513 135 M551 127 C570 129 588 114 608 108",
].join(" ");
const ticks = Array.from({ length: 120 }, (_, index) => index);

export function HeroInstrument() {
  const root = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    const element = root.current;
    const hero = element?.closest(".hero");
    if (!element || !hero) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const fine = matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0;
    let x = 0,
      y = 0;
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      element.style.setProperty("--energy", "0");
      element.style.setProperty("--drift-x", "0px");
      element.style.setProperty("--drift-y", "0px");
      element.dataset.active = "false";
    };
    const paint = () => {
      frame = 0;
      const bounds = element.getBoundingClientRect();
      const dx = Math.max(bounds.left - x, 0, x - bounds.right);
      const dy = Math.max(bounds.top - y, 0, y - bounds.bottom);
      const energy = Math.max(0, 1 - Math.hypot(dx, dy) / 180);
      element.style.setProperty("--energy", energy.toFixed(3));
      element.style.setProperty("--light-x", `${x - bounds.left}px`);
      element.style.setProperty("--light-y", `${y - bounds.top}px`);
      element.style.setProperty(
        "--drift-x",
        `${((x - bounds.left - bounds.width / 2) / 180).toFixed(2)}px`,
      );
      element.style.setProperty(
        "--drift-y",
        `${((y - bounds.top - bounds.height / 2) / 180).toFixed(2)}px`,
      );
      element.dataset.active = String(dx === 0 && dy === 0);
    };
    const move = (event: Event) => {
      if (motion.matches || !fine.matches) return;
      const pointer = event as PointerEvent;
      x = pointer.clientX;
      y = pointer.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    hero.addEventListener("pointermove", move, { passive: true });
    hero.addEventListener("pointerleave", reset);
    hero.addEventListener("pointercancel", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("resize", reset);
    window.addEventListener("scroll", reset, { passive: true });
    motion.addEventListener("change", reset);
    fine.addEventListener("change", reset);
    return () => {
      reset();
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", reset);
      hero.removeEventListener("pointercancel", reset);
      window.removeEventListener("blur", reset);
      window.removeEventListener("resize", reset);
      window.removeEventListener("scroll", reset);
      motion.removeEventListener("change", reset);
      fine.removeEventListener("change", reset);
    };
  }, []);

  return (
    <div className="hero-instrument" ref={root}>
      <div className="instrument-waterlight" aria-hidden="true" />
      <div className="instrument-compass" aria-hidden="true">
        <svg viewBox="0 0 800 800" fill="none">
          <defs>
            <linearGradient
              id={`${id}-depth`}
              x1="90"
              y1="70"
              x2="650"
              y2="730"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#b9ece3" stopOpacity=".65" />
              <stop offset=".35" stopColor="#6fcbc8" stopOpacity=".17" />
              <stop offset=".56" stopColor="#a5e7da" stopOpacity=".5" />
              <stop offset="1" stopColor="#499ba8" stopOpacity=".08" />
            </linearGradient>
            <radialGradient id={`${id}-fade`}>
              <stop offset="0" stopColor="white" stopOpacity=".05" />
              <stop offset=".38" stopColor="white" stopOpacity=".2" />
              <stop offset=".7" stopColor="white" />
              <stop offset="1" stopColor="white" stopOpacity=".3" />
            </radialGradient>
            <mask id={`${id}-mask`}>
              <rect width="800" height="800" fill={`url(#${id}-fade)`} />
            </mask>
          </defs>
          <g
            stroke={`url(#${id}-depth)`}
            mask={`url(#${id}-mask)`}
            className="instrument-geometry"
          >
            {[125, 198, 270, 326, 342].map((r) => (
              <circle
                key={r}
                cx="400"
                cy="400"
                r={r}
                strokeWidth={r === 326 ? 1 : 0.65}
              />
            ))}
            <circle
              cx="400"
              cy="400"
              r="294"
              strokeDasharray="1 12"
              className="instrument-minor"
            />
            <path
              d="M400 42V758 M42 400H758"
              strokeWidth=".6"
              strokeDasharray="3 8"
            />
            <path d="M400 60V118 M400 682V740 M60 400H118 M682 400H740 M390 400H410 M400 390V410" />
            {ticks.map((i) => (
              <path
                key={i}
                className={i % 5 ? "instrument-minor" : "instrument-major"}
                d={`M400 74V${i % 10 === 0 ? 97 : i % 5 === 0 ? 89 : 80}`}
                transform={`rotate(${i * 3} 400 400)`}
              />
            ))}
            <g className="instrument-contours" strokeWidth=".65">
              <path d="M116 258C163 198 229 233 258 179S326 110 378 136 M102 274C157 203 232 253 276 182S342 126 383 147 M94 294C157 215 240 272 289 197S347 145 382 157" />
              <path d="M529 547C575 510 643 531 676 478 M508 566C574 518 632 557 694 490 M487 584C559 533 653 577 706 510" />
            </g>
          </g>
          <g
            className="instrument-bearings"
            fill="currentColor"
            textAnchor="middle"
          >
            <text x="400" y="180">
              N
            </text>
            <text x="770" y="404">
              E
            </text>
            <text x="400" y="660">
              S
            </text>
            <text x="30" y="404">
              W
            </text>
            <g className="instrument-annotations">
              <text x="568" y="115">
                030°
              </text>
              <text x="691" y="241">
                060°
              </text>
              <text x="109" y="568">
                240°
              </text>
              <text x="232" y="700">
                210°
              </text>
              <text x="203" y="302">
                R / 02
              </text>
              <text x="603" y="495">
                R / 03
              </text>
            </g>
          </g>
          <g className="instrument-lit" stroke="currentColor">
            <path
              d="M237 118 A326 326 0 0 1 563 118 M118 563 A326 326 0 0 0 237 682"
              strokeWidth="1.4"
            />
            <path d="M400 69V99 M385 75V86 M415 75V86 M74 400H98 M702 400H726" />
            <circle cx="563" cy="118" r="3" fill="currentColor" stroke="none" />
          </g>
          <g className="instrument-pulse" stroke="currentColor">
            <circle cx="400" cy="400" r="190" />
          </g>
          <g className="instrument-sweep" stroke="currentColor">
            <path d="M400 114A286 286 0 0 1 543 152" />
          </g>
        </svg>
      </div>
      <h1 id="hero-heading" className="hero-brand" aria-label="Aqualens">
        <svg
          className="instrument-wordmark"
          viewBox="0 0 630 185"
          fill="none"
          aria-hidden="true"
        >
          <defs>
            <path id={`${id}-lettering`} d={lettering} />
          </defs>
          <use href={`#${id}-lettering`} className="wordmark-bloom" />
          <use href={`#${id}-lettering`} className="wordmark-ink" />
          <use href={`#${id}-lettering`} className="wordmark-light" />
        </svg>
      </h1>
    </div>
  );
}
