import { expect, test } from 'vitest';
import { openLamHa, createProject } from '../../src/domain/project';
import type { AutoState } from '../../src/app/auto-sim';
import { buildSampleHouse } from '../../src/domain/seed';
import { formatKWh } from '../../src/domain/units';
import type { SimResult } from '../../src/engine/system';
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

// a finished run, as far as the bar reads it (simMetrics)
const result = { pv: { totals: { eInverterWh: 7_123_456 } }, dispatch: { totals: { gridImportWh: 343_412 }, metrics: { hoursShort: 0, lowestSunMonth: null }, ledger: { maxResidualWh: 0 } } } as unknown as SimResult;
const live = (auto: AutoState) => healthOf(buildSampleHouse(), auto).filter((c) => c.key === 'pv' || c.key === 'supply');

test('done: PV pass có MWh/năm và (bóng: xem trước); cấp điện thiếu 0 giờ, mua lưới = formatKWh(gridImportWh)', () => {
  const [pv, supply] = live({ kind: 'done', hash: 'h', result, shadePreview: true });
  expect(pv).toMatchObject({ state: 'pass', text: '☀ 7,12 MWh/năm (bóng: xem trước)', missing: null });
  expect(supply).toMatchObject({ state: 'pass', text: `Cấp điện: thiếu 0 giờ/năm · mua lưới ${formatKWh(343_412)} kWh` });
  expect(formatKWh(343_412)).toBe('343,4');
});
test('running: không còn chữ số nào trong ô PV và cấp điện', () => {
  for (const c of live({ kind: 'running' })) {
    expect(c.state).toBe('unknown');
    expect(c.text).toContain('đang tính lại…');
    expect(`${c.text} ${c.missing ?? ''}`).not.toMatch(/\d/);
  }
});
test('blocked: chưa đủ dữ liệu kèm lý do, nút tới đúng chỗ nhập', () => {
  const target = { step: 'chay-thu', tab: 'pv', focusId: 'wx-select' } as const;
  for (const c of live({ kind: 'blocked', message: 'chưa đủ dữ liệu: thiếu thời tiết', target })) {
    expect(c).toMatchObject({ state: 'unknown', missing: 'chưa đủ dữ liệu: thiếu thời tiết', target });
    expect(c.text).toContain('thiếu thời tiết');
  }
});
