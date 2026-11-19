import { parseWeatherCsv, type ParseResult } from './csv';

/** Datasets shipped with the app. Loaded lazily so the first paint does not carry ~400 kB of CSV. */
export const BUNDLED_WEATHER = [
  { id: 'lam-ha-2023-pvgis-era5', label: 'Lâm Hà (xấp xỉ cấp huyện) · PVGIS-ERA5 · 2023', load: () => import('../../data/weather/lam-ha-2023-pvgis-era5.csv?raw').then((m) => m.default) },
] as const;

export async function loadBundledWeather(id: string): Promise<ParseResult | null> {
  const b = BUNDLED_WEATHER.find((x) => x.id === id);
  return b ? parseWeatherCsv(await b.load(), { seriesId: id }) : null;
}
