import { useCallback, useEffect, useState } from "react";
import { useStore, contactName } from "../state/store";
import { api, ApiFailure } from "../api/client";
import type { Contact, EvidenceKey, MissionReport } from "../api/types";
import { analystLabel, AVAILABILITY_LABEL, CLASS_LABEL, displayName, EVIDENCE_LABEL, MEMBERSHIP, navLabel, PRIORITY_LABEL, shortTime, STATUS_LABEL } from "../api/labels";
import { DemoTag, Empty, Icon, Skeleton } from "../components/ui";

const SECTIONS = [
  ["overview", "Mission overview"],
  ["surveys", "Survey provenance"],
  ["contacts", "Contacts"],
  ["evidence", "Evidence availability"],
  ["verdicts", "Analyst verdicts"],
  ["map", "Map"],
  ["model", "Model provenance"],
  ["limits", "Limitations"],
] as const;

const EV: EvidenceKey[] = ["detector", "local_anomaly", "persistence", "raised_relief", "navigation"];

const machineCell = (c: Contact) =>
  c.machine ? `${CLASS_LABEL[c.machine.supervised_class]} · ${c.machine.raw_detector_score.toFixed(2)}${c.machine.demo ? " fixture" : " raw"}` : `Local anomaly · ${AVAILABILITY_LABEL[c.evidence.local_anomaly.status].toLowerCase()}`;

const evState = (c: Contact, k: EvidenceKey) => (c.evidence[k].provenance === "SYNTHETIC_DEMO" ? "Synthetic demo" : AVAILABILITY_LABEL[c.evidence[k].status]);

export function Report() {
  const { state, notify } = useStore();
  const missionId = state.mission?.mission_id ?? null;
  const [report, setReport] = useState<MissionReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Each generation is an immutable snapshot held by the service; the preview shows exactly that record.
  const generate = useCallback(async () => {
    if (!missionId) return;
    setBusy(true);
    try {
      setReport(await api.createReport(missionId));
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof ApiFailure ? e.message : "The report could not be generated.");
    } finally {
      setBusy(false);
    }
  }, [missionId]);

  useEffect(() => {
    void generate();
  }, [generate]);

  if (!state.mission) return <Empty title="No mission open">Reports are generated from an open mission.</Empty>;
  if (problem && !report)
    return (
      <Empty title="Report not available yet" action={<button className="btn" onClick={() => void generate()}>Try again</button>}>
        {problem}
      </Empty>
    );
  if (!report)
    return (
      <div className="report">
        <div className="report__canvas">
          <article className="paper">
            <Skeleton lines={1} wide />
            <Skeleton lines={6} />
          </article>
        </div>
      </div>
    );

  const contacts = report.contacts;
  const reviewed = contacts.filter((c) => c.analyst.status !== "UNREVIEWED");
  const counts = { CONFIRMED: 0, REJECTED: 0, UNRESOLVED: 0 } as Record<string, number>;
  reviewed.forEach((c) => (counts[c.analyst.status] = (counts[c.analyst.status] ?? 0) + 1));
  const classified = contacts.filter((c) => c.analyst.classification !== "UNRESOLVED").length;
  const p = report.provenance;
  let n = 0;
  const num = () => ++n;

  return (
    <div className="report">
      <nav className="report__outline" aria-label="Report sections">
        <p className="report__h">Sections</p>
        <ul className="report__toc">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#r-${id}`} onClick={(e) => (e.preventDefault(), document.getElementById(`r-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }))}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="report__canvas">
        <article className="paper" aria-label="Report preview">
          <header className="paper__head">
            <p className="paper__kicker">
              Aqualens · {report.demo ? "Demo report" : "Mission report"} {report.demo && <DemoTag>Demo</DemoTag>}
            </p>
            <h1>{displayName(report.mission.name, "Mission")}</h1>
            <p className="paper__sub">
              {report.demo
                ? "Deterministic demonstration. Detector scores and positions in this report are fixture values, not survey evidence."
                : "Generated from the local Aqualens service. Analyst verdicts are human judgements recorded with their history."}
            </p>
            <p className="paper__context">
              Snapshot {report.report_id.slice(-8)} · generated {shortTime(report.generated_at)}. Prepared in the context of Smart India Hackathon 2026, Problem Statement 26057.
            </p>
          </header>

          <section id="r-overview">
            <h2>
              <span>{num()}</span> Mission overview
            </h2>
            <table className="ptable ptable--kv">
              <tbody>
                <tr>
                  <th>Surveys</th>
                  <td>{report.surveys.length}</td>
                  <th>Uploads</th>
                  <td>{report.uploads.length}</td>
                </tr>
                <tr>
                  <th>Contacts</th>
                  <td>{contacts.length}</td>
                  <th>Reviewed</th>
                  <td>{reviewed.length}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section id="r-surveys">
            <h2>
              <span>{num()}</span> Survey provenance
            </h2>
            <table className="ptable">
              <thead>
                <tr>
                  <th>Survey</th>
                  <th>Membership</th>
                  <th>Navigation</th>
                  <th>Sensor</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.surveys.map((s) => (
                  <tr key={s.survey_id}>
                    <td>{displayName(s.name, s.survey_ref)}</td>
                    <td>{MEMBERSHIP[s.membership_provenance]?.label ?? s.membership_provenance}</td>
                    <td>{navLabel(s.navigation_provenance)}</td>
                    <td>{s.sensor ?? "Not supplied"}</td>
                    <td>{s.status.charAt(0) + s.status.slice(1).toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section id="r-contacts">
            <h2>
              <span>{num()}</span> Contacts
            </h2>
            {contacts.length === 0 ? (
              <p className="paper__muted">No Contacts in this mission.</p>
            ) : (
              <table className="ptable">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Machine</th>
                    <th>Analyst classification</th>
                    <th>Verdict</th>
                    <th>Priority</th>
                    <th>History</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.contact_id}>
                      <td className="strong">{contactName(c)}</td>
                      <td>{machineCell(c)}</td>
                      <td>{c.analyst.classification !== "UNRESOLVED" ? <em>{analystLabel(c.analyst.classification)}</em> : "Not classified"}</td>
                      <td>{STATUS_LABEL[c.analyst.status]}</td>
                      <td>{PRIORITY_LABEL[c.analyst.priority]}</td>
                      <td>{c.history.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="paper__muted">Machine and analyst columns are separate records. An analyst classification never changes the machine output.</p>
          </section>

          <section id="r-evidence">
            <h2>
              <span>{num()}</span> Evidence availability
            </h2>
            <table className="ptable ptable--dense">
              <thead>
                <tr>
                  <th>Contact</th>
                  {EV.map((k) => (
                    <th key={k}>{EVIDENCE_LABEL[k]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.contact_id}>
                    <td className="strong">{contactName(c)}</td>
                    {EV.map((k) => (
                      <td key={k}>{evState(c, k)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section id="r-verdicts">
            <h2>
              <span>{num()}</span> Analyst verdicts
            </h2>
            <p>
              {counts.CONFIRMED ?? 0} confirmed, {counts.REJECTED ?? 0} rejected, {counts.UNRESOLVED ?? 0} unresolved, {contacts.length - reviewed.length} awaiting review. {classified} classified by an analyst. History is append-only; every revision is kept.
            </p>
          </section>

          <section id="r-map">
            <h2>
              <span>{num()}</span> Map
            </h2>
            <p className="paper__muted">
              {report.map.availability !== "AVAILABLE" && report.map.platform_context.some((f) => f.properties.provenance === "SYNTHETIC_DEMO")
                ? `Survey track drawn from ${report.map.platform_context.length} points supplied with the upload. Contacts have no positions of their own. Navigation provenance: SYNTHETIC_DEMO, used for the map only and not as evidence.`
                : report.map.availability === "AVAILABLE"
                ? report.map.features.some((f) => f.properties.provenance === "SYNTHETIC_DEMO")
                  ? `${report.map.features.length} illustrative positions from synthetic demo navigation. Not survey evidence.`
                  : `${report.map.features.length} Contact positions.`
                : `No Contact positions. ${report.map.reason ?? ""}`}
              {report.map.platform_context.length > 0 &&
                !report.map.platform_context.some((f) => f.properties.provenance === "SYNTHETIC_DEMO") &&
                ` ${report.map.platform_context.length} declared platform fixes locate the vessel, not Contacts.`}
            </p>
          </section>

          <section id="r-model">
            <h2>
              <span>{num()}</span> Model provenance
            </h2>
            <table className="ptable ptable--kv">
              <tbody>
                <tr>
                  <th>Model</th>
                  <td className="mono" colSpan={3}>
                    {p.model_id}
                  </td>
                </tr>
                <tr>
                  <th>SHA-256</th>
                  <td className="mono" colSpan={3}>
                    {p.model_sha}
                  </td>
                </tr>
                <tr>
                  <th>Shipwreck recovery</th>
                  <td>{p.shipwreck_recovery ? "Enabled" : "Disabled"}</td>
                  <th>Deployment</th>
                  <td>{p.deployment === "LOCAL_WORKSTATION" ? "Local workstation" : p.deployment}</td>
                </tr>
                <tr>
                  <th>Association</th>
                  <td className="mono" colSpan={3}>
                    {p.association_policy}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section id="r-limits">
            <h2>
              <span>{num()}</span> Limitations
            </h2>
            <ul>
              {report.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
          <footer className="paper__foot">
            Aqualens · {report.demo ? "Demo" : "Mission"} report {report.report_id.slice(-8)}
          </footer>
        </article>
      </div>

      <aside className="report__export" aria-label="Export">
        <p className="report__h">Export</p>
        <p className="muted small">
          Snapshot of {contacts.length} Contact{contacts.length === 1 ? "" : "s"}, {shortTime(report.generated_at)}
        </p>
        <a className="btn btn--primary" href={api.reportUrl(report.report_id, "json", true)} onClick={() => notify(report.demo ? "Demo report exported as JSON" : "Report exported as JSON")}>
          <Icon name="download" size={14} /> Export JSON
        </a>
        <a className="btn" href={api.reportUrl(report.report_id, "html", true)}>
          Export HTML
        </a>
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
        <button className="btn btn--plain" onClick={() => void generate()} disabled={busy}>
          <Icon name="refresh" size={14} /> {busy ? "Generating" : "New snapshot"}
        </button>
        <p className="report__note">
          {report.demo ? (
            <>
              <DemoTag /> Exports carry the demo flag and cannot be mistaken for survey records.
            </>
          ) : (
            "Each snapshot is kept by the service and does not change when reviews continue."
          )}
        </p>
      </aside>
    </div>
  );
}
