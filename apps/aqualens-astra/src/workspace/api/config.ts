/**
 * The one place the workspace learns where the Aqualens API lives.
 * Set VITE_AQUALENS_API_BASE_URL (or VITE_API_BASE_URL) at build time; .env.local for development.
 */
// VITE_API_BASE_URL is the name the production Vercel project already defines; either works.
const fromEnv = ((import.meta.env.VITE_AQUALENS_API_BASE_URL ?? import.meta.env.VITE_API_BASE_URL) as string | undefined)?.trim();

// The loopback default exists for local development only. A production build must be given its
// API origin explicitly; without one the workspace reports the service as unavailable.
export const API_BASE = (fromEnv || (import.meta.env.DEV ? "http://127.0.0.1:8000/api/v1" : "")).replace(/\/+$/, "");

/** Origin of the API, for backend-relative asset paths such as raster URLs. */
export const API_ORIGIN = API_BASE ? new URL(API_BASE).origin : "";

export const assetUrl = (path: string) => (/^https?:/.test(path) ? path : `${API_ORIGIN}${path.startsWith("/") ? "" : "/"}${path}`);
