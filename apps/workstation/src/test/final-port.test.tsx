import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalClass,
  classLabel,
  confidenceLabel,
  coordinates,
  countAction,
  countHigh,
  countPositioned,
  dimensions,
  priority,
  reviewBadge,
  reviewQueue,
  sortedFindings,
} from "@/components/final/runtime/select";
import type { RuntimeFinding, RuntimeSurvey } from "@/components/final/runtime/types";
import { contactViews, evidenceBandLabel, evidenceScoreLabel, representativeObservation } from "@/components/final/runtime/select";
import type { RuntimeContact } from "@/components/final/runtime/types";
import { ResultsScreen } from "@/components/final/screens/ResultsScreen";
import { MapScreen } from "@/components/final/screens/MapScreen";
import { MissionScreen } from "@/components/final/screens/MissionScreen";
import { DecisionScreen } from "@/components/final/screens/DecisionScreen";
import { ReportScreen } from "@/components/final/screens/ReportScreen";
import { WorkspaceScreen } from "@/components/final/screens/WorkspaceScreen";
import { UploadScreen } from "@/components/final/screens/UploadScreen";

function finding(overrides: Partial<RuntimeFinding> = {}): RuntimeFinding {
  return {
    detection_id: "det_survey_upload_abc_0000",
    survey_id: "survey_upload_abc",
    source_frame_id: "frame_0000",
    source_image_path: "/tmp/upload.png",
    tile_id: null,
    raw_class_id: 2,
    raw_class: "CRAB_POT",
    raw_confidence: 0.6123,
    display_class: "CRAB_POT",
    display_confidence: 0.6123,
    classification_source: "MODEL",
    production_qualified: true,
    anomaly_score: null,
    bbox_px: [10, 20, 130, 100],
    bbox_normalized: [0.01, 0.04, 0.13, 0.2],
    pixel_dimensions: [1000, 500],
    geo: { lat: null, lon: null },
    review_state: null,
    review_history: [],
    model_id: "sagardrishti_multidomain_v1_1_yolo11s",
    model_sha256: "2aa3ac71",
    dataset_snapshot_id: "multidomain_sonar_v1_1_20260831",
    run_id: "runtime_survey_upload_abc",
    inference_mode: "FULL_FRAME",
    tile_size: null,
    tile_overlap: null,
    ...overrides,
  };
}

function survey(findings: RuntimeFinding[]): RuntimeSurvey {
  return {
    survey_id: "survey_upload_abc",
    name: "north_bank_pass.png",
    created_at: "2026-09-01T04:12:00Z",
    frames: [{ frame_id: "frame_0000", source_path: "/tmp/upload.png", width_px: 1000, height_px: 500 }],
    findings,
  };
}

/** A Contact over the given observations, shaped exactly as the runtime API
 * emits it (packages/sagar/vnext/contacts.py). */
function contact(overrides: Partial<RuntimeContact> = {}): RuntimeContact {
  return {
    contact_id: "contact_survey_upload_abc_0001",
    source_detection_ids: ["det_survey_upload_abc_0000"],
    best_observation_id: "det_survey_upload_abc_0000",
    resolved_class: "CRAB_POT",
    observation_count: 1,
    distinct_frame_observation_count: 1,
    max_raw_confidence: 0.6123,
    evidence_score: 0.42,
    evidence_breakdown: { score_type: "UNVALIDATED_EVIDENCE_FUSION", missing_components: ["anomaly", "physics"] },
    persistence_evidence_type: "SINGLE_OBSERVATION",
    priority_band: "LOW",
    recommended_action: "REVIEW",
    natural_clutter: { status: "REJECTED_FOR_AUTOMATIC_SUPPRESSION", mode: "ADVISORY_ONLY" },
    reviews: { history: [], latest_verdict: null, review_count: 0 },
    ...overrides,
  };
}

/** Every screen prop that is not the subject of a given assertion. */
const workspaceProps = {
  onSelect: () => {},
  onLayer: () => {},
  onToggleTech: () => {},
  onSendToReview: () => {},
  onMap: () => {},
};

const resultsProps = {
  survey: null as RuntimeSurvey | null,
  recent: [],
  onOpenRecent: () => {},
  onOpen: () => {},
  onNavigate: () => {},
  onRetry: () => {},
  onUpload: () => {},
};

describe("domain vocabulary is a closed enum", () => {
  it("maps every runtime class onto the canonical class enum", () => {
    expect(classLabel(finding({ display_class: "PIPELINE" }))).toBe("Pipeline");
    expect(classLabel(finding({ display_class: "SHIPWRECK" }))).toBe("Wreck or structural debris");
    expect(classLabel(finding({ display_class: "CRAB_POT" }))).toBe("Derelict fishing gear");
  });

  it("renders an unrecognised class as Unknown anomaly, never a raw string", () => {
    const odd = finding({ display_class: "SOME_NEW_THING" });
    expect(canonicalClass(odd)).toBe("UNKNOWN_ANOMALY_CANDIDATE");
    expect(classLabel(odd)).toBe("Unknown anomaly");
  });

  it("renders an unrecognised review state as Unavailable grey", () => {
    expect(reviewBadge(finding({ review_state: "SOMETHING_ELSE" }))).toEqual({
      label: "Unavailable",
      tone: "null",
    });
  });

  it("gives every status a word alongside its tone", () => {
    for (const state of [null, "CONFIRMED", "REJECTED", "RELABELLED", "UNCERTAIN"]) {
      expect(reviewBadge(finding({ review_state: state })).label.length).toBeGreaterThan(0);
    }
  });
});

describe("counts derive from the record set", () => {
  const records = [
    finding({ detection_id: "a", review_state: null, display_confidence: 0.4 }),
    finding({ detection_id: "b", review_state: "CONFIRMED", display_class: "SHIPWRECK", display_confidence: 0.9 }),
    finding({ detection_id: "c", review_state: "CONFIRMED", display_class: "PIPELINE", display_confidence: 0.8 }),
    finding({ detection_id: "d", review_state: "UNCERTAIN", display_confidence: 0.7 }),
  ];

  it("derives priority from review state and class, never from a sent scalar", () => {
    expect(priority(records[0])).toBe("Review");
    expect(priority(records[1])).toBe("High");
    expect(priority(records[2])).toBe("Low");
    expect(priority(records[3])).toBe("Review");
  });

  it("sorts by priority then confidence descending", () => {
    expect(sortedFindings(records).map((f) => f.detection_id)).toEqual(["b", "d", "a", "c"]);
  });

  it("keeps the queue, backlog and high-priority counts consistent", () => {
    expect(reviewQueue(records).map((f) => f.detection_id)).toEqual(["d", "a"]);
    expect(countAction(records)).toBe(2);
    expect(countHigh(records)).toBe(1);
    expect(countPositioned(records)).toBe(0);
  });
});

describe("null survives to the UI", () => {
  it("never coalesces a missing coordinate", () => {
    expect(coordinates(finding())).toBe("Unavailable");
    expect(coordinates(finding(), "No position")).toBe("No position");
    expect(coordinates(finding({ geo: { lat: 8.7412, lon: 78.1936 } }))).toBe(
      "8.7412° N, 78.1936° E",
    );
  });

  it("renders confidence as an integer percentage and unavailable when absent", () => {
    expect(confidenceLabel(0.6123)).toBe("61%");
    expect(confidenceLabel(null)).toBe("Unavailable");
  });

  it("reports extent in source pixels because there is no range scale", () => {
    expect(dimensions(finding())).toBe("120 × 80 px (image scale)");
  });
});

describe("honesty states render rather than substitute", () => {
  it("carries the coverage caveat on an empty findings list", () => {
    render(
      <ResultsScreen {...resultsProps} contacts={[]} findings={[]} loading={false} error={null} title="What did we find?" />,
    );
    expect(screen.getByText("No findings recorded in this pass.")).toBeInTheDocument();
    // An empty pass is never presented as an all-clear, and never as a statement
    // about object types the detector was never trained on.
    expect(screen.getByText(/not a statement that the area is clear/)).toBeInTheDocument();
    expect(screen.getByText(/never trained on/)).toBeInTheDocument();
  });

  it("renders metrics as em dashes while loading, never as zeros", () => {
    render(
      <ResultsScreen {...resultsProps} contacts={[]} findings={[]} loading error={null} title="What did we find?" />,
    );
    expect(screen.getAllByText("—")).toHaveLength(4);
  });

  it("never places a finding that carries no position", () => {
    const records = [finding()];
    const { container } = render(
      <MapScreen
        contacts={[]}
        findings={records}
        selected={records[0]}
        onSelect={() => {}}
        onOpenWorkspace={() => {}}
        mode="chart"
        onMode={() => {}}
        geometry={null}
        survey={survey(records)}
        trackPoints={0}
      />,
    );
    expect(container.querySelectorAll(".sd-marker")).toHaveLength(0);
    expect(screen.getByText("No finding in this survey carries a position.")).toBeInTheDocument();
    expect(screen.getByText("Location unavailable")).toBeInTheDocument();
  });

  it("suppresses the previous-pass comparison instead of zeroing it", () => {
    const records = [finding()];
    render(
      <MissionScreen
        survey={survey(records)}
        findings={records}
        processing={false}
        onOpen={() => {}}
        onNavigate={() => {}}
        closeLine="north_bank_pass.png"
      />,
    );
    expect(screen.getByText("No previous pass to compare")).toBeInTheDocument();
    expect(screen.getAllByText(/Absence here is not a removal/).length).toBeGreaterThan(0);
    expect(screen.getByText("Team assignment not connected")).toBeInTheDocument();
  });

  it("keeps method names and scores out of the decision panel and its disclosure", () => {
    const records = [finding()];
    const { container } = render(
      <DecisionScreen
        survey={survey(records)}
        processing={false}
        onNavigate={() => {}}
        why
        onToggleWhy={() => {}}
      />,
    );
    const panel = container.querySelector(".sd-recommend") as HTMLElement;
    const text = panel.textContent ?? "";
    for (const banned of ["IoU", "mAP", "YOLO", "confidence", "%", "precision", "recall"]) {
      expect(text).not.toContain(banned);
    }
  });
});

describe("the Contact is the primary object and the observation is its evidence", () => {
  const record = finding();
  const data = survey([record]);
  data.contacts = [contact()];
  const views = contactViews(data.contacts, data.findings);

  it("derives one view per Contact, joined to the observations it was fused from", () => {
    expect(views).toHaveLength(1);
    expect(views[0].observations.map((item) => item.detection_id)).toEqual([record.detection_id]);
    expect(views[0].best.detection_id).toBe(record.detection_id);
    expect(views[0].label).toBe("Derelict fishing gear");
    expect(views[0].missingEvidence).toEqual(["anomaly", "physics"]);
  });

  it("selects the designated best observation, then raw confidence when it is missing", () => {
    const observations = [
      finding({ detection_id: "a", raw_confidence: 0.03 }),
      finding({ detection_id: "b", raw_confidence: 0.61 }),
      finding({ detection_id: "c", raw_confidence: 0.27 }),
    ];
    const designated = contact({ source_detection_ids: ["a", "b", "c"], best_observation_id: "b" });
    expect(representativeObservation(designated, observations)?.detection_id).toBe("b");
    const fallback = { ...designated, best_observation_id: null };
    expect(representativeObservation(fallback, observations)?.detection_id).toBe("b");
  });

  it("labels the evidence score as a score and the band as a band, never a probability", () => {
    expect(evidenceScoreLabel(views[0].evidenceScore)).toBe("0.42");
    expect(evidenceScoreLabel(null)).toBe("Unavailable");
    expect(evidenceBandLabel(views[0].contact)).toBe("Low");
    expect(evidenceBandLabel({ ...views[0].contact, priority_band: undefined })).toBe("Unavailable");
  });

  it("orders undecided contacts ahead of decided ones, then by evidence band", () => {
    const decided = contact({
      contact_id: "contact_decided",
      source_detection_ids: ["det_decided"],
      best_observation_id: "det_decided",
      priority_band: "HIGH",
      reviews: { history: [], latest_verdict: "CONFIRMED", review_count: 1 },
    });
    const undecided = contact({ contact_id: "contact_undecided", priority_band: "LOW" });
    const records = [record, finding({ detection_id: "det_decided" })];
    const ordered = contactViews([decided, undecided], records);
    expect(ordered.map((view) => view.contact.contact_id)).toEqual(["contact_undecided", "contact_decided"]);
  });

  it("shows the Contact rail and keeps the raw observations inspectable beneath it", () => {
    const { container } = render(
      <WorkspaceScreen
        {...workspaceProps}
        survey={data}
        contacts={views}
        findings={[record]}
        selected={record}
        layer="detections"
        tech={false}
        rasterFor={() => null}
      />,
    );
    expect(within(container).getByText("Contacts in this survey")).toBeInTheDocument();
    expect(container.querySelector('[data-contact-id="contact_survey_upload_abc_0001"]')).toBeTruthy();
    // The distinction is stated, not implied: the inspector badges the object kind.
    expect(within(container).getByText("Contact")).toBeInTheDocument();
    expect(within(container).getByText("Raw observations in this contact (1)")).toBeInTheDocument();
    expect(within(container).queryByText(/Raw detector confidence/)).not.toBeInTheDocument();
    expect(within(container).getByText(/EVIDENCE STRENGTH/)).toBeInTheDocument();
  });

  it("keeps raw observations labelled as findings when the runtime fused no Contact", () => {
    const bare = survey([record]);
    bare.contacts = [];
    const { container } = render(
      <WorkspaceScreen
        {...workspaceProps}
        survey={bare}
        contacts={[]}
        findings={[record]}
        selected={record}
        layer="raw"
        tech={false}
        rasterFor={() => null}
      />,
    );
    expect(within(container).getByText("Findings in this survey")).toBeInTheDocument();
    expect(container.querySelector("[data-contact-id]")).toBeNull();
    expect(within(container).getByText("Raw observation")).toBeInTheDocument();
  });

  it("selects the underlying observation when a Contact row is clicked", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <WorkspaceScreen
        {...workspaceProps}
        survey={data}
        contacts={views}
        findings={[record]}
        selected={record}
        onSelect={onSelect}
        layer="raw"
        tech={false}
        rasterFor={() => null}
      />,
    );
    fireEvent.click(container.querySelector('[data-contact-id="contact_survey_upload_abc_0001"]') as HTMLButtonElement);
    expect(onSelect).toHaveBeenCalledWith(record);
  });
});

describe("technical evidence is disclosed, not exposed", () => {
  const records = [finding({
    raw_class: "SHIPWRECK",
    raw_confidence: 0.03,
    display_class: "SHIPWRECK",
    display_confidence: 0.73,
    classification_source: "DEMO_HEURISTIC",
    production_qualified: false,
  })];
  const data = survey(records);
  data.contacts = [contact()];
  const views = contactViews(data.contacts, data.findings);

  function workspace(tech: boolean) {
    return (
      <WorkspaceScreen
        {...workspaceProps}
        survey={data}
        contacts={views}
        findings={records}
        selected={records[0]}
        layer="detections"
        tech={tech}
        rasterFor={() => null}
      />
    );
  }

  it("hides raw model values until the disclosure is opened", () => {
    const { rerender, container } = render(workspace(false));
    expect(container.querySelector(".sd-tech")).toBeNull();
    expect(screen.queryByText("Raw detector class")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("73%");
    expect(container.textContent).not.toContain("3%");

    rerender(workspace(true));
    const block = container.querySelector(".sd-tech") as HTMLElement;
    expect(within(block).getByText("Presentation label")).toBeInTheDocument();
    expect(within(block).getByText("Demo heuristic")).toBeInTheDocument();
    expect(within(block).getAllByText(/SHIPWRECK · 3%/)).toHaveLength(2);
    // The demo presentation policy is disclosed where the raw values are.
    expect(within(block).getByText(/INTERNAL DEMO ONLY/)).toBeInTheDocument();
    expect(within(block).getByText(/The raw detector output above is unchanged/)).toBeInTheDocument();
  });

  it("opens every evidence row closed, so the first view stays readable", () => {
    const { container } = render(workspace(true));
    expect(container.querySelectorAll(".sd-ev-row").length).toBe(10);
    expect(container.querySelectorAll(".sd-ev-row[open]").length).toBe(0);
  });

  it("states an unavailable channel as unavailable rather than omitting or zeroing it", () => {
    const { container } = render(workspace(true));
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".sd-ev-row"));
    const openSet = rows.find((row) => row.textContent?.includes("Open-set anomaly")) as HTMLElement;
    expect(openSet.getAttribute("data-state")).toBe("unavailable");
    expect(openSet.textContent).toContain("Unavailable");
    expect(openSet.textContent).toContain("excluded from fusion rather than scored as zero");
    const fusion = rows.find((row) => row.textContent?.includes("Evidence fusion")) as HTMLElement;
    expect(fusion.textContent).toContain("anomaly, physics");
    expect(fusion.textContent).not.toMatch(/probability that/i);
  });
});

describe("evidence wording never overclaims", () => {
  it("presents an open-set exceedance as a review request, not a class or a probability", () => {
    const record = finding({
      open_set: {
        status: "AVAILABLE",
        anomaly_score: 0.62,
        threshold: 0.46,
        threshold_source: "q99.5_annotation_safe_background_val",
        feature_source: "frozen YOLO11s layer-16 embeddings",
        memory_version: "open_set_v1",
        is_open_set_candidate: true,
      },
    });
    const data = survey([record]);
    data.contacts = [
      contact({ anomaly_score: 0.62, is_open_set_candidate: true, open_set: record.open_set }),
    ];
    const { container } = render(
      <WorkspaceScreen
        {...workspaceProps}
        survey={data}
        contacts={contactViews(data.contacts, data.findings)}
        findings={[record]}
        selected={record}
        layer="detections"
        tech
        rasterFor={() => null}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Open-set candidate");
    expect(text).toContain("not a probability");
    expect(text).toContain("not proof that the contact");
    expect(text).toContain("does not create a fourth detector class");
    expect(text).not.toMatch(/artificial object detected|confirmed artificial/i);
  });

  it("renders insufficient pipeline evidence as missing evidence, not a false-positive verdict", () => {
    const record = finding({
      raw_class: "PIPELINE",
      display_class: "PIPELINE",
      raw_confidence: 0.3075626790523529,
      pipeline_verification: {
        status: "INSUFFICIENT_EVIDENCE",
        hard_return_status: "NOT_OBSERVED",
        shadow_status: "UNAVAILABLE",
        local_contrast: -0.16180083049559574,
        candidate_bright_fraction: 0.050223158317035256,
        elongation: 2.0942028985507246,
        missing_inputs: ["CALIBRATED_RANGE_SIDE_ORIENTATION"],
        reasons: ["LOW_BBOX_ELONGATION", "SHADOW_GEOMETRY_UNAVAILABLE"],
        evidence_strength: 0,
      },
    });
    const data = survey([record]);
    data.contacts = [contact({ resolved_class: "PIPELINE", pipeline_verification: record.pipeline_verification })];
    const { container } = render(
      <WorkspaceScreen
        {...workspaceProps}
        survey={data}
        contacts={contactViews(data.contacts, data.findings)}
        findings={[record]}
        selected={record}
        layer="detections"
        tech
        rasterFor={() => null}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Insufficient evidence");
    expect(text).toContain("NOT_OBSERVED");
    expect(text).toContain("CALIBRATED_RANGE_SIDE_ORIENTATION");
    expect(text).toContain("it is not a false-positive verdict");
    expect(text).toContain("does not prove");
    expect(text).not.toMatch(/confirmed absent|proven false/i);
  });

  it("never treats natural clutter as a veto", () => {
    const record = finding();
    const data = survey([record]);
    data.contacts = [contact()];
    const { container } = render(
      <WorkspaceScreen
        {...workspaceProps}
        survey={data}
        contacts={contactViews(data.contacts, data.findings)}
        findings={[record]}
        selected={record}
        layer="detections"
        tech
        rasterFor={() => null}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("REJECTED_FOR_AUTOMATIC_SUPPRESSION");
    expect(text).toContain("can never veto a Contact");
    expect(text).not.toMatch(/suppressed as clutter|rejected as clutter/i);
  });

  it("says a persistence type means what it means, and never calls window overlap persistence", () => {
    const record = finding();
    const data = survey([record]);
    data.contacts = [contact({ persistence_evidence_type: "WINDOW_OVERLAP_ONLY", window_overlap_duplicate_count: 2 })];
    const { container } = render(
      <WorkspaceScreen
        {...workspaceProps}
        survey={data}
        contacts={contactViews(data.contacts, data.findings)}
        findings={[record]}
        selected={record}
        layer="detections"
        tech
        rasterFor={() => null}
      />,
    );
    expect(container.textContent).toContain("Window overlap is not sequential persistence");
  });
});

describe("the report manifest is the export schema", () => {
  it("lists the writer's fields, demonstrates a null coordinate, and offers no PDF", () => {
    const records = [finding()];
    const data = survey(records);
    data.contacts = [contact()];
    const { container } = render(
      <ReportScreen survey={data} contacts={contactViews(data.contacts, data.findings)} />,
    );
    fireEvent.click(container.querySelector(".sd-disclosure") as HTMLButtonElement);
    const preview = container.querySelector(".sd-report-preview") as HTMLElement;
    expect(preview.textContent).toContain('"lat": null');
    expect(screen.getByText(/never a substituted value/)).toBeInTheDocument();
    expect(screen.getByText("Download JSON")).toBeInTheDocument();
    // Three real formats, and no disabled placeholder for one that does not exist.
    expect(container.querySelectorAll(".sd-format-list button")).toHaveLength(3);
    expect(container.textContent).toContain("There is no PDF generator here, so none is offered.");
    expect(container.textContent).toContain("UNVALIDATED_EVIDENCE_FUSION");
  });
});

describe("upload states", () => {
  const connection = {
    status: "ONLINE" as const,
    health: null,
    message: null,
    checkedAt: "2026-09-05T10:00:00Z",
  };

  it("replaces the empty dropzone with the frozen ready treatment", () => {
    const file = new File(["sonar"], "pass.png", { type: "image/png" });
    render(
      <UploadScreen
        file={file}
        onChoose={() => {}}
        onProcess={() => {}}
        error={null}
        advanced={false}
        onToggleAdvanced={() => {}}
        connection={connection}
      />,
    );
    expect(screen.getByText("Ready to process")).toBeInTheDocument();
    expect(screen.getByText("Replace")).toBeInTheDocument();
    expect(screen.getByText("Remove")).toBeInTheDocument();
  });

  it("states that a rejected upload created nothing", () => {
    const file = new File(["sonar"], "pass.png", { type: "image/png" });
    render(
      <UploadScreen
        file={file}
        onChoose={() => {}}
        onProcess={() => {}}
        error="pass.png could not be read as an image."
        advanced={false}
        onToggleAdvanced={() => {}}
        connection={connection}
      />,
    );
    expect(screen.getByText(/could not be read as an image/)).toBeInTheDocument();
    expect(screen.getByText(/no survey record was created/)).toBeInTheDocument();
  });
});
