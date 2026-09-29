import { memo } from "react";

/**
 * Hydrographic bearing dial behind the hero wordmark. Original Aqualens geometry: a graduated
 * bearing ring that drifts slowly, fixed range rings, N and S cards and a survey track standing in for the E-W axis, one
 * amber north index. Pure SVG; motion is CSS transforms only and stops under reduced motion.
 */
const R = 470;

const ticks = Array.from({ length: 360 }, (_, d) => {
  const len = d % 10 === 0 ? 20 : d % 5 === 0 ? 12 : 6;
  const a = ((d - 90) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return `M${(R * c).toFixed(1)} ${(R * s).toFixed(1)}L${((R - len) * c).toFixed(1)} ${((R - len) * s).toFixed(1)}`;
});
const major = ticks.filter((_, d) => d % 10 === 0).join("");
const minor = ticks.filter((_, d) => d % 10 !== 0).join("");

export const Compass = memo(function Compass() {
  return (
    <div className="cl-compass" aria-hidden="true">
      <svg className="cl-compass-dial" viewBox="-500 -500 1000 1000">
        <g className="cc-drift">
          <circle r={R} className="cc-ring" />
          <circle r={R - 58} className="cc-ring cc-faint" />
          <path d={minor} className="cc-tick" />
          <path d={major} className="cc-tick cc-major" />
          {Array.from({ length: 12 }, (_, i) => i * 30).map((d) => (
            <text key={d} transform={`rotate(${d}) translate(0 ${-(R - 38)})`} className="cc-num">
              {String(d).padStart(3, "0")}
            </text>
          ))}
        </g>
      </svg>
      <svg className="cl-compass-fixed" viewBox="-500 -500 1000 1000">
        {[330, 230, 130].map((r) => (
          <circle key={r} r={r} className="cc-ring cc-range" />
        ))}
        {/* Survey track through the nadir, with a range scale either side */}
        <path d="M-496 0H-36M36 0H496M0 -496V-36M0 36V496" className="cc-axis" />
        <path d="M-8 0H8M0 -8V8" className="cc-axis cc-center" />
        <path
          d={Array.from({ length: 9 }, (_, i) => {
            const x = 60 + i * 30;
            return `M${x} -5V5M${-x} -5V${5}`;
          }).join("")}
          className="cc-axis"
        />
        {/* One bearing line, as a plotted fix would leave it */}
        <path d="M0 0L398 -223" className="cc-bearing" />
        <text x="0" y={-(R - 118)} className="cc-card">N</text>
        <text x="0" y={R - 118} className="cc-card">S</text>
        <path d={`M0 ${-R - 6}l-7 -14h14z`} className="cc-north" />
      </svg>
    </div>
  );
});
