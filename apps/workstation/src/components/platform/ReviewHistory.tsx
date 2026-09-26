import type { Review } from "@/lib/types";
import { timestamp } from "@/lib/view/format";
import { CLASS_LABELS } from "@/lib/view/labels";

/**
 * Append-only history for one detection.
 *
 * Events are rendered newest first but never merged or deduplicated. A verdict
 * that contradicts an earlier one appears as an additional row, because the
 * earlier judgement is part of the record.
 */
export function ReviewHistory({ reviews }: { reviews: Review[] }) {
  const ordered = [...reviews].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div className="review-history">
      <h4>Append-only history</h4>
      {ordered.length === 0 ? (
        <p style={{ margin: 0, color: "var(--text-2)", fontSize: 13 }}>No prior review events.</p>
      ) : (
        ordered.map((review) => (
          <div key={review.review_id}>
            <b>{review.verdict}</b>
            <span>
              {review.reviewer}
              {review.corrected_class && `, relabelled to ${CLASS_LABELS[review.corrected_class]}`}
            </span>
            <time dateTime={review.created_at}>{timestamp(review.created_at)}</time>
            {review.notes && <small style={{ color: "var(--text-2)" }}>{review.notes}</small>}
            {!review.training_eligible && (
              <small>
                Not eligible for training: {review.training_eligible_reason ?? "UNSPECIFIED"}
              </small>
            )}
          </div>
        ))
      )}
    </div>
  );
}
