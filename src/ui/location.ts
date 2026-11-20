import type { Project } from '../domain/types';
import { farText, farWeather, NEAR_KM, nearestBundled } from '../weather/nearest';
import { h } from './dom';

/** Decimal degrees: one dot or comma is the decimal mark ("10.823" is 10,823°, never ten thousand); no thousands grouping. */
const degrees = (s: string): number | null => { const t = s.trim().replace('−', '-').replace(',', '.'); return /^[+-]?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };

export function parseLocation(lat: string, lon: string): { ok: true; latitude: number; longitude: number } | { ok: false; message: string } {
  const la = degrees(lat), lo = degrees(lon);
  if (la === null || la < -90 || la > 90) return { ok: false, message: 'Vĩ độ phải là số từ −90 đến 90.' };
  if (lo === null || lo < -180 || lo > 180) return { ok: false, message: 'Kinh độ phải là số từ −180 đến 180.' };
  return { ok: true, latitude: la, longitude: lo };
}

export function renderLocationForm(p: Project, apply: (next: Project) => Promise<void>): HTMLElement {
  const lat = h('input', { id: 'loc-lat', type: 'text', inputmode: 'decimal', 'aria-label': 'Vĩ độ (độ)' });
  const lon = h('input', { id: 'loc-lon', type: 'text', inputmode: 'decimal', 'aria-label': 'Kinh độ (độ)' });
  if (p.location) { lat.value = String(p.location.latitude); lon.value = String(p.location.longitude); }
  const note = h('p', { id: 'loc-note', role: 'status' }); // what the last save did; empty on every paint
  const far = farWeather(p); // on every paint while it holds, not only right after a save
  const save = h('button', { id: 'loc-save', type: 'button' }, 'Lưu nơi lắp');
  save.addEventListener('click', async () => {
    const r = parseLocation(lat.value, lon.value);
    if (!r.ok) { note.textContent = r.message; return; }
    const n = nearestBundled(r.latitude, r.longitude);
    const next = structuredClone(p);
    next.location = { latitude: r.latitude, longitude: r.longitude, timezone: p.location?.timezone ?? 'Asia/Ho_Chi_Minh' };
    if (n && !p.pv?.weatherId) next.pv = { ...next.pv, weatherId: n.id };
    await apply(next);
    const f = farWeather(next);
    const msg = f ? `Đã lưu nơi lắp; bộ thời tiết đang dùng cách ${Math.round(f.km).toLocaleString('vi-VN')} km (xem ghi chú bên dưới).`
      : n && n.km <= NEAR_KM && next.pv?.weatherId === n.id ? `Dùng bộ thời tiết đóng gói "${n.label}" (cách ${Math.round(n.km)} km).` : 'Đã lưu nơi lắp.';
    note.textContent = msg;
    const live = document.getElementById('loc-note'); if (live) live.textContent = msg; // apply re-renders the tab, so the visible note is the new one
  });
  return h('div', {}, h('label', {}, 'Vĩ độ ', lat), ' ', h('label', {}, 'Kinh độ ', lon), ' ', save, note, far && h('p', { id: 'loc-far' }, farText(far)));
}
