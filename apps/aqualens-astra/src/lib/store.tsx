import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  RoleId,
  Survey,
  UploadSelection,
  RuntimeJob,
  SurveySummary,
  UploadAccepted,
} from "./runtime/types";
import { isRole } from "./runtime/selectors";
import * as api from "./runtime/api";
import { epitomeNavigated } from "../fixtures/epitomeNavigated";
import { epitomeNoNavigation } from "../fixtures/epitomeNoNavigation";
const fixtures = { epitomeNavigated, epitomeNoNavigation };
const read = (key: string) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* Browser storage may be disabled. */
  }
};
function useStoreState() {
  const [role, setRoleState] = useState<RoleId | null>(() => {
    const v = read("astra.role");
    return isRole(v) ? v : null;
  });
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    read("astra.theme") === "dark" ? "dark" : "light",
  );
  const [survey, setSurvey] = useState<Survey | null>(
    () => fixtures[read("astra.survey") as keyof typeof fixtures] ?? null,
  );
  const [selection, setSelection] = useState<UploadSelection | null>(null);
  const [pendingFilename, setPendingFilename] = useState(
    () => read("astra.filename") ?? "",
  );
  const [job, setJob] = useState<RuntimeJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(() => read("astra.job"));
  const [jobSurveyId, setJobSurveyId] = useState<string | null>(() =>
    read("astra.jobSurvey"),
  );
  const [connection, setConnection] = useState(
    api.configured ? "Checking service" : "Detached preview",
  );
  const [recent, setRecent] = useState<SurveySummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [surveyLoading, setSurveyLoading] = useState(
    () =>
      !!read("astra.survey") &&
      !Object.hasOwn(fixtures, read("astra.survey")!) &&
      api.configured,
  );
  const [manualObservations, setManualObservations] = useState<
    Record<string, string>
  >(() => {
    try {
      const value: unknown = JSON.parse(read("astra.observations") ?? "{}");
      return value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).filter(([, id]) => typeof id === "string"),
          )
        : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    write("astra.observations", JSON.stringify(manualObservations));
  }, [manualObservations]);
  const preview = useRef<string | null>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    write("astra.theme", theme);
  }, [theme]);
  useEffect(() => {
    if (preview.current && preview.current !== selection?.preview)
      URL.revokeObjectURL(preview.current);
    preview.current = selection?.preview ?? null;
  }, [selection]);
  useEffect(
    () => () => {
      if (preview.current) URL.revokeObjectURL(preview.current);
    },
    [],
  );
  useEffect(() => {
    if (!api.configured) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function probe() {
      try {
        const h = await api.health();
        if (live)
          setConnection(
            // The frozen detector loads lazily in the accepted job's detector_ready phase.
            h.runtime_available
              ? "Service connected"
              : "Analysis service not ready",
          );
      } catch {
        if (live) setConnection("Local analysis service offline");
      }
      try {
        const list = await api.recentSurveys();
        if (live)
          setRecent(
            list.items.map((s) => ({
              id: s.survey_id,
              name: s.name,
              frames: s.frame_count,
              observations: s.finding_count,
              contacts: s.contact_count,
              createdAt: s.created_at,
            })),
          );
      } catch {
        /* A failed index read must not erase a healthy detector or active survey. */
      }
      if (live) timer = setTimeout(probe, 10000);
    }
    void probe();
    const stored = read("astra.survey");
    if (stored && !Object.hasOwn(fixtures, stored))
      api
        .getSurvey(stored)
        .then((s) => {
          if (live) setSurvey(s);
        })
        .catch((e) => {
          if (live) setLoadError(e.message);
        })
        .finally(() => {
          if (live) setSurveyLoading(false);
        });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  function setRole(value: RoleId) {
    setRoleState(value);
    write("astra.role", value);
  }
  async function openSurvey(id: string) {
    setLoadError(null);
    const fixture = fixtures[id as keyof typeof fixtures];
    try {
      const next = fixture ?? (await api.getSurvey(id));
      setSurvey(next);
      write("astra.survey", id);
      return true;
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Survey could not be opened.",
      );
      return false;
    }
  }
  function rememberJob(accepted: UploadAccepted, filename: string) {
    setJob(null);
    setJobId(accepted.job_id);
    setJobSurveyId(accepted.survey_id);
    setPendingFilename(filename);
    // The accepted real job owns the next result. A previously open demo cannot remain its survey.
    setSurvey(null);
    write("astra.survey", "");
    write("astra.job", accepted.job_id);
    write("astra.jobSurvey", accepted.survey_id);
    write("astra.filename", filename);
  }
  function completeJob(next: Survey) {
    if (next.source !== "RUNTIME" || (jobSurveyId && next.id !== jobSurveyId))
      throw new Error(
        "The completed record does not belong to this runtime upload.",
      );
    setSurvey(next);
    setRecent((items) => [
      {
        id: next.id,
        name: next.name,
        contacts: next.contacts.length,
        frames: next.frames.length,
        observations: next.observations.length,
        createdAt: next.createdAt,
      },
      ...items.filter((s) => s.id !== next.id),
    ]);
    setJobId(null);
    setJobSurveyId(null);
    write("astra.survey", next.id);
    write("astra.job", "");
    write("astra.jobSurvey", "");
  }
  function chooseObservation(contactId: string, id: string) {
    setManualObservations((v) => ({
      ...v,
      [`${survey?.id}/${contactId}`]: id,
    }));
  }
  return {
    role,
    setRole,
    theme,
    toggleTheme: () => setTheme((t) => (t === "light" ? "dark" : "light")),
    survey,
    openSurvey,
    selection,
    setSelection,
    job,
    setJob,
    jobId,
    jobSurveyId,
    rememberJob,
    completeJob,
    pendingFilename,
    connection,
    recent,
    loadError,
    surveyLoading,
    manualObservations,
    chooseObservation,
  };
}
const Store = createContext<ReturnType<typeof useStoreState> | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreState();
  return <Store.Provider value={value}>{children}</Store.Provider>;
}
// Context hook deliberately co-located with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace() {
  const store = useContext(Store);
  if (!store) throw new Error("Workspace provider is missing.");
  return store;
}
