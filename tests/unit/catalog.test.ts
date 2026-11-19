import { describe, expect, test } from 'vitest';
import { BUILTIN_COMPONENTS, BUILTIN_OFFERS, filterComponents, findComponent } from '../../src/catalog/catalog';
import { capabilities, cloneForEdit, technicalHash } from '../../src/domain/component';
import { validateComponent, validateOffer, hasErrors } from '../../src/domain/validate';
import { KINDS } from '../../src/domain/specs';

describe('catalog bundle', () => {
  test('mọi component và offer pass schema + kiểm ngữ nghĩa, không có lỗi', () => {
    for (const c of BUILTIN_COMPONENTS) expect(hasErrors(validateComponent(c)), c.modelId).toBe(false);
    for (const o of BUILTIN_OFFERS) expect(validateOffer(o), o.offerId).toEqual([]);
  });
  test('đủ các loại: ≥2 tấm đủ thông số, inverter, pin datasheet, pin cũ, controller/bơm', () => {
    for (const k of KINDS) expect(filterComponents(BUILTIN_COMPONENTS, { kind: k }).length, k).toBeGreaterThan(0);
    const full = filterComponents(BUILTIN_COMPONENTS, { kind: 'panel' }).filter((c) => capabilities(c).every((s) => s.ok));
    expect(full.map((c) => c.modelId)).toEqual(['vsun-620', 'vsun-600', 'hestia-650']);
    expect(findComponent(BUILTIN_COMPONENTS, { modelId: 'used-battery', revision: 1 })?.condition).toBe('used');
  });
  test('họ chưa rõ biến thể vẫn hiện, ghi đúng trường còn thiếu', () => {
    const h630 = findComponent(BUILTIN_COMPONENTS, { modelId: 'hestia-630', revision: 1 })!;
    const caps = Object.fromEntries(capabilities(h630).map((s) => [s.id, s]));
    expect(caps['nominal-power'].ok).toBe(true);
    expect(caps['string-voltage'].missing).toEqual(['vocV', 'vmpV']);
    const inv = findComponent(BUILTIN_COMPONENTS, { modelId: 'luxpower-sna6000wpv', revision: 1 })!;
    expect(capabilities(inv).every((s) => s.ok)).toBe(true);
    const victron = findComponent(BUILTIN_COMPONENTS, { modelId: 'victron-mppt-150-35', revision: 1 })!;
    expect(capabilities(victron).map((s) => [s.id, s.ok, s.missing])).toEqual([['power-window', false, ['vMinV']], ['pv-limits', true, []]]);
  });
  test('số liệu chính khớp datasheet hãng đã đọc', () => {
    const v = (id: string, k: string) => findComponent(BUILTIN_COMPONENTS, { modelId: id, revision: 1 })!.specs[k].v;
    expect([v('vsun-620', 'vocV'), v('vsun-620', 'vmpV'), v('vsun-620', 'betaVoc')]).toEqual([48.7, 41.23, -0.0025]);
    expect([v('vsun-600', 'pstcW'), v('vsun-600', 'iscA')]).toEqual([600, 15.75]);
    expect([v('luxpower-sna6000wpv', 'pvVocMaxV'), v('luxpower-sna6000wpv', 'pvIscMaxPerMpptA'), v('luxpower-sna6000wpv', 'efficiencyMax')]).toEqual([480, 25, 0.93]);
    expect([v('dyness-dl5-0c', 'maxChargeA'), v('dyness-dl5-0c', 'maxDischargeA'), v('dyness-dl5-0c', 'usableWh')]).toEqual([75, 100, 4608]);
    expect([v('victron-mppt-150-45', 'iMaxA'), v('victron-mppt-150-45', 'pvIscMaxA'), v('victron-mppt-150-45', 'ratedW')]).toEqual([45, 50, 2600]);
  });
  test('bộ lọc theo loại và văn bản', () => {
    expect(filterComponents(BUILTIN_COMPONENTS, { text: 'dyness' }).map((c) => c.modelId)).toEqual(['dyness-dl5-0c']);
    expect(filterComponents(BUILTIN_COMPONENTS, { kind: 'all' }).length).toBe(BUILTIN_COMPONENTS.length);
  });
});

describe('kiểm tra ngữ nghĩa', () => {
  const base = findComponent(BUILTIN_COMPONENTS, { modelId: 'vsun-620', revision: 1 })!;
  const edit = (f: (c: typeof base) => void) => { const c = structuredClone(base); f(c); return validateComponent(c); };
  test('Voc ≤ Vmp, Isc < Imp, min > max, đơn vị lưu sai, số âm', () => {
    expect(edit((c) => { c.specs.vocV.v = 40; })[0]).toMatchObject({ code: 'VOC_NOT_ABOVE_VMP', field: '/specs/vocV/v' });
    expect(edit((c) => { c.specs.iscA.v = 10; })[0].code).toBe('ISC_BELOW_IMP');
    expect(edit((c) => { c.specs.impA.u = 'mA'; })[0]).toMatchObject({ code: 'UNIT_MISMATCH', field: '/specs/impA/u' });
    expect(edit((c) => { c.specs.pstcW.v = -1; })[0].code).toBe('NEGATIVE');
    const inv = structuredClone(findComponent(BUILTIN_COMPONENTS, { modelId: 'luxpower-sna6000wpv', revision: 1 })!);
    inv.specs.mpptVminV.v = 400;
    expect(validateComponent(inv)[0]).toMatchObject({ code: 'RANGE_INVERTED', field: '/specs/mpptVminV/v' });
  });
  test('tham chiếu hỏng và chuỗi rỗng bị schema chặn', () => {
    expect(edit((c) => { c.name = ''; })[0]).toMatchObject({ code: 'SCHEMA', field: '/name' });
  });
  test('nhân bản giữ nguồn gốc và đổi hash khi sửa kỹ thuật, không đổi khi chỉ sửa ghi chú', async () => {
    const copy = cloneForEdit(base, 'mdl-x', 'tester', '2026-11-19T00:00:00Z');
    expect(copy).toMatchObject({ modelId: 'mdl-x', revision: 1, derivedFrom: { modelId: 'vsun-620', revision: 1 } });
    const h0 = await technicalHash(copy);
    expect(await technicalHash({ ...copy, notes: 'khác', author: 'x' })).toBe(h0);
    const c2 = structuredClone(copy); c2.specs.pstcW.v = 625;
    expect(await technicalHash(c2)).not.toBe(h0);
  });
});
