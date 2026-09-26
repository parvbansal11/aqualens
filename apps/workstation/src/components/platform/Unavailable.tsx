import { AlertTriangle } from "lucide-react";

/**
 * The single component for "this value does not exist".
 *
 * A reason is required. There is no variant of this component that renders a
 * blank, a dash, or a zero, because the contract guarantees a machine readable
 * reason wherever a value is null.
 */
export function Unavailable({ reason, label = "Not computable" }: { reason: string | null; label?: string }) {
  return (
    <p className="unavailable" role="note">
      <AlertTriangle size={13} aria-hidden="true" />
      <span>
        {label}: <code>{reason ?? "UNSPECIFIED"}</code>
      </span>
    </p>
  );
}
