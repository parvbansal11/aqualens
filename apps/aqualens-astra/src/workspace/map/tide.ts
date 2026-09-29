/**
 * Sea-level context from the Open-Meteo Marine API: modelled sea level height relative to mean sea
 * level, including tides (not a tide gauge, not for navigation). The time basis is explicit: survey
 * time only when the survey clock is measured; otherwise the current time at the track location.
 */
export interface SeaLevel {
  basis: "survey" | "now";
  at: string; // ISO hour the value belongs to (UTC)
  height: number; // metres relative to MSL (model)
  trend: "Rising" | "Falling" | "Steady";
  nextHigh: string | null; // ISO hour of the next modelled high
  nextLow: string | null;
  lat: number;
  lon: number;
}

const API = "https://marine-api.open-meteo.com/v1/marine";

export async function seaLevel(lat: number, lon: number, surveyTime: string | null): Promise<SeaLevel | null> {
  const basis = surveyTime ? "survey" : "now";
  const ref = surveyTime ? new Date(surveyTime) : new Date();
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(ref.getTime() + 2 * 86400000);
  const q = new URLSearchParams({ latitude: lat.toFixed(4), longitude: lon.toFixed(4), hourly: "sea_level_height_msl", timezone: "UTC", start_date: day(new Date(ref.getTime() - 86400000)), end_date: day(end) });
  try {
    const r = await fetch(`${API}?${q}`);
    if (!r.ok) return null;
    const body = await r.json();
    const times: string[] = body?.hourly?.time ?? [];
    const values: (number | null)[] = body?.hourly?.sea_level_height_msl ?? [];
    const series = times.map((t, i) => ({ t: `${t}:00Z`, v: values[i] })).filter((p): p is { t: string; v: number } => typeof p.v === "number");
    if (series.length < 3) return null;
    const hour = new Date(Math.floor(ref.getTime() / 3600000) * 3600000).toISOString().replace(".000", "");
    const i = series.findIndex((p) => p.t >= hour);
    if (i < 1 || i >= series.length - 1) return null;
    const next = series[i + 1].v - series[i].v;
    const extreme = (sign: 1 | -1) => {
      for (let k = i + 1; k < series.length - 1; k++) if (sign * (series[k].v - series[k - 1].v) > 0 && sign * (series[k].v - series[k + 1].v) >= 0) return series[k].t;
      return null;
    };
    return {
      basis,
      at: series[i].t,
      height: series[i].v,
      trend: Math.abs(next) < 0.01 ? "Steady" : next > 0 ? "Rising" : "Falling",
      nextHigh: extreme(1),
      nextLow: extreme(-1),
      lat: body.latitude,
      lon: body.longitude,
    };
  } catch {
    return null;
  }
}
