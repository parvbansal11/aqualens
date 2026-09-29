import { useEffect, useState } from "react";
import type { Contact, ContactQuery, EvidenceKey, MachineClass, Priority, ReviewStatus } from "../api/types";
import { api, ApiFailure } from "../api/client";
import { analystLabel, AVAILABILITY_LABEL, CLASS_LABEL, displayName, EVIDENCE_LABEL, PRIORITY_LABEL, shortTime } from "../api/labels";
import { hrefFor, navigate } from "../router";
import { contactName, useStore } from "../state/store";
import { Band, ContactThumb, Empty, Icon, machineLabel, Skeleton, StateGlyph, StatusMark } from "../components/ui";

const EV_KEYS: EvidenceKey[] = ["detector", "local_anomaly", "persistence", "raised_relief", "navigation"];

export function Contacts() {
  const { state, dispatch } = useStore();
  const missionId = state.mission?.mission_id ?? null;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ReviewStatus | "">("");
  const [machine, setMachine] = useState<MachineClass | "">("");
  const [analyst, setAnalyst] = useState("");
  const [priority, setPriority] = useState<Priority | "">("");
  const [survey, setSurvey] = useState("");
  const [sort, setSort] = useState<NonNullable<ContactQuery["sort"]>>("priority");
  const [rows, setRows] = useState<Contact[] | null>(null);
  const [total, setTotal] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(() => (matchMedia("(max-width: 860px)").matches ? null : state.selectedId));

  // The backend does the filtering. Contact updates elsewhere refresh this view.
  useEffect(() => {
    if (!missionId) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const page = await api.contacts(missionId, {
          search: search.trim() || undefined,
          status: status || undefined,
          machine_class: machine || undefined,
          analyst_class: analyst || undefined,
          priority: priority || undefined,
          survey_ref: survey || undefined,
          sort,
        });
        if (!live) return;
        setRows(page.items);
        setTotal(page.total);
        setProblem(null);
      } catch (e) {
        if (live) setProblem(e instanceof ApiFailure ? e.message : "Contacts could not be loaded.");
      }
    }, search ? 180 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [missionId, search, status, machine, analyst, priority, survey, sort, state.contacts]);

  if (!state.mission) return <Empty title="No mission open">Open a mission from the Overview.</Empty>;
  const clear = () => {
    setSearch("");
    setStatus("");
    setMachine("");
    setAnalyst("");
    setPriority("");
    setSurvey("");
  };
  const filtered = !!(search || status || machine || analyst || priority || survey);
  const current = (rows ?? []).find((c) => c.contact_id === preview) ?? null;

  return (
    <div className={`catalog ${current ? "catalog--preview" : ""}`}>
      <div className="catalog__main">
        <header className="page__head page__head--tight">
          <p className="page__eyebrow">Contacts</p>
          <h1 className="page__title">Evidence memory</h1>
        </header>

        <div className="filters" role="search">
          <label className="filters__search">
            <Icon name="search" size={14} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Contact ID" aria-label="Search by Contact ID" />
          </label>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus | "")} aria-label="Review status">
            <option value="">Any status</option>
            <option value="UNREVIEWED">Awaiting review</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="REJECTED">Rejected</option>
            <option value="UNRESOLVED">Unresolved</option>
          </select>
          <select className="select" value={machine} onChange={(e) => setMachine(e.target.value as MachineClass | "")} aria-label="Machine class">
            <option value="">Any machine class</option>
            {(state.provenance?.machine_classes ?? []).map((c) => (
              <option key={c} value={c}>
                Machine: {CLASS_LABEL[c]}
              </option>
            ))}
          </select>
          <select className="select" value={analyst} onChange={(e) => setAnalyst(e.target.value)} aria-label="Analyst classification">
            <option value="">Any analyst classification</option>
            {(state.provenance?.analyst_classes ?? []).map((c) => (
              <option key={c} value={c}>
                Analyst: {analystLabel(c)}
              </option>
            ))}
          </select>
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Priority | "")} aria-label="Priority">
            <option value="">Any priority</option>
            {(["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNSET"] as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
          {state.surveys.length > 1 && (
            <select className="select" value={survey} onChange={(e) => setSurvey(e.target.value)} aria-label="Survey">
              <option value="">All Surveys</option>
              {state.surveys.map((s) => (
                <option key={s.survey_id} value={s.survey_ref}>
                  {displayName(s.name, s.survey_ref)}
                </option>
              ))}
            </select>
          )}
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as NonNullable<ContactQuery["sort"]>)} aria-label="Sort">
            <option value="priority">By priority</option>
            <option value="reviewed">Recently reviewed</option>
            <option value="created">Newest</option>
          </select>
          <span className="filters__count">
            {rows ? total : "…"} of {state.contacts.length}
          </span>
        </div>

        {problem ? (
          <Empty title="Contacts unavailable" action={<button className="btn" onClick={clear}>Try again</button>}>
            {problem}
          </Empty>
        ) : rows === null ? (
          <Skeleton lines={5} wide />
        ) : rows.length === 0 ? (
          <Empty title={filtered ? "No Contacts match" : "No Contacts yet"} action={filtered ? <button className="btn" onClick={clear}>Clear filters</button> : undefined}>
            {filtered ? "Nothing in this mission fits the current filters." : "Contacts appear here once sonar has been processed."}
          </Empty>
        ) : (
          <table className="table table--catalog">
            <thead>
              <tr>
                <th aria-label="Thumbnail" />
                <th>Contact</th>
                <th>Machine</th>
                <th>Analyst</th>
                <th>Evidence</th>
                <th>Priority</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Row key={c.contact_id} contact={c} selected={c.contact_id === preview} onPreview={() => (setPreview(c.contact_id), dispatch({ type: "select", id: c.contact_id }))} />
              ))}
            </tbody>
          </table>
        )}
        <p className="catalog__legend">
          Evidence order: detector, local anomaly, persistence, raised relief, navigation. Filled is available, half is not yet validated or synthetic, hollow is unavailable.
        </p>
      </div>

      {current && <Preview contact={current} onClose={() => setPreview(null)} />}
    </div>
  );
}

function Row({ contact: c, selected, onPreview }: { contact: Contact; selected: boolean; onPreview: () => void }) {
  const { imagery } = useStore();
  return (
    <tr
      className={selected ? "is-selected" : ""}
      tabIndex={0}
      onClick={onPreview}
      onDoubleClick={() => navigate(hrefFor("review", c.contact_id))}
      onKeyDown={(e) => {
        if (e.key === "Enter") navigate(hrefFor("review", c.contact_id));
        if (e.key === " ") (e.preventDefault(), onPreview());
      }}
      aria-label={`${contactName(c)}, ${machineLabel(c)}, ${c.analyst.status === "UNREVIEWED" ? "awaiting review" : "reviewed"}`}
    >
      <td className="cell-thumb">
        <ContactThumb imagery={imagery(c)} />
      </td>
      <td className="strong">{contactName(c)}</td>
      <td>
        <span className={c.machine ? "tag-detector" : "tag-anomaly"}>{machineLabel(c)}</span>
      </td>
      <td>{c.analyst.classification !== "UNRESOLVED" ? <span className="analyst-label">{analystLabel(c.analyst.classification)}</span> : <span className="muted">Not classified</span>}</td>
      <td>
        <span className="ev-strip">
          {EV_KEYS.map((k) => {
            const ev = c.evidence[k];
            const st = ev.provenance === "SYNTHETIC_DEMO" ? "NOT_VALIDATED" : ev.status;
            const label = `${EVIDENCE_LABEL[k]}: ${ev.provenance === "SYNTHETIC_DEMO" ? "synthetic demo" : AVAILABILITY_LABEL[ev.status]}`;
            return (
              <span key={k} title={label} aria-label={label}>
                <StateGlyph state={st} />
              </span>
            );
          })}
        </span>
      </td>
      <td>
        <Band priority={c.analyst.priority} />
      </td>
      <td>
        <StatusMark status={c.analyst.status} />
      </td>
    </tr>
  );
}

function Preview({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { imagery, state } = useStore();
  const img = imagery(contact);
  const survey = state.surveys.find((s) => contact.survey_refs.includes(s.survey_ref));
  return (
    <aside className="preview" aria-label={`${contactName(contact)} preview`} key={contact.contact_id}>
      <header className="preview__head">
        <h2>{contactName(contact)}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close preview">
          <Icon name="close" />
        </button>
      </header>
      {img && (
        <div className="preview__img" style={{ viewTransitionName: "contact-stage" }}>
          <ContactThumb imagery={img} pad={2.4} mark />
          {img.illustrative && <span className="preview__illus">Illustrative imagery</span>}
        </div>
      )}
      <dl className="facts">
        <div>
          <dt>Machine</dt>
          <dd>
            {contact.machine
              ? `${machineLabel(contact)} · detector score ${contact.machine.raw_detector_score.toFixed(2)}${contact.machine.demo ? " (fixture value)" : ""}`
              : `Local anomaly · ${AVAILABILITY_LABEL[contact.evidence.local_anomaly.status].toLowerCase()}`}
          </dd>
        </div>
        <div>
          <dt>Analyst</dt>
          <dd>{contact.analyst.status === "UNREVIEWED" ? "Not reviewed" : `${analystLabel(contact.analyst.classification)} · ${shortTime(contact.analyst.reviewed_at)}`}</dd>
        </div>
        <div>
          <dt>Survey</dt>
          <dd>{survey ? displayName(survey.name, survey.survey_ref) : "Unavailable"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <StatusMark status={contact.analyst.status} />
          </dd>
        </div>
      </dl>
      <button className="btn btn--primary" onClick={() => navigate(hrefFor("review", contact.contact_id))}>
        Open in Review <Icon name="arrowRight" size={14} />
      </button>
    </aside>
  );
}
