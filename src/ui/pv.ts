import { barChart, lineChart } from '../diagrams/charts';
import { hashOf } from '../domain/hash';
import type { Project, PvSettings } from '../domain/types';
import { parseNumber } from '../domain/units';
import { compilePv, hashPvInput, PV_DEFAULTS, pvSettingsOf } from '../engine/compile';
import type { PvResult } from '../engine/pv';
import { pvResultToCsv } from '../reports/pv-csv';
import { parseWeatherCsv } from '../weather/csv';
import { formatUtc, localDate, localHour, type WeatherSeries } from '../weather/series';
import { runPvInWorker } from '../worker/client';
import { shadeFor } from '../shade/usage';
import { download, h } from './dom';

export interface PvCtx {
  project: Project;
  choices: { id: string; label: string; origin: 'bundled' | 'stored' }[];
  loadWeather(id: string): Promise<WeatherSeries | undefined>;
  saveWeather(s: WeatherSeries): Promise<void>;
  apply(next: Project): Promise<void>;
  lastResult: PvResult | null; setResult(r: PvResult | null): void; rerender(): void;
}

const kwh = (wh: number) => (Math.abs(wh) < 50 ? 0 : wh / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }); // avoids "−0"
const hashCache = new Map<string, string>();
async function cachedWeatherHash(w: WeatherSeries): Promise<string> {
  const k = `${w.seriesId}:${w.n}:${w.t0}`;
  let v = hashCache.get(k);
  if (!v) { v = await hashOf(w); hashCache.set(k, v); }
  return v;
}

export async function renderPv(ctx: PvCtx): Promise<Node[]> {
  const p = ctx.project, st = pvSettingsOf(p), tz = p.location?.timezone ?? 'Asia/Ho_Chi_Minh';
  const weather = st.weatherId ? await ctx.loadWeather(st.weatherId) : undefined;
  const msg = h('div', { id: 'pv-messages', role: 'alert' });
  const say = (lines: string[]) => msg.replaceChildren(...lines.map((l) => h('p', {}, l)));

  // identity of what the current inputs would produce; a stored result is shown only if it matches
  let hash: string | null = null, compileIssues: { code: string; field: string; message: string }[] = [];
  let compiled: ReturnType<typeof compilePv>['input'] = null;
  let unplaced = 0;
  if (weather) {
    const sf = await shadeFor(p, weather);
    const c = compilePv(p, weather, { shade: sf.field });
    compileIssues = [...c.issues, ...sf.issues]; compiled = sf.issues.length ? null : c.input; unplaced = sf.unplaced;
    if (compiled) { compiled.weatherHash = await cachedWeatherHash(weather); hash = await hashPvInput(compiled); }
  }
  const result = ctx.lastResult && hash && ctx.lastResult.inputHash === hash ? ctx.lastResult : null;

  return [
    h('h2', {}, `Mô phỏng PV · ${p.name}`), msg,
    h('h3', {}, '1. Dữ liệu thời tiết'), weatherSection(ctx, weather, say),
    h('h3', {}, '2. Thiết lập mảng và mô hình'), settingsForm(ctx, st, say),
    h('h3', {}, '3. Chạy'), runSection(ctx, compiled, hash, compileIssues, weather, say),
    result && weather ? resultSection(result, weather, tz, unplaced) : ctx.lastResult && hash ? h('p', { id: 'stale-result' }, 'Kết quả đã chạy trước đó không còn khớp thiết kế hoặc thiết lập hiện tại (mã đầu vào khác). Chạy lại để cập nhật.') : null,
  ].filter(Boolean) as Node[];
}

function weatherSection(ctx: PvCtx, w: WeatherSeries | undefined, say: (l: string[]) => void): HTMLElement {
  const st = pvSettingsOf(ctx.project);
  const sel = h('select', { id: 'wx-select', 'aria-label': 'Dữ liệu thời tiết' }, h('option', { value: '' }, '— chọn —'), ...ctx.choices.map((c) => h('option', { value: c.id }, `${c.label}${c.origin === 'stored' ? ' (đã nhập)' : ''}`)));
  sel.value = st.weatherId ?? '';
  sel.addEventListener('change', () => ctx.apply({ ...structuredClone(ctx.project), pv: { ...ctx.project.pv, weatherId: sel.value || null } }));
  const file = h('input', { type: 'file', id: 'wx-file', accept: '.csv,text/csv' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    const r = parseWeatherCsv(await f.text());
    const lines = r.issues.map((i) => `${i.severity === 'error' ? 'Lỗi' : i.severity === 'warning' ? 'Cảnh báo' : 'Ghi chú'} ${i.code} tại ${i.field}: ${i.message}`);
    if (!r.ok) { say(['Không nhập được file thời tiết; dự án và lựa chọn hiện tại không đổi.', ...lines]); return; }
    const id = `wx-${(await hashOf({ ...r.series, seriesId: '' })).slice(0, 12)}`;
    await ctx.saveWeather({ ...r.series, seriesId: id });
    await ctx.apply({ ...structuredClone(ctx.project), pv: { ...ctx.project.pv, weatherId: id } });
  });
  const template = h('a', { href: 'data:text/csv;charset=utf-8,' + encodeURIComponent('# mekoniq-solar-lab weather v1\n# name: Tên chuỗi\n# latitude: \n# longitude: \n# elevation_m: \n# source: \n# method: historical\n# period: \n# timestamp_convention: start\n# step_seconds: 3600\ntimestamp_utc,ghi_wm2,dni_wm2,dhi_wm2,poa_wm2,temp_air_c,wind_ms\n'), download: 'weather-template.csv' }, 'Tải file mẫu CSV');
  return h('div', {}, h('label', {}, 'Chọn ', sel), ' ', h('label', {}, 'hoặc nhập CSV ', file), ' ', template,
    w ? h('dl', { id: 'wx-info' },
      h('dt', {}, 'Nguồn'), h('dd', {}, `${w.source.name} · phương pháp: ${w.source.method}${w.source.version ? ' · ' + w.source.version : ''}`),
      h('dt', {}, 'Địa điểm'), h('dd', {}, `${w.location.latitude}°, ${w.location.longitude}°${w.location.elevationM !== null ? `, cao ${w.location.elevationM} m` : ''}`),
      h('dt', {}, 'Khoảng thời gian'), h('dd', {}, `${formatUtc(w.t0)} → ${formatUtc(w.t0 + w.n * w.stepSeconds)} (UTC), ${w.n} bước × ${w.stepSeconds / 60} phút`),
      h('dt', {}, 'Lấy lúc / năm'), h('dd', {}, `${w.source.retrieved ?? 'không rõ'} · ${w.source.period ?? 'không rõ'}`),
      h('dt', {}, 'Cột có dữ liệu'), h('dd', {}, (['ghi', 'dni', 'dhi', 'poa', 'tempAirC', 'windMs'] as const).filter((k) => w[k]).join(', ')),
      h('dt', {}, 'Giấy phép'), h('dd', {}, w.source.license ?? 'không ghi'),
      w.notes.length ? h('dt', {}, 'Xử lý khi nhập') : null, w.notes.length ? h('dd', {}, w.notes.join('; ')) : null) : h('p', {}, 'Chưa chọn dữ liệu thời tiết.'));
}

function settingsForm(ctx: PvCtx, st: Partial<PvSettings>, say: (l: string[]) => void): HTMLElement {
  const f = (id: string, label: string, v: string, ph = '') => { const el = h('input', { id, value: v, size: 7, placeholder: ph }); return { el, node: h('label', {}, label + ' ', el) }; };
  const dec = (x: number | null | undefined) => (x === null || x === undefined ? '' : String(x).replace('.', ','));
  const tilt = f('pv-tilt', 'Độ nghiêng (°)', dec(st.tiltDeg), 'chuỗi chưa lên mái'), az = f('pv-az', 'Azimuth (°, Bắc=0, theo chiều kim đồng hồ)', dec(st.azimuthDeg), 'chuỗi chưa lên mái');
  const alb = f('pv-albedo', 'Albedo', dec(st.albedo)), loss = f('pv-loss', 'Tổn hao DC (%)', dec((st.lossRatio ?? 0) * 100));
  const cell = h('select', { id: 'pv-cell' }, h('option', { value: 'faiman' }, 'Faiman'), h('option', { value: 'fixed' }, 'Nhiệt độ cell cố định'));
  cell.value = st.cellModel ?? 'faiman';
  const fixed = f('pv-fixed', 'Tcell cố định (°C)', dec(st.fixedCellTempC)), u0 = f('pv-u0', 'u0', dec(st.faimanU0)), u1 = f('pv-u1', 'u1', dec(st.faimanU1));
  const wind = f('pv-wind', 'Gió dự phòng (m/s)', dec(st.windFallbackMs), 'chỉ khi file không có gió');
  const irr = h('select', { id: 'pv-irr' }, h('option', { value: 'auto' }, 'Tự chọn'), h('option', { value: 'components' }, 'GHI/DNI/DHI → mặt phẳng tấm'), h('option', { value: 'poa' }, 'POA có sẵn trong file'));
  irr.value = st.irradianceInput ?? 'auto';
  return h('form', { 'aria-label': 'Thiết lập PV', onSubmit: (e: Event) => {
    e.preventDefault();
    const n = (x: { el: HTMLInputElement }, name: string, lo: number, hi: number, required = true): number | null | 'bad' => {
      const t = x.el.value.trim();
      if (!t) return required ? (say([`${name}: bắt buộc`]), 'bad') : null;
      const v = parseNumber(t);
      if (v === null || v < lo || v > hi) { say([`${name}: cần số trong [${lo}, ${hi}]`]); return 'bad'; }
      return v;
    };
    const vals = { tiltDeg: n(tilt, 'Độ nghiêng', 0, 90, false), azimuthDeg: n(az, 'Azimuth', 0, 359.999, false), albedo: n(alb, 'Albedo', 0, 1), loss: n(loss, 'Tổn hao', 0, 99.9), fixed: n(fixed, 'Tcell cố định', -40, 120, false), u0: n(u0, 'u0', 0.1, 100), u1: n(u1, 'u1', 0, 50), wind: n(wind, 'Gió dự phòng', 0, 50, false) };
    if (Object.values(vals).includes('bad' as never)) return;
    if (cell.value === 'fixed' && vals.fixed === null) return say(['Chọn nhiệt độ cell cố định thì phải nhập Tcell cố định']);
    say([]);
    const v = vals as Record<keyof typeof vals, number | null>;
    ctx.apply({ ...structuredClone(ctx.project), pv: { ...ctx.project.pv, ...(v.tiltDeg === null ? {} : { tiltDeg: v.tiltDeg }), ...(v.azimuthDeg === null ? {} : { azimuthDeg: v.azimuthDeg }), albedo: v.albedo!, lossRatio: v.loss! / 100, cellModel: cell.value as PvSettings['cellModel'],
      fixedCellTempC: v.fixed, faimanU0: v.u0!, faimanU1: v.u1!, windFallbackMs: v.wind, irradianceInput: irr.value as PvSettings['irradianceInput'] } });
  } }, tilt.node, az.node, alb.node, loss.node, h('label', {}, 'Nhiệt độ cell ', cell), fixed.node, u0.node, u1.node, wind.node, h('label', {}, 'Nguồn bức xạ ', irr),
  h('button', { type: 'submit', id: 'pv-save' }, 'Lưu thiết lập'),
  h('p', {}, `Mặc định chỉ cho tham số mô hình (albedo ${PV_DEFAULTS.albedo}, Faiman u0=${PV_DEFAULTS.faimanU0}, u1=${PV_DEFAULTS.faimanU1}, tổn hao 0 %). Độ nghiêng và hướng bắt buộc với chuỗi chưa đặt lên mái; chuỗi đã đặt lên mặt mái lấy hướng từ mái.`));
}

function runSection(ctx: PvCtx, input: ReturnType<typeof compilePv>['input'], hash: string | null, issues: { code: string; field: string; message: string }[], w: WeatherSeries | undefined, say: (l: string[]) => void): HTMLElement {
  const bar = h('progress', { id: 'pv-progress', max: 100, value: 0, hidden: true, 'aria-label': 'Tiến độ' });
  const cancel = h('button', { id: 'pv-cancel', hidden: true }, 'Hủy');
  const run = h('button', { id: 'pv-run' }, 'Chạy mô phỏng PV');
  run.addEventListener('click', async () => {
    if (!w) return say(['Chọn dữ liệu thời tiết trước']);
    if (!input || !hash) return say(issues.length ? issues.map((i) => `${i.code} tại ${i.field}: ${i.message}`) : ['Thiếu dữ liệu đầu vào']);
    run.disabled = true; bar.hidden = false; cancel.hidden = false;
    const job = runPvInWorker(input, hash, (d, t) => { bar.value = Math.round((d / t) * 100); });
    cancel.onclick = () => job.cancel();
    const out = await job.promise;
    if (out.status === 'result') { ctx.setResult(out.result); ctx.rerender(); return; }
    run.disabled = false; bar.hidden = true; cancel.hidden = true;
    say(out.status === 'cancelled' ? ['Đã hủy; không có kết quả nào được lưu.'] : out.issues.map((i) => `${i.code} tại ${i.field}: ${i.message}`));
  });
  return h('div', {}, run, cancel, bar,
    !input && w && issues.length ? h('ul', { id: 'compile-issues' }, ...issues.map((i) => h('li', {}, `${i.code} tại ${i.field}: ${i.message}`))) : null);
}

function resultSection(r: PvResult, w: WeatherSeries, tz: string, unplaced = 0): HTMLElement {
  const t = r.totals;
  const row = (label: string, v: string) => h('tr', {}, h('th', { scope: 'row' }, label), h('td', { className: 'num' }, v));
  const step = r.period.stepSeconds;
  const dates = [...new Set(r.series.t.map((x) => localDate(x + step / 2, tz)))];
  const out = h('div', { id: 'pv-day' });
  const date = h('input', { id: 'pv-date', type: 'date', min: dates[0], max: dates[dates.length - 1], value: dates[Math.floor(dates.length / 2)] });
  const draw = () => {
    const idx = r.series.t.map((x, i) => (localDate(x + step / 2, tz) === date.value ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return out.replaceChildren(h('p', {}, 'Ngày này nằm ngoài khoảng dữ liệu.'));
    // x = local clock hour of the interval start (whole-hour zones such as Asia/Ho_Chi_Minh)
    const xs = idx.map((i) => localHour(r.series.t[i], tz) + (((r.series.t[i] % 3600) + 3600) % 3600) / 3600), pick = (a: number[]) => idx.map((i) => a[i]);
    const dayWh = idx.reduce((a, i) => a + (r.series.pInverterW[i] * step) / 3600, 0);
    out.replaceChildren(
      lineChart(xs, [
        { name: 'Lý tưởng', values: pick(r.series.pIdealW), dash: '', color: '#1b4f72' }, { name: 'Sau tổn hao', values: pick(r.series.pLossedW), dash: '6 3', color: '#117a65' },
        { name: 'Sau tracker', values: pick(r.series.pTrackerW), dash: '2 3', color: '#b9770e' }, { name: 'Sau inverter', values: pick(r.series.pInverterW), dash: '10 3 2 3', color: '#922b21' },
      ], { yLabel: 'Công suất (W, trung bình mỗi bước)', xLabel: `Giờ địa phương (${tz}), đầu mỗi bước`, label: `Công suất PV ngày ${date.value}` }),
      h('p', { id: 'pv-day-energy' }, `Điện năng ngày ${date.value}: ${(dayWh / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} kWh (= Σ công suất × bước / 3600).`),
      h('details', {}, h('summary', {}, 'Bảng theo bước'), h('table', {}, h('thead', {}, h('tr', {}, ...['Giờ', 'POA W/m²', 'Tcell °C', 'P lý tưởng W', 'P sau inverter W'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...idx.map((i) => h('tr', {}, h('td', {}, `${localHour(r.series.t[i] + step / 2, tz)}h`), ...[r.series.poaWm2[i], r.series.tcellC[i], r.series.pIdealW[i], r.series.pInverterW[i]].map((v) => h('td', { className: 'num' }, v.toFixed(1))))))),
      ));
  };
  date.addEventListener('change', draw);
  draw();
  const months = new Map<string, number>();
  r.series.t.forEach((x, i) => { const k = localDate(x + step / 2, tz).slice(0, 7); months.set(k, (months.get(k) ?? 0) + (r.series.pInverterW[i] * step) / 3600); });
  return h('section', { id: 'pv-result', 'aria-label': 'Kết quả PV' },
    h('h3', {}, '4. Kết quả'),
    h('p', {}, `Mô hình: vị trí mặt trời ${r.models.solarPosition}; transposition ${r.models.transposition}; nhiệt độ cell ${r.models.cellTemperature}; DC ${r.models.dc}; giới hạn ${r.models.limits}. Khoảng ${r.period.startUtc} → ${r.period.endUtc} (UTC), bước ${step / 60} phút; hiển thị theo ${tz}.`),
    h('table', { id: 'pv-totals' },
      row('Công suất đỉnh lắp đặt', `${t.kWp.toLocaleString('vi-VN', { maximumFractionDigits: 3 })} kWp`), row('Điện năng lý tưởng (trước tổn hao và giới hạn)', `${kwh(t.eIdealWh)} kWh`),
      row('Tổn hao DC', `${t.lossWh < 50 ? '' : '−'}${kwh(t.lossWh)} kWh`), row('Bị cắt bởi tracker', `${t.clippedTrackerWh < 50 ? '' : '−'}${kwh(t.clippedTrackerWh)} kWh`), row('Bị cắt bởi inverter (PV vào tối đa)', `${t.clippedInverterWh < 50 ? '' : '−'}${kwh(t.clippedInverterWh)} kWh`),
      row('Điện năng DC sau giới hạn', `${kwh(t.eInverterWh)} kWh`), row('Công suất đỉnh sau giới hạn', `${Math.round(t.peakW).toLocaleString('vi-VN')} W`),
      row('Suất phát', t.specificYieldKWhPerKWp === null ? 'không tính được' : `${t.specificYieldKWhPerKWp.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} kWh/kWp trong khoảng dữ liệu`)),
    r.shade ? h('p', { id: 'pv-shade-note' }, `Có bóng che: ${r.shade.modelVersion}, ${r.shade.mode === 'preview' ? '1 điểm' : `lưới ${Math.sqrt(r.shade.samplesPerPanel)}×${Math.sqrt(r.shade.samplesPerPanel)}`} mỗi tấm, chuỗi tính theo ${r.shade.stringMode === 'sum' ? 'cộng công suất tấm (cận trên)' : 'tấm yếu nhất (cận dưới)'}. ${r.shade.notes.join('. ')}.${unplaced ? ` ${unplaced} tấm chưa đặt lên mái nên không có bóng.` : ''}`) : null,
    h('p', {}, 'Đây là công suất DC theo mô hình ở đầu vào inverter, chưa qua hiệu suất inverter, pin và tải (W05); không phải cam kết sản lượng thực.'),
    h('h4', {}, 'Giả định và giới hạn đã áp dụng'),
    h('ul', {}, ...r.assumptions.map((a) => h('li', {}, a)), ...r.limitsApplied.map((a) => h('li', {}, 'Đã áp: ' + a)), ...r.limitsSkipped.map((a) => h('li', {}, 'Không áp: ' + a))),
    h('h4', {}, 'Theo ngày'), h('label', {}, 'Ngày ', date), out,
    h('h4', {}, 'Theo tháng (giờ địa phương; chuỗi UTC cả năm tràn sang đầu năm sau)'), barChart([...months.keys()].map((k) => `${k.slice(2, 4)}-${k.slice(5)}`), [...months.values()].map((x) => x / 1000), { yLabel: 'kWh DC sau giới hạn', label: 'Điện năng theo tháng' }),
    h('p', {}, `Chạy bởi ${r.engineVersion}, mã đầu vào ${r.inputHash.slice(0, 12)}…; dữ liệu: ${w.source.name}.`),
    h('button', { id: 'pv-csv', onClick: () => download(`pv-${r.inputHash.slice(0, 8)}.csv`, pvResultToCsv(r, { weatherName: w.name, source: w.source.name, timeZone: tz }), 'text/csv;charset=utf-8') }, 'Xuất CSV theo giờ'));
}
