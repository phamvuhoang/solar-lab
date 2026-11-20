import type { Project } from '../domain/types';
import { BUNDLED_WEATHER } from './bundled';

export const NEAR_KM = 50;
type Pt = { latitude: number; longitude: number };

/** Haversine distance, R = 6371 km. */
export function kmBetween(a: Pt, b: Pt): number {
  const r = Math.PI / 180, dLat = (b.latitude - a.latitude) * r, dLon = (b.longitude - a.longitude) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function nearestBundled(latitude: number, longitude: number): { id: string; label: string; km: number } | null {
  let best: { id: string; label: string; km: number } | null = null;
  for (const b of BUNDLED_WEATHER) {
    const km = kmBetween({ latitude, longitude }, b.location);
    if (!best || km < best.km) best = { id: b.id, label: b.label, km };
  }
  return best;
}

/** The bundled dataset the project runs on, when it is more than NEAR_KM from the site; null when near, imported or no site set. */
export function farWeather(p: Project): { label: string; km: number } | null {
  const b = BUNDLED_WEATHER.find((x) => x.id === p.pv?.weatherId);
  if (!b || !p.location) return null;
  const km = kmBetween(p.location, b.location);
  return km > NEAR_KM ? { label: b.label, km } : null;
}

/** The sentence every screen uses for it (the location form, "Giả định đang dùng"). */
export const farText = (f: { label: string; km: number }) =>
  `Bộ thời tiết "${f.label}" cách nơi lắp ${Math.round(f.km).toLocaleString('vi-VN')} km: kết quả sẽ lệch so với nơi lắp; nên nhập CSV thời tiết của nơi lắp ở mục Thời tiết.`;
