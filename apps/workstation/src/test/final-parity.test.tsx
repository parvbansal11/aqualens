/* Structural parity for the frozen screens.
 *
 * Every screen is rendered against a record set captured verbatim from a real
 * local run (upload -> YOLO11s inference -> sonar condition -> open-set
 * evidence -> Contact fusion -> persisted runtime survey) and the frozen
 * final-v1 model card, so the assertions below exercise the production
 * bindings rather than hand-written sample values. Two fixtures are used: one
 * raster-only run with no navigation, and one bundle run whose navigation.csv
 * supplied real coordinates, so both the available and the unavailable paths
 * are covered. The checks mirror ENGINEERING_CONTRACT.md §12, "Per-screen
 * pre-merge visual parity checklist". */
import { render, cleanup, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import live from "./fixtures/runtime-survey.json";
import navigated from "./fixtures/runtime-survey-navigated.json";
import liveJob from "./fixtures/runtime-job.json";
import card from "./fixtures/model-card.json";
import type { ConnectionState, RuntimeJob, RuntimeSurvey } from "@/components/final/runtime/types";
import { ResultsScreen } from "@/components/final/screens/ResultsScreen";
import { MapScreen } from "@/components/final/screens/MapScreen";
import { WorkspaceScreen } from "@/components/final/screens/WorkspaceScreen";
import { ReviewScreen } from "@/components/final/screens/ReviewScreen";
import { MissionScreen } from "@/components/final/screens/MissionScreen";
import { DecisionScreen } from "@/components/final/screens/DecisionScreen";
import { ReportScreen } from "@/components/final/screens/ReportScreen";
import { ModelLabScreen } from "@/components/final/screens/ModelLabScreen";
import { UploadScreen } from "@/components/final/screens/UploadScreen";
import { ProcessingScreen } from "@/components/final/screens/ProcessingScreen";
import { LandingScreen } from "@/components/final/screens/LandingScreen";
import { RoleEntryScreen } from "@/components/final/screens/RoleEntryScreen";
import { ChangeScreen } from "@/components/final/screens/ChangeScreen";
import { MemoryScreen } from "@/components/final/screens/MemoryScreen";
import { contactViews, sortedFindings, reviewQueue } from "@/components/final/runtime/select";

const survey = live as unknown as RuntimeSurvey;
const navSurvey = navigated as unknown as RuntimeSurvey;
const job = liveJob as unknown as RuntimeJob;
const findings = sortedFindings(survey.findings);
const contacts = contactViews(survey.contacts, survey.findings);
const navContacts = contactViews(navSurvey.contacts, navSurvey.findings);
const queue = reviewQueue(survey.findings);
const noop = () => {};

const online: ConnectionState = {
  status: "ONLINE",
  health: {
    status: "ok",
    runtime_available: true,
    device: "mps",
    model_loaded: true,
    model_sha256: "2aa3ac71051856bcfc8ec400804995f03568aa26d1a1fb24583e4eb1b7a10b15",
    class_names: { "0": "PIPELINE", "1": "SHIPWRECK", "2": "CRAB_POT" },
    optional_models: {
      yolo11s: { availability: "AVAILABLE", available: true, role: "KNOWN_CLASS_CANDIDATE_GENERATOR" },
      rfdetr: { availability: "NOT_CONFIGURED", available: false, role: "OPTIONAL_CANDIDATE_GENERATOR" },
      natural_clutter: {
        availability: "NOT_CONFIGURED",
        available: false,
        role: "EXPERIMENTAL_ADVISORY_EVIDENCE_ONLY",
        status: "REJECTED_FOR_AUTOMATIC_SUPPRESSION",
        mode: "ADVISORY_ONLY",
        automatic_veto_permitted: false,
      },
      mask_refiner: { availability: "NOT_CONFIGURED", available: false, role: "OPTIONAL_REFINER" },
      open_set: {
        availability: "AVAILABLE",
        available: true,
        role: "ADVISORY_OPEN_SET_EVIDENCE",
        method: "PATCHCORE_STYLE_OPEN_SET",
        memory_version: "open_set_v1",
        feature_source: "frozen YOLO11s layer-16 embeddings",
        threshold: 0.4616784453392029,
        threshold_source: "q99.5_annotation_safe_background_val",
      },
    },
    api_version: "0.1.0",
    runtime_surveys_retained: 2,
    frozen_evidence_run_id: "run_stage3c_v4",
  },
  message: null,
  checkedAt: "2026-09-05T10:00:00Z",
};

function report(name: string, _container: HTMLElement, checks: [string, boolean][]) {
  const fails = checks.filter(([, ok]) => !ok).map(([label]) => `${name}: ${label}`);
  expect(fails).toEqual([]);
}

const q = (c: HTMLElement, s: string) => c.querySelectorAll(s).length;
const txt = (c: HTMLElement) => c.textContent ?? "";

describe("canonical screen parity", () => {
  it("01 landing", () => {
    const { container } = render(<LandingScreen onEntry={noop} />);
    report("01 Landing", container, [
      ["public header", q(container, ".sd-public-header") === 1],
      ["hero grid", q(container, ".sd-hero") === 1],
      ["pipeline figure rows", q(container, ".sd-pipeline-row") === 6],
      ["three evidence claims", q(container, "#evidence .sd-claims-grid > div") === 3],
      ["three dataset claims", q(container, "#datasets .sd-claims-grid > div") === 3],
      ["one primary CTA in hero", q(container, ".sd-hero-actions .sd-btn-primary") === 1],
      ["no PDF is promised anywhere", !/PDF/.test(txt(container))],
    ]);
    cleanup();
  });

  it("02 role entry", () => {
    const { container } = render(
      <RoleEntryScreen picked="analyst" onPick={noop} onContinue={noop} onUpload={noop} onLanding={noop} />,
    );
    const primary = container.querySelector(".sd-entry-actions .sd-btn-primary") as HTMLButtonElement;
    report("02 Role entry", container, [
      ["no app chrome", q(container, ".sd-sidebar") === 0],
      ["four role cards", q(container, ".sd-role-card") === 4],
      ["selection is pressed state", container.querySelectorAll('[aria-pressed="true"]').length === 1],
      ["primary names the picked role", (primary.textContent ?? "").includes("Sonar Analyst")],
    ]);
    cleanup();
  });

  it("03 upload", () => {
    const { container } = render(
      <UploadScreen
        file={null}
        onChoose={noop}
        onProcess={noop}
        error={null}
        advanced
        onToggleAdvanced={noop}
        connection={online}
      />,
    );
    report("03 Upload", container, [
      ["one dropzone", q(container, ".sd-dropzone") === 1],
      ["service readiness is the first requirement", txt(container).includes("Analysis service")],
      ["requirements list", q(container, ".sd-requirement") === 4],
      ["navigation absence stated honestly", txt(container).includes("carry no latitude or longitude")],
      ["advanced panel states real inference properties", txt(container).includes("768 px tiles")],
      ["open-set availability is bound, not asserted", txt(container).includes("AVAILABLE")],
      ["process disabled without a file", (container.querySelector(".sd-upload-actions .sd-btn-primary") as HTMLButtonElement).disabled],
    ]);
    cleanup();
  });

  it("03b upload states an unreachable service instead of failing silently", () => {
    const offline: ConnectionState = {
      status: "OFFLINE",
      health: null,
      message: "The analysis service is not reachable from this browser.",
      checkedAt: "2026-09-05T10:00:00Z",
    };
    const file = new File(["sonar"], "pass.png", { type: "image/png" });
    const { container } = render(
      <UploadScreen
        file={file}
        onChoose={noop}
        onProcess={noop}
        error={null}
        advanced={false}
        onToggleAdvanced={noop}
        connection={offline}
      />,
    );
    report("03b Upload (service down)", container, [
      ["unavailable block, not a red error", q(container, ".sd-unavailable") === 1],
      ["names the failure", txt(container).includes("not reachable")],
      ["process blocked while the service is down", (container.querySelector(".sd-upload-actions .sd-btn-primary") as HTMLButtonElement).disabled],
    ]);
    cleanup();
  });

  it("04 processing binds every state to the job the backend published", () => {
    const { container } = render(
      <ProcessingScreen
        job={job}
        inFlight={false}
        error={null}
        errorKind={null}
        survey={survey}
        filmstripSrc={null}
        subtitle="harbour_pass_raw.zip · 0.1 MB"
        onRetry={noop}
        onBackToUpload={noop}
      />,
    );
    /* The technical fact grid is closed by default; open it to inspect the
     * disclosed detail (§ProcessingScreen simplification). */
    fireEvent.click(container.querySelector(".sd-disclosure") as HTMLButtonElement);
    const text = txt(container);
    report("04 Processing", container, [
      ["one phase row per published phase", q(container, ".sd-stage") === job.steps!.length],
      ["counted frame ratio, not a percentage", text.includes("2 / 2")],
      ["progressbar is bound to counted frames", q(container, '[role="progressbar"]') === 1],
      ["fact grid is present", q(container, ".sd-fact") === 8],
      ["upload decode is a stated fact", text.includes("Bundle extracted")],
      ["detector device disclosed", text.includes("mps")],
      ["open-set availability disclosed", text.includes("open_set_v1")],
      ["contact fusion count disclosed", text.includes("Contacts fused")],
      ["no estimated completion figure", !/\d+%/.test(text)],
      ["no sweep animation on a finished run", q(container, ".sd-filmstrip-sweep") === 0],
    ]);
    cleanup();
  });

  it("04b processing separates a rejected upload from a failed run", () => {
    const { container } = render(
      <ProcessingScreen
        job={null}
        inFlight={false}
        error="broken.png could not be read as an image."
        errorKind="UPLOAD_REJECTED"
        survey={null}
        filmstripSrc={null}
        subtitle="broken.png"
        onRetry={noop}
        onBackToUpload={noop}
      />,
    );
    report("04b Processing (upload rejected)", container, [
      ["names it a rejected upload", txt(container).includes("This upload was not accepted")],
      ["states nothing was inferred", txt(container).includes("No inference was run")],
      ["no phases claimed", txt(container).includes("No run was started")],
      ["retry says what retrying does", txt(container).includes("starts a new run")],
    ]);
    cleanup();
  });

  it("05 results is contact-first with the raw observations one control away", () => {
    const { container } = render(
      <ResultsScreen
        contacts={contacts}
        findings={findings}
        survey={survey}
        loading={false}
        error={null}
        recent={[]}
        onOpenRecent={noop}
        onOpen={noop}
        onNavigate={noop}
        onRetry={noop}
        onUpload={noop}
        title="What did we find?"
      />,
    );
    report("05 Results", container, [
      ["green complete line", q(container, '.sd-complete[data-ready="true"]') === 1],
      ["four derived metrics", q(container, ".sd-metric-row > div") === 4],
      ["contacts are the default list", txt(container).includes("Contacts")],
      ["one row per real contact", q(container, "[data-contact-id]") === contacts.length],
      ["scope control offers raw observations", q(container, '.sd-list-head [role="tab"]') === 2],
      ["evidence score is labelled as such, never a probability", txt(container).includes("Evidence score")],
      ["the unvalidated basis is stated", txt(container).includes("UNVALIDATED_EVIDENCE_FUSION")],
      ["primary + secondary action row", q(container, ".sd-action-row button") === 2],
    ]);
    cleanup();
  });

  it("05b results offers recovery instead of a dead end when the survey fails to load", () => {
    const { container } = render(
      <ResultsScreen
        contacts={[]}
        findings={[]}
        survey={null}
        loading={false}
        error={{ message: "The analysis service is not reachable from this browser.", retryable: true }}
        recent={[
          {
            survey_id: "survey_upload_abc",
            name: "harbour_pass_raw.zip",
            created_at: "2026-09-05T09:00:00Z",
            frame_count: 2,
            finding_count: 6,
            contact_count: 4,
            reviewed_count: 1,
            navigation_status: "UNAVAILABLE",
          },
        ]}
        onOpenRecent={noop}
        onOpen={noop}
        onNavigate={noop}
        onRetry={noop}
        onUpload={noop}
        title="What did we find?"
      />,
    );
    report("05b Results (load failed)", container, [
      ["failure is an unavailable block, not a bare error string", q(container, ".sd-unavailable") === 1],
      ["retry offered because the failure is retryable", txt(container).includes("Retry")],
      ["a held survey can be reopened", q(container, ".sd-recovery-list button") === 1],
      ["metrics are em dashes, never zeros", Array.from(container.querySelectorAll(".sd-metric-row b")).every((n) => n.textContent === "—")],
    ]);
    cleanup();
  });

  it("06 map", () => {
    const { container } = render(
      <MapScreen
        contacts={contacts}
        findings={findings}
        selected={findings[0]}
        onSelect={noop}
        onOpenWorkspace={noop}
        mode="chart"
        onMode={noop}
        geometry={null}
        survey={survey}
        trackPoints={0}
      />,
    );
    report("06 Map (no navigation)", container, [
      ["segmented control with two tabs", q(container, '.sd-map-head .sd-seg button[role="tab"]') === 2],
      ["map frame with svg", q(container, ".sd-map-frame svg") === 1],
      ["six legend items", q(container, ".sd-map-legend span") === 6],
      ["no fabricated markers", q(container, ".sd-marker") === 0],
      ["no fabricated track", q(container, ".sd-map-track") === 0],
      ["no-position note shown", txt(container).includes("No finding in this survey carries a position.")],
      ["grey location-unavailable block", txt(container).includes("Location unavailable")],
      ["recommended next action block", txt(container).includes("Recommended next action")],
      ["coverage geometry declared unavailable", txt(container).includes("Coverage geometry unavailable")],
      ["unpositioned contacts still listed", q(container, ".sd-map-list-rows button") === contacts.length],
      ["absence from the plot claims nothing", txt(container).includes("says nothing about where it is")],
    ]);
    cleanup();
    const cov = render(
      <MapScreen
        contacts={contacts}
        findings={findings}
        selected={findings[0]}
        onSelect={noop}
        onOpenWorkspace={noop}
        mode="coverage"
        onMode={noop}
        geometry={null}
        survey={survey}
        trackPoints={0}
      />,
    );
    report("06 Map (coverage mode)", cov.container, [
      ["subtitle changes in coverage mode", txt(cov.container).includes("No coverage polygon accompanies this survey")],
      ["absence is not safety", txt(cov.container).includes("not an area confirmed clear")],
      ["coverage tab selected", (cov.container.querySelectorAll('[role="tab"]')[1] as HTMLElement).getAttribute("aria-selected") === "true"],
    ]);
    cleanup();
  });

  it("06b map draws a track only from real recorded navigation fixes", () => {
    const positioned = sortedFindings(navSurvey.findings);
    const geometry = {
      coastline: null,
      swath: null,
      gap: null,
      gapArea: null,
      cornerLabel: null,
      scaleLabel: null,
      markers: Object.fromEntries(positioned.map((f, i) => [f.detection_id, [20 + i, 30 + i] as [number, number]])),
      track: [
        { frameId: "frame_0000", point: [20, 30] as [number, number] },
        { frameId: "frame_0001", point: [40, 50] as [number, number] },
      ],
    };
    const { container } = render(
      <MapScreen
        contacts={navContacts}
        findings={positioned}
        selected={positioned[0]}
        onSelect={noop}
        onOpenWorkspace={noop}
        mode="chart"
        onMode={noop}
        geometry={geometry}
        survey={navSurvey}
        trackPoints={2}
      />,
    );
    report("06b Map (navigation supplied)", container, [
      ["markers placed for real coordinates", q(container, ".sd-marker") === positioned.length],
      ["track drawn from recorded fixes", q(container, ".sd-map-track") === 1],
      ["one dot per recorded fix", q(container, ".sd-map-frame circle") === 2],
      ["states how many frames carry a fix", txt(container).includes("2 of 2 source frames carry a navigation fix")],
      ["a relative plot is not called a chart", txt(container).includes("not a projected nautical chart")],
      ["markers carry their contact identity", q(container, ".sd-marker[data-contact-id]") > 0],
    ]);
    cleanup();
  });

  it("07 workspace", () => {
    const { container } = render(
      <WorkspaceScreen
        survey={survey}
        contacts={contacts}
        findings={findings}
        selected={findings[0]}
        onSelect={noop}
        layer="detections"
        onLayer={noop}
        tech={false}
        onToggleTech={noop}
        rasterFor={() => "/raster.jpg"}
        onSendToReview={noop}
        onMap={noop}
      />,
    );
    report("07 Workspace", container, [
      ["contact rail present", q(container, ".sd-ws-rail") === 1],
      ["one rail row per contact", q(container, ".sd-ws-contact") === contacts.length],
      ["rail names contacts, not findings", txt(container).includes("Contacts in this survey")],
      ["four layer tabs", q(container, '.sd-ws-bar .sd-seg button[role="tab"]') === 4],
      ["layer note single line", q(container, ".sd-ws-layer-note") === 1],
      ["viewer is the dark surface", q(container, ".sd-ws-viewer") === 1],
      ["plaque and range scale in one row", q(container, ".sd-ws-overlay .sd-plaque") === 1 && q(container, ".sd-ws-overlay .sd-range-scale") === 1],
      ["strip cell per real frame", q(container, ".sd-ws-cells button") === survey.frames.length],
      ["inspector present", q(container, ".sd-inspector") === 1],
      ["contact and review state both badged", q(container, ".sd-inspector-badges .sd-badge") >= 2],
      ["evidence strength is the sole default figure", q(container, ".sd-inspector-figures > div") === 1],
      ["evidence strength is explicitly not probability", txt(container).includes("EVIDENCE STRENGTH")],
      ["dl has position/heading/timestamp/extent/review", q(container, ".sd-inspector .sd-dl dt") === 5],
      ["technical disclosure CLOSED on load", q(container, ".sd-tech") === 0],
      ["disclosure control present", q(container, ".sd-disclosure") === 1],
      ["raw observations under the contact are listed", q(container, ".sd-observations button") > 0],
      ["primary + secondary actions", q(container, ".sd-inspector-actions button") === 2],
      ["boxes drawn on detections layer", q(container, ".sd-box") > 0],
    ]);
    cleanup();
    const open = render(
      <WorkspaceScreen
        survey={survey}
        contacts={contacts}
        findings={findings}
        selected={findings[0]}
        onSelect={noop}
        layer="raw"
        onLayer={noop}
        tech
        onToggleTech={noop}
        rasterFor={() => "/raster.jpg"}
        onSendToReview={noop}
        onMap={noop}
      />,
    );
    const text = txt(open.container);
    report("07 Workspace (raw + evidence ladder open)", open.container, [
      ["no boxes on raw layer", q(open.container, ".sd-box") === 0],
      ["ten evidence rows", q(open.container, ".sd-ev-row") === 10],
      ["every ladder row is closed by default", q(open.container, ".sd-ev-row[open]") === 0],
      ["what the detector saw", text.includes("What the detector saw")],
      ["persistence", text.includes("Persistence")],
      ["navigation", text.includes("Navigation")],
      ["sonar condition", text.includes("Sonar condition")],
      ["acoustic verification", text.includes("Acoustic verification")],
      ["open-set", text.includes("Open-set anomaly")],
      ["fusion", text.includes("Evidence fusion")],
      ["analyst review", text.includes("Analyst review")],
      ["recovery priority", text.includes("Recovery priority")],
      ["natural clutter stays advisory", text.includes("Natural clutter (experimental)")],
      ["provenance disclosed", text.includes(findings[0].run_id)],
    ]);
    cleanup();
    const change = render(
      <WorkspaceScreen
        survey={survey}
        contacts={contacts}
        findings={findings}
        selected={findings[0]}
        onSelect={noop}
        layer="change"
        onLayer={noop}
        tech={false}
        onToggleTech={noop}
        rasterFor={() => "/raster.jpg"}
        onSendToReview={noop}
        onMap={noop}
      />,
    );
    report("07 Workspace (change, no baseline)", change.container, [
      ["no boxes without a previous pass", q(change.container, ".sd-box") === 0],
      ["states no previous pass", txt(change.container).includes("No previous pass covers this window.")],
    ]);
    cleanup();
    const missing = render(
      <WorkspaceScreen
        survey={survey}
        contacts={contacts}
        findings={findings}
        selected={findings[0]}
        onSelect={noop}
        layer="detections"
        onLayer={noop}
        tech={false}
        onToggleTech={noop}
        rasterFor={() => null}
        onSendToReview={noop}
        onMap={noop}
      />,
    );
    report("07 Workspace (raster missing)", missing.container, [
      ["matte states the window is unavailable", txt(missing.container).includes("Sonar window unavailable for this finding")],
      ["boxes suppressed", q(missing.container, ".sd-box") === 0],
      ["layers stay switchable", q(missing.container, '.sd-ws-bar .sd-seg button[role="tab"]') === 4],
    ]);
    cleanup();
  });

  it("08 review", () => {
    const { container } = render(
      <ReviewScreen
        survey={survey}
        queue={queue}
        index={0}
        onIndex={noop}
        onVerdict={noop}
        pending={null}
        failed={null}
        rasterFor={() => "/raster.jpg"}
        onBackToFindings={noop}
        onGenerateReport={noop}
        onOpenMemory={noop}
        title="Is this finding real?"
      />,
    );
    report("08 Review", container, [
      ["progress line names the keys", txt(container).includes("press C, R, L or U to decide")],
      ["progress exposes a value to assistive tech", q(container, '.sd-review-progress[role="progressbar"]') === 1],
      ["one subject card", q(container, ".sd-subject") === 1],
      ["no label tab on the subject box", q(container, ".sd-subject-image .sd-box b") === 0],
      ["class + badge", q(container, ".sd-subject-head .sd-badge") === 1],
      ["2x2 verdict grid", q(container, ".sd-verdicts button") === 4],
      ["kbd hints", q(container, ".sd-verdicts kbd") === 4],
      ["queue row per pending finding", q(container, ".sd-queue-row") === queue.length],
      ["memory destination reachable from the queue", txt(container).includes("See where these decisions go")],
      ["training memory framed without retraining", txt(container).includes("Nothing is retrained by recording one")],
    ]);
    cleanup();
  });

  it("08b review states an unsaved verdict without resubmitting it", () => {
    const { container } = render(
      <ReviewScreen
        survey={survey}
        queue={queue}
        index={0}
        onIndex={noop}
        onVerdict={noop}
        pending={null}
        failed={{ id: queue[0].detection_id, message: "The analysis service did not answer in time.", retryable: true }}
        rasterFor={() => "/raster.jpg"}
        onBackToFindings={noop}
        onGenerateReport={noop}
        onOpenMemory={noop}
        title="Is this finding real?"
      />,
    );
    report("08b Review (write failed)", container, [
      ["alert region", q(container, '.sd-verdict-failure[role="alert"]') === 1],
      ["states the decision was not recorded", txt(container).includes("was not recorded")],
      ["states it is never resubmitted automatically", txt(container).includes("never resubmitted automatically")],
      ["queue row shows it as not saved", txt(container).includes("Not saved")],
    ]);
    cleanup();
  });

  it("09 mission", () => {
    const { container } = render(
      <MissionScreen survey={survey} findings={findings} processing={false} onOpen={noop} onNavigate={noop} closeLine="x" />,
    );
    const metrics = Array.from(container.querySelectorAll(".sd-mission-metrics b")).map((n) => n.textContent);
    report("09 Mission", container, [
      ["four metrics", q(container, ".sd-mission-metrics > div") === 4],
      ["uncomputable metrics render em dash", metrics[0] === "—" && metrics[3] === "—"],
      ["backlog is the only bordered panel", q(container, ".sd-backlog") === 1],
      ["coverage comparison suppressed, not zeroed", txt(container).includes("No previous pass to compare")],
      ["team renders the unavailable state", txt(container).includes("Team assignment not connected")],
      ["report primary at the foot of the aside", q(container, ".sd-mission-aside > .sd-btn-primary") === 1],
    ]);
    cleanup();
  });

  it("10 decision", () => {
    const { container } = render(
      <DecisionScreen survey={survey} processing={false} onNavigate={noop} why onToggleWhy={noop} />,
    );
    const panel = container.querySelector(".sd-recommend") as HTMLElement;
    report("10 Decision", container, [
      ["eyebrow present", q(container, ".sd-decision-eyebrow") === 1],
      ["five derived metric rows", q(container, ".sd-decision-row") === 5],
      ["one tinted recommended-action panel", q(container, ".sd-recommend") === 1],
      ["why discloses three paragraphs", q(container, ".sd-recommend-why p") === 3],
      ["no method name or score in the panel", !/IoU|mAP|YOLO|precision|recall|%/.test(txt(panel))],
      ["exactly two actions", q(container, ".sd-decision-actions button") === 2],
    ]);
    cleanup();
  });

  it("11 report", () => {
    const { container } = render(<ReportScreen survey={survey} contacts={contacts} />);
    /* The provenance/attribution block is closed by default; open it to
     * inspect the disclosed detail (§ReportScreen simplification). */
    fireEvent.click(container.querySelector(".sd-disclosure") as HTMLButtonElement);
    const pre = container.querySelector(".sd-report-preview") as HTMLElement;
    const text = txt(container);
    report("11 Report", container, [
      ["green ready line", q(container, '.sd-complete[data-ready="true"]') === 1],
      ["mono provenance line with derived counts", text.includes(`${survey.findings.length} finding records`)],
      ["attribution block", q(container, ".sd-provenance > div") === 13],
      ["checkpoint digest exposed", text.includes(survey.findings[0].model_sha256)],
      ["evidence score type exposed", text.includes("UNVALIDATED_EVIDENCE_FUSION")],
      ["navigation status exposed", text.includes("UNAVAILABLE")],
      ["preview is a real serialization", (pre.textContent ?? "").includes('"detection_id"')],
      ["null coordinates demonstrated", (pre.textContent ?? "").includes('"lat": null')],
      ["honesty note verbatim", text.includes("never a substituted value")],
      ["only formats this deployment produces", q(container, ".sd-format-list button") === 3],
      ["no PDF offered at all", !/PDF/.test(text.replace("no PDF generator here", ""))],
      ["share disabled with a caption", text.includes("Sharing is not enabled for this deployment")],
    ]);
    cleanup();
  });

  it("12 model lab", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => card })));
    const { container, findByText } = render(<ModelLabScreen connection={online} />);
    await findByText("Detection performance by class");
    const rows = Array.from(container.querySelectorAll(".sd-table tbody tr")).map((r) =>
      Array.from(r.querySelectorAll("th, td")).map((c) => c.textContent).join(" | "),
    );
    const text = txt(container);
    report("12 Model Lab", container, [
      ["honesty paragraph", text.includes("Every figure here traces to one evaluation run.")],
      ["runtime registry lists every component", q(container, ".sd-registry-row") === 5],
      ["frozen detector role stated", text.includes("The only candidate generator")],
      ["RF-DETR declared unavailable, not omitted", text.includes("RF-DETR") && text.includes("not configured")],
      ["RF-DETR limit stated", text.includes("No legitimately trained artifact is registered")],
      ["natural clutter rejection stated", text.includes("Rejected as an automatic suppression gate")],
      ["open-set memory version and threshold source shown", text.includes("open_set_v1") && text.includes("q99.5_annotation_safe_background_val")],
      ["five-pair run header", q(container, ".sd-run-header > div") === 5],
      ["no unknown in the provenance strip", !Array.from(container.querySelectorAll(".sd-run-header b")).some((n) => n.textContent === "unknown")],
      ["per-class table with All classes last", rows.length === 4 && rows[3].startsWith("All classes")],
      ["evaluated-not-present caveat", text.includes("not when it happens to appear in the loaded survey")],
      ["PR curve declared unavailable, not invented", text.includes("Precision against recall unavailable")],
      ["open-set held-out evaluation still declared unavailable", text.includes("Open-set evaluation unavailable")],
      ["runtime availability is not presented as a measurement", text.includes("no AUROC, TPR or FPR against artificial targets is claimed")],
      ["latency carries its measurement condition", text.includes("Measured on NVIDIA RTX PRO 6000")],
      ["host device difference stated", text.includes("This deployment runs on mps")],
      ["review lineage prose", text.includes("excluded from the evaluation split")],
      ["demo policy is not presented as measured performance", text.includes("which is not a measurement and never appears here")],
    ]);
    vi.unstubAllGlobals();
    cleanup();
  });

  it("13 change states the semantics and refuses rather than inventing", async () => {
    const readiness = {
      supported: false,
      status: "COMPARISON_REFUSED",
      new_survey: {
        survey_id: survey.survey_id,
        name: survey.name,
        navigation_status: "UNAVAILABLE",
        spatial_reference_level: "L0_PIXEL_ONLY",
        coverage_polygon: false,
        positioned_observations: 0,
        observation_count: 6,
        contact_count: 4,
      },
      baseline_survey: {
        survey_id: null,
        navigation_status: "UNAVAILABLE",
        spatial_reference_level: null,
        coverage_polygon: false,
        positioned_observations: 0,
        observation_count: 0,
      },
      blockers: [
        { gate: "BASELINE_SURVEY", reason: "No baseline survey was selected, so there is nothing to compare against." },
        { gate: "SPATIAL_REFERENCE_LEVEL", reason: "The new survey is L0_PIXEL_ONLY." },
        { gate: "COVERAGE_POLYGON", reason: "The new survey carries no coverage polygon." },
      ],
      semantics: [
        { state: "NEW", meaning: "Present in the new pass." },
        { state: "UNCHANGED", meaning: "Matched to a baseline contact." },
        { state: "NOT_DETECTED", meaning: "Resurveyed and nothing detected. This is a detector absence, not a removal." },
        { state: "NOT_SURVEYED", meaning: "Outside the new pass's coverage." },
        { state: "REMOVED", meaning: "Never inferred from a detector absence." },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => readiness })));
    const { container, findByText } = render(<ChangeScreen survey={survey} recent={[]} />);
    await findByText(/A comparison between these two passes is refused/);
    const text = txt(container);
    report("13 Change", container, [
      ["all five states are explained", q(container, ".sd-change-state") === 5],
      ["removal is never inferred", text.includes("Never inferred from a detector absence")],
      ["every blocking gate is named", q(container, ".sd-change-blocker") === 3],
      ["both surveys' gates are shown", q(container, ".sd-gate-column") === 2],
      ["not-detected is separated from not-surveyed", text.includes("NOT DETECTED") && text.includes("NOT SURVEYED")],
    ]);
    vi.unstubAllGlobals();
    cleanup();
  });

  it("14 review memory shows queues without implying retraining", async () => {
    const stats = {
      append_only: true,
      online_learning: false,
      event_count: 3,
      verdicts: { CONFIRMED: 2, REJECTED: 1 },
      queues: { hard_negative: 1, confirmed_positive: 2, relabelled: 0, uncertain: 0 },
      reviewers: { "local operator": 3 },
      surveys_retained: 2,
      surveys_with_review: 1,
      observations: 6,
      reviewed_observations: 3,
      export_targets: ["hard_negative_manifest.jsonl", "confirmed_positive_manifest.jsonl", "uncertain_manifest.jsonl"],
      note: "Verdicts accumulate as training memory.",
    };
    const events = {
      items: survey.findings[0].review_history.map((event) => ({
        ...event,
        survey_id: survey.survey_id,
        survey_name: survey.name,
        detection_id: survey.findings[0].detection_id,
        contact_id: survey.contacts?.[0]?.contact_id ?? null,
        raw_class: survey.findings[0].raw_class,
        raw_confidence: survey.findings[0].raw_confidence,
        model_sha256: survey.findings[0].model_sha256,
        training_memory_queue: "confirmed_positive",
      })),
      total: 1,
      append_only: true,
      online_learning: false,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (String(url).includes("memory/stats") ? stats : events),
      })),
    );
    const { container, findByText } = render(<MemoryScreen survey={survey} />);
    await findByText("Hard negatives");
    const text = txt(container);
    report("14 Review memory", container, [
      ["four named queues", q(container, ".sd-memory-queue") === 4],
      ["append-only is stated as a mode", text.includes("APPEND_ONLY")],
      ["online learning is explicitly disabled", text.includes("DISABLED")],
      ["retraining is explicitly denied", text.includes("does not retrain, re-weight or re-score anything")],
      ["export manifests named", text.includes("hard_negative_manifest.jsonl")],
      ["an unreviewed hit is not called a negative", text.includes("an unreviewed detector hit is not one")],
      ["history rendered from real events", q(container, ".sd-memory-event") === 1],
    ]);
    vi.unstubAllGlobals();
    cleanup();
  });
});
