import { linkTo } from "../../lib/nav";

/** The AQUALENS wordmark: branding that also leads home to the landing page. Navigation only. */
export function HomeMark({ className }: { className: string }) {
  return (
    <a className={`home-mark ${className}`} href="/" onClick={linkTo("/")} aria-label="Aqualens home">
      AQUALENS
    </a>
  );
}
