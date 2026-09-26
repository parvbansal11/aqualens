import { useState } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Fingerprint,
  MapPin,
  Layers3,
  AudioLines,
  Check,
  Circle,
  Info,
} from "lucide-react";
import { useWorkspace } from "../lib/store";
import {
  representative,
  score,
  coordinate,
  contactMetric,
} from "../lib/runtime/selectors";
import { Status, IllustrativeNote, Drawer, Empty } from "../components/ui";
import { SonarViewer } from "../components/SonarViewer";
export default function ContactPage() {
  const { contactId } = useParams();
  const { role, survey, manualObservations, chooseObservation } =
    useWorkspace();
  const [mode, setMode] = useState("raw"),
    [evidenceOpen, setEvidenceOpen] = useState(false);
  if (role !== "analyst") return <Navigate to="/workspace" replace />;
  const contact = survey?.contacts.find((c) => c.id === contactId);
  if (!survey || !contact)
    return (
      <main id="main-content" className="workspace-main">
        <Empty title="Choose a Contact to inspect.">
          <Link className="button" to="/workspace/results">
            View Results
          </Link>
        </Empty>
      </main>
    );
  const observation = representative(
      contact,
      survey.observations,
      manualObservations[`${survey.id}/${contact.id}`],
    ),
    frame = survey.frames.find((f) => f.id === observation?.frameId),
    demo = survey.source === "PRESENTATION",
    metric = contactMetric(contact);
  const associated = contact.observationIds
    .map((id) => survey.observations.find((o) => o.id === id))
    .filter((o) => !!o);
  return (
    <main id="main-content" className="contact-page">
      <div className="contact-heading">
        <div>
          <Link className="text-link back-link" to="/workspace/results">
            <ArrowLeft size={14} />
            Contacts
          </Link>
          <div className="contact-title-line">
            <span className="mono contact-id">{contact.shortId}</span>
            <h1>{contact.label}</h1>
            <Status value={contact.review} />
          </div>
          <div className="contact-top-meta">
            <span>{associated.length} source observations</span>
            {metric.value !== null && (
              <span>
                {metric.label} <b>{score(metric.value)}</b>
              </span>
            )}
            {demo && <IllustrativeNote />}
          </div>
        </div>
        <div className="segmented sonar-modes" aria-label="Sonar display mode">
          {["raw", "enhanced", "detections"].map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="contact-layout">
        <section className="sonar-column" aria-label="Sonar inspection">
          {frame ? (
            <SonarViewer
              key={observation?.id}
              frame={frame}
              observation={observation}
              mode={mode}
              demo={demo}
            />
          ) : (
            <Empty title="No source raster is associated." />
          )}
          <div className="filmstrip-label">
            <span>SOURCE OBSERVATIONS</span>
            <span>
              {associated.findIndex((o) => o.id === observation?.id) + 1} /{" "}
              {associated.length}
            </span>
          </div>
          <div className="observation-filmstrip">
            {associated.map((o, i) => {
              const f = survey.frames.find((f) => f.id === o.frameId);
              return (
                <button
                  key={o.id}
                  aria-pressed={o.id === observation?.id}
                  onClick={() => chooseObservation(contact.id, o.id)}
                  aria-label={`Select observation ${i + 1}`}
                >
                  <div>
                    {f && <img src={f.image} alt="" />}
                    <span className="filmstrip-index">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {o.id === observation?.id && (
                      <span className="filmstrip-check">
                        <Check size={12} />
                      </span>
                    )}
                  </div>
                  <span className="mono">{f?.id ?? o.frameId}</span>
                  {o.id === contact.bestObservationId && (
                    <small>Representative</small>
                  )}
                </button>
              );
            })}
          </div>
          <div className="raster-provenance">
            <span>{frame?.name}</span>
            {demo && (
              <a
                href="/sonar/ATTRIBUTION.json"
                target="_blank"
                rel="noreferrer"
              >
                AI4Shipwrecks · image credits
                <ArrowUpRight size={12} />
              </a>
            )}
          </div>
        </section>
        <aside className="contact-context">
          <p className="eyebrow">CONTACT CONTEXT</p>
          <div className="context-block">
            <span>Classification</span>
            <h3>{contact.label}</h3>
            {demo ? (
              <small>Illustrative classification</small>
            ) : observation?.classificationSource === "DEMO_HEURISTIC" ? (
              <small>Illustrative heuristic · not production qualified</small>
            ) : null}
          </div>
          {metric.value !== null && (
            <div className="context-block evidence-context">
              <span>{metric.label}</span>
              <strong>{score(metric.value)}</strong>
              <small>
                {contact.confidence !== null
                  ? "Normalized Contact confidence"
                  : "Uncalibrated · available channels"}
              </small>
            </div>
          )}
          {contact.position && (
            <div className="context-block">
              <span>
                <MapPin size={14} />
                {demo ? "Illustrative position" : "Source-frame position"}
              </span>
              <p className="coordinates mono">
                {coordinate(contact.position.lat, true)}
                <br />
                {coordinate(contact.position.lon, false)}
              </p>
              <div className="context-subrow">
                {contact.position.depthM !== null && (
                  <span>
                    Depth <b>{contact.position.depthM.toFixed(1)} m</b>
                  </span>
                )}
                {contact.position.heading !== null && (
                  <span>
                    Heading <b>{contact.position.heading.toFixed(1)}°</b>
                  </span>
                )}
              </div>
              <Link
                to={`/workspace/map?contact=${contact.id}`}
                className="text-link"
              >
                Locate on map
                <ArrowUpRight size={14} />
              </Link>
            </div>
          )}
          {contact.persistence && (
            <div className="context-block">
              <span>
                <Layers3 size={14} />
                Persistence
              </span>
              <strong className="context-value">
                {contact.persistence.frames} source frames
              </strong>
              <small>
                {demo ? "Illustrative sequence" : "Sequential ping evidence"}
              </small>
            </div>
          )}
          {contact.openSet?.candidate && (
            <div className="open-set-context">
              <Fingerprint size={19} />
              <div>
                <strong>Unusual pattern</strong>
                <p>Different from reference memory.</p>
              </div>
            </div>
          )}
          <button
            className="button button-secondary evidence-button"
            onClick={() => setEvidenceOpen(true)}
          >
            Inspect evidence
            <ChevronRight size={17} />
          </button>
          <div className="context-review">
            <Link
              className="text-link"
              to={`/workspace/review/${encodeURIComponent(contact.id)}`}
            >
              Review Contact
            </Link>
            <Status value={contact.review} />
          </div>
        </aside>
      </div>
      {evidenceOpen && (
        <Drawer
          title="The evidence behind this Contact"
          onClose={() => setEvidenceOpen(false)}
        >
          <div className="evidence-drawer-content">
            {demo && (
              <>
                <IllustrativeNote />
                <p className="disclosure-note">
                  Values and associations are illustrative. No model output is
                  assigned to these source images.
                </p>
              </>
            )}
            <div className="evidence-summary">
              <span>{contact.shortId}</span>
              <span>{associated.length} observations</span>
              <Status value={contact.review} />
            </div>
            <details className="evidence-channel">
              <summary>
                <AudioLines size={17} />
                <span>Detector</span>
                <b>
                  {observation?.rawScore != null ? "RECORDED" : "NOT MEASURED"}
                </b>
                <ChevronDown size={14} />
              </summary>
              <div>
                {observation?.rawScore != null ? (
                  <>
                    <dl>
                      <div>
                        <dt>Raw detector output</dt>
                        <dd>
                          {observation.rawClass} · {observation.rawScore}
                        </dd>
                      </div>
                      <div>
                        <dt>Classification source</dt>
                        <dd>
                          {observation.classificationSource === "DEMO_HEURISTIC"
                            ? "Illustrative heuristic"
                            : observation.classificationSource}
                        </dd>
                      </div>
                      <div>
                        <dt>Production qualified</dt>
                        <dd>
                          {observation.productionQualified ? "Yes" : "No"}
                        </dd>
                      </div>
                    </dl>
                    {observation.rawClass === "SHIPWRECK" && (
                      <p>
                        Frozen SHIPWRECK recall is limited; illustrative
                        classifications are not production qualified.
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    {demo
                      ? "No detector was run for this illustrative survey. "
                      : ""}
                    Raw detector score is not supplied.
                  </p>
                )}
              </div>
            </details>
            {contact.channels.map((ch) => (
              <details key={ch.id} className="evidence-channel">
                <summary>
                  <Circle size={14} />
                  <span>{ch.label}</span>
                  <b>{ch.state}</b>
                  <ChevronDown size={14} />
                </summary>
                <div>
                  {ch.value !== null && (
                    <p className="channel-value">{score(ch.value)}</p>
                  )}
                  <p>{ch.detail}</p>
                </div>
              </details>
            ))}
            {contact.openSet && (
              <details className="evidence-channel">
                <summary>
                  <Fingerprint size={17} />
                  <span>Open-set</span>
                  <b>RECORDED</b>
                  <ChevronDown size={14} />
                </summary>
                <div>
                  <dl>
                    <div>
                      <dt>Anomaly distance</dt>
                      <dd>{contact.openSet.score}</dd>
                    </div>
                    <div>
                      <dt>Reference threshold</dt>
                      <dd>{contact.openSet.threshold}</dd>
                    </div>
                    <div>
                      <dt>Memory</dt>
                      <dd>{contact.openSet.memory}</dd>
                    </div>
                    <div>
                      <dt>Threshold source</dt>
                      <dd>{contact.openSet.thresholdSource}</dd>
                    </div>
                  </dl>
                  <p>
                    Unusual relative to reference memory. Not probability,
                    artificiality, or danger.
                  </p>
                </div>
              </details>
            )}
            {contact.position && (
              <details className="evidence-channel">
                <summary>
                  <MapPin size={17} />
                  <span>Navigation</span>
                  <b>{demo ? "ILLUSTRATIVE" : "SUPPLIED"}</b>
                  <ChevronDown size={14} />
                </summary>
                <div>
                  <p>
                    {demo
                      ? "Illustrative map position. Unrelated to the sonar acquisition site."
                      : "Position inherited from frame navigation. This is not calibrated pixel-to-world object localization."}
                  </p>
                </div>
              </details>
            )}
            <details className="evidence-channel">
              <summary>
                <Layers3 size={17} />
                <span>Fusion</span>
                <b>{contact.evidence !== null ? "RECORDED" : "NOT MEASURED"}</b>
                <ChevronDown size={14} />
              </summary>
              <div>
                <p className="mono">{contact.evidenceType}</p>
                <p>
                  Evidence strength is not a calibrated probability. Missing
                  channels are excluded.
                </p>
                {contact.missingChannels.length > 0 && (
                  <p>Missing: {contact.missingChannels.join(", ")}</p>
                )}
              </div>
            </details>
            <details className="evidence-channel">
              <summary>
                <Info size={17} />
                <span>Technical record</span>
                <ChevronDown size={14} />
              </summary>
              <div>
                <dl>
                  <div>
                    <dt>Contact ID</dt>
                    <dd className="mono">{contact.id}</dd>
                  </div>
                  <div>
                    <dt>Observation ID</dt>
                    <dd className="mono">{observation?.id}</dd>
                  </div>
                  {observation?.modelSha && (
                    <div>
                      <dt>Detector SHA-256</dt>
                      <dd className="mono">{observation.modelSha}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Source</dt>
                    <dd>{survey.source}</dd>
                  </div>
                </dl>
                <p>
                  Natural Clutter is advisory only; it cannot automatically
                  suppress Contacts. Reviews are append-only. Online learning is
                  disabled.
                </p>
                {survey.missionNotes && <p>{survey.missionNotes}</p>}
              </div>
            </details>
          </div>
        </Drawer>
      )}
    </main>
  );
}
