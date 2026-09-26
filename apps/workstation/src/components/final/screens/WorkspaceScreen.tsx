"use client";

import { Badge, Segmented, Unavailable } from "../parts/Primitives";
import { SonarFrame, type Layer } from "../parts/SonarFrame";
import { EvidenceLadder } from "../parts/EvidenceLadder";
import {
  classLabel,
  confidenceLabel,
  contactViewFor,
  coordinates,
  dimensions,
  evidenceScoreLabel,
  frameMeta,
  hasPosition,
  headingLabel,
  isUnknown,
  provenance,
  reviewBadge,
  reviewText,
  shortId,
  timestampLabel,
  whySentence,
  type ContactView,
} from "../runtime/select";
import { BUTTONS, COPY, LAYERS, LAYER_NOTE, UNAVAILABLE } from "../runtime/strings";
import type { RuntimeFinding, RuntimeFrame, RuntimeSurvey } from "../runtime/types";

/**
 * §5.7 Sonar inspection workspace. Three panes at 214 / 1fr / 356.
 *
 * The left rail lists Contacts, because a Contact is the operational object.
 * The inspector shows the selected Contact, the raw observations it was fused
 * from, and — behind one disclosure — the full evidence ladder. The sonar image
 * dominates and is the only dark surface here.
 */
export function WorkspaceScreen({
  survey,
  contacts,
  findings,
  selected,
  onSelect,
  layer,
  onLayer,
  tech,
  onToggleTech,
  rasterFor,
  onSendToReview,
  onMap,
}: {
  survey: RuntimeSurvey | null;
  contacts: ContactView[];
  findings: RuntimeFinding[];
  selected: RuntimeFinding | null;
  onSelect: (finding: RuntimeFinding) => void;
  layer: Layer;
  onLayer: (layer: Layer) => void;
  tech: boolean;
  onToggleTech: () => void;
  rasterFor: (finding: RuntimeFinding | null) => string | null;
  onSendToReview: () => void;
  onMap: () => void;
}) {
  const frame: RuntimeFrame | undefined = survey?.frames.find(
    (item) => item.frame_id === selected?.source_frame_id,
  );
  const badge = selected ? reviewBadge(selected) : null;
  const view = contactViewFor(contacts, selected);
  const showingContacts = contacts.length > 0;
  const boxes = layer === "detections" || layer === "change";
  const sameFrame = selected
    ? findings.filter((item) => item.source_frame_id === selected.source_frame_id)
    : [];

  /* §5.7 ping strip. Bind cell count to the real window count: this pipeline's
   * window is one source frame, so the strip names frames rather than pings. */
  const cells = survey?.frames ?? [];

  return (
    <div className="sd-workspace">
      <div className="sd-ws-rail">
        <small className="sd-eyebrow">
          {showingContacts ? "Contacts in this survey" : "Findings in this survey"}
        </small>
        <div className="sd-ws-rail-list">
          {findings.length === 0 ? (
            <p className="sd-ws-rail-empty">No finding records.</p>
          ) : showingContacts ? (
            contacts.map((item) => {
              const tone = item.badge.tone;
              const current =
                item.contact.source_detection_ids.includes(selected?.detection_id ?? "") ||
                item.contact.best_observation_id === selected?.detection_id;
              return (
                <button
                  key={item.contact.contact_id}
                  type="button"
                  className="sd-ws-contact"
                  data-contact-id={item.contact.contact_id}
                  aria-current={current}
                  onClick={() => onSelect(item.best)}
                >
                  <div className="sd-ws-contact-grid">
                    <i data-kind={item.unknown ? "unknown" : "known"} data-tone={tone} />
                    <div style={{ minWidth: 0 }}>
                      <b>{item.label}</b>
                      <span className="sd-mono">
                        {`${item.contact.contact_id.replace(/^contact_survey_upload_[0-9a-f]+_/, "")} · ${item.observationCount} obs · ${evidenceScoreLabel(item.evidenceScore)}`}
                      </span>
                    </div>
                    {item.openSetCandidate ? <u aria-label="Open-set candidate">OS</u> : null}
                  </div>
                </button>
              );
            })
          ) : (
            findings.map((finding) => {
              const tone = reviewBadge(finding).tone;
              return (
                <button
                  key={finding.detection_id}
                  type="button"
                  className="sd-ws-contact"
                  aria-current={selected?.detection_id === finding.detection_id}
                  onClick={() => onSelect(finding)}
                >
                  <div className="sd-ws-contact-grid">
                    <i data-kind={isUnknown(finding) ? "unknown" : "known"} data-tone={tone} />
                    <div style={{ minWidth: 0 }}>
                      <b>{classLabel(finding)}</b>
                      <span className="sd-mono">
                        {shortId(finding)} · {confidenceLabel(finding.raw_confidence)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="sd-ws-centre">
        <div className="sd-ws-bar">
          <Segmented value={layer} options={LAYERS} onChange={onLayer} label="Sonar layer" />
          <span className="sd-ws-layer-note">{LAYER_NOTE[layer][1]}</span>
          {selected ? (
            <span className="sd-ws-ping-meta sd-mono">{frameMeta(selected, frame)}</span>
          ) : null}
        </div>

        <div className="sd-ws-viewer">
          <SonarFrame
            finding={selected}
            frame={frame}
            src={rasterFor(selected)}
            layer={layer}
            boxes={boxes}
            overlayFindings={sameFrame}
          />
          {selected ? (
            <div className="sd-ws-overlay">
              <div className="sd-plaque">
                <b>{LAYER_NOTE[layer][0]}</b>
                <span className="sd-mono">
                  {frame
                    ? `Whole frame · ${frame.width_px} × ${frame.height_px} px · ${frame.frame_id}`
                    : "Source frame unavailable"}
                </span>
              </div>
              <div className="sd-range-scale sd-mono">
                <span>Port</span>
                <i />
                <span>Nadir</span>
                <i />
                <span>Stbd</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="sd-ws-strip">
          <div className="sd-ws-strip-head">
            <small>Source frames</small>
            <span className="sd-mono">{cells.length > 0 ? `1 – ${cells.length}` : "None"}</span>
          </div>
          <div className="sd-ws-cells">
            {cells.length === 0 ? <button type="button" disabled /> : null}
            {cells.map((item) => {
              const hit = findings.find((f) => f.source_frame_id === item.frame_id);
              const isSelected = selected?.source_frame_id === item.frame_id;
              return (
                <button
                  key={item.frame_id}
                  type="button"
                  disabled={!hit}
                  data-hit={Boolean(hit)}
                  data-selected={isSelected && Boolean(hit)}
                  title={item.frame_id}
                  aria-label={`Source frame ${item.frame_id}`}
                  onClick={() => hit && onSelect(hit)}
                />
              );
            })}
          </div>
        </div>
      </div>

      <aside className="sd-inspector" aria-label="Contact inspector">
        {selected && badge ? (
          <>
            <div className="sd-inspector-badges">
              <Badge label={view ? "Contact" : "Raw observation"} tone={view ? "accent" : "null"} />
              <Badge label={badge.label} tone={badge.tone} />
              {view?.openSetCandidate ? <Badge label="Open-set candidate" tone="warn" /> : null}
            </div>
            <h2>{classLabel(selected)}</h2>
            <span className="sd-inspector-id sd-mono">
              {view ? view.contact.contact_id : selected.detection_id} · {frameMeta(selected, frame)}
            </span>

            <div className="sd-inspector-figures">
              <div>
                <small>
                  EVIDENCE STRENGTH{" "}
                  <span
                    className="sd-info-affordance"
                    title="Combined available evidence. Not a probability."
                    aria-label="Combined available evidence. Not a probability."
                  >
                    ⓘ
                  </span>
                </small>
                <b>{evidenceScoreLabel(view?.evidenceScore ?? null)}</b>
              </div>
            </div>

            <div className="sd-inspector-block">
              <small className="sd-eyebrow sd-eyebrow-md">Why it was flagged</small>
              <p className="sd-inspector-why">{whySentence(selected)}</p>
              <p className="sd-inspector-evidence">{COPY.evidenceScoreCaveat}</p>
            </div>

            <div className="sd-inspector-block">
              <dl className="sd-dl">
                <dt>Position</dt>
                <dd className="sd-mono">{coordinates(selected)}</dd>
                <dt>Heading</dt>
                <dd className="sd-mono">{headingLabel(selected)}</dd>
                <dt>Timestamp (UTC)</dt>
                <dd className="sd-mono">{timestampLabel(selected)}</dd>
                <dt>Extent</dt>
                <dd className="sd-mono">{dimensions(selected)}</dd>
                <dt>Review</dt>
                <dd>{reviewText(selected)}</dd>
              </dl>
              {!hasPosition(selected) ? (
                <Unavailable title={UNAVAILABLE.locationTitle} className="sd-tech-demo">
                  {UNAVAILABLE.locationBody}
                </Unavailable>
              ) : null}
            </div>

            {view && view.observations.length > 0 ? (
              <div className="sd-inspector-block">
                <small className="sd-eyebrow sd-eyebrow-md">
                  {`Raw observations in this contact (${view.observations.length})`}
                </small>
                <p className="sd-inspector-evidence">{COPY.observationsInContact}</p>
                <div className="sd-observations">
                  {view.observations.map((item) => (
                    <button
                      key={item.detection_id}
                      type="button"
                      aria-current={item.detection_id === selected.detection_id}
                      onClick={() => onSelect(item)}
                    >
                      <b className="sd-mono">{shortId(item)}</b>
                      <span>
                        {`${item.raw_class} · ${item.source_frame_id}`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Everything technical lives here and nowhere else. Closed on load. */}
            <button
              type="button"
              className="sd-disclosure"
              aria-expanded={tech}
              aria-controls="sd-evidence-ladder"
              onClick={onToggleTech}
            >
              <span>{tech ? BUTTONS.techClose : BUTTONS.techOpen}</span>
              <span aria-hidden="true">{tech ? "▴" : "▾"}</span>
            </button>

            {tech ? (
              <div className="sd-tech" id="sd-evidence-ladder">
                <EvidenceLadder view={view} finding={selected} survey={survey} />
                <div className="sd-tech-row">
                  <div>
                    <b>Model provenance</b>
                    <span className="sd-tech-note">Detector and evaluation run</span>
                  </div>
                  <span className="sd-tech-value sd-mono">{provenance(selected)}</span>
                </div>
                <p className="sd-tech-caption">{COPY.techCaption}</p>
              </div>
            ) : null}

            <div className="sd-inspector-actions">
              <button type="button" className="sd-btn-primary" onClick={onSendToReview}>
                {BUTTONS.sendToReview}
              </button>
              <button type="button" className="sd-btn-secondary" onClick={onMap}>
                {BUTTONS.map}
              </button>
            </div>
          </>
        ) : (
          <Unavailable title="No contact selected">
            This survey has no finding records to inspect. Upload a survey to begin.
          </Unavailable>
        )}
      </aside>
    </div>
  );
}
