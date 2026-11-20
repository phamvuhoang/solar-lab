import type { Project } from '../domain/types';
import type { RecordedSet } from '../persistence/repository';
import type { RecordedRun } from '../reports/package';
import { CURRENT_ENGINES, replayRun, type ReplayOutcome, type ReplayStatus, type Runner } from '../reports/replay';
import type { WeatherSeries } from '../weather/series';
import { runPvInWorker, runShadeInWorker, runSimInWorker } from '../worker/client';
import { h } from './dom';

export interface ImportedState { outcomes: Map<string, ReplayOutcome>; busy: boolean }
export const freshImported = (): ImportedState => ({ outcomes: new Map(), busy: false });
export interface ImportedCtx { project: Project; recorded: RecordedSet; loadWeather(id: string): Promise<WeatherSeries | undefined>; state: ImportedState; rerender(): void; open(): void; back?(): void }

const STATUS_TEXT: Record<ReplayStatus, string> = {
  reproduced: 'Tái lập đúng (cùng engine, cùng mã đầu vào, mọi chỉ số trùng)',
  'engine-changed': 'Engine khác phiên bản: đây là kết quả MỚI, không phải bản đã ghi',
  mismatch: 'LỆCH: cùng engine nhưng mã đầu vào hoặc chỉ số khác',
  cannot: 'Không chạy lại được',
};
const kwh = (x: number | null | undefined) => (x === null || x === undefined ? '—' : (x / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' kWh');
const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : (x * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' %');
const key = (r: RecordedRun, ms: Record<string, number | null> | null) => !ms ? ['—', '—', '—', '—'] : r.kind === 'pv'
  ? [kwh(ms['pv.eInverterWh']), '—', '—', '—']
  : [kwh(ms['pv.eInverterWh']), kwh(ms['dispatch.loadServedWh']), pct(ms['metrics.minSoc']), kwh(ms['dispatch.unservedWh'])];

export const browserRunner: Runner = {
  pv: async (i, hash) => { const o = await runPvInWorker(i, hash).promise; return o.status === 'result' ? o.result : null; },
  sim: async (i, hash) => { const o = await runSimInWorker(i, hash).promise; return o.status === 'result' ? o.result : null; },
  shade: async (spec) => { const o = await runShadeInWorker(spec, null, [0, spec.n]).promise; return o.status === 'result' ? o.field : null; },
};

export async function renderImported(ctx: ImportedCtx): Promise<Node[]> {
  const rec = ctx.recorded, p = ctx.project, st = ctx.state;
  const weather = p.pv?.weatherId ? await ctx.loadWeather(p.pv.weatherId) : undefined;
  const rows = rec.runs.map((r) => {
    const o = st.outcomes.get(r.runId);
    return h('tr', { 'data-run': r.runId },
      h('th', { scope: 'row' }, `${r.label} · ${r.title}`), h('td', {}, `${r.kind === 'pv' ? 'PV' : 'Hệ thống'} · ${r.engines.pv}${r.engines.dispatch ? ' + ' + r.engines.dispatch : ''}`),
      h('td', { className: 'rec-hash' }, r.inputHash.slice(0, 12)), ...key(r, r.metrics).map((c) => h('td', { className: 'num' }, c)),
      h('td', { className: 'rep-status', 'data-status': o?.status ?? 'none' }, o ? STATUS_TEXT[o.status] : 'chưa chạy lại'), h('td', { className: 'rep-hash' }, o?.hashNow ? o.hashNow.slice(0, 12) : '—'),
      ...key(r, o?.metricsNow ?? null).map((c) => h('td', { className: 'num' }, c)));
  });
  const msgs = [...st.outcomes.values()].filter((o) => o.reason).map((o) => h('li', {}, `${rec.runs.find((r) => r.runId === o.runId)!.label}: ${o.reason}${o.diffs.length ? ` (lệch ${o.diffs.slice(0, 3).map((d) => d.key).join(', ')}${o.diffs.length > 3 ? '…' : ''})` : ''}`));
  const replay = h('button', { id: 'im-replay', disabled: st.busy || !rec.runs.length }, `Chạy lại bằng engine hiện tại (${CURRENT_ENGINES.pv}${rec.runs.some((r) => r.kind === 'sim') ? ' + ' + CURRENT_ENGINES.dispatch : ''})`);
  replay.addEventListener('click', async () => {
    st.busy = true; ctx.rerender();
    for (const r of rec.runs) st.outcomes.set(r.runId, await replayRun(r, { project: p, variants: rec.variants, weather }, browserRunner));
    st.busy = false; ctx.rerender();
  });
  return [
    h('h2', {}, `Gói đã nhập · ${p.name}`), h('button', { id: 'im-open', onClick: ctx.open }, 'Mở dự án'), ctx.back && h('button', { onClick: ctx.back }, 'Về danh sách'),
    h('p', { id: 'im-meta' }, `Gói ${rec.kind === 'full' ? 'đầy đủ' : 'báo cáo'} xuất ${rec.exportedAt.slice(0, 19).replace('T', ' ')} bởi build ${rec.app.buildId} (engine ${rec.app.engines.pv} · ${rec.app.engines.dispatch} · ${rec.app.engines.shade}); nhập ${rec.importedAt.slice(0, 19).replace('T', ' ')}.`),
    h('p', { id: 'im-weather' }, rec.weatherRef ? `Thời tiết: ${rec.weatherRef.name} (${rec.weatherRef.n} bước, mã ${rec.weatherRef.contentHash.slice(0, 12)}) — ${weather ? 'có sẵn trong máy này' : 'CHƯA có trong máy này, nên chưa chạy lại được'}.` : 'Gói không nói tới dữ liệu thời tiết.'),
    h('p', {}, 'Cột "Đã ghi" là số liệu nằm trong gói, giữ nguyên như lúc xuất. Cột "Chạy lại" là kết quả mới tính trên máy này; hai phần không bao giờ ghi đè nhau.'),
    rec.runs.length ? h('div', {}, replay) : h('p', {}, 'Gói không kèm kết quả đã chạy.'),
    rec.runs.length ? h('table', { id: 'im-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Lần chạy'), h('th', {}, 'Engine đã ghi'), h('th', {}, 'Mã đã ghi'), h('th', {}, 'PV đã ghi'), h('th', {}, 'Tải cấp'), h('th', {}, 'SoC thấp nhất'), h('th', {}, 'Điện thiếu'),
      h('th', {}, 'Kết quả chạy lại'), h('th', {}, 'Mã chạy lại'), h('th', {}, 'PV mới'), h('th', {}, 'Tải cấp'), h('th', {}, 'SoC thấp nhất'), h('th', {}, 'Điện thiếu'))), h('tbody', {}, ...rows)) : null,
    msgs.length ? h('ul', { id: 'im-reasons' }, ...msgs) : null,
  ].filter(Boolean) as Node[];
}
