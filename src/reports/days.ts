import { REASONS } from '../engine/dispatch';
import type { SimResult } from '../engine/system';
import { localDate } from '../weather/series';

const SHORT = 1 << REASONS.indexOf('UNSERVED_LOAD'); // the steps the engine counts in hoursShort

/**
 * The engine's hourly series re-counted by local day: of the local days the data covers in full (24 hourly steps), how many have a
 * step with load not served. Not a new number: the same steps as hoursShort, grouped. A day cut by the ends of the data is left out.
 * ponytail: a full day is 86400 s of steps, so a 23-hour daylight-saving day is never full; no Vietnamese zone has one.
 */
export function daysShort(r: SimResult, timeZone: string): { short: number; days: number } {
  const { series: s, period } = r.dispatch, perDay = 86400 / period.stepSeconds;
  const by = new Map<string, { n: number; short: boolean }>();
  s.t.forEach((t, i) => {
    const day = localDate(t + period.stepSeconds / 2, timeZone), d = by.get(day) ?? { n: 0, short: false }; // the step's middle, as the replay
    d.n++; d.short ||= (s.reasons[i] & SHORT) !== 0;
    by.set(day, d);
  });
  const full = [...by.values()].filter((d) => d.n >= perDay);
  return { short: full.filter((d) => d.short).length, days: full.length };
}
