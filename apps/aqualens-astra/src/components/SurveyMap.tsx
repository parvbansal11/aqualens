import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Plus,
  Minus,
  Scan,
  Maximize2,
  Layers,
  Check,
  ChevronRight,
  X,
  Navigation,
  ArrowUpRight,
} from "lucide-react";
import type { Survey, Contact, TrackPoint } from "../lib/runtime/types";
import { useWorkspace } from "../lib/store";
import {
  coordinate,
  score,
  reviewLabel,
  trackSegments,
  contactMetric,
} from "../lib/runtime/selectors";
import { IllustrativeNote } from "./ui";
function depthColor(value: number, min: number, max: number) {
  const amount = (value - min) / (max - min || 1);
  return `hsl(${174 + amount * 29}, ${38 + amount * 8}%, ${49 - amount * 21}%)`;
}
export default function SurveyMap({
  survey,
  preview = false,
}: {
  survey: Survey;
  preview?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    markers = useRef(new Map<string, L.Marker>()),
    tile = useRef<L.TileLayer | null>(null),
    tracks = useRef<L.LayerGroup | null>(null);
  const { theme, role } = useWorkspace();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(
      preview ? null : params.get("contact"),
    ),
    [layersOpen, setLayersOpen] = useState(false),
    [showTrack, setShowTrack] = useState(true),
    [showDepth, setShowDepth] = useState(true),
    [showContacts, setShowContacts] = useState(true),
    [tileError, setTileError] = useState(false);
  const points = survey.track.filter((p): p is TrackPoint => p !== null),
    depths = points.filter((p) => p.depthM !== null);
  const min = depths.length ? Math.min(...depths.map((p) => p.depthM!)) : 0,
    max = depths.length ? Math.max(...depths.map((p) => p.depthM!)) : 0;
  const selectedContact = survey.contacts.find((c) => c.id === selected);
  const syntheticDemoMetadata = /synthetic[_ ]demo[_ ]metadata/i.test(
    survey.missionNotes ?? "",
  );
  const ordered =
    points.length > 0 &&
    (survey.source === "PRESENTATION" ||
      points.every(
        (p, i) =>
          p.timestamp &&
          Number.isFinite(Date.parse(p.timestamp)) &&
          (i === 0 ||
            Date.parse(p.timestamp) >= Date.parse(points[i - 1].timestamp!)),
      ));

  const fit = () => {
    const narrow = (container.current?.clientWidth ?? 1000) < 700;
    const bounds = L.latLngBounds([
      ...points.map((p) => L.latLng(p.lat, p.lon)),
      ...survey.contacts.flatMap((c) =>
        c.position ? [L.latLng(c.position.lat, c.position.lon)] : [],
      ),
    ]);
    if (bounds.isValid())
      map.current?.fitBounds(bounds, {
        paddingTopLeft: preview ? [80, 60] : narrow ? [30, 150] : [260, 130],
        paddingBottomRight: preview
          ? [80, 60]
          : narrow
            ? [60, 190]
            : [190, 180],
        // Closely spaced supplied fixes must remain individually inspectable.
        maxZoom: preview ? 18 : 19,
        animate: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
  };
  useEffect(() => {
    if (!container.current) return;
    const initial =
      points[0] ?? survey.contacts.find((c) => c.position)?.position;
    if (!initial) return;
    const m = L.map(container.current, {
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: false,
      scrollWheelZoom: !preview,
      dragging: !preview,
      doubleClickZoom: !preview,
      boxZoom: !preview,
      touchZoom: !preview,
      keyboard: !preview,
      zoomAnimation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
    }).setView([initial.lat, initial.lon], 13);
    map.current = m;
    L.control.attribution({ position: "bottomright", prefix: false }).addTo(m);
    L.control.scale({ position: "bottomleft", imperial: false }).addTo(m);
    fit();
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
    };
    // Survey identity owns the cartographic instance. Layers and selection are updated separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survey.id, preview]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tile.current?.remove();
    const style =
      theme === "dark" ? "World_Dark_Gray_Base" : "World_Light_Gray_Base";
    const layer = L.tileLayer(
      `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/${style}/MapServer/tile/{z}/{y}/{x}`,
      {
        attribution:
          'Tiles &copy; <a href="https://www.esri.com/">Esri</a> · HERE · Garmin · &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        // Higher levels have regional land coverage only; offshore requests return
        // HTTP 200 placeholder images, so tileerror cannot detect missing data.
        // Scale the globally covered tiles while retaining close survey zooms.
        maxNativeZoom: theme === "dark" ? 10 : 13,
        maxZoom: 20,
        crossOrigin: true,
      },
    );
    layer.on("tileerror", () => setTileError(true));
    layer.on("tileload", () => setTileError(false));
    layer.addTo(m);
    tile.current = layer;
    return () => {
      layer.remove();
    };
  }, [theme, survey.id]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tracks.current?.remove();
    const group = L.layerGroup();
    tracks.current = group;
    if (!showTrack) return;
    for (const segment of trackSegments(survey)) {
      const coords = segment.map((p) => L.latLng(p.lat, p.lon));
      if (coords.length > 1) {
        L.polyline(coords, {
          color: theme === "dark" ? "#07171e" : "#ffffff",
          weight: 7,
          opacity: 0.65,
        }).addTo(group);
        L.polyline(coords, {
          color: theme === "dark" ? "#82c6bd" : "#23776f",
          weight: 2.8,
          opacity: 0.9,
        }).addTo(group);
        if (showDepth && depths.length > 1)
          segment.slice(1).forEach((p, i) => {
            if (p.depthM !== null && segment[i].depthM !== null)
              L.polyline(
                [
                  [segment[i].lat, segment[i].lon],
                  [p.lat, p.lon],
                ],
                { color: depthColor(p.depthM!, min, max), weight: 3.3 },
              ).addTo(group);
          });
      }
      segment.forEach((p) =>
        L.circleMarker([p.lat, p.lon], {
          radius: 2,
          weight: 1,
          color: theme === "dark" ? "#9acec7" : "#257b73",
          fillColor: theme === "dark" ? "#153f48" : "#f4f7f1",
          fillOpacity: 1,
        }).addTo(group),
      );
    }
    const first = points[0],
      last = points.at(-1);
    if (first && ordered)
      L.marker([first.lat, first.lon], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: "track-endpoint",
          html: "<i></i><span>START</span>",
          iconSize: [70, 20],
          iconAnchor: [5, 10],
        }),
      }).addTo(group);
    if (last && ordered)
      L.marker([last.lat, last.lon], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: "track-endpoint end",
          html: `<i>${last.heading !== null ? `<svg viewBox="0 0 20 20" style="transform:rotate(${last.heading}deg)"><path d="M10 2L17 17L10 13L3 17Z"/></svg>` : ""}</i><span>END</span>`,
          iconSize: [70, 20],
          iconAnchor: [7, 10],
        }),
      }).addTo(group);
    group.addTo(m);
    return () => {
      group.remove();
    };
    // Points and range are derived from the immutable survey prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survey, showTrack, showDepth, theme]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const collection = markers.current;
    for (const marker of collection.values()) marker.remove();
    collection.clear();
    if (!showContacts) return;
    survey.contacts.forEach((contact, i) => {
      if (!contact.position) return;
      const metric = contactMetric(contact);
      const core =
        contact.classKey === "PIPELINE"
          ? "pipeline"
          : contact.classKey === "CRAB_POT"
            ? "gear"
            : contact.classKey === "OPEN_SET"
              ? "unusual"
              : "structure";
      const marker = L.marker([contact.position.lat, contact.position.lon], {
        title: `${contact.shortId}: ${contact.label}`,
        alt: `Select ${contact.shortId}`,
        keyboard: true,
        icon: L.divIcon({
          className: "contact-map-marker",
          html: `<span class="marker-ring"><i class="marker-core core-${core}"></i></span><span class="marker-label">CT-${String(i + 1).padStart(2, "0")}</span>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        }),
      });
      marker.on("click", () => setSelected(contact.id));
      if (!preview) {
        const content = document.createElement("div");
        content.className = "contact-popup";
        const add = (tag: string, text: string, cls?: string) => {
          const el = document.createElement(tag);
          el.textContent = text;
          if (cls) el.className = cls;
          content.append(el);
          return el;
        };
        add("span", `CONTACT ${contact.shortId}`, "eyebrow");
        add("h3", contact.label);
        add(
          "p",
          `${coordinate(contact.position.lat, true)}\n${coordinate(contact.position.lon, false)}`,
          "mono popup-coordinates",
        );
        const grid = document.createElement("dl");
        for (const [label, value] of [
          [metric.label, score(metric.value)],
          ["Observations", String(contact.observationIds.length)],
          ...(contact.position.depthM !== null
            ? [["Depth", `${contact.position.depthM.toFixed(1)} m`]]
            : []),
          ["Review", reviewLabel(contact.review)],
        ]) {
          if (label === metric.label && metric.value === null) continue;
          const row = document.createElement("div"),
            dt = document.createElement("dt"),
            dd = document.createElement("dd");
          dt.textContent = label;
          dd.textContent = value;
          row.append(dt, dd);
          grid.append(row);
        }
        content.append(grid);
        if (role === "analyst") {
          const link = add(
            "a",
            "Inspect Contact ↗",
            "popup-inspect",
          ) as HTMLAnchorElement;
          link.href = `/workspace/contact/${encodeURIComponent(contact.id)}`;
          link.addEventListener("click", (event) => {
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            navigate(`/workspace/contact/${encodeURIComponent(contact.id)}`);
          });
        } else
          add(
            "small",
            survey.source === "PRESENTATION"
              ? "Illustrative position"
              : "Source-frame navigation",
          );
        marker.bindPopup(content, {
          closeButton: true,
          maxWidth: 260,
          minWidth: 230,
          offset: [0, -12],
          autoPanPaddingTopLeft: [270, 100],
          autoPanPaddingBottomRight: [60, 150],
        });
        // Closing a popup leaves the operational selection intact in the rail/profile.
        // Leaflet also closes popups during teardown; teardown must not erase a deep link.
      }
      marker.addTo(m);
      markers.current.set(contact.id, marker);
    });
    return () => {
      for (const marker of collection.values()) marker.remove();
      collection.clear();
    };
  }, [survey, showContacts, preview, role, navigate]);
  useEffect(() => {
    for (const [id, marker] of markers.current) {
      marker.getElement()?.classList.toggle("selected", id === selected);
      if (id === selected && !preview && !marker.isPopupOpen())
        marker.openPopup();
    }
    if (!selected) map.current?.closePopup();
  }, [selected, preview, showContacts, survey, role, navigate]);
  function select(c: Contact) {
    setSelected(c.id);
    const marker = markers.current.get(c.id);
    if (marker && !preview) marker.openPopup();
  }
  return (
    <section
      className={`survey-map ${preview ? "is-preview" : ""}`}
      aria-label="Survey navigation map"
    >
      <div
        ref={container}
        className="leaflet-map"
        tabIndex={preview ? -1 : 0}
        aria-label="Interactive survey map. Use arrow keys to pan and plus or minus to zoom."
      />
      {!preview && (
        <>
          <div className="map-title">
            <p className="eyebrow">THE SPATIAL PICTURE</p>
            <h1>Follow the survey.</h1>
            <span>
              {survey.source === "PRESENTATION"
                ? "Illustrative navigation · not acquisition positions"
                : syntheticDemoMetadata
                  ? "Illustrative survey metadata · not field measurements"
                  : "Source-frame navigation · not object geolocation"}
            </span>
          </div>
          <div className="map-contact-rail">
            <div className="map-rail-heading">
              <span>
                Contacts <b>{survey.contacts.length}</b>
              </span>
              <button
                className="icon-button"
                aria-label={showContacts ? "Hide Contacts" : "Show Contacts"}
                onClick={() => setShowContacts((v) => !v)}
              >
                {showContacts ? <Minus size={14} /> : <Plus size={14} />}
              </button>
            </div>
            {showContacts &&
              survey.contacts.map((c) => (
                <button
                  key={c.id}
                  className={`map-contact-row ${selected === c.id ? "is-selected" : ""}`}
                  aria-pressed={selected === c.id}
                  onClick={() => select(c)}
                  disabled={!c.position}
                >
                  <span
                    className={`rail-core core-${c.classKey === "OPEN_SET" ? "unusual" : c.classKey === "PIPELINE" ? "pipeline" : c.classKey === "CRAB_POT" ? "gear" : "structure"}`}
                  />
                  <span>
                    <b>{c.shortId}</b>
                    <small>{c.label}</small>
                  </span>
                  <ChevronRight size={14} />
                </button>
              ))}
          </div>
          <div className="map-tools">
            <div className="map-zoom">
              <button
                aria-label="Zoom in map"
                onClick={() => map.current?.zoomIn()}
              >
                <Plus size={19} />
              </button>
              <button
                aria-label="Zoom out map"
                onClick={() => map.current?.zoomOut()}
              >
                <Minus size={19} />
              </button>
            </div>
            <button
              className="map-tool"
              aria-label="Fit survey to map"
              onClick={fit}
            >
              <Scan size={20} />
            </button>
            <button
              className="map-tool"
              aria-label="Expand map"
              onClick={(event) => {
                const surface = event.currentTarget.closest(".survey-map");
                if (document.fullscreenElement)
                  void document.exitFullscreen().catch(() => {});
                else void surface?.requestFullscreen?.().catch(() => {});
              }}
            >
              <Maximize2 size={19} />
            </button>
            <button
              className="map-tool"
              aria-expanded={layersOpen}
              aria-label="Map layers"
              onClick={() => setLayersOpen((v) => !v)}
            >
              <Layers size={19} />
            </button>
            {layersOpen && (
              <div className="map-layer-panel">
                <div>
                  <b>Map layers</b>
                  <button
                    aria-label="Close map layers"
                    onClick={() => setLayersOpen(false)}
                  >
                    <X size={15} />
                  </button>
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={showTrack}
                    onChange={(e) => setShowTrack(e.target.checked)}
                  />
                  Mission track
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={showContacts}
                    onChange={(e) => setShowContacts(e.target.checked)}
                  />
                  Contacts
                </label>
                {depths.length > 1 && (
                  <label>
                    <input
                      type="checkbox"
                      checked={showDepth}
                      onChange={(e) => setShowDepth(e.target.checked)}
                    />
                    Supplied depth
                  </label>
                )}
              </div>
            )}
          </div>
          <div className="map-compass" title="Map north">
            <span>N</span>
            <Navigation size={24} fill="currentColor" />
          </div>
          {depths.length > 1 && showDepth && (
            <DepthProfile
              points={survey.track}
              min={min}
              max={max}
              selected={selectedContact}
              demo={survey.source === "PRESENTATION"}
            />
          )}
          <div className="map-bottom-meta">
            <span>
              <i />
              Mission track
            </span>
            <span>
              {points.length}{" "}
              {survey.source === "PRESENTATION" ? "illustrative" : "supplied"}{" "}
              fixes
            </span>
            {survey.source === "PRESENTATION" && <IllustrativeNote compact />}
          </div>
          {tileError && (
            <div className="map-tile-error" role="status">
              Basemap connection interrupted. Supplied navigation remains
              visible.
            </div>
          )}
        </>
      )}
      {preview && (
        <>
          <div className="preview-map-label">
            <span className="eyebrow">
              {survey.source === "PRESENTATION"
                ? "ILLUSTRATIVE NAVIGATION"
                : syntheticDemoMetadata
                  ? "ILLUSTRATIVE SURVEY METADATA"
                  : "SUPPLIED FRAME NAVIGATION"}
            </span>
            <h3>A connected operational picture.</h3>
            <span>
              <Check size={13} />
              Contacts · source observations · supplied navigation
            </span>
          </div>
          <Link to="/intake" className="preview-map-cta">
            Enter your station
            <ArrowUpRight size={16} />
          </Link>
        </>
      )}
    </section>
  );
}
function DepthProfile({
  points,
  min,
  max,
  selected,
  demo,
}: {
  points: (TrackPoint | null)[];
  min: number;
  max: number;
  selected?: Contact;
  demo: boolean;
}) {
  const width = 360,
    height = 66;
  const coords = points.map((p, i) =>
    p?.depthM !== null && p?.depthM !== undefined
      ? {
          x: 10 + (i / (points.length - 1 || 1)) * (width - 20),
          y: 8 + ((p.depthM - min) / (max - min || 1)) * (height - 16),
          p,
        }
      : null,
  );
  let path = "";
  let pen = false;
  coords.forEach((p) => {
    if (p) {
      path += `${pen ? "L" : "M"}${p.x},${p.y} `;
      pen = true;
    } else pen = false;
  });
  return (
    <div className="depth-profile">
      <header>
        <div>
          <span className="eyebrow">DEPTH ALONG TRACK</span>
          <strong>
            {selected?.position?.depthM !== null &&
            selected?.position?.depthM !== undefined
              ? `${selected.position.depthM.toFixed(1)} m`
              : `${min.toFixed(1)}–${max.toFixed(1)} m`}
          </strong>
        </div>
        <span>
          {selected
            ? selected.shortId
            : demo
              ? "Illustrative samples"
              : "Supplied samples"}
        </span>
      </header>
      <div className="depth-chart">
        <div className="depth-axis">
          <span>{min.toFixed(1)}</span>
          <span>{max.toFixed(1)} m</span>
        </div>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${demo ? "Illustrative" : "Supplied"} depth profile, ${min.toFixed(1)} to ${max.toFixed(1)} metres. Increasing depth goes down.`}
        >
          <path
            className="chart-grid"
            d={`M0 10H${width}M0 ${height - 8}H${width}`}
          />
          <path className="depth-line" d={path} />
          {coords.map((p, i) =>
            p ? (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={2}
                fill={depthColor(p.p.depthM!, min, max)}
              >
                <title>
                  Fix {i + 1}: {p.p.depthM} m
                </title>
              </circle>
            ) : null,
          )}
        </svg>
      </div>
      <footer>
        <span>START</span>
        <span>{demo ? "ILLUSTRATIVE FIX ORDER" : "RECORDED FIX ORDER"}</span>
        <span>END</span>
      </footer>
    </div>
  );
}
