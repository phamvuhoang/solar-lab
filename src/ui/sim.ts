import { lineChart } from '../diagrams/charts';
import { buildQuote, compareQuotes, type Comparison } from '../cost/quote';
import { PV_DEFAULTS } from '../engine/compile';
import { REASONS, reasonsOf, type Reason } from '../engine/dispatch';
import { compileSim, formatHours, parseHours, simPolicyOf } from '../engine/sim-compile';
import type { SimResult } from '../engine/system';
import { buildLamHaConfig, LAMHA_CONFIG_LABEL, type LamHaConfig } from '../domain/presets';
import { refKey, type Component, type LoadPlan, type Offer, type Project } from '../domain/types';
import { parseNumber } from '../domain/units';
import { simResultToCsv } from '../reports/sim-csv';
import { localDate, localHour, type WeatherSeries } from '../weather/series';
import { runSimInWorker } from '../worker/client';
import { download, h } from './dom';

export const REASON_VI: Record<Reason, string> = {
  PV_TO_LOAD: 'PV cấp thẳng cho tải', BATTERY_CHARGE: 'Sạc pin từ PV dư', BATTERY_DISCHARGE: 'Pin cấp cho tải', BATTERY_FULL: 'Pin đầy, không sạc thêm', RESERVE_REACHED: 'Pin chạm mức dự phòng, không cấp thêm',
  CHARGE_LIMIT_BMS: 'Giới hạn dòng sạc của pin (BMS)', CHARGE_LIMIT_INVERTER: 'Giới hạn dòng sạc của inverter', DISCHARGE_LIMIT_BMS: 'Giới hạn dòng xả của pin (BMS)', DISCHARGE_LIMIT_INVERTER: 'Giới hạn dòng xả của inverter',
  INVERTER_AC_LIMIT: 'Tải vượt công suất AC liên tục của inverter', GRID_IMPORT: 'Lấy điện lưới', GRID_OUTAGE: 'Mất lưới', EXPORT: 'Xuất lên lưới', EXPORT_FORBIDDEN: 'PV dư nhưng không được xuất lưới',
  CURTAILED_PV: 'PV dư bị cắt', CLIPPED_PV: 'PV bị cắt bởi giới hạn tracker/inverter', START_BLOCKED: 'Khởi động động cơ bị chặn (công suất đỉnh không đủ)', UNSERVED_LOAD: 'Tải thiếu điện', STANDBY: 'Inverter tự tiêu thụ',
  NO_BATTERY: 'Không có pin', PUMP_BRANCH_CURTAILED: 'PV nhánh bơm dư bị cắt',
};

export interface Run { label: 'A' | 'B'; source: { kind: 'current' } | { kind: 'revision'; n: number }; title: string; hash: string; result: SimResult; projectName: string }
export interface SimState { runs: Run[]; side: 0 | 1; step: number; progress: Record<string, number> }

export interface SimCtx {
  project: Project; components: Component[]; offers: Offer[]; revisions: { revision: number; savedAt: string }[];
  loadRevision(n: number): Promise<Project | undefined>; loadWeather(id: string): Promise<WeatherSeries | undefined>;
  apply(next: Project): Promise<void>; state: SimState; rerender(): void; back(): void; goPv(): void;
}

const pct = (x: number | null) => (x === null ? '—' : (x * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' %');
const kwh = (wh: number) => (Math.abs(wh) < 5 ? 0 : wh / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const dec = (x: number | null | undefined) => (x === null || x === undefined ? '' : String(x).replace('.', ','));

/** The project as run for one side: its own design, but the current project's weather and dispatch policy, so A and B share conditions. */
export function asRunFor(base: Project, current: Project): Project {
  return { ...structuredClone(base), sim: structuredClone(current.sim), pv: { ...base.pv, weatherId: current.pv?.weatherId ?? null } };
}

export async function renderSim(ctx: SimCtx): Promise<Node[]> {
  const p = ctx.project, tz = p.location?.timezone ?? 'Asia/Ho_Chi_Minh';
  const weather = p.pv?.weatherId ? await ctx.loadWeather(p.pv.weatherId) : undefined;
  const msg = h('div', { id: 'sim-messages', role: 'alert' });
  const say = (lines: string[]) => msg.replaceChildren(...lines.map((l) => h('p', {}, l)));

  // a stored run is shown only if the inputs it came from still hash the same
  const valid: (Run | null)[] = await Promise.all(ctx.state.runs.map(async (r) => {
    if (!weather) return null;
    const base = r.source.kind === 'current' ? p : await ctx.loadRevision(r.source.n);
    if (!base) return null;
    const c = await compileSim(asRunFor(base, p), weather);
    return c.hash === r.hash ? r : null;
  }));
  const runs = valid.filter(Boolean) as Run[];
  const stale = ctx.state.runs.length > runs.length;
  // cost difference uses the W02 quote rules: A and B are the two designs that were run
  let cost: Comparison | null = null;
  if (runs.length === 2) {
    const [ra, rb] = runs;
    const pa = ra.source.kind === 'revision' ? await ctx.loadRevision(ra.source.n) : p, pb = rb.source.kind === 'revision' ? await ctx.loadRevision(rb.source.n) : p;
    if (pa && pb) cost = compareQuotes(buildQuote(pa), buildQuote(pb));
  }

  return [
    h('h2', {}, `Hệ thống: pin, tải, bơm · ${p.name}`), h('button', { onClick: ctx.back }, 'Quay lại dự án'), h('button', { onClick: ctx.goPv }, 'Thời tiết và PV'), msg,
    h('p', { id: 'sim-weather' }, weather ? `Dữ liệu: ${weather.name} (${weather.source.period ?? 'không rõ năm'}) · ${weather.source.name}` : 'Chưa chọn dữ liệu thời tiết: vào "Thời tiết và PV" để chọn và khai độ nghiêng/hướng.'),
    h('h3', {}, '1. Cấu hình mẫu Lâm Hà'), configButtons(ctx, say),
    h('h3', {}, '2. Chính sách điều phối'), policyForm(ctx, say),
    h('h3', {}, '3. Lịch tải và bơm'), loadPlans(ctx, say),
    h('h3', {}, '4. Chạy'), runControls(ctx, weather, say),
    stale ? h('p', { id: 'sim-stale' }, 'Có kết quả đã chạy trước đó không còn khớp thiết kế, lịch tải, chính sách hoặc dữ liệu hiện tại; đã ẩn. Chạy lại để cập nhật.') : null,
    runs.length && weather ? results(ctx, runs, weather, tz, cost) : null,
  ].filter(Boolean) as Node[];
}

function configButtons(ctx: SimCtx, say: (l: string[]) => void): HTMLElement {
  const c = (id: string) => ctx.components.find((x) => x.modelId === id)!;
  const off = (x: Component) => ctx.offers.filter((o) => refKey(o.componentRef) === refKey(x));
  const build = (k: LamHaConfig) => h('button', { id: `cfg-${k}`, onClick: () => {
    try { ctx.apply(buildLamHaConfig(ctx.project, k, { inverter: c('luxpower-sna6000wpv'), battery: c('used-battery'), home: c('sample-home-load'), pump: c('sample-pump-load'), controller: c('sample-pump-controller') }, off)); }
    catch (e) { say([(e as Error).message === 'NO_PANELS' ? 'Cần ít nhất 3 tấm trong dự án' : (e as Error).message]); }
  } }, `Dựng ${LAMHA_CONFIG_LABEL[k]}`);
  return h('div', {}, build('shared8'), build('split6+2'), h('p', {}, 'Dựng lại phần điện (inverter, pin, tải, chuỗi) từ các tấm và pin hiện có; mỗi lần dựng là một revision để so A/B. Lịch mặc định: tải nhà cả ngày, bơm 1 giờ lúc 18h (giả định, sửa bên dưới).'));
}

function policyForm(ctx: SimCtx, say: (l: string[]) => void): HTMLElement {
  const sp = simPolicyOf(ctx.project);
  const f = (id: string, label: string, v: string, ph = '') => { const el = h('input', { id, value: v, size: 6, placeholder: ph }); return { el, node: h('label', {}, label + ' ', el) }; };
  const minSoc = f('s-min', 'Dự phòng SoC (%)', dec(sp.minSoc * 100)), soc0 = f('s-soc0', 'SoC đầu (%)', dec(sp.soc0 * 100)), ec = f('s-ec', 'Hiệu suất sạc (%)', dec(sp.etaCharge * 100)), ed = f('s-ed', 'Hiệu suất xả (%)', dec(sp.etaDischarge * 100));
  const ei = f('s-ei', 'Hiệu suất inverter (%)', dec(sp.inverterEfficiency === null ? null : sp.inverterEfficiency * 100), 'trống = theo datasheet'), sb = f('s-sb', 'Tự tiêu thụ (W)', dec(sp.standbyW));
  const grid = h('input', { type: 'checkbox', id: 's-grid', checked: sp.gridAvailable }), imp = h('input', { type: 'checkbox', id: 's-imp', checked: sp.importAllowed }), exp = h('input', { type: 'checkbox', id: 's-exp', checked: sp.exportAllowed });
  const out = f('s-out', 'Giờ mất lưới mỗi ngày', formatHours(sp.outageLocalHours.reduce((a, x) => { a[x] = 1; return a; }, new Array<number>(24).fill(0))), 'ví dụ 18-21');
  return h('form', { 'aria-label': 'Chính sách điều phối', onSubmit: (e: Event) => {
    e.preventDefault();
    const n = (x: { el: HTMLInputElement }, name: string, lo: number, hi: number, req = true): number | null | 'bad' => {
      const t = x.el.value.trim();
      if (!t) return req ? (say([`${name}: bắt buộc`]), 'bad') : null;
      const v = parseNumber(t);
      if (v === null || v < lo || v > hi) { say([`${name}: cần số trong [${lo}, ${hi}]`]); return 'bad'; }
      return v;
    };
    const v = { min: n(minSoc, 'Dự phòng', 0, 99), soc0: n(soc0, 'SoC đầu', 0, 100), ec: n(ec, 'Hiệu suất sạc', 1, 100), ed: n(ed, 'Hiệu suất xả', 1, 100), ei: n(ei, 'Hiệu suất inverter', 1, 100, false), sb: n(sb, 'Tự tiêu thụ', 0, 5000) };
    if (Object.values(v).includes('bad' as never)) return;
    const hours = parseHours(out.el.value);
    if (!hours.ok) return say([`Giờ mất lưới: ${hours.message}`]);
    if (!grid.checked && (imp.checked || exp.checked)) return say(['Chọn "có lưới" trước khi cho phép nhập/xuất']);
    say([]);
    const x = v as Record<keyof typeof v, number | null>;
    ctx.apply({ ...structuredClone(ctx.project), sim: { minSoc: x.min! / 100, soc0: x.soc0! / 100, etaCharge: x.ec! / 100, etaDischarge: x.ed! / 100, inverterEfficiency: x.ei === null ? null : x.ei / 100, standbyW: x.sb!,
      gridAvailable: grid.checked, importAllowed: grid.checked && imp.checked, exportAllowed: grid.checked && exp.checked, outageLocalHours: hours.fractions.flatMap((q, hr) => (q ? [hr] : [])) } });
  } }, minSoc.node, soc0.node, ec.node, ed.node, ei.node, sb.node,
  h('label', {}, grid, ' Có lưới '), h('label', {}, imp, ' cho nhập '), h('label', {}, exp, ' cho xuất '), out.node, h('button', { type: 'submit', id: 's-save' }, 'Lưu chính sách'),
  h('p', {}, 'Hiệu suất sạc/xả 95 % và SoC đầu 50 % là giả định mô hình, không phải số đo; chính sách này áp dụng cho cả A và B.'));
}

function loadPlans(ctx: SimCtx, say: (l: string[]) => void): HTMLElement {
  const p = ctx.project;
  const loads = p.instances.filter((i) => i.kind === 'load');
  if (!loads.length) return h('p', {}, 'Chưa có tải. Dựng cấu hình mẫu hoặc thêm tải ở màn Thiết kế.');
  const plans = new Map((p.loadPlans ?? []).map((l) => [l.instanceId, l]));
  return h('div', {}, ...loads.map((inst) => {
    const plan = plans.get(inst.instanceId), comp = p.snapshots.components.find((c) => refKey(c) === (inst.componentRef ? refKey(inst.componentRef) : ''));
    const hours = h('input', { id: `lp-hours-${inst.instanceId}`, value: plan ? formatHours(plan.fractions) : '', placeholder: 'ví dụ 11 hoặc 6-8,18-22@0,5', 'aria-label': `Giờ chạy ${inst.label}`, size: 22 });
    const prio = h('input', { id: `lp-prio-${inst.instanceId}`, type: 'number', min: 1, max: 99, value: plan?.priority ?? 1, style: 'width:4rem', 'aria-label': `Ưu tiên ${inst.label}` });
    const isPump = h('input', { type: 'checkbox', id: `lp-pump-${inst.instanceId}`, checked: !!plan?.pump });
    const head = h('input', { id: `lp-head-${inst.instanceId}`, value: dec(plan?.pump?.staticHeadM), size: 5, 'aria-label': 'Cột áp tĩnh (m)' });
    const fric = h('input', { id: `lp-fric-${inst.instanceId}`, value: dec(plan?.pump?.frictionK), size: 5, 'aria-label': 'Hệ số tổn thất k' });
    const curve = h('textarea', { id: `lp-curve-${inst.instanceId}`, rows: 3, cols: 20, placeholder: 'mỗi dòng: Q m³/h: H m\n0: 30\n4: 18', value: plan?.pump?.curve ? plan.pump.curve.qM3h.map((q, i) => `${dec(q)}: ${dec(plan.pump!.curve!.headM[i])}`).join('\n') : '' });
    return h('div', { className: 'card', 'data-load': inst.instanceId }, h('strong', {}, inst.label), ` · ${comp?.specs.powerW?.v ?? '?'} W`, plan ? '' : ' · chưa đặt lịch', h('br'),
      h('label', {}, 'Giờ chạy (giờ địa phương) ', hours), h('label', {}, ' Ưu tiên (1 = cao nhất) ', prio), h('br'),
      h('label', {}, isPump, ' là bơm (tính m³) '), h('label', {}, ' cột áp tĩnh m ', head), h('label', {}, ' k (H = tĩnh + k·Q²) ', fric), h('label', {}, ' Đường cong Q–H ', curve),
      h('button', { onClick: () => {
        const hr = parseHours(hours.value);
        if (!hr.ok) return say([`${inst.label}: ${hr.message}`]);
        const pr = Number(prio.value);
        if (!Number.isInteger(pr) || pr < 1 || pr > 99) return say([`${inst.label}: ưu tiên phải là số nguyên 1–99`]);
        let pump: LoadPlan['pump'];
        if (isPump.checked) {
          const num = (t: string) => (t.trim() ? parseNumber(t.trim()) : null);
          const [sh, fk] = [num(head.value), num(fric.value)];
          if ((head.value.trim() && sh === null) || (fric.value.trim() && fk === null)) return say([`${inst.label}: cột áp và k phải là số`]);
          const pts: [number, number][] = [];
          for (const line of curve.value.split('\n').map((x) => x.trim()).filter(Boolean)) {
            const m = /^(\d+(?:[.,]\d+)?)\s*[:;\s]\s*(\d+(?:[.,]\d+)?)$/.exec(line);
            if (!m) return say([`${inst.label}: dòng "${line}" cần dạng "Q: H"`]);
            pts.push([Number(m[1].replace(',', '.')), Number(m[2].replace(',', '.'))]);
          }
          if (pts.length === 1 || pts.some((q, i) => i > 0 && q[0] <= pts[i - 1][0])) return say([`${inst.label}: đường cong cần ≥2 điểm với Q tăng dần`]);
          pump = { staticHeadM: sh, frictionK: fk, curve: pts.length ? { qM3h: pts.map((x) => x[0]), headM: pts.map((x) => x[1]) } : null };
        }
        say([]);
        const next = structuredClone(p);
        const entry: LoadPlan = { instanceId: inst.instanceId, fractions: hr.fractions, priority: pr, ...(pump ? { pump } : {}) };
        next.loadPlans = [...(next.loadPlans ?? []).filter((l) => l.instanceId !== inst.instanceId), entry];
        ctx.apply(next);
      } }, 'Lưu lịch'));
  }));
}

function runControls(ctx: SimCtx, weather: WeatherSeries | undefined, say: (l: string[]) => void): HTMLElement {
  const p = ctx.project;
  const revs = ctx.revisions.filter((r) => r.revision !== p.revision);
  const optA = h('select', { id: 'ab-a', 'aria-label': 'Phương án A' }, ...revs.map((r) => h('option', { value: String(r.revision) }, `revision ${r.revision} · ${r.savedAt.slice(0, 19).replace('T', ' ')}`)));
  if (revs.length) optA.value = String(revs[revs.length - 1].revision);
  const progress = h('progress', { id: 'sim-progress', max: 100, value: 0, hidden: true, 'aria-label': 'Tiến độ' });
  const cancel = h('button', { id: 'sim-cancel', hidden: true }, 'Hủy');
  const jobs: { cancel(): void }[] = [];
  cancel.onclick = () => jobs.forEach((j) => j.cancel());

  const go = async (sides: { label: 'A' | 'B'; source: Run['source']; base: Project; title: string }[]) => {
    if (!weather) return say(['Chọn dữ liệu thời tiết trước (Thời tiết và PV)']);
    const prepared = [];
    for (const s of sides) {
      const c = await compileSim(asRunFor(s.base, p), weather);
      if (!c.input || !c.hash) return say([`${s.title}: không chạy được`, ...c.issues.map((i) => `${i.code} tại ${i.field}: ${i.message}`)]);
      prepared.push({ ...s, input: c.input, hash: c.hash });
    }
    say([]);
    ctx.state.runs = []; ctx.state.step = 0; ctx.state.side = 0;
    progress.hidden = false; cancel.hidden = false; buttons.forEach((b) => { b.disabled = true; });
    const done: Run[] = [];
    const outs = await Promise.all(prepared.map((s, k) => {
      const job = runSimInWorker(s.input, s.hash, (d, t) => { ctx.state.progress[s.label] = d / t; progress.value = Math.round((Object.values(ctx.state.progress).reduce((a, b) => a + b, 0) / prepared.length) * 100); });
      jobs.push(job);
      return job.promise.then((o) => ({ o, s, k }));
    }));
    jobs.length = 0;
    for (const { o, s } of outs) {
      if (o.status === 'result') done.push({ label: s.label, source: s.source, title: s.title, hash: s.hash, result: o.result, projectName: s.base.name });
      else say(o.status === 'cancelled' ? ['Đã hủy; không có kết quả nào được lưu.'] : [`${s.title}: ${o.issues.map((i) => `${i.code} tại ${i.field}: ${i.message}`).join('; ')}`]);
    }
    if (done.length === prepared.length) ctx.state.runs = done;
    ctx.state.progress = {};
    ctx.rerender();
  };
  const runOne = h('button', { id: 'sim-run' }, 'Chạy cấu hình hiện tại');
  runOne.addEventListener('click', () => go([{ label: 'B', source: { kind: 'current' }, base: p, title: `Hiện tại (revision ${p.revision})` }]));
  const runAB = h('button', { id: 'sim-ab' }, 'So sánh A/B');
  runAB.addEventListener('click', async () => {
    const n = Number(optA.value), a = await ctx.loadRevision(n);
    if (!a) return say(['Chọn revision làm phương án A']);
    go([{ label: 'A', source: { kind: 'revision', n }, base: a, title: `A · revision ${n}` }, { label: 'B', source: { kind: 'current' }, base: p, title: `B · hiện tại (revision ${p.revision})` }]);
  });
  const buttons = [runOne, runAB];
  return h('div', {}, runOne, ' ', h('label', {}, 'A = ', optA), ' B = cấu hình hiện tại ', runAB, cancel, progress,
    h('p', {}, `A và B dùng cùng dữ liệu thời tiết (${weather?.name ?? 'chưa chọn'}), cùng SoC đầu và chính sách; mỗi bên giữ thiết kế và lịch tải của revision riêng.`));
}

function results(ctx: SimCtx, runs: Run[], weather: WeatherSeries, tz: string, costCmp: Comparison | null): HTMLElement {
  const [a, b] = runs.length === 2 ? runs : [null, runs[0]];
  const cols = a ? [a, b] : [b];
  const m = (r: Run) => ({ d: r.result.dispatch, t: r.result.dispatch.totals, mm: r.result.dispatch.metrics });
  const rows: [string, (r: Run) => string, ((x: Run, y: Run) => string) | null][] = [
    ['Điện PV tới inverter (sau giới hạn)', (r) => `${kwh(m(r).t.pvBusWh)} kWh`, (x, y) => `${kwh(m(y).t.pvBusWh - m(x).t.pvBusWh)} kWh`],
    ['Tải yêu cầu', (r) => `${kwh(m(r).t.loadRequestedWh)} kWh`, null],
    ['Tải được cấp', (r) => `${kwh(m(r).t.loadServedWh)} kWh`, (x, y) => `${kwh(m(y).t.loadServedWh - m(x).t.loadServedWh)} kWh`],
    ['Tỉ lệ đáp ứng', (r) => (m(r).mm.servedRatio === null ? `— (${m(r).mm.servedRatioNote})` : pct(m(r).mm.servedRatio)), null],
    ['Số giờ tải thiếu', (r) => `${m(r).mm.hoursShort.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ`, (x, y) => `${(m(y).mm.hoursShort - m(x).mm.hoursShort).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ`],
    ['Điện thiếu', (r) => `${kwh(m(r).t.unservedWh)} kWh`, (x, y) => `${kwh(m(y).t.unservedWh - m(x).t.unservedWh)} kWh`],
    ['PV dư (cắt + xuất)', (r) => `${kwh(m(r).t.curtailedWh + m(r).t.exportWh - m(r).t.clipWh)} kWh`, (x, y) => `${kwh((m(y).t.curtailedWh + m(y).t.exportWh - m(y).t.clipWh) - (m(x).t.curtailedWh + m(x).t.exportWh - m(x).t.clipWh))} kWh`],
    ['Pin: điện năng xả (tại bus)', (r) => `${kwh(m(r).t.dischargeBusWh)} kWh`, (x, y) => `${kwh(m(y).t.dischargeBusWh - m(x).t.dischargeBusWh)} kWh`],
    ['Nhập / xuất lưới', (r) => `${kwh(m(r).t.gridImportWh)} / ${kwh(m(r).t.exportWh)} kWh`, null],
    ['Tổn hao: inverter / sạc / xả / tự dùng', (r) => `${kwh(m(r).t.inverterLossWh)} / ${kwh(m(r).t.chargeLossWh)} / ${kwh(m(r).t.dischargeLossWh)} / ${kwh(m(r).t.standbyWh)} kWh`, null],
    ['SoC đầu → cuối', (r) => `${pct(m(r).mm.socStart)} → ${pct(m(r).mm.socEnd)}`, null],
    ['SoC thấp nhất', (r) => (m(r).mm.minSoc === null ? '—' : `${pct(m(r).mm.minSoc)} lúc ${fmtT(m(r).mm.minSocAt!, tz)}`), null],
    ['Lần thiếu điện đầu tiên', (r) => (m(r).mm.firstShortageAt === null ? 'không có' : fmtT(m(r).mm.firstShortageAt!, tz)), null],
    ['Tháng ít nắng nhất (đủ dữ liệu)', (r) => (m(r).mm.lowestSunMonth ? `${m(r).mm.lowestSunMonth!.month}: ${m(r).mm.lowestSunMonth!.pvKWh.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} kWh` : '—'), null],
    ['Bơm: thể tích', (r) => m(r).d.loads.filter((l) => l.volumeM3 !== null || l.volumeNote).map((l) => `${l.label}: ${l.volumeM3 === null ? l.volumeNote : l.volumeM3.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' m³'}`).join('; ') || '—', null],
    ['Khởi động bị chặn', (r) => `${m(r).d.loads.reduce((s, l) => s + l.startsBlocked, 0)} / ${m(r).d.startCheckCount}`, null],
    ['Sổ năng lượng: sai số lớn nhất / bước', (r) => `${m(r).d.ledger.maxResidualWh.toExponential(1)} Wh (ngưỡng đạt)`, null],
  ];
  const energyNote = a && Math.abs(m(a).t.eEndWh - m(b).t.eEndWh) > 1
    ? `Hai phương án kết thúc với năng lượng trong pin khác nhau: B ${m(b).t.eEndWh > m(a).t.eEndWh ? 'còn nhiều hơn' : 'còn ít hơn'} A ${kwh(Math.abs(m(b).t.eEndWh - m(a).t.eEndWh))} kWh. Phần này chưa được tính như điện đã cấp; khi so điện đã cấp cần xét riêng.` : null;
  const vnd = (x: string) => `${BigInt(x) > 0n ? '+' : ''}${Number(x).toLocaleString('vi-VN')} đ`;
  const cost = costCmp ? h('p', { id: 'sim-cost' }, 'Chênh chi phí B − A: ',
    costCmp.totalDeltaMinor !== null ? `toàn hệ ${vnd(costCmp.totalDeltaMinor)}` : costCmp.knownDeltaMinor !== null ? `phần đã biết ${vnd(costCmp.knownDeltaMinor)} (chưa đủ giá để công bố chênh toàn hệ)` : 'không công bố: hai phương án thiếu giá hoặc hạng mục khác nhau (xem bảng dự toán A/B)') : null;
  const step = Math.min(ctx.state.step, b.result.dispatch.period.n - 1);
  return h('section', { id: 'sim-result', 'aria-label': 'Kết quả hệ thống' },
    h('h3', {}, '5. Kết quả'),
    h('p', { id: 'sim-scope' }, `Kết luận chỉ đúng cho dữ liệu đã chọn: ${weather.name} (${weather.source.period ?? '?'}), SoC đầu ${pct(simPolicyOf(ctx.project).soc0)}, chính sách và lịch tải như trên. Không suy ra cho năm hay địa điểm khác.`),
    h('table', { id: 'sim-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Chỉ số'), ...cols.map((r) => h('th', {}, r.title)), a ? h('th', {}, 'Chênh B − A') : null)),
      h('tbody', {}, ...rows.map(([label, f, d]) => h('tr', {}, h('th', { scope: 'row' }, label), ...cols.map((r) => h('td', {}, f(r))), a ? h('td', {}, d ? d(a, b) : '—') : null)))),
    energyNote ? h('p', { id: 'sim-energy-note' }, energyNote) : null, cost,
    h('h4', {}, 'Lý do giới hạn (số bước)'), reasonTable(cols), h('h4', {}, 'Giả định đã áp dụng'),
    h('ul', {}, ...[...new Set(cols.flatMap((r) => [...r.result.pv.assumptions, ...r.result.dispatch.assumptions, ...r.result.dispatch.skipped.map((x) => 'Không áp: ' + x)]))].map((x) => h('li', {}, x))),
    replay(ctx, cols, step, tz),
    h('button', { id: 'sim-csv', onClick: () => { const r = cols[ctx.state.side] ?? cols[0]; download(`he-thong-${r.label}-${r.hash.slice(0, 8)}.csv`, simResultToCsv(r.result, { projectName: r.projectName, weatherName: weather.name, timeZone: tz, label: r.title }), 'text/csv;charset=utf-8'); } }, 'Xuất CSV theo giờ (phương án đang xem)'));
}

const fmtT = (epoch: number, tz: string) => new Intl.DateTimeFormat('vi-VN', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(epoch * 1000));

function reasonTable(cols: Run[]): HTMLElement {
  const codes = REASONS.filter((r) => cols.some((c) => c.result.dispatch.reasonTotals[r]));
  return h('table', { id: 'reason-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Mã'), h('th', {}, 'Ý nghĩa'), ...cols.map((c) => h('th', {}, c.label)))),
    h('tbody', {}, ...codes.map((code) => h('tr', {}, h('td', {}, code), h('td', {}, REASON_VI[code]), ...cols.map((c) => { const t = c.result.dispatch.reasonTotals[code]; return h('td', {}, t ? `${t.steps.toLocaleString('vi-VN')} bước${t.wh !== null ? ` · ${kwh(t.wh)} kWh` : ''}` : '0'); })))));
}

function replay(ctx: SimCtx, cols: Run[], step: number, tz: string): HTMLElement {
  const side = Math.min(ctx.state.side, cols.length - 1), run = cols[side], d = run.result.dispatch, s = d.series, n = d.period.n, dt = d.period.stepSeconds / 3600;
  const go = (i: number) => { ctx.state.step = Math.max(0, Math.min(n - 1, i)); ctx.rerender(); };
  const bit = (c: Reason) => 1 << REASONS.indexOf(c);
  const next = (pred: (i: number) => boolean, from: number) => { for (let i = from + 1; i < n; i++) if (pred(i)) return i; for (let i = 0; i <= from; i++) if (pred(i)) return i; return -1; };
  const jump = (id: string, label: string, pred: (i: number) => boolean) => h('button', { id, onClick: () => { const i = next(pred, step); if (i < 0) return alertNone(label); go(i); } }, label);
  const note = h('span', { id: 'replay-note', role: 'status' });
  const alertNone = (label: string) => { note.textContent = `Không có bước nào cho "${label}" trong dữ liệu này.`; };
  const slider = h('input', { type: 'range', id: 'replay-slider', min: 0, max: n - 1, value: step, 'aria-label': 'Bước thời gian', style: 'width:100%' });
  slider.addEventListener('change', () => go(Number(slider.value)));
  const date = localDate(s.t[step] + d.period.stepSeconds / 2, tz);
  const idx = s.t.map((t, i) => (localDate(t + d.period.stepSeconds / 2, tz) === date ? i : -1)).filter((i) => i >= 0);
  const xs = idx.map((i) => localHour(s.t[i], tz) + (((s.t[i] % 3600) + 3600) % 3600) / 3600), pick = (a: number[], k = 1 / dt) => idx.map((i) => a[i] * k);
  const reasons = reasonsOf(s.reasons[step]);
  const row = (l: string, v: string) => h('tr', {}, h('th', { scope: 'row' }, l), h('td', { className: 'num' }, v));
  return h('div', { id: 'replay' },
    h('h4', {}, 'Replay theo giờ địa phương'),
    cols.length > 1 ? h('p', {}, ...cols.map((c, k) => h('button', { 'aria-pressed': String(k === side), onClick: () => { ctx.state.side = k as 0 | 1; ctx.rerender(); } }, `Xem ${c.label}`))) : null,
    h('p', { id: 'replay-time' }, `${fmtT(s.t[step], tz)} (${tz}) · bước ${step + 1}/${n} · ${run.title}`), slider,
    h('div', {}, h('button', { onClick: () => go(step - 1) }, '← bước trước'), h('button', { onClick: () => go(step + 1) }, 'bước sau →'),
      jump('jump-short', 'Lần thiếu điện kế tiếp', (i) => s.unservedWh[i] > 1e-6), jump('jump-full', 'Pin đầy kế tiếp', (i) => (s.reasons[i] & bit('BATTERY_FULL')) !== 0),
      jump('jump-reserve', 'Chạm dự phòng kế tiếp', (i) => (s.reasons[i] & bit('RESERVE_REACHED')) !== 0), jump('jump-start', 'Khởi động bị chặn kế tiếp', (i) => (s.reasons[i] & bit('START_BLOCKED')) !== 0), note),
    h('table', { id: 'replay-step' },
      row('PV tới inverter (trước / sau giới hạn)', `${(s.pvPotentialWh[step] / dt).toFixed(0)} → ${(s.pvBusWh[step] / dt).toFixed(0)} W`), row('Tải yêu cầu / được cấp / thiếu', `${s.loadRequestedWh[step].toFixed(0)} / ${s.loadServedWh[step].toFixed(0)} / ${s.unservedWh[step].toFixed(0)} Wh`),
      row('Pin: sạc / xả (tại bus)', `${s.chargeBusWh[step].toFixed(0)} / ${s.dischargeBusWh[step].toFixed(0)} Wh`), row('SoC cuối bước', pct(s.socEnd[step])),
      row('Lưới nhập / xuất · PV bị cắt', `${s.gridImportWh[step].toFixed(0)} / ${s.exportWh[step].toFixed(0)} Wh · ${s.curtailedWh[step].toFixed(0)} Wh`), row('Sai số sổ năng lượng', `${s.residualWh[step].toExponential(1)} Wh`)),
    h('ul', { id: 'replay-reasons' }, ...(reasons.length ? reasons.map((r) => h('li', {}, `${r}: ${REASON_VI[r]}`)) : [h('li', {}, 'Không có sự kiện đặc biệt')])),
    lineChart(xs, [{ name: 'PV tới inverter', values: pick(s.pvBusWh), dash: '', color: '#b9770e' }, { name: 'Tải được cấp', values: pick(s.loadServedWh), dash: '6 3', color: '#1b4f72' }, { name: 'Pin xả', values: pick(s.dischargeBusWh), dash: '2 3', color: '#922b21' }, { name: 'Pin sạc', values: pick(s.chargeBusWh), dash: '10 3 2 3', color: '#117a65' }],
      { yLabel: 'Công suất (W, trung bình mỗi bước)', xLabel: `Giờ địa phương ngày ${date}`, label: `Dòng công suất ngày ${date}` }),
    lineChart(xs, [{ name: 'SoC', values: idx.map((i) => s.socEnd[i] * 100), dash: '', color: '#2874a6' }], { yLabel: 'SoC cuối bước (%)', xLabel: `Giờ địa phương ngày ${date}`, label: `SoC pin ngày ${date}` }),
  );
}
