import { describe, expect, test } from 'vitest';
import { hasErrors, validateProject } from '../../src/domain/validate';
import { GLOSSARY } from '../../src/lessons/glossary';
import { LESSONS, lessonById, type Measure } from '../../src/lessons/lessons';

const run = async (id: string) => {
  const l = lessonById(id)!, w = await l.fixture(), before = await l.measure(w), after = await l.measure(l.apply(w));
  return { l, w, before, after };
};
const nums = (m: Measure) => Object.values(m.facts).every(Number.isFinite);

describe('ba bài học: fixture riêng, đo bằng engine thật, dự đoán được chấm', () => {
  test('mỗi bài dựng một bản sao mới hợp lệ mỗi lần gọi, không dính nhau, và không bị áp dụng sẵn', async () => {
    for (const l of LESSONS) {
      const a = await l.fixture(), b = await l.fixture();
      expect(hasErrors(validateProject(a)), l.id).toBe(false);
      expect(a.projectId, l.id).not.toBe(b.projectId === a.projectId ? '' : b.projectId);
      a.name = 'đã sửa';
      expect(b.name).not.toBe('đã sửa');
      const frozen = JSON.stringify(b);
      l.apply(b);
      expect(JSON.stringify(b), `${l.id}: apply không được sửa bản đầu vào`).toBe(frozen);
    }
    expect(LESSONS.map((l) => l.id)).toEqual(['series-parallel', 'pump-hour', 'tank-shade']);
  });
  test('bài 1: nối tiếp Vmp = 2 × 41,23 V, Imp 1 tấm; song song giữ điện áp một tấm và nhân đôi dòng; công suất không đổi', async () => {
    const { before, after, l } = await run('series-parallel');
    expect(nums(before) && nums(after)).toBe(true);
    expect(before.facts.vmp).toBeCloseTo(82.46, 2);
    expect(after.facts.vmp).toBeCloseTo(41.23, 2);
    expect(after.facts.imp).toBeCloseTo(2 * before.facts.imp, 6);
    expect(after.facts.power).toBeCloseTo(before.facts.power, 6);
    expect(before.table!.rows.length).toBeGreaterThan(0);
    expect(l.check('82', before, after).correct).toBe(true);
    expect(l.check('82,5', before, after).correct).toBe(true); // dấu phẩy thập phân
    expect(l.check('41', before, after).correct).toBe(false);
    expect(l.check('', before, after).correct).toBe(false);
  });
  test('bài 2: dời bơm về 11h làm mức pin thấp nhất cao hơn và pin xả ít hơn; chấm đúng ba lựa chọn', async () => {
    const { before, after, l } = await run('pump-hour');
    expect(after.facts.minSoc).toBeGreaterThan(before.facts.minSoc + 1);
    expect(after.facts.dischargeWh).toBeLessThan(before.facts.dischargeWh);
    expect(before.series!.values).toHaveLength(72);
    expect(before.table!.rows[0][0]).toBe('ngày 1, 12h');
    expect(l.check('higher', before, after).correct).toBe(true);
    expect(l.check('lower', before, after)).toMatchObject({ correct: false });
    expect(l.check('same', before, after).truth).toContain('cao hơn');
    expect(l.explain(before, after, 'basic').join(' ')).toContain('chỉ đúng cho 72 giờ'); // phạm vi kết luận
  }, 60000);
  test('bài 3: bồn nước che các tấm ở mép Đông buổi sáng; dịch 5 m thì hết che và mất ít Wh hơn; cận dưới ≥ cận trên', async () => {
    const { before, after, l } = await run('tank-shade');
    expect(before.facts.shaded8).toBeGreaterThanOrEqual(1);
    expect(after.facts.shaded8).toBe(0);
    expect(before.facts.lossUp).toBeGreaterThan(0);
    expect(before.facts.lossLow).toBeGreaterThanOrEqual(before.facts.lossUp);
    expect(after.facts.lossUp).toBeLessThan(before.facts.lossUp);
    expect(before.table!.rows).toHaveLength(8);
    expect(before.readings.find((r) => r.label === 'Chuỗi liên quan')!.value).toMatch(/chuỗi \d/);
    expect(l.check(String(before.facts.shaded8), before, after).correct).toBe(true);
    expect(l.check('0', before, after).correct).toBe(false);
  }, 60000);
  test('chế độ cơ bản và kỹ sư: cùng số liệu, kỹ sư thêm giải thích công thức; thuật ngữ kW/kWh, MPPT, SoC, BMS đều có định nghĩa tiếng Việt', async () => {
    const { l, before, after } = await run('series-parallel');
    expect(l.explain(before, after, 'engineer').length).toBe(l.explain(before, after, 'basic').length + 1);
    expect(before.engineer.length).toBeGreaterThan(0);
    for (const id of ['kw-kwh', 'mppt', 'soc', 'bms']) { const t = GLOSSARY.find((x) => x.id === id)!; expect(t.basic.length).toBeGreaterThan(40); expect(t.engineer.length).toBeGreaterThan(t.basic.length / 2); }
    expect(LESSONS.every((x) => x.terms.length > 0)).toBe(true);
  });
});
