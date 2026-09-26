import { useEffect, useState } from "react";
import { request } from "./api";
/** One read resource. Old survey responses cannot overwrite a newly selected resource. */
export function useRemote<T>(path: string | null) {
  const [revision, setRevision] = useState(0);
  const key = `${path}:${revision}`;
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>(
    { key: "" },
  );
  useEffect(() => {
    if (!path) return;
    let active = true;
    void request<T>(path)
      .then((data) => {
        if (active) setState({ key, data });
      })
      .catch((e) => {
        if (active) setState({ key, error: e.message });
      });
    return () => {
      active = false;
    };
  }, [path, key]);
  return {
    data: state.key === key ? state.data : undefined,
    error: state.key === key ? state.error : undefined,
    loading: !!path && state.key !== key,
    reload: () => setRevision((v) => v + 1),
  };
}
