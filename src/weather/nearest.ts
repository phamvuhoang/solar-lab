import { BUNDLED_WEATHER, loadBundledWeather } from './bundled';

export const NEAR_KM = 50;
type Pt = { latitude: number; longitude: number };

/** Haversine distance, R = 6371 km. */
export function kmBetween(a: Pt, b: Pt): number {
  const r = Math.PI / 180, dLat = (b.latitude - a.latitude) * r, dLon = (b.longitude - a.longitude) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

export async function nearestBundled(latitude: number, longitude: number): Promise<{ id: string; label: string; km: number } | null> {
  let best: { id: string; label: string; km: number } | null = null;
  for (const b of BUNDLED_WEATHER) {
    const r = await loadBundledWeather(b.id);
    if (!r?.ok) continue;
    const km = kmBetween({ latitude, longitude }, r.series.location);
    if (!best || km < best.km) best = { id: b.id, label: b.label, km };
  }
  return best;
}
