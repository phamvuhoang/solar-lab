import { addObstacle, moveObstacle, placeTankNearRoof } from '../domain/layout-edit';
import { compilePv } from '../engine/compile';
import { simulatePv, type PvResult } from '../engine/pv';
import { sunPosition, pressureAt } from '../engine/solar';
import { shadeDayCsv, shadeYearCsv } from '../reports/shade-csv';
import { buildSceneModel } from '../scene/model';
import { heatColor, type Overlay } from '../scene/three-view';
import { sunVector } from '../shade/geometry';
import { buildShadeSpec, shadeSettingsOf, type ShadeField, type ShadeSpec } from '../shade/sampler';
import { shadeCache } from '../shade/usage';
import type { Project } from '../domain/types';
import { localDate, localHour, type WeatherSeries } from '../weather/series';
import { runPvBatchInWorker, runShadeInWorker, type Job } from '../worker/client';
import { download, h } from './dom';
import type { Tab } from './route';

export interface SceneSummary {
  label: 'A' | 'B'; title: string; key: string; mode: 'preview' | 'standard'; samplesPerPanel: number; stepSeconds: number; modelVersion: string;
  obstacles: { label: string; center: number[]; size: number[] }[]; shadeComputeMs: number; stepsComputed: number; stepsReused: number;
  eFreeWh: number; eSumWh: number; eLowWh: number; eIdealFreeWh: number; eIdealSumWh: number;
  panels: { id: string; label: string; stringIndex: number; directAccess: number | null; eFreeWh: number; eShadedWh: number }[];
  strings: { label: string; free: number; upper: number; lower: number }[];
  bypassNote: string;
}
export interface DayEnergy { date: string; key: string; panels: Map<string, { free: number; shaded: number }>; strings: { id: string; label: string; free: number; upper: number; lower: number }[] }
export interface ShadeState { date: string | null; step: number; scenes: SceneSummary[]; dayEnergy: DayEnergy | null; stepLabel: string }

export interface ShadeCtx {
  project: Project; revisions: { revision: number; savedAt: string }[]; selection: string[]; state: ShadeState;
  loadRevision(n: number): Promise<Project | undefined>; loadWeather(id: string): Promise<WeatherSeries | undefined>;
  apply(next: Project): Promise<void>; setSelection(ids: string[]): void; rerender(): void; go(tab: Tab): void;
  /** Sun and heat drawn in the workspace's shared 3D view. */
  setOverlay(o: Overlay): void;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Stops the sun animation (leaving the tab, closing the project). */
export function stopShadePlayback() { if (timer) clearInterval(timer); timer = null; }

const kwh = (wh: number) => (wh / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const pct = (x: number | null, d = 0) => (x === null ? '—' : `${(x * 100).toLocaleString('vi-VN', { maximumFractionDigits: d })} %`);
const noMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const sliceWeather = (w: WeatherSeries, i0: number, i1: number): WeatherSeries => {
  const s = <T,>(a: T[] | null) => (a ? a.slice(i0, i1) : null);
  return { ...w, t0: w.t0 + i0 * w.stepSeconds, n: i1 - i0, ghi: s(w.ghi), dni: s(w.dni), dhi: s(w.dhi), poa: s(w.poa), tempAirC: s(w.tempAirC), windMs: s(w.windMs) };
};
const sliceField = (f: ShadeField, i0: number, i1: number): ShadeField => ({ ...f, key: `${f.key}:${i0}-${i1}`, t0: f.t0 + i0 * f.stepSeconds, n: i1 - i0, access: f.access.map((a) => a.slice(i0, i1)), done: f.done.slice(i0, i1) });

export async function renderShade(ctx: ShadeCtx): Promise<Node[]> {
  stopShadePlayback();
  const p = ctx.project, st = ctx.state, tz = p.location?.timezone ?? 'Asia/Ho_Chi_Minh';
  const weather = p.pv?.weatherId ? await ctx.loadWeather(p.pv.weatherId) : undefined;
  const settings = shadeSettingsOf(p);
  const model = buildSceneModel(p);
  const msg = h('div', { id: 'sh-messages', role: 'alert' });
  const say = (l: string[]) => msg.replaceChildren(...l.map((x) => h('p', {}, x)));
  const spec: ShadeSpec | null = weather && model.panels.length ? await buildShadeSpec(p, weather, settings) : null;
  const field = spec ? shadeCache.get(spec.key) : null;

  const head = [
    h('h2', {}, `Bóng che · ${p.name}`),
    h('div', {}, h('button', { onClick: () => ctx.go('mai'), id: 'sh-to-roof' }, 'Mái nhà 3D'), h('button', { onClick: () => ctx.go('pv') }, 'Thời tiết và PV')), msg,
    h('p', {}, 'Mô hình: tia thẳng từ các điểm mẫu trên mặt tấm tới Mặt Trời, bị chặn bởi vật cản (hộp/trụ đúng hình) và mặt mái khác. Chỉ trực xạ bị che; khuếch tán trời và phản xạ đất giữ nguyên. Tấm không che nhau.'),
  ];
  if (!weather) return [...head, h('p', { id: 'sh-weather' }, 'Chưa chọn dữ liệu thời tiết: vào "Thời tiết và PV" để chọn.')];
  if (!model.panels.length || !spec) return [...head, h('p', { id: 'sh-weather' }, 'Chưa có tấm nào được đặt lên mái: vào "Mái nhà 3D" để đặt tấm (bóng cần vị trí thật của tấm).')];

  // ---- the day under inspection -------------------------------------------------------------------------------------
  const dates = [...new Set(Array.from({ length: weather.n }, (_, i) => localDate(weather.t0 + (i + 0.5) * weather.stepSeconds, tz)))];
  if (!st.date || !dates.includes(st.date)) st.date = dates.reduce((best, d) => (Math.abs(Date.parse(d) - Date.UTC(2023, 11, 21)) < Math.abs(Date.parse(best) - Date.UTC(2023, 11, 21)) ? d : best), dates[0]); // nearest to the December solstice
  const dayIdx = Array.from({ length: weather.n }, (_, i) => i).filter((i) => localDate(weather.t0 + (i + 0.5) * weather.stepSeconds, tz) === st.date);
  const press = pressureAt(weather.location.elevationM ?? 0);
  const sunAt = (i: number) => sunPosition(weather.t0 + (i + 0.5) * weather.stepSeconds, weather.location.latitude, weather.location.longitude, { pressurePa: press });
  const upIdx = dayIdx.filter((i) => sunAt(i).apparentElevationDeg > 0);
  const dayDone = !!field && dayIdx.every((i) => field.done[i]);
  st.step = Math.max(0, Math.min(st.step, upIdx.length - 1));
  const selected = ctx.selection.filter((id) => model.panels.some((x) => x.instanceId === id));

  // ---- panel table and inspector ------------------------------------------------------------------------------------
  const stringOf = new Map(model.panels.map((x) => [x.instanceId, x]));
  const cells = new Map<string, { now: HTMLElement; mean: HTMLElement; drop: HTMLElement }>();
  const rows = model.panels.map((pn) => {
    const now = h('td', { className: 'num', 'data-cell': 'now' }), mean = h('td', { className: 'num' }), drop = h('td', { className: 'num' });
    cells.set(pn.instanceId, { now, mean, drop });
    return h('tr', { 'data-id': pn.instanceId, className: selected.includes(pn.instanceId) ? 'selected' : '', 'aria-selected': String(selected.includes(pn.instanceId)) },
      h('td', {}, h('button', { id: `sh-pick-${pn.instanceId}`, onClick: () => ctx.setSelection([pn.instanceId]), 'aria-label': `Chọn ${pn.label}` }, pn.label)), h('td', {}, pn.stringIndex ? `S${pn.stringIndex}·${pn.seriesIndex}` : '—'), now, mean, drop);
  });
  const inspector = h('div', { id: 'sh-inspector', 'aria-live': 'polite' });
  const timeLabel = h('span', { id: 'sh-time' });

  const meanAccess = (k: number) => { let s = 0, c = 0; for (const i of upIdx) if (field?.done[i]) { s += field.access[k][i]; c++; } return c ? s / c : null; };
  function updateStep() {
    const i = upIdx[st.step];
    if (i === undefined) { timeLabel.textContent = 'Không có bước nào có Mặt Trời trong ngày này'; return; }
    const sp = sunAt(i), t = weather!.t0 + i * weather!.stepSeconds;
    timeLabel.textContent = `${st.date} ${String(localHour(t + weather!.stepSeconds / 2, tz)).padStart(2, '0')}h (${tz}) · Mặt Trời hướng ${sp.azimuthDeg.toFixed(0)}°, cao ${sp.apparentElevationDeg.toFixed(0)}°`;
    const sv = sunVector(sp.azimuthDeg, sp.apparentZenithDeg);
    const heat = dayDone && field ? new Map(field.panelIds.map((id, k) => [id, field.access[k][i]] as [string, number])) : null;
    ctx.setOverlay({ sun: { e: sv[0], n: sv[1], up: sv[2] }, heat });
    for (const [id, c] of cells) {
      const k = field?.panelIds.indexOf(id) ?? -1, a = heat && k >= 0 ? field!.access[k][i] : null;
      c.now.textContent = a === null ? '—' : pct(a); c.now.setAttribute('data-access', a === null ? '' : a.toFixed(4));
      c.now.style.background = a === null ? '' : heatColor(a); c.now.style.color = a !== null && a < 0.55 ? '#fff' : '';
      const m = k >= 0 && dayDone ? meanAccess(k) : null;
      c.mean.textContent = pct(m);
      const de = (st.dayEnergy?.date === st.date && st.dayEnergy?.key === spec!.key) ? st.dayEnergy.panels.get(id) : undefined;
      c.drop.textContent = de ? `${(de.free - de.shaded).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} Wh` : '—';
    }
    renderInspector(i);
  }
  function renderInspector(i: number) {
    inspector.replaceChildren();
    if (selected.length !== 1) { inspector.append(h('p', {}, selected.length ? `Đang chọn ${selected.length} tấm; chọn một tấm để xem chi tiết.` : 'Chọn một tấm (bảng, 3D, mặt bằng hoặc sơ đồ điện) để xem phần trăm thấy nắng trực tiếp và PV giảm.')); return; }
    const id = selected[0], pn = stringOf.get(id)!, k = field?.panelIds.indexOf(id) ?? -1;
    const now = dayDone && k >= 0 && i !== undefined ? field!.access[k][i] : null, de = (st.dayEnergy?.date === st.date && st.dayEnergy?.key === spec!.key) ? st.dayEnergy.panels.get(id) : undefined;
    const year = st.scenes.find((s) => s.key === spec!.key)?.panels.find((x) => x.id === id);
    const str = (st.dayEnergy?.date === st.date && st.dayEnergy?.key === spec!.key) && pn.stringId ? st.dayEnergy.strings.find((x) => x.id === pn.stringId) : undefined;
    inspector.append(h('dl', {},
      h('dt', {}, 'Tấm'), h('dd', {}, `${pn.label} (${id.slice(0, 12)})`),
      h('dt', {}, 'Thấy nắng trực tiếp tại giờ đang xem'), h('dd', { id: 'sh-insp-now', 'data-access': now === null ? '' : now.toFixed(4) }, pct(now)),
      h('dt', {}, 'Trung bình các giờ có nắng trong ngày'), h('dd', {}, pct(k >= 0 && dayDone ? meanAccess(k) : null)),
      h('dt', {}, 'PV giảm trong ngày (bước lý tưởng, trước tổn hao)'), h('dd', {}, de ? `${(de.free - de.shaded).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} Wh (${pct(de.free > 0 ? (de.free - de.shaded) / de.free : null, 1)})` : 'bấm "Tính bóng ngày này"'),
      h('dt', {}, 'PV giảm trong cả năm'), h('dd', {}, year ? `${(year.eFreeWh - year.eShadedWh).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} Wh (${pct(year.eFreeWh > 0 ? (year.eFreeWh - year.eShadedWh) / year.eFreeWh : null, 1)}); trực xạ thấy được ${pct(year.directAccess, 1)}` : 'bấm "Tính cả năm"'),
      h('dt', {}, 'Chuỗi liên quan'), h('dd', {}, pn.stringIndex ? `Chuỗi ${pn.stringIndex}${str ? ` · trong ngày chuỗi giảm từ ${(((str.free - str.upper) / 1000) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} kWh (cận trên, cộng tấm) đến ${(((str.free - str.lower) / 1000) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} kWh (cận dưới, tấm yếu nhất quyết định)` : ''}` : 'chưa vào chuỗi')));
  }

  // ---- controls -----------------------------------------------------------------------------------------------------
  const prog = h('progress', { id: 'sh-progress', max: 100, value: 0, hidden: true, 'aria-label': 'Tiến độ' });
  const cancel = h('button', { id: 'sh-cancel', hidden: true }, 'Hủy');
  const jobs: Job<unknown>[] = [];
  cancel.onclick = () => jobs.forEach((j) => j.cancel());
  const busy = (on: boolean) => { prog.hidden = !on; cancel.hidden = !on; for (const b of document.querySelectorAll<HTMLButtonElement>('button.sh-action')) b.disabled = on; };
  const fail = (lines: string[]) => say(lines);

  async function ensureField(sp: ShadeSpec, range: [number, number], title: string): Promise<{ field: ShadeField; computed: number; reused: number } | null> {
    const have = shadeCache.get(sp.key), missing = shadeCache.missing(sp.key, sp.n, range[0], range[1]);
    if (have && !missing) { shadeCache.note(true); return { field: have, computed: 0, reused: range[1] - range[0] }; }
    shadeCache.note(false);
    const job = runShadeInWorker(sp, have, range, (d, t) => { prog.value = Math.round((d / t) * 100); });
    jobs.push(job);
    const out = await job.promise;
    jobs.length = 0;
    if (out.status === 'cancelled') { fail([`${title}: đã hủy; các bước đã tính xong vẫn được giữ lại trong cache.`]); return null; }
    if (out.status === 'failure') { fail([`${title}: ${out.issues.map((x) => x.message).join('; ')}`]); return null; }
    shadeCache.put(out.field);
    return { field: out.field, computed: out.computed, reused: out.reused };
  }

  const computeDay = h('button', { id: 'sh-compute-day', className: 'sh-action' }, 'Tính bóng ngày này');
  computeDay.addEventListener('click', async () => {
    say([]); busy(true);
    const r = await ensureField(spec, [dayIdx[0], dayIdx[dayIdx.length - 1] + 1], 'Bóng ngày');
    busy(false);
    if (!r) return;
    const sw = sliceWeather(weather, dayIdx[0], dayIdx[dayIdx.length - 1] + 1), sf = sliceField(r.field, dayIdx[0], dayIdx[dayIdx.length - 1] + 1);
    const free = compilePv(p, sw), sum = compilePv(p, sw, { shade: sf }), low = compilePv(p, sw, { shade: sf, stringMode: 'weakest' });
    if (!free.input || !sum.input || !low.input) return fail([`Không tính được PV trong ngày: ${[...free.issues, ...sum.issues].map((x) => x.message).join('; ')}`]);
    const [a, b, c] = await Promise.all([simulatePv(free.input, 'd0'), simulatePv(sum.input, 'd1'), simulatePv(low.input, 'd2')]);
    if (!a || !b || !c || b.issues.length) return fail([`Không tính được PV trong ngày: ${b?.issues.map((x) => x.message).join('; ')}`]);
    const e = (r: PvResult, k: number) => r.strings[k].pIdealW.reduce((x, y) => x + y, 0) * (r.period.stepSeconds / 3600);
    st.dayEnergy = { date: st.date!, key: spec.key, panels: new Map(b.shade!.panels.map((x) => [x.id, { free: x.eIdealNoShadeWh, shaded: x.eIdealWh }])), strings: a.strings.map((s, k) => ({ id: s.id, label: s.label, free: e(a, k), upper: e(b, k), lower: e(c, k) })) };
    say([`Đã tính ngày ${st.date}: ${r.computed} bước mới, ${r.reused} bước dùng lại từ cache.`]);
    ctx.rerender();
  });

  const slider = h('input', { type: 'range', id: 'sh-slider', min: 0, max: Math.max(0, upIdx.length - 1), value: st.step, 'aria-label': 'Giờ trong ngày', style: 'width:100%' });
  slider.addEventListener('input', () => { st.step = Number(slider.value); updateStep(); });
  const stepBtn = (label: string, d: number, id: string) => h('button', { id, onClick: () => { st.step = Math.max(0, Math.min(upIdx.length - 1, st.step + d)); slider.value = String(st.step); updateStep(); } }, label);
  const play = h('button', { id: 'sh-play', disabled: noMotion() || upIdx.length < 2 }, 'Phát chuyển động Mặt Trời');
  play.addEventListener('click', () => {
    if (timer) { clearInterval(timer); timer = null; play.textContent = 'Phát chuyển động Mặt Trời'; return; }
    play.textContent = 'Dừng';
    timer = setInterval(() => { st.step = (st.step + 1) % upIdx.length; slider.value = String(st.step); updateStep(); }, 450);
  });

  // ---- year analysis and A/B ----------------------------------------------------------------------------------------
  async function analyse(base: Project, label: 'A' | 'B', title: string): Promise<SceneSummary | null> {
    const run: Project = { ...structuredClone(base), pv: { ...base.pv, weatherId: p.pv?.weatherId ?? null } };
    const sp = await buildShadeSpec(run, weather!, shadeSettingsOf(run));
    if (!sp.panels.length) { fail([`${title}: chưa có tấm nào được đặt lên mái`]); return null; }
    const r = await ensureField(sp, [0, sp.n], title);
    if (!r) return null;
    const free = compilePv(run, weather!), sum = compilePv(run, weather!, { shade: r.field }), low = compilePv(run, weather!, { shade: r.field, stringMode: 'weakest' });
    const issues = [...free.issues, ...sum.issues];
    if (issues.length || !free.input || !sum.input || !low.input) { fail([`${title}: ${issues.map((x) => `${x.code}: ${x.message}`).join('; ') || 'không biên dịch được'}`]); return null; }
    prog.value = 0;
    const job = runPvBatchInWorker([free.input, sum.input, low.input], `${sp.key}:${label}`, (d, t) => { prog.value = Math.round((d / t) * 100); });
    jobs.push(job);
    const out = await job.promise;
    jobs.length = 0;
    if (out.status !== 'result') { fail([out.status === 'cancelled' ? `${title}: đã hủy` : `${title}: ${out.issues.map((x) => x.message).join('; ')}`]); return null; }
    const [a, b, c] = out.results;
    const lab = new Map(base.instances.map((i) => [i.instanceId, i.label]));
    const strIdx = new Map((base.strings ?? []).flatMap((s, k) => s.panelIds.map((id) => [id, k + 1] as [string, number])));
    const dt = a.period.stepSeconds / 3600, e = (x: PvResult, k: number) => x.strings[k].pIdealW.reduce((u, v) => u + v, 0) * dt;
    const comp = base.snapshots.components.find((x) => x.modelId === base.instances.find((i) => i.kind === 'panel')?.componentRef?.modelId);
    const diodes = comp?.specs.bypassDiodes?.v ?? null;
    return {
      label, title, key: sp.key, mode: sp.mode, samplesPerPanel: sp.samplesPerPanel, stepSeconds: sp.stepSeconds, modelVersion: r.field.modelVersion,
      obstacles: r.field.obstacles.map((o) => ({ label: o.label, center: o.center, size: o.size })), shadeComputeMs: r.field.computeMs, stepsComputed: r.computed, stepsReused: r.reused,
      eFreeWh: a.totals.eInverterWh, eSumWh: b.totals.eInverterWh, eLowWh: c.totals.eInverterWh, eIdealFreeWh: a.totals.eIdealWh, eIdealSumWh: b.totals.eIdealWh,
      panels: b.shade!.panels.map((x) => ({ id: x.id, label: lab.get(x.id) ?? x.id, stringIndex: strIdx.get(x.id) ?? 0, directAccess: x.directAccess, eFreeWh: x.eIdealNoShadeWh, eShadedWh: x.eIdealWh })),
      strings: a.strings.map((s, k) => ({ label: s.label, free: e(a, k), upper: e(b, k), lower: e(c, k) })),
      bypassNote: diodes === null ? 'Dữ liệu diode bypass của tấm: chưa có' : `Datasheet ghi ${diodes} diode bypass nhưng chưa có sơ đồ cell/IV nên chưa giải bypass`,
    };
  }
  const runYear = h('button', { id: 'sh-year', className: 'sh-action' }, 'Tính cả năm (cảnh hiện tại)');
  runYear.addEventListener('click', async () => { say([]); busy(true); const s = await analyse(p, 'B', `Hiện tại (revision ${p.revision})`); busy(false); if (s) { st.scenes = [s]; ctx.rerender(); } });
  const revs = ctx.revisions.filter((r) => r.revision !== p.revision);
  const selA = h('select', { id: 'sh-a', 'aria-label': 'Cảnh A' }, ...revs.map((r) => h('option', { value: String(r.revision) }, `revision ${r.revision} · ${r.savedAt.slice(0, 19).replace('T', ' ')}`)));
  if (revs.length) selA.value = String(revs[revs.length - 1].revision);
  const runAB = h('button', { id: 'sh-ab', className: 'sh-action', disabled: !revs.length }, 'So sánh hai cảnh A/B (cả năm)');
  runAB.addEventListener('click', async () => {
    const n = Number(selA.value), pa = await ctx.loadRevision(n);
    if (!pa) return fail(['Chọn revision làm cảnh A']);
    say([]); busy(true);
    const a = await analyse(pa, 'A', `A · revision ${n}`);
    const b = a ? await analyse(p, 'B', `B · hiện tại (revision ${p.revision})`) : null;
    busy(false);
    if (a && b) { st.scenes = [a, b]; ctx.rerender(); }
  });

  // ---- settings and obstacles ---------------------------------------------------------------------------------------
  const en = h('input', { type: 'checkbox', id: 'sh-enabled', checked: settings.enabled }), mode = h('select', { id: 'sh-mode', 'aria-label': 'Chế độ lấy mẫu' }, h('option', { value: 'standard' }, 'Chuẩn: lưới n×n mỗi tấm'), h('option', { value: 'preview' }, 'Xem nhanh: 1 điểm ở giữa tấm'));
  mode.value = p.shade?.mode ?? 'preview'; // a project that never chose turns shade on at the preview; SHADE_DEFAULTS stays 'standard' for rc.2 files
  const grid = h('input', { id: 'sh-grid', value: String(settings.grid), size: 3, 'aria-label': 'Cạnh lưới mẫu' });
  const settingsForm = h('form', { id: 'sh-settings', 'aria-label': 'Thiết lập bóng che', onSubmit: (e: Event) => {
    e.preventDefault();
    const g = Number(grid.value);
    if (!Number.isInteger(g) || g < 1 || g > 16) return say(['Cạnh lưới mẫu là số nguyên từ 1 đến 16']);
    say([]);
    void ctx.apply({ ...structuredClone(p), shade: { enabled: en.checked, mode: mode.value as 'preview' | 'standard', grid: g } });
  } }, h('label', {}, en, ' Đưa bóng che vào mọi lần chạy PV và hệ thống '), h('label', {}, ' Chế độ ', mode), h('label', {}, ' Lưới ', grid), h('button', { type: 'submit', id: 'sh-save' }, 'Lưu thiết lập'),
  h('p', {}, `Hiện dùng ${spec.samplesPerPanel} mẫu mỗi tấm, ${spec.n} bước × ${spec.stepSeconds / 60} phút, mô hình ${spec.modelVersion}. Bật bóng che mà chưa tính đủ cả năm thì PV và hệ thống từ chối chạy, không tự bỏ qua bóng.`));
  const stepSel = h('select', { id: 'ob-step', 'aria-label': 'Bước dịch vật cản' }, ...[0.1, 0.25, 0.5, 1].map((v) => h('option', { value: String(v) }, `${String(v).replace('.', ',')} m`)));
  stepSel.value = '0.5';
  const nudge = (id: string, dE: number, dN: number) => () => { const k = Number(stepSel.value); void ctx.apply(moveObstacle(p, id, dE * k, dN * k)); };
  const obstacles = (p.obstacles ?? []).map((o) => h('li', { 'data-obstacle': o.obstacleId }, `${o.label} · ${o.kind === 'box' ? 'hộp' : 'trụ'} ${o.size.x}×${o.size.y}×${o.size.z} m · Đông ${o.center.e.toFixed(2)}, Bắc ${o.center.n.toFixed(2)}, đáy cao ${o.baseUp} m `,
    ...([['←', -1, 0, 'left'], ['→', 1, 0, 'right'], ['↑ Bắc', 0, 1, 'north'], ['↓ Nam', 0, -1, 'south']] as const).map(([t, e, n, k]) => h('button', { id: `ob-${k}-${o.obstacleId}`, onClick: nudge(o.obstacleId, e, n), 'aria-label': `Dịch ${o.label} ${t}` }, t))));

  // ---- results ------------------------------------------------------------------------------------------------------
  // results of a scene that no longer matches the geometry on screen are hidden, not shown as if current
  const stale = st.scenes.length > 0 && st.scenes[st.scenes.length - 1].key !== spec.key;
  const results = (() => {
    if (!st.scenes.length || stale) return null;
    const [a, b] = st.scenes.length === 2 ? st.scenes : [null, st.scenes[0]];
    const cols = a ? [a, b] : [b];
    const loss = (s: SceneSummary, v: number) => s.eFreeWh - v;
    const w = (x: number) => `${kwh(x)} kWh`, d = (f: (s: SceneSummary) => number) => (a ? `${(f(b) - f(a) > 0 ? '+' : '')}${kwh(f(b) - f(a))} kWh` : null);
    const row = (label: string, f: (s: SceneSummary) => string, dd: string | null = null) => h('tr', {}, h('th', { scope: 'row' }, label), ...cols.map((s) => h('td', {}, f(s))), a ? h('td', {}, dd ?? '—') : null);
    return h('section', { id: 'sh-results', 'aria-label': 'Kết quả bóng che' }, h('h3', {}, 'Kết quả cả năm'),
      h('p', { id: 'sh-scope' }, `Chỉ đúng cho dữ liệu thời tiết ${weather.name} (${weather.source.period ?? '?'}) và vị trí vật cản/tấm của từng cảnh. PV ở đây là DC tới inverter sau tổn hao và giới hạn.`),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Chỉ số'), ...cols.map((s) => h('th', {}, s.title)), a ? h('th', {}, 'Chênh B − A') : null)),
        h('tbody', {},
          row('PV không bóng', (s) => w(s.eFreeWh), d((s) => s.eFreeWh)),
          row('PV có bóng: cận trên (cộng công suất từng tấm)', (s) => w(s.eSumWh), d((s) => s.eSumWh)),
          row('PV có bóng: cận dưới (tấm yếu nhất quyết định cả chuỗi)', (s) => w(s.eLowWh), d((s) => s.eLowWh)),
          row('Tổn thất do bóng', (s) => `${kwh(loss(s, s.eSumWh))}–${kwh(loss(s, s.eLowWh))} kWh (${pct(loss(s, s.eSumWh) / s.eFreeWh, 1)}–${pct(loss(s, s.eLowWh) / s.eFreeWh, 1)})`),
          row('Ở bước lý tưởng (trước tổn hao và giới hạn)', (s) => `${kwh(s.eIdealFreeWh - s.eIdealSumWh)} kWh`),
          row('…phần bị clipping của tracker/inverter che khuất', (s) => `${kwh(Math.max(0, (s.eIdealFreeWh - s.eIdealSumWh) - loss(s, s.eSumWh)))} kWh`),
          row('Trực xạ thấy được (trọng số bức xạ, trung bình các tấm)', (s) => pct(s.panels.reduce((x, y) => x + (y.directAccess ?? 0), 0) / s.panels.length, 1)),
          row('Mẫu / bước / model', (s) => `${s.samplesPerPanel} mẫu mỗi tấm · ${s.stepSeconds / 60} phút · ${s.modelVersion}`),
          row('Vật cản (vị trí ENU, m)', (s) => s.obstacles.map((o) => `${o.label} (${o.center.map((x) => x.toFixed(1)).join(', ')})`).join('; ') || 'không có'),
          row('Tính bóng', (s) => `${(s.shadeComputeMs / 1000).toFixed(1)} s · ${s.stepsComputed} bước mới, ${s.stepsReused} dùng lại từ cache`))),
      h('p', { id: 'sh-bypass' }, `${cols[0].bypassNote}. Cận trên giả định diode bypass lý tưởng; cận dưới giả định không có bypass. Giá trị thật nằm giữa hai cận, nhưng chưa có dữ liệu IV để thu hẹp.`),
      h('button', { id: 'sh-csv-year', 'data-min-depth': 'ky-su', onClick: () => { const s = cols[cols.length - 1], f = shadeCache.get(s.key); if (f) download(`bong-che-nam-${s.label}.csv`, shadeYearCsv(f, s.panels, { project: p.name, scene: s.title, stringBounds: `string bounds: ${s.strings.map((x) => `${x.label} loss ${((x.free - x.upper) / 1000).toFixed(1)}-${((x.free - x.lower) / 1000).toFixed(1)} kWh`).join('; ')}` }), 'text/csv;charset=utf-8'); } }, 'Xuất CSV cả năm (theo tấm)'));
  })();

  const csvDay = h('button', { id: 'sh-csv-day', 'data-min-depth': 'ky-su', disabled: !dayDone, onClick: () => {
    if (!field) return;
    const sun = new Map(upIdx.map((i) => { const s = sunAt(i); return [i, { az: s.azimuthDeg, el: s.apparentElevationDeg }] as [number, { az: number; el: number }]; }));
    download(`bong-che-${st.date}.csv`, shadeDayCsv(field, upIdx, { timeZone: tz, project: p.name, sun, panels: model.panels.map((x) => ({ id: x.instanceId, label: x.label, stringIndex: x.stringIndex })) }), 'text/csv;charset=utf-8');
  } }, 'Xuất CSV ngày này');

  const date = h('input', { type: 'date', id: 'sh-date', value: st.date, min: dates[0], max: dates[dates.length - 1] });
  date.addEventListener('change', () => { st.date = date.value; st.step = 0; ctx.rerender(); });

  setTimeout(updateStep, 0); // the nodes exist; fill them once they are attached
  updateStep();
  return [
    ...head,
    h('h3', {}, '1. Thiết lập lấy mẫu'), settingsForm,
    h('h3', {}, '2. Vật cản'), h('div', {}, h('label', {}, 'Bước dịch ', stepSel), h('button', { id: 'tank-near', onClick: () => { try { void ctx.apply(placeTankNearRoof(p)); } catch (e) { say([(e as Error).message === 'NO_FACE' ? 'Thêm mặt mái trước' : (e as Error).message]); } } }, 'Đặt bồn nước sát mái phía Nam'),
      h('button', { id: 'tank-far', onClick: () => void ctx.apply(addObstacle(p, { label: 'Bồn nước (xa)', kind: 'cylinder', roofFaceId: null, center: { e: 25, n: 3 }, baseUp: 0, angleDeg: 0, size: { x: 1.2, y: 1.2, z: 1.8 } })) }, 'Thêm bồn nước ở xa (không che)')),
    obstacles.length ? h('ul', { id: 'sh-obstacles' }, ...obstacles) : h('p', {}, 'Chưa có vật cản. Thêm bồn nước hoặc vật cản ở màn Mái nhà 3D.'),
    h('h3', {}, '3. Một ngày'), h('div', {}, h('label', {}, 'Ngày ', date), computeDay, csvDay, cancel, prog),
    h('p', { id: 'sh-day-status' }, dayDone ? `Bóng ngày ${st.date} đã tính (${upIdx.length} bước có nắng).` : `Bóng ngày ${st.date} chưa tính: bấm "Tính bóng ngày này" (bóng đổ trên 3D chỉ để xem; số liệu lấy từ tia CPU).`),
    slider, h('div', {}, stepBtn('← bước trước', -1, 'sh-prev'), play, stepBtn('bước sau →', 1, 'sh-next'), timeLabel),
    h('table', { id: 'sh-table' }, h('thead', {}, h('tr', {}, ...['Tấm', 'Chuỗi·vị trí', 'Thấy nắng giờ này', 'Trung bình ngày', 'PV giảm trong ngày'].map((t) => h('th', {}, t)))), h('tbody', {}, ...rows)),
    h('h4', {}, 'Tấm đang chọn'), inspector,
    h('h3', {}, '4. Cả năm và so sánh hai cảnh'), h('div', {}, runYear, ' ', h('label', {}, 'A = ', selA), ' B = cảnh hiện tại ', runAB),
    stale ? h('p', { id: 'sh-stale' }, 'Kết quả cả năm đã tính trước đó không còn khớp vị trí tấm/vật cản hiện tại; tính lại để cập nhật.') : null,
    results,
  ].filter(Boolean) as Node[];
}
