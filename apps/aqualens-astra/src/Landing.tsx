import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Lenis from "lenis";
import { SCENES, STAGES } from "./sections/PipelineScenes";
import { Arrow } from "./sections/Arrow";
import { Compass } from "./sections/Compass";
import { linkTo } from "./lib/nav";
import "./styles/compact-landing.css";

const HERO_MP4 = "/media/oceaneye-hero.mp4";
const prefersReduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The wordmark is sized from its container in CSS (cqi). This guard measures the rendered word
 * and only ever scales it down, so no engine or font-metric difference can push the final S out.
 */
function useFittedWordmark<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.removeProperty("--wm-fit");
      const range = document.createRange();
      range.selectNodeContents(el);
      const word = range.getBoundingClientRect().width;
      const room = el.clientWidth;
      if (word > room) el.style.setProperty("--wm-fit", (room / word - 0.002).toFixed(4));
    };
    fit();
    void document.fonts.ready.then(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

/** Smooth wheel and trackpad scrolling for the landing only; native under reduced motion. */
function useSmoothScroll() {
  useEffect(() => {
    if (!location.hash) window.scrollTo(0, 0);
    const reduced = prefersReduced();
    const lenis = reduced ? null : new Lenis({ lerp: 0.12, smoothWheel: true, wheelMultiplier: 1, autoRaf: true });
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
      if (!a || a.classList.contains("cl-skip") || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const hash = a.getAttribute("href")!;
      const target = hash === "#top" ? document.body : document.querySelector<HTMLElement>(hash);
      if (!target) return;
      e.preventDefault();
      const y = hash === "#top" ? 0 : target.getBoundingClientRect().top + window.scrollY;
      if (lenis) lenis.scrollTo(y, { duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4) });
      else window.scrollTo(0, y);
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      lenis?.destroy();
    };
  }, []);
}

const DESCRIPTIONS = [
  "Bring sonar rasters into a survey, with navigation and mission context where available.",
  "Read image condition first. Dark bands, invalid pixels and the water column inform what can be trusted.",
  "Propose observations of known target classes. A detector proposal is the beginning of a review.",
  "Read the highlight, shadow and surrounding seabed. Keep available evidence and missing checks visible.",
  "Gather supported observations around one physical Contact. Keep separate objects separate.",
  "Place a Contact only when navigation supports it. Otherwise, leave its position explicitly unavailable.",
  "An analyst confirms, rejects, relabels or leaves a Contact uncertain. Earlier verdicts stay in its history.",
  "Bring reviewed Contacts into focus with visible priority reasons. Missing evidence stays missing.",
  "Carry the Contact, evidence, verdict and provenance into a record that can be exported.",
];
const IDEAS = [
  [
    "01",
    "Known targets",
    "Detect what is known.",
    "The trained detector proposes familiar target classes. Each proposal remains open to review.",
  ],
  [
    "02",
    "Local anomaly",
    "Notice what differs.",
    "Unusual seabed patterns become candidates, without a claim about their identity.",
  ],
  [
    "03",
    "Contact evidence",
    "One object. Its evidence.",
    "Supported observations, acoustic context and provenance meet in one physical-object hypothesis.",
  ],
  [
    "04",
    "Human verdict",
    "The analyst has the last word.",
    "A person assigns meaning, records uncertainty and decides what deserves a closer look.",
  ],
];

function Launch({ ghost = false }: { ghost?: boolean }) {
  return (
    <a className={`cta ${ghost ? "cta--ghost" : ""}`} href="/workspace" onClick={linkTo("/workspace")}>
      Launch Workspace <Arrow dir="ne" />
    </a>
  );
}

function Opening() {
  const video = useRef<HTMLVideoElement>(null);
  const compass = useRef<HTMLDivElement>(null);
  const wordmark = useFittedWordmark<HTMLHeadingElement>();
  const [reduced, setReduced] = useState(prefersReduced);
  // Paused only when the person asks. Scrolling, visibility and section changes never pause it.
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.muted = true;
    el.loop = true;
    const wanted = () => !paused && !reduced && !document.hidden;
    const play = () => {
      if (wanted() && el.paused) void el.play().catch(() => undefined);
    };
    // Native loop is the primary path; this covers engines that end the stream instead.
    const ended = () => {
      if (!wanted()) return;
      el.currentTime = 0;
      play();
    };
    if (paused || reduced) el.pause();
    else play();
    // The browser may pause or stall playback on its own (hidden tab, energy saving, a decoder
    // stall at the loop point). Playback that should be running but has not advanced is resumed.
    let last = el.currentTime;
    let still = 0;
    const watchdog = window.setInterval(() => {
      if (!wanted()) return;
      if (el.paused) return play();
      still = el.currentTime === last ? still + 1 : 0;
      last = el.currentTime;
      if (still >= 2 && el.readyState >= 2) {
        still = 0;
        el.currentTime = el.currentTime >= el.duration - 0.25 ? 0 : el.currentTime + 0.001;
        play();
      }
    }, 1500);
    document.addEventListener("visibilitychange", play);
    el.addEventListener("pause", play);
    el.addEventListener("ended", ended);
    el.addEventListener("canplay", play);
    return () => {
      window.clearInterval(watchdog);
      document.removeEventListener("visibilitychange", play);
      el.removeEventListener("pause", play);
      el.removeEventListener("ended", ended);
      el.removeEventListener("canplay", play);
    };
  }, [reduced, paused]);
  // Micro-parallax and a small scroll-linked bearing turn; transforms only, batched per frame.
  useEffect(() => {
    const el = compass.current;
    if (!el || reduced) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = Math.min(window.scrollY, window.innerHeight * 1.2);
      el.style.setProperty("--cc-y", `${(y * 0.18).toFixed(1)}px`);
      el.style.setProperty("--cc-turn", `${(y * 0.02).toFixed(2)}deg`);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [reduced]);
  return (
    <section className="cl-hero" id="top" aria-labelledby="hero-title">
      <div className="cl-ocean" aria-hidden="true">
        <img src="/media/oceaneye-poster.jpg" alt="" />
        {!reduced && !failed && (
          <video
            ref={video}
            muted
            loop
            playsInline
            autoPlay
            preload="auto"
            poster="/media/oceaneye-poster.jpg"
            onError={(e) => {
              // React reports each failed <source> here too. One failing source is not a failure:
              // the element moves on to the next. Only the last source failing leaves no video.
              const el = e.currentTarget;
              if (e.target !== el) {
                if (e.target === el.lastElementChild) setFailed(true);
                return;
              }
              // A decode error mid-playback: fall back to the H.264 file before giving up.
              if (!el.currentSrc.endsWith(".mp4")) {
                el.src = HERO_MP4;
                el.load();
                void el.play().catch(() => undefined);
              } else setFailed(true);
            }}
          >
            <source src="/media/oceaneye-hero.webm" type='video/webm; codecs="vp9"' />
            <source src={HERO_MP4} type='video/mp4; codecs="avc1.640028"' />
          </video>
        )}
      </div>
      <div className="cl-hero-content">
        <p className="cl-label cl-hero-kicker">
          Marine intelligence / Side-scan sonar
        </p>
        <div className="cl-mark-stage">
          <div className="cl-compass-anchor" ref={compass}>
            <Compass />
          </div>
          <h1 id="hero-title" className="cl-wordmark" ref={wordmark}>
            AQUALENS
          </h1>
        </div>
        <div className="cl-hero-bottom">
          <div>
            <h2 className="serif">
              Side-scan sonar, <em>read closely.</em>
            </h2>
            <p className="cl-support">
              From seabed imagery to evidence a human can act on.
            </p>
            <div className="cl-actions">
              <Launch />
              <a className="cta cta--ghost" href="#method">
                See how it works <Arrow dir="down" />
              </a>
            </div>
          </div>
          <div className="cl-hero-note">
            <span className="cl-label">Observe. Understand. Review.</span>
            {!reduced && !failed && (
              <button
                className="cl-text-button"
                aria-pressed={paused}
                onClick={() => setPaused(!paused)}
              >
                {paused ? "Resume background" : "Pause background"}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="cl-hero-baseline">
        <span className="cl-label">A closer look beneath the surface</span>
        <a href="#method" aria-label="Continue to How it works">
          <Arrow dir="down" />
        </a>
      </div>
    </section>
  );
}

function Pipeline() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const Scene = SCENES[active];
  const move = (next: number, focus = false) => {
    setActive(next);
    if (focus) tabs.current[next]?.focus({ preventScroll: true });
  };
  return (
    <section
      id="method"
      className="cl-section cl-pipeline"
      aria-labelledby="method-title"
    >
      <header className="cl-section-head">
        <p className="cl-label">01 / How it works</p>
        <h2 id="method-title" className="serif">
          A return becomes <em>a record.</em>
        </h2>
        <span className="cl-label">Nine stages. One connected process.</span>
      </header>
      <div
        className="cl-pipeline-grid"
        id="stage-panel"
        role="tabpanel"
        aria-labelledby={`stage-tab-${active}`}
        tabIndex={0}
      >
        <div className="cl-stage-copy" key={`copy-${active}`}>
          <div className="cl-stage-number">
            {String(active + 1).padStart(2, "0")}
            <span className="cl-label">/ 09</span>
          </div>
          <h3>{STAGES[active].name}</h3>
          <p className="cl-stage-description">{DESCRIPTIONS[active]}</p>
          <p className="cl-yields cl-label">{STAGES[active].yields}</p>
          <div className="cl-stage-controls">
            <button
              onClick={() => move(active - 1)}
              disabled={active === 0}
              aria-label="Previous stage"
            >
              ←
            </button>
            <button
              onClick={() => move(active + 1)}
              disabled={active === 8}
              aria-label="Next stage"
            >
              →
            </button>
            <span className="cl-label">Explore the stages</span>
          </div>
        </div>
        <div className="cl-sonar-panel">
          <div className="cl-panel-bar">
            <span className="cl-label">
              {STAGES[active].name} / Evidence view
            </span>
            <span className="cl-signal" aria-hidden="true" />
          </div>
          <div
            className="cl-scene"
            key={active}
            role="img"
            aria-label={`${STAGES[active].name}: ${DESCRIPTIONS[active]} Illustrative process using real sonar imagery.`}
          >
            <Scene />
          </div>
          <div className="cl-panel-bar cl-panel-caption">
            <span>Real sonar. Illustrative overlays.</span>
            <span>AI4Shipwrecks / CC BY 4.0</span>
          </div>
        </div>
      </div>
      <div
        className="cl-stage-rail"
        role="tablist"
        aria-label="Pipeline stages"
        onKeyDown={(e) => {
          let next = active;
          if (e.key === "ArrowRight") next = (active + 1) % 9;
          else if (e.key === "ArrowLeft") next = (active + 8) % 9;
          else if (e.key === "Home") next = 0;
          else if (e.key === "End") next = 8;
          else return;
          e.preventDefault();
          move(next, true);
        }}
      >
        {STAGES.map((s, i) => (
          <button
            key={s.name}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            id={`stage-tab-${i}`}
            role="tab"
            aria-selected={active === i}
            aria-controls="stage-panel"
            tabIndex={active === i ? 0 : -1}
            onClick={() => move(i)}
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            {s.name}
          </button>
        ))}
      </div>
    </section>
  );
}

function Product() {
  return (
    <section
      id="product"
      className="cl-section cl-product"
      aria-labelledby="product-title"
    >
      <header className="cl-section-head">
        <p className="cl-label">02 / The Aqualens distinction</p>
        <h2 id="product-title" className="serif">
          Machine observation.
          <br />
          <em>Human understanding.</em>
        </h2>
        <p className="cl-section-note">
          Detection opens the question.
          <br />
          Evidence supports the answer.
        </p>
      </header>
      <div className="cl-ideas">
        {IDEAS.map(([number, title, heading, text], i) => (
          <article className="cl-idea" key={number}>
            <div className="cl-label">
              <span>{number}</span> {title}
            </div>
            <div className={`cl-fragment cl-fragment-${i}`} aria-hidden="true">
              {i < 3 ? (
                <>
                  <img
                    src={
                      i === 1
                        ? "/sonar/subpipe-hf-f08e01eb.png"
                        : "/sonar/viator-detail.png"
                    }
                    loading="lazy"
                    alt=""
                  />
                  <i />
                  <span>
                    {
                      ["Proposal", "Identity unassigned", "Contact + context"][
                        i
                      ]
                    }
                  </span>
                </>
              ) : (
                <>
                  <span className="cl-verdict-mark">↳</span>
                  <div>
                    <b>Analyst reviewed</b>
                    <small>Verdict + rationale + history</small>
                  </div>
                </>
              )}
            </div>
            <h3>{heading}</h3>
            <p>{text}</p>
          </article>
        ))}
      </div>
      <p className="cl-product-foot cl-label">
        Illustrative evidence fragments{" "}
        <span>
          Machine proposes <i>→</i> Evidence connects <i>→</i> Analyst decides
        </span>
      </p>
    </section>
  );
}

function OperationalView() {
  const [report, setReport] = useState(false);
  return (
    <section
      id="mission"
      className="cl-section cl-mission"
      aria-labelledby="mission-title"
    >
      <header className="cl-section-head">
        <p className="cl-label">03 / The operational picture</p>
        <h2 id="mission-title" className="serif">
          Keep the whole mission <em>in view.</em>
        </h2>
        <p className="cl-section-note">
          Mission. Map. Contact. Evidence. Report.
          <br />
          One continuous record.
        </p>
      </header>
      <div className="cl-operation">
        <div className="cl-operation-bar">
          <span>
            AQUALENS <i>/</i> Mission overview
          </span>
          <span className="cl-label">Illustrative mission view</span>
        </div>
        <div className="cl-operation-body">
          <div className="cl-chart">
            <div className="cl-chart-title">
              <span className="cl-label">Survey A / Contact context</span>
              <h3>
                Every return has a place.
                <br />
                <em>Only when the data supports it.</em>
              </h3>
            </div>
            <svg
              viewBox="0 0 900 440"
              role="img"
              aria-label="Illustrative survey tracks and selected Contact. Synthetic layout, no measured coordinates."
            >
              <defs>
                <pattern
                  id="mission-grid"
                  width="60"
                  height="60"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M60 0H0V60"
                    fill="none"
                    stroke="#b4c6c5"
                    strokeOpacity=".055"
                  />
                </pattern>
              </defs>
              <rect width="900" height="440" fill="url(#mission-grid)" />
              {Array.from({ length: 12 }, (_, i) => (
                <path
                  key={i}
                  d={`M-40 ${90 + i * 26} C180 ${-150 + i * 35} 290 ${390 + i * 16} 490 ${160 + i * 28} S730 ${-100 + i * 34} 960 ${80 + i * 30}`}
                  fill="none"
                  stroke="#6c8e88"
                  strokeOpacity={i % 3 === 0 ? 0.24 : 0.11}
                />
              ))}
              <g transform="rotate(-12 440 250)">
                <path
                  d="M150 160H690V210H150V260H690V310H150V360H690"
                  fill="none"
                  stroke="#9faeab"
                  strokeWidth="1.2"
                />
                <rect
                  x="120"
                  y="130"
                  width="600"
                  height="260"
                  fill="#9faeab"
                  fillOpacity=".025"
                  stroke="#9faeab"
                  strokeOpacity=".2"
                  strokeDasharray="4 6"
                />
                {[
                  [260, 210],
                  [575, 260],
                  [390, 310],
                ].map(([x, y], i) => (
                  <g key={i}>
                    <circle
                      cx={x}
                      cy={y}
                      r={i === 1 ? 6 : 4}
                      fill={i === 1 ? "#e8a54b" : "#a1adab"}
                    />
                    {i === 1 && (
                      <circle
                        cx={x}
                        cy={y}
                        r="18"
                        fill="none"
                        stroke="#e8a54b"
                        strokeOpacity=".5"
                      />
                    )}
                  </g>
                ))}
              </g>
              <path
                d="M574 232H780"
                stroke="#e8a54b"
                strokeOpacity=".5"
                strokeDasharray="3 5"
              />
              <text
                x="700"
                y="216"
                fill="#e8a54b"
                fontSize="13"
                fontFamily="monospace"
              >
                CT-07
              </text>
            </svg>
            <p className="cl-chart-note">
              Synthetic tracks and Contact placement. No measured coordinates.
            </p>
          </div>
          <aside className="cl-contact">
            <div
              className="cl-contact-tabs"
              role="group"
              aria-label="Mission preview"
            >
              <button aria-pressed={!report} onClick={() => setReport(false)}>
                Contact evidence
              </button>
              <button aria-pressed={report} onClick={() => setReport(true)}>
                Report preview <Arrow dir="ne" />
              </button>
            </div>
            <div className="cl-contact-content" key={String(report)}>
              {report ? (
                <>
                  <p className="cl-label">Illustrative report / Survey A</p>
                  <h3>
                    The record travels
                    <br />
                    <em>with its reasons.</em>
                  </h3>
                  <div className="cl-report-lines">
                    {[
                      "Contact identity",
                      "Source observations",
                      "Available and missing evidence",
                      "Analyst verdict and history",
                      "Processing provenance",
                    ].map((s, i) => (
                      <div key={s}>
                        <span>0{i + 1}</span>
                        {s}
                      </div>
                    ))}
                  </div>
                  <p className="cl-label">Export in workspace / JSON · CSV</p>
                </>
              ) : (
                <>
                  <div className="cl-contact-title">
                    <h3>CT-07</h3>
                    <span className="cl-label">Awaiting review</span>
                  </div>
                  <img
                    className="cl-contact-image"
                    src="/sonar/barge-detail.png"
                    loading="lazy"
                    alt="Real barge sonar crop used in an illustrative Contact evidence panel"
                  />
                  <dl>
                    {[
                      ["Source", "Survey A · sonar raster"],
                      ["Evidence", "Detector + acoustic context"],
                      ["Position", "Not asserted in this preview"],
                      ["Verdict", "Pending analyst review"],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="cl-label">
                    Real sonar / Illustrative Contact record
                  </p>
                </>
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function Closing() {
  const wordmark = useFittedWordmark<HTMLDivElement>();
  return (
    <section id="about" className="cl-closing" aria-labelledby="closing-title">
      <div className="cl-closing-top">
        <div>
          <p className="cl-label">04 / From observation to understanding</p>
          <h2 id="closing-title" className="serif">
            From sonar return to <em>reviewed Contact.</em>
          </h2>
        </div>
        <Launch />
      </div>
      <div className="cl-wordmark cl-closing-word" aria-hidden="true" ref={wordmark}>
        AQUALENS
      </div>
      <footer className="cl-footer">
        <div>
          <p>Aqualens · Side-scan sonar review workstation</p>
          <p>Machine proposals, human verdicts, evidence kept with every Contact.</p>
        </div>
        <div>
          <p>Landing imagery is real sonar with illustrative overlays.</p>
          <a href="/sonar/ATTRIBUTION.json">
            Sonar credits: AI4Shipwrecks, SubPipe <Arrow dir="ne" />
          </a>
        </div>
        <a href="#top">Back to surface ↑</a>
      </footer>
    </section>
  );
}

export default function Landing() {
  useSmoothScroll();
  useEffect(() => {
    document.title = "Aqualens · Side-scan sonar, read closely";
  }, []);
  return (
    <div className="cl-landing">
      <a className="cl-skip" href="#method">
        Skip to content
      </a>
      <header className="cl-nav">
        <a
          className="cl-nav-mark"
          href="#top"
          aria-label="Aqualens, back to top"
        >
          AQUALENS
        </a>
        <nav aria-label="Landing sections">
          <a href="#method">How it works</a>
          <a href="#product">The system</a>
          <a href="#mission">Mission view</a>
        </nav>
        <Launch ghost />
      </header>
      <main>
        <Opening />
        <Pipeline />
        <Product />
        <OperationalView />
        <Closing />
      </main>
    </div>
  );
}
