import type { Provenance } from "@/lib/types";
import { PROVENANCE_TREATMENT, toProvenanceView } from "@/lib/view/provenance";
import type { ProvenanceView } from "@/lib/view/provenance";

/**
 * Renders one of the five provenance states with its own visual treatment.
 * Pass either a contract Provenance value or a ProvenanceView directly.
 */
export function ProvenanceBadge({
  value,
  className,
}: {
  value: Provenance | ProvenanceView | null | undefined;
  className?: string;
}) {
  const view = toProvenanceView(value as Provenance | null | undefined);
  const treatment = PROVENANCE_TREATMENT[view];
  return (
    <span
      className={className ? `provenance ${className}` : "provenance"}
      style={{ color: treatment.fg, background: treatment.bg }}
      title={treatment.description}
    >
      {treatment.label}
      <span className="sr-only">. {treatment.description}</span>
    </span>
  );
}
