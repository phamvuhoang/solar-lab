import { BUILTIN_COMPONENTS, BUILTIN_OFFERS, findComponent, offersFor } from '../catalog/catalog';
import { addString } from '../domain/graph';
import { demoGableRoof, fillFace, addObstacle, moveObstacle } from '../domain/layout-edit';
import { buildLamHaConfig } from '../domain/presets';
import { addInstances, createProject, openLamHa } from '../domain/project';
import type { Component, Project } from '../domain/types';
import { compilePv } from '../engine/compile';
import { simulatePv } from '../engine/pv';
import { compileSim } from '../engine/sim-compile';
import { simulateSystem } from '../engine/system';
import { buildShadeSpec, computeShade } from '../shade/sampler';
import { validateDesign } from '../validation/strings';
import { loadBundledWeather } from '../weather/bundled';
import type { WeatherSeries } from '../weather/series';
import { localHour } from '../weather/series';
import { termsFor, type Term } from './glossary';

export type Mode = 'basic' | 'engineer';
export type LessonId = 'series-parallel' | 'pump-hour' | 'tank-shade';
export interface Reading { label: string; value: string; note?: string }
export interface Table { head: string[]; rows: string[][] }
/** What the real engines say about the lesson's project in one state. Every number is also in a table, never only in a picture. */
export interface Measure {
  headline: number; headlineLabel: string; readings: Reading[]; table: Table | null;
  series: { xs: number[]; name: string; values: number[]; yLabel: string; xLabel: string } | null;
  facts: Record<string, number>; engineer: string[];
}
export interface Question { text: string; kind: 'number' | 'choice'; unit?: string; options?: { id: string; label: string }[] }
export interface Verdict { correct: boolean; truth: string }
export interface Lesson {
  id: LessonId; title: string; goal: string; terms: string[];
  /** A fresh private copy every call: lessons never touch a saved project. */
  fixture(): Promise<Project>;
  question: Question; actionLabel: string; apply(p: Project): Project;
  measure(p: Project): Promise<Measure>;
  check(answer: string, before: Measure, after: Measure): Verdict;
  explain(before: Measure, after: Measure, mode: Mode): string[];
}

const comp = (id: string): Component => structuredClone(findComponent(BUILTIN_COMPONENTS, { modelId: id, revision: 1 })!);
const offers = (c: Component) => offersFor(BUILTIN_OFFERS, c);
const f1 = (x: number) => x.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const f2 = (x: number) => x.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const pct = (x: number) => `${(x * 100).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}%`;
export const BUNDLED_ID = 'lam-ha-2023-pvgis-era5';
let weatherCache: Promise<WeatherSeries> | null = null;
export const lessonWeather = () => (weatherCache ??= loadBundledWeather(BUNDLED_ID).then((r) => { if (!r?.ok) throw new Error('Không nạp được dữ liệu thời tiết đóng gói'); return r.series; }));
function slice(w: WeatherSeries, i0: number, n: number): WeatherSeries {
  const s = <T,>(a: T[] | null) => (a ? a.slice(i0, i0 + n) : null);
  return { ...w, t0: w.t0 + i0 * w.stepSeconds, n, ghi: s(w.ghi), dni: s(w.dni), dhi: s(w.dhi), poa: s(w.poa), tempAirC: s(w.tempAirC), windMs: s(w.windMs) };
}
const indexAt = (w: WeatherSeries, utcMs: number) => Math.round((utcMs / 1000 - w.t0) / w.stepSeconds);
const num = (answer: string) => Number(answer.replace(',', '.'));

// ---- Lesson 1: two panels in series, then in parallel ------------------------------------------------------------------
async function seriesParallelFixture(): Promise<Project> {
  let p = addInstances(createProject('Bài 1 · Ghép hai tấm'), comp('vsun-620'), 2, offers(comp('vsun-620')));
  const panels = p.instances.map((i) => i.instanceId);
  p = addInstances(p, comp('luxpower-sna6000wpv'), 1);
  const inv = p.instances[p.instances.length - 1].instanceId;
  p = { ...p, design: { coldCellTempC: 5, hotCellTempC: 70 }, location: { latitude: 11.87, longitude: 108.2, timezone: 'Asia/Ho_Chi_Minh' } };
  return addString(p, { label: 'Chuỗi 1', panelIds: panels, target: { instanceId: inv, port: 'M1' } });
}
function toParallel(p: Project): Project {
  const inv = p.strings![0].target!;
  const [a, b] = p.strings![0].panelIds;
  let q: Project = { ...structuredClone(p), strings: [] };
  q = addString(q, { label: 'Chuỗi 1', panelIds: [a], target: inv });
  return addString(q, { label: 'Chuỗi 2', panelIds: [b], target: inv });
}
async function measureSeriesParallel(p: Project): Promise<Measure> {
  const panel = p.snapshots.components.find((c) => c.kind === 'panel')!;
  const v = (k: string) => panel.specs[k].v!;
  const nSeries = p.strings![0].panelIds.length, nPar = p.strings!.length;
  const vmp = v('vmpV') * nSeries, imp = v('impA') * nPar, voc = v('vocV') * nSeries, isc = v('iscA') * nPar;
  const findings = validateDesign(p).filter((f) => f.status !== 'unknown' && f.value !== null && f.limit !== null && ['VOC_COLD_ABS', 'VMP_HOT_MIN', 'VMP_COLD_MAX', 'IMP_TRACKER', 'ISC_TRACKER', 'START_VOLTAGE'].includes(f.code));
  const checks = validateDesign(p).filter((f) => f.stringId !== undefined || f.port !== undefined);
  return {
    headline: vmp, headlineLabel: 'Điện áp tại điểm công suất cực đại (V)',
    readings: [
      { label: 'Cách nối', value: nPar === 1 ? `nối tiếp (${nSeries} tấm trong 1 chuỗi)` : `song song (${nPar} chuỗi, mỗi chuỗi ${nSeries} tấm)` },
      { label: 'Điện áp làm việc Vmp', value: `${f2(vmp)} V`, note: `${nSeries} × ${f2(v('vmpV'))} V` },
      { label: 'Dòng làm việc Imp', value: `${f2(imp)} A`, note: `${nPar} × ${f2(v('impA'))} A` },
      { label: 'Công suất Vmp × Imp', value: `${f1(vmp * imp)} W`, note: 'không đổi giữa hai cách nối' },
      { label: 'Điện áp hở mạch Voc (25 °C)', value: `${f2(voc)} V` },
      { label: 'Dòng ngắn mạch Isc', value: `${f2(isc)} A` },
    ],
    table: { head: ['Kiểm tra', 'Kết quả', 'Giá trị', 'Giới hạn'], rows: (findings.length ? findings : checks.slice(0, 6)).map((f) => [f.message.slice(0, 70), f.status === 'pass' ? 'đạt' : f.status === 'fail' ? 'KHÔNG đạt' : f.status === 'limited' ? 'sát giới hạn' : 'chưa kiểm được', f.value === null ? '—' : `${f2(f.value)} ${f.unit}`, f.limit === null ? '—' : `${f2(f.limit)} ${f.unit}`]) },
    series: null, facts: { vmp, imp, voc, isc, power: vmp * imp },
    engineer: [`Vmp, Imp, Voc, Isc lấy từ datasheet ${panel.name} (nguồn: ${panel.specs.vmpV.p}).`, `Các kiểm tra do validateDesign chạy với nhiệt độ cell lạnh 5 °C, nóng 70 °C (giả định của bài).`, 'Hai chuỗi song song trên cùng cổng MPPT phải giống nhau (cùng số tấm, cùng model), nếu không có cảnh báo PARALLEL_STRINGS_MISMATCH.'],
  };
}

// ---- Lesson 2: pump at 18h → 11h ----------------------------------------------------------------------------------------
/** 72 hours from 12h on 18/12/2023 Vietnam time (= 05h UTC). It starts at noon so the first night already follows a pump run in both variants. */
const PUMP_WINDOW = { start: Date.UTC(2023, 11, 18, 5), days: 3 };
async function pumpFixture(): Promise<Project> {
  const base = buildLamHaConfig(openLamHa(), 'shared8', { inverter: comp('luxpower-sna6000wpv'), battery: comp('used-battery'), home: comp('sample-home-load'), pump: comp('sample-pump-load'), controller: comp('sample-pump-controller') }, offers);
  return { ...base, name: 'Bài 2 · Giờ bơm', pv: { tiltDeg: 10, azimuthDeg: 180, weatherId: BUNDLED_ID }, sim: { soc0: 0.5 } } as Project;
}
const pumpAt = (hour: number) => (p: Project): Project => ({ ...structuredClone(p), loadPlans: p.loadPlans!.map((l) => (l.pump ? { ...l, fractions: l.fractions.map((_, k) => (k === hour ? 1 : 0)) } : l)) });
async function measurePump(p: Project): Promise<Measure> {
  const w = await lessonWeather(), n = PUMP_WINDOW.days * 24, win = slice(w, indexAt(w, PUMP_WINDOW.start), n);
  const c = await compileSim(p, win);
  if (!c.input || !c.hash) throw new Error(c.issues.map((i) => `${i.code}: ${i.message}`).join('; '));
  const o = await simulateSystem(c.input, c.hash);
  if (!o || !o.ok) throw new Error('Không chạy được mô phỏng hệ thống');
  const d = o.result.dispatch, s = d.series, hour = p.loadPlans!.find((l) => l.pump)!.fractions.findIndex((x) => x > 0);
  const soc = Array.from(s.socEnd, (x) => x * 100), min = d.metrics.minSoc! * 100;
  const rows: string[][] = [];
  for (let i = 0; i < n; i += 3) rows.push([`ngày ${Math.floor((i + 12) / 24) + 1}, ${String(localHour(s.t[i] + d.period.stepSeconds / 2, 'Asia/Ho_Chi_Minh')).padStart(2, '0')}h`, `${f1(soc[i])} %`]);
  return {
    headline: min, headlineLabel: 'Mức pin thấp nhất trong 72 giờ (%)',
    readings: [
      { label: 'Giờ bơm', value: `${hour}h mỗi ngày (750 W, 1 giờ)` },
      { label: 'Mức pin (SoC) thấp nhất', value: `${f1(min)} %` },
      { label: 'Điện pin phải xả', value: `${f1(d.totals.dischargeBusWh / 1000)} kWh`, note: 'cộng 72 giờ, tại bus DC' },
      { label: 'Điện thiếu (tải không được cấp)', value: `${f1(d.totals.unservedWh / 1000)} kWh` },
      { label: 'SoC cuối', value: `${f1(d.metrics.socEnd! * 100)} %` },
    ],
    table: { head: ['Thời điểm', 'SoC cuối bước'], rows }, series: { xs: Array.from({ length: n }, (_, i) => i), name: `Bơm lúc ${hour}h`, values: soc, yLabel: 'SoC (%)', xLabel: 'Giờ kể từ 12h ngày 18/12/2023 (giờ Việt Nam)' },
    facts: { minSoc: min, dischargeWh: d.totals.dischargeBusWh, unservedWh: d.totals.unservedWh, socEnd: d.metrics.socEnd! * 100 },
    engineer: [`mã đầu vào ${c.hash.slice(0, 12)} · pv ${o.result.pv.engineVersion} · ${d.version}`, `Sổ năng lượng: sai số lớn nhất ${d.ledger.maxResidualWh.toExponential(1)} Wh/bước.`, ...d.assumptions.slice(0, 4)],
  };
}

// ---- Lesson 3: tank shade --------------------------------------------------------------------------------------------------
async function tankFixture(): Promise<Project> {
  let p = await pumpFixture();
  p = { ...p, name: 'Bài 3 · Bóng bồn nước', pv: { tiltDeg: 10, azimuthDeg: 180, weatherId: BUNDLED_ID } };
  p = demoGableRoof(p);
  p = fillFace(p, p.roofFaces[0].roofFaceId, p.instances.filter((i) => i.kind === 'panel').map((i) => i.instanceId)).project;
  return addObstacle(p, { label: 'Bồn nước', kind: 'cylinder', roofFaceId: null, center: { e: 11, n: -1 }, baseUp: 3, angleDeg: 0, size: { x: 1.3, y: 1.3, z: 2.5 } });
}
const moveTank = (p: Project): Project => moveObstacle(p, p.obstacles!.find((o) => o.label === 'Bồn nước')!.obstacleId, 5, 0);
const MORNING = [7, 8, 9, 10, 11];
async function measureTank(p: Project): Promise<Measure> {
  const w = await lessonWeather(), win = slice(w, indexAt(w, Date.UTC(2023, 11, 21, 0)), MORNING.length); // 00h UTC = 07h Việt Nam
  const spec = await buildShadeSpec(p, win, { mode: 'standard', grid: 4 });
  const r = await computeShade(spec, null);
  if (!r) throw new Error('Tính bóng bị hủy');
  const f = r.field;
  const free = compilePv(p, win), sum = compilePv(p, win, { shade: f }), low = compilePv(p, win, { shade: f, stringMode: 'weakest' });
  if (!free.input || !sum.input || !low.input) throw new Error([...free.issues, ...sum.issues].map((i) => `${i.code}: ${i.message}`).join('; '));
  const [a, b, c] = await Promise.all([simulatePv(free.input, 'l3a'), simulatePv(sum.input, 'l3b'), simulatePv(low.input, 'l3c')]);
  if (!a || !b || !c) throw new Error('Không chạy được PV');
  const label = new Map(p.instances.map((i) => [i.instanceId, i.label])), strOf = new Map((p.strings ?? []).flatMap((s, k) => s.panelIds.map((id) => [id, k + 1] as [string, number])));
  const shaded8 = f.panelIds.filter((_, k) => f.access[k][1] < 0.9);
  const eFree = a.totals.eIdealWh, eUp = b.totals.eIdealWh, eLow = c.totals.eIdealWh;
  return {
    headline: shaded8.length, headlineLabel: 'Số tấm bị che lúc 8h (thấy nắng trực tiếp dưới 90%)',
    readings: [
      { label: 'Tấm bị che lúc 8h', value: shaded8.length ? shaded8.map((id) => `${label.get(id)} (chuỗi ${strOf.get(id) ?? '—'})`).join(', ') : 'không có' },
      { label: 'Chuỗi liên quan', value: [...new Set(shaded8.map((id) => strOf.get(id)))].filter(Boolean).map((x) => `chuỗi ${x}`).join(', ') || '—' },
      { label: 'Sản lượng 7–12h, không bóng', value: `${f1(eFree)} Wh`, note: 'bước lý tưởng, trước tổn hao' },
      { label: 'Có bóng, cận trên (cộng tấm)', value: `${f1(eUp)} Wh`, note: `mất ${f1(eFree - eUp)} Wh` },
      { label: 'Có bóng, cận dưới (tấm yếu nhất)', value: `${f1(eLow)} Wh`, note: `mất ${f1(eFree - eLow)} Wh` },
    ],
    table: { head: ['Tấm', 'Chuỗi', ...MORNING.map((h) => `${h}h`)], rows: f.panelIds.map((id, k) => [label.get(id) ?? id, String(strOf.get(id) ?? '—'), ...MORNING.map((_, i) => pct(f.access[k][i]))]) },
    series: null, facts: { shaded8: shaded8.length, eFree, eUp, eLow, lossUp: eFree - eUp, lossLow: eFree - eLow },
    engineer: [`mô hình bóng ${f.modelVersion}, lưới ${f.grid}×${f.grid} (${f.samplesPerPanel} mẫu/tấm), key ${f.key.slice(0, 12)}`, `Ngày 21/12/2023, ${MORNING[0]}–${MORNING[MORNING.length - 1] + 1}h giờ Việt Nam, dữ liệu ${w.name}.`, 'Chỉ trực xạ bị giảm; khuếch tán và phản xạ đất giữ nguyên. Bypass diode chưa được giải nên kết quả là hai cận.'],
  };
}

export const LESSONS: Lesson[] = [
  {
    id: 'series-parallel', title: '1 · Ghép hai tấm: nối tiếp hay song song', terms: ['series-parallel', 'mppt', 'kw-kwh'],
    goal: 'Dự đoán điện áp và dòng của hai tấm 620 W khi nối tiếp, rồi đổi sang song song và đọc "đồng hồ" từ thông số thật.',
    fixture: seriesParallelFixture,
    question: { text: 'Hai tấm VSUN 620 W nối tiếp thành một chuỗi. Điện áp làm việc (Vmp) của chuỗi là bao nhiêu volt? (Gợi ý: một tấm khoảng 41 V.)', kind: 'number', unit: 'V' },
    actionLabel: 'Đổi sang nối song song', apply: toParallel, measure: measureSeriesParallel,
    check: (a, b) => { const x = num(a); return { correct: Number.isFinite(x) && Math.abs(x - b.facts.vmp) / b.facts.vmp <= 0.05, truth: `${f2(b.facts.vmp)} V` }; },
    explain: (b, a, mode) => [
      `Nối tiếp: điện áp cộng lại (${f2(b.facts.vmp)} V), dòng giữ nguyên (${f2(b.facts.imp)} A). Song song: điện áp giữ nguyên (${f2(a.facts.vmp)} V), dòng cộng lại (${f2(a.facts.imp)} A).`,
      `Công suất gần như không đổi (${f1(b.facts.power)} W so với ${f1(a.facts.power)} W): đổi cách nối chỉ đổi "điện áp cao dòng thấp" thành "điện áp thấp dòng cao".`,
      'Vì vậy inverter chỉ chạy tốt với cách nối cho điện áp nằm trong dải MPPT của nó; kiểm tra bên dưới cho thấy cách nối nào còn trong giới hạn.',
      ...(mode === 'engineer' ? ['Vmp chuỗi = n × Vmp tấm; Imp = m × Imp tấm (m chuỗi song song, giống nhau). Khi nhiệt độ cell đổi, Vmp đổi theo βVmp, nên dải MPPT được kiểm ở cả nóng và lạnh.'] : []),
    ],
  },
  {
    id: 'pump-hour', title: '2 · Dời giờ bơm từ 18h về 11h', terms: ['soc', 'bms', 'kw-kwh'],
    goal: 'Dự đoán mức pin thấp nhất khi bơm 750 W chạy buổi trưa thay vì buổi tối, với cùng thời tiết và cùng tải nhà.',
    fixture: async () => pumpAt(18)(await pumpFixture()),
    question: { text: 'Bơm đang chạy lúc 18h (pin phải gánh). Nếu dời sang 11h (lúc nắng mạnh), mức pin thấp nhất trong 72 giờ sẽ:', kind: 'choice', options: [{ id: 'lower', label: 'Thấp hơn' }, { id: 'same', label: 'Gần như không đổi (lệch dưới 1 điểm %)' }, { id: 'higher', label: 'Cao hơn' }] },
    actionLabel: 'Dời bơm về 11h', apply: pumpAt(11), measure: measurePump,
    check: (a, b, c) => { const d = c.facts.minSoc - b.facts.minSoc, truth = Math.abs(d) < 1 ? 'same' : d > 0 ? 'higher' : 'lower'; return { correct: a === truth, truth: `${truth === 'same' ? 'gần như không đổi' : truth === 'higher' ? 'cao hơn' : 'thấp hơn'} (${f1(b.facts.minSoc)} % → ${f1(c.facts.minSoc)} %)` }; },
    explain: (b, a, mode) => [
      `Bơm lúc 18h lấy điện từ pin (mặt trời đã tắt); bơm lúc 11h được PV cấp thẳng. Pin phải xả ${f1(b.facts.dischargeWh / 1000)} kWh so với ${f1(a.facts.dischargeWh / 1000)} kWh, nên mức pin thấp nhất lên từ ${f1(b.facts.minSoc)} % tới ${f1(a.facts.minSoc)} %.`,
      'Kết luận này chỉ đúng cho 72 giờ từ 12h ngày 18/12/2023 ở Lâm Hà, SoC đầu 50 % và lịch tải đã nêu. Không suy ra cho mùa khác.',
      ...(mode === 'engineer' ? ['Dispatch cấp tải theo thứ tự ưu tiên: PV tới tải trước, phần thiếu lấy từ pin tới mức dự phòng; mỗi bước ghi mã lý do (PV_TO_LOAD, BATTERY_DISCHARGE…). Hiệu suất inverter lấy từ datasheet, đây là giá trị đỉnh.'] : []),
    ],
  },
  {
    id: 'tank-shade', title: '3 · Dịch bồn nước khỏi bóng che', terms: ['shade', 'series-parallel', 'kw-kwh'],
    goal: 'Xem tấm nào bị bồn nước che vào buổi sáng, chuỗi nào liên quan, rồi dịch bồn 5 m và xem sản lượng cùng buổi sáng thay đổi bao nhiêu.',
    fixture: tankFixture,
    question: { text: 'Lúc 8h sáng 21/12, có bao nhiêu tấm (trong 8 tấm) bị bồn nước che, tức thấy nắng trực tiếp dưới 90 %?', kind: 'number', unit: 'tấm' },
    actionLabel: 'Dịch bồn nước 5 m về phía Đông', apply: moveTank, measure: measureTank,
    check: (a, b) => ({ correct: num(a) === b.facts.shaded8, truth: `${b.facts.shaded8} tấm` }),
    explain: (b, a, mode) => [
      `Trước khi dịch: ${b.facts.shaded8} tấm bị che lúc 8h; cả buổi sáng 7–12h sản lượng mất ${f1(b.facts.lossUp)}–${f1(b.facts.lossLow)} Wh (cận trên – cận dưới). Sau khi dịch: ${a.facts.shaded8} tấm bị che, mất ${f1(a.facts.lossUp)}–${f1(a.facts.lossLow)} Wh.`,
      'Cận dưới lớn hơn vì một tấm bị che có thể kéo cả chuỗi xuống; cận trên giả định mỗi tấm tự phát hết khả năng. Thực tế nằm giữa, tùy diode bypass trong tấm.',
      ...(mode === 'engineer' ? ['Bóng tính bằng tia CPU từ 16 điểm mẫu mỗi tấm tới Mặt Trời; chỉ trực xạ bị giảm. Hình 3D chỉ để xem, số liệu không đọc từ ảnh.'] : []),
    ],
  },
];

export const termsOf = (l: Lesson): Term[] => termsFor(l.terms);
export const lessonById = (id: string) => LESSONS.find((l) => l.id === id);
