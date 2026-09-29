/**
 * Aqualens map style. Every geographic layer comes from an external open source and is credited:
 *  - Basemap: OpenFreeMap vector tiles (OpenMapTiles schema, OpenStreetMap data). No key.
 *  - Seafloor context: AWS Terrain Tiles (Mapzen "terrarium" DEM). Its ocean values come from
 *    ETOPO1 (NOAA NCEI) at roughly 1.8 km resolution. Context only: never an Aqualens measurement.
 * The mission track and Contacts are Aqualens data, drawn on top.
 */
import type { StyleSpecification } from "maplibre-gl";

export type MapTheme = "light" | "dark";

export const BASEMAP_URL = "https://tiles.openfreemap.org/planet";
export const GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const DEM_TILES = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
export const DEM_MAXZOOM = 12;

export const ATTRIBUTION = {
  basemap: '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
  dem: 'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Terrain Tiles</a> (Mapzen, AWS Open Data) incl. ETOPO1 © NOAA NCEI',
};

/**
 * Depth bands used by both the map tint and the legend, so the legend can never disagree with the
 * map. Values are metres below sea level in the source DEM.
 */
export const DEPTH_STOPS = [0, 200, 1000, 2000, 3000, 4000, 5000] as const;

const PALETTE = {
  light: {
    land: "#efece4",
    landcover: "#e8e5dc",
    water: "#d7e2e3",
    boundary: "rgba(74, 78, 76, 0.42)",
    boundaryFaint: "rgba(74, 78, 76, 0.16)",
    country: "#4f5652",
    city: "#6c726e",
    halo: "rgba(245, 242, 235, 0.92)",
    ocean: "#5f7f86",
    depth: ["#cfe0e2", "#b3cdd2", "#8fb1ba", "#6e95a1", "#557f8d", "#41697a", "#2f5566"],
    shadow: "#26434d",
    highlight: "#ffffff",
  },
  dark: {
    land: "#161a1c",
    landcover: "#1a1f21",
    water: "#0b161b",
    boundary: "rgba(233, 230, 222, 0.30)",
    boundaryFaint: "rgba(233, 230, 222, 0.10)",
    country: "#a9ada7",
    city: "#8a8f8a",
    halo: "rgba(8, 12, 14, 0.9)",
    ocean: "#5c7c83",
    depth: ["#3a7580", "#2d6470", "#22505d", "#1a3f4c", "#13303c", "#0d232e", "#081820"],
    shadow: "#000000",
    highlight: "#7fb3bd",
  },
} as const;

export const depthColors = (theme: MapTheme) => PALETTE[theme].depth;

const name = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]] as unknown as string;

export interface Layers {
  bathymetry: boolean;
  track: boolean;
}

export function buildStyle(theme: MapTheme, layers: Layers): StyleSpecification {
  const p = PALETTE[theme];
  const depth = p.depth;
  const vis = (on: boolean) => (on ? "visible" : "none") as "visible" | "none";
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      openmaptiles: { type: "vector", url: BASEMAP_URL, attribution: ATTRIBUTION.basemap },
      dem: { type: "raster-dem", tiles: [DEM_TILES], encoding: "terrarium", tileSize: 256, maxzoom: DEM_MAXZOOM, attribution: ATTRIBUTION.dem },
      // Terrain gets its own source instance, as MapLibre recommends when hillshade shares the DEM.
      "dem-terrain": { type: "raster-dem", tiles: [DEM_TILES], encoding: "terrarium", tileSize: 256, maxzoom: DEM_MAXZOOM },
      track: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      "track-points": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      { id: "land", type: "background", paint: { "background-color": p.land } },
      {
        id: "landcover",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["in", ["get", "class"], ["literal", ["ice", "sand", "wetland"]]],
        paint: { "fill-color": p.landcover, "fill-opacity": 0.6 },
      },
      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": p.water } },
      // Seafloor depth tint straight from the DEM. Elevations at or above sea level stay transparent.
      {
        id: "bathymetry",
        type: "color-relief",
        source: "dem",
        layout: { visibility: vis(layers.bathymetry) },
        paint: {
          "color-relief-opacity": 0.92,
          "color-relief-color": [
            "interpolate",
            ["linear"],
            ["elevation"],
            -5000, depth[6],
            -4000, depth[5],
            -3000, depth[4],
            -2000, depth[3],
            -1000, depth[2],
            -200, depth[1],
            -1, depth[0],
            0, "rgba(0,0,0,0)",
          ],
        },
      } as never,
      {
        id: "seafloor-relief",
        type: "hillshade",
        source: "dem",
        layout: { visibility: vis(layers.bathymetry) },
        paint: {
          "hillshade-exaggeration": theme === "dark" ? 0.55 : 0.4,
          "hillshade-shadow-color": p.shadow,
          "hillshade-highlight-color": p.highlight,
          "hillshade-accent-color": p.shadow,
        },
      },
      // The basemap's water outline, redrawn above the tint so coastlines stay crisp.
      { id: "coast", type: "line", source: "openmaptiles", "source-layer": "water", paint: { "line-color": p.boundaryFaint, "line-width": 0.6 } },
      {
        id: "boundary-country",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": p.boundary, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.2], "line-dasharray": [3, 2] },
      },
      {
        id: "boundary-state",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        minzoom: 5,
        filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": p.boundaryFaint, "line-width": 0.6 },
      },
      // Mission track: one thin line, direction ticks, and quiet fix points.
      {
        id: "track-line",
        type: "line",
        source: "track",
        layout: { visibility: vis(layers.track), "line-cap": "round", "line-join": "round" },
        paint: { "line-color": theme === "dark" ? "#e3a95a" : "#a9571a", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.4, 14, 2.6], "line-opacity": 0.92 },
      },
      {
        id: "track-direction",
        type: "symbol",
        source: "track",
        minzoom: 11,
        layout: { visibility: vis(layers.track), "symbol-placement": "line", "symbol-spacing": 70, "icon-image": `aq-arrow-${theme}`, "icon-size": 0.6, "icon-allow-overlap": true, "icon-rotation-alignment": "map" },
      },
      {
        id: "track-points",
        type: "circle",
        source: "track-points",
        minzoom: 11,
        layout: { visibility: vis(layers.track) },
        paint: {
          "circle-radius": ["case", ["get", "endpoint"], 5, 3],
          "circle-color": theme === "dark" ? "#0b161b" : "#f5f2eb",
          "circle-stroke-color": theme === "dark" ? "#e3a95a" : "#a9571a",
          "circle-stroke-width": ["case", ["get", "endpoint"], 2, 1.4],
        },
      },
      {
        id: "ocean-names",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "water_name",
        filter: ["in", ["get", "class"], ["literal", ["ocean", "sea", "bay", "strait"]]],
        layout: {
          "text-field": name,
          "text-font": ["Noto Sans Italic"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 7, 15],
          "text-letter-spacing": 0.18,
          "text-max-width": 8,
        },
        paint: { "text-color": p.ocean, "text-halo-color": p.halo, "text-halo-width": 0.6 },
      },
      {
        id: "places-city",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 5.5,
        filter: ["all", ["==", ["get", "class"], "city"], ["<=", ["coalesce", ["get", "rank"], 99], ["step", ["zoom"], 3, 7, 5, 9, 8]]],
        layout: { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": 11.5, "text-anchor": "left", "text-offset": [0.5, 0] },
        paint: { "text-color": p.city, "text-halo-color": p.halo, "text-halo-width": 1.2 },
      },
      {
        id: "places-island",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 5,
        filter: ["in", ["get", "class"], ["literal", ["island", "archipelago"]]],
        layout: { "text-field": name, "text-font": ["Noto Sans Italic"], "text-size": 11 },
        paint: { "text-color": p.city, "text-halo-color": p.halo, "text-halo-width": 1 },
      },
      {
        id: "places-country",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["==", ["get", "class"], "country"],
        layout: {
          "text-field": name,
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10.5, 6, 14],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.2,
          "text-max-width": 7,
        },
        paint: { "text-color": p.country, "text-halo-color": p.halo, "text-halo-width": 1.2 },
      },
    ],
  };
}

/** Direction chevron drawn once per theme and registered with the map on demand. */
export function arrowImage(theme: MapTheme) {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = theme === "dark" ? "#e3a95a" : "#a9571a";
  ctx.lineWidth = 3.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(11, 8);
  ctx.lineTo(21, 16);
  ctx.lineTo(11, 24);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}
