import { beforeAll, describe, expect, test } from 'vitest';
import { BUILTIN_OFFERS, offersFor } from '../../src/catalog/catalog';
import { buildQuote } from '../../src/cost/quote';
import { hashOf } from '../../src/domain/hash';
import { buildLamHaConfig } from '../../src/domain/presets';
import { openLamHa } from '../../src/domain/project';
import type { Project } from '../../src/domain/types';
import { simulatePv } from '../../src/engine/pv';
import { compilePv, hashPvInput } from '../../src/engine/compile';
import { compileSim } from '../../src/engine/sim-compile';
import { simulateSystem, type SimResult } from '../../src/engine/system';
import { buildPackage, recordPv, recordSim, redact, stagePackage, stripContact, type PackageDoc, type RecordedRun } from '../../src/reports/package';
import { compareMetrics, CURRENT_ENGINES, replayRun, type Runner } from '../../src/reports/replay';
import { loadBundledWeather } from '../../src/weather/bundled';
import type { WeatherSeries } from '../../src/weather/series';
import { catalog } from './helpers';

const parts = () => ({ inverter: catalog('luxpower-sna6000wpv'), battery: catalog('used-battery'), home: catalog('sample-home-load'), pump: catalog('sample-pump-load'), controller: catalog('sample-pump-controller') });
const offers = (c: ReturnType<typeof catalog>) => offersFor(BUILTIN_OFFERS, c);
const APP = { buildId: 'test', engines: CURRENT_ENGINES };
const direct: Runner = {
  pv: (i, h) => simulatePv(i, h),
  sim: async (i, h) => { const o = await simulateSystem(i, h); return o && o.ok ? o.result : null; },
};

let project: Project, weather: WeatherSeries, wHash: string, sim: SimResult, simHash: string, pvRun: RecordedRun, simRun: RecordedRun;
beforeAll(async () => {
  const w = await loadBundledWeather('lam-ha-2023-pvgis-era5');
  if (!w?.ok) throw new Error('weather');
  weather = w.series; wHash = await hashOf(weather);
  project = { ...buildLamHaConfig(openLamHa(), 'shared8', parts(), offers), pv: { tiltDeg: 10, azimuthDeg: 180, weatherId: weather.seriesId } } as Project;
  project.owner = { name: 'Anh Hùng', phone: '0909 123 456', email: 'hung@example.vn', address: 'Lâm Hà' };
  const c = await compileSim(project, weather);
  if (!c.input) throw new Error(JSON.stringify(c.issues));
  const out = await simulateSystem(c.input, c.hash!);
  if (!out || !out.ok) throw new Error('sim');
  sim = out.result; simHash = c.hash!;
  simRun = recordSim(sim, { label: 'B', title: 'Hiện tại', source: 'current', weatherHash: wHash, series: true });
  const pc = compilePv(project, weather);
  const pr = (await simulatePv(pc.input!, await hashPvInput(pc.input!)))!;
  pvRun = recordPv(pr, { label: 'B', title: 'PV', source: 'current', weatherHash: wHash, series: false });
}, 120000);

const build = (o: Partial<Parameters<typeof buildPackage>[0]> = {}) => buildPackage({ kind: 'full', project, runs: [simRun, pvRun], weather, includeContact: true, includeSeries: true, app: APP, ...o });

describe('gói portable', () => {
  test('bản full: dữ liệu đủ để chạy lại, ghi rõ cái gì được đính kèm; bản report không mang thời tiết và series', async () => {
    const full = JSON.parse(await build()) as PackageDoc, rep = JSON.parse(await build({ kind: 'report' })) as PackageDoc;
    expect(full.attached).toMatchObject({ project: true, weatherData: true, recordedMetrics: true, recordedSeries: true, contact: true });
    expect(full.weather.data!.n).toBe(8760);
    expect(full.manifest.components.length).toBeGreaterThan(3);
    expect(full.manifest.offers.some((o) => o.priceKnown)).toBe(true);
    expect(full.runs[0].series!.socEnd).toHaveLength(8760);
    expect(rep.attached).toMatchObject({ weatherData: false, recordedSeries: false, recordedMetrics: true });
    expect(rep.weather.data).toBeUndefined();
    expect(rep.weather.ref).toMatchObject({ id: weather.seriesId, contentHash: wHash, bundled: false });
    expect(rep.runs.every((r) => !('series' in r))).toBe(true);
  });
  test('bỏ thông tin liên hệ: owner mất, số điện thoại/e-mail trong ghi chú bị che, kết quả tính không đổi', async () => {
    const p = structuredClone(project);
    p.costLines = [{ lineId: 'lin-1', category: 'labor', label: 'Công', qty: 1, qtyUnit: 'piece', unitPriceMinor: '1000000', vat: 'included', seller: 'Thợ Nam 0912.345.678', recordedAt: null, note: 'gọi +84 912 345 678 hoặc nam@x.vn, hẹn 2023-12-21' }];
    const s = stripContact(p);
    expect(s.owner).toBeUndefined();
    expect(s.costLines![0].seller).toBe('Thợ Nam [đã ẩn]');
    expect(s.costLines![0].note).toBe('gọi [đã ẩn] hoặc [đã ẩn], hẹn 2023-12-21');
    expect(redact('mã c0ffee0123456789abcdef0123456789 và 2023-12-21T07:00:00Z')).toBe('mã c0ffee0123456789abcdef0123456789 và 2023-12-21T07:00:00Z');
    const text = await build({ project: p, includeContact: false });
    expect(text).not.toContain('0909 123 456'); expect(text).not.toContain('hung@example.vn'); expect(text).not.toContain('0912.345.678');
    expect(JSON.parse(text).attached.contact).toBe(false);
    const a = await compileSim(p, weather), b = await compileSim(s, weather);
    expect(b.hash).toBe(a.hash); // liên hệ không nằm trong đầu vào của engine
  });
  test('đi vòng: nhập lại cho đúng dự án, thời tiết, mã băm; giá thiếu vẫn thiếu', async () => {
    const text = await build();
    const st = await stagePackage(text, new Set());
    if (!st.ok) throw new Error(JSON.stringify(st.issues));
    expect(st.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(await hashOf(st.project)).toBe(await hashOf(project));
    expect(await hashOf(st.weather)).toBe(wHash);
    const q0 = buildQuote(project), q1 = buildQuote(st.project);
    expect(q1.totalMinor).toBe(q0.totalMinor);
    expect(q1.totalMinor).toBeNull(); // mẫu Lâm Hà thiếu inverter/khung/dây/công: tổng hoàn chỉnh không được bịa
    expect(q1.missing).toEqual(q0.missing);
    expect(st.renamed).toBe(false);
    const again = await stagePackage(text, new Set([project.projectId]));
    expect(again.ok && again.renamed && again.project.projectId !== project.projectId && again.project.name.endsWith('(bản nhập)')).toBe(true);
  });
  test('máy B: nhập gói full rồi chạy lại cho cùng mã đầu vào và cùng chỉ số (cả PV lẫn hệ thống)', async () => {
    const st = await stagePackage(await build(), new Set());
    if (!st.ok) throw new Error('stage');
    for (const r of st.doc.runs) {
      const o = await replayRun(r, { project: st.project, weather: st.weather ?? undefined }, direct);
      expect(o, r.kind).toMatchObject({ status: 'reproduced', hashNow: r.inputHash, maxRelDiff: 0 });
    }
    expect(st.doc.runs.find((r) => r.kind === 'sim')!.inputHash).toBe(simHash);
  }, 120000);
  test('engine khác phiên bản: tách "replay đã ghi" khỏi "chạy lại bằng engine mới"; sửa thiết kế: mismatch; thiếu/khác thời tiết: cannot', async () => {
    const old: RecordedRun = { ...pvRun, engines: { ...pvRun.engines, pv: 'pv-1.0.0' } };
    const o = await replayRun(old, { project, weather }, direct);
    expect(o.status).toBe('engine-changed');
    expect(o.reason).toContain('pv-1.0.0'); expect(o.reason).toContain('MỚI');
    const edited = structuredClone(project); edited.pv = { ...edited.pv, tiltDeg: 25 };
    expect((await replayRun(pvRun, { project: edited, weather }, direct)).status).toBe('mismatch');
    expect((await replayRun(pvRun, { project, weather: undefined }, direct)).status).toBe('cannot');
    const other = { ...weather, ghi: weather.ghi!.map((x) => x * 0.9) };
    const c = await replayRun(pvRun, { project, weather: other }, direct);
    expect(c.status).toBe('cannot'); expect(c.reason).toContain('mã băm khác');
    expect((await replayRun(simRun, { project, weather }, { pv: direct.pv, sim: direct.sim })).status).toBe('reproduced');
    const a = { x: 100, y: 5 as number | null }, b = { x: 100.001, y: null };
    expect(compareMetrics(a, b).diffs.map((d) => d.key)).toEqual(['x', 'y']);
  }, 120000);
});

describe('nhập gói hỏng: lỗi chỉ rõ vị trí, không ghi gì', () => {
  const doc = async () => JSON.parse(await build({ runs: [pvRun] })) as Record<string, any>;
  const stage = async (d: unknown) => stagePackage(JSON.stringify(d), new Set());
  const codes = (s: Awaited<ReturnType<typeof stage>>) => (s.ok ? [] : s.issues.map((i) => `${i.code}@${i.field}`));
  test('không phải JSON / sai format / phiên bản mới hơn / kind lạ', async () => {
    expect(codes(await stagePackage('{oops', new Set()))).toEqual(['INVALID_JSON@/']);
    expect(codes(await stage({ format: 'khac' }))).toEqual(['WRONG_FORMAT@/format']);
    const d = await doc();
    expect(codes(await stage({ ...d, formatVersion: 2 }))).toEqual(['NEWER_FORMAT@/formatVersion']);
    expect(codes(await stage({ ...d, formatVersion: 0 }))).toEqual(['BAD_VERSION@/formatVersion']);
    expect(codes(await stage({ ...d, kind: 'lạ' }))).toEqual(['BAD_KIND@/kind']);
  });
  test('đơn vị/giá trị sai trong dự án chỉ đúng đường dẫn có tiền tố /project', async () => {
    const d = await doc();
    d.project.instances[0].kind = 'may-bay';
    const s = await stage(d);
    expect(s.ok).toBe(false);
    expect(codes(s).some((c) => c.includes('/project/instances/0'))).toBe(true);
  });
  test('thời tiết: cột sai độ dài, giá trị không phải số, mã băm không khớp', async () => {
    let d = await doc(); d.weather.data.ghi = d.weather.data.ghi.slice(0, 10);
    expect(codes(await stage(d))).toEqual(['WEATHER_LENGTH@/weather/data/ghi']);
    d = await doc(); d.weather.data.tempAirC[7] = 'nóng';
    expect(codes(await stage(d))).toEqual(['WEATHER_VALUE@/weather/data/tempAirC/7']);
    d = await doc(); d.weather.data.ghi[100] += 1;
    expect(codes(await stage(d))).toEqual(['WEATHER_HASH_MISMATCH@/weather/data']);
  });
  test('kết quả đã ghi: hash sai dạng, chỉ số không phải số, series sai độ dài', async () => {
    let d = await doc(); d.runs[0].inputHash = 'xyz';
    expect(codes(await stage(d))).toEqual(['RUN_HASH@/runs/0/inputHash']);
    d = await doc(); d.runs[0].metrics['pv.eInverterWh'] = 'nhiều';
    expect(codes(await stage(d))).toEqual(['RUN_METRIC_VALUE@/runs/0/metrics/pv.eInverterWh']);
    d = await doc(); d.runs[0].series = { pInverterW: [1, 2] };
    expect(codes(await stage(d))).toEqual(['RUN_SERIES_LENGTH@/runs/0/series/pInverterW']);
  });
  test('sửa tay dự án: cảnh báo HASH_MISMATCH nhưng không chặn; gói report thiếu thời tiết: cảnh báo WEATHER_NOT_ATTACHED, vẫn nhập được', async () => {
    const d = await doc(); d.project.name = 'Sửa tay';
    const s = await stage(d);
    expect(s.ok && s.issues.map((i) => i.code)).toEqual(['HASH_MISMATCH']);
    const r = await stagePackage(await build({ kind: 'report' }), new Set());
    expect(r.ok && r.weather === null && r.issues.map((i) => i.code)).toEqual(['WEATHER_NOT_ATTACHED']);
  });
});
