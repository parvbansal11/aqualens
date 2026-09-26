"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Logo } from "../parts/Primitives";
import { PipelineFigure } from "../parts/PipelineFigure";
import { BUTTONS, COPY, TITLES } from "../runtime/strings";

/** §5.1 Landing — public shell. Both CTAs go to role entry. */
export function LandingScreen({ onEntry }: { onEntry: () => void }) {
  // Native hash navigation covers normal links. This handles a direct landing
  // URL with a hash after the client route has mounted.
  useEffect(() => {
    const targetId = window.location.hash.slice(1);
    const target = targetId ? document.getElementById(targetId) : null;
    if (target && typeof target.scrollIntoView === "function") target.scrollIntoView();
  }, []);

  return (
    <div className="sd-root">
      <header className="sd-public-header">
        <Logo />
        <nav>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#evidence">Evidence</Link>
          <Link href="/#datasets">Datasets</Link>
        </nav>
        <div className="sd-public-right">
          <span>MoES / NIOT</span>
          <button type="button" className="sd-btn-primary" onClick={onEntry}>
            {BUTTONS.trySurvey}
          </button>
        </div>
      </header>

      <section className="sd-hero">
        <div>
          <p className="sd-hero-eyebrow">{COPY.landingEyebrow}</p>
          <h1>{TITLES.landing}</h1>
          <p className="sd-hero-sub">{COPY.landingSub}</p>
          <div className="sd-hero-actions">
            <button type="button" className="sd-btn-primary sd-btn-cta" onClick={onEntry}>
              {BUTTONS.trySurvey}
            </button>
            <button type="button" className="sd-btn-secondary sd-btn-cta" onClick={onEntry}>
              {BUTTONS.howItWorks}
            </button>
          </div>
        </div>
        <div id="how-it-works" className="sd-landing-anchor" style={{ position: "relative" }}>
          <h2 className="sd-landing-anchor-title">How it works</h2>
          <PipelineFigure />
        </div>
      </section>

      <section className="sd-claims sd-landing-anchor" id="evidence">
        <div className="sd-claims-grid">
          <header className="sd-claims-heading">
            <h2>Evidence</h2>
          </header>
          {COPY.claims.map(([heading, body]) => (
            <div key={heading}>
              <h3>{heading}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="sd-claims sd-landing-anchor" id="datasets">
        <div className="sd-claims-grid">
          <header className="sd-claims-heading">
            <h2>Dataset provenance</h2>
          </header>
          <div>
            <h3>SubPipe</h3>
            <p>Side-scan sonar submarine-pipeline imagery that contributes the PIPELINE candidate class.</p>
          </div>
          <div>
            <h3>AI4Shipwrecks</h3>
            <p>Side-scan sonar shipwreck imagery with expert masks and natural seabed context.</p>
          </div>
          <div>
            <h3>PING / GhostVision</h3>
            <p>Side-scan sonar crab-pot and derelict fishing-gear imagery. It is not ghost-net ground truth.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
