"use client";

import { AlertTriangle } from "lucide-react";
import type { Detection, RecoveryPriority, Review, ReviewVerdict } from "@/lib/types";
import type { ReviewInput } from "@/lib/services";
import { CLASS_LABELS } from "@/lib/view/labels";
import { fixed, percent, shortSha } from "@/lib/view/format";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { Unavailable } from "./Unavailable";
import { FusionWaterfall } from "./FusionWaterfall";
import { EvidencePanel } from "./EvidencePanel";
import { ReviewForm } from "./ReviewForm";
import { ReviewHistory } from "./ReviewHistory";

/** Resolved when the caller has already loaded the full review list from the API. */
export interface DetectionInspectorProps {
  detection: Detection | null;
  priority: RecoveryPriority | null;
  reviews: Review[];
  submitting: ReviewVerdict | null;
  message: string | null;
  reviewer: string;
  onSubmit: (input: ReviewInput) => void;
}

/**
 * Full evidence inspector for one detection.
 *
 * This component owns no fetching and carries no fixture data. The parent page
 * is responsible for loading the detection, its priority record, and its review
 * history from the service layer. That separation means the inspector can be
 * mounted in both the Workspace and the Review surface without duplicating the
 * API wiring.
 *
 * UNKNOWN invariant: class_confidence is never rendered for UNKNOWN detections,
 * because the contract states it must be null for that kind.
 */
export function DetectionInspector({
  detection,
  priority,
  reviews,
  submitting,
  message,
  reviewer,
  onSubmit,
}: DetectionInspectorProps) {
  if (!detection) {
    return (
      <aside className="inspector inspector-empty" aria-label="Detection inspector">
        <div className="empty-glyph" aria-hidden="true">+</div>
        <h2>No detection selected</h2>
        <p>Select an overlay or a queue item to inspect evidence and provenance.</p>
      </aside>
    );
  }

  const unknown = detection.kind === "UNKNOWN";

  return (
    <aside className="inspector" aria-label="Detection inspector">
      <header className="inspector-header">
        <span className={`detection-kind kind-${detection.kind.toLowerCase()}`}>
          {detection.kind}
        </span>
        <span className="review-state">{detection.review.latest_verdict ?? "UNREVIEWED"}</span>
        <h2>
          {unknown
            ? "Unknown anomaly candidate requiring review"
            : CLASS_LABELS[detection.category]}
        </h2>
        <span className="object-id">{detection.detection_id}</span>
      </header>

      {/* Score summary. UNKNOWN invariant enforced here. */}
      <div className="hero-score">
        {!unknown && detection.class_confidence !== null && (
          <div>
            <small>Class confidence</small>
            <strong>{percent(detection.class_confidence, 0)}</strong>
            <ProvenanceBadge value={detection.provenance.class} />
          </div>
        )}
        <div>
          <small>Fusion confidence</small>
          <strong>
            {detection.fusion.final_confidence !== null
              ? percent(detection.fusion.final_confidence, 0)
              : "unavailable"}
          </strong>
          <ProvenanceBadge value={detection.provenance.fusion} />
        </div>
        {detection.anomaly_score !== null && (
          <div>
            <small>Anomaly score</small>
            <strong>{fixed(detection.anomaly_score, 2)}</strong>
            <ProvenanceBadge value={detection.provenance.class} />
          </div>
        )}
      </div>

      {unknown && (
        <p className="unknown-contract">
          <AlertTriangle size={14} aria-hidden="true" />
          No class confidence — open-world candidate
        </p>
      )}

      <FusionWaterfall detection={detection} />
      <EvidencePanel detection={detection} />

      <section className="inspector-section">
        <h3>Geometry and location</h3>
        <div className="metric-row">
          <span>PICS centre</span>
          <strong>
            {detection.geometry.pics.ping_centre !== null
              ? `ping ${detection.geometry.pics.ping_centre.toLocaleString()}, ${detection.geometry.pics.side}`
              : "unavailable"}
          </strong>
          <ProvenanceBadge value={detection.provenance.geo} />
        </div>
        <div className="metric-row">
          <span>Dimensions</span>
          <strong>
            {fixed(detection.dimensions.length_px, 1)} x{" "}
            {fixed(detection.dimensions.width_px, 1)} px
          </strong>
          <ProvenanceBadge value={detection.provenance.class} />
        </div>
        {detection.dimensions.length_m !== null ? (
          <div className="metric-row">
            <span>Size in metres</span>
            <strong>
              {fixed(detection.dimensions.length_m, 1)} x{" "}
              {fixed(detection.dimensions.width_m, 1)} m
            </strong>
            <ProvenanceBadge value={detection.provenance.geo} />
          </div>
        ) : (
          <Unavailable reason={detection.dimensions.reason} label="Metric dimensions" />
        )}
        {detection.geo.lat !== null && detection.geo.lon !== null ? (
          <div className="metric-row">
            <span>Position</span>
            <strong>
              {detection.geo.lat.toFixed(4)}, {detection.geo.lon.toFixed(4)}
              {detection.geo.position_uncertainty_m !== null &&
                ` ±${fixed(detection.geo.position_uncertainty_m, 0)} m`}
            </strong>
            <ProvenanceBadge value={detection.geo.provenance} />
          </div>
        ) : (
          <Unavailable reason={detection.geo.reason} label="Geographic position" />
        )}
      </section>

      <section className="inspector-section">
        <h3>Model provenance</h3>
        <dl className="definition-list">
          <dt>Model</dt>
          <dd>{detection.model.model_id}</dd>
          <dt>Version</dt>
          <dd>{detection.model.model_version_id}</dd>
          <dt>Device</dt>
          <dd>{detection.model.device}</dd>
          <dt>Weights</dt>
          <dd>
            <button
              type="button"
              className="copy-value"
              title="Copy full SHA-256 to clipboard"
              onClick={() => navigator.clipboard?.writeText(detection.model.weights_sha256)}
            >
              {shortSha(detection.model.weights_sha256, 12)}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            </button>
          </dd>
        </dl>
      </section>

      <section className="inspector-section">
        <h3>Recovery priority</h3>
        {detection.priority.applicable === false ? (
          <Unavailable reason={detection.priority.reason ?? "NOT_APPLICABLE"} label="Priority" />
        ) : (
          <>
            <div className="metric-row">
              <span>Rank {detection.priority.rank ?? "unset"}</span>
              <strong>{fixed(detection.priority.score ?? null, 2) ?? "unset"}</strong>
              <ProvenanceBadge value="HEURISTIC_DERIVED" />
            </div>
            {priority && (
              <>
                <div className="priority-breakdown">
                  {Object.entries(priority.components).map(([name, component]) => (
                    <div key={name}>
                      <span>{name.replaceAll("_", " ")}</span>
                      <code>
                        {component.weight.toFixed(2)} x {component.value.toFixed(2)} to{" "}
                        {component.contribution.toFixed(3)}
                      </code>
                    </div>
                  ))}
                </div>
                <p className="disclaimer">{priority.disclaimer}</p>
              </>
            )}
          </>
        )}
      </section>

      <ReviewForm
        detectionId={detection.detection_id}
        onSubmit={onSubmit}
        submitting={submitting}
        message={message}
        reviewer={reviewer}
      />
      <ReviewHistory reviews={reviews} />
    </aside>
  );
}
