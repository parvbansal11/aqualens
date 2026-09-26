import type { ChangeStatus, Survey } from "@/lib/types";
import { CHANGE_STATUS_ACCENT, CHANGE_STATUS_LABEL } from "@/lib/view/labels";

const VIEW_W = 640;
const VIEW_H = 360;
const PAD = 0.0015;

interface Bounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

function project(lon: number, lat: number, b: Bounds): string {
  const x = ((lon - b.minLon) / (b.maxLon - b.minLon)) * VIEW_W;
  const y = ((b.maxLat - lat) / (b.maxLat - b.minLat)) * VIEW_H;
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}

function ringPoints(survey: Survey, b: Bounds): string | null {
  const ring = survey.coverage_polygon?.coordinates[0];
  if (!ring?.length) return null;
  return ring.map(([lon, lat]) => project(lon, lat, b)).join(" ");
}

function trackPoints(survey: Survey, b: Bounds): string | null {
  const line = survey.track?.coordinates;
  if (!line?.length) return null;
  return line.map(([lon, lat]) => project(lon, lat, b)).join(" ");
}

export interface CoverageMarker {
  change_id: string;
  status: ChangeStatus;
  lon: number;
  lat: number;
}

/**
 * Renders coverage polygons and tracks from the geometry on the Survey objects.
 *
 * Marker positions come from the caller and must be real geographic positions
 * from change records. There are no fallback marker coordinates in this file:
 * a change record without a position is simply not drawn, and the caller is
 * expected to say so in the list beside the map.
 */
export function CoverageMap({
  surveys,
  markers = [],
  highlight = "ALL",
}: {
  surveys: Survey[];
  markers?: CoverageMarker[];
  highlight?: ChangeStatus | "ALL";
}) {
  const rings = surveys.flatMap((survey) => survey.coverage_polygon?.coordinates[0] ?? []);
  if (rings.length === 0) {
    return (
      <p className="coverage-empty">
        No coverage polygon is present on the selected surveys, so no extent can be drawn.
      </p>
    );
  }

  const lons = rings.map(([lon]) => lon);
  const lats = rings.map(([, lat]) => lat);
  const bounds: Bounds = {
    minLon: Math.min(...lons) - PAD,
    maxLon: Math.max(...lons) + PAD,
    minLat: Math.min(...lats) - PAD,
    maxLat: Math.max(...lats) + PAD,
  };

  const [baseline, resurvey] = surveys;

  return (
    <svg
      className="coverage-svg"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label="Survey coverage polygons and vessel tracks, projected from survey geometry."
    >
      <defs>
        <pattern id="coverage-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
          <path d="M0 0 V8" stroke="var(--hatch)" strokeWidth="2" opacity="0.45" />
        </pattern>
      </defs>

      <rect width={VIEW_W} height={VIEW_H} className="coverage-sea" />
      <g className="coverage-grid">
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`v${i}`} x1={i * 80} y1={0} x2={i * 80} y2={VIEW_H} />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={i * 72} x2={VIEW_W} y2={i * 72} />
        ))}
      </g>

      {baseline && ringPoints(baseline, bounds) && (
        <polygon points={ringPoints(baseline, bounds) as string} className="poly-baseline" />
      )}
      {resurvey && ringPoints(resurvey, bounds) && (
        <polygon points={ringPoints(resurvey, bounds) as string} className="poly-new" />
      )}
      {baseline && trackPoints(baseline, bounds) && (
        <polyline points={trackPoints(baseline, bounds) as string} className="track-baseline" />
      )}
      {resurvey && trackPoints(resurvey, bounds) && (
        <polyline points={trackPoints(resurvey, bounds) as string} className="track-new" />
      )}

      {markers.map((marker) => {
        const [x, y] = project(marker.lon, marker.lat, bounds).split(",").map(Number);
        const faded = highlight !== "ALL" && highlight !== marker.status;
        const accent = CHANGE_STATUS_ACCENT[marker.status];
        const title = CHANGE_STATUS_LABEL[marker.status];
        // NOT_SURVEYED is an outlined square, never a filled dot, so it cannot be
        // read as an observation at that position.
        return marker.status === "NOT_SURVEYED" ? (
          <rect
            key={marker.change_id}
            x={x - 7}
            y={y - 7}
            width={14}
            height={14}
            fill="none"
            stroke={accent}
            strokeWidth={2}
            strokeDasharray="3 2"
            opacity={faded ? 0.25 : 1}
          >
            <title>{title}</title>
          </rect>
        ) : (
          <circle
            key={marker.change_id}
            cx={x}
            cy={y}
            r={marker.status === "REMOVED" ? 8 : 6}
            fill={accent}
            opacity={faded ? 0.25 : 1}
          >
            <title>{title}</title>
          </circle>
        );
      })}
    </svg>
  );
}

export function CoverageLegend() {
  return (
    <p className="map-legend">
      <span><i style={{ background: "rgba(126,160,140,0.5)" }} aria-hidden="true" />Baseline coverage</span>
      <span><i style={{ background: "rgba(62,168,154,0.5)" }} aria-hidden="true" />Resurvey coverage</span>
      <span><i style={{ background: "var(--hatch)", opacity: 0.4 }} aria-hidden="true" />Hatched area was not surveyed by the new pass</span>
    </p>
  );
}
