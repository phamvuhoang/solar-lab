import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, test } from 'vitest';
import { BUILTIN_OFFERS, offersFor } from '../../src/catalog/catalog';
import { buildQuote } from '../../src/cost/quote';
import { quoteToCsv } from '../../src/reports/csv';
import { demoGableRoof, fillFace } from '../../src/domain/layout-edit';
import { buildLamHaConfig } from '../../src/domain/presets';
import { createProject, openLamHa } from '../../src/domain/project';
import type { Kit, Project } from '../../src/domain/types';
import { parseMoney, parseQuantity } from '../../src/domain/units';
import { validateProject } from '../../src/domain/validate';
import { compilePv } from '../../src/engine/compile';
import { simulatePv } from '../../src/engine/pv';
import { commitPackage } from '../../src/persistence/import';
import { ProjectRepository } from '../../src/persistence/repository';
import { buildPackage, stagePackage } from '../../src/reports/package';
import { CURRENT_ENGINES } from '../../src/reports/replay';
import { buildShadeSpec, computeShade } from '../../src/shade/sampler';
import { catalog } from './helpers';
import { wx } from './pv-helpers';

const parts = () => ({ inverter: catalog('luxpower-sna6000wpv'), battery: catalog('used-battery'), home: catalog('sample-home-load'), pump: catalog('sample-pump-load'), controller: catalog('sample-pump-controller') });
const offers = (c: ReturnType<typeof catalog>) => offersFor(BUILTIN_OFFERS, c);

describe('soát trước phát hành: sửa các lỗi toàn vẹn', () => {
  test('tiền: nhóm số sau dấu chấm bắt đầu bằng 0 hoặc dạng thập phân hai số không bị đọc nhầm thành hàng nghìn', () => {
    for (const bad of ['0.500', '00.500', '18.00', '12.0', '1.5', '1,000', '12,5']) expect(parseMoney(bad).ok, bad).toBe(false);
    for (const [txt, minor] of [['1.984.000', '1984000'], ['16 000 000', '16000000'], ['3200 đ', '3200'], ['500', '500'], ['999.999', '999999']] as const) expect(parseMoney(txt)).toEqual({ ok: true, minor });
  });
  test('đại lượng: "0.750 m" là 0,75 m, "0.500 kWh" là 500 Wh; "1.500 Wh" vẫn là 1500', () => {
    expect(parseQuantity('0.750 m', 'm')).toMatchObject({ ok: true, value: 0.75 });
    expect(parseQuantity('0.500 kWh', 'Wh')).toMatchObject({ ok: true, value: 500 });
    expect(parseQuantity('1.500 Wh', 'Wh')).toMatchObject({ ok: true, value: 1500 });
    expect(parseQuantity('0,5 kWh', 'Wh')).toMatchObject({ ok: true, value: 500 });
  });
  test('kit ghi nhiều linh kiện hơn thiết kế có: không báo tổng hoàn chỉnh, CSV nói rõ lý do', () => {
    const ref = { modelId: 'vsun-620', revision: 1 };
    const kit = (qty: number, count: number): Kit => ({ kitId: 'kit-1', label: 'Gói 6 tấm', count, parts: [{ componentRef: ref, qty }], priceMinor: '10000000', vat: 'included', seller: 'X', recordedAt: '2026-01-01', covers: [] });
    const over = { ...openLamHa(), quote: { requiredCategories: [], waived: [] }, kits: [kit(6, 2)] } as Project; // 12 tấm trong kit, thiết kế có 8
    const q = buildQuote(over);
    expect(q.issues.map((i) => i.code)).toContain('KIT_PART_NOT_IN_DESIGN');
    expect(q.complete).toBe(false); expect(q.totalMinor).toBeNull();
    expect(quoteToCsv(q, 'x')).toContain('kit ghi nhiều linh kiện hơn thiết kế có');
    const fits = buildQuote({ ...openLamHa(), quote: { requiredCategories: [], waived: [] }, kits: [kit(4, 2)] } as Project); // 8 tấm đúng bằng thiết kế
    expect(fits.issues.map((i) => i.code)).not.toContain('KIT_PART_NOT_IN_DESIGN');
  });
  test('bóng che: tấm chưa đặt lên mái được ghi trong kết quả (không âm thầm coi là bị che)', async () => {
    let p = { ...buildLamHaConfig(openLamHa(), 'shared8', parts(), offers), pv: { tiltDeg: 10, azimuthDeg: 180 }, shade: { enabled: true, mode: 'standard', grid: 4 } } as Project;
    p = demoGableRoof(p);
    const base = p;
    const panels = p.instances.filter((i) => i.kind === 'panel').map((i) => i.instanceId);
    p = fillFace(p, p.roofFaces[0].roofFaceId, panels.slice(0, 4)).project; // chuỗi 2 (4 tấm) chưa đặt tấm nào; chuỗi đặt dở bị compile từ chối (STRING_PARTLY_PLACED)
    const w = wx({ n: 24, t0: Date.UTC(2023, 11, 21) / 1000, ghi: Array(24).fill(500), dni: Array(24).fill(400), dhi: Array(24).fill(100), tempAirC: Array(24).fill(25), windMs: Array(24).fill(1) });
    const spec = await buildShadeSpec(p, w, { mode: 'standard', grid: 4 });
    expect(spec.unplaced).toHaveLength(4);
    const field = (await computeShade(spec, null))!.field;
    const c = compilePv(p, w, { shade: field });
    expect(c.issues).toEqual([]);
    const r = (await simulatePv(c.input!, 'x'))!;
    expect(r.shade!.notes.some((n) => n.startsWith('4 tấm chưa đặt lên mái nên KHÔNG bị bóng che'))).toBe(true);
    const full = fillFace(base, base.roofFaces[0].roofFaceId, panels).project;
    const f2 = (await computeShade(await buildShadeSpec(full, w, { mode: 'standard', grid: 4 }), null))!.field;
    expect((await simulatePv(compilePv(full, w, { shade: f2 }).input!, 'y'))!.shade!.notes.some((n) => /chưa đặt lên mái/.test(n))).toBe(false);
  });
  test('gói có thời tiết cùng mã nhưng khác nội dung: giữ bản trong máy và cảnh báo rõ, không im lặng', async () => {
    const repo = await ProjectRepository.open({ factory: new IDBFactory() });
    await repo.saveWeather(wx({ n: 2, seriesId: 'wx-same', poa: [1, 2], tempAirC: [25, 25], windMs: [1, 1] }));
    const text = await buildPackage({ kind: 'full', project: { ...createProject('x'), pv: { weatherId: 'wx-same' } }, runs: [], weather: wx({ n: 2, seriesId: 'wx-same', poa: [900, 900], tempAirC: [25, 25], windMs: [1, 1] }), includeContact: true, includeSeries: false, app: { buildId: 't', engines: CURRENT_ENGINES } });
    const s = await stagePackage(text, new Set());
    if (!s.ok) throw new Error('stage');
    const out = await commitPackage(repo, s);
    expect(out.ok && out.issues.map((i) => i.code)).toContain('WEATHER_ID_CONFLICT');
    expect((await repo.getWeather('wx-same'))!.poa).toEqual([1, 2]); // không ghi đè
  });
  test('múi giờ không hợp lệ bị chặn khi nhập (nếu không, báo cáo và kết quả sẽ sập)', () => {
    const p = { ...createProject('x'), location: { latitude: 11, longitude: 108, timezone: 'Mars/Olympus' } };
    expect(validateProject(p).map((i) => `${i.code}@${i.field}`)).toEqual(['INVALID_TIMEZONE@/location/timezone']);
    expect(validateProject({ ...p, location: { ...p.location, timezone: 'Asia/Ho_Chi_Minh' } })).toEqual([]);
  });
  test('dựng lại cấu hình Lâm Hà giữ lịch bơm, thông số bơm và lịch tải người dùng đã đặt', () => {
    const a = buildLamHaConfig(openLamHa(), 'shared8', parts(), offers);
    const edited: Project = { ...a, loadPlans: a.loadPlans!.map((l) => (l.pump
      ? { ...l, fractions: l.fractions.map((_, h) => (h >= 6 && h <= 9 ? 1 : 0)), priority: 1, pump: { staticHeadM: 35, frictionK: 0.5, curve: { qM3h: [0, 5, 10], headM: [60, 50, 30] } } }
      : { ...l, fractions: l.fractions.map(() => 0.5), priority: 2 })) };
    const b = buildLamHaConfig(edited, 'split6+2', parts(), offers);
    const pump = b.loadPlans!.find((l) => l.pump)!, home = b.loadPlans!.find((l) => !l.pump)!;
    expect(pump.pump).toEqual({ staticHeadM: 35, frictionK: 0.5, curve: { qM3h: [0, 5, 10], headM: [60, 50, 30] } });
    expect(pump.fractions.filter(Boolean)).toHaveLength(4);
    expect([pump.priority, home.priority]).toEqual([1, 2]);
    expect(home.fractions.every((x) => x === 0.5)).toBe(true);
    expect(b.loadPlans!.every((l) => b.instances.some((i) => i.instanceId === l.instanceId))).toBe(true); // vẫn trỏ vào thiết bị mới
  });
});
