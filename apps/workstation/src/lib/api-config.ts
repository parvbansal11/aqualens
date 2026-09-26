/**
 * Single source of truth for the backend origin. Every module that talks to
 * the FastAPI backend imports from here instead of reading process.env
 * directly, so there is exactly one place that defines the local-dev default
 * and the production override.
 */
const DEFAULT_API_ORIGIN = "http://127.0.0.1:8000";

function resolveApiOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!raw) return DEFAULT_API_ORIGIN;
  return raw.replace(/\/+$/, "");
}

/** The backend origin, e.g. "http://127.0.0.1:8000" or "https://api.example.com". */
export const API_ORIGIN = resolveApiOrigin();

/** The versioned REST base every endpoint path is relative to. */
export const API_V1_BASE_URL = `${API_ORIGIN}/api/v1`;
