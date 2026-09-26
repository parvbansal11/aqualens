import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Fingerprint,
  Layers3,
  Repeat2,
  Route,
  Waves,
} from "lucide-react";
import { Logo } from "../components/ui";
import { OceanEnvironment } from "../components/OceanEnvironment";
import { epitomeNavigated } from "../fixtures/epitomeNavigated";
const SurveyMap = lazy(() => import("../components/SurveyMap"));
const stages = ["Survey", "Observation", "Contact", "Evidence", "Decision"];
const capabilities = [
  [
    "Open-set anomaly candidates",
    "Notice what differs from reference memory.",
    Fingerprint,
  ],
  [
    "Temporal persistence",
    "Follow a Contact through supported observations.",
    Layers3,
  ],
  ["Acoustic evidence", "Read the return in its sonar context.", AudioLines],
  ["Survey change", "Compare only what the coverage can support.", Repeat2],
  [
    "Recovery priority",
    "Bring transparent priorities to human decisions.",
    Route,
  ],
] as const;
export default function Landing() {
  const section = useRef<HTMLElement>(null),
    preview = useRef<HTMLElement>(null);
  const [stage, setStage] = useState(0),
    [showMap, setShowMap] = useState(false);
  useEffect(() => {
    const update = () => {
      const r = section.current?.getBoundingClientRect();
      if (r)
        setStage(
          Math.max(
            0,
            Math.min(
              4,
              Math.floor((innerHeight * 0.82 - r.top) / (innerHeight * 0.145)),
            ),
          ),
        );
    };
    window.addEventListener("scroll", update, { passive: true });
    update();
    const observer = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShowMap(true);
          observer.disconnect();
        }
      },
      { rootMargin: "250px" },
    );
    if (preview.current) observer.observe(preview.current);
    return () => {
      window.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);
  return (
    <main id="main-content" className="landing">
      <section className="hero" aria-labelledby="hero-heading">
        <OceanEnvironment />
        <nav className="landing-nav" aria-label="Main navigation">
          <Logo />
          <span className="nav-project">SONAR INTELLIGENCE</span>
          <Link to="/intake" className="nav-enter">
            Enter workspace
            <ArrowUpRight size={16} />
          </Link>
        </nav>
        <div className="hero-copy">
          <h1 id="hero-heading" className="hero-brand">
            Aqualens
          </h1>
          <p className="hero-tagline">EVERY RETURN IS EVIDENCE.</p>
          <p className="hero-description">
            Side-scan sonar intelligence for detection, evidence review, mapping
            and operational decision support.
          </p>
          <div className="hero-actions">
            <Link className="button button-cream" to="/intake">
              Launch Workspace
              <ArrowUpRight size={18} />
            </Link>
            <a className="hero-secondary" href="#how-it-works">
              See how it works
              <ArrowDown size={16} />
            </a>
          </div>
        </div>
      </section>
      <section
        id="how-it-works"
        ref={section}
        className="formation landing-section"
      >
        <div className="formation-copy">
          <p className="eyebrow">01 / FROM RETURN TO RECORD</p>
          <h2>
            A return becomes
            <br />
            <em>a reason to look closer.</em>
          </h2>
          <p>
            One Contact. Every observation behind it.
            <br />A clear path to a human decision.
          </p>
          <ol className="formation-stages">
            {stages.map((s, i) => (
              <li
                key={s}
                className={stage === i ? "active" : stage > i ? "complete" : ""}
              >
                <button
                  onClick={() => setStage(i)}
                  aria-current={stage === i ? "step" : undefined}
                >
                  <span>0{i + 1}</span>
                  {s}
                  <ArrowRight size={16} />
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="formation-visual">
          <div className="formation-image">
            <img
              src="/sonar/viator-detail.png"
              alt="Real side-scan sonar crop from the AI4Shipwrecks Viator recording"
              loading="lazy"
            />
            <span className="raster-meta">SIDE-SCAN SONAR / VIATOR</span>
            {stage > 0 && (
              <div className="formation-box">
                <span>{stage > 1 ? "CONTACT CT-01" : "OBSERVATION"}</span>
              </div>
            )}
            {stage > 1 && (
              <div className="formation-observations">
                <span>01</span>
                <span>02</span>
                <span>03</span>
                <i />
                <b>One Contact</b>
              </div>
            )}
            {stage > 2 && (
              <div className="formation-evidence">
                <AudioLines size={16} />
                {stage > 3 ? "Ready for human review" : "Evidence, connected"}
                <ArrowUpRight size={16} />
              </div>
            )}
          </div>
          <div className="caption">
            <span>Real sonar. Illustrative Contact formation.</span>
            <span>AI4Shipwrecks / CC BY 4.0</span>
          </div>
        </div>
      </section>
      <section ref={preview} className="product-preview landing-section">
        <div className="preview-heading">
          <div>
            <p className="eyebrow">02 / THE OPERATIONAL PICTURE</p>
            <h2>
              From what it is.
              <br />
              <em>To where to look.</em>
            </h2>
          </div>
          <p>
            Stay with the sonar. Follow the evidence.
            <br />
            Bring the whole survey into view.
          </p>
        </div>
        <div className="landing-map-frame">
          <div className="preview-chrome">
            <span>
              <Waves size={18} /> Epitome · harbour approach
            </span>
            <span>ILLUSTRATIVE MAP PREVIEW</span>
          </div>
          {showMap ? (
            <Suspense fallback={<div className="map-placeholder" />}>
              <SurveyMap survey={epitomeNavigated} preview />
            </Suspense>
          ) : (
            <div className="map-placeholder" />
          )}
        </div>
      </section>
      <section className="capabilities-section landing-section">
        <div>
          <p className="eyebrow">03 / FIVE WAYS TO LOOK DEEPER</p>
          <h2>
            More context.
            <br />
            <em>Better decisions.</em>
          </h2>
        </div>
        <div className="capability-list">
          {capabilities.map(([title, description, Icon], i) => (
            <div className="capability-row" key={title}>
              <span className="capability-number">0{i + 1}</span>
              <Icon size={22} />
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="launch-section">
        <p className="eyebrow">THE NEXT RETURN IS YOURS TO EXPLORE.</p>
        <h2>Clarity starts below.</h2>
        <Link to="/intake" className="button button-cream">
          Launch Workspace
          <ArrowUpRight size={18} />
        </Link>
        <footer>
          <Logo />
          <a href="/sonar/ATTRIBUTION.json" target="_blank" rel="noreferrer">
            Image credits
            <ArrowUpRight size={13} />
          </a>
        </footer>
      </section>
    </main>
  );
}
