import { describe, expect, test } from 'vitest';
import { BUILTIN_OFFERS, offersFor } from '../../src/catalog/catalog';
import { buildQuote } from '../../src/cost/quote';
import { buildLamHaConfig } from '../../src/domain/presets';
import { openLamHa } from '../../src/domain/project';
import type { Project } from '../../src/domain/types';
import { compilePv } from '../../src/engine/compile';
import { simulatePv } from '../../src/engine/pv';
import { compileSim } from '../../src/engine/sim-compile';
import { simulateSystem } from '../../src/engine/system';
import { validateDesign } from '../../src/validation/strings';
import { catalog } from './helpers';
import { wx } from './pv-helpers';

/**
 * Hand-solved fixtures. Every expected number below is worked out on paper from datasheet values (arithmetic in the comments),
 * NOT read from the engine. The author of the engine wrote these, so they check arithmetic and wiring, not independent judgement:
 * an electrical engineer's own pass over the datasheets is still required (docs/uat/engineer-crosscheck.md).
 */
const parts = () => ({ inverter: catalog('luxpower-sna6000wpv'), battery: catalog('used-battery'), home: catalog('sample-home-load'), pump: catalog('sample-pump-load'), controller: catalog('sample-pump-controller') });
const offers = (c: ReturnType<typeof catalog>) => offersFor(BUILTIN_OFFERS, c);
const config = (extra: Partial<Project> = {}) => ({ ...buildLamHaConfig(openLamHa(), 'shared8', parts(), offers), design: { coldCellTempC: 5, hotCellTempC: 70 }, pv: { tiltDeg: 10, azimuthDeg: 180, cellModel: 'fixed', fixedCellTempC: 45 }, ...extra }) as Project;

describe('fixture giải tay từ datasheet', () => {
  test('H1 · chuỗi 4 × VSUN 620 trên MPPT của SNA6000: Voc lạnh và Voc nóng', () => {
    // Voc(T) = 4 × 48,7 × (1 + (−0,0024) × (T − 25))
    // lạnh 5 °C : 194,8 × (1 + 0,048)   = 194,8 × 1,048 = 204,1504 V   (≤ 480 V tuyệt đối)
    // nóng 70 °C: 194,8 × (1 − 0,108)   = 194,8 × 0,892 = 173,7616 V   (≥ 100 V khởi động)
    const f = validateDesign(config());
    const cold = f.find((x) => x.code === 'VOC_COLD_ABS' && x.status === 'pass')!, hot = f.find((x) => x.code === 'START_VOLTAGE')!;
    expect(cold.value).toBeCloseTo(204.1504, 4); expect(cold.limit).toBe(480);
    expect(hot.value).toBeCloseTo(173.7616, 4); expect(hot.limit).toBe(100);
    expect(hot.status).toBe('pass');
  });
  test('H2 · dòng chuỗi: Isc 15,95 A so với giới hạn cổng 25 A, Imp 15,04 A so với 17 A', () => {
    const f = validateDesign(config());
    const isc = f.find((x) => x.code === 'ISC_TRACKER')!, imp = f.find((x) => x.code === 'IMP_TRACKER')!;
    expect([isc.value, isc.limit, isc.status]).toEqual([15.95, 25, 'pass']);
    expect([imp.value, imp.limit, imp.status]).toEqual([15.04, 17, 'pass']);
  });
  test('H3 · một giờ PV: POA 500 W/m², cell cố định 45 °C, 8 tấm', async () => {
    // P_tấm = 620 × (500 / 1000) × (1 + (−0,0029) × (45 − 25)) = 310 × 0,942 = 292,02 W
    // 8 tấm: 292,02 × 8 = 2336,16 W; một giờ = 2336,16 Wh (chưa tính tổn hao DC: lossRatio = 0)
    const w = wx({ n: 1, poa: [500], tempAirC: [25], windMs: [1] });
    const c = compilePv(config({ pv: { tiltDeg: 10, azimuthDeg: 180, cellModel: 'fixed', fixedCellTempC: 45, lossRatio: 0, irradianceInput: 'poa' } }), w);
    expect(c.issues).toEqual([]);
    const r = (await simulatePv(c.input!, 'h3'))!;
    expect(r.totals.eIdealWh).toBeCloseTo(2336.16, 2);
    expect(r.series.pIdealW[0]).toBeCloseTo(2336.16, 2);
  });
  test('H4 · pin 51,2 V × 165 Ah: năng lượng danh định, năng lượng dùng được trên mức dự phòng 20 %, giới hạn công suất xả', async () => {
    // 51,2 × 165 = 8448 Wh; dùng được trên dự phòng: 8448 × (1 − 0,20) = 6758,4 Wh
    // công suất xả tối đa của pin: 100 A × 51,2 V = 5120 W; qua inverter 93 %: 5120 × 0,93 = 4761,6 W AC (≈ 4,76 kW như mục 2 của tài liệu)
    const c = await compileSim(config({ sim: { minSoc: 0.2 } }), wx({ n: 24, poa: Array(24).fill(0), tempAirC: Array(24).fill(25), windMs: Array(24).fill(1) }));
    const b = c.input!.spec.bank!;
    expect(b.nominalWh).toBe(8448);
    expect(b.nominalWh * (b.socMax - b.socMin)).toBeCloseTo(6758.4, 6);
    expect(b.maxDischargeW).toBeCloseTo(5120, 6);
    expect(b.maxDischargeW! * c.input!.spec.inverter.efficiency).toBeCloseTo(4761.6, 6);
  });
  test('H5 · đêm không nắng, nhà 300 W cả ngày + bơm 750 W lúc 18h, pin đầy: pin cạn tới dự phòng, phần còn lại ghi là điện thiếu', async () => {
    // tải AC cả ngày: 300 × 24 = 7200 Wh, cộng bơm 750 × 1 h = 750 Wh → 7950 Wh AC
    const p = config({ sim: { minSoc: 0.2, soc0: 1 } });
    const c = await compileSim(p, wx({ n: 24, t0: Date.UTC(2023, 11, 21, 17) / 1000, poa: Array(24).fill(0), tempAirC: Array(24).fill(25), windMs: Array(24).fill(1) }));
    const o = (await simulateSystem(c.input!, c.hash!))!;
    if (!o.ok) throw new Error('sim');
    const t = o.result.dispatch.totals;
    // Pin chỉ được xả tới dự phòng 20 %: 8448 × 0,8 = 6758,4 Wh phía pin; xả có hiệu suất 0,95 → tại bus 6758,4 × 0,95 = 6420,48 Wh
    // qua inverter: 6420,48 × 0,93 = 5971,0464 Wh AC được cấp; phần còn lại 7950 − 5971,0464 = 1978,9536 Wh là điện thiếu
    // năng lượng còn lại trong pin = 8448 × 0,2 = 1689,6 Wh; tổn hao xả = 6758,4 − 6420,48 = 337,92 Wh; tổn hao inverter = 6420,48 − 5971,0464 = 449,4336 Wh
    expect(t.dischargeBusWh).toBeCloseTo(6420.48, 6);
    expect(t.loadServedWh).toBeCloseTo(5971.0464, 6);
    expect(t.unservedWh).toBeCloseTo(1978.9536, 6);
    expect(t.eEndWh).toBeCloseTo(1689.6, 6);
    expect(t.dischargeLossWh).toBeCloseTo(337.92, 6);
    expect(t.inverterLossWh).toBeCloseTo(449.4336, 6);
    expect(t.loadRequestedWh).toBeCloseTo(7950, 6);
    expect(o.result.dispatch.ledger.toleranceOk).toBe(true);
  });
  test('H6 · tiền: 8 tấm × 620 W × 3.200 đ/W = 15.872.000 đ; + pin 16.000.000 = 31.872.000 đ; dây 12,5 m × 18.000 đ/m = 225.000 đ', () => {
    expect(8 * 620 * 3200).toBe(15_872_000);
    expect(15_872_000 + 16_000_000).toBe(31_872_000);
    expect(buildQuote(openLamHa()).knownSubtotalMinor).toBe('31872000');
    expect((12_500 * 18_000) / 1000).toBe(225_000); // mm × (đ/m) / 1000
  });
});
