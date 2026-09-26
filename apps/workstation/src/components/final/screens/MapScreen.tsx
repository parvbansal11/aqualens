"use client";

import { Badge, Segmented, Unavailable } from "../parts/Primitives";
import {
  classLabel,
  contactAction,
  contactViewFor,
  coordinates,
  countPositioned,
  dimensions,
  evidenceBandLabel,
  evidenceScoreLabel,
  hasPosition,
  isUnknown,
  reviewBadge,
  reviewText,
  type ContactView,
} from "../runtime/select";
import { BUTTONS, TITLES, UNAVAILABLE } from "../runtime/strings";
import type { RuntimeFinding, RuntimeSurvey } from "../runtime/types";

export type MapMode = "chart" | "coverage";

/** Real projected geometry, when a deployment supplies it. Nothing here is
 * invented: with no navigation records the geographic layers do not render. */
export type MapGeometry = {
  coastline: string | null;
  /** Real per-frame navigation fixes, in frame order. Never interpolated. */
  track: { frameId: string; point: [number, number] }[] | null;
  swath: string | null;
  gap: string | null;
  gapArea: string | null;
  cornerLabel: string | null;
  scaleLabel: string | null;
  /** [x%, y%] per finding id, projected onto the frame. */
  markers: Record<string, [number, number]>;
};

const MODES = [
  ["chart", "Chart plot"],
  ["coverage", "Coverage"],
] as const;

function markerColor(finding: RuntimeFinding) {
  const tone = reviewBadge(finding).tone;
  if (tone === "ok") return "var(--sd-ok)";
  if (tone === "accent") return "var(--sd-accent)";
  if (tone === "crit") return "var(--sd-crit)";
  if (tone === "null") return "var(--sd-null)";
  return "var(--sd-warn)";
}

/**
 * §5.6 Map — "Where is it?".
 *
 * A marker is drawn only from a coordinate a navigation record actually
 * supplied, and the track is only the per-frame fixes that were recorded, in
 * frame order, joined as recorded. Selecting a marker selects the same Contact
 * the workspace is showing, so the two screens never disagree.
 */
export function MapScreen({
  contacts,
  findings,
  selected,
  onSelect,
  onOpenWorkspace,
  mode,
  onMode,
  geometry,
  survey,
  trackPoints,
}: {
  contacts: ContactView[];
  findings: RuntimeFinding[];
  selected: RuntimeFinding | null;
  onSelect: (finding: RuntimeFinding) => void;
  onOpenWorkspace: () => void;
  mode: MapMode;
  onMode: (mode: MapMode) => void;
  geometry: MapGeometry | null;
  survey: RuntimeSurvey | null;
  trackPoints: number;
}) {
  const positioned = findings.filter(hasPosition);
  const coverage = mode === "coverage";
  const view = contactViewFor(contacts, selected);
  const badge = selected ? reviewBadge(selected) : null;
  const frameCount = survey?.frames.length ?? 0;
  const positionedContacts = contacts.filter((item) => item.positioned).length;

  const subtitle = coverage
    ? "No coverage polygon accompanies this survey, so surveyed and unsurveyed areas cannot be separated. An area with no marker is not an area confirmed clear."
    : contacts.length > 0
      ? `${positionedContacts} of ${contacts.length} contacts carry a supplied position. ${trackPoints} of ${frameCount} source frames carry a navigation fix.`
      : `${countPositioned(findings)} of ${findings.length} observations carry a supplied position.`;

  const trackPath =
    geometry?.track && geometry.track.length > 1
      ? geometry.track.map((point, index) => `${index === 0 ? "M" : "L"}${point.point[0] * 9},${point.point[1] * 5.2}`).join(" ")
      : null;

  return (
    <section className="sd-page sd-map">
      <div className="sd-map-head">
        <div>
          <h1>{TITLES.map}</h1>
          <p>{subtitle}</p>
        </div>
        <Segmented value={mode} options={MODES} onChange={onMode} label="Map mode" />
      </div>

      <div className="sd-map-grid">
        <div>
          <div className="sd-map-frame">
            {/* Layers, back to front: water, coastline, graticule, sonar coverage
             * swath, vessel track, not-surveyed gap, corner label and scale bar.
             * Every geographic layer is drawn only from real geometry. */}
            <svg viewBox="0 0 900 520" role="img" aria-label="Survey chart plot">
              <rect x="0" y="0" width="900" height="520" fill="var(--sd-map-water)" />
              {geometry?.coastline ? (
                <path
                  d={geometry.coastline}
                  fill="var(--sd-map-land)"
                  stroke="var(--sd-map-land-edge)"
                  strokeWidth="1"
                />
              ) : null}
              <g stroke="var(--sd-map-grid)" strokeWidth="1">
                <path d="M240,0 L240,520 M400,0 L400,520 M560,0 L560,520 M720,0 L720,520" />
                <path d="M0,120 L900,120 M0,250 L900,250 M0,380 L900,380" />
              </g>
              {geometry?.swath ? (
                <path
                  d={geometry.swath}
                  fill="none"
                  stroke="var(--sd-map-swath)"
                  strokeWidth="66"
                  strokeLinecap="round"
                  opacity={coverage ? 0.8 : 0.55}
                />
              ) : null}
              {trackPath ? (
                <>
                  <path
                    className="sd-map-track"
                    d={trackPath}
                    fill="none"
                    stroke="var(--sd-accent)"
                    strokeWidth="1.6"
                    strokeDasharray="7 5"
                  />
                  {geometry?.track?.map((point) => (
                    <circle
                      key={point.frameId}
                      cx={point.point[0] * 9}
                      cy={point.point[1] * 5.2}
                      r="2.5"
                      fill="var(--sd-accent)"
                      opacity="0.75"
                    >
                      <title>{`${point.frameId}: recorded navigation fix`}</title>
                    </circle>
                  ))}
                </>
              ) : null}
              {geometry?.gap ? (
                <path
                  d={geometry.gap}
                  fill="none"
                  stroke="var(--sd-map-gap)"
                  strokeWidth="52"
                  strokeLinecap="round"
                  opacity={coverage ? 0.42 : 0.22}
                />
              ) : null}
              {coverage && geometry?.gapArea ? (
                <>
                  <text x="700" y="182" fontSize="13" fontWeight="500" fill="var(--sd-ink-secondary)">
                    Not surveyed
                  </text>
                  <text x="700" y="200" fontSize="11" fill="var(--sd-ink-muted)" className="sd-mono">
                    {geometry.gapArea}
                  </text>
                </>
              ) : null}
              {geometry?.cornerLabel ? (
                <text x="24" y="502" fontSize="12" fill="var(--sd-ink-muted)" className="sd-mono">
                  {geometry.cornerLabel}
                </text>
              ) : null}
              {geometry?.scaleLabel ? (
                <>
                  <text x="762" y="30" fontSize="12" fill="var(--sd-ink-muted)" className="sd-mono">
                    {geometry.scaleLabel}
                  </text>
                  <rect x="762" y="38" width="112" height="4" fill="var(--sd-ink-muted)" opacity="0.5" />
                </>
              ) : null}
            </svg>

            {geometry
              ? positioned.map((finding) => {
                  const position = geometry.markers[finding.detection_id];
                  if (!position) return null;
                  const isSelected = selected?.detection_id === finding.detection_id;
                  const owning = contactViewFor(contacts, finding);
                  return (
                    <button
                      key={finding.detection_id}
                      type="button"
                      className="sd-marker"
                      data-kind={isUnknown(finding) ? "unknown" : "known"}
                      data-contact-id={owning?.contact.contact_id}
                      aria-label={`${classLabel(finding)} at ${coordinates(finding)}`}
                      aria-current={isSelected}
                      title={`${owning ? `${owning.contact.contact_id} · ` : ""}${classLabel(finding)} · ${coordinates(finding)}`}
                      onClick={() => onSelect(finding)}
                      style={{
                        left: `${position[0]}%`,
                        top: `${position[1]}%`,
                        background: markerColor(finding),
                        opacity: coverage && !isSelected ? 0.45 : 1,
                      }}
                    >
                      {isSelected ? <i /> : null}
                    </button>
                  );
                })
              : null}

            {positioned.length === 0 ? (
              <div className="sd-map-note">{UNAVAILABLE.noPositionAtAll}</div>
            ) : null}
          </div>

          <div className="sd-map-legend">
            <span>
              <i style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--sd-ok)" }} />
              Confirmed by an analyst
            </span>
            <span>
              <i style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--sd-accent)" }} />
              Relabelled by an analyst
            </span>
            <span>
              <i style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--sd-warn)" }} />
              Awaiting a decision
            </span>
            <span>
              <i style={{ width: 10, height: 10, borderRadius: 2, background: "var(--sd-warn)" }} />
              Unknown anomaly
            </span>
            <span>
              <i style={{ width: 16, height: 9, borderRadius: 2, background: "var(--sd-map-swath)" }} />
              Sonar coverage
            </span>
            <span>
              <i style={{ width: 16, height: 0, borderTop: "2px dashed var(--sd-accent)" }} />
              Recorded navigation fixes
            </span>
          </div>

          {!geometry ? (
            <Unavailable title={UNAVAILABLE.coverageTitle} className="sd-empty">
              {UNAVAILABLE.coverageBody}
            </Unavailable>
          ) : (
            <p className="sd-map-honesty">
              Markers are plotted from coordinates supplied by navigation records, arranged proportionally
              inside this frame. This is a relative plot, not a projected nautical chart: there is no
              basemap, no coverage polygon and no scale bar, so nothing here states how much seabed was
              surveyed.
            </p>
          )}
        </div>

        <aside>
          <div className="sd-map-panel">
            {selected && badge ? (
              <>
                <div className="sd-inspector-badges">
                  <Badge label={view ? "Contact" : "Raw observation"} tone={view ? "accent" : "null"} />
                  <Badge label={badge.label} tone={badge.tone} />
                </div>
                <h2>{classLabel(selected)}</h2>
                <span className="sd-map-panel-id sd-mono">
                  {view ? view.contact.contact_id : selected.detection_id}
                </span>

                <dl className="sd-dl">
                  <dt>Evidence strength</dt>
                  <dd>{evidenceScoreLabel(view?.evidenceScore ?? null)}</dd>
                  <dt>Position</dt>
                  <dd className="sd-mono">{coordinates(selected)}</dd>
                  <dt>Extent</dt>
                  <dd className="sd-mono">{dimensions(selected)}</dd>
                  <dt>Review</dt>
                  <dd>{reviewText(selected)}</dd>
                </dl>

                {!hasPosition(selected) ? (
                  <Unavailable title={UNAVAILABLE.locationTitle}>
                    {UNAVAILABLE.locationBody}
                  </Unavailable>
                ) : null}

                <div className="sd-map-action">
                  <small className="sd-eyebrow sd-eyebrow-md">Recommended next action</small>
                  <p>{view ? contactAction(view.contact) : UNAVAILABLE.actionWithoutContact}</p>
                  {view ? (
                    <span className="sd-map-action-band sd-mono">
                      {`Evidence priority ${evidenceBandLabel(view.contact)} · transparent rule over available evidence`}
                    </span>
                  ) : null}
                </div>

                <button type="button" className="sd-btn-secondary" onClick={onOpenWorkspace}>
                  {BUTTONS.openWorkspace}
                </button>
              </>
            ) : (
              <Unavailable title="No contact selected">
                This survey has no finding records to place. Upload a survey to begin.
              </Unavailable>
            )}
          </div>

          {contacts.length > 0 ? (
            <div className="sd-map-list">
              <small className="sd-eyebrow sd-eyebrow-md">Contacts</small>
              <div className="sd-map-list-rows">
                {contacts.map((item) => (
                  <button
                    key={item.contact.contact_id}
                    type="button"
                    aria-current={
                      item.contact.source_detection_ids.includes(selected?.detection_id ?? "") ||
                      item.contact.best_observation_id === selected?.detection_id
                    }
                    data-positioned={item.positioned}
                    onClick={() => onSelect(item.best)}
                  >
                    <b>{item.label}</b>
                    <span className="sd-mono">
                      {item.positioned
                        ? `${item.contact.latitude?.toFixed(4)}, ${item.contact.longitude?.toFixed(4)}`
                        : "No position"}
                    </span>
                  </button>
                ))}
              </div>
              <p className="sd-map-list-note">
                A contact with no position is listed but never placed. Its absence from the plot says
                nothing about where it is.
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
