"use client";

import { Logo } from "../parts/Primitives";
import { BUTTONS, COPY, ROLES, TITLES } from "../runtime/strings";
import type { RoleId } from "../runtime/types";

/**
 * §5.2 Role entry — shell B, no chrome at all. The role card is the one place a
 * card is correct, because it is a choice object. The primary is disabled until
 * a role is picked and reads "Choose a workspace" while disabled.
 */
export function RoleEntryScreen({
  picked,
  onPick,
  onContinue,
  onUpload,
  onLanding,
}: {
  picked: RoleId | null;
  onPick: (role: RoleId) => void;
  onContinue: () => void;
  onUpload: () => void;
  onLanding: () => void;
}) {
  const pickedRole = ROLES.find((role) => role.id === picked);
  return (
    <div className="sd-root sd-entry">
      <div className="sd-entry-inner">
        <Logo />
        <h1>{TITLES.entry}</h1>
        <p className="sd-entry-sub">{COPY.entrySub}</p>

        <div className="sd-role-grid">
          {ROLES.map((role) => (
            <button
              key={role.id}
              type="button"
              className="sd-role-card"
              aria-pressed={picked === role.id}
              onClick={() => onPick(role.id)}
            >
              <div className="sd-role-card-head">
                <b>{role.name}</b>
                {picked === role.id ? <span>Selected</span> : null}
              </div>
              <p>{role.question}</p>
            </button>
          ))}
        </div>

        <div className="sd-entry-actions">
          <button
            type="button"
            className="sd-btn-primary"
            disabled={!pickedRole}
            onClick={onContinue}
          >
            {pickedRole ? `Continue as ${pickedRole.name}` : BUTTONS.chooseWorkspace}
          </button>
          <button type="button" className="sd-btn-secondary" onClick={onUpload}>
            {BUTTONS.uploadNewSurvey}
          </button>
          <a
            href="#"
            onClick={(event) => {
              event.preventDefault();
              onLanding();
            }}
          >
            {BUTTONS.backToOverview}
          </a>
        </div>

        <p className="sd-entry-note">{COPY.entryDisclaimer}</p>
      </div>
    </div>
  );
}
