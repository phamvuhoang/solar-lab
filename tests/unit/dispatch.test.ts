import { describe, expect, test } from 'vitest';
import { LedgerError, REASONS, reasonsOf, simulateDispatch } from '../../src/engine/dispatch';
import { operatingPoint } from '../../src/engine/pump';
import { at, bank, flat, inverter, load, mk } from './dispatch-helpers';

const run = async (i: ReturnType<typeof mk>) => (await simulateDispatch(i, 'h'))!;
const has = (r: Awaited<ReturnType<typeof run>>, step: number, code: (typeof REASONS)[number]) => reasonsOf(r.series.reasons[step]).includes(code);

describe('hai ví dụ xác định (docs/02)', () => {
  test('ví dụ 1: 2.000 Wh PV tại bus, tải AC 900 Wh, inverter 90 %, sạc 95 % → cấp 1.000 Wh, sạc 1.000 Wh, +950 Wh trong pin, tổn hao 150 Wh', async () => {
    const r = await run(mk({ pvBusW: [2000] }));
    expect(r.series.loadServedWh[0]).toBeCloseTo(900, 9);
    expect(r.series.chargeBusWh[0]).toBeCloseTo(1000, 9);
    expect(r.totals.storedDeltaWh).toBeCloseTo(950, 9);
    expect(r.series.inverterLossWh[0] + r.series.chargeLossWh[0]).toBeCloseTo(150, 9);
    expect(r.series.inverterLossWh[0]).toBeCloseTo(100, 9);
    expect(r.series.curtailedWh[0]).toBe(0);
    expect(Math.abs(r.series.residualWh[0])).toBeLessThan(1e-9);
    expect(reasonsOf(r.series.reasons[0])).toEqual(expect.arrayContaining(['PV_TO_LOAD', 'BATTERY_CHARGE']));
  });
  test('ví dụ 2: ban đêm, 1.000 Wh trên mức dự phòng, ηxả 95 %, ηinv 90 % → tối đa 855 Wh tới tải; dự phòng không cấp thêm', async () => {
    const r = await run(mk({ pvBusW: [0, 0], loads: [load({ powerW: 2000 })], policy: { soc0: 0.3 } })); // E = 3.000, dự phòng 2.000
    expect(r.series.loadServedWh[0]).toBeCloseTo(855, 9);
    expect(r.series.unservedWh[0]).toBeCloseTo(1145, 9);
    expect(r.series.eEndWh[0]).toBeCloseTo(2000, 9); // chạm dự phòng
    expect(has(r, 0, 'RESERVE_REACHED') && has(r, 0, 'UNSERVED_LOAD') && has(r, 0, 'BATTERY_DISCHARGE')).toBe(true);
    expect(r.series.dischargeBusWh[1]).toBe(0); // bước sau: dự phòng không cấp thêm
    expect(r.series.loadServedWh[1]).toBe(0);
    expect(r.metrics.firstReserveAt).toBe(r.series.t[0]);
    expect(r.metrics.minSoc).toBeCloseTo(0.2, 9);
  });
});

describe('pin đầy, giới hạn dòng, quá tải inverter', () => {
  test('pin đầy: không sạc thêm, phần dư bị cắt khi lưới cấm xuất', async () => {
    const r = await run(mk({ pvBusW: [2000], policy: { soc0: 1 } }));
    expect(r.series.chargeBusWh[0]).toBe(0);
    expect(r.series.eEndWh[0]).toBe(10000);
    expect(r.series.curtailedWh[0]).toBeCloseTo(1000, 9);
    expect(reasonsOf(r.series.reasons[0])).toEqual(expect.arrayContaining(['BATTERY_FULL', 'CURTAILED_PV', 'EXPORT_FORBIDDEN']));
  });
  test('giới hạn dòng sạc: BMS thấp hơn → CHARGE_LIMIT_BMS; inverter thấp hơn → CHARGE_LIMIT_INVERTER', async () => {
    const a = await run(mk({ pvBusW: [3000], bank: bank({ maxChargeW: 500 }), inverter: inverter({ maxChargeW: 800 }) }));
    expect(a.series.chargeBusWh[0]).toBeCloseTo(500, 9);
    expect(has(a, 0, 'CHARGE_LIMIT_BMS')).toBe(true);
    const b = await run(mk({ pvBusW: [3000], bank: bank({ maxChargeW: 500 }), inverter: inverter({ maxChargeW: 300 }) }));
    expect(b.series.chargeBusWh[0]).toBeCloseTo(300, 9);
    expect(has(b, 0, 'CHARGE_LIMIT_INVERTER') && !has(b, 0, 'CHARGE_LIMIT_BMS')).toBe(true);
  });
  test('giới hạn dòng xả: pin còn nhiều năng lượng nhưng chỉ ra 1.000 W', async () => {
    const r = await run(mk({ pvBusW: [0], loads: [load({ powerW: 2000 })], inverter: inverter({ maxDischargeW: 1000 }) }));
    expect(r.series.dischargeBusWh[0]).toBeCloseTo(1000, 9);
    expect(r.series.loadServedWh[0]).toBeCloseTo(900, 9);
    expect(has(r, 0, 'DISCHARGE_LIMIT_INVERTER')).toBe(true);
    expect(has(r, 0, 'RESERVE_REACHED')).toBe(false);
  });
  test('phụ tải vượt công suất AC liên tục: cắt ở 6.000 Wh và ghi INVERTER_AC_LIMIT', async () => {
    const r = await run(mk({ pvBusW: [20000], loads: [load({ powerW: 7000 })] }));
    expect(r.series.loadServedWh[0]).toBeCloseTo(6000, 9);
    expect(r.series.unservedWh[0]).toBeCloseTo(1000, 9);
    expect(has(r, 0, 'INVERTER_AC_LIMIT')).toBe(true);
  });
  test('SoC đầu thấp (dưới dự phòng): không xả, không phải lỗi; sạc khi có nắng', async () => {
    const r = await run(mk({ pvBusW: [0, 2000], policy: { soc0: 0.1 } }));
    expect(r.series.dischargeBusWh[0]).toBe(0);
    expect(r.series.chargeBusWh[1]).toBeGreaterThan(0);
  });
  test('không có pin: PV cấp tải, phần dư bị cắt, ban đêm thiếu', async () => {
    const r = await run(mk({ pvBusW: [2000, 0], bank: null }));
    expect(has(r, 0, 'NO_BATTERY') && has(r, 0, 'CURTAILED_PV')).toBe(true);
    expect(r.series.unservedWh[1]).toBeCloseTo(900, 9);
    expect(r.metrics.socEnd).toBeNull();
  });
});

describe('ưu tiên tải, lưới, mất lưới', () => {
  test('hai tải: tải ưu tiên 1 được cấp đủ trước', async () => {
    const r = await run(mk({ pvBusW: [1200], bank: null, loads: [load({ id: 'A', powerW: 1000, priority: 2 }), load({ id: 'B', powerW: 1000, priority: 1 })] }));
    const by = Object.fromEntries(r.loads.map((l) => [l.id, l]));
    expect(by.B.servedWh).toBeCloseTo(1000, 9);
    expect(by.A.servedWh).toBeCloseTo(80, 9);
    expect(by.A.unservedWh).toBeCloseTo(920, 9);
  });
  test('độc lập: nhập và xuất lưới bằng 0; có lưới cho nhập: phần thiếu lấy từ lưới', async () => {
    const off = await run(mk({ pvBusW: [0], policy: { soc0: 0.2 } }));
    expect([off.totals.gridImportWh, off.totals.exportWh]).toEqual([0, 0]);
    expect(off.totals.unservedWh).toBeCloseTo(900, 9);
    const on = await run(mk({ pvBusW: [0], policy: { soc0: 0.2, gridAvailable: true, importAllowed: true } }));
    expect(on.totals).toMatchObject({ gridImportWh: 900, unservedWh: 0 });
    expect(has(on, 0, 'GRID_IMPORT')).toBe(true);
  });
  test('cấm nhập: lưới có nhưng không dùng; mất lưới theo giờ: thiếu và ghi GRID_OUTAGE', async () => {
    const ban = await run(mk({ pvBusW: [0], policy: { soc0: 0.2, gridAvailable: true, importAllowed: false } }));
    expect(ban.totals.gridImportWh).toBe(0);
    const out = await run(mk({ pvBusW: [0, 0], policy: { soc0: 0.2, gridAvailable: true, importAllowed: true, outageLocalHours: [0] } }));
    expect(out.series.gridImportWh).toEqual([0, 900]);
    expect(has(out, 0, 'GRID_OUTAGE') && has(out, 0, 'UNSERVED_LOAD')).toBe(true);
  });
  test('cho xuất: phần PV dư sau khi pin đầy được xuất (qua inverter 90 %)', async () => {
    const r = await run(mk({ pvBusW: [2000], policy: { soc0: 1, gridAvailable: true, exportAllowed: true } }));
    expect(r.series.exportWh[0]).toBeCloseTo(1000 * 0.9, 9);
    expect(r.series.curtailedWh[0]).toBe(0);
    expect(has(r, 0, 'EXPORT')).toBe(true);
  });
  test('tự tiêu thụ ban đêm: 20 W × 10 giờ lấy từ pin, chia cho ηxả', async () => {
    const r = await run(mk({ pvBusW: Array(10).fill(0), loads: [], policy: { standbyW: 20 } }));
    expect(r.totals.standbyWh).toBeCloseTo(200, 9);
    expect(r.totals.eEndWh).toBeCloseTo(5000 - 200 / 0.95, 9);
    expect(r.totals.dischargeLossWh).toBeCloseTo(200 / 0.95 - 200, 9);
    expect(has(r, 0, 'STANDBY')).toBe(true);
  });
});

describe('khởi động động cơ và bơm', () => {
  const pump = (o = {}) => load({ id: 'P', powerW: 750, startupW: 2250, fractions: [...at(11, 1), ].map((v, h) => (h === 11 || h === 12 ? 1 : 0)), ...o });
  const day = (o: Parameters<typeof mk>[0] extends infer T ? Partial<T> : never) => mk({ pvBusW: Array(14).fill(5000), loads: [pump()], ...o });
  test('đủ công suất đỉnh: một lần khởi động cho một đợt chạy 2 giờ liên tiếp', async () => {
    const r = await run(day({}));
    expect(r.startCheckCount).toBe(1);
    expect(r.startChecks[0]).toMatchObject({ loadId: 'P', step: 11, requiredW: 2250, availableW: 12000, ok: true });
    expect(r.loads[0]).toMatchObject({ starts: 1, startsBlocked: 0, unservedWh: 0 });
  });
  test('inverter không đủ công suất đỉnh: khởi động bị chặn, bơm không chạy đợt đó', async () => {
    const r = await run(day({ inverter: inverter({ surgeW: 1500 }) }));
    expect(r.loads[0]).toMatchObject({ startsBlocked: 1, servedWh: 750 /* giờ 12 */ + 0 - 0 });
    expect(has(r, 11, 'START_BLOCKED') && has(r, 11, 'UNSERVED_LOAD')).toBe(true);
    expect(r.series.loadServedWh[11]).toBe(0);
  });
  test('có lưới thì lưới cấp bơm bị chặn; không rõ công suất đỉnh thì không kiểm và nói rõ', async () => {
    const grid = await run(day({ inverter: inverter({ surgeW: 1500 }), policy: { gridAvailable: true, importAllowed: true } }));
    expect(grid.loads[0].gridWh).toBe(750);
    const unk = await run(day({ inverter: inverter({ surgeW: null }) }));
    expect(unk.startChecks[0].ok).toBeNull();
    expect(unk.skipped.join()).toContain('công suất đỉnh khởi động');
  });
  test('đường cong Q–H: điểm làm việc 4,6214 m³/h; thể tích tích phân theo phần được cấp; thiếu đường cong thì ghi thiếu', async () => {
    const curve = { qM3h: [0, 2, 4, 6], headM: [30, 26, 18, 6] };
    // 0,2q² + 6q − 32 = 0 trên đoạn tuyến tính H = 42 − 6q → q = (−6 + √61,6)/0,4
    const q = (-6 + Math.sqrt(61.6)) / 0.4;
    expect(operatingPoint(curve, 10, 0.2)).toMatchObject({ ok: true, qM3h: expect.closeTo(q, 8) });
    expect(operatingPoint(null, 10, 0.2)).toMatchObject({ ok: false, reason: 'NO_CURVE' });
    expect(operatingPoint(curve, null, 0)).toMatchObject({ ok: false, reason: 'NO_STATIC_HEAD' });
    expect(operatingPoint({ qM3h: [0, 5], headM: [5, 1] }, 10, 0)).toMatchObject({ ok: false, reason: 'CANNOT_LIFT' });
    const full = await run(day({ loads: [pump({ pump: { staticHeadM: 10, frictionK: 0.2, curve } })] }));
    expect(full.loads[0].volumeM3).toBeCloseTo(2 * q, 6); // 2 giờ
    const none = await run(day({ loads: [pump({ pump: { staticHeadM: 10, frictionK: 0.2, curve: null } })] }));
    expect(none.loads[0]).toMatchObject({ volumeM3: null, volumeNote: 'Thiếu đường cong Q–H của bơm' });
  });
  test('nhánh bơm DC độc lập: cấp theo PV nhánh, dư bị cắt, ledger riêng gộp vào tổng', async () => {
    const dc = load({ id: 'D', feed: 'controller', powerW: 750, fractions: flat(1), pump: { staticHeadM: 10, frictionK: 0.2, curve: { qM3h: [0, 2, 4, 6], headM: [30, 26, 18, 6] } } });
    const r = await run(mk({ pvBusW: [0], loads: [dc], bank: null, branch: { pvPotentialW: [700], pvW: [600] } }));
    expect(r.series.branchServedWh[0]).toBe(600);
    expect(r.series.branchCurtailedWh[0]).toBeCloseTo(100, 9);
    expect(r.loads[0]).toMatchObject({ servedWh: 600, unservedWh: 150 });
    expect(r.loads[0].volumeM3).toBeCloseTo(((-6 + Math.sqrt(61.6)) / 0.4) * 0.8, 6);
    expect(has(r, 0, 'PUMP_BRANCH_CURTAILED') && has(r, 0, 'UNSERVED_LOAD')).toBe(true);
    const idle = await run(mk({ pvBusW: [0], loads: [], bank: null, branch: { pvPotentialW: [700], pvW: [700] } }));
    expect(idle.series.branchCurtailedWh[0]).toBe(700);
  });
});

describe('dời giờ bơm về trưa giảm Wh xả (fixture xác định)', () => {
  // PV bus: nửa sin 06h–18h đỉnh 3.000 W; nhà 200 W cả ngày; bơm 750 W một giờ
  const pv = Array.from({ length: 24 }, (_, h) => Math.max(0, 3000 * Math.sin((Math.PI * (h - 6)) / 12)));
  const scenario = (pumpHour: number, nominalWh: number) => mk({ pvBusW: pv, bank: bank({ nominalWh }), policy: { soc0: 0.8 }, // đủ nuôi nhà tới sáng: fixture chỉ đo tác động của giờ bơm
    loads: [load({ id: 'home', powerW: 200, priority: 1 }), load({ id: 'pump', powerW: 750, startupW: 2250, priority: 2, fractions: at(pumpHour) })] });
  test('pin đủ chứa đêm: bơm lúc 11h được PV cấp trực tiếp, bơm lúc 18h do pin gánh → xả nhiều hơn đúng 750/0,9 Wh', async () => {
    const noon = await run(scenario(11, 5000)), eve = await run(scenario(18, 5000));
    expect(noon.totals.unservedWh).toBeCloseTo(0, 6);
    expect(eve.totals.unservedWh).toBeCloseTo(0, 6);
    expect(noon.totals.loadServedWh).toBeCloseTo(eve.totals.loadServedWh, 6);
    expect(eve.totals.dischargeBusWh - noon.totals.dischargeBusWh).toBeCloseTo(750 / 0.9, 6);
    expect(eve.metrics.socEnd!).toBeLessThan(noon.metrics.socEnd!); // cuối ngày pin còn ít hơn đúng phần chênh
    expect(noon.metrics.socEnd! - eve.metrics.socEnd!).toBeCloseTo(750 / 0.9 / 0.95 / 5000, 9);
  });
  test('pin quá nhỏ (2 kWh): bơm lúc 18h làm thiếu điện đêm nhiều hơn bơm lúc 11h', async () => {
    const noon = await run(scenario(11, 2000)), eve = await run(scenario(18, 2000));
    expect(eve.totals.unservedWh).toBeGreaterThan(noon.totals.unservedWh);
    expect(eve.metrics.hoursShort).toBeGreaterThanOrEqual(noon.metrics.hoursShort);
  });
});

describe('ledger', () => {
  test('property: 300 ca ngẫu nhiên có seed, cân bằng từng bước và các bất biến vật lý', async () => {
    let seed = 12345;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
    for (let trial = 0; trial < 300; trial++) {
      const n = 48, pvBus = Array.from({ length: n }, () => (rnd() < 0.4 ? 0 : rnd() * 6000));
      const pot = pvBus.map((x) => x * (1 + rnd() * 0.3));
      const cap = pick([null, 1000, 5000, 20000]);
      const b = cap === null ? null : bank({ nominalWh: cap, sohRatio: 0.7 + rnd() * 0.3, socMin: pick([0, 0.1, 0.3]), maxChargeW: pick([null, 300, 2000]), maxDischargeW: pick([null, 500, 3000]) });
      const loads = Array.from({ length: Math.floor(rnd() * 3) }, (_, k) => load({ id: `L${k}`, powerW: 100 + rnd() * 3000, startupW: pick([null, 5000]), priority: 1 + Math.floor(rnd() * 3), fractions: Array.from({ length: 24 }, () => pick([0, 0.5, 1])) }));
      const inv = inverter({ efficiency: 0.8 + rnd() * 0.19, acRatedW: pick([2000, 6000]), surgeW: pick([null, 3000, 12000]), maxChargeW: pick([null, 1000]) });
      const pol = { soc0: rnd(), etaCharge: 0.85 + rnd() * 0.14, etaDischarge: 0.85 + rnd() * 0.14, standbyW: pick([0, 15]), gridAvailable: rnd() < 0.5, importAllowed: rnd() < 0.5, exportAllowed: rnd() < 0.5, outageLocalHours: pick([[], [3, 4, 5]]), minSoc: 0.2 };
      const r = await simulateDispatch(mk({ pvBusW: pvBus, potentialW: pot, bank: b, loads, inverter: inv, policy: pol }), 'p');
      expect(r, `trial ${trial}`).not.toBeNull();
      const s = r!.series;
      for (let i = 0; i < n; i++) {
        expect(Math.abs(s.residualWh[i]), `t${trial}/${i}`).toBeLessThanOrEqual(Math.max(0.01, 1e-6 * 20000));
        expect(s.chargeBusWh[i] > 1e-9 && s.dischargeBusWh[i] > 1e-9, 'sạc và xả cùng bước').toBe(false);
        expect(s.unservedWh[i]).toBeGreaterThanOrEqual(-1e-9);
        expect(s.loadServedWh[i]).toBeLessThanOrEqual(s.loadRequestedWh[i] + 1e-6);
        if (b) { const cp = b.nominalWh * b.sohRatio; expect(s.eEndWh[i]).toBeLessThanOrEqual(Math.max(b.socMax * cp, pol.soc0 * cp) + 1e-6); }
        if (!pol.gridAvailable) expect(s.gridImportWh[i] + s.exportWh[i]).toBe(0);
        if (b && s.dischargeBusWh[i] > 1e-9) expect(s.eEndWh[i]).toBeGreaterThanOrEqual(Math.min(b.socMin * b.nominalWh * b.sohRatio, pol.soc0 * b.nominalWh * b.sohRatio) - 1e-6);
      }
    }
  }, 60000);
  test('ledger sai thì engine dừng với LedgerError, không trả kết quả (kiểm hàm báo lỗi)', () => {
    const e = new LedgerError(3, 12.5);
    expect(e.message).toContain('step 3');
    expect(e.residualWh).toBe(12.5);
  });
  test('đổi bước 1 giờ → 15 phút với nắng và tải không đổi cho cùng Wh', async () => {
    const hourly = await run(mk({ pvBusW: Array(4).fill(2000) }));
    const quarter = await run(mk({ pvBusW: Array(16).fill(2000), stepSeconds: 900 }));
    for (const k of ['loadServedWh', 'chargeBusWh', 'inverterLossWh', 'chargeLossWh', 'eEndWh'] as const) expect(quarter.totals[k as 'eEndWh'] ?? 0).toBeCloseTo(hourly.totals[k as 'eEndWh'] ?? 0, 6);
    expect(quarter.totals.eEndWh).toBeCloseTo(5000 + 4 * 950, 6);
  });
});

describe('chạy cả năm, hủy, chỉ số', () => {
  const year = (start: number, n: number) => mk({ t0: start, pvBusW: Array.from({ length: n }, (_, i) => { const h = i % 24; return Math.max(0, 3500 * Math.sin((Math.PI * (h - 6)) / 12)); }),
    bank: bank({ nominalWh: 5120 }), loads: [load({ powerW: 400 }), load({ id: 'pump', powerW: 750, startupW: 2250, fractions: at(18) })] });
  test('8.760 giờ (2023) và 8.784 giờ (2024 nhuận): ledger cân từng bước', async () => {
    for (const [start, n] of [[Date.UTC(2023, 0, 1) / 1000, 8760], [Date.UTC(2024, 0, 1) / 1000, 8784]] as const) {
      const t0 = performance.now();
      const r = await run(year(start, n));
      expect(r.period.n).toBe(n);
      expect(r.ledger.maxResidualWh).toBeLessThan(0.01);
      expect(Math.max(...r.series.residualWh.map(Math.abs))).toBeLessThan(0.01);
      expect(performance.now() - t0).toBeLessThan(5000);
      expect(r.metrics.lowestSunMonth).not.toBeNull();
    }
  });
  test('hủy: trả null và không để lại kết quả dở', async () => {
    let calls = 0;
    expect(await simulateDispatch(year(Date.UTC(2023, 0, 1) / 1000, 8760), 'h', { yieldEvery: 100, isCancelled: () => ++calls > 3 })).toBeNull();
  });
  test('chỉ số: mẫu số bằng 0 trả null kèm diễn giải; tháng ít nắng nhất chỉ xét tháng đủ dữ liệu', async () => {
    const none = await run(mk({ pvBusW: [1000, 0], loads: [] }));
    expect(none.metrics).toMatchObject({ servedRatio: null, autonomy: null });
    expect(none.metrics.servedRatioNote).toContain('Không có tải');
    const r = await run(year(Date.UTC(2023, 0, 1) / 1000, 8760 + 100)); // 100 giờ thừa sang 2024: tháng 1/2024 chưa đủ
    expect(r.metrics.lowestSunMonth!.month).not.toBe('2024-01');
  });
});
