import type { Provenance } from "@/lib/types";

/**
 * Presentation only. Adds no semantics to the contract.
 *
 * The contract's Provenance union uses "NONE" for a value that has no source.
 * The UI presents that case as UNAVAILABLE, because "none" reads as an absence
 * of provenance rather than an absence of a value. ProvenanceView is the
 * display vocabulary; Provenance stays the wire vocabulary.
 */
export type ProvenanceView =
  | "MODEL_DERIVED"
  | "HEURISTIC_DERIVED"
  | "OPERATOR_PROVIDED"
  | "DEMO_METADATA"
  | "UNAVAILABLE";

export function toProvenanceView(value: Provenance | null | undefined): ProvenanceView {
  if (!value || value === "NONE") return "UNAVAILABLE";
  return value;
}

export interface ProvenanceTreatment {
  label: string;
  fg: string;
  bg: string;
  /** Read out by screen readers in place of the abbreviated label. */
  description: string;
}

export const PROVENANCE_TREATMENT: Record<ProvenanceView, ProvenanceTreatment> = {
  MODEL_DERIVED: {
    label: "MODEL_DERIVED",
    fg: "var(--ice)",
    bg: "var(--ice-soft)",
    description: "Produced by a model version recorded on this detection.",
  },
  HEURISTIC_DERIVED: {
    label: "HEURISTIC_DERIVED",
    fg: "var(--wheat)",
    bg: "var(--wheat-soft)",
    description: "Computed by a documented rule or weighted score, not learned.",
  },
  OPERATOR_PROVIDED: {
    label: "OPERATOR_PROVIDED",
    fg: "var(--mint)",
    bg: "var(--mint-soft)",
    description: "Entered by a named operator and stored as an append-only event.",
  },
  DEMO_METADATA: {
    label: "DEMO_METADATA",
    fg: "var(--unknown)",
    bg: "var(--unknown-soft)",
    description: "Demo metadata. Not measured mission data.",
  },
  UNAVAILABLE: {
    label: "UNAVAILABLE",
    fg: "var(--text-3)",
    bg: "var(--raise)",
    description: "No source. The value is absent and a reason is given alongside.",
  },
};
