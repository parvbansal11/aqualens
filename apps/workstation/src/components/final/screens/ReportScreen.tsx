"use client";

import { useState } from "react";
import { CompleteLine, Unavailable } from "../parts/Primitives";
import { failureSentence, fetchReportBlob, reportUrl, type ReportScope } from "../runtime/api";
import { countPositioned, countReviewed, evidenceScoreLabel, type ContactView } from "../runtime/select";
import { BUTTONS, COPY } from "../runtime/strings";
import type { RuntimeSurvey } from "../runtime/types";

export type ReportFormat = "JSON" | "CSV_CONTACTS" | "CSV_OBSERVATIONS";

/* The manifest IS the export schema. These lists are the field sets the backend
 * actually writes (packages/sagar/api/app.py, runtime_report), so a field in one
 * and not the other cannot happen. */
const JSON_FIELDS: readonly (readonly [string, string])[] = [
  ["Export provenance", "provenance"],
  ["Contacts", "contacts"],
  ["Raw detector observations", "findings"],
  ["Source frames and conditions", "frames"],
  ["Navigation status", "navigation_status"],
  ["Mission metadata", "mission"],
  ["Model registry availability", "model_registry"],
  ["Contact fusion policy", "contact_fusion_policy"],
  ["Sequential observation contract", "sequential_observation_contract"],
];

const CONTACT_FIELDS: readonly (readonly [string, string])[] = [
  ["Contact identifier", "contact_id"],
  ["Resolved class", "resolved_class"],
  ["Candidate classes", "candidate_classes"],
  ["Observations in this contact", "observation_count"],
  ["Distinct source frames", "distinct_frame_observation_count"],
  ["Persistence evidence type", "persistence_evidence_type"],
  ["Highest raw detector confidence", "max_raw_confidence"],
  ["Evidence score", "evidence_score"],
  ["Evidence score type", "evidence_score_type"],
  ["Unavailable evidence channels", "missing_evidence_components"],
  ["Evidence priority band", "priority_band"],
  ["Evidence priority score", "priority_score"],
  ["Recommended action", "recommended_action"],
  ["Open-set anomaly score", "anomaly_score"],
  ["Open-set threshold", "anomaly_threshold"],
  ["Open-set candidate", "is_open_set_candidate"],
  ["Measured sonar quality", "quality_score"],
  ["Sonar quality flags", "quality_flags"],
  ["Latitude", "latitude"],
  ["Longitude", "longitude"],
  ["Navigation status", "navigation_status"],
  ["Localization uncertainty", "localization_uncertainty_status"],
  ["Latest analyst verdict", "review_verdict"],
  ["Recorded review events", "review_count"],
  ["Source observation identifiers", "source_detection_ids"],
  ["Best observation identifier", "best_observation_id"],
  ["Detector checkpoint digest", "detector_model_sha"],
];

const OBSERVATION_FIELDS: readonly (readonly [string, string])[] = [
  ["Finding identifier", "detection_id"],
  ["Source frame", "source_frame_id"],
  ["Raw classification", "raw_class"],
  ["Raw confidence", "raw_confidence"],
  ["Displayed classification", "display_class"],
  ["Displayed confidence", "display_confidence"],
  ["Classification source", "classification_source"],
  ["Production qualified", "production_qualified"],
  ["Review status", "review_state"],
  ["Bounding box, source pixels", "bbox_px"],
  ["Latitude", "latitude"],
  ["Longitude", "longitude"],
  ["Heading, degrees", "heading_deg"],
  ["Navigation timestamp (UTC)", "timestamp_utc"],
  ["Navigation status", "navigation_status"],
];

const FORMATS: readonly (readonly [ReportFormat, string, string])[] = [
  ["JSON", "JSON", "Every record, nested evidence, and the export provenance block"],
  ["CSV_CONTACTS", "CSV — contacts", "One row per Contact, the operational object"],
  ["CSV_OBSERVATIONS", "CSV — raw observations", "One row per raw detector observation"],
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("|") : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function fieldsFor(format: ReportFormat) {
  if (format === "CSV_CONTACTS") return CONTACT_FIELDS;
  if (format === "CSV_OBSERVATIONS") return OBSERVATION_FIELDS;
  return JSON_FIELDS;
}

/** A real serialization of the selected format, from the same records and the
 * same field list the export endpoint uses. */
function preview(survey: RuntimeSurvey | null, format: ReportFormat): string {
  if (!survey) return "No survey is loaded, so there is nothing to serialize.";
  if (format === "CSV_OBSERVATIONS") {
    const header = OBSERVATION_FIELDS.map(([, key]) => key).join(",");
    const rows = survey.findings
      .slice(0, 3)
      .map((finding) =>
        OBSERVATION_FIELDS.map(([, key]) => csvCell((finding as unknown as Record<string, unknown>)[key])).join(","),
      );
    return [header, ...rows].join("\n");
  }
  if (format === "CSV_CONTACTS") {
    const header = CONTACT_FIELDS.map(([, key]) => key).join(",");
    const rows = (survey.contacts ?? []).slice(0, 3).map((contact) => {
      const flat: Record<string, unknown> = {
        ...(contact as unknown as Record<string, unknown>),
        evidence_score_type: contact.evidence_breakdown?.score_type,
        missing_evidence_components: contact.evidence_breakdown?.missing_components,
        review_verdict: contact.reviews?.latest_verdict,
        review_count: contact.reviews?.review_count,
        detector_model_sha: contact.provenance?.detector_model_sha,
      };
      return CONTACT_FIELDS.map(([, key]) => csvCell(flat[key])).join(",");
    });
    return [header, ...rows].join("\n");
  }
  const sliced = {
    ...survey,
    frames: survey.frames.slice(0, 1),
    findings: survey.findings.slice(0, 2),
    contacts: (survey.contacts ?? []).slice(0, 1),
  };
  return JSON.stringify(sliced, null, 2);
}

/** §5.11 Report generation. A first-class screen, never behind settings. */
export function ReportScreen({
  survey,
  contacts,
}: {
  survey: RuntimeSurvey | null;
  contacts: ContactView[];
}) {
  const [format, setFormat] = useState<ReportFormat>("JSON");
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provenanceOpen, setProvenanceOpen] = useState(false);

  const ready = Boolean(survey);
  const fields = fieldsFor(format);
  const first = survey?.findings[0];
  const headerMeta = survey
    ? `${survey.survey_id} · ${survey.contacts?.length ?? 0} contacts · ${survey.findings.length} finding ${survey.findings.length === 1 ? "record" : "records"}${first ? ` · ${first.model_id} · ${first.run_id}` : ""}`
    : "No survey loaded";

  const provenance: readonly (readonly [string, string])[] = survey
    ? [
        ["Detector", first?.model_id ?? "Unavailable"],
        ["Checkpoint digest", first?.model_sha256 ?? "Unavailable"],
        ["Dataset snapshot", first?.dataset_snapshot_id ?? "Unavailable"],
        ["Producing run", first?.run_id ?? "Unavailable"],
        ["Contact fusion policy", survey.contact_fusion_policy ?? "Unavailable"],
        ["Evidence score type", "UNVALIDATED_EVIDENCE_FUSION"],
        ["Open-set memory", survey.model_registry?.open_set?.memory_version ?? "Not configured"],
        ["Open-set threshold source", survey.model_registry?.open_set?.threshold_source ?? "Unavailable"],
        ["Navigation", survey.navigation_status ?? "UNAVAILABLE"],
        [
          "Observations with a position",
          `${countPositioned(survey.findings)} of ${survey.findings.length}`,
        ],
        [
          "Observations reviewed",
          `${countReviewed(survey.findings)} of ${survey.findings.length}`,
        ],
        [
          "Contacts with an unavailable evidence channel",
          String(contacts.filter((item) => item.missingEvidence.length > 0).length),
        ],
        [
          "Strongest evidence score",
          evidenceScoreLabel(
            contacts.reduce<number | null>(
              (best, item) => (item.evidenceScore !== null && (best === null || item.evidenceScore > best) ? item.evidenceScore : best),
              null,
            ),
          ),
        ],
      ]
    : [];

  async function download() {
    if (!survey) return;
    setPreparing(true);
    setError(null);
    try {
      const scope: ReportScope = format === "CSV_OBSERVATIONS" ? "observations" : "contacts";
      const target = reportUrl(survey.survey_id, format === "JSON" ? "json" : "csv", scope);
      const blob = await fetchReportBlob(target);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        format === "JSON"
          ? `aqualens-${survey.survey_id}-report.json`
          : `aqualens-${survey.survey_id}-${scope}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(failureSentence(cause));
    } finally {
      setPreparing(false);
    }
  }

  return (
    <section className="sd-page sd-report">
      <CompleteLine ready={ready}>{ready ? COPY.reportReady : COPY.reportNotReady}</CompleteLine>
      <h1>{survey ? survey.name : "No survey loaded"}</h1>
      <p className="sd-report-meta sd-mono">{headerMeta}</p>

      <div className="sd-report-grid">
        <div>
          {survey ? (
            <>
              {/* The limitation sentence is a required scientific disclosure and
               * stays visible regardless of the provenance disclosure state. */}
              <p className="sd-report-honesty">{COPY.reportLimits}</p>
              <button
                type="button"
                className="sd-disclosure"
                aria-expanded={provenanceOpen}
                aria-controls="sd-report-provenance"
                onClick={() => setProvenanceOpen((value) => !value)}
              >
                <span>{provenanceOpen ? BUTTONS.provenanceClose : BUTTONS.provenanceOpen}</span>
                <span aria-hidden="true">{provenanceOpen ? "▴" : "▾"}</span>
              </button>
              {provenanceOpen ? (
                <div id="sd-report-provenance">
                  <h2 className="sd-eyebrow sd-report-h2">What this export is attributed to</h2>
                  <div className="sd-provenance">
                    {provenance.map(([label, value]) => (
                      <div key={label}>
                        <small>{label}</small>
                        <b className="sd-mono">{value}</b>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          <h2 className="sd-eyebrow sd-report-h2" style={{ marginTop: 32 }}>
            Each record includes
          </h2>
          <div className="sd-manifest">
            {fields.map(([name, key]) => (
              <div key={key}>
                <b>{name}</b>
                <span className="sd-mono">{key}</span>
              </div>
            ))}
          </div>

          <h2 className="sd-eyebrow sd-report-h2" style={{ marginTop: 32 }}>
            Preview
          </h2>
          <pre className="sd-report-preview sd-mono">{preview(survey, format)}</pre>
          <p className="sd-report-honesty">{COPY.reportHonesty}</p>
          {survey && survey.findings.length > 2 ? (
            <p className="sd-report-honesty">
              {`Preview shows the first records only. The export contains every record: ${survey.contacts?.length ?? 0} contacts and ${survey.findings.length} raw observations.`}
            </p>
          ) : null}
        </div>

        <aside>
          <div className="sd-format-panel">
            <small className="sd-eyebrow sd-eyebrow-md">Format</small>
            <div className="sd-format-list">
              {FORMATS.map(([id, name, note]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={format === id}
                  onClick={() => setFormat(id)}
                >
                  <b>{name}</b>
                  <span>{note}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="sd-btn-primary"
              disabled={!ready || preparing}
              onClick={download}
            >
              {preparing ? "Preparing…" : `Download ${format === "JSON" ? "JSON" : "CSV"}`}
            </button>
            <p className="sd-format-caption">{COPY.formatsAvailable}</p>
            <button type="button" className="sd-btn-secondary" disabled>
              {BUTTONS.share}
            </button>
            <p className="sd-format-caption">{COPY.shareDisabled}</p>
            {error ? (
              <div className="sd-report-error" role="alert">
                <p className="sd-error">{error}</p>
                <p className="sd-format-caption">
                  Nothing was exported. The preview above is the same serialization the export would have
                  produced.
                </p>
              </div>
            ) : null}
          </div>
          {!ready ? (
            <div style={{ marginTop: 16 }}>
              <Unavailable title="No survey loaded">
                Upload a survey before generating a report. Nothing is exported from an empty record set.
              </Unavailable>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
