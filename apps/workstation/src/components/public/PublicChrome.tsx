"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Wordmark } from "./Wordmark";

const links = [
  { href: "/", label: "Overview" },
  { href: "/problem", label: "The problem" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/technology", label: "Technology" },
];

export function PublicChrome() {
  const pathname = usePathname();
  return (
    <header className="public-chrome">
      <Wordmark />
      <nav aria-label="Public sections">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="public-link"
            aria-current={pathname === link.href ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="spacer">
        <span className="ref">Marine survey intelligence</span>
        <Link className="btn" href="/app">
          Enter platform
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
