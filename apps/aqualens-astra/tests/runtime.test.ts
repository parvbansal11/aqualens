import { describe, it, expect } from "vitest";
import { adaptSurvey } from "../src/lib/runtime/adapters";
import {
  representative,
  capabilities,
  position,
  canAccess,
  trackSegments,
} from "../src/lib/runtime/selectors";
import { epitomeNavigated } from "../src/fixtures/epitomeNavigated";
import { epitomeNoNavigation } from "../src/fixtures/epitomeNoNavigation";
import raw from "./fixtures/runtime-survey.json";
import type { RuntimeSurvey } from "../src/lib/runtime/wire";
const wire = raw as unknown as RuntimeSurvey;
describe("Scientific runtime boundary", () => {
  it("preserves raw model scores independently from evidence and display heuristics", () => {
    const survey = adaptSurvey(wire, "https://runtime.example/api/v1");
    expect(survey.observations[0].rawScore).toBe(
      wire.findings[0].raw_confidence,
    );
    expect(survey.contacts[0].evidence).toBe(wire.contacts?.[0].evidence_score);
    expect(survey.contacts[0].confidence).toBeNull();
    expect(survey.contacts[0].openSet?.score).toBe(
      wire.contacts?.[0].anomaly_score,
    );
  });
  it("preserves backend Contact confidence separately from evidence strength", () => {
    const contact = wire.contacts?.[0];
    expect(contact).toBeDefined();
    const confidence = 0.8542632243568578,
      evidenceStrength = 0.3591354172530657;
    const survey = adaptSurvey(
      {
        ...wire,
        contacts: [
          { ...contact!, confidence, evidence_strength: evidenceStrength },
          ...(wire.contacts?.slice(1) ?? []),
        ],
      },
      "",
    );
    expect(survey.contacts[0].confidence).toBe(confidence);
    expect(survey.contacts[0].evidence).toBe(evidenceStrength);
  });
  it("does not invent depth from altitude or the presence of navigation", () => {
    const s = adaptSurvey(wire, "");
    expect(capabilities(s).navigation).toBe(true);
    expect(capabilities(s).depth).toBe(false);
    expect(s.contacts.every((c) => c.position?.depthM === null)).toBe(true);
  });
  it("never calls overlapping windows temporal persistence", () => {
    const s = adaptSurvey(wire, "");
    expect(wire.contacts?.[0].persistence_evidence_type).toBe(
      "WINDOW_OVERLAP_ONLY",
    );
    expect(s.contacts[0].persistence).toBeNull();
    expect(capabilities(s).persistence).toBe(false);
  });
  it("rejects nonfinite and out-of-range positions while preserving zero", () => {
    expect(position(NaN, 1)).toBeNull();
    expect(position(91, 1)).toBeNull();
    expect(position(1, Infinity)).toBeNull();
    expect(position(0, 0, 0, 0)).toMatchObject({
      lat: 0,
      lon: 0,
      depthM: 0,
      heading: 0,
    });
    expect(position(1, 2, -1, 400)).toMatchObject({
      depthM: null,
      heading: null,
    });
  });
  it("does not fabricate Contacts from unfused observations", () => {
    const s = adaptSurvey({ ...wire, contacts: undefined }, "");
    expect(s.observations.length).toBeGreaterThan(0);
    expect(s.contacts).toEqual([]);
  });
  it("keeps explicit missing navigation out of primary capabilities", () => {
    const s = epitomeNoNavigation;
    expect(capabilities(s)).toMatchObject({
      navigation: false,
      depth: false,
      persistence: false,
      change: false,
    });
    expect(s.contacts.every((c) => c.position === null)).toBe(true);
  });
  it("gaps in supplied fixes never become invented track connections", () => {
    const s = {
      ...epitomeNavigated,
      track: [epitomeNavigated.track[0], null, epitomeNavigated.track[1]],
    };
    expect(trackSegments(s).map((s) => s.length)).toEqual([1, 1]);
  });
  it("orders track fixes by acquisition timestamps rather than ZIP entry order", () => {
    const frame = wire.frames[0];
    const s = adaptSurvey(
      {
        ...wire,
        frames: [2, 0, 1].map((n) => ({
          ...frame,
          frame_id: `F-${n}`,
          navigation: {
            ...frame.navigation!,
            latitude: 18.9 + n * 0.001,
            longitude: 72.8,
            timestamp_utc: `2026-01-01T00:00:0${n}Z`,
          },
        })),
      },
      "",
    );
    expect(trackSegments(s)[0].map((p) => p.id)).toEqual(["F-0", "F-1", "F-2"]);
  });
  it("leaves unordered navigation as isolated fixes", () => {
    const frames = wire.frames.slice(0, 2).map((f) => ({
      ...f,
      navigation: {
        ...f.navigation!,
        latitude: 18.9,
        longitude: 72.8,
        timestamp_utc: "",
      },
    }));
    const s = adaptSurvey({ ...wire, frames }, "");
    expect(trackSegments(s).map((segment) => segment.length)).toEqual([1, 1]);
  });
  it("rejects malformed survey envelopes", () => {
    expect(() => adaptSurvey({} as RuntimeSurvey, "")).toThrow(
      "incomplete survey",
    );
  });
  it("fixture raw detector outputs and model hashes remain absent", () => {
    for (const s of [epitomeNavigated, epitomeNoNavigation]) {
      expect(s.source).toBe("PRESENTATION");
      for (const o of s.observations) {
        expect(o.rawScore).toBeNull();
        expect(o.modelSha).toBeNull();
        expect(o.rawClass).toBeNull();
      }
    }
  });
});
describe("Representative observation contract", () => {
  const c = epitomeNavigated.contacts[0],
    obs = epitomeNavigated.observations;
  it("uses a valid designated observation before a higher score", () => {
    const list = obs.map((o, i) => ({ ...o, rawScore: i === 1 ? 0.9 : 0.1 }));
    expect(representative(c, list)?.id).toBe(c.bestObservationId);
  });
  it("falls back to the highest finite score, never NaN or Infinity", () => {
    const list = obs.map((o, i) => ({
      ...o,
      rawScore: i === 0 ? NaN : i === 1 ? 0.2 : Infinity,
    }));
    expect(
      representative({ ...c, bestObservationId: "missing" }, list)?.id,
    ).toBe("OBS-02");
  });
  it("keeps association order when scores are absent", () => {
    expect(
      representative({ ...c, bestObservationId: null }, [...obs].reverse())?.id,
    ).toBe(c.observationIds[0]);
  });
  it("retains a manual choice and does not adopt an unrelated observation", () => {
    expect(representative(c, obs, "OBS-02")?.id).toBe("OBS-02");
    expect(representative({ ...c, bestObservationId: "OBS-06" }, obs)?.id).toBe(
      "OBS-01",
    );
  });
});
describe("Exact role boundaries", () => {
  it("keeps all roles entering home and only analysts entering Contact inspection", () => {
    for (const r of ["field", "analyst", "supervisor", "decision"] as const) {
      expect(canAccess(r, "home")).toBe(true);
      expect(canAccess(r, "contact")).toBe(r === "analyst");
    }
    expect(canAccess("decision", "map")).toBe(false);
    expect(canAccess("field", "map")).toBe(true);
  });
});
