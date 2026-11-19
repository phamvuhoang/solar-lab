import { describe, expect, test } from 'vitest';
import { applyPreset } from '../../src/domain/presets';
import { openLamHa } from '../../src/domain/project';
import { compilePv, hashPvInput } from '../../src/engine/compile';
import { completeIrradiance, faimanTcell, isotropicPoa, panelDcW, simulatePv } from '../../src/engine/pv';
import { sunPosition } from '../../src/engine/solar';
import { catalog, withSpecs } from './helpers';
import { input, model, panel, str, wx } from './pv-helpers';

const run = (i: ReturnType<typeof input>) => simulatePv(i, 'hash');

describe('nghiệm thu W04: STC', () => {
  test('8 × 620 W, Geff=1000 W/m², Tcell=25 °C, không tổn hao/giới hạn → 4.960 W DC', async () => {
    const r = (await run(input(wx({ n: 3, poa: [1000, 1000, 1000] }), model({ irradianceInput: 'poa' }))))!;
    expect(r.issues).toEqual([]);
    expect(r.series.pIdealW).toEqual([4960, 4960, 4960]);
    expect(r.totals).toMatchObject({ kWp: 4.96, eIdealWh: 14880, eInverterWh: 14880, lossWh: 0, clippedTrackerWh: 0 });
    expect(r.models).toMatchObject({ irradianceInput: 'poa', cellTemperature: 'fixed', limits: 'none' });
  });
  test('trời tối cho PV = 0 (bức xạ bằng 0 và cả khi mặt trời dưới chân trời)', async () => {
    const night = wx({ n: 6, t0: Date.UTC(2023, 11, 21, 14) / 1000, ghi: Array(6).fill(0), dni: Array(6).fill(0), dhi: Array(6).fill(0) }); // 21:00–03:00 +07
    const r = (await run(input(night, model())))!;
    expect(r.series.pIdealW.every((x) => x === 0)).toBe(true);
    expect(r.series.zenithDeg.every((z) => z > 90)).toBe(true);
    expect(r.totals.eInverterWh).toBe(0);
  });
});

describe('hướng và thời gian', () => {
  // Clear-ish synthetic day built from the sun itself: DNI 850 / DHI 90 while the sun is up.
  const day = (lat = 11.87, lon = 108.2, t0 = Date.UTC(2023, 11, 21) / 1000) => {
    const n = 24, dni: number[] = [], dhi: number[] = [], ghi: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = sunPosition(t0 + i * 3600 + 1800, lat, lon);
      const up = s.apparentElevationDeg > 2;
      dni.push(up ? 850 : 0); dhi.push(up ? 90 : 0); ghi.push(up ? 850 * Math.sin(s.apparentElevationDeg * Math.PI / 180) + 90 : 0);
    }
    return wx({ n, t0, ghi, dni, dhi, location: { latitude: lat, longitude: lon, elevationM: 0 } });
  };
  const peak = (a: number[]) => a.indexOf(Math.max(...a));
  test('đông đạt đỉnh trước trưa mặt trời, tây sau trưa, nam quanh trưa; nam > bắc vào mùa đông', async () => {
    const d = day();
    const p = async (az: number, tilt = 25) => (await run(input(d, model({ azimuthDeg: az, tiltDeg: tilt }))))!.series.pIdealW;
    const [east, south, west, north] = [await p(90), await p(180), await p(270), await p(0)];
    // solar noon at 108,2°E ≈ 04:47 UTC → hour index 4 or 5 (midpoints 04:30 and 05:30)
    expect([4, 5]).toContain(peak(south));
    expect(peak(east)).toBeLessThan(peak(south));
    expect(peak(west)).toBeGreaterThan(peak(south));
    expect(south.reduce((a, b) => a + b)).toBeGreaterThan(north.reduce((a, b) => a + b));
    expect(Math.abs(east.reduce((a, b) => a + b) - west.reduce((a, b) => a + b)) / east.reduce((a, b) => a + b)).toBeLessThan(0.05); // đối xứng đông/tây (lệch nhỏ do trưa mặt trời 04:47 không trùng lưới giờ)
  });
  test('bán cầu nam: mặt hướng Bắc (azimuth 0) mới là hướng nhìn mặt trời lúc trưa', async () => {
    const d = day(-33.87, 151.2, Date.UTC(2023, 5, 21) / 1000); // Sydney, đông chí
    const e = async (az: number) => (await run(input(d, model({ azimuthDeg: az, tiltDeg: 30 }))))!.series.pIdealW.reduce((a, b) => a + b);
    expect(await e(0)).toBeGreaterThan(await e(180) * 1.5);
  });
  test('vị trí mặt trời: trưa đông chí tại 11,87°N cao 54,7°, hướng Nam; bình minh ở hướng Đông', () => {
    const noon = sunPosition(Date.UTC(2023, 11, 21, 4, 47) / 1000, 11.87, 108.2);
    expect(noon.elevationDeg).toBeCloseTo(54.7, 0);
    expect(noon.azimuthDeg).toBeGreaterThan(178); expect(noon.azimuthDeg).toBeLessThan(182);
    const dawn = sunPosition(Date.UTC(2023, 11, 20, 23, 15) / 1000, 11.87, 108.2);
    expect(dawn.azimuthDeg).toBeGreaterThan(100); expect(dawn.azimuthDeg).toBeLessThan(125);
  });
});

describe('mô hình thành phần', () => {
  test('transposition: mặt ngang POA = GHI; mặt đứng nhìn thẳng mặt trời thấy toàn bộ DNI', () => {
    const flat = isotropicPoa(700, 100, 700 * Math.cos(0.5) + 100, Math.cos(0.5), 0, 0.2);
    expect(flat.poa).toBeCloseTo(700 * Math.cos(0.5) + 100, 9);
    const v = isotropicPoa(700, 100, 500, 1, 90, 0.2);
    expect([v.direct, v.sky, v.ground]).toEqual([700, expect.closeTo(50, 9), expect.closeTo(50, 9)]);
  });
  test('hoàn thiện bức xạ: DNI = (GHI−DHI)/cos z, GHI = DNI·cos z + DHI; trời gần đường chân trời → DNI = 0', () => {
    expect(completeIrradiance(600, null, 100, 0.5)).toEqual({ ghi: 600, dhi: 100, dni: 1000 });
    expect(completeIrradiance(null, 1000, 100, 0.5)).toEqual({ dni: 1000, dhi: 100, ghi: 600 });
    expect(completeIrradiance(600, 1000, null, 0.5)).toEqual({ ghi: 600, dni: 1000, dhi: 100 });
    expect(completeIrradiance(10, null, 5, 0.02)?.dni).toBe(0);
    expect(completeIrradiance(null, null, 5, 0.5)).toBeNull();
  });
  test('Faiman: 20 °C, POA 800, gió 2 m/s → 40,6825 °C; công suất tuyến tính theo nhiệt', () => {
    expect(faimanTcell(20, 800, 2, 25, 6.84)).toBeCloseTo(20 + 800 / 38.68, 9);
    expect(panelDcW(panel(), 1000, 25)).toBe(620);
    expect(panelDcW(panel(), 1000, 45)).toBeCloseTo(620 * (1 - 0.0029 * 20), 9);
    expect(panelDcW(panel(), 0, 45)).toBe(0);
    expect(panelDcW(panel(100, -0.5), 1000, 100)).toBe(0); // không âm
  });
  test('Faiman chạy qua engine với thời tiết có nhiệt độ và gió', async () => {
    const w = wx({ n: 1, poa: [800], tempAirC: [20], windMs: [2] });
    const r = (await run(input(w, model({ irradianceInput: 'poa', cellModel: 'faiman' }), [str(1)])))!;
    const tc = 20 + 800 / 38.68;
    expect(r.series.tcellC[0]).toBeCloseTo(tc, 9);
    expect(r.series.pIdealW[0]).toBeCloseTo(620 * 0.8 * (1 - 0.0029 * (tc - 25)), 6);
  });
});

describe('W và Wh khi đổi bước', () => {
  test('cùng POA 1000 W/m²: 4 bước 1 h và 16 bước 15 phút đều ra 4.960 W và 19.840 Wh', async () => {
    const hourly = (await run(input(wx({ n: 4, poa: Array(4).fill(1000) }), model({ irradianceInput: 'poa' }))))!;
    const q = (await run(input(wx({ n: 16, stepSeconds: 900, poa: Array(16).fill(1000) }), model({ irradianceInput: 'poa' }))))!;
    expect(hourly.series.pIdealW[0]).toBe(4960);
    expect(q.series.pIdealW[0]).toBe(4960); // công suất không đổi theo bước
    expect(hourly.totals.eIdealWh).toBe(19840);
    expect(q.totals.eIdealWh).toBe(19840); // điện năng = Σ P·Δt
    expect(q.period).toMatchObject({ stepSeconds: 900, n: 16 });
  });
});

describe('giới hạn tracker và inverter, trước/sau clipping', () => {
  const w = wx({ n: 2, poa: [1000, 500] });
  const m = model({ irradianceInput: 'poa', applyLimits: true });
  const tr = (maxPowerW: number | null, maxCurrentA: number | null) => [{ id: 'T1', label: 'MPPT 1', inverterId: 'INV', maxPowerW, maxCurrentA }];
  test('8 tấm một chuỗi: 4.960 W vượt 4.800 W/tracker → cắt 160 Wh, lưu cả trước lẫn sau', async () => {
    const r = (await run(input(w, m, [str(8)], tr(4800, 17), [{ id: 'INV', label: 'SNA', maxPvPowerW: 9600 }])))!;
    expect(r.series.pLossedW).toEqual([4960, 2480]);
    expect(r.series.pTrackerW).toEqual([4800, 2480]);
    expect(r.series.pInverterW).toEqual([4800, 2480]);
    expect(r.totals).toMatchObject({ eLossedWh: 7440, clippedTrackerWh: 160, eTrackerWh: 7280, clippedInverterWh: 0, eInverterWh: 7280 });
    expect(r.limitsApplied.join('|')).toContain('công suất vào tối đa 4800 W');
  });
  test('hai chuỗi 4+4 trên cùng tracker bị cắt theo dòng 17 A (≈ 2.804 W), chia lại cho từng chuỗi theo tỉ lệ', async () => {
    const r = (await run(input(w, m, [str(4, 'T1', 'A'), str(4, 'T1', 'B')], tr(4800, 17), [{ id: 'INV', label: 'SNA', maxPvPowerW: 9600 }])))!;
    expect(r.series.pTrackerW[0]).toBeCloseTo(17 * 4 * 41.23, 6);
    expect(r.strings[0].pTrackerW[0] + r.strings[1].pTrackerW[0]).toBeCloseTo(r.series.pTrackerW[0], 9);
    expect(r.totals.clippedTrackerWh).toBeGreaterThan(2000);
  });
  test('hai tracker độc lập 4+4: không cắt; giới hạn inverter 4.000 W cắt phần còn lại', async () => {
    const two = [{ id: 'T1', label: 'M1', inverterId: 'INV', maxPowerW: 4800, maxCurrentA: 17 }, { id: 'T2', label: 'M2', inverterId: 'INV', maxPowerW: 4800, maxCurrentA: 17 }];
    const free = (await run(input(w, m, [str(4, 'T1', 'A'), str(4, 'T2', 'B')], two, [{ id: 'INV', label: 'SNA', maxPvPowerW: 9600 }])))!;
    expect(free.series.pInverterW).toEqual([4960, 2480]);
    expect(free.totals.clippedTrackerWh).toBe(0);
    const capped = (await run(input(w, m, [str(4, 'T1', 'A'), str(4, 'T2', 'B')], two, [{ id: 'INV', label: 'SNA', maxPvPowerW: 4000 }])))!;
    expect(capped.series.pInverterW).toEqual([4000, 2480]);
    expect(capped.totals).toMatchObject({ clippedTrackerWh: 0, clippedInverterWh: 960 });
  });
  test('giới hạn chưa biết thì không áp dụng và kết quả nói rõ', async () => {
    const r = (await run(input(w, m, [str(8)], tr(null, null), [{ id: 'INV', label: 'X', maxPvPowerW: null }])))!;
    expect(r.series.pInverterW[0]).toBe(4960);
    expect(r.limitsSkipped.length).toBe(3);
    expect(r.limitsApplied).toEqual([]);
  });
  test('tổn hao DC là một bước riêng', async () => {
    const r = (await run(input(w, model({ irradianceInput: 'poa', lossRatio: 0.1 }))))!;
    expect(r.totals).toMatchObject({ eIdealWh: 7440, lossWh: 744, eLossedWh: 6696, eInverterWh: 6696 });
    expect(r.assumptions.join()).toContain('Tổn hao DC 10.0 %');
  });
});

describe('lỗi nhập tách khỏi lỗi mô hình', () => {
  const codes = async (w: ReturnType<typeof wx>, m = model()) => ((await run(input(w, m)))!).issues.map((i) => i.code);
  test('mô hình Faiman thiếu nhiệt độ hoặc gió; POA không có; thiếu bức xạ', async () => {
    const base = { n: 2, ghi: [0, 0], dni: [0, 0], dhi: [0, 0] };
    expect(await codes(wx(base), model({ cellModel: 'faiman' }))).toEqual(['AIR_TEMP_MISSING', 'WIND_MISSING']);
    expect(await codes(wx({ ...base, tempAirC: [20, 20] }), model({ cellModel: 'faiman' }))).toEqual(['WIND_MISSING']);
    expect(await codes(wx({ ...base, tempAirC: [20, 20] }), model({ cellModel: 'faiman', windFallbackMs: 1 }))).toEqual([]);
    expect(await codes(wx(base), model({ irradianceInput: 'poa' }))).toContain('POA_MISSING');
    expect(await codes(wx({ n: 2, ghi: [0, 0] }), model())).toContain('IRRADIANCE_MISSING');
    expect(await codes(wx(base), model({ cellModel: 'fixed', fixedCellTempC: null }))).toContain('CELL_TEMP_MISSING');
    expect(await codes(wx(base), model({ tiltDeg: 120, albedo: 2, lossRatio: 1, azimuthDeg: 360 }))).toEqual(['ALBEDO_RANGE', 'LOSS_RANGE', 'TILT_RANGE', 'AZIMUTH_RANGE']);
  });
  test('gió dự phòng được ghi thành giả định có tên trong kết quả', async () => {
    const r = (await run(input(wx({ n: 1, ghi: [0], dni: [0], dhi: [0], tempAirC: [20] }), model({ cellModel: 'faiman', windFallbackMs: 1.5 }))))!;
    expect(r.assumptions.join('|')).toContain('gió dự phòng 1.5 m/s (giả định)');
  });
});

describe('chạy nền: tiến độ, hủy, xác định', () => {
  const big = wx({ n: 50, poa: Array(50).fill(600) });
  test('onProgress báo đủ tới 100 %; hủy trả null và không để lại kết quả dở', async () => {
    const seen: number[] = [];
    const ok = await simulatePv(input(big, model({ irradianceInput: 'poa' })), 'h', { yieldEvery: 10, onProgress: (d) => seen.push(d) });
    expect(ok).not.toBeNull();
    expect(seen).toEqual([0, 10, 20, 30, 40, 50]);
    let calls = 0;
    expect(await simulatePv(input(big, model({ irradianceInput: 'poa' })), 'h', { yieldEvery: 10, isCancelled: () => ++calls > 2 })).toBeNull();
  });
  test('cùng đầu vào cho cùng kết quả; đổi độ nghiêng đổi inputHash, đổi giá thì không liên quan', async () => {
    const a = input(wx({ n: 24, ghi: Array(24).fill(300), dni: Array(24).fill(300), dhi: Array(24).fill(100) }), model());
    expect(JSON.stringify(await run(a))).toBe(JSON.stringify(await run(a)));
    const h1 = await hashPvInput(a), h2 = await hashPvInput({ ...a, model: model({ tiltDeg: 30 }) });
    expect(h1).not.toBe(h2);
    expect(await hashPvInput(structuredClone(a))).toBe(h1);
  });
});

describe('compile từ project', () => {
  const settings = { tiltDeg: 10, azimuthDeg: 180 };
  const base = () => ({ ...applyPreset(openLamHa(), 'two-trackers', catalog('luxpower-sna6000wpv')), pv: settings });
  const w = wx({ n: 2, poa: [1000, 1000] });
  test('Lâm Hà 2 tracker: 2 chuỗi × 4 tấm, giới hạn lấy từ SNA6000WPV (9.600 W / 2 MPPT, 17 A)', () => {
    const { input: i, issues } = compilePv(base(), w);
    expect(issues).toEqual([]);
    expect(i!.strings.map((s) => s.panels.length)).toEqual([4, 4]);
    expect(i!.trackers.map((t) => [t.maxPowerW, t.maxCurrentA])).toEqual([[4800, 17], [4800, 17]]);
    expect(i!.inverters[0].maxPvPowerW).toBe(9600);
    expect(i!.strings[0].panels[0]).toMatchObject({ pstcW: 620, gamma: -0.0029, vmpV: 41.23, id: expect.stringMatching(/^ins-/) });
    expect(i!.strings[0].panels[0].shadeIdx).toBeUndefined(); // chưa có dữ liệu bóng
  });
  test('thiếu hướng, chưa có chuỗi, thiếu thông số tấm, tấm trùng → từ chối kèm trường', () => {
    expect(compilePv({ ...base(), pv: {} }, w).issues.map((x) => x.code)).toEqual(['ORIENTATION_MISSING', 'ORIENTATION_MISSING']);
    expect(compilePv({ ...openLamHa(), pv: settings }, w).issues[0].code).toBe('NO_STRINGS');
    const noGamma = base();
    noGamma.snapshots.components.find((c) => c.modelId === 'vsun-620')!.specs.betaPmax.v = null;
    expect(compilePv(noGamma, w).issues[0]).toMatchObject({ code: 'PANEL_SPEC_MISSING' });
    expect(compilePv(noGamma, w).issues[0].message).toContain('betaPmax');
    const dup = base(); dup.strings![1].panelIds[0] = dup.strings![0].panelIds[0];
    expect(compilePv(dup, w).issues.map((x) => x.code)).toContain('PANEL_DUPLICATE');
  });
  test('chuỗi vào controller bơm: tracker không có inverter, giới hạn theo ratedW', () => {
    let p = base();
    const free = p.instances.filter((i) => i.kind === 'panel').map((i) => i.instanceId);
    p = { ...p, strings: [] };
    const ctl = catalog('sample-pump-controller');
    p = { ...p, snapshots: { ...p.snapshots, components: [...p.snapshots.components, ctl] }, instances: [...p.instances, { instanceId: 'ctl1', kind: 'controller', label: 'Controller #1', componentRef: { modelId: ctl.modelId, revision: 1 } }],
      strings: [{ stringId: 's1', label: 'Bơm', panelIds: free.slice(0, 2), target: { instanceId: 'ctl1', port: 'PV' } }] };
    const { input: i, issues } = compilePv(p, w);
    expect(issues).toEqual([]);
    expect(i!.trackers[0]).toMatchObject({ inverterId: null, maxPowerW: 750, maxCurrentA: null });
  });
});
