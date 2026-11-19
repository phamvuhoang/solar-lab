import { expect, test } from 'vitest';
import { addInstances, createProject, openLamHa } from '../../src/domain/project';
import { buildQuote } from '../../src/cost/quote';
import { BUILTIN_COMPONENTS, BUILTIN_OFFERS, findComponent, offersFor } from '../../src/catalog/catalog';
import { hasErrors, validateProject } from '../../src/domain/validate';
import { diff } from '../../src/domain/diff';

test('tạo dự án mới có tên, rỗng tên thì dùng tên mặc định', () => {
  expect(createProject(' Nhà vườn ')).toMatchObject({ name: 'Nhà vườn', revision: 1, instances: [] });
  expect(createProject('  ').name).toBe('Dự án mới');
});

test('mẫu Lâm Hà: 9 instance, hợp lệ, đúng golden 31.872.000 đ', () => {
  const p = openLamHa();
  expect(p.instances).toHaveLength(9);
  expect(new Set(p.instances.map((i) => i.instanceId)).size).toBe(9);
  expect(validateProject(p).filter((i) => i.severity === 'error')).toEqual([]);
  expect(buildQuote(p).deviceCounts).toEqual({ 'vsun-620@1': 8, 'used-battery@1': 1 });
  expect(buildQuote(p).knownSubtotalMinor).toBe('31872000');
});

test('thiết bị chưa chọn báo giá thì BOM báo thiếu thay vì 0', () => {
  const hestia = findComponent(BUILTIN_COMPONENTS, { modelId: 'hestia-650', revision: 1 })!;
  const p = addInstances(createProject('x'), hestia, 2, offersFor(BUILTIN_OFFERS, hestia));
  expect(buildQuote(p).missing.lineKeys).toEqual(['design:hestia-650@1']);
});

test('tham chiếu hỏng bị bắt đúng trường', () => {
  const p = openLamHa();
  p.priceSelections[0].offerId = 'nope';
  p.instances[0].componentRef = { modelId: 'ghost', revision: 1 };
  const issues = validateProject(p);
  expect(hasErrors(issues)).toBe(true);
  expect(issues.map((i) => i.field)).toEqual(expect.arrayContaining(['/instances/0/componentRef', '/priceSelections/0/offerId']));
});

test('diff hai revision liệt kê đúng đường dẫn đổi', () => {
  const a = openLamHa();
  const b = structuredClone(a);
  b.name = 'Lâm Hà B';
  b.snapshots.components[0].specs.pstcW.v = 625;
  expect(diff(a, b)).toEqual([
    { path: '/name', before: 'Lâm Hà', after: 'Lâm Hà B' },
    { path: '/snapshots/components/0/specs/pstcW/v', before: 620, after: 625 },
  ]);
});
