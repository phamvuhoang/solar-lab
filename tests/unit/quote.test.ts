import { describe, expect, test } from 'vitest';
import { addCostLine, removeCostLine, selectOffer, setQuantity, setQuoteSettings } from '../../src/cost/edit';
import { buildQuote, compareQuotes, roundDiv, selectTier } from '../../src/cost/quote';
import { BUILTIN_COMPONENTS, findComponent } from '../../src/catalog/catalog';
import { addInstances, createProject, openLamHa } from '../../src/domain/project';
import type { Kit, Offer, Project } from '../../src/domain/types';
import { hasErrors, validateProject } from '../../src/domain/validate';
import { quoteToCsv } from '../../src/reports/csv';

const PANEL = { modelId: 'vsun-620', revision: 1 };
const BATTERY = { modelId: 'used-battery', revision: 1 };
const extra = (o: Partial<Parameters<typeof addCostLine>[1]> = {}) =>
  ({ category: 'frame', label: 'Khung', qty: 1, qtyUnit: 'piece', unitPriceMinor: '1000000', vat: 'included', seller: null, recordedAt: null, ...o }) as Parameters<typeof addCostLine>[1];
const line = (p: Project, key: string) => buildQuote(p).lines.find((l) => l.key === key)!;
const patchOffer = (p: Project, id: string, f: (o: Offer) => void) => { const n = structuredClone(p); f(n.snapshots.offers.find((o) => o.offerId === id)!); return n; };
const fullScope = (p: Project) => ['frame', 'cable', 'protection', 'labor'].reduce((q, c) => addCostLine(q, extra({ category: c as never, label: c })), p);

describe('golden Lâm Hà', () => {
  test('6 × 620 W × 3.200 = 11.904.000; 8 tấm = 15.872.000; cộng pin cũ = 31.872.000 phần đã biết', () => {
    const p8 = openLamHa();
    const q8 = buildQuote(p8);
    expect(line(p8, 'design:vsun-620@1')).toMatchObject({ totalMinor: '15872000', qty: 8, priceUnit: 'W', unitPriceMinor: '3200' });
    expect(line(p8, 'design:vsun-620@1').basis).toBe('8 × 620 W × 3.200 đ/W');
    expect(q8.knownSubtotalMinor).toBe('31872000');
    expect(line(setQuantity(p8, PANEL, 6), 'design:vsun-620@1').totalMinor).toBe('11904000');
  });
  test('thiếu khung, dây, bảo vệ, công → tổng hoàn chỉnh là null và nêu đúng hạng mục', () => {
    const q = buildQuote(openLamHa());
    expect(q).toMatchObject({ complete: false, totalMinor: null, missing: { lineKeys: [], scope: ['frame', 'cable', 'protection', 'labor'] } });
  });
  test('bớt hai tấm giảm 3.968.000 đ khi cùng bậc giá, A/B công bố chênh phần đã biết', () => {
    const a = openLamHa(), b = setQuantity(a, PANEL, 6);
    const cmp = compareQuotes(buildQuote(a), buildQuote(b));
    expect(cmp.knownDeltaMinor).toBe('-3968000');
    expect(cmp.rows.find((r) => r.key === 'design:vsun-620@1')).toMatchObject({ deltaMinor: '-3968000' });
    expect(cmp.totalDeltaMinor).toBeNull();
    expect(cmp.totalDeltaReason).toBe('INCOMPLETE');
    expect(cmp.rows.find((r) => r.key === 'design:used-battery@1')?.deltaMinor).toBe('0');
  });
  test('device count đúng khi bớt về 0 và khi thêm', () => {
    const p = setQuantity(openLamHa(), PANEL, 0);
    expect(buildQuote(p).deviceCounts).toEqual({ 'used-battery@1': 1 });
    expect(p.instances).toHaveLength(1);
    expect(buildQuote(setQuantity(p, PANEL, 3)).deviceCounts['vsun-620@1']).toBe(3);
  });
});

describe('giá theo bậc', () => {
  const tiered = (p: Project) => patchOffer(p, 'off-lamha-vsun620', (o) => { o.tiers = [{ minQty: 8, priceMinor: '3000' }]; });
  test('chọn bậc tách khỏi cộng tiền', () => {
    expect(selectTier({ priceMinor: '3200', tiers: [{ minQty: 8, priceMinor: '3000' }, { minQty: 36, priceMinor: '2800' }] }, 7)).toEqual({ priceMinor: '3200', tierMinQty: null });
    expect(selectTier({ priceMinor: '3200', tiers: [{ minQty: 8, priceMinor: '3000' }, { minQty: 36, priceMinor: '2800' }] }, 36)).toEqual({ priceMinor: '2800', tierMinQty: 36 });
    expect(selectTier({ priceMinor: null, tiers: [{ minQty: 8, priceMinor: '3000' }] }, 3).priceMinor).toBeNull();
  });
  test('8 tấm vào bậc rẻ hơn, 6 tấm giá lẻ: chênh không còn bằng 2 × đơn giá lẻ', () => {
    const a = tiered(openLamHa()), b = setQuantity(a, PANEL, 6);
    expect(line(a, 'design:vsun-620@1')).toMatchObject({ totalMinor: '14880000', unitPriceMinor: '3000' });
    expect(line(b, 'design:vsun-620@1')).toMatchObject({ totalMinor: '11904000', unitPriceMinor: '3200' });
    expect(compareQuotes(buildQuote(a), buildQuote(b)).knownDeltaMinor).toBe('-2976000');
  });
  test('giá null và bậc: bậc áp dụng thì có giá dù giá lẻ là null', () => {
    const p = patchOffer(openLamHa(), 'off-lamha-vsun620', (o) => { o.priceMinor = null; o.tiers = [{ minQty: 8, priceMinor: '3000' }]; });
    expect(line(p, 'design:vsun-620@1').status).toBe('known');
    expect(line(setQuantity(p, PANEL, 6), 'design:vsun-620@1')).toMatchObject({ status: 'missing', reason: 'NO_PRICE' });
  });
});

describe('làm tròn và dây', () => {
  test('roundDiv làm tròn nửa lên theo độ lớn', () => {
    expect([roundDiv(1n, 2n), roundDiv(3n, 2n), roundDiv(1n, 3n), roundDiv(-1n, 2n), roundDiv(-3n, 2n)]).toEqual([1n, 2n, 0n, -1n, -2n]);
  });
  test('dây 12,5 m × 18.000 đ/m = 225.000 đ (mm nguyên)', () => {
    const p = addCostLine(openLamHa(), extra({ category: 'cable', label: 'Dây 4 mm²', qty: 12500, qtyUnit: 'mm', unitPriceMinor: '18000' }));
    expect(buildQuote(p).lines.find((l) => l.source === 'extra')).toMatchObject({ totalMinor: '225000', basis: '12,5 m × 18.000 đ/m', priceUnit: 'm' });
  });
  test('số lẻ làm tròn ở từng dòng: 3 mm × 500 đ/m = 1,5 → 2 đ; hai dòng 1 mm cộng 2 đ chứ không 1 đ', () => {
    let p = createProject('x');
    for (let i = 0; i < 2; i++) p = addCostLine(p, extra({ category: 'cable', qty: 1, qtyUnit: 'mm', unitPriceMinor: '500', label: `d${i}` }));
    expect(buildQuote(p).lines.map((l) => l.totalMinor)).toEqual(['1', '1']);
    expect(buildQuote(addCostLine(createProject('y'), extra({ category: 'cable', qty: 3, qtyUnit: 'mm', unitPriceMinor: '500' }))).lines[0].totalMinor).toBe('2');
  });
});

describe('giá 0, null, VAT, giao hàng, giảm giá', () => {
  test('giá 0 là đã có giá; giá null là thiếu và chặn tổng', () => {
    const zero = fullScope(addCostLine(openLamHa(), extra({ category: 'other', label: 'Tặng phụ kiện', unitPriceMinor: '0' })));
    const l0 = buildQuote(zero).lines.find((l) => l.label === 'Tặng phụ kiện')!;
    expect([l0.status, l0.totalMinor]).toEqual(['known', '0']);
    const missing = addCostLine(zero, extra({ category: 'other', label: 'Chưa báo', unitPriceMinor: null }));
    expect(buildQuote(missing)).toMatchObject({ complete: false, totalMinor: null, missing: { lineKeys: [expect.stringMatching(/^extra:/)] } });
  });
  test('VAT đã gồm không cộng thêm; chưa gồm cộng theo từng dòng; chưa rõ chặn tổng', () => {
    const p = fullScope(openLamHa()); // equipment offers: vat unknown
    const q0 = buildQuote(p);
    expect(q0.missing.unknownVatKeys).toEqual(['design:vsun-620@1', 'design:used-battery@1']);
    expect(q0.totalMinor).toBeNull();
    const inc = patchOffer(patchOffer(p, 'off-lamha-vsun620', (o) => { o.vat = 'included'; }), 'off-lamha-used-battery', (o) => { o.vat = 'included'; });
    const known = 31872000n + 4_000_000n;
    expect(buildQuote(inc)).toMatchObject({ complete: true, vatMinor: '0', totalMinor: String(known) });
    const exc = patchOffer(inc, 'off-lamha-vsun620', (o) => { o.vat = 'excluded'; });
    expect(buildQuote(exc)).toMatchObject({ vatMinor: '1587200', totalMinor: String(known + 1587200n) }); // 10% of 15.872.000
    expect(buildQuote(setQuoteSettings(exc, { vatRateBp: 800 })).vatMinor).toBe('1269760');
  });
  test('VAT làm tròn trên từng dòng', () => {
    let p = createProject('x');
    p = addCostLine(p, extra({ category: 'other', label: 'a', unitPriceMinor: '5', vat: 'excluded' })); // 0,5 → 1
    p = addCostLine(p, extra({ category: 'other', label: 'b', unitPriceMinor: '5', vat: 'excluded' }));
    expect(buildQuote(setQuoteSettings(p, { vatRateBp: 1000 })).vatMinor).toBe('2'); // không phải round(10 × 10%) = 1
  });
  test('giao hàng theo offer: 0 là có dòng, null thì không có dòng; mỗi offer một lần', () => {
    const p = patchOffer(openLamHa(), 'off-lamha-vsun620', (o) => { o.shippingMinor = '350000'; });
    const q = buildQuote(p);
    expect(q.lines.filter((l) => l.category === 'shipping')).toHaveLength(1);
    expect(q.shippingMinor).toBe('350000');
    expect(q.knownSubtotalMinor).toBe('32222000');
    const free = buildQuote(patchOffer(p, 'off-lamha-vsun620', (o) => { o.shippingMinor = '0'; }));
    expect(free.lines.find((l) => l.category === 'shipping')?.totalMinor).toBe('0');
    expect(buildQuote(openLamHa()).lines.some((l) => l.category === 'shipping')).toBe(false);
  });
  test('giảm giá trừ khỏi tổng và VAT của dòng giảm cũng âm', () => {
    const p = addCostLine(openLamHa(), extra({ category: 'discount', label: 'Giảm', unitPriceMinor: '500000', vat: 'excluded' }));
    const q = buildQuote(p);
    expect(q.knownSubtotalMinor).toBe('31372000');
    expect(q.vatMinor).toBe('-50000');
  });
  test('không thêm dòng trùng khi xóa dòng bổ sung', () => {
    const a = addCostLine(openLamHa(), extra());
    expect(buildQuote(removeCostLine(a, a.costLines![0].lineId)).lines).toHaveLength(2);
  });
  test('báo giá thiếu: chưa chọn offer, offer sai thiết bị, thiếu công suất cho giá theo W', () => {
    const hestia = findComponent(BUILTIN_COMPONENTS, { modelId: 'hestia-650', revision: 1 })!;
    const none = addInstances(createProject('x'), hestia, 1);
    expect(buildQuote(none).lines[0]).toMatchObject({ status: 'missing', reason: 'NO_OFFER' });
    const noWatt = patchOffer(openLamHa(), 'off-lamha-used-battery', (o) => { o.unit = 'W'; });
    expect(line(noWatt, 'design:used-battery@1')).toMatchObject({ status: 'missing', reason: 'NO_WATTAGE' });
    const wrong = openLamHa();
    wrong.priceSelections[0].offerId = 'off-lamha-used-battery';
    expect(line(wrong, 'design:vsun-620@1').reason).toBe('OFFER_MISMATCH');
  });
});

describe('kit', () => {
  const kit = (over: Partial<Kit> = {}): Kit => ({ kitId: 'kit-1', label: 'Kit 8 tấm', count: 1, parts: [{ componentRef: PANEL, qty: 8 }], priceMinor: '15000000',
    vat: 'included', seller: 'Kho', recordedAt: null, covers: [], ...over });
  const withKit = (k: Kit) => ({ ...openLamHa(), kits: [k] });

  test('giá gói thay giá con, thiết bị vẫn được đếm', () => {
    const q = buildQuote(withKit(kit()));
    expect(q.deviceCounts['vsun-620@1']).toBe(8);
    expect(q.lines.find((l) => l.key === 'design:vsun-620@1:kit')).toMatchObject({ status: 'included-in-kit', totalMinor: '0', qty: 8, kitId: 'kit-1' });
    expect(q.lines.find((l) => l.key === 'kit:kit-1')).toMatchObject({ totalMinor: '15000000', status: 'known' });
    expect(q.knownSubtotalMinor).toBe('31000000'); // 15.000.000 kit + 16.000.000 pin cũ
    expect(q.missing.lineKeys).toEqual([]);
  });
  test('kit chỉ phủ một phần số tấm: phần còn lại tính giá lẻ', () => {
    const q = buildQuote(withKit(kit({ parts: [{ componentRef: PANEL, qty: 6 }], priceMinor: '11000000' })));
    expect(q.lines.find((l) => l.key === 'design:vsun-620@1')).toMatchObject({ qty: 2, totalMinor: '3968000' });
    expect(q.knownSubtotalMinor).toBe(String(11000000 + 3968000 + 16000000));
  });
  test('kit chưa đủ phụ kiện: phạm vi chưa phủ vẫn chặn tổng, covers thì được phủ', () => {
    expect(buildQuote(withKit(kit())).missing.scope).toEqual(['frame', 'cable', 'protection', 'labor']);
    const q = buildQuote(withKit(kit({ covers: ['frame', 'cable'] })));
    expect(q.missing.scope).toEqual(['protection', 'labor']);
    expect(q.complete).toBe(false);
  });
  test('kit chưa có giá là dòng thiếu và không phủ phạm vi', () => {
    const q = buildQuote(withKit(kit({ priceMinor: null, covers: ['frame'] })));
    expect(q.missing.lineKeys).toEqual(['kit:kit-1']);
    expect(q.missing.scope).toContain('frame');
  });
  test('kit có nhiều tấm hơn thiết kế → cảnh báo; nhiều kit nhân theo count', () => {
    const q = buildQuote(withKit(kit({ parts: [{ componentRef: PANEL, qty: 10 }] })));
    expect(q.issues).toMatchObject([{ code: 'KIT_PART_NOT_IN_DESIGN', severity: 'warning', field: '/kits/0/parts/0' }]);
    const two = buildQuote(withKit(kit({ count: 2, parts: [{ componentRef: PANEL, qty: 4 }], priceMinor: '7000000' })));
    expect(two.lines.find((l) => l.key === 'kit:kit-1')).toMatchObject({ qty: 2, totalMinor: '14000000' });
    expect(two.lines.find((l) => l.key === 'design:vsun-620@1:kit')?.qty).toBe(8);
  });
});

describe('tổng hoàn chỉnh và phạm vi', () => {
  test('đủ giá, đủ phạm vi, VAT rõ → có tổng; bỏ qua hạng mục bằng waived', () => {
    let p = openLamHa();
    // snapshot offers are immutable by ID, so a changed quote is a new offer
    p = selectOffer(selectOffer(p, { ...structuredClone(p.snapshots.offers[0]), offerId: 'off-new-1', vat: 'included' }), { ...structuredClone(p.snapshots.offers[1]), offerId: 'off-new-2', vat: 'included' });
    p = ['frame', 'cable', 'protection'].reduce((q, c) => addCostLine(q, extra({ category: c as never, label: c, unitPriceMinor: '1000000' })), p);
    expect(buildQuote(p).missing.scope).toEqual(['labor']);
    const done = setQuoteSettings(p, { waived: ['labor'] });
    expect(buildQuote(done)).toMatchObject({ complete: true, totalMinor: '34872000' });
  });
  test('A/B khác phạm vi không công bố chênh toàn hệ', () => {
    const a = openLamHa(), b = addCostLine(a, extra({ category: 'cable', label: 'Dây', unitPriceMinor: '225000' }));
    const cmp = compareQuotes(buildQuote(a), buildQuote(b));
    expect(cmp).toMatchObject({ knownDeltaMinor: null, knownDeltaReason: 'SCOPE_DIFFERS' });
    expect(cmp.rows.find((r) => r.label === 'Dây')?.deltaMinor).toBe('225000');
  });
  test('A/B cùng đủ giá thì có chênh tổng', () => {
    const mk = (n: number) => { let p = fullScope(openLamHa()); p = patchOffer(patchOffer(p, 'off-lamha-vsun620', (o) => { o.vat = 'included'; }), 'off-lamha-used-battery', (o) => { o.vat = 'included'; }); return setQuantity(p, PANEL, n); };
    const cmp = compareQuotes(buildQuote(mk(8)), buildQuote(mk(6)));
    expect(cmp).toMatchObject({ totalDeltaMinor: '-3968000', knownDeltaMinor: '-3968000' });
    expect(cmp.totalDeltaReason).toBeUndefined();
  });
});

describe('schema và CSV', () => {
  test('project có costLines/kits/quote hợp lệ; id trùng và loại sai bị chặn', () => {
    const p = { ...fullScope(openLamHa()), kits: [{ kitId: 'k', label: 'K', count: 1, parts: [{ componentRef: PANEL, qty: 1 }], priceMinor: null, vat: 'unknown', seller: null, recordedAt: null, covers: ['frame'] }] } as Project;
    expect(hasErrors(validateProject(p))).toBe(false);
    const dup = structuredClone(p); dup.costLines![1].lineId = dup.costLines![0].lineId;
    expect(validateProject(dup)[0]).toMatchObject({ code: 'DUPLICATE_ID', field: '/costLines/1' });
    const bad = structuredClone(p); (bad.costLines![0] as { category: string }).category = 'nope';
    expect(validateProject(bad)[0].code).toBe('SCHEMA');
  });
  test('project W01 (không có trường mới) vẫn hợp lệ', () => {
    expect(hasErrors(validateProject(openLamHa()))).toBe(false);
  });
  test('CSV: BOM UTF-8, tiêu đề, số nguyên, không công thức, ghi rõ khi chưa đủ', () => {
    const p = addCostLine(openLamHa(), extra({ category: 'cable', label: '=HYPERLINK("x")', qty: 12500, qtyUnit: 'mm', unitPriceMinor: '18000', seller: 'A, B', note: 'dòng "1"\nhai' }));
    const csv = quoteToCsv(buildQuote(p), 'Lâm Hà');
    expect(csv.startsWith('﻿Dự toán: Lâm Hà\r\nNhóm,Mô tả,Số lượng,Đơn vị,Đơn giá (đ)')).toBe(true);
    expect(csv).toContain("Thiết bị,VSUN 620 W N-type TOPCon bifacial,8,chiếc,3200,W,8 × 620 W × 3.200 đ/W,15872000,đã có giá,chưa rõ VAT,Kho (báo giá dự án),,\"3.200 đ/W; mua lẻ tại kho. Một tấm 620 W = 1.984.000 đ\"");
    expect(csv).toContain('225000');
    expect(csv).toContain('"A, B"');
    expect(csv).toContain('"dòng ""1""\nhai"');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toMatch(/Tổng hoàn chỉnh,*\r\n/);
    expect(csv).toContain('Chưa đủ để báo tổng: thiếu hạng mục Khung, Bảo vệ, Công lắp');
  });
});

describe('sau review W09: tải không phải hàng phải mua', () => {
  test('tải sinh hoạt và bơm không thành dòng dự toán "thiếu giá", nên không chặn tổng hoàn chỉnh; vẫn được đếm trong thiết bị của dự án', () => {
    const load = (id: string) => findComponent(BUILTIN_COMPONENTS, { modelId: id, revision: 1 })!;
    // 8 tấm + pin cũ, mọi báo giá đã rõ VAT, không đòi hạng mục bắt buộc: tổng hoàn chỉnh có
    const priced: Project = { ...openLamHa(), quote: { vatRateBp: 1000, requiredCategories: [], waived: [] }, snapshots: { ...openLamHa().snapshots, offers: openLamHa().snapshots.offers.map((o) => ({ ...o, vat: 'included' as const })) } };
    const withLoads = addInstances(addInstances(priced, load('sample-home-load'), 1, []), load('sample-pump-load'), 1, []);
    const q = buildQuote(withLoads);
    expect(q.lines.filter((l) => /tải mẫu/.test(l.label))).toEqual([]);
    expect([q.complete, q.totalMinor]).toEqual([true, '31872000']);
    expect(q.deviceCounts['sample-home-load@1']).toBe(1);
  });
});
