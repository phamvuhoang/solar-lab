import { describe, expect, test } from 'vitest';
import { buildSampleHouse } from '../../src/domain/seed';
import { WIRING_NOTE, wiringTable } from '../../src/reports/wiring';

describe('bảng đấu nối cho thợ', () => {
  test('nhà mẫu: 2 chuỗi tới MPPT 1/2, 1 dòng Pin, 2 dòng Ra tải AC', () => {
    const rows = wiringTable(buildSampleHouse());
    expect(rows).toHaveLength(5);
    const strs = rows.filter((r) => /MPPT \d$/.test(r.to));
    expect(strs).toHaveLength(2);
    expect(strs.map((r) => r.to.split(' · ')[1]).sort()).toEqual(['MPPT 1', 'MPPT 2']);
    for (const r of strs) { expect(r.from).toContain('4 tấm'); expect(r.from).toMatch(/#\d+ → #\d+ → #\d+ → #\d+/); expect(r.detail).toMatch(/^Voc lạnh [\d.,]+\/[\d.,]+ V$|chưa đủ dữ liệu/); }
    expect(rows.filter((r) => r.to.endsWith('· Pin'))).toHaveLength(1);
    expect(rows.filter((r) => r.from.endsWith('· Ra tải AC'))).toHaveLength(2);
  });
  test('ghi chú trách nhiệm', () => expect(WIRING_NOTE).toBe('Tiết diện dây và thiết bị bảo vệ do người lắp xác nhận.'));
});
