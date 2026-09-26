import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";

export interface AsyncState {
  loading: boolean;
  error: string | null;
}

/**
 * Loading, error and empty handling for every operational screen.
 *
 * The error branch never substitutes fixture data. When the API is unreachable
 * the screen says so, because a plausible looking detection is worse than an
 * empty screen.
 */
export function StateBoundary({
  state,
  isEmpty,
  emptyTitle,
  emptyBody,
  emptyAction,
  skeletonHeight = 200,
  children,
}: {
  state: AsyncState;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  emptyAction?: ReactNode;
  skeletonHeight?: number;
  children: ReactNode;
}) {
  if (state.loading) {
    return <div className="skeleton" style={{ height: skeletonHeight, marginTop: 18 }} aria-busy="true" />;
  }
  if (state.error) {
    return (
      <div className="error-state" role="alert">
        <AlertCircle size={18} aria-hidden="true" />
        <div>
          <b>Data source unavailable</b>
          <p>{state.error}</p>
          <p>No substitute values have been rendered in place of the missing data.</p>
        </div>
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="empty-state">
        <strong>{emptyTitle ?? "Nothing to show"}</strong>
        {emptyBody && <p>{emptyBody}</p>}
        {emptyAction}
      </div>
    );
  }
  return <>{children}</>;
}
