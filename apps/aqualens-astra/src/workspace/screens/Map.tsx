import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as maplibregl from "maplibre-gl";
import type { LngLatBoundsLike, Map as MLMap, MapStyleImageMissingEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// Vite bundles MapLibre's worker (with its shared chunk) and serves it from our own origin.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { hrefFor, navigate } from "../router";
import { contactName, isReviewed, queueOrder, useStore } from "../state/store";
import { api, ApiFailure } from "../api/client";
import type { Contact, MapFeature, MapResponse } from "../api/types";
import { analystLabel, displayName, PRIORITY_LABEL, PRIORITY_RANK, STATUS_LABEL } from "../api/labels";
import { Band, ContactThumb, Empty, Icon, machineLabel, Skeleton, StatusMark } from "../components/ui";
import { arrowImage, ATTRIBUTION, buildStyle, DEPTH_STOPS, depthColors, type Layers, type MapTheme } from "../map/style";
import { depthAt, type DepthContext } from "../map/depth";
import { seaLevel, type SeaLevel } from "../map/tide";

/**
 * Mission Map. The geography is real (OpenFreeMap, Terrain Tiles); the track is the navigation
 * supplied with the survey; Contacts are the backend's own records. A Contact with no position of its
 * own is drawn at the track point of the frame it was observed in, and the inspector says so.
 */

maplibregl.setWorkerUrl(workerUrl);

const VIEW_KEY = "aqualens.map.view";
export const MAP_RETURN_KEY = "aqualens.map.return";
/** Below this zoom individual Contacts merge into one mission marker. */
const DETAIL_ZOOM = 9.5;
/** 3D vertical exaggeration. Ocean-basin relief is kilometres deep across hundreds of kilometres. */
export const VERTICAL_EXAGGERATION = 30;

interface Placed {
  contact: Contact;
  lon: number;
  lat: number;
  basis: "recorded" | "frame";
  frame: string | null;
  survey: string | null;
  fan: number;
}
type LayerState = Layers & { contacts: boolean };
interface SavedView {
  missionId: string;
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  selected: string | null;
  rail: boolean;
  layers: LayerState;
  mode: "2d" | "3d";
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const readView = (): SavedView | null => {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "null");
  } catch {
    return null;
  }
};
const writeView = (v: SavedView) => {
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* camera memory is a convenience */
  }
};

/** The workspace theme, read from the document the Shell styles. */
function useWsTheme(): MapTheme {
  return useSyncExternalStore(
    (fn) => {
      const o = new MutationObserver(fn);
      o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ws-theme"] });
      return () => o.disconnect();
    },
    () => (document.documentElement.dataset.wsTheme === "light" ? "light" : "dark"),
  );
}

const key = (survey?: string | null, frame?: string | null) => `${survey}|${frame}`;

/** Where each Contact goes: its own recorded position, else its frame's point on the supplied track. */
function place(geo: MapResponse, contacts: Contact[]) {
  const own = new Map(geo.features.filter((f) => f.properties.contact_id).map((f) => [f.properties.contact_id!, f]));
  const fixes = new Map(geo.platform_context.map((f) => [key(f.properties.survey_ref, f.properties.frame_ref), f]));
  const crowd = new Map<string, number>();
  const placed: Placed[] = [];
  for (const contact of contacts) {
    const f = own.get(contact.contact_id);
    if (f) {
      placed.push({ contact, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], basis: "recorded", frame: contact.detections[0]?.source_image ?? null, survey: contact.survey_refs[0] ?? null, fan: 0 });
      continue;
    }
    const d = contact.detections.find((x) => fixes.has(key(x.survey_ref, x.frame_ref)));
    if (!d) continue;
    const k = key(d.survey_ref, d.frame_ref);
    const fan = crowd.get(k) ?? 0;
    crowd.set(k, fan + 1);
    const fix = fixes.get(k)!;
    placed.push({ contact, lon: fix.geometry.coordinates[0], lat: fix.geometry.coordinates[1], basis: "frame", frame: d.source_image || d.frame_ref, survey: d.survey_ref, fan });
  }
  return placed;
}

const sortedFixes = (geo: MapResponse) =>
  [...geo.platform_context].sort((a, b) => (a.properties.timestamp_utc ?? "").localeCompare(b.properties.timestamp_utc ?? "") || `${a.properties.survey_ref}`.localeCompare(`${b.properties.survey_ref}`));

function bounds(points: [number, number][]): [[number, number], [number, number]] {
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}
/** The regional frame around the mission: at least a sea-basin's extent, centred on the mission. */
function region(b: [[number, number], [number, number]]): [[number, number], [number, number]] {
  const cx = (b[0][0] + b[1][0]) / 2;
  const cy = (b[0][1] + b[1][1]) / 2;
  const w = Math.max(22, b[1][0] - b[0][0]);
  const h = Math.max(15, b[1][1] - b[0][1]);
  return [
    [cx - w / 2, Math.max(-80, cy - h / 2)],
    [cx + w / 2, Math.min(80, cy + h / 2)],
  ];
}

export function MapScreen() {
  const { state } = useStore();
  const missionId = state.mission?.mission_id ?? null;
  const [geo, setGeo] = useState<MapResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!missionId) return;
    let live = true;
    setGeo(null);
    api
      .map(missionId)
      .then((m) => live && (setGeo(m), setProblem(null)))
      .catch((e) => live && setProblem(e instanceof ApiFailure ? e.message : "The map could not be loaded."));
    return () => {
      live = false;
    };
  }, [missionId]);

  if (!state.mission) return <Empty title="No mission open">Open a mission from the Overview.</Empty>;
  if (problem) return <Empty title="Map unavailable">{problem}</Empty>;
  if (!geo) return <div className="loading"><Skeleton lines={3} wide /></div>;
  // No supplied navigation and no recorded positions: nothing is placed, and no location is invented.
  if (!geo.platform_context.length && !geo.features.length) return <NonSpatial />;
  return <MissionMap geo={geo} key={missionId} />;
}

function NonSpatial() {
  const { state } = useStore();
  return (
    <div className="mm-nonspatial">
      <Empty
        title="Navigation unavailable"
        action={
          state.contacts.length ? (
            <button className="btn btn--primary" onClick={() => navigate(hrefFor("review"))}>
              Review {state.contacts.length} Contact{state.contacts.length === 1 ? "" : "s"} in sonar
            </button>
          ) : undefined
        }
      >
        This mission has no survey track, so nothing is placed on a map. No position is ever derived from the sonar image.
      </Empty>
    </div>
  );
}

function MissionMap({ geo }: { geo: MapResponse }) {
  const { state, dispatch } = useStore();
  const role = state.role!;
  const theme = useWsTheme();
  const mission = state.mission!;
  const saved = useMemo(() => {
    const v = readView();
    let returning = false;
    try {
      returning = !!sessionStorage.getItem(MAP_RETURN_KEY);
    } catch {
      /* no memory */
    }
    return v && v.missionId === mission.mission_id && returning ? v : null;
  }, [mission.mission_id]);

  const [rail, setRail] = useState(saved?.rail ?? window.innerWidth >= 760);
  const [tab, setTab] = useState<"contacts" | "track">(role.id === "field-officer" ? "track" : "contacts");
  const [layers, setLayers] = useState<LayerState>(saved?.layers ?? { track: true, contacts: true, bathymetry: false });
  const [mode, setMode] = useState<"2d" | "3d">(saved?.mode ?? "2d");
  const [selectedId, setSelectedId] = useState<string | null>(saved?.selected ?? null);
  const [zoom, setZoom] = useState(saved?.zoom ?? 3);
  const [layerMenu, setLayerMenu] = useState(false);
  const [basemapIssue, setBasemapIssue] = useState(false);
  const [ready, setReady] = useState(false);

  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLButtonElement }>());
  const missionMarker = useRef<maplibregl.Marker | null>(null);

  const fixes = useMemo(() => sortedFixes(geo), [geo]);
  const placed = useMemo(() => place(geo, state.contacts), [geo, state.contacts]);
  const selected = placed.find((p) => p.contact.contact_id === selectedId) ?? null;
  const trackProvenance = fixes[0]?.properties.provenance ?? null;
  const allPoints = useMemo<[number, number][]>(() => [...fixes.map((f) => f.geometry.coordinates), ...placed.map((p) => [p.lon, p.lat] as [number, number])], [fixes, placed]);
  const missionBounds = useMemo(() => bounds(allPoints), [allPoints]);
  const centre = useMemo<[number, number]>(() => [(missionBounds[0][0] + missionBounds[1][0]) / 2, (missionBounds[0][1] + missionBounds[1][1]) / 2], [missionBounds]);

  const padding = useCallback(() => {
    const narrow = window.innerWidth < 760;
    return narrow ? { top: 80, bottom: 220, left: 24, right: 24 } : { top: 90, bottom: 60, left: rail ? 380 : 70, right: selectedId ? 420 : 70 };
  }, [rail, selectedId]);

  const fitTrack = useCallback(
    (duration = 1200) => {
      mapRef.current?.fitBounds(missionBounds as LngLatBoundsLike, { padding: padding(), maxZoom: 15, duration: reduced() ? 0 : duration, pitch: mode === "3d" ? 60 : 0 });
    },
    [missionBounds, padding, mode],
  );
  const fitRegion = useCallback(
    (duration = 1200) => {
      mapRef.current?.fitBounds(region(missionBounds) as LngLatBoundsLike, { padding: padding(), duration: reduced() ? 0 : duration, pitch: mode === "3d" ? 55 : 0 });
    },
    [missionBounds, padding, mode],
  );
  const centreRef = useRef(centre);
  centreRef.current = centre;
  const fitTrackRef = useRef(fitTrack);
  fitTrackRef.current = fitTrack;

  // Create the map once for this mission view.
  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: buildStyle(theme, layers),
      ...(saved ? { center: saved.center, zoom: saved.zoom, pitch: saved.pitch, bearing: saved.bearing } : { bounds: region(missionBounds) as LngLatBoundsLike }),
      attributionControl: { compact: true },
      maxPitch: 70,
      fadeDuration: 150,
    });
    mapRef.current = m;
    m.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-right");
    // Development-only handle for browser QA; not present in production builds.
    if (import.meta.env.DEV) (window as unknown as { __aqMap?: MLMap }).__aqMap = m;
    // Register the track chevrons as each style lands, before any symbol asks for them.
    m.on("style.load", () => {
      for (const t of ["light", "dark"] as const) if (!m.hasImage(`aq-arrow-${t}`)) m.addImage(`aq-arrow-${t}`, arrowImage(t), { pixelRatio: 2 });
    });
    m.on("styleimagemissing", (e: MapStyleImageMissingEvent) => {
      if (e.id.startsWith("aq-arrow-") && !m.hasImage(e.id)) m.addImage(e.id, arrowImage(e.id.endsWith("dark") ? "dark" : "light"), { pixelRatio: 2 });
    });
    // External tiles may fail (offline, blocked). The mission track and Contacts still work.
    m.on("error", () => setBasemapIssue(true));
    m.on("zoom", () => setZoom(m.getZoom()));
    m.once("load", () => {
      setReady(true);
      setZoom(m.getZoom());
      if (saved) {
        if (saved.mode === "3d") m.setTerrain({ source: "dem-terrain", exaggeration: VERTICAL_EXAGGERATION });
        try {
          sessionStorage.removeItem(MAP_RETURN_KEY);
        } catch {
          /* ignore */
        }
      } else if (!reduced()) {
        // Arrive with the region in view, then settle on the mission.
        m.once("idle", () => setTimeout(() => fitTrackRef.current(2800), 400));
      } else fitTrackRef.current(0);
    });
    const live = markers.current;
    return () => {
      live.forEach(({ marker }) => marker.remove());
      live.clear();
      missionMarker.current?.remove();
      missionMarker.current = null;
      m.remove();
      mapRef.current = null;
    };
    // The instance lives for this mission view; later changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track data, re-applied after any style change.
  const applyData = useCallback(() => {
    const m = mapRef.current;
    if (!m || !m.getSource("track")) return;
    const coords = fixes.map((f) => f.geometry.coordinates);
    (m.getSource("track") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: coords.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : [] });
    (m.getSource("track-points") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: fixes.map((f, i) => ({ type: "Feature", properties: { endpoint: i === 0 || i === fixes.length - 1 }, geometry: f.geometry })),
    });
  }, [fixes]);
  useEffect(() => {
    if (ready) applyData();
  }, [ready, applyData]);

  // Theme: swap the style; data and terrain are restored when it lands.
  const styledFor = useRef(theme);
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready || styledFor.current === theme) return;
    styledFor.current = theme;
    m.setStyle(buildStyle(theme, layers));
    m.once("style.load", () => {
      applyData();
      if (mode === "3d") m.setTerrain({ source: "dem-terrain", exaggeration: VERTICAL_EXAGGERATION });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, ready]);

  // Layer visibility.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    const set = (id: string, on: boolean) => m.getLayer(id) && m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    ["bathymetry", "seafloor-relief"].forEach((id) => set(id, layers.bathymetry));
    ["track-line", "track-direction", "track-points"].forEach((id) => set(id, layers.track));
  }, [layers, ready]);

  // 2D / 3D seafloor.
  const modeApplied = useRef(mode);
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready || modeApplied.current === mode) return;
    modeApplied.current = mode;
    if (mode === "3d") {
      // Seafloor relief reads at basin scale: look across the mission's sea from a low angle.
      m.setTerrain({ source: "dem-terrain", exaggeration: VERTICAL_EXAGGERATION });
      m.flyTo({ center: centreRef.current, zoom: Math.min(m.getZoom(), 5.6), pitch: 66, bearing: -24, duration: reduced() ? 0 : 2200 });
    } else {
      m.setTerrain(null);
      m.easeTo({ pitch: 0, bearing: 0, duration: reduced() ? 0 : 1000 });
    }
  }, [mode, ready]);

  const select = useCallback(
    (id: string | null, fly = true) => {
      setSelectedId(id);
      if (!id) return;
      dispatch({ type: "select", id });
      const p = placed.find((x) => x.contact.contact_id === id);
      const m = mapRef.current;
      if (p && m && fly) m.easeTo({ center: [p.lon, p.lat], zoom: Math.max(m.getZoom(), 13.5), duration: reduced() ? 0 : 900 });
    },
    [dispatch, placed],
  );

  // Contact markers: accessible buttons, one per Contact; merged into a mission marker when zoomed out.
  const selectRef = useRef(select);
  selectRef.current = select;
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    const live = markers.current;
    const ids = new Set(placed.map((p) => p.contact.contact_id));
    for (const [id, { marker }] of live)
      if (!ids.has(id)) {
        marker.remove();
        live.delete(id);
      }
    const hidden = zoom < DETAIL_ZOOM || !layers.contacts;
    for (const p of placed) {
      let entry = live.get(p.contact.contact_id);
      if (!entry) {
        const el = document.createElement("button");
        el.type = "button";
        el.innerHTML = '<span class="mm-pin__ring"></span><span class="mm-pin__mark"></span><span class="mm-pin__label"></span>';
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          selectRef.current(p.contact.contact_id, false);
        });
        const angle = -Math.PI / 2 + p.fan * 1.05;
        const marker = new maplibregl.Marker({ element: el, offset: p.fan ? [Math.cos(angle) * 22, Math.sin(angle) * 22] : [0, 0] }).setLngLat([p.lon, p.lat]).addTo(m);
        entry = { marker, el };
        live.set(p.contact.contact_id, entry);
      }
      const c = p.contact;
      const high = c.analyst.priority === "CRITICAL" || c.analyst.priority === "HIGH";
      // Toggle our classes only: MapLibre positions the marker through its own classes on this element.
      const cl = entry.el.classList;
      cl.add("mm-pin");
      cl.toggle("mm-pin--known", !!c.machine);
      cl.toggle("mm-pin--anomaly", !c.machine);
      cl.toggle("is-reviewed", isReviewed(c));
      cl.toggle("is-high", high);
      cl.toggle("is-selected", c.contact_id === selectedId);
      cl.toggle("is-hidden", hidden);
      entry.el.setAttribute("aria-label", `${contactName(c)}, ${machineLabel(c)}, ${STATUS_LABEL[c.analyst.status]}`);
      entry.el.tabIndex = hidden ? -1 : 0;
      (entry.el.querySelector(".mm-pin__label") as HTMLElement).textContent = contactName(c);
    }
  }, [placed, selectedId, zoom, layers.contacts, ready]);

  // One quiet mission marker when zoomed out, so the regional view says where the mission is.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    if (!missionMarker.current) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "mm-mission";
      el.addEventListener("click", () => fitTrackRef.current(1800));
      missionMarker.current = new maplibregl.Marker({ element: el }).setLngLat(centre).addTo(m);
    }
    const el = missionMarker.current.getElement() as HTMLButtonElement;
    const title = displayName(mission.name, "Mission").replace(/[<>&]/g, "");
    el.innerHTML = `<span class="mm-mission__dot"></span><span class="mm-mission__text"><b>${title}</b><small>${placed.length} Contact${placed.length === 1 ? "" : "s"} · show track</small></span>`;
    el.setAttribute("aria-label", `${title}: zoom to the survey track`);
    el.classList.toggle("is-hidden", zoom >= DETAIL_ZOOM);
    el.tabIndex = zoom >= DETAIL_ZOOM ? -1 : 0;
  }, [ready, zoom, placed.length, mission.name, centre]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (layerMenu) setLayerMenu(false);
      else setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layerMenu]);

  const inspect = (id: string) => {
    const m = mapRef.current;
    if (m) {
      const c = m.getCenter();
      writeView({ missionId: mission.mission_id, center: [c.lng, c.lat], zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing(), selected: id, rail, layers, mode });
    }
    try {
      sessionStorage.setItem(MAP_RETURN_KEY, id);
    } catch {
      /* the Back to Map affordance is a convenience */
    }
    dispatch({ type: "select", id });
    navigate(hrefFor("review", id));
  };

  return (
    <div className={`mm mm--${theme} ${rail ? "" : "mm--rail-closed"} ${selected ? "mm--inspecting" : ""}`}>
      <div ref={container} className="mm__canvas" role="region" aria-label={`Map of ${displayName(mission.name, "Mission")}`} />

      <Rail
        open={rail}
        onToggle={() => setRail(!rail)}
        tab={tab}
        setTab={setTab}
        placed={placed}
        fixes={fixes}
        selectedId={selectedId}
        onSelect={(id) => select(id)}
        onFix={(f) => mapRef.current?.easeTo({ center: f.geometry.coordinates, zoom: 14, duration: reduced() ? 0 : 900 })}
      />

      <div className="mm__controls" role="toolbar" aria-label="Map controls">
        <div className="mm-seg" role="group" aria-label="View">
          <button aria-pressed={mode === "2d"} onClick={() => setMode("2d")}>
            2D
          </button>
          <button aria-pressed={mode === "3d"} onClick={() => setMode("3d")} title="3D seafloor from the elevation source">
            3D Seafloor
          </button>
        </div>
        {mode === "3d" && (
          <span className="mm-vx" title="Depth is exaggerated so seafloor relief is readable at basin scale">
            Vertical ×{VERTICAL_EXAGGERATION}
          </span>
        )}
        <div className="mm-stack">
          <button className="mm-btn mm-btn--text" onClick={() => fitTrack()} title="Fit the survey track">
            Track
          </button>
          <button className="mm-btn mm-btn--text" onClick={() => fitRegion()} title="Show the surrounding region">
            Region
          </button>
        </div>
        <div className="mm-stack">
          <button className="mm-btn" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in">
            <Icon name="plus" size={15} />
          </button>
          <button className="mm-btn" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out">
            <Icon name="minus" size={15} />
          </button>
        </div>
        <div className="mm-anchor">
          <button className={`mm-btn mm-btn--wide ${layers.bathymetry ? "is-on" : ""}`} aria-haspopup="dialog" aria-expanded={layerMenu} onClick={() => setLayerMenu(!layerMenu)}>
            <Icon name="layers" size={15} /> Layers
          </button>
          {layerMenu && <LayerPanel layers={layers} setLayers={setLayers} trackPoints={fixes.length} trackProvenance={trackProvenance} onClose={() => setLayerMenu(false)} mode={mode} />}
        </div>
      </div>

      {layers.bathymetry && <Legend theme={theme} />}
      {basemapIssue && (
        <p className="mm__notice" role="status">
          Some map tiles could not load. The mission track and Contacts remain available.
        </p>
      )}

      <Inspector placed={selected} fixes={fixes} trackProvenance={trackProvenance} onClose={() => setSelectedId(null)} onInspect={inspect} />
    </div>
  );
}

/* ---------------- left rail ---------------- */

const surveyLabel = (surveys: { survey_ref: string }[], ref?: string | null) => {
  const i = surveys.findIndex((s) => s.survey_ref === ref);
  return i < 0 ? "Survey" : `Survey ${String(i + 1).padStart(2, "0")}`;
};

function Rail({
  open,
  onToggle,
  tab,
  setTab,
  placed,
  fixes,
  selectedId,
  onSelect,
  onFix,
}: {
  open: boolean;
  onToggle: () => void;
  tab: "contacts" | "track";
  setTab: (t: "contacts" | "track") => void;
  placed: Placed[];
  fixes: MapFeature[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFix: (f: MapFeature) => void;
}) {
  const { state, imagery } = useStore();
  const role = state.role!;
  const trackIndex = useMemo(() => new Map(fixes.map((f, i) => [key(f.properties.survey_ref, f.properties.frame_ref), i])), [fixes]);
  const pointOf = (c: Contact) => {
    const d = c.detections.find((x) => trackIndex.has(key(x.survey_ref, x.frame_ref)));
    return d ? trackIndex.get(key(d.survey_ref, d.frame_ref))! : Number.MAX_SAFE_INTEGER;
  };
  const order = useMemo(() => {
    const contacts = placed.map((p) => p.contact);
    if (role.id === "sonar-analyst") return queueOrder(contacts);
    if (role.id === "mission-supervisor" || role.id === "decision-viewer")
      return [...contacts].sort((a, b) => PRIORITY_RANK[a.analyst.priority] - PRIORITY_RANK[b.analyst.priority] || Number(isReviewed(b)) - Number(isReviewed(a)) || a.contact_id.localeCompare(b.contact_id));
    return [...contacts].sort((a, b) => pointOf(a) - pointOf(b)); // Field Officer: along the track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, role.id, trackIndex]);
  const reviewed = state.contacts.filter(isReviewed).length;
  const perPoint = useMemo(() => {
    const n = new Map<number, number>();
    for (const p of placed) {
      const i = pointOf(p.contact);
      n.set(i, (n.get(i) ?? 0) + 1);
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, trackIndex]);

  if (!open)
    return (
      <button className="mm-railtab" onClick={onToggle} aria-label="Show mission panel">
        <Icon name="chevronRight" size={14} />
        <span>
          {placed.length} Contact{placed.length === 1 ? "" : "s"}
        </span>
      </button>
    );

  return (
    <aside className="mm-rail" aria-label="Mission">
      <header className="mm-rail__head">
        <div className="mm-rail__mission">
          <p className="mm-eyebrow">Mission</p>
          <h2>{displayName(state.mission!.name, "Mission")}</h2>
          <p className="mm-rail__facts">
            <span>
              {state.surveys.length} Survey{state.surveys.length === 1 ? "" : "s"}
            </span>
            <span>
              {state.contacts.length} Contact{state.contacts.length === 1 ? "" : "s"}
            </span>
            <span>{reviewed} reviewed</span>
          </p>
          {state.contacts.length > 0 && (
            <div className="mm-progress" role="img" aria-label={`${reviewed} of ${state.contacts.length} Contacts reviewed`}>
              <i style={{ width: `${(reviewed / state.contacts.length) * 100}%` }} />
            </div>
          )}
        </div>
        <button className="icon-btn icon-btn--sm" onClick={onToggle} aria-label="Hide mission panel">
          <Icon name="chevronLeft" size={14} />
        </button>
      </header>
      <div className="mm-tabs" role="tablist" aria-label="Mission panel">
        <button role="tab" aria-selected={tab === "contacts"} onClick={() => setTab("contacts")}>
          Contacts
        </button>
        <button role="tab" aria-selected={tab === "track"} onClick={() => setTab("track")} disabled={!fixes.length}>
          Survey track
        </button>
      </div>
      {tab === "contacts" || !fixes.length ? (
        <ul className="mm-list" role="tabpanel" aria-label="Contacts">
          {order.map((c) => (
            <li key={c.contact_id}>
              <button className={`mm-row ${selectedId === c.contact_id ? "is-selected" : ""}`} onClick={() => onSelect(c.contact_id)} aria-current={selectedId === c.contact_id ? "true" : undefined}>
                <span className="mm-row__thumb">
                  <ContactThumb imagery={imagery(c)} />
                </span>
                <span className="mm-row__main">
                  <span className="mm-row__title">{contactName(c)}</span>
                  <span className="mm-row__sub">
                    {machineLabel(c)}
                    {isReviewed(c) && c.analyst.classification !== "UNRESOLVED" ? ` · ${analystLabel(c.analyst.classification)}` : ""}
                  </span>
                </span>
                <span className="mm-row__trail">
                  {c.analyst.priority !== "UNSET" && <Band priority={c.analyst.priority} />}
                  <StatusMark status={c.analyst.status} />
                </span>
              </button>
            </li>
          ))}
          {order.length === 0 && <li className="mm-empty">No supervised Contacts detected.</li>}
        </ul>
      ) : (
        <ol className="mm-list mm-track" role="tabpanel" aria-label="Survey track">
          {fixes.map((f, i) => {
            const n = perPoint.get(i) ?? 0;
            const t = f.properties.timestamp_utc;
            return (
              <li key={key(f.properties.survey_ref, f.properties.frame_ref)}>
                <button className="mm-row mm-row--fix" onClick={() => onFix(f)}>
                  <span className="mm-fix__n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="mm-row__main">
                    <span className="mm-row__title">{t ? `${t.slice(11, 16)} UTC` : `Point ${i + 1}`}</span>
                    <span className="mm-row__sub">{surveyLabel(state.surveys, f.properties.survey_ref)}</span>
                  </span>
                  <span className="mm-row__count">{n ? `${n} Contact${n === 1 ? "" : "s"}` : ""}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

/* ---------------- right inspector ---------------- */

function Inspector({
  placed,
  fixes,
  trackProvenance,
  onClose,
  onInspect,
}: {
  placed: Placed | null;
  fixes: MapFeature[];
  trackProvenance: string | null;
  onClose: () => void;
  onInspect: (id: string) => void;
}) {
  const { state, imagery } = useStore();
  const role = state.role!;
  const [depth, setDepth] = useState<DepthContext | null>(null);
  const [sea, setSea] = useState<SeaLevel | null>(null);
  const lon = placed?.lon;
  const lat = placed?.lat;

  useEffect(() => {
    setDepth(null);
    if (lon === undefined || lat === undefined) return;
    let live = true;
    void depthAt(lon, lat).then((d) => live && setDepth(d));
    return () => {
      live = false;
    };
  }, [lon, lat]);

  // Sea level at the track centre. Survey time only when the survey clock is measured.
  useEffect(() => {
    if (!fixes.length) return;
    let live = true;
    const clon = fixes.reduce((s, f) => s + f.geometry.coordinates[0], 0) / fixes.length;
    const clat = fixes.reduce((s, f) => s + f.geometry.coordinates[1], 0) / fixes.length;
    const measured = trackProvenance === "MEASURED" ? fixes[0].properties.timestamp_utc ?? null : null;
    void seaLevel(clat, clon, measured).then((s) => live && setSea(s));
    return () => {
      live = false;
    };
  }, [fixes, trackProvenance]);

  if (!placed) {
    const reviewed = state.contacts.filter(isReviewed).length;
    const attention = state.contacts.filter((c) => c.analyst.priority === "CRITICAL" || c.analyst.priority === "HIGH").length;
    return (
      <aside className="mm-insp mm-insp--summary" aria-label="Mission context">
        <p className="mm-eyebrow">{role.name}</p>
        <p className="mm-insp__lede">{role.question}</p>
        <dl className="mm-kv">
          <div>
            <dt>Navigation source</dt>
            <dd>{fixes.length ? `Provided survey track · ${fixes.length} points` : "Recorded positions"}</dd>
          </div>
          <div>
            <dt>Review</dt>
            <dd>
              {reviewed} of {state.contacts.length} Contacts reviewed
            </dd>
          </div>
          {(role.id === "mission-supervisor" || role.id === "decision-viewer") && (
            <div>
              <dt>Needs attention</dt>
              <dd>{attention ? `${attention} marked high or critical` : "None marked high or critical"}</dd>
            </div>
          )}
        </dl>
        {sea && <SeaCard sea={sea} />}
        <p className="mm-insp__hint">Select a Contact on the map or in the list.</p>
      </aside>
    );
  }

  const c = placed.contact;
  const img = imagery(c);
  const wet = depth && depth.elevation < 0;
  return (
    <aside className="mm-insp" aria-label={`${contactName(c)} details`} key={c.contact_id}>
      <header className="mm-insp__head">
        <div>
          <p className="mm-eyebrow">Contact</p>
          <h2>{contactName(c)}</h2>
        </div>
        <button className="icon-btn icon-btn--sm" onClick={onClose} aria-label="Close Contact details">
          <Icon name="close" size={14} />
        </button>
      </header>
      {img && (
        <div className="mm-insp__img">
          <ContactThumb imagery={img} pad={2.4} mark />
        </div>
      )}
      <dl className="mm-kv">
        <div>
          <dt>Analyst classification</dt>
          <dd>{isReviewed(c) && c.analyst.classification !== "UNRESOLVED" ? analystLabel(c.analyst.classification) : <span className="muted">Not classified</span>}</dd>
        </div>
        <div>
          <dt>Machine evidence</dt>
          <dd>{c.machine ? <span className="mono">{c.machine.supervised_class}</span> : "Local anomaly, no supervised class"}</dd>
        </div>
        {c.machine && (
          <div>
            <dt>Detector score</dt>
            <dd>
              <span className="mono">{c.machine.raw_detector_score.toFixed(2)}</span> <span className="muted small">raw, not calibrated</span>
            </dd>
          </div>
        )}
        <div>
          <dt>Review</dt>
          <dd className="mm-kv__status">
            <StatusMark status={c.analyst.status} />
          </dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>{PRIORITY_LABEL[c.analyst.priority]}</dd>
        </div>
        <div>
          <dt>Survey</dt>
          <dd>{surveyLabel(state.surveys, placed.survey)}</dd>
        </div>
        <div>
          <dt>Map position</dt>
          <dd>{placed.basis === "recorded" ? "Recorded Contact position" : "Track point of its frame"}</dd>
        </div>
        {wet && (
          <div>
            <dt>Seafloor depth context</dt>
            <dd>≈ {(Math.round(-depth.elevation / 10) * 10).toLocaleString("en-GB")} m</dd>
          </div>
        )}
      </dl>
      {placed.basis === "frame" && <p className="mm-insp__note">Observed in {placed.frame}. Shown at that frame's point on the survey track.</p>}
      {wet && <p className="mm-insp__note">Water depth at this map point from a regional grid (ETOPO1 via Terrain Tiles, ~1.8 km). Context only, not the depth of the Contact.</p>}
      <div className="mm-insp__actions">
        <button className="btn btn--primary btn--lg" onClick={() => onInspect(c.contact_id)}>
          {role.id === "decision-viewer" ? "View Contact" : "Inspect Contact"} <Icon name="arrowRight" size={14} />
        </button>
      </div>
    </aside>
  );
}

function SeaCard({ sea }: { sea: SeaLevel }) {
  const t = (iso: string | null) => (iso ? `${iso.slice(11, 16)} UTC` : "Beyond range");
  return (
    <section className="mm-sea" aria-label="Ocean context">
      <p className="mm-eyebrow">Ocean context · {sea.basis === "now" ? "now" : "survey time"}</p>
      <div className="mm-sea__row">
        <div>
          <b>{sea.trend}</b>
          <small>
            Sea level {sea.height >= 0 ? "+" : ""}
            {sea.height.toFixed(2)} m
          </small>
        </div>
        <div>
          <b>{t(sea.nextHigh)}</b>
          <small>Next high</small>
        </div>
        <div>
          <b>{t(sea.nextLow)}</b>
          <small>Next low</small>
        </div>
      </div>
      <p className="mm-sea__src">
        Modelled sea level incl. tide (Open-Meteo Marine) at the track centre, {sea.at.slice(0, 10)} {sea.at.slice(11, 16)} UTC. Not a tide gauge.
      </p>
    </section>
  );
}

/* ---------------- layers and legend ---------------- */

function LayerPanel({
  layers,
  setLayers,
  trackPoints,
  trackProvenance,
  onClose,
  mode,
}: {
  layers: LayerState;
  setLayers: (l: LayerState) => void;
  trackPoints: number;
  trackProvenance: string | null;
  onClose: () => void;
  mode: "2d" | "3d";
}) {
  const [about, setAbout] = useState(false);
  const row = (k: keyof LayerState, label: string, hint: string) => (
    <label className="mm-toggle">
      <span>
        {label}
        <small>{hint}</small>
      </span>
      <input type="checkbox" role="switch" checked={layers[k]} onChange={() => setLayers({ ...layers, [k]: !layers[k] })} />
    </label>
  );
  return (
    <div className="mm-panel" role="dialog" aria-label="Map layers">
      <header className="mm-panel__head">
        <h2>Layers</h2>
        <button className="icon-btn icon-btn--sm" onClick={onClose} aria-label="Close layers">
          <Icon name="close" size={14} />
        </button>
      </header>
      {trackPoints > 0 && row("track", "Mission track", `${trackPoints} points supplied with the survey`)}
      {row("contacts", "Contacts", "This mission's Contacts")}
      {row("bathymetry", "Bathymetry", "Seafloor depth context, regional grid")}
      <button className="link mm-panel__about" aria-expanded={about} onClick={() => setAbout(!about)}>
        About this map
      </button>
      {about && (
        <dl className="mm-sources">
          <div>
            <dt>Basemap</dt>
            <dd dangerouslySetInnerHTML={{ __html: ATTRIBUTION.basemap }} />
          </div>
          <div>
            <dt>Bathymetry and 3D seafloor</dt>
            <dd>
              <span dangerouslySetInnerHTML={{ __html: ATTRIBUTION.dem }} />. Ocean depths on a ~1.8 km grid. Context only: Aqualens does not measure depth from sonar.
            </dd>
          </div>
          <div>
            <dt>3D vertical exaggeration</dt>
            <dd>
              {VERTICAL_EXAGGERATION}×{mode === "3d" ? ", active" : ""}
            </dd>
          </div>
          <div>
            <dt>Navigation</dt>
            <dd>{trackPoints ? `Provided survey track, ${trackPoints} points. Provenance: ${trackProvenance ?? "not declared"}. Draws the map only, never used as evidence.` : "No survey track supplied."}</dd>
          </div>
          <div>
            <dt>Ocean context</dt>
            <dd>Open-Meteo Marine API, modelled sea level including tide. Shown for the current time unless the survey clock is measured.</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function Legend({ theme }: { theme: MapTheme }) {
  const colors = depthColors(theme);
  return (
    <div className="mm-legend" aria-label="Bathymetry legend">
      <p className="mm-eyebrow">Bathymetry · depth in m</p>
      <div className="mm-legend__bar">
        {colors.map((c, i) => (
          <i key={i} style={{ background: c }} />
        ))}
      </div>
      <div className="mm-legend__ticks">
        {DEPTH_STOPS.map((d, i) => (
          <span key={d}>{i === DEPTH_STOPS.length - 1 ? `${d.toLocaleString("en-GB")}+` : d.toLocaleString("en-GB")}</span>
        ))}
      </div>
      <p className="mm-legend__src">Seafloor context · ETOPO1 via Terrain Tiles</p>
    </div>
  );
}
