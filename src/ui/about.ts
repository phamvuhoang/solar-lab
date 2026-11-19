import { h } from './dom';

/** The shape of dist/release-manifest.json (scripts/make-manifest.mjs). */
export interface Manifest {
  manifestVersion: 1; app: { name: string; version: string; buildId: string; commit: string | null };
  formats: { project: number; package: number; indexedDb: number }; engines: { pv: string; dispatch: string; shade: string };
  catalog: { components: number; offers: number; sha256: { components: string; offers: string }; unreviewed: string[] };
  weather: { id: string; sha256: string; rows: number }[]; schemas: Record<string, string>; verification: { model: string; field: string };
}

export async function loadManifest(): Promise<Manifest | null> {
  try { const r = await fetch('./release-manifest.json', { cache: 'no-cache' }); return r.ok ? ((await r.json()) as Manifest) : null; } catch { return null; }
}

export async function renderAbout(back: () => void, load: () => Promise<Manifest | null> = loadManifest): Promise<Node[]> {
  const m = await load();
  const row = (k: string, v: string) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, v));
  return [
    h('h2', {}, 'Phiên bản và phạm vi kiểm chứng'), h('button', { id: 'about-back', onClick: back }, 'Quay lại'),
    !m ? h('p', { id: 'about-missing', role: 'alert' }, 'Không đọc được release-manifest.json (bản dev hoặc build lỗi).') : h('table', { id: 'about-table' }, h('tbody', {},
      row('Ứng dụng', `${m.app.name} ${m.app.version} (build ${m.app.buildId}${m.app.commit ? ', commit ' + m.app.commit.slice(0, 8) : ''})`),
      row('Engine', `${m.engines.pv} · ${m.engines.dispatch} · ${m.engines.shade}`),
      row('Định dạng', `dự án v${m.formats.project} · gói chia sẻ v${m.formats.package} · IndexedDB v${m.formats.indexedDb}`),
      row('Catalog', `${m.catalog.components} thiết bị, ${m.catalog.offers} báo giá mẫu; mã băm ${m.catalog.sha256.components.slice(0, 12)} / ${m.catalog.sha256.offers.slice(0, 12)}`),
      row('Chưa kiểm datasheet bởi người thứ hai', m.catalog.unreviewed.length ? `${m.catalog.unreviewed.length}/${m.catalog.components} thiết bị` : 'không có'),
      row('Dữ liệu thời tiết đóng gói', m.weather.map((w) => `${w.id} (${w.rows} bước, mã ${w.sha256.slice(0, 12)})`).join('; ')),
      row('Đã đối chiếu', m.verification.model), row('Chưa đối chiếu', m.verification.field))),
  ];
}
