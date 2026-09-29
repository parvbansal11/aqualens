/**
 * Seafloor depth context at a point, read from the same Terrain Tiles DEM the map draws. Terrarium
 * encoding: elevation = R*256 + G + B/256 - 32768 metres. Ocean values derive from ETOPO1, so this is
 * regional context on a ~1.8 km grid: never an object depth and never measured by Aqualens.
 */
import { DEM_MAXZOOM, DEM_TILES } from "./style";

const ZOOM = Math.min(10, DEM_MAXZOOM);
const tiles = new Map<string, Promise<ImageData | null>>();

function tile(z: number, x: number, y: number) {
  const key = `${z}/${x}/${y}`;
  if (!tiles.has(key)) {
    tiles.set(
      key,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(img, 0, 0);
          resolve(ctx.getImageData(0, 0, img.width, img.height));
        };
        img.onerror = () => resolve(null);
        img.src = DEM_TILES.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      }),
    );
  }
  return tiles.get(key)!;
}

export interface DepthContext {
  /** Elevation in metres from the DEM; negative below sea level. */
  elevation: number;
}

export async function depthAt(lon: number, lat: number): Promise<DepthContext | null> {
  const n = 2 ** ZOOM;
  const fx = ((lon + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const data = await tile(ZOOM, Math.floor(fx), Math.floor(fy));
  if (!data) return null;
  const px = Math.min(data.width - 1, Math.floor((fx % 1) * data.width));
  const py = Math.min(data.height - 1, Math.floor((fy % 1) * data.height));
  const i = (py * data.width + px) * 4;
  const elevation = data.data[i] * 256 + data.data[i + 1] + data.data[i + 2] / 256 - 32768;
  return Number.isFinite(elevation) ? { elevation } : null;
}
