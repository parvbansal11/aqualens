"use client";

import { BUTTONS, TITLES } from "../runtime/strings";

/** §6 Permission — a plain page, never a partial screen. */
export function PermissionScreen({ onChangeWorkspace }: { onChangeWorkspace: () => void }) {
  return (
    <section className="sd-permission">
      <h1>{TITLES.permission}</h1>
      <p>
        This view belongs to a different workspace. Change workspace to reach it, or use the
        navigation for the workspace you hold.
      </p>
      <button type="button" className="sd-btn-secondary" onClick={onChangeWorkspace}>
        {BUTTONS.changeWorkspace}
      </button>
    </section>
  );
}
