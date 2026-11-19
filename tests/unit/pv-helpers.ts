import type { PvInput, PvModel, PvString } from '../../src/engine/pv';
import type { WeatherSeries } from '../../src/weather/series';

export const wx = (o: Partial<WeatherSeries> & { n: number }): WeatherSeries => ({
  schemaVersion: 1, seriesId: 'wx-test', name: 'test', location: { latitude: 11.87, longitude: 108.2, elevationM: 978 },
  source: { name: 'test', version: null, url: null, retrieved: null, method: 'synthetic', period: null, license: null },
  stepSeconds: 3600, t0: Date.UTC(2023, 11, 21) / 1000, ghi: null, dni: null, dhi: null, poa: null, tempAirC: null, windMs: null, notes: [], ...o,
});
export const model = (o: Partial<PvModel> = {}): PvModel => ({
  irradianceInput: 'auto', tiltDeg: 20, azimuthDeg: 180, albedo: 0.2, cellModel: 'fixed', faimanU0: 25, faimanU1: 6.84, fixedCellTempC: 25, windFallbackMs: null, lossRatio: 0, applyLimits: false, ...o,
});
export const panel = (pstcW = 620, gamma = -0.0029, vmpV: number | null = 41.23) => ({ pstcW, gamma, vmpV });
export const str = (n: number, trackerId = 'T1', id = 'S1'): PvString => ({ id, label: id, panels: Array.from({ length: n }, () => panel()), trackerId });
export const input = (weather: WeatherSeries, m: PvModel, strings: PvString[] = [str(8)], trackers = [{ id: 'T1', label: 'T1', inverterId: null as string | null, maxPowerW: null as number | null, maxCurrentA: null as number | null }], inverters: PvInput['inverters'] = []): PvInput =>
  ({ weather, weatherHash: 'h', model: m, strings, trackers, inverters });
