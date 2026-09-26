/* Accessibility contracts.
 *
 * This is an operations console: an analyst works it from the keyboard, and a
 * reviewer may be reading it on a projector or with forced colours. These tests
 * pin the properties that make that possible — reachable landmarks, named
 * controls, real values on progress indicators, keyboard-operable disclosure,
 * and status that is announced rather than only coloured.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import live from "./fixtures/runtime-survey.json";
import liveJob from "./fixtures/runtime-job.json";
import type { ConnectionState, RuntimeJob, RuntimeSurvey } from "@/components/final/runtime/types";
import { contactViews, reviewBadge, reviewQueue, sortedFindings } from "@/components/final/runtime/select";
import { AppShell } from "@/components/final/shell/AppShell";
import { ResultsScreen } from "@/components/final/screens/ResultsScreen";
import { WorkspaceScreen } from "@/components/final/screens/WorkspaceScreen";
import { ReviewScreen } from "@/components/final/screens/ReviewScreen";
import { ProcessingScreen } from "@/components/final/screens/ProcessingScreen";
import { MapScreen } from "@/components/final/screens/MapScreen";

const survey = live as unknown as RuntimeSurvey;
const job = liveJob as unknown as RuntimeJob;
const findings = sortedFindings(survey.findings);
const contacts = contactViews(survey.contacts, survey.findings);
const queue = reviewQueue(survey.findings);
const noop = () => {};

const connection: ConnectionState = {
  status: "OFFLINE",
  health: null,
  message: "The analysis service is not reachable from this browser.",
  checkedAt: "2026-09-05T10:00:00Z",
};

/** An element is named if a screen reader would announce something for it. */
function accessibleName(element: Element): string {
  const label = element.getAttribute("aria-label");
  if (label) return label;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) return labelledBy;
  const title = element.getAttribute("title");
  if (title) return title;
  return (element.textContent ?? "").trim();
}

describe("the shell is navigable", () => {
  it("offers a skip link to the main region it actually targets", () => {
    const { container } = render(
      <AppShell
        role="analyst"
        screen="results"
        survey={survey}
        connection={connection}
        recent={[]}
        onOpenRecent={noop}
        onNavigate={noop}
        onLanding={noop}
        onUpload={noop}
        onEntry={noop}
      >
        <p>body</p>
      </AppShell>,
    );
    const skip = container.querySelector(".sd-skip") as HTMLAnchorElement;
    expect(skip).toBeTruthy();
    expect(skip.getAttribute("href")).toBe("#sd-main");
    expect(container.querySelector("#sd-main")).toBeTruthy();
    expect(container.querySelector("main#sd-main")).toBeTruthy();
  });

  it("names the navigation landmark by role and marks the current page", () => {
    render(
      <AppShell
        role="analyst"
        screen="workspace"
        survey={survey}
        connection={connection}
        recent={[]}
        onOpenRecent={noop}
        onNavigate={noop}
        onLanding={noop}
        onUpload={noop}
        onEntry={noop}
      >
        <p>body</p>
      </AppShell>,
    );
    const nav = screen.getByRole("navigation", { name: /Sonar Analyst navigation/ });
    expect(within(nav).getByRole("button", { name: "Workspace" })).toHaveAttribute("aria-current", "page");
  });

  it("announces service state as a live status, in words and not by colour alone", () => {
    const { container } = render(
      <AppShell
        role="analyst"
        screen="results"
        survey={survey}
        connection={connection}
        recent={[]}
        onOpenRecent={noop}
        onNavigate={noop}
        onLanding={noop}
        onUpload={noop}
        onEntry={noop}
      >
        <p>body</p>
      </AppShell>,
    );
    const strip = container.querySelector(".sd-connection") as HTMLElement;
    expect(strip.getAttribute("role")).toBe("status");
    expect(strip.getAttribute("aria-live")).toBe("polite");
    expect(strip.textContent).toContain("Service unreachable");
  });
});

describe("every control carries a name", () => {
  it("names every button and link on the results screen", () => {
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
    const unnamed = Array.from(container.querySelectorAll("button, a")).filter(
      (element) => accessibleName(element).length === 0,
    );
    expect(unnamed.map((element) => element.outerHTML.slice(0, 120))).toEqual([]);
  });

  it("names the source-frame strip cells, which carry no visible text", () => {
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
    const cells = Array.from(container.querySelectorAll(".sd-ws-cells button"));
    expect(cells.length).toBe(survey.frames.length);
    expect(cells.every((cell) => accessibleName(cell).startsWith("Source frame"))).toBe(true);
  });

  it("names map markers with the class and the coordinate they were placed from", () => {
    const geometry = {
      coastline: null,
      swath: null,
      gap: null,
      gapArea: null,
      cornerLabel: null,
      scaleLabel: null,
      track: [],
      markers: { [findings[0].detection_id]: [40, 50] as [number, number] },
    };
    const positioned = [{ ...findings[0], geo: { lat: 18.9, lon: 72.8 } }];
    const { container } = render(
      <MapScreen
        contacts={[]}
        findings={positioned}
        selected={positioned[0]}
        onSelect={noop}
        onOpenWorkspace={noop}
        mode="chart"
        onMode={noop}
        geometry={geometry}
        survey={survey}
        trackPoints={0}
      />,
    );
    const marker = container.querySelector(".sd-marker") as HTMLElement;
    expect(accessibleName(marker)).toMatch(/at 18\.9000° N, 72\.8000° E$/);
  });

  it("gives the sonar raster a description, not an empty alt", () => {
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
    const image = container.querySelector(".sd-frame-plate img") as HTMLImageElement;
    expect(image.getAttribute("alt")).toMatch(/Side-scan sonar window/);
  });
});

describe("progress is exposed as a value, never as decoration", () => {
  it("publishes the counted frame ratio on the processing screen", () => {
    const { container } = render(
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
    const bar = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute("aria-valuenow")).toBe(String(job.frames_completed));
    expect(bar.getAttribute("aria-valuemax")).toBe(String(job.source_frame_count));
    expect(bar.getAttribute("aria-label")).toBe("Source frames inferred");
  });

  it("publishes the review count on the review screen", () => {
    const { container } = render(
      <ReviewScreen
        survey={survey}
        queue={queue}
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
    const bar = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute("aria-valuemax")).toBe(String(survey.findings.length));
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(0);
  });
});

describe("the evidence ladder is keyboard-operable and progressive", () => {
  it("uses native disclosure elements, so every row opens without a mouse", () => {
    const { container } = render(
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
        rasterFor={() => null}
        onSendToReview={noop}
        onMap={noop}
      />,
    );
    const rows = Array.from(container.querySelectorAll(".sd-ev-row"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.tagName === "DETAILS")).toBe(true);
    expect(rows.every((row) => row.querySelector("summary") !== null)).toBe(true);
    // Closed on load, so the first view is readable rather than a wall of values.
    expect(rows.every((row) => !(row as HTMLDetailsElement).open)).toBe(true);
  });

  it("ties the disclosure control to the region it reveals", () => {
    const { container } = render(
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
        rasterFor={() => null}
        onSendToReview={noop}
        onMap={noop}
      />,
    );
    const control = container.querySelector(".sd-disclosure") as HTMLButtonElement;
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(`#${control.getAttribute("aria-controls")}`)).toBeTruthy();
  });
});

describe("scope controls describe the region they switch", () => {
  it("points each results tab at the list it controls", () => {
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
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs.length).toBe(2);
    for (const tab of tabs) {
      const controls = tab.getAttribute("aria-controls");
      expect(controls).toBe("sd-result-list");
      expect(container.querySelector(`#${controls}`)?.getAttribute("role")).toBe("tabpanel");
    }
  });
});

describe("keyboard verdicts respect text entry", () => {
  it("records a verdict from the shortcut key", () => {
    const onVerdict = vi.fn();
    render(
      <ReviewScreen
        survey={survey}
        queue={queue}
        index={0}
        onIndex={noop}
        onVerdict={onVerdict}
        pending={null}
        failed={null}
        rasterFor={() => null}
        onBackToFindings={noop}
        onGenerateReport={noop}
        onOpenMemory={noop}
        title="Is this finding real?"
      />,
    );
    fireEvent.keyDown(window, { key: "c" });
    expect(onVerdict).toHaveBeenCalledWith("CONFIRMED");
  });

  it("does not hijack a keystroke typed into a field", () => {
    const onVerdict = vi.fn();
    render(
      <>
        <input aria-label="notes" />
        <ReviewScreen
          survey={survey}
          queue={queue}
          index={0}
          onIndex={noop}
          onVerdict={onVerdict}
          pending={null}
          failed={null}
          rasterFor={() => null}
          onBackToFindings={noop}
          onGenerateReport={noop}
          onOpenMemory={noop}
          title="Is this finding real?"
        />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("notes"), { key: "r" });
    expect(onVerdict).not.toHaveBeenCalled();
  });

  it("leaves browser and OS shortcuts alone", () => {
    const onVerdict = vi.fn();
    render(
      <ReviewScreen
        survey={survey}
        queue={queue}
        index={0}
        onIndex={noop}
        onVerdict={onVerdict}
        pending={null}
        failed={null}
        rasterFor={() => null}
        onBackToFindings={noop}
        onGenerateReport={noop}
        onOpenMemory={noop}
        title="Is this finding real?"
      />,
    );
    fireEvent.keyDown(window, { key: "r", metaKey: true });
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    expect(onVerdict).not.toHaveBeenCalled();
  });
});

describe("status is never colour alone", () => {
  it("gives every review state a word", () => {
    for (const state of [null, "CONFIRMED", "REJECTED", "RELABELLED", "UNCERTAIN", "SOMETHING_NEW"]) {
      const badge = reviewBadge({ ...findings[0], review_state: state });
      expect(badge.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("labels every contact row's evidence band in words", () => {
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
    const bands = Array.from(container.querySelectorAll(".sd-finding-priority"));
    expect(bands.length).toBe(contacts.length);
    expect(bands.every((band) => (band.textContent ?? "").trim().length > 0)).toBe(true);
  });
});
