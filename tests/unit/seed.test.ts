import { expect, test } from 'vitest';
import { buildQuote } from '../../src/cost/quote';
import { canonicalJson } from '../../src/domain/hash';
import { fillFace } from '../../src/domain/layout-edit';
import { validateLayout } from '../../src/domain/placement';
import { addInstances, openLamHa } from '../../src/domain/project';
import { buildSampleHouse, isSample, SAMPLE_WEATHER_ID } from '../../src/domain/seed';
import type { Project } from '../../src/domain/types';
import { hasErrors, validateProject } from '../../src/domain/validate';
import { compileSim } from '../../src/engine/sim-compile';
import { simulateSystem } from '../../src/engine/system';
import { buildShadeSpec, computeShade, shadeSettingsOf } from '../../src/shade/sampler';
import { validateDesign } from '../../src/validation/strings';
import { loadBundledWeather } from '../../src/weather/bundled';
import { cardOf } from '../../src/ui/home';
import { catalog } from './helpers';

const T = '2026-11-20T00:00:00.000Z';
const ids = (p: Project) => { const seen = new Map<string, string>(); return canonicalJson(p).replace(/\b(?:prj|ins|str|edg|roof|obs)-[0-9a-z-]+/g, (m) => seen.get(m) ?? (seen.set(m, `#${seen.size}`), `#${seen.size - 1}`)); };

test('hợp lệ, không lỗi đỏ, đúng 2 giới hạn và 4 chưa đủ dữ liệu', () => {
  const p = buildSampleHouse(T), f = validateDesign(p);
  expect(hasErrors(validateProject(p))).toBe(false);
  expect(f.filter((x) => x.status === 'fail')).toEqual([]);
  expect(f.filter((x) => x.status === 'limited').map((x) => x.code).sort()).toEqual(['BATTERY_CHARGE_LIMIT', 'BATTERY_DISCHARGE_LIMIT']);
  expect(f.filter((x) => x.status === 'unknown').map((x) => x.code).sort()).toEqual(['VMP_COLD_MAX', 'VMP_COLD_MAX', 'VMP_HOT_MIN', 'VMP_HOT_MIN']);
});
test('8 tấm hợp lệ trên Mái Nam, 2 chuỗi 4+4 vào M1/M2, còn chỗ cho 4 tấm nữa', () => {
  const p = buildSampleHouse(T);
  expect(validateLayout(p)).toEqual([]);
  const south = p.roofFaces.find((f) => f.label === 'Mái Nam (minh họa)')!;
  expect(p.placements!.length).toBe(8);
  expect(p.placements!.every((x) => x.roofFaceId === south.roofFaceId)).toBe(true);
  expect(p.strings!.map((s) => s.panelIds.length)).toEqual([4, 4]);
  expect(p.strings!.map((s) => s.target?.port)).toEqual(['M1', 'M2']);
  const more = addInstances(p, catalog('vsun-620'), 4);
  const fresh = more.instances.filter((i) => i.kind === 'panel').slice(-4).map((i) => i.instanceId);
  expect(fillFace(more, south.roofFaceId, fresh).left).toEqual([]);
});
test('chạy cả năm PV + dispatch với thời tiết đóng gói và bóng xem trước', async () => {
  const p = buildSampleHouse(T);
  const w = await loadBundledWeather(SAMPLE_WEATHER_ID);
  if (!w?.ok) throw new Error('weather');
  const field = (await computeShade(await buildShadeSpec(p, w.series, shadeSettingsOf(p)), null))!.field;
  const c = await compileSim(p, w.series, { shade: field });
  expect(c.issues).toEqual([]);
  const o = await simulateSystem(c.input!, c.hash!);
  if (!o || !o.ok) throw new Error('sim');
  const r = o.result;
  expect(r.dispatch.period.n).toBe(8760);
  expect(r.dispatch.ledger.toleranceOk).toBe(true);
  expect(r.dispatch.metrics.hoursShort).toBe(0);
  expect(r.dispatch.totals.gridImportWh).toBeGreaterThan(300_000);
  expect(r.dispatch.totals.gridImportWh).toBeLessThan(400_000);
  expect(r.dispatch.totals.exportWh).toBe(0);
}, 120000);
test('dự toán chỉ biết giá tấm: 15.872.000 đ; inverter và pin Dyness thiếu giá; tổng hoàn chỉnh null', () => {
  const q = buildQuote(buildSampleHouse(T));
  expect(q.knownSubtotalMinor).toBe('15872000');
  expect(q.missing.lineKeys).toContain('design:luxpower-sna6000wpv@1');
  expect(q.missing.lineKeys).toContain('design:dyness-dl5-0c@1');
  expect(q.totalMinor).toBeNull();
});
test('dựng hai lần cho cùng nội dung (trừ id và thời điểm)', () => {
  expect(ids(buildSampleHouse(T, 'prj-a'))).toBe(ids(buildSampleHouse(T, 'prj-b')));
});
test('thẻ trang đầu: số tấm, kWp và tổng đã biết lấy từ dự án', () => {
  const head = (p: Project) => ({ projectId: p.projectId, name: p.name, headRevision: p.revision, updatedAt: p.updatedAt });
  const lamHa = openLamHa(T);
  expect(cardOf(head(lamHa), lamHa)).toEqual({ projectId: lamHa.projectId, name: 'Lâm Hà', sample: false, panels: 8, kWp: 4.96, knownMinor: '31872000', updatedAt: T });
  const sample = buildSampleHouse(T);
  expect(cardOf(head(sample), sample)).toMatchObject({ sample: true, panels: 8, kWp: 4.96, knownMinor: '15872000' });
  const renamed = { ...sample, name: 'Nhà anh Ba' };
  expect(cardOf(head(renamed), renamed).sample).toBe(true); // the card keeps the tag after a rename
});
test('cờ sample: đổi tên vẫn là mẫu; Lâm Hà thì không; schema nhận sample: true', () => {
  expect(isSample({ ...buildSampleHouse(T), name: 'Nhà của tôi' })).toBe(true);
  expect(isSample(openLamHa())).toBe(false);
  expect(hasErrors(validateProject(buildSampleHouse(T)))).toBe(false);
  expect(buildSampleHouse(T).sample).toBe(true);
});
