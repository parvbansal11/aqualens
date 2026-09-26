/* Scientific wording audit, enforced.
 *
 * The claims this product is allowed to make are fixed by
 * docs/VNEXT_FINAL_PRODUCT_CONTRACT.md. This file turns the forbidden ones into
 * a test: it scans the authored copy table and the rendered text of every
 * screen for constructions that would overclaim, so a future edit that
 * reintroduces one fails here instead of in front of a reviewer.
 *
 * Each rule carries the reason it exists. A rule with an allowed form lists it,
 * because most of these words are legitimate in a denial ("not a probability")
 * and forbidden only as an assertion.
 */
import { render, cleanup } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import live from "./fixtures/runtime-survey.json";
import navigated from "./fixtures/runtime-survey-navigated.json";
import liveJob from "./fixtures/runtime-job.json";
import * as strings from "@/components/final/runtime/strings";
import type { RuntimeJob, RuntimeSurvey } from "@/components/final/runtime/types";
import { contactViews, sortedFindings, reviewQueue } from "@/components/final/runtime/select";
import { ResultsScreen } from "@/components/final/screens/ResultsScreen";
import { MapScreen } from "@/components/final/screens/MapScreen";
import { WorkspaceScreen } from "@/components/final/screens/WorkspaceScreen";
import { ReviewScreen } from "@/components/final/screens/ReviewScreen";
import { MissionScreen } from "@/components/final/screens/MissionScreen";
import { DecisionScreen } from "@/components/final/screens/DecisionScreen";
import { ReportScreen } from "@/components/final/screens/ReportScreen";
import { ProcessingScreen } from "@/components/final/screens/ProcessingScreen";
import { LandingScreen } from "@/components/final/screens/LandingScreen";
import { UploadScreen } from "@/components/final/screens/UploadScreen";

const survey = live as unknown as RuntimeSurvey;
const navSurvey = navigated as unknown as RuntimeSurvey;
const job = liveJob as unknown as RuntimeJob;
const findings = sortedFindings(survey.findings);
const contacts = contactViews(survey.contacts, survey.findings);
const noop = () => {};

/** Every authored string the product can render, flattened. */
function authoredCopy(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(strings);
  return out;
}

/** The rendered text of every screen, against a real record set. */
function renderedCopy(): string {
  const parts: string[] = [];
  const capture = (node: React.ReactElement) => {
    const { container } = render(node);
    parts.push(container.textContent ?? "");
    cleanup();
  };
  capture(<LandingScreen onEntry={noop} />);
  capture(
    <UploadScreen
      file={null}
      onChoose={noop}
      onProcess={noop}
      error={null}
      advanced
      onToggleAdvanced={noop}
      connection={{ status: "ONLINE", health: null, message: null, checkedAt: null }}
    />,
  );
  capture(
    <ProcessingScreen
      job={job}
      inFlight={false}
      error={null}
      errorKind={null}
      survey={survey}
      filmstripSrc={null}
      subtitle="x"
      onRetry={noop}
      onBackToUpload={noop}
    />,
  );
  capture(
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
  capture(
    <WorkspaceScreen
      survey={survey}
      contacts={contacts}
      findings={findings}
      selected={findings[0]}
      onSelect={noop}
      layer="detections"
      onLayer={noop}
      tech
      onToggleTech={noop}
      rasterFor={() => null}
      onSendToReview={noop}
      onMap={noop}
    />,
  );
  capture(
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
  capture(
    <ReviewScreen
      survey={survey}
      queue={reviewQueue(survey.findings)}
      index={0}
      onIndex={noop}
      onVerdict={noop}
      pending={null}
      failed={null}
      rasterFor={() => null}
      onBackToFindings={noop}
      onGenerateReport={noop}
      onOpenMemory={noop}
      title="Is this finding real?"
    />,
  );
  capture(
    <MissionScreen survey={survey} findings={findings} processing={false} onOpen={noop} onNavigate={noop} closeLine="x" />,
  );
  capture(<DecisionScreen survey={survey} processing={false} onNavigate={noop} why onToggleWhy={noop} />);
  capture(<ReportScreen survey={survey} contacts={contacts} />);
  return parts.join("\n\n");
}

type Rule = {
  name: string;
  /** The construction that would overclaim. */
  banned: RegExp;
  /** Forms that are legitimate, almost always a denial of the same claim. */
  allowed?: RegExp;
  why: string;
};

const RULES: Rule[] = [
  {
    name: "no probability where the score is not calibrated",
    banned: /\b(probability|probabilit\w+|likelihood|% (likely|chance)|confidence that (it|this) is)\b/i,
    allowed: /(not|never|rather than) a (calibrated )?probability|not a probability|probability\.$/i,
    why: "The evidence score is UNVALIDATED_EVIDENCE_FUSION. Nothing in this product is calibrated against outcomes.",
  },
  {
    name: "no claim of recognising unknown object types",
    banned: /\b(recognis\w+|identif\w+|detect\w+) (previously )?unknown (object|type|class)/i,
    why: "Open-set evidence is dissimilarity from a background reference memory. It is not unknown-object recognition.",
  },
  {
    name: "no dark region called a shadow, and no shadow called proof",
    banned: /\b(shadow (proves|confirms|shows that)|dark (patch|region|band) (is|indicates) (a )?shadow)\b/i,
    why: "Shadow, sensor dropout and a nadir gap cannot be separated without calibrated range-side geometry.",
  },
  {
    name: "no anomaly presented as artificiality",
    banned: /\banomal\w+[^.]{0,70}\b(artificial|man-made)\b/i,
    allowed: /\b(not|never|rather than|nor|no)\b[^.]{0,70}\b(artificial|man-made)\b/i,
    why: "A high anomaly score means dissimilar to the reference background, never artificial.",
  },
  {
    name: "no missing evidence presented as negative evidence",
    banned: /\b(no|zero|0) (shadow|persistence|acoustic) evidence (means|so|therefore)\b|\bscored as (a )?zero\b/i,
    allowed: /never scored as zero|rather than scored as zero|not(hing)? .{0,40}scored as zero/i,
    why: "An unavailable channel is excluded from fusion and disclosed, never scored as zero.",
  },
  {
    name: "no removal claimed without coverage",
    banned: /\b(has been |was )?removed from the seabed|no longer present|has disappeared\b/i,
    why: "REMOVED needs prior contact, genuine coverage, localization and a validated review decision.",
  },
  {
    name: "no coordinate that navigation did not supply",
    banned: /\b(GPS|position|coordinates?) (is |are )?(derived|computed|estimated) from (the )?sonar( image| imagery)?|sonar-derived (position|GPS|coordinates)/i,
    why: "Coordinates are copied from supplied navigation metadata only.",
  },
  {
    name: "no metric extent without a range scale",
    banned: /\b\d+(\.\d+)?\s?(m|metres|meters) (long|wide|across)\b/i,
    why: "There is no range scale in these recordings; extent is reported in source pixels.",
  },
  {
    name: "no autonomous or online learning",
    banned: /\b(learns from|self-learn\w*|continuously (learns|improves)|retrains? (itself|automatically)|online learning)\b/i,
    allowed: /(no|never|not|nothing|disabled)[^.]{0,80}(self-learn|online learning|retrain)/i,
    why: "Review feedback is curated memory for a future supervised round, never online self-learning.",
  },
  {
    name: "no clutter-suppression improvement claim",
    banned: /\b(natural clutter|clutter (model|suppress\w+)) (improves|reduces false positives|filters out)/i,
    why: "Its false-positive reduction removed genuine baseline true positives, so it was rejected as a gate.",
  },
  {
    name: "no production-grade shipwreck claim",
    banned: /\b(production[- ]grade|reliable|accurate) (shipwreck|wreck) (detection|recognition)/i,
    why: "SHIPWRECK presentation is demo-only and is never production qualified.",
  },
  {
    name: "no parsing of raw sonar telemetry this pipeline never reads",
    banned: /\b(pars\w+|read\w*|decod\w+)[^.]{0,40}\bping headers?\b|\bping headers? (are|is) (parsed|read)/i,
    why: "This pipeline reads PNG/JPEG/PBM rasters and an optional navigation.csv. It never opens a raw sonar telemetry format.",
  },
  {
    name: "no PDF export promised",
    banned: /\bPDF\b/,
    allowed: /no PDF generator here/,
    why: "This deployment has no PDF generator, so no screen may offer or imply one.",
  },
  {
    name: "no absence presented as safety",
    banned: /\b(the )?area is (clear|safe)\b|\bconfirmed clear\b/i,
    allowed: /(not|never|rather than)[^.]{0,60}(area is clear|confirmed clear)/i,
    why: "Absence of a detection is not evidence that an area is clear.",
  },
];

function offenders(rule: Rule, lines: string[]): string[] {
  return lines.filter((line) => rule.banned.test(line) && !(rule.allowed && rule.allowed.test(line)));
}

/* Each rule is proved to have teeth against a sentence that would violate it,
 * so a regex that silently stops matching cannot let the audit pass vacuously. */
const VIOLATIONS: Record<string, string> = {
  "no probability where the score is not calibrated": "The evidence score is the probability this contact is real.",
  "no claim of recognising unknown object types": "The system recognises unknown object types it was never trained on.",
  "no dark region called a shadow, and no shadow called proof": "The shadow proves the object stands proud of the seabed.",
  "no anomaly presented as artificiality": "A high anomaly means this contact is artificial.",
  "no missing evidence presented as negative evidence": "With no shadow evidence the candidate is scored as zero.",
  "no removal claimed without coverage": "This contact has been removed from the seabed since the last pass.",
  "no coordinate that navigation did not supply": "The position is computed from the sonar image itself.",
  "no metric extent without a range scale": "The contact is 14.2 m long.",
  "no autonomous or online learning": "The system continuously improves as analysts review findings.",
  "no clutter-suppression improvement claim": "Natural clutter suppression improves detection quality.",
  "no production-grade shipwreck claim": "Production-grade shipwreck detection is enabled.",
  "no parsing of raw sonar telemetry this pipeline never reads": "Ping headers are parsed alongside the imagery.",
  "no PDF export promised": "Download the survey as a PDF summary.",
  "no absence presented as safety": "No contact was found, so the area is clear.",
};

describe("the audit has teeth", () => {
  for (const rule of RULES) {
    it(`catches a violation of: ${rule.name}`, () => {
      const sample = VIOLATIONS[rule.name];
      expect(sample, `no sample violation authored for rule "${rule.name}"`).toBeTruthy();
      expect(offenders(rule, [sample])).toEqual([sample]);
    });
  }
});

describe("authored copy makes no forbidden claim", () => {
  const copy = authoredCopy();

  for (const rule of RULES) {
    it(rule.name, () => {
      expect({ rule: rule.name, why: rule.why, offenders: offenders(rule, copy) }).toEqual({
        rule: rule.name,
        why: rule.why,
        offenders: [],
      });
    });
  }

  it("has copy to audit at all, so a broken import cannot pass this file vacuously", () => {
    expect(copy.length).toBeGreaterThan(50);
    expect(copy.join(" ")).toContain("UNVALIDATED_EVIDENCE_FUSION");
  });
});

describe("rendered screens make no forbidden claim", () => {
  const sentences = renderedCopy()
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const rule of RULES) {
    it(rule.name, () => {
      expect({ rule: rule.name, offenders: offenders(rule, sentences) }).toEqual({
        rule: rule.name,
        offenders: [],
      });
    });
  }

  it("renders enough text to audit", () => {
    expect(sentences.length).toBeGreaterThan(100);
  });
});

describe("the disclosures that must be present, are", () => {
  const text = renderedCopy();

  it("labels the evidence score as unvalidated wherever it is shown", () => {
    expect(text).toContain("UNVALIDATED_EVIDENCE_FUSION");
  });

  it("states the open-set score's meaning and its limit", () => {
    expect(text).toContain("not a probability");
    expect(text).toContain("not proof that the contact");
  });

  it("keeps the raw detector output visible and unaltered", () => {
    expect(text).toContain("Raw detector confidence");
    expect(text).toContain("no later stage rewrites the class, the confidence or the box");
  });

  it("states the SHIPWRECK limitation where an analyst will read it", () => {
    expect(text).toMatch(/demo-only/i);
  });

  it("states that natural clutter can never veto a contact", () => {
    expect(text).toContain("can never veto a Contact");
  });

  it("states that a verdict does not retrain anything", () => {
    expect(text).toMatch(/Nothing is retrained by recording one|does not retrain/);
  });

  it("states that missing navigation is missing, not zero", () => {
    expect(text).toContain("No coordinate is ever derived from the sonar imagery");
  });
});

describe("prose adapts to what the survey actually carries", () => {
  it("does not claim navigation is absent when navigation was supplied", () => {
    const navFindings = sortedFindings(navSurvey.findings);
    const { container } = render(
      <DecisionScreen survey={navSurvey} processing={false} onNavigate={noop} why onToggleWhy={noop} />,
    );
    const text = container.textContent ?? "";
    expect(navFindings.some((item) => item.geo.lat !== null)).toBe(true);
    expect(text).not.toContain("No finding in this survey carries a latitude and longitude");
    expect(text).toMatch(/carry a latitude and longitude copied from supplied navigation records/);
    // The coverage caveat still applies: a position is not a surveyed area.
    expect(text).toContain("no area can be declared surveyed or unsurveyed");
    cleanup();
  });
});
