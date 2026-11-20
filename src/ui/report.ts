import { barChart, lineChart } from '../diagrams/charts';
import { compareQuotes, buildQuote } from '../cost/quote';
import { hashOf } from '../domain/hash';
import { SAMPLE_TAG } from '../domain/seed';
import { nowIso } from '../domain/ids';
import type { Project } from '../domain/types';
import { compilePv, hashPvInput } from '../engine/compile';
import { asRunFor, compileSim } from '../engine/sim-compile';
import type { PvResult } from '../engine/pv';
import { quoteToCsv } from '../reports/csv';
import { buildPackage, recordPv, recordSim, type RecordedRun } from '../reports/package';
import { pvResultToCsv } from '../reports/pv-csv';
import { CURRENT_ENGINES } from '../reports/replay';
import { reportFacts, type LevelState, type ReportFacts, type ReportRun } from '../reports/report-data';
import { simResultToCsv } from '../reports/sim-csv';
import { WIRING_NOTE, wiringTable } from '../reports/wiring';
import { shadeFor } from '../shade/usage';
import { BUNDLED_WEATHER } from '../weather/bundled';
import type { WeatherSeries } from '../weather/series';
import { runPvInWorker, runSimInWorker, type Job } from '../worker/client';
import { download, h } from './dom';
import type { Tab } from './route';
import projectSchema from '../../schemas/project-v1.json';

const OWNER_FIELDS = projectSchema.properties.owner.properties;

/** Results computed for the report. They belong to one revision: any edit clears them so the page never mixes old numbers with a new design. */
export interface ReportState { forRevision: number | null; pv: PvResult | null; runs: ReportRun[]; includeContact: boolean; includeSeries: boolean; includeWiring: boolean; weatherHash: string | null; message: string; aRevision: string }
export const freshReport = (): ReportState => ({ forRevision: null, pv: null, runs: [], includeContact: false, includeSeries: true, includeWiring: false, weatherHash: null, message: '', aRevision: '' });
export interface ReportCtx {
  project: Project; revisions: { revision: number; savedAt: string }[]; state: ReportState; buildId: string;
  loadRevision(n: number): Promise<Project | undefined>; loadWeather(id: string): Promise<WeatherSeries | undefined>;
  apply(next: Project): Promise<void>; rerender(): void; go(tab: Tab): void;
}

const LEVEL_TEXT: Record<LevelState, string> = { done: 'đã thực hiện', gaps: 'đã thực hiện, còn thiếu', 'not-run': 'chưa chạy', off: 'không bật', 'out-of-scope': 'ngoài phạm vi công cụ' };
const kwh = (wh: number) => (Math.abs(wh) < 5 ? 0 : wh / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} %`);
const money = (m: string | null) => (m === null ? '—' : `${Number(m).toLocaleString('vi-VN')} đ`);
const dtab = (head: string[], rows: (string | Node)[][], id?: string) =>
  h('table', { id }, h('thead', {}, h('tr', {}, ...head.map((t) => h('th', { scope: 'col' }, t)))), h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, c) : h('td', {}, c)))))));

/** The A4 page. Plain data in, DOM out; charts are SVG with their numbers printed on or beside them. */
export function buildReportPage(f: ReportFacts): HTMLElement {
  const q = f.quote.quote;
  const [a, b] = f.runs.length === 2 ? f.runs : [null, f.runs[0] ?? null];
  const cols = a ? [a, b!] : b ? [b] : [];
  const m = (r: ReportRun) => ({ t: r.result.dispatch.totals, mm: r.result.dispatch.metrics });
  const abRows: [string, (r: ReportRun) => string][] = [
    ['Tải được cấp', (r) => `${kwh(m(r).t.loadServedWh)} kWh`], ['Tỉ lệ đáp ứng', (r) => pct(m(r).mm.servedRatio)], ['Số giờ tải thiếu', (r) => `${m(r).mm.hoursShort.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ`],
    ['Điện thiếu', (r) => `${kwh(m(r).t.unservedWh)} kWh`], ['Pin xả (tại bus)', (r) => `${kwh(m(r).t.dischargeBusWh)} kWh`], ['PV dư (cắt + xuất)', (r) => `${kwh(m(r).t.curtailedWh + m(r).t.exportWh - m(r).t.clipWh)} kWh`],
    ['SoC đầu → cuối', (r) => `${pct(m(r).mm.socStart)} → ${pct(m(r).mm.socEnd)}`], ['SoC thấp nhất', (r) => pct(m(r).mm.minSoc)], ['Mã đầu vào', (r) => r.hash.slice(0, 12)],
  ];
  const cost = f.cost;
  const costText = !cost ? null : cost.totalDeltaMinor !== null ? `Chênh chi phí B − A (toàn hệ): ${money(cost.totalDeltaMinor)}` : cost.knownDeltaMinor !== null ? `Chênh chi phí B − A (phần đã biết): ${money(cost.knownDeltaMinor)}; chưa đủ giá để công bố chênh toàn hệ.` : 'Chênh chi phí B − A: không công bố vì hai phương án thiếu giá hoặc hạng mục khác nhau.';
  return h('article', { className: 'report-page', id: 'report', 'aria-label': 'Báo cáo' },
    h('header', {}, h('h2', {}, `Báo cáo thiết kế: ${f.title}`), h('p', {}, `Bản nháp revision ${f.revision} · lập ${f.generatedAt.slice(0, 10)}`),
      f.sample && h('p', { id: 'rp-sample' }, SAMPLE_TAG),
      f.owner ? h('p', { id: 'rp-owner' }, `Khách hàng/liên hệ: ${[f.owner.name, f.owner.phone, f.owner.email, f.owner.address].filter(Boolean).join(' · ')}`) : h('p', { id: 'rp-owner' }, 'Thông tin liên hệ: đã bỏ khỏi báo cáo này.')),
    h('section', {}, h('h3', {}, 'Phạm vi và giới hạn'), h('ul', { id: 'rp-scope' }, ...f.scope.map((x) => h('li', {}, x)))),
    h('section', {}, h('h3', {}, 'Chi phí'),
      h('p', { id: 'rp-price-date' }, `Ngày giá: ${f.quote.date ?? 'chưa rõ ngày ghi giá'}${f.quote.validUntil ? ` · hiệu lực đến ${f.quote.validUntil}` : ''}.`),
      dtab(['Chỉ tiêu', 'Giá trị'], [['Tổng phần đã biết (chưa VAT)', money(q.knownSubtotalMinor)], ['VAT', money(q.vatMinor)], ['Giao hàng', money(q.shippingMinor)], ['Tổng hoàn chỉnh', f.quote.totalText]], 'rp-cost'),
      dtab(['Nhóm', 'Mô tả', 'SL', 'Thành tiền', 'Trạng thái'], q.lines.map((l) => [l.category, l.label, l.qtyUnit === 'mm' ? `${l.qty / 1000} m` : String(l.qty), l.totalMinor === null ? '—' : money(l.totalMinor), l.status === 'known' ? 'đã có giá' : l.status === 'missing' ? 'CHƯA CÓ GIÁ' : 'trong kit']), 'rp-lines')),
    h('section', {}, h('h3', {}, 'Cấp độ kiểm tra'),
      dtab(['Lớp kiểm tra', 'Trạng thái', 'Chi tiết'], f.levels.map((l) => [l.name, LEVEL_TEXT[l.state], l.detail]), 'rp-levels'),
      f.checks.notable.length ? h('ul', { id: 'rp-notable' }, ...f.checks.notable.slice(0, 8).map((x) => h('li', {}, `${x.status === 'fail' ? 'KHÔNG ĐẠT' : x.status === 'limited' ? 'Sát giới hạn' : 'Chưa kiểm được'} · ${x.message}`))) : null),
    h('section', {}, h('h3', {}, 'Giả định'), h('ul', { id: 'rp-assumptions' }, ...f.assumptions.map((x) => h('li', {}, x)))),
    h('section', {}, h('h3', {}, 'Nguồn thời tiết'),
      f.weather ? dtab(['Mục', 'Giá trị'], [['Tên', f.weather.name], ['Nguồn', f.weather.source], ['Phương pháp', f.weather.method], ['Kỳ dữ liệu', f.weather.period], ['Giấy phép', f.weather.license], ['Ngày lấy', f.weather.retrieved], ['Số bước', String(f.weather.steps)], ['Số liệu đính kèm', f.weather.attached ? 'có' : 'không (chỉ tham chiếu)']], 'rp-weather') : h('p', {}, 'Chưa chọn dữ liệu thời tiết.')),
    f.monthly ? h('section', {}, h('h3', {}, 'Sản lượng PV theo tháng'),
      h('div', { id: 'rp-chart-month' }, barChart(f.monthly.map((x) => x.month.slice(2)), f.monthly.map((x) => x.kWh), { yLabel: 'kWh mỗi tháng, giờ địa phương (sau tổn hao và giới hạn)', label: 'Sản lượng PV theo tháng' })),
      dtab(['Tháng', 'kWh'], f.monthly.map((x) => [x.month, x.kWh.toLocaleString('vi-VN', { maximumFractionDigits: 0 })]), 'rp-month-table'),
      f.typicalDay ? h('div', { id: 'rp-chart-day' }, lineChart(f.typicalDay.hours, [{ name: 'Công suất PV trung bình', values: f.typicalDay.avgW, dash: '', color: '#2874a6' }], { yLabel: 'W (trung bình theo giờ trong ngày)', xLabel: 'Giờ địa phương', label: 'Ngày điển hình' })) : null) : null,
    cols.length ? h('section', {}, h('h3', {}, a ? 'So sánh A/B' : 'Kết quả hệ thống'),
      h('p', { id: 'rp-ab-scope' }, `Cùng thời tiết "${f.weather?.name ?? '?'}", cùng SoC đầu và chính sách. ${a ? 'A và B giữ thiết kế và lịch tải riêng.' : ''} Chỉ kết luận cho dữ liệu đã chọn.`),
      dtab(['Chỉ số', ...cols.map((r) => r.title)], abRows.map(([lab, fn]) => [lab, ...cols.map((r) => fn(r))]), 'rp-ab'),
      f.energyNote ? h('p', { id: 'rp-energy-note' }, f.energyNote) : null, costText ? h('p', { id: 'rp-cost-delta' }, costText) : null,
      f.socByHour.length ? h('div', { id: 'rp-chart-soc' }, lineChart(Array.from({ length: 24 }, (_, i) => i), f.socByHour.map((s, k) => ({ name: s.title, values: s.avgPct, dash: k ? '6 4' : '', color: k ? '#c0392b' : '#2874a6' })), { yLabel: 'SoC trung bình (%)', xLabel: 'Giờ địa phương', label: 'SoC trung bình theo giờ' })) : null) : null,
    h('section', {}, h('h3', {}, 'Dữ liệu đính kèm'), dtab(['Dữ liệu', 'Trạng thái'], f.attached.map((x) => [x.label, x.state]), 'rp-attached')),
    h('footer', {}, h('p', {}, 'Mekoniq Solar Lab. Báo cáo ước tính; các thông số thi công do người lắp xác nhận.')));
}

export async function renderReport(ctx: ReportCtx): Promise<Node[]> {
  const p = ctx.project, st = ctx.state, tz = p.location?.timezone ?? 'Asia/Ho_Chi_Minh';
  if (st.forRevision !== null && st.forRevision !== p.revision) { Object.assign(st, { pv: null, runs: [], forRevision: null, message: 'Thiết kế đã đổi sau lần tính trước nên kết quả cũ đã bị bỏ khỏi báo cáo; tính lại.' }); }
  const weather = p.pv?.weatherId ? await ctx.loadWeather(p.pv.weatherId) : undefined;
  const msg = h('div', { id: 'rp-messages', role: 'alert' }, st.message ? h('p', {}, st.message) : null);
  const say = (l: string[]) => msg.replaceChildren(...l.map((x) => h('p', {}, x)));
  const bundled = !!weather && BUNDLED_WEATHER.some((x) => x.id === weather.seriesId);

  // ---- computing results ------------------------------------------------------------------------------------------------
  const prog = h('progress', { id: 'rp-progress', max: 100, value: 0, hidden: true, 'aria-label': 'Tiến độ' }), cancel = h('button', { id: 'rp-cancel', hidden: true }, 'Hủy');
  const jobs: Job<unknown>[] = [];
  cancel.onclick = () => jobs.forEach((j) => j.cancel());
  const revs = ctx.revisions.filter((r) => r.revision !== p.revision);
  const selA = h('select', { id: 'rp-a', 'aria-label': 'Phương án A để so sánh' }, h('option', { value: '' }, 'Không so sánh'), ...revs.map((r) => h('option', { value: String(r.revision) }, `A = revision ${r.revision} · ${r.savedAt.slice(0, 19).replace('T', ' ')}`)));
  if (st.aRevision && !revs.some((r) => String(r.revision) === st.aRevision)) st.aRevision = '';
  selA.value = st.aRevision;
  selA.addEventListener('change', () => { st.aRevision = selA.value; });
  const compute = h('button', { id: 'rp-compute' }, 'Tính kết quả cho báo cáo');
  compute.addEventListener('click', async () => {
    if (!weather) return say(['Chọn dữ liệu thời tiết trước (Thời tiết và PV).']);
    say([]); compute.disabled = true; prog.hidden = false; cancel.hidden = false; prog.value = 0;
    const fail = (l: string[]) => { say(l); compute.disabled = false; prog.hidden = true; cancel.hidden = true; };
    try {
      const sf = await shadeFor(p, weather);
      if (sf.issues.length) return fail(sf.issues.map((i) => `${i.code}: ${i.message}`));
      const pc = compilePv(p, weather, { shade: sf.field });
      if (!pc.input) return fail(pc.issues.map((i) => `${i.code} tại ${i.field}: ${i.message}`));
      const wh = await hashOf(weather), phash = await hashPvInput(pc.input);
      const sides: { label: 'A' | 'B'; title: string; base: Project; isRev: boolean }[] = [];
      if (selA.value) { const a = await ctx.loadRevision(Number(selA.value)); if (!a) return fail(['Không đọc được revision A']); sides.push({ label: 'A', title: `A · revision ${selA.value}`, base: a, isRev: true }); }
      sides.push({ label: 'B', title: `B · hiện tại (revision ${p.revision})`, base: p, isRev: false });
      const prepared: (typeof sides[number] & { input: NonNullable<Awaited<ReturnType<typeof compileSim>>['input']>; hash: string })[] = [];
      for (const s of sides) {
        const run = asRunFor(s.base, p), f2 = s.isRev ? await shadeFor(run, weather) : sf;
        if (f2.issues.length) return fail([`${s.title}: ${f2.issues.map((i) => i.message).join('; ')}`]);
        const c = await compileSim(run, weather, { shade: f2.field });
        if (!c.input || !c.hash) return fail([`${s.title}: không chạy được`, ...c.issues.map((i) => `${i.code} tại ${i.field}: ${i.message}`)]);
        prepared.push({ ...s, input: c.input, hash: c.hash });
      }
      const total = 1 + prepared.length, done = new Array<number>(total).fill(0), tick = () => { prog.value = Math.round((done.reduce((x, y) => x + y, 0) / total) * 100); };
      const pj = runPvInWorker(pc.input, phash, (d, t) => { done[0] = d / t; tick(); }); jobs.push(pj);
      const sj = prepared.map((s, k) => { const j = runSimInWorker(s.input, s.hash, (d, t) => { done[k + 1] = d / t; tick(); }); jobs.push(j); return j; });
      const [po, ...so] = await Promise.all([pj.promise, ...sj.map((j) => j.promise)]);
      jobs.length = 0;
      if (po.status !== 'result' || so.some((o) => o.status !== 'result')) {
        const bad = [po, ...so].find((o) => o.status !== 'result')!;
        return fail([bad.status === 'cancelled' ? 'Đã hủy; không có kết quả nào được đưa vào báo cáo.' : `Không chạy được: ${bad.status === 'failure' ? bad.issues.map((i) => i.message).join('; ') : ''}`]);
      }
      st.pv = po.result; st.weatherHash = wh; st.forRevision = p.revision; st.message = 'Đã tính xong; kết quả bên dưới gắn với revision hiện tại.';
      st.runs = so.map((o, k) => ({ label: prepared[k].label, title: prepared[k].title, result: (o as { result: ReportRun['result'] }).result, projectName: prepared[k].base.name, hash: prepared[k].hash, ...(prepared[k].isRev ? { base: prepared[k].base } : {}) }));
    } catch (e) { return fail([`Lỗi: ${(e as Error).message}`]); }
    ctx.rerender();
  });

  // ---- facts + page --------------------------------------------------------------------------------------------------------
  const costCmp = st.runs.length === 2 ? compareQuotes(buildQuote(st.runs[0].base ?? p), buildQuote(p)) : null;
  const generatedAt = nowIso();
  const facts = reportFacts({ project: p, weather: weather ?? null, weatherAttached: false, pv: st.pv, runs: st.runs, cost: costCmp, generatedAt, includeContact: st.includeContact, engines: CURRENT_ENGINES, buildId: ctx.buildId });
  const page = buildReportPage({ ...facts, attached: facts.attached.map((x) => (x.label === 'Dữ liệu thời tiết' && weather ? { ...x, state: 'đính kèm trong gói "đầy đủ"; gói "báo cáo" chỉ tham chiếu' } : x)) });

  // ---- owner + options -------------------------------------------------------------------------------------------------
  const owner = p.owner ?? {};
  // limits come from the schema: a contact the form accepts can always be exported and imported again
  const fld = (id: string, label: string, key: keyof typeof OWNER_FIELDS, v?: string) => h('label', {}, `${label} `, h('input', { id, value: v ?? '', maxLength: OWNER_FIELDS[key].maxLength }));
  const ownerForm = h('form', { id: 'rp-owner-form', 'aria-label': 'Thông tin liên hệ' }, fld('rp-o-name', 'Tên khách', 'name', owner.name), fld('rp-o-phone', 'Điện thoại', 'phone', owner.phone), fld('rp-o-email', 'E-mail', 'email', owner.email), fld('rp-o-addr', 'Địa chỉ', 'address', owner.address),
    h('button', { type: 'submit', id: 'rp-o-save' }, 'Lưu liên hệ'));
  ownerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
    const o = { name: v('rp-o-name'), phone: v('rp-o-phone'), email: v('rp-o-email'), address: v('rp-o-addr') };
    const next = structuredClone(p);
    const kept = Object.fromEntries(Object.entries(o).filter(([, x]) => x));
    if (Object.keys(kept).length) next.owner = kept; else delete next.owner;
    void ctx.apply(next);
  });
  const incContact = h('input', { type: 'checkbox', id: 'rp-contact', checked: st.includeContact });
  incContact.addEventListener('change', () => { st.includeContact = incContact.checked; ctx.rerender(); });
  const incSeries = h('input', { type: 'checkbox', id: 'rp-series', checked: st.includeSeries });
  incSeries.addEventListener('change', () => { st.includeSeries = incSeries.checked; });

  const incWiring = h('input', { type: 'checkbox', id: 'rp-wiring', checked: st.includeWiring });
  incWiring.addEventListener('change', () => { st.includeWiring = incWiring.checked; ctx.rerender(); });
  const wiringPage = st.includeWiring ? h('section', { className: 'report-page', id: 'rp-wiring-page', 'aria-label': 'Bảng đấu nối' },
    h('h2', {}, `Bảng đấu nối: ${p.name}`),
    dtab(['Từ', 'Đến', 'Ghi chú'], wiringTable(p).map((r) => [r.from, r.to, r.detail]), 'rp-wiring-table'), h('p', { id: 'rp-wiring-note' }, WIRING_NOTE)) : null;

  // ---- exports ---------------------------------------------------------------------------------------------------------
  const fileBase = p.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'du-an';
  const records = (): { runs: RecordedRun[]; variants: Record<string, Project> } => {
    const runs: RecordedRun[] = [], variants: Record<string, Project> = {}, wh = st.weatherHash ?? '';
    if (st.pv) runs.push(recordPv(st.pv, { label: 'B', title: 'PV · hiện tại', source: 'current', weatherHash: wh, series: st.includeSeries }));
    for (const r of st.runs) {
      const v = r.base !== undefined;
      if (v) variants[r.label] = r.base!;
      runs.push(recordSim(r.result, { label: r.label, title: r.title, source: v ? 'variant' : 'current', weatherHash: wh, series: st.includeSeries }));
    }
    return { runs, variants };
  };
  const pack = (kind: 'full' | 'report') => async () => {
    const { runs, variants } = records();
    const text = await buildPackage({ kind, project: p, runs, weather, weatherBundled: bundled, variants, includeContact: st.includeContact, includeSeries: st.includeSeries, app: { buildId: ctx.buildId, engines: CURRENT_ENGINES } });
    download(`${fileBase}.${kind === 'full' ? 'goi-day-du' : 'goi-bao-cao'}.json`, text);
    say([`Đã xuất gói ${kind === 'full' ? 'đầy đủ (chạy lại được)' : 'báo cáo (không kèm số liệu thời tiết)'}; ${st.includeContact ? 'có' : 'đã bỏ'} thông tin liên hệ.`]);
  };
  const sim = st.runs.find((r) => r.label === 'B') ?? st.runs[0];
  const csvBtn = (id: string, text: string, enabled: boolean, f: () => void) => h('button', { id, disabled: !enabled, onClick: f }, text);
  return [
    h('h2', {}, `Báo cáo và chia sẻ · ${p.name}`), h('button', { onClick: () => ctx.go('pv') }, 'Thời tiết và PV'), msg,
    h('h3', {}, '1. Thông tin liên hệ (không dùng trong tính toán)'), ownerForm,
    h('label', {}, incContact, ' Đưa thông tin liên hệ vào báo cáo và gói xuất (mặc định bỏ khi chia sẻ)'),
    h('h3', {}, '2. Kết quả đưa vào báo cáo'), h('div', {}, compute, ' ', h('label', {}, selA), cancel, prog),
    h('p', {}, weather ? `Thời tiết: ${weather.name}. A/B dùng cùng thời tiết và SoC đầu.` : 'Chưa chọn dữ liệu thời tiết.'),
    h('h3', {}, '3. Xuất'),
    h('div', {}, h('button', { id: 'rp-print', onClick: () => window.print() }, 'In / lưu PDF (A4)'),
      csvBtn('rp-csv-bom', 'CSV dự toán (BOM)', true, () => download(`${fileBase}-du-toan.csv`, quoteToCsv(buildQuote(p), p.name), 'text/csv;charset=utf-8')),
      csvBtn('rp-csv-pv', 'CSV PV theo giờ', !!st.pv && !!weather, () => download(`${fileBase}-pv.csv`, pvResultToCsv(st.pv!, { weatherName: weather!.name, source: weather!.source.name, timeZone: tz }), 'text/csv;charset=utf-8')),
      csvBtn('rp-csv-sim', 'CSV hệ thống theo giờ', !!sim && !!weather, () => download(`${fileBase}-he-thong.csv`, simResultToCsv(sim!.result, { projectName: p.name, weatherName: weather!.name, timeZone: tz, label: sim!.title }), 'text/csv;charset=utf-8'))),
    h('label', { 'data-min-depth': 'tho' }, incWiring, ' Thêm trang bảng đấu nối cho thợ vào báo cáo'),
    h('div', {}, h('label', {}, incSeries, ' Kèm chuỗi theo bước của kết quả đã chọn (gói đầy đủ)'), ' ',
      h('button', { id: 'rp-pack-full', onClick: () => void pack('full')() }, 'Xuất gói đầy đủ (chạy lại được)'), h('button', { id: 'rp-pack-report', onClick: () => void pack('report')() }, 'Xuất gói báo cáo (nhẹ, không kèm số liệu thời tiết)')),
    h('h3', {}, '4. Xem trước báo cáo A4'), page, ...(wiringPage ? [wiringPage] : []),
  ];
}
