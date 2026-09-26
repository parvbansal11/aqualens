/**
 * Presentation helpers. Every one of these returns null for a null input so a
 * caller cannot accidentally render a zero where a value was unavailable.
 * There is no sentinel zero anywhere in this layer.
 */

export function percent(value: number | null | undefined, digits = 0): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${(value * 100).toFixed(digits)}%`;
}

export function fixed(value: number | null | undefined, digits = 2): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toFixed(digits);
}

export function integer(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toLocaleString();
}

export function pixels(value: number | null | undefined, digits = 1): string | null {
  const n = fixed(value, digits);
  return n === null ? null : `${n} px`;
}

export function metres(value: number | null | undefined, digits = 1): string | null {
  const n = fixed(value, digits);
  return n === null ? null : `${n} m`;
}

export function timestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function humanise(key: string): string {
  return key.replaceAll("_", " ");
}

export function shortSha(value: string | null | undefined, length = 12): string | null {
  if (!value) return null;
  return value.length <= length ? value : `${value.slice(0, length)}...`;
}
