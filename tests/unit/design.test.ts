import { describe, expect, test } from 'vitest';
import { History } from '../../src/app/history';
import { buildQuote } from '../../src/cost/quote';
import { setQuantity } from '../../src/cost/edit';
import { addEdge, addString, dropInstances, removeEdge, removeString, setStringSize, setStringTarget, suggestGrouping, unassignedPanels } from '../../src/domain/graph';
import { addAcLoad, addBatteryBranch, addPanelBatch, addPumpBranch, applyPreset, buildLamHaConfig, proposeStrings } from '../../src/domain/presets';
import { BUILTIN_OFFERS, offersFor } from '../../src/catalog/catalog';
import type { Project } from '../../src/domain/types';
import { openLamHa } from '../../src/domain/project';
import { hasErrors, validateProject } from '../../src/domain/validate';
import { badgeOf, validateDesign, type Finding } from '../../src/validation/strings';
import { catalog, rig, withSpecs, withStrings } from './helpers';

const code = (fs: Finding[], c: string) => fs.filter((f) => f.code === c);
const one = (fs: Finding[], c: string) => { const m = code(fs, c); expect(m, c).toHaveLength(1); return m[0]; };

// Acceptance fixture: Voc 50 V, βVoc −0,25 %/°C, Tcell,min −5 °C, Ns = 8 → 430 V
const panel50 = withSpecs(catalog('vsun-620'), { vocV: 50, betaVoc: -0.0025, iscA: 14, impA: 13, vmpV: 40 });
const inverter = (over: Record<string, number | null> = {}) => withSpecs(catalog('luxpower-sna6000wpv'), { mpptCount: 2, pvIscMaxPerMpptA: 25, pvImaxPerMpptA: 17, ...over });

describe('W03 nghiệm thu: Voc lạnh', () => {
  test('Voc=50, β=−0,25 %/°C, −5 °C, Ns=8 → 430 V; giới hạn 420 V báo lỗi, 450 V qua', () => {
    for (const [limit, status] of [[420, 'fail'], [450, 'pass']] as const) {
      const f = one(validateDesign(withStrings(rig(panel50, inverter({ pvVocMaxV: limit }), 8), [{ n: 8, port: 'M1' }])), 'VOC_COLD_ABS');
      expect(f).toMatchObject({ status, value: 430, limit, unit: 'V', severity: status === 'fail' ? 'error' : 'info' });
      expect(f.formula).toContain('βVoc');
      expect(f.sources.map((s) => s.field)).toEqual(expect.arrayContaining(['vocV', 'betaVoc', 'coldCellTempC', 'pvVocMaxV']));
      expect(f.message).toContain('430');
      if (status === 'fail') expect(f.consequence).toMatch(/hỏng/);
    }
  });
});

describe('W03 nghiệm thu: Isc theo tracker', () => {
  const inv = inverter({ pvVocMaxV: 500 });
  test('hai chuỗi Isc=14 A trên cùng tracker 25 A: tổng 28 A fail; chia hai tracker thì từng tracker qua', () => {
    const same = validateDesign(withStrings(rig(panel50, inv, 8), [{ n: 4, port: 'M1' }, { n: 4, port: 'M1' }]));
    expect(one(same, 'ISC_TRACKER')).toMatchObject({ status: 'fail', severity: 'error', value: 28, limit: 25, unit: 'A' });
    const split = validateDesign(withStrings(rig(panel50, inv, 8), [{ n: 4, port: 'M1' }, { n: 4, port: 'M2' }]));
    expect(code(split, 'ISC_TRACKER').map((f) => [f.status, f.value])).toEqual([['pass', 14], ['pass', 14]]);
    expect(code(split, 'ISC_TRACKER').every((f) => f.severity === 'info')).toBe(true);
  });
  test('hệ số dự phòng Isc là thiết lập có nguồn, mặc định 1', () => {
    const r = rig(panel50, inv, 4, { coldCellTempC: -5, hotCellTempC: 70, iscFactor: 1.25 });
    expect(one(validateDesign(withStrings(r, [{ n: 4, port: 'M1' }])), 'ISC_TRACKER').value).toBe(17.5);
  });
  test('Imp vượt dòng vận hành chỉ là giới hạn công suất, không phải lỗi thiết kế', () => {
    const lim = validateDesign(withStrings(rig(withSpecs(panel50, { impA: 10 }), inv, 8), [{ n: 4, port: 'M1' }, { n: 4, port: 'M1' }]));
    expect(one(lim, 'IMP_TRACKER')).toMatchObject({ status: 'limited', severity: 'warning', value: 20, limit: 17 });
    const id = one(lim, 'IMP_TRACKER').objectIds[0];
    expect(badgeOf(lim, id)).toMatchObject({ powerLimited: true });
  });
});

describe('thông số thiếu trả unknown, không đoán', () => {
  test('thiếu nhiệt độ lạnh hoặc giới hạn của cổng → unknown, nêu trường thiếu', () => {
    const noTemp = validateDesign(withStrings(rig(panel50, inverter({ pvVocMaxV: 450 }), 8, {}), [{ n: 8, port: 'M1' }]));
    expect(one(noTemp, 'VOC_COLD_ABS')).toMatchObject({ status: 'unknown', severity: 'info', value: null });
    expect(one(noTemp, 'VOC_COLD_ABS').missing).toContain('Thiết lập thiết kế: coldCellTempC');
    const noLimit = validateDesign(withStrings(rig(panel50, inverter({ pvVocMaxV: null }), 8), [{ n: 8, port: 'M1' }]));
    expect(one(noLimit, 'VOC_COLD_ABS').missing).toContain('Luxpower SNA6000WPV off-grid 6 kW: pvVocMaxV');
    expect(badgeOf(noLimit, one(noLimit, 'VOC_COLD_ABS').objectIds[0]).dataComplete).toBe(false);
  });
  test('βVmp không suy từ βPmax: datasheet không có → unknown; có giả định thiết kế → tính và gắn nhãn giả định', () => {
    const r = rig(panel50, inverter({ pvVocMaxV: 500, mpptVminV: 120, mpptVmaxV: 385, pvStartV: 100 }), 4);
    const none = validateDesign(withStrings(r, [{ n: 4, port: 'M1' }]));
    expect(one(none, 'VMP_HOT_MIN')).toMatchObject({ status: 'unknown' });
    expect(one(none, 'VMP_HOT_MIN').missing.join()).toContain('betaVmp');
    const assumed = validateDesign({ ...withStrings(r, [{ n: 4, port: 'M1' }]), design: { coldCellTempC: -5, hotCellTempC: 70, betaVmpAssumption: -0.003 } });
    // 4 × 40 × (1 − 0,003 × 45) = 138,4 V
    expect(one(assumed, 'VMP_HOT_MIN')).toMatchObject({ status: 'pass', value: 138.4, assumed: true });
    const fromPanel = validateDesign(withStrings(rig(withSpecs(panel50, { betaVmp: -0.003 }), inverter({ pvVocMaxV: 500, mpptVminV: 120, mpptVmaxV: 385 }), 4), [{ n: 4, port: 'M1' }]));
    expect(one(fromPanel, 'VMP_HOT_MIN')).toMatchObject({ status: 'pass', assumed: false });
  });
  test('Vmp nóng dưới đáy MPPT là lỗi; Vmp lạnh trên đỉnh MPPT chỉ giới hạn công suất', () => {
    const base = { betaVmp: -0.003 };
    const inv = inverter({ pvVocMaxV: 900, mpptVminV: 120, mpptVmaxV: 385, pvStartV: 50 });
    const low = validateDesign(withStrings(rig(withSpecs(panel50, base), inv, 2), [{ n: 2, port: 'M1' }])); // 2 × 34,6 = 69,2 V
    expect(one(low, 'VMP_HOT_MIN')).toMatchObject({ status: 'fail', severity: 'error' });
    const high = validateDesign(withStrings(rig(withSpecs(panel50, base), inv, 10), [{ n: 10, port: 'M1' }])); // 10 × 40 × 1,09 = 436 V
    expect(one(high, 'VMP_COLD_MAX')).toMatchObject({ status: 'limited', severity: 'warning', value: 436 });
  });
  test('điện áp khởi động dùng Voc nóng', () => {
    const f = one(validateDesign(withStrings(rig(panel50, inverter({ pvVocMaxV: 500, pvStartV: 300 }), 2), [{ n: 2, port: 'M1' }])), 'START_VOLTAGE');
    expect(f).toMatchObject({ status: 'fail', severity: 'error', limit: 300 }); // 2 × 50 × (1 − 0,0025 × 45) ≈ 88,75
    expect(f.value).toBeCloseTo(88.75, 2);
  });
});

describe('cổng và cấu trúc', () => {
  const r = () => rig(panel50, inverter({ pvVocMaxV: 500 }), 4);
  test('chuỗi vào cổng sai loại, cổng không tồn tại', () => {
    expect(one(validateDesign(withStrings(r(), [{ n: 4, port: 'BAT' }])), 'PORT_TYPE_MISMATCH')).toMatchObject({ status: 'fail', severity: 'error' });
    expect(code(validateDesign(withStrings(r(), [{ n: 4, port: 'M9' }])), 'PORT_NOT_FOUND')).toHaveLength(1);
  });
  test('tấm trùng trong hai chuỗi; tấm chưa gán', () => {
    const x = r();
    let p = addString(x.p, { panelIds: [x.panels[0], x.panels[1]], target: { instanceId: x.inv, port: 'M1' } });
    p = addString(p, { panelIds: [x.panels[1]], target: { instanceId: x.inv, port: 'M2' } });
    const f = validateDesign(p);
    expect(one(f, 'PANEL_DUPLICATE').objectIds[0]).toBe(x.panels[1]);
    expect(one(f, 'PANEL_UNASSIGNED').objectIds).toEqual([x.panels[2], x.panels[3]]);
  });
  test('cạnh sai loại, sai chiều, trùng nguồn vào pin', () => {
    const x = r();
    const bat = addBatteryBranch(x.p, catalog('dyness-dl5-0c'));
    const batId = bat.instances.at(-1)!.instanceId;
    const load = addAcLoad(bat, catalog('sample-pump-load'));
    const loadId = load.instances.at(-1)!.instanceId;
    expect(validateDesign(load).filter((f) => f.severity === 'error')).toEqual([]);
    expect(one(validateDesign(addEdge(load, { instanceId: batId, port: 'DC' }, { instanceId: loadId, port: 'AC' })), 'PORT_TYPE_MISMATCH').status).toBe('fail');
    const rev = addEdge(removeEdge(load, load.edges[1].edgeId), { instanceId: loadId, port: 'AC' }, { instanceId: x.inv, port: 'AC' });
    expect(one(validateDesign(rev), 'PORT_DIRECTION').severity).toBe('error');
    const two = addBatteryBranch(bat, catalog('dyness-dl5-0c'));
    expect(one(validateDesign(two), 'PORT_OVER_CAPACITY').objectIds[0]).toBe(`${x.inv}:BAT`);
  });
  test('pin và tải chưa nối chỉ cảnh báo', () => {
    const p = addAcLoad(rig(panel50, inverter(), 1).p, catalog('sample-pump-load'));
    const noEdge = { ...p, edges: [] };
    expect(one(validateDesign(noEdge), 'LOAD_UNCONNECTED').severity).toBe('warning');
  });
});

describe('pin, tải AC, nhánh bơm', () => {
  test('Dyness + SNA6000WPV: dải điện áp qua, dòng sạc/xả bị pin giới hạn, pin cũ gắn nhãn giả định', () => {
    const base = applyPreset(openLamHa(), 'two-trackers', catalog('luxpower-sna6000wpv'));
    const dy = validateDesign(addBatteryBranch(base, catalog('dyness-dl5-0c')));
    expect(one(dy, 'BATTERY_VOLTAGE_WINDOW').status).toBe('pass');
    expect(one(dy, 'BATTERY_VOLTAGE_WINDOW_MAX').status).toBe('pass');
    expect(one(dy, 'BATTERY_CHARGE_LIMIT')).toMatchObject({ status: 'limited', value: 140, limit: 75 });
    expect(one(dy, 'BATTERY_DISCHARGE_LIMIT')).toMatchObject({ status: 'limited', value: 140, limit: 100, assumed: false });
    const old = validateDesign(addBatteryBranch(base, catalog('used-battery')));
    expect(one(old, 'BATTERY_DISCHARGE_LIMIT')).toMatchObject({ status: 'limited', assumed: true });
    expect(one(old, 'BATTERY_CHARGE_LIMIT').status).toBe('unknown');
  });
  test('tải AC vượt công suất inverter chỉ giới hạn công suất', () => {
    const inv = withSpecs(catalog('luxpower-sna6000wpv'), { acRatedW: 500 });
    const p = addAcLoad(rig(panel50, inv, 1).p, catalog('sample-pump-load'));
    expect(one(validateDesign(p), 'AC_LOAD_RATED')).toMatchObject({ status: 'limited', value: 750, limit: 500 });
    expect(one(validateDesign(addAcLoad(rig(panel50, catalog('luxpower-sna6000wpv'), 1).p, catalog('sample-pump-load'))), 'AC_LOAD_RATED').status).toBe('pass');
  });
  test('nhánh bơm PV độc lập: chuỗi vào controller, dữ liệu mẫu còn thiếu nên unknown', () => {
    const x = rig(panel50, inverter({ pvVocMaxV: 500 }), 6);
    let p = withStrings(x, [{ n: 4, port: 'M1' }]);
    p = addPumpBranch(p, catalog('sample-pump-controller'), catalog('sample-pump-load'), x.panels.slice(4));
    const f = validateDesign(p);
    expect(one(f, 'CTRL_POWER')).toMatchObject({ status: 'limited', value: 1240, limit: 750 }); // 2 × 620 W vào controller 750 W
    const ctlVoc = f.find((c) => c.code === 'VOC_COLD_ABS' && c.sources.some((x) => x.where.includes('Controller')))!;
    expect(ctlVoc.status).toBe('unknown'); // controller mẫu chưa khai Voc tối đa
    expect(one(f, 'CTRL_LOAD_RATED')).toMatchObject({ status: 'pass', value: 750, limit: 750 });
  });
});

describe('preset Lâm Hà', () => {
  const settings = { coldCellTempC: 5, hotCellTempC: 70 };
  const lamHa = (kind: Parameters<typeof applyPreset>[1]) => ({ ...applyPreset(openLamHa(), kind, catalog('luxpower-sna6000wpv')), design: settings });
  test('1 chuỗi 8 tấm: Voc lạnh 408,3 V ≤ 480 V', () => {
    const p = lamHa('one-string');
    expect(p.strings).toHaveLength(1);
    expect(one(validateDesign(p), 'VOC_COLD_ABS')).toMatchObject({ status: 'pass', value: 408.3008, limit: 480 });
  });
  test('2 chuỗi cùng tracker: tổng Isc 31,9 A > 25 A fail', () => {
    const f = validateDesign(lamHa('two-strings-one-tracker'));
    expect(one(f, 'ISC_TRACKER')).toMatchObject({ status: 'fail', value: 31.9, limit: 25 });
    expect(one(f, 'IMP_TRACKER')).toMatchObject({ status: 'limited' });
  });
  test('2 tracker độc lập: không còn lỗi thiết kế', () => {
    const p = lamHa('two-trackers');
    const f = validateDesign(p);
    expect(f.filter((x) => x.status === 'fail' && x.severity === 'error')).toEqual([]);
    expect(code(f, 'ISC_TRACKER').map((x) => x.status)).toEqual(['pass', 'pass']);
    expect(p.strings!.map((s) => s.panelIds.length)).toEqual([4, 4]);
  });
  test('Vmp nóng/lạnh unknown cho tới khi có βVmp hoặc giả định', () => {
    const f = validateDesign(lamHa('two-trackers'));
    expect(code(f, 'VMP_HOT_MIN').every((x) => x.status === 'unknown')).toBe(true);
    const s = f.find((x) => x.code === 'VMP_HOT_MIN')!.stringId!;
    expect(badgeOf(f, s)).toEqual({ dataComplete: false, powerLimited: false, exceedsLimit: false });
  });
});

describe('chỉnh sửa graph: BOM, undo, tham chiếu', () => {
  test('chỉ chuyển cổng thì giá và BOM giữ nguyên', () => {
    const a = { ...applyPreset(openLamHa(), 'one-string', catalog('luxpower-sna6000wpv')) };
    const s = a.strings![0].stringId;
    const b = setStringTarget(a, s, { instanceId: a.strings![0].target!.instanceId, port: 'M2' });
    expect(buildQuote(b)).toEqual(buildQuote(a));
    expect(buildQuote(setStringTarget(b, s, null))).toEqual(buildQuote(a));
  });
  test('thêm inverter thêm một dòng BOM chưa có giá; bỏ đi thì mất dòng; phần đã biết không đổi', () => {
    const before = buildQuote(openLamHa());
    const withInv = applyPreset(openLamHa(), 'one-string', catalog('luxpower-sna6000wpv'));
    const q = buildQuote(withInv);
    expect(q.missing.lineKeys).toEqual(['design:luxpower-sna6000wpv@1']);
    expect(q.knownSubtotalMinor).toBe(before.knownSubtotalMinor);
    const undone = dropInstances(withInv, new Set([withInv.instances.at(-1)!.instanceId]));
    expect(buildQuote(undone).missing.lineKeys).toEqual([]);
    expect(undone.strings![0].target).toBeNull();
  });
  test('bớt tấm gỡ chúng khỏi chuỗi, không để tham chiếu treo', () => {
    const a = applyPreset(openLamHa(), 'two-trackers', catalog('luxpower-sna6000wpv'));
    const b = setQuantity(a, { modelId: 'vsun-620', revision: 1 }, 5);
    expect(b.strings!.map((s) => s.panelIds.length)).toEqual([4, 1]);
    expect(hasErrors(validateProject(b))).toBe(false);
  });
  test('setStringSize lấy tấm chưa gán hoặc nhả đuôi; thiếu tấm thì báo', () => {
    let p = applyPreset(openLamHa(), 'one-string', catalog('luxpower-sna6000wpv'));
    const id = p.strings![0].stringId;
    p = setStringSize(p, id, 5);
    expect(unassignedPanels(p)).toHaveLength(3);
    expect(setStringSize(p, id, 8).strings![0].panelIds).toHaveLength(8);
    expect(() => setStringSize(p, id, 9)).toThrow('NOT_ENOUGH_PANELS');
    expect(removeString(p, id).strings).toEqual([]);
  });
  test('thêm theo lô: chia qua các tracker khi mỗi chuỗi còn đủ áp trên đáy MPPT, không thì gộp; chưa có inverter thì một chuỗi chưa nối; BOM tăng đúng', () => {
    const inv = catalog('luxpower-sna6000wpv');
    const withInv = applyPreset(openLamHa(), 'one-string', inv);
    const batch = addPanelBatch(withInv, catalog('hestia-650'), 8, inv);
    expect(batch.strings!.slice(1).map((s) => [s.panelIds.length, s.target?.port])).toEqual([[4, 'M1'], [4, 'M2']]);
    // 5 tấm chia 3 + 2 thì chuỗi 2 tấm chỉ 2 × 42,4 = 84,8 V, dưới đáy MPPT 120 V ngay ở STC: đề xuất một chuỗi 5 tấm (212 V)
    expect(addPanelBatch(withInv, catalog('hestia-650'), 5, inv).strings!.slice(1).map((s) => [s.panelIds.length, s.target?.port])).toEqual([[5, 'M1']]);
    expect(buildQuote(batch).deviceCounts['hestia-650@1']).toBe(8);
    const noInv = addPanelBatch(openLamHa(), catalog('hestia-650'), 4, undefined);
    expect(noInv.strings).toHaveLength(1);
    expect(noInv.strings![0]).toMatchObject({ target: null, panelIds: expect.any(Array) });
    expect(noInv.strings![0].panelIds).toHaveLength(4);
    expect(hasErrors(validateProject(batch))).toBe(false);
  });
  test('đề xuất chuỗi không tạo chuỗi quá ngắn, sát đáy dải MPPT: 6 × VSUN 620 trên SNA6000 thành 1 chuỗi 6, 8 tấm vẫn 4 + 4', () => {
    const vsun = catalog('vsun-620'), sna = catalog('luxpower-sna6000wpv');
    // Vmp STC: 3 tấm 123,7 V sát đáy 120 V (nóng thì rơi dưới); 4 tấm 164,9 V; 6 tấm 247,4 V
    expect([proposeStrings(6, vsun, sna), proposeStrings(8, vsun, sna), proposeStrings(4, vsun, sna)]).toEqual([[6], [4, 4], [4]]);
    expect(proposeStrings(16, vsun, sna)).toEqual([8, 8]); // 1 chuỗi 16 vượt công suất một MPPT: giữ chia đều
    // cấu hình B Lâm Hà (6 tấm vào inverter + 2 tấm bơm): với βVmp giả định −0,33 %/°C, Tcell nóng 70 °C, Vmp nóng 6 × 41,23 × 0,8515 ≈ 210,6 V ≥ 120 V
    const parts = { inverter: sna, battery: catalog('used-battery'), home: catalog('sample-home-load'), pump: catalog('sample-pump-load'), controller: catalog('sample-pump-controller') };
    const b = { ...buildLamHaConfig(openLamHa(), 'split6+2', parts, (c) => offersFor(BUILTIN_OFFERS, c)), design: { coldCellTempC: 5, hotCellTempC: 70, iscFactor: 1, betaVmpAssumption: -0.0033, source: 'giả định kiểm thử' } } as Project;
    expect(code(validateDesign(b), 'VMP_HOT_MIN').map((f) => [f.status, f.value])).toEqual([['pass', 210.64407]]);
  });
  test('suggestGrouping chia đều', () => {
    expect([suggestGrouping(8, 2), suggestGrouping(7, 2), suggestGrouping(1, 2), suggestGrouping(8, 1)]).toEqual([[4, 4], [4, 3], [1], [8]]);
  });
  test('History: undo/redo, edit mới xóa redo', () => {
    const h = new History<number>();
    h.record(1); h.record(2);
    expect([h.undo(3), h.undo(2)]).toEqual([2, 1]);
    expect(h.canUndo).toBe(false);
    expect(h.redo(1)).toBe(2);
    h.record(2);
    expect(h.canRedo).toBe(false);
  });
  test('schema nhận strings và design; chuỗi trỏ tấm không tồn tại bị chặn', () => {
    const p = applyPreset(openLamHa(), 'two-trackers', catalog('luxpower-sna6000wpv'));
    expect(hasErrors(validateProject({ ...p, design: { coldCellTempC: 5, hotCellTempC: 70, iscFactor: 1.25, betaVmpAssumption: null, source: 'giả định' } }))).toBe(false);
    const bad = structuredClone(p); bad.strings![0].panelIds[0] = 'ghost';
    expect(validateProject(bad)[0]).toMatchObject({ code: 'BROKEN_REF', field: '/strings/0/panelIds/0' });
    const off = { ...structuredClone(p), design: { iscFactor: 0.5 } };
    expect(validateProject(off)[0].code).toBe('SCHEMA');
  });
});
