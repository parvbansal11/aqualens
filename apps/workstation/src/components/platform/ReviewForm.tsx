"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import type { ReviewVerdict, UnifiedClass } from "@/lib/types";
import type { ReviewInput } from "@/lib/services";
import { CLASS_LABELS, VERDICT_LABELS, VERDICT_SHORTCUT } from "@/lib/view/labels";

const VERDICTS: ReviewVerdict[] = ["CONFIRMED", "REJECTED", "RELABELLED", "UNCERTAIN"];

const RELABEL_CLASSES = (Object.keys(CLASS_LABELS) as UnifiedClass[]).filter(
  (value) => value !== "UNKNOWN_ANOMALY_CANDIDATE",
);

/**
 * Operator verdict entry.
 *
 * Submission is delegated upward. This component never calls the service
 * directly, so a page can decide whether a verdict is optimistic, queued, or
 * blocked while the API is unreachable.
 *
 * RELABELLED requires a corrected class, and the form opens the selector on the
 * first press rather than submitting with a default.
 */
export function ReviewForm({
  detectionId,
  onSubmit,
  submitting,
  message,
  reviewer,
}: {
  detectionId: string;
  onSubmit: (input: ReviewInput) => void;
  submitting: ReviewVerdict | null;
  message: string | null;
  reviewer: string;
}) {
  const [notes, setNotes] = useState("");
  const [correctedClass, setCorrectedClass] = useState<UnifiedClass>("WRECK_OR_STRUCTURAL_DEBRIS");
  const [relabelOpen, setRelabelOpen] = useState(false);
  const [subject, setSubject] = useState(detectionId);

  // A new detection is a new judgement: the draft note and the relabel panel
  // reset during render rather than in an effect, so no stale draft is ever
  // shown against the wrong detection for a frame.
  if (subject !== detectionId) {
    setSubject(detectionId);
    setNotes("");
    setRelabelOpen(false);
  }

  function submit(verdict: ReviewVerdict) {
    if (submitting) return;
    if (verdict === "RELABELLED" && !relabelOpen) {
      setRelabelOpen(true);
      return;
    }
    onSubmit({
      verdict,
      corrected_class: verdict === "RELABELLED" ? correctedClass : undefined,
      notes,
      reviewer,
    });
    setNotes("");
    setRelabelOpen(false);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const byKey: Record<string, ReviewVerdict> = {
        c: "CONFIRMED",
        r: "REJECTED",
        l: "RELABELLED",
        u: "UNCERTAIN",
      };
      const verdict = byKey[event.key.toLowerCase()];
      if (verdict) {
        event.preventDefault();
        submit(verdict);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // The shortcut handler intentionally closes over the current form state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectionId, notes, correctedClass, relabelOpen, submitting]);

  return (
    <section className="inspector-section review-form">
      <h3>Operator review</h3>

      {relabelOpen && (
        <label htmlFor="corrected-class">
          Corrected class
          <select
            id="corrected-class"
            value={correctedClass}
            onChange={(event) => setCorrectedClass(event.target.value as UnifiedClass)}
          >
            {RELABEL_CLASSES.map((value) => (
              <option key={value} value={value}>
                {CLASS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      )}

      <label htmlFor="review-notes">
        Review notes
        <textarea
          id="review-notes"
          rows={2}
          value={notes}
          placeholder="Optional operator observation"
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>

      <div className="verdict-grid">
        {VERDICTS.map((verdict) => (
          <button
            key={verdict}
            type="button"
            className={`verdict verdict-${verdict.toLowerCase()}`}
            disabled={submitting !== null}
            onClick={() => submit(verdict)}
          >
            {verdict === "CONFIRMED" && <Check size={14} aria-hidden="true" />}
            {verdict === "REJECTED" && <X size={14} aria-hidden="true" />}
            {submitting === verdict ? "Recording" : VERDICT_LABELS[verdict]}
            <kbd>{VERDICT_SHORTCUT[verdict]}</kbd>
          </button>
        ))}
      </div>

      {message && (
        <p className="inline-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
