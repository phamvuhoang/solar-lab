import { beforeAll, describe, expect, test } from 'vitest';
import { BUILTIN_OFFERS, offersFor } from '../../src/catalog/catalog';
import { compareQuotes, buildQuote } from '../../src/cost/quote';
import { buildLamHaConfig } from '../../src/domain/presets';
import { openLamHa } from '../../src/domain/project';
import type { Project } from '../../src/domain/types';
import { compilePv, hashPvInput } from '../../src/engine/compile';
import { simulatePv, type PvResult } from '../../src/engine/pv';
import { compileSim } from '../../src/engine/sim-compile';
import { simulateSystem } from '../../src/engine/system';
import { reportFacts, type ReportRun } from '../../src/reports/report-data';
import { CURRENT_ENGINES } from '../../src/reports/replay';
import { loadBundledWeather } from '../../src/weather/bundled';
import type { WeatherSeries } from '../../src/weather/series';
import { catalog } from './helpers';

const parts = () => ({ inverter: catalog('luxpower-sna6000wpv'), battery: catalog('used-battery'), home: catalog('sample-home-load'), pump: catalog('sample-pump-load'), controller: catalog('sample-pump-controller') });
const offers = (c: ReturnType<typeof catalog>) => offersFor(BUILTIN_OFFERS, c);
const pumpAt = (p: Project, hour: number): Project => ({ ...p, loadPlans: p.loadPlans!.map((l) => (l.pump ? { ...l, fractions: l.fractions.map((_, k) => (k === hour ? 1 : 0)) } : l)) });

let weather: WeatherSeries, A: Project, B: Project, pv: PvResult, runs: ReportRun[];
beforeAll(async () => {
  const w = await loadBundledWeather('lam-ha-2023-pvgis-era5');
  if (!w?.ok) throw new Error('weather');
  weather = w.series;
  const base = { ...buildLamHaConfig(openLamHa(), 'shared8', parts(), offers), pv: { tiltDeg: 10, azimuthDeg: 180, weatherId: weather.seriesId } } as Project;
  A = pumpAt(base, 18); B = pumpAt(base, 11);
  const pc = compilePv(B, weather);
  pv = (await simulatePv(pc.input!, await hashPvInput(pc.input!)))!;
  runs = [];
  for (const [label, p] of [['A', A], ['B', B]] as const) {
    const c = await compileSim(p, weather), o = await simulateSystem(c.input!, c.hash!);
    if (!o || !o.ok) throw new Error('sim');
    runs.push({ label, title: label === 'A' ? 'A · bơm 18h' : 'B · bơm 11h', result: o.result, projectName: p.name, hash: c.hash! });
  }
}, 120000);

const facts = (o: Partial<Parameters<typeof reportFacts>[0]> = {}) => reportFacts({ project: B, weather, weatherAttached: false, pv, runs, cost: compareQuotes(buildQuote(A), buildQuote(B)), generatedAt: '2026-11-19T00:00:00Z', includeContact: false, engines: CURRENT_ENGINES, buildId: 't', ...o });

describe('dữ liệu báo cáo A4', () => {
  test('chi phí: tổng thiếu vẫn là thiếu và nêu lý do; ngày giá lấy từ báo giá dùng; hai tổng cho cùng phạm vi', () => {
    const f = facts();
    expect(f.quote.quote.totalMinor).toBeNull();
    expect(f.quote.totalText).toContain('chưa đủ để báo tổng');
    expect(f.quote.missingText.length).toBeGreaterThan(0);
    expect(f.quote.date === null || /^\d{4}-\d{2}-\d{2}$/.test(f.quote.date)).toBe(true);
    expect(f.quote.quote.knownSubtotalMinor).toBe('31872000'); // 8 tấm + bộ pin theo báo giá Lâm Hà
  });
  test('cấp độ kiểm tra có đủ sáu lớp, thi công luôn ngoài phạm vi, bóng che tắt thì ghi "không bật"', () => {
    const f = facts();
    expect(f.levels.map((l) => l.state)).toEqual(['done', expect.stringMatching(/done|gaps/), 'done', 'done', 'off', 'out-of-scope']);
    expect(f.levels[5].detail).toContain('người lắp xác nhận');
    expect(facts({ pv: null, runs: [] }).levels.slice(2, 4).map((l) => l.state)).toEqual(['not-run', 'not-run']);
    expect(f.checks.counts.pass + f.checks.counts.fail + f.checks.counts.limited + f.checks.counts.unknown).toBeGreaterThan(0);
  });
  test('giả định gồm thiết lập người dùng và giả định của engine; nguồn thời tiết và phạm vi kết luận nêu tên dữ liệu', () => {
    const f = facts();
    expect(f.assumptions.some((a) => a.startsWith('Chính sách hệ thống: SoC đầu'))).toBe(true);
    expect(f.assumptions.some((a) => a.startsWith('Mảng PV:'))).toBe(true);
    expect(f.assumptions.length).toBeGreaterThan(5);
    expect(f.weather).toMatchObject({ attached: false });
    expect(f.weather!.source).toContain('PVGIS');
    expect(f.scope[0]).toContain('PVGIS');
  });
  test('biểu đồ: 13 cột tháng theo giờ Việt Nam cộng đúng tổng năm; ngày điển hình 24 giờ; SoC trung bình theo giờ cho mỗi phương án', () => {
    const f = facts();
    expect(f.monthly!.map((m) => m.month)).toContain('2023-06');
    const sum = f.monthly!.reduce((s, m) => s + m.kWh, 0);
    expect(sum * 1000).toBeCloseTo(pv.totals.eInverterWh, 3);
    expect(f.typicalDay!.avgW).toHaveLength(24);
    expect(Math.max(...f.typicalDay!.avgW)).toBeGreaterThan(500);
    expect(f.socByHour.map((s) => s.label)).toEqual(['A', 'B']);
    expect(f.socByHour[0].avgPct).toHaveLength(24);
  });
  test('A/B: ghi chú năng lượng còn trong pin khi SoC cuối khác; liên hệ chỉ hiện khi được bật', () => {
    const f = facts();
    const dEnd = Math.abs(runs[0].result.dispatch.totals.eEndWh - runs[1].result.dispatch.totals.eEndWh);
    expect(f.energyNote !== null).toBe(dEnd > 1);
    const p = { ...B, owner: { name: 'Anh Hùng', phone: '0909 123 456' } };
    expect(facts({ project: p }).owner).toBeNull();
    expect(facts({ project: p, includeContact: true }).owner).toMatchObject({ phone: '0909 123 456' });
    expect(f.attached.find((x) => x.label === 'Thông tin liên hệ')!.state).toBe('đã bỏ');
  });
});
