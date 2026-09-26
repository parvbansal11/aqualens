import type { PropsWithChildren } from "react";
import { PublicChrome } from "./PublicChrome";
import { PublicFooter } from "./PublicFooter";

/**
 * Wrapper for the four public pages.
 *
 * This is a component rather than a Next route group layout so the export can
 * be inspected as a flat file tree. If you prefer the idiomatic structure, move
 * the four public pages into an app/(public)/ route group and turn this file
 * into that group's layout.tsx. The markup does not change.
 */
export function PublicShell({ children }: PropsWithChildren) {
  return (
    <div className="public-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <PublicChrome />
      <main id="main-content">{children}</main>
      <PublicFooter />
    </div>
  );
}
