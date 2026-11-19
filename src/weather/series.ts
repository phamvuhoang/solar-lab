export type WeatherMethod = 'measured' | 'historical' | 'tmy' | 'synthetic';
export type Convention = 'start' | 'mid' | 'end';

/**
 * Regular UTC series, canonical form: `t0` is the START of the first interval and every value is the mean over its
 * interval [t0 + i·step, t0 + (i+1)·step). Units: W/m², °C, m/s. null = the column does not exist.
 */
export interface WeatherSeries {
  schemaVersion: 1; seriesId: string; name: string;
  location: { latitude: number; longitude: number; elevationM: number | null };
  source: { name: string; version: string | null; url: string | null; retrieved: string | null; method: WeatherMethod; period: string | null; license: string | null };
  stepSeconds: number; t0: number; n: number;
  ghi: number[] | null; dni: number[] | null; dhi: number[] | null; poa: number[] | null; tempAirC: number[] | null; windMs: number[] | null;
  /** What was done to the file on import (timestamp shift, unused columns...). */
  notes: string[];
}

export const tsAt = (s: Pick<WeatherSeries, 't0' | 'stepSeconds'>, i: number) => s.t0 + i * s.stepSeconds;
export const midAt = (s: Pick<WeatherSeries, 't0' | 'stepSeconds'>, i: number) => s.t0 + (i + 0.5) * s.stepSeconds;

export function yearLengthDays(year: number): number { return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000; }

export function formatUtc(epochSeconds: number): string { return new Date(epochSeconds * 1000).toISOString().replace('.000Z', 'Z'); }

/** Strict ISO 8601 with explicit UTC or numeric offset → epoch seconds, or null. Rejects naive times and impossible dates (2023-02-29). */
export function parseTimestamp(text: string): { epoch: number; offset: boolean } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.0+)?(Z|[+-]\d{2}:\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const chk = new Date(ms);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  let off = 0;
  if (m[7] !== 'Z') { const sign = m[7][0] === '-' ? -1 : 1; off = sign * (Number(m[7].slice(1, 3)) * 3600 + Number(m[7].slice(4, 6)) * 60); }
  return { epoch: ms / 1000 - off, offset: m[7] !== 'Z' && off !== 0 };
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** yyyy-mm-dd of an instant in an IANA zone (the project's local day, e.g. Asia/Ho_Chi_Minh). */
export function localDate(epochSeconds: number, timeZone: string): string {
  let f = fmtCache.get(timeZone);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); fmtCache.set(timeZone, f); }
  return f.format(new Date(epochSeconds * 1000));
}
const hourCache = new Map<string, Intl.DateTimeFormat>();
/** Local clock hour 0–23 in an IANA zone. The formatter is cached: dispatch calls this twice per step. */
export function localHour(epochSeconds: number, timeZone: string): number {
  let f = hourCache.get(timeZone);
  if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }); hourCache.set(timeZone, f); }
  return Number(f.format(new Date(epochSeconds * 1000)));
}
