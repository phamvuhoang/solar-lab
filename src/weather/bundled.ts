import { parseWeatherCsv, type ParseResult } from './csv';

/**
 * Datasets shipped with the app. Loaded lazily so the first paint does not carry ~400 kB of CSV; `location` is the CSV header's,
 * copied here so a screen can say how far the site is without loading it (tests/unit/location.test.ts keeps the two equal).
 */
export const BUNDLED_WEATHER = [
  { id: 'lam-ha-2023-pvgis-era5', label: 'Lâm Hà (xấp xỉ cấp huyện) · PVGIS-ERA5 · 2023', location: { latitude: 11.87, longitude: 108.2 },
    load: () => import('../../data/weather/lam-ha-2023-pvgis-era5.csv?raw').then((m) => m.default) },
] as const;

export async function loadBundledWeather(id: string): Promise<ParseResult | null> {
  const b = BUNDLED_WEATHER.find((x) => x.id === id);
  return b ? parseWeatherCsv(await b.load(), { seriesId: id }) : null;
}
