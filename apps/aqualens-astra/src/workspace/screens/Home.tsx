import { useState } from "react";
import { hrefFor, navigate } from "../router";
import { contactName, isReviewed, useStore } from "../state/store";
import { analystLabel, displayName, shortTime } from "../api/labels";
import { api, ApiFailure } from "../api/client";
import { Band, ContactThumb, DemoTag, Empty, Icon, machineLabel, StatusMark } from "../components/ui";

export function Home() {
  const { state, queue, imagery, openMission } = useStore();
  if (state.phase === "no-mission" || !state.mission) return <NoMission />;

  const mission = state.mission;
  const role = state.role!;
  const awaiting = queue.filter((c) => !isReviewed(c));
  const reviewed = state.contacts.length - awaiting.length;
  const attention = state.contacts.filter((c) => c.analyst.priority === "CRITICAL" || c.analyst.priority === "HIGH");
  const processing = state.uploads.filter((u) => u.status === "INGESTING" || u.status === "PENDING").length;
  const total = state.contacts.length;

  const primary =
    role.id === "sonar-analyst" || (role.id === "field-officer" && awaiting.length)
      ? { label: awaiting.length ? "Review next Contact" : "Open Review", go: () => navigate(hrefFor("review", awaiting[0]?.contact_id)) }
      : role.id === "mission-supervisor"
        ? { label: "Open mission report", go: () => navigate(hrefFor("report")) }
        : role.id === "field-officer"
          ? { label: "Continue mission", go: () => navigate(hrefFor("mission")) }
          : { label: attention.length ? "See what needs attention" : "Open mission report", go: () => navigate(attention.length ? hrefFor("contacts") : hrefFor("report")) };

  return (
    <div className="home">
      <header className="home__head">
        <p className="home__eyebrow">{role.question}</p>
        <h1 className="home__title">{displayName(mission.name, "Mission")}</h1>
        <p className="home__meta">
          {mission.demo && <DemoTag>Demo mission</DemoTag>}
          <span>
            {state.surveys.length} Survey{state.surveys.length === 1 ? "" : "s"}
          </span>
          <span>
            {total} Contact{total === 1 ? "" : "s"}
          </span>
          <span>{awaiting.length} awaiting review</span>
          {processing > 0 && <span>{processing} processing</span>}
        </p>
        {total > 0 && (
          <div className="home__progress" role="img" aria-label={`${reviewed} of ${total} Contacts reviewed`}>
            <i style={{ width: `${(reviewed / total) * 100}%` }} />
          </div>
        )}
        <div className="home__actions">
          <button className="btn btn--primary btn--lg" onClick={primary.go}>
            {primary.label} <Icon name="arrowRight" size={14} />
          </button>
          <button className="btn btn--plain" onClick={() => navigate(hrefFor("mission"))}>
            <Icon name="folder" size={14} /> Mission
          </button>
          {/* The demo is reached only by choosing it; a real Mission's overview does not offer it. */}
          {mission.demo && (
            <button className="btn btn--plain" onClick={() => openMission("live", null)}>
              <Icon name="swap" size={14} /> Open survey records
            </button>
          )}
        </div>
      </header>

      <div className="home__cols">
        <section aria-labelledby="h-next">
          <h2 id="h-next" className="home__h">
            {role.id === "decision-viewer" ? "Needs attention" : "Awaiting review"}
          </h2>
          {(role.id === "decision-viewer" ? attention : awaiting).length === 0 ? (
            <p className="muted">{role.id === "decision-viewer" ? "No Contact is marked critical or high by an analyst." : "Every Contact has an analyst verdict."}</p>
          ) : (
            <ul className="list">
              {(role.id === "decision-viewer" ? attention : awaiting).slice(0, 5).map((c) => (
                <li key={c.contact_id}>
                  <button className="list__row" onClick={() => navigate(hrefFor("review", c.contact_id))}>
                    <span className="list__thumb">
                      <ContactThumb imagery={imagery(c)} />
                    </span>
                    <span className="list__main">
                      <span className="list__title">{contactName(c)}</span>
                      <span className="list__sub">
                        {machineLabel(c)}
                        {isReviewed(c) ? ` · analyst: ${analystLabel(c.analyst.classification)}` : ""}
                      </span>
                    </span>
                    {role.id === "decision-viewer" ? <Band priority={c.analyst.priority} /> : <StatusMark status={c.analyst.status} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="h-surveys">
          <h2 id="h-surveys" className="home__h">
            Surveys
          </h2>
          {state.surveys.length === 0 ? (
            <p className="muted">No Survey yet. Upload sonar from the Mission view.</p>
          ) : (
            <ul className="list">
              {state.surveys.map((s) => {
                const cs = state.contacts.filter((c) => c.survey_refs.includes(s.survey_ref));
                const open = cs.filter((c) => !isReviewed(c)).length;
                return (
                  <li key={s.survey_id}>
                    <button className="list__row" onClick={() => navigate(hrefFor("mission"))}>
                      <span className="list__main">
                        <span className="list__title">{displayName(s.name, s.survey_ref)}</span>
                        <span className="list__sub">
                          {s.frames.length ? `${s.frames.length} Frame${s.frames.length === 1 ? "" : "s"} · ` : ""}
                          {cs.length ? `${cs.length} Contacts, ${open} awaiting` : "No Contacts proposed"}
                        </span>
                      </span>
                      <Icon name="chevronRight" size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <footer className="home__foot">
        {mission.demo ? (
          <span>Deterministic demo mission from the Aqualens service. Its detector scores and positions are fixture values, not survey evidence.</span>
        ) : (
          <span>Created {shortTime(mission.created_at)}. Records from the Aqualens service.</span>
        )}
      </footer>
    </div>
  );
}

/** No Mission yet: create one for real sonar, or open the demo. */
function NoMission() {
  const { state, openMission, notify } = useStore();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const m = await api.createMission(name.trim());
      openMission("live", m.mission_id);
      navigate(hrefFor("mission"));
    } catch (e) {
      notify(e instanceof ApiFailure ? e.message : "The mission was not created.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="home">
      <Empty
        title="No survey mission yet"
        action={
          <div className="stack">
            <form
              className="row gap"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <input className="field field--inline" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mission name" aria-label="Mission name" maxLength={160} />
              <button className="btn btn--primary" disabled={!name.trim() || busy}>
                <Icon name="plus" size={14} /> New mission
              </button>
            </form>
            <button className="link" onClick={() => openMission("demo", null)}>
              Open the demo mission instead
            </button>
          </div>
        }
      >
        {state.missions.length ? "Choose a mission from the working view menu, or start a new one." : "Create a mission, then upload sonar from the Mission view."}
      </Empty>
    </div>
  );
}
