import { useEffect, useState } from "react";
import { loadImage, SMALL_TARGET, SONAR } from "../lib/sonar";

export const STAGES = [
  {
    name: "Ingest",
    text: "Survey rasters arrive with optional navigation and mission files. Every Frame is placed in a Survey before anything is detected.",
    yields: "Frames · Survey membership",
  },
  {
    name: "Assess",
    text: "Image condition is measured first: dark bands, invalid pixels, the water column at nadir. Condition adjusts how far a return is trusted. It never adds evidence.",
    yields: "A condition record for every Frame",
  },
  {
    name: "Detect",
    text: "A frozen detector proposes Observations for the target classes it was trained on. Wide waterfalls are read in overlapping tiles, exactly as the runtime reads them.",
    yields: "Observations · raw detector confidence",
  },
  {
    name: "Verify",
    text: "Each Observation is read against its acoustic context: the highlight, the shadow behind it, the seabed around it. A shadow indicates raised relief. It does not make an object artificial.",
    yields: "Acoustic context · missing checks stay missing",
  },
  {
    name: "Fuse",
    text: "Observations of one object become one Contact, a single physical-object hypothesis. Overlapping tiles merge. Separate objects never do.",
    yields: "Contacts, each with its Observations",
  },
  {
    name: "Localize",
    text: "When a Survey supplies navigation, the Contact is placed on the chart. When it does not, the Contact says so instead of guessing a position.",
    yields: "A position, or an explicit absence",
  },
  {
    name: "Review",
    text: "An analyst confirms, rejects, relabels or leaves a Contact uncertain. Every verdict is kept, in order, on exactly one Contact.",
    yields: "Append-only review history",
  },
  {
    name: "Prioritize",
    text: "Contacts are ordered by visible components, so the order can be questioned. A component that could not be computed is shown as missing, never as zero.",
    yields: "A priority band with its reasons",
  },
  {
    name: "Report",
    text: "The survey closes as a record: every Contact with its evidence, verdicts and provenance, exported as JSON or CSV.",
    yields: "Survey report · JSON · CSV",
  },
] as const;

/* Plate space is 1600 x 1000. barge-01 (1728 x 773) is width-fitted and centred. */
const S = 1600 / 1728;
const OY = (1000 - 773 * S) / 2;
const px = (x: number) => x * S;
const py = (y: number) => OY + y * S;
const BARGE = { x: 1532, y: 142, w: 196, h: 322 };

function Strip() {
  return (
    <image
      href={SONAR.barge01}
      x={0}
      y={OY}
      width={1600}
      height={773 * S}
      preserveAspectRatio="none"
    />
  );
}

function Corners({
  x,
  y,
  w,
  h,
  arm = 16,
  className = "",
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  arm?: number;
  className?: string;
}) {
  const d = [
    `M${x} ${y + arm}V${y}H${x + arm}`,
    `M${x + w - arm} ${y}H${x + w}V${y + arm}`,
    `M${x} ${y + h - arm}V${y + h}H${x + arm}`,
    `M${x + w - arm} ${y + h}H${x + w}V${y + h - arm}`,
  ].join("");
  return <path className={className} d={d} fill="none" />;
}

function SceneIngest() {
  const frames = [
    { src: SONAR.barge01, x: 0, label: "Frame A" },
    { src: SONAR.barge02, x: 1, label: "Frame B" },
    { src: SONAR.viatorDetail, x: 2, label: "Frame C" },
  ];
  return (
    <svg viewBox="0 0 1600 1000" className="scene-svg">
      <rect className="plate-bg" width="1600" height="1000" />
      {frames.map((f, i) => (
        <g
          key={f.label}
          className="ingest-frame"
          style={{ transformOrigin: `${250 + i * 400}px 470px` }}
        >
          <svg
            x={120 + i * 470}
            y={260}
            width={420}
            height={380}
            viewBox={i === 2 ? "0 0 722 630" : "180 0 1360 773"}
            preserveAspectRatio="xMidYMid slice"
          >
            <image
              href={f.src}
              width={i === 2 ? 1120 : 1728}
              height={i === 2 ? 630 : i === 0 ? 773 : 853}
            />
          </svg>
          <rect
            x={120 + i * 470}
            y={260}
            width={420}
            height={380}
            className="stroke-faint"
            fill="none"
          />
          <text x={120 + i * 470} y={672} className="svg-label">
            {f.label}
          </text>
        </g>
      ))}
      <g className="ingest-files">
        <text x={120} y={800} className="svg-label svg-label--dim">
          Accepted
        </text>
        {[
          "Rasters · PNG JPEG PBM",
          "navigation.csv · optional",
          "mission.json · optional",
        ].map((t, i) => (
          <g key={t}>
            <rect
              x={120 + i * 470}
              y={822}
              width={420}
              height={56}
              className="chip"
            />
            <text x={144 + i * 470} y={857} className="svg-mono">
              {t}
            </text>
          </g>
        ))}
      </g>
      <g className="ingest-survey">
        <Corners
          x={90}
          y={222}
          w={1420}
          h={490}
          arm={26}
          className="stroke-amber"
        />
        <text x={90} y={206} className="svg-label svg-label--amber">
          Survey · every Frame belongs to exactly one
        </text>
      </g>
    </svg>
  );
}

function SceneAssess() {
  return (
    <svg viewBox="0 0 1600 1000" className="scene-svg">
      <rect className="plate-bg" width="1600" height="1000" />
      <Strip />
      <g className="assess-wc">
        <rect
          x={px(769)}
          y={OY}
          width={px(955) - px(769)}
          height={773 * S}
          className="hatch"
        />
        <line
          x1={px(865)}
          x2={px(865)}
          y1={OY - 30}
          y2={OY + 773 * S + 30}
          className="stroke-bone"
        />
        <text x={px(865)} y={OY - 44} className="svg-label" textAnchor="middle">
          Water column at nadir
        </text>
      </g>
      <g className="assess-sides">
        <text x={24} y={OY - 18} className="svg-label">
          Port
        </text>
        <text x={1576} y={OY - 18} className="svg-label" textAnchor="end">
          Starboard
        </text>
      </g>
      <line
        className="assess-scan stroke-bone"
        x1={0}
        x2={1600}
        y1={OY}
        y2={OY}
      />
      <g className="assess-legend">
        {["Dark bands", "Invalid pixels", "Water column"].map((t, i) => (
          <g key={t}>
            <rect
              x={24 + i * 250}
              y={912}
              width={226}
              height={46}
              className="chip"
            />
            <text x={46 + i * 250} y={941} className="svg-mono">
              {t}
            </text>
          </g>
        ))}
        <text
          x={1576}
          y={941}
          className="svg-mono svg-mono--dim"
          textAnchor="end"
        >
          measured per Frame
        </text>
      </g>
    </svg>
  );
}

function SceneDetect() {
  const tiles = [0, 538, 1076, 1614].flatMap((x) =>
    [0, 538].map((y) => ({ x, y })),
  );
  return (
    <svg viewBox="0 0 1600 1000" className="scene-svg">
      <rect className="plate-bg" width="1600" height="1000" />
      <Strip />
      <g className="detect-tiles">
        {tiles.map((t, i) => (
          <rect
            key={i}
            x={px(t.x) + 3}
            y={py(t.y) + 3}
            width={Math.min(px(768), 1600 - px(t.x)) - 6}
            height={Math.min(px(768), 773 * S - t.y * S) - 6}
            className="tile"
          />
        ))}
        <text x={24} y={OY - 18} className="svg-label">
          768 px tiles · 30% overlap
        </text>
      </g>
      <g className="detect-box">
        <Corners
          x={px(BARGE.x) - 6}
          y={py(BARGE.y) - 6}
          w={px(BARGE.w) + 12}
          h={BARGE.h * S + 12}
          arm={22}
          className="stroke-bone"
        />
        <text x={px(BARGE.x) - 6} y={py(BARGE.y) - 18} className="svg-label">
          Observation
        </text>
      </g>
      <g className="detect-box">
        <Corners
          x={px(SMALL_TARGET.x) - 10}
          y={py(SMALL_TARGET.y) - 10}
          w={px(SMALL_TARGET.w) + 20}
          h={SMALL_TARGET.h * S + 20}
          arm={12}
          className="stroke-bone"
        />
        <text
          x={px(SMALL_TARGET.x) - 10}
          y={py(SMALL_TARGET.y) - 22}
          className="svg-label"
        >
          Observation
        </text>
      </g>
      <text
        x={1576}
        y={941}
        className="svg-mono svg-mono--dim"
        textAnchor="end"
      >
        proposals only · no verdict
      </text>
    </svg>
  );
}

/** Real pixel intensities along one row through the Viator wreck and its shadow. */
function useProfile(row: number) {
  const [path, setPath] = useState("");
  useEffect(() => {
    loadImage(SONAR.viatorDetail).then((img) => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, row - 10, 722, 20).data;
      const values: number[] = [];
      for (let x = 0; x < 722; x++) {
        let sum = 0;
        for (let y = 0; y < 20; y++) sum += data[(y * 722 + x) * 4];
        values.push(sum / 20);
      }
      const smooth = values.map((_, i) => {
        const w = values.slice(Math.max(0, i - 4), i + 5);
        return w.reduce((a, b) => a + b, 0) / w.length;
      });
      setPath(
        smooth
          .map(
            (v, i) =>
              `${i ? "L" : "M"}${((i / 721) * 1600).toFixed(1)} ${(960 - (v / 160) * 190).toFixed(1)}`,
          )
          .join(""),
      );
    });
  }, [row]);
  return path;
}

function SceneVerify() {
  const profile = useProfile(335);
  const k = 1600 / 722;
  const rowY = (335 - 180) * k;
  return (
    <svg viewBox="0 0 1600 1000" className="scene-svg">
      <rect className="plate-bg" width="1600" height="1000" />
      <svg
        x={0}
        y={0}
        width={1600}
        height={700}
        viewBox="0 180 722 316"
        preserveAspectRatio="xMidYMid slice"
      >
        <image href={SONAR.viatorDetail} width={1120} height={630} />
      </svg>
      <line
        className="verify-row stroke-amber"
        x1={0}
        x2={1600}
        y1={rowY}
        y2={rowY}
      />
      <g className="verify-graph">
        <line x1={0} x2={1600} y1={960} y2={960} className="stroke-faint" />
        <path d={profile} className="profile" pathLength={1} />
        <g className="verify-marks">
          <line
            x1={180 * k}
            x2={470 * k}
            y1={745}
            y2={745}
            className="stroke-bone"
          />
          <text x={180 * k} y={732} className="svg-label">
            Acoustic shadow
          </text>
          <line
            x1={500 * k}
            x2={700 * k}
            y1={745}
            y2={745}
            className="stroke-amber"
          />
          <text x={500 * k} y={732} className="svg-label svg-label--amber">
            Highlight
          </text>
          <text x={24} y={732} className="svg-label">
            Seabed
          </text>
        </g>
      </g>
      <text
        x={1576}
        y={732}
        className="svg-mono svg-mono--dim"
        textAnchor="end"
      >
        intensity along the amber row, measured from this image
      </text>
    </svg>
  );
}

function SceneFuse() {
  const tileA = { x: px(1076), w: px(1728) - px(1076) };
  const tileB = { x: px(1614), w: px(1728) - px(1614) };
  return (
    <svg viewBox="0 0 1600 1000" className="scene-svg">
      <rect className="plate-bg" width="1600" height="1000" />
      <g className="fuse-dim">
        <Strip />
      </g>
      <rect
        x={tileA.x}
        y={py(0)}
        width={tileA.w}
        height={px(768)}
        className="tile tile--strong fuse-tile"
      />
      <rect
        x={tileB.x}
        y={py(0) + 8}
        width={tileB.w - 8}
        height={px(768) - 16}
        className="tile tile--strong fuse-tile"
      />
      <g className="fuse-pre">
        <rect
          x={px(BARGE.x)}
          y={py(BARGE.y)}
          width={px(BARGE.w)}
          height={BARGE.h * S}
          className="obs"
        />
        <rect
          x={px(1614) + 4}
          y={py(BARGE.y) + 10}
          width={px(1728) - px(1614) - 8}
          height={BARGE.h * S - 20}
          className="obs"
        />
        <text x={px(1076) + 16} y={py(0) + 32} className="svg-label">
          Tile A
        </text>
        <text x={px(1614) + 12} y={py(0) + 60} className="svg-label">
          Tile B
        </text>
      </g>
      <g className="fuse-contact">
        <Corners
          x={px(BARGE.x) - 10}
          y={py(BARGE.y) - 10}
          w={px(BARGE.w) + 20}
          h={BARGE.h * S + 20}
          arm={26}
          className="stroke-amber stroke-heavy"
        />
        <text
          x={px(BARGE.x) - 10}
          y={py(BARGE.y + BARGE.h) + 44}
          className="svg-label svg-label--amber"
        >
          CT-01 · one Contact, two Observations
        </text>
      </g>
      <g className="fuse-contact">
        <Corners
          x={px(SMALL_TARGET.x) - 10}
          y={py(SMALL_TARGET.y) - 10}
          w={px(SMALL_TARGET.w) + 20}
          h={SMALL_TARGET.h * S + 20}
          arm={12}
          className="stroke-amber stroke-heavy"
        />
        <text
          x={px(SMALL_TARGET.x) - 10}
          y={py(SMALL_TARGET.y + SMALL_TARGET.h) + 36}
          className="svg-label svg-label--amber"
        >
          CT-02 · separate object, separate Contact
        </text>
      </g>
    </svg>
  );
}

function SceneLocalize() {
  const contours = [
    "M-20 180C220 140 420 260 640 220S1080 120 1300 190 1560 260 1640 230",
    "M-20 320C260 290 440 380 700 350S1120 260 1340 330 1560 380 1640 360",
    "M-20 470C240 440 480 520 760 500S1160 420 1380 480 1580 530 1640 510",
    "M-20 620C300 600 520 680 800 650S1180 590 1400 640 1580 690 1640 670",
    "M-20 770C280 760 560 820 840 800S1200 740 1420 790 1580 830 1640 820",
  ];
  const track = "M260 250H1180V340H260V430H1180V520H260";
  return (
    <svg viewBox="0 0 1600 1000" className="scene-svg">
      <rect className="plate-bg plate-bg--chart" width="1600" height="1000" />
      {contours.map((d, i) => (
        <path key={i} d={d} className="contour" />
      ))}
      <path d={track} className="track loc-track" pathLength={1} />
      <g className="loc-pin">
        <circle cx={940} cy={340} r={9} className="pin" />
        <circle cx={940} cy={340} r={24} className="pin-ring" />
        <text x={968} y={332} className="svg-label svg-label--amber">
          CT-01
        </text>
        <text x={968} y={354} className="svg-mono svg-mono--dim">
          position from supplied navigation
        </text>
      </g>
      <g className="loc-absent">
        <rect x={1060} y={690} width={500} height={120} className="chip" />
        <circle cx={1096} cy={750} r={8} className="pin-hollow" />
        <text x={1124} y={742} className="svg-label">
          CT-02
        </text>
        <text x={1124} y={768} className="svg-mono svg-mono--dim">
          navigation not supplied · no position asserted
        </text>
      </g>
      <text x={24} y={960} className="svg-label">
        Illustrative chart · not survey data
      </text>
    </svg>
  );
}

function SceneReview() {
  const verdicts = ["Confirm", "Reject", "Relabel", "Uncertain"];
  return (
    <svg viewBox="0 0 1600 1000" className="scene-svg">
      <rect className="plate-bg" width="1600" height="1000" />
      <svg
        x={60}
        y={120}
        width={760}
        height={760}
        viewBox={`${BARGE.x - 140} ${BARGE.y - 120} 340 560`}
        preserveAspectRatio="xMidYMid slice"
      >
        <image href={SONAR.barge01} width={1728} height={773} />
      </svg>
      <rect
        x={60}
        y={120}
        width={760}
        height={760}
        className="stroke-faint"
        fill="none"
      />
      <text x={60} y={100} className="svg-label">
        CT-01 · 2 Observations
      </text>
      <text x={880} y={150} className="svg-label">
        Your assessment
      </text>
      {verdicts.map((v, i) => (
        <g key={v} className={`review-btn review-btn--${v.toLowerCase()}`}>
          <rect
            x={880}
            y={180 + i * 84}
            width={660}
            height={64}
            className="btn-rect"
          />
          <text x={912} y={220 + i * 84} className="svg-ui">
            {v}
          </text>
        </g>
      ))}
      <text x={880} y={560} className="svg-label">
        History
      </text>
      <g className="review-h1">
        <line x1={880} x2={1540} y1={584} y2={584} className="stroke-faint" />
        <text x={880} y={616} className="svg-mono">
          Uncertain
        </text>
        <text
          x={1540}
          y={616}
          className="svg-mono svg-mono--dim"
          textAnchor="end"
        >
          analyst · first pass
        </text>
      </g>
      <g className="review-h2">
        <line x1={880} x2={1540} y1={640} y2={640} className="stroke-faint" />
        <text x={880} y={672} className="svg-mono svg-mono--amber">
          Confirmed
        </text>
        <text
          x={1540}
          y={672}
          className="svg-mono svg-mono--dim"
          textAnchor="end"
        >
          analyst · after evidence
        </text>
      </g>
      <text x={880} y={860} className="svg-mono svg-mono--dim">
        applies to CT-01 only · earlier verdicts are kept
      </text>
    </svg>
  );
}

const ROWS = [
  {
    id: "CT-01",
    band: "High",
    parts: ["detector", "acoustic", "persistence"],
    missing: [] as string[],
  },
  {
    id: "CT-04",
    band: "Medium",
    parts: ["detector", "acoustic"],
    missing: ["persistence"],
  },
  {
    id: "CT-02",
    band: "Medium",
    parts: ["detector"],
    missing: ["acoustic", "persistence"],
  },
  { id: "CT-05", band: "Low", parts: ["detector"], missing: ["persistence"] },
  {
    id: "CT-03",
    band: "Unavailable",
    parts: [],
    missing: ["detector", "acoustic"],
  },
];

function ScenePrioritize() {
  return (
    <svg viewBox="0 0 1600 1000" className="scene-svg">
      <rect className="plate-bg" width="1600" height="1000" />
      <text x={80} y={110} className="svg-label">
        Contact
      </text>
      <text x={330} y={110} className="svg-label">
        Band
      </text>
      <text x={640} y={110} className="svg-label">
        Components available · missing
      </text>
      {ROWS.map((r, i) => (
        <g key={r.id} className="prio-row" data-order={i}>
          <line
            x1={80}
            x2={1520}
            y1={140 + i * 150}
            y2={140 + i * 150}
            className="stroke-faint"
          />
          <text x={80} y={225 + i * 150} className="svg-ui">
            {r.id}
          </text>
          <text
            x={330}
            y={225 + i * 150}
            className={`svg-ui ${r.band === "High" ? "svg-ui--amber" : r.band === "Unavailable" ? "svg-ui--dim" : ""}`}
          >
            {r.band}
          </text>
          {r.parts.map((p, j) => (
            <g key={p}>
              <rect
                x={640 + j * 205}
                y={194 + i * 150}
                width={185}
                height={44}
                className="chip chip--on"
              />
              <text x={662 + j * 205} y={222 + i * 150} className="svg-mono">
                {p}
              </text>
            </g>
          ))}
          {r.missing.map((p, j) => (
            <g key={p}>
              <rect
                x={640 + (r.parts.length + j) * 205}
                y={194 + i * 150}
                width={185}
                height={44}
                className="chip chip--missing"
              />
              <text
                x={662 + (r.parts.length + j) * 205}
                y={222 + i * 150}
                className="svg-mono svg-mono--dim"
              >
                {p}
              </text>
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

function SceneReport() {
  return (
    <svg viewBox="0 0 1600 1000" className="scene-svg">
      <rect className="plate-bg" width="1600" height="1000" />
      <g className="report-sheet">
        <rect x={250} y={60} width={1100} height={900} className="sheet" />
        <text x={310} y={140} className="svg-label">
          Survey report
        </text>
        <text x={310} y={200} className="svg-title">
          Illustrative survey
        </text>
        <line x1={310} x2={1290} y1={240} y2={240} className="stroke-faint" />
        {[
          ["Contacts", "each with Observations, evidence and verdict"],
          ["Evidence", "available channels, and channels that are missing"],
          ["Reviews", "append-only, analyst and time"],
          ["Provenance", "source · model · processing record"],
        ].map(([k, v], i) => (
          <g key={k} className="report-line">
            <text x={310} y={310 + i * 90} className="svg-ui">
              {k}
            </text>
            <text x={560} y={310 + i * 90} className="svg-mono svg-mono--dim">
              {v}
            </text>
            <line
              x1={310}
              x2={1290}
              y1={340 + i * 90}
              y2={340 + i * 90}
              className="stroke-faint"
            />
          </g>
        ))}
        <g className="report-formats">
          {["JSON", "CSV"].map((f, i) => (
            <g key={f}>
              <rect
                x={310 + i * 190}
                y={740}
                width={170}
                height={70}
                className="chip chip--on"
              />
              <text
                x={395 + i * 190}
                y={784}
                className="svg-ui"
                textAnchor="middle"
              >
                {f}
              </text>
            </g>
          ))}
          <text
            x={1290}
            y={784}
            className="svg-mono svg-mono--dim"
            textAnchor="end"
          >
            the record travels with its reasons
          </text>
        </g>
      </g>
    </svg>
  );
}

export const SCENES = [
  SceneIngest,
  SceneAssess,
  SceneDetect,
  SceneVerify,
  SceneFuse,
  SceneLocalize,
  SceneReview,
  ScenePrioritize,
  SceneReport,
];
