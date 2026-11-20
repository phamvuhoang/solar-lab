import type { Project } from '../domain/types';
import { parseNumber } from '../domain/units';
import { NEAR_KM, nearestBundled } from '../weather/nearest';
import { h } from './dom';

export function parseLocation(lat: string, lon: string): { ok: true; latitude: number; longitude: number } | { ok: false; message: string } {
  const la = parseNumber(lat.trim()), lo = parseNumber(lon.trim());
  if (la === null || la < -90 || la > 90) return { ok: false, message: 'Vĩ độ phải là số từ −90 đến 90.' };
  if (lo === null || lo < -180 || lo > 180) return { ok: false, message: 'Kinh độ phải là số từ −180 đến 180.' };
  return { ok: true, latitude: la, longitude: lo };
}

export function renderLocationForm(p: Project, apply: (next: Project) => Promise<void>): HTMLElement {
  const lat = h('input', { id: 'loc-lat', type: 'text', inputmode: 'decimal', 'aria-label': 'Vĩ độ (độ)' });
  const lon = h('input', { id: 'loc-lon', type: 'text', inputmode: 'decimal', 'aria-label': 'Kinh độ (độ)' });
  if (p.location) { lat.value = String(p.location.latitude); lon.value = String(p.location.longitude); }
  const note = h('p', { id: 'loc-note', role: 'status' });
  const save = h('button', { id: 'loc-save', type: 'button' }, 'Lưu nơi lắp');
  save.addEventListener('click', async () => {
    const r = parseLocation(lat.value, lon.value);
    if (!r.ok) { note.textContent = r.message; return; }
    const n = await nearestBundled(r.latitude, r.longitude);
    const next = structuredClone(p);
    next.location = { latitude: r.latitude, longitude: r.longitude, timezone: p.location?.timezone ?? 'Asia/Ho_Chi_Minh' };
    if (n && !p.pv?.weatherId) next.pv = { ...next.pv, weatherId: n.id };
    await apply(next);
    const km = Math.round(n?.km ?? 0);
    const msg = !n ? '' : n.km <= NEAR_KM ? `Dùng bộ thời tiết đóng gói "${n.label}" (cách ${km} km).`
      : `Bộ thời tiết đóng gói gần nhất cách ${km} km ("${n.label}"): kết quả sẽ lệch so với nơi lắp; nên nhập CSV thời tiết của nơi lắp ở mục Thời tiết.`;
    note.textContent = msg;
    const live = document.getElementById('loc-note'); if (live) live.textContent = msg; // apply re-renders the tab, so the visible note is the new one
  });
  return h('div', {}, h('label', {}, 'Vĩ độ ', lat), ' ', h('label', {}, 'Kinh độ ', lon), ' ', save, note);
}
