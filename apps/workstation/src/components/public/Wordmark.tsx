import Link from "next/link";

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link className="wordmark" href={href}>
      <span className="mark" aria-hidden="true" />
      <span>
        <strong>Aqualens</strong>
        <em>Side-scan analysis</em>
      </span>
    </Link>
  );
}
