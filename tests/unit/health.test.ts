import { expect, test } from 'vitest';
import { openLamHa, createProject } from '../../src/domain/project';
import { healthOf } from '../../src/ui/health';
import { catalog, rig, withStrings } from './helpers';

const cell = (p: Parameters<typeof healthOf>[0], k: string) => healthOf(p).find((c) => c.key === k)!;

test('Lâm Hà vừa mở: chỉ có cảnh báo cấu trúc → Điện "chưa đủ dữ liệu", không bao giờ "đạt"', () => {
  const e = cell(openLamHa(), 'electric');
  expect(e.state).toBe('unknown');
  expect(e.text).toContain('0 lỗi');
  expect(e.missing).toContain('chưa thuộc chuỗi');
});
test('Lâm Hà: tiền đã biết 31.872.000 đ, thiếu 4 giá (khung, dây, bảo vệ, công)', () => {
  const m = cell(openLamHa(), 'money');
  expect(m.text).toContain('31.872.000'); expect(m.text).toContain('thiếu 4 giá'); expect(m.state).toBe('unknown');
});
test('chuỗi 12 tấm vượt Voc lạnh → Điện "có lỗi"', () => {
  const r = rig(catalog('vsun-620'), catalog('luxpower-sna6000wpv'), 12);
  expect(cell(withStrings(r, [{ n: 12, port: 'M1' }]), 'electric').state).toBe('fail');
});
test('dự án trống: Điện và tiền "chưa đủ dữ liệu"; PV và cấp điện "chưa chạy"', () => {
  const cs = healthOf(createProject('x'));
  expect(cs.map((c) => c.key)).toEqual(['electric', 'pv', 'supply', 'money']);
  expect(cs.every((c) => c.state === 'unknown')).toBe(true);
  expect(cs[1].text).toContain('chưa chạy');
});
