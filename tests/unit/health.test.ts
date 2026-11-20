import { describe, expect, test } from 'vitest';
import { buildQuote } from '../../src/cost/quote';
import { openLamHa, createProject } from '../../src/domain/project';
import type { AutoState } from '../../src/app/auto-sim';
import { buildSampleHouse } from '../../src/domain/seed';
import { formatKWh } from '../../src/domain/units';
import type { SimResult } from '../../src/engine/system';
import type { Kit, Project } from '../../src/domain/types';
import { healthOf, pvTotal } from '../../src/ui/health';
import { validateDesign } from '../../src/validation/strings';
import { catalog, rig, withStrings } from './helpers';

const cell = (p: Parameters<typeof healthOf>[0], k: string) => healthOf(p).find((c) => c.key === k)!;

test('Lâm Hà vừa mở: chỉ có cảnh báo cấu trúc → Điện "chưa đủ dữ liệu", không bao giờ "đạt"', () => {
  const e = cell(openLamHa(), 'electric');
  expect(e.state).toBe('unknown');
  expect(e.text).toBe('Điện: 0 lỗi · 0 giới hạn · 2 chưa đủ dữ liệu'); // the design summary and the inspector count the same (tests/e2e/design.spec.ts)
  expect(e.missing).toContain('chưa thuộc chuỗi');
});
test('Lâm Hà: tiền đã biết 31.872.000 đ, thiếu 4 giá (khung, dây, bảo vệ, công)', () => {
  const m = cell(openLamHa(), 'money');
  expect(m.text).toContain('31.872.000'); expect(m.text).toContain('thiếu 4 giá'); expect(m.state).toBe('unknown');
});

describe('tiền chỉ "đạt" khi dự toán báo được tổng hoàn chỉnh', () => {
  const lam = openLamHa();
  // every price known and no category required: what used to read "đạt"
  const priced = { ...lam, quote: { vatRateBp: 1000, requiredCategories: [], waived: [] } } as Project;
  const vatKnown = { ...priced, snapshots: { ...lam.snapshots, offers: lam.snapshots.offers.map((o) => ({ ...o, vat: 'included' as const })) } } as Project;
  const kit = (qty: number): Kit => ({ kitId: 'kit-1', label: 'Gói tấm', count: 2, parts: [{ componentRef: { modelId: 'vsun-620', revision: 1 }, qty }], priceMinor: '10000000', vat: 'included', seller: 'X', recordedAt: '2026-01-01', covers: [] });
  test('mọi dòng có giá nhưng 2 báo giá chưa rõ VAT: chưa đủ dữ liệu, nói rõ lý do', () => {
    expect(buildQuote(priced)).toMatchObject({ complete: false, missing: { lineKeys: [], scope: [] } });
    expect(cell(priced, 'money')).toMatchObject({ state: 'unknown', text: '31.872.000 đ đã biết · 2 dòng chưa rõ VAT' });
  });
  test('kit ghi nhiều tấm hơn thiết kế: chưa đủ dữ liệu, nói rõ lý do', () => {
    expect(cell({ ...vatKnown, kits: [kit(6)] }, 'money')).toMatchObject({ state: 'unknown', text: expect.stringContaining('kit ghi nhiều linh kiện hơn thiết kế có') });
  });
  test('đủ giá, rõ VAT, kit khớp: đạt; ở mọi trường hợp trên "đạt" ⇔ quote.complete', () => {
    expect(cell(vatKnown, 'money')).toMatchObject({ state: 'pass', text: '31.872.000 đ đã biết' });
    for (const p of [lam, priced, vatKnown, { ...vatKnown, kits: [kit(6)] }, { ...vatKnown, kits: [kit(4)] }, buildSampleHouse()] as Project[])
      expect(cell(p, 'money').state === 'pass').toBe(buildQuote(p).complete);
  });
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
const YEAR = { stepSeconds: 3600, n: 8760 };
const result = { pv: { totals: { eInverterWh: 7_123_456 }, period: YEAR }, dispatch: { totals: { gridImportWh: 343_412 }, metrics: { hoursShort: 0, lowestSunMonth: null }, ledger: { maxResidualWh: 0 } } } as unknown as SimResult;
const live = (auto: AutoState) => healthOf(buildSampleHouse(), auto).filter((c) => c.key === 'pv' || c.key === 'supply');

test('done: PV pass có MWh/năm và (bóng: xem trước); cấp điện thiếu 0 giờ, mua lưới = formatKWh(gridImportWh)', () => {
  const [pv, supply] = live({ kind: 'done', hash: 'h', result, shadePreview: true });
  expect(pv).toMatchObject({ state: 'pass', text: '☀ 7,12 MWh/năm (bóng: xem trước)', missing: null });
  expect(supply).toMatchObject({ state: 'pass', text: `Cấp điện: thiếu 0 giờ/năm · mua lưới ${formatKWh(343_412)} kWh` });
  expect(formatKWh(343_412)).toBe('343,4');
});
test('dữ liệu ngắn hơn một năm: tổng trong kỳ dữ liệu, không bao giờ "/năm"', () => {
  const day = { ...result, pv: { ...result.pv, totals: { eInverterWh: 17_560 }, period: { stepSeconds: 3600, n: 24 } }, dispatch: { ...result.dispatch, metrics: { hoursShort: 3, lowestSunMonth: null } } } as unknown as SimResult;
  const [pv, supply] = live({ kind: 'done', hash: 'h', result: day, shadePreview: false });
  expect(pv.text).toBe('☀ 17,6 kWh trong 1 ngày dữ liệu');
  expect(supply.text).toMatch(/^Cấp điện: thiếu 3 giờ trong 1 ngày dữ liệu/);
  expect(`${pv.text} ${supply.text}`).not.toContain('năm');
  expect(pvTotal(500, { stepSeconds: 3600, n: 6 })).toBe('0,5 kWh trong 6 giờ dữ liệu');
  expect(pvTotal(7_123_456, { stepSeconds: 3600, n: 8784 })).toBe('7,12 MWh/năm'); // a leap year is a year
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
test('mỗi ô tới nguồn của số: điện mở lỗi nặng nhất (công thức, nguồn); PV giả định của lần chạy; cấp điện sổ năng lượng; tiền bảng dòng', () => {
  const p = buildSampleHouse();
  const [e, pv, supply, money] = healthOf(p, { kind: 'done', hash: 'h', result, shadePreview: true });
  const worst = validateDesign(p).find((f) => f.status !== 'pass')!;
  expect(worst.status).toBe('limited'); // Nhà mẫu: 2 giới hạn đứng đầu, đúng trạng thái của ô
  expect(e.target).toEqual({ step: 'dau-noi', tab: 'thiet-ke', focusId: 'finding-detail', select: worst.objectIds[0] });
  expect(pv.target).toEqual({ step: 'chay-thu', tab: 'he-thong', focusId: 'sim-pv-total' }); // the same number on the system screen
  expect(pv.text).toBe(`☀ ${pvTotal(7_123_456, YEAR)} (bóng: xem trước)`); // written by the one function the screen's row uses
  // a target hidden at this depth falls back to the next one shown: the ledger is for Kỹ sư, "Đủ điện …" and the total for everyone
  expect(supply.target).toEqual({ step: 'chay-thu', tab: 'he-thong', focusId: ['sim-ledger', 'sim-days'] });
  expect(money.target).toEqual({ step: 'chi-phi', tab: 'du-toan', focusId: ['quote-lines', 'quote-total'] });
});
