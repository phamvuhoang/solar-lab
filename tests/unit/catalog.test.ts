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
    expect(full.map((c) => c.modelId)).toEqual(['vsun-620', 'hestia-650']);
    expect(findComponent(BUILTIN_COMPONENTS, { modelId: 'used-battery', revision: 1 })?.condition).toBe('used');
  });
  test('họ chưa rõ biến thể vẫn hiện, ghi đúng trường còn thiếu', () => {
    const h630 = findComponent(BUILTIN_COMPONENTS, { modelId: 'hestia-630', revision: 1 })!;
    const caps = Object.fromEntries(capabilities(h630).map((s) => [s.id, s]));
    expect(caps['nominal-power'].ok).toBe(true);
    expect(caps['string-voltage'].missing).toEqual(['vocV', 'vmpV']);
    const inv = findComponent(BUILTIN_COMPONENTS, { modelId: 'luxpower-sna6000wpv', revision: 1 })!;
    expect(capabilities(inv).find((s) => s.id === 'isc-limit')).toMatchObject({ ok: false, missing: ['pvIscMaxPerMpptA'] });
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
