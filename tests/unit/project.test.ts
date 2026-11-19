import { expect, test } from 'vitest';
import { bomOf, createProject, openLamHa } from '../../src/domain/project';

test('tạo dự án mới có tên, rỗng tên thì dùng tên mặc định', () => {
  expect(createProject(' Nhà vườn ')).toMatchObject({ name: 'Nhà vườn', status: 'draft' });
  expect(createProject('  ').name).toBe('Dự án mới');
});

test('mẫu Lâm Hà cho đúng golden 31.872.000 đ', () => {
  const p = openLamHa();
  expect(p.name).toBe('Lâm Hà');
  expect(bomOf(p)).toEqual({ totalMinor: '31872000', missingIds: [] });
});
