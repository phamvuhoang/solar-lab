import { describe, expect, test } from 'vitest';
import { formatNumber, parseMoney, parseQuantity } from '../../src/domain/units';

const ok = (text: string, dim: Parameters<typeof parseQuantity>[1], value: number, unit?: string) => {
  const r = parseQuantity(text, dim, { allowNegative: dim === 'coef' });
  expect(r).toMatchObject({ ok: true, value, ...(unit ? { unit } : {}) });
};

describe('parseQuantity', () => {
  test('dấu phẩy thập phân, dấu chấm hàng nghìn, đổi về đơn vị lưu', () => {
    ok('51,2 V', 'V', 51.2, 'V');
    ok('165', 'Ah', 165);
    ok('8,448 kWh', 'Wh', 8448, 'Wh');
    ok('1.984.000', 'W', 1984000);
    ok('2382 mm', 'm', 2.382, 'm');
    ok('95 %', 'ratio', 0.95);
    ok('-0,24 %/°C', 'coef', -0.0024);
    ok('1,5 kW', 'W', 1500);
  });
  test('từ chối rỗng, NaN, âm, sai đơn vị, số lẻ cho count', () => {
    const code = (t: string, d: Parameters<typeof parseQuantity>[1]) => { const r = parseQuantity(t, d); return r.ok ? 'OK' : r.code; };
    expect(code('', 'V')).toBe('EMPTY');
    expect(code('   ', 'V')).toBe('EMPTY');
    expect(code('abc', 'V')).toBe('NOT_A_NUMBER');
    expect(code('1,2,3', 'V')).toBe('NOT_A_NUMBER');
    expect(code('NaN', 'V')).toBe('NOT_A_NUMBER');
    expect(code('-5 V', 'V')).toBe('NEGATIVE');
    expect(code('165 V', 'Ah')).toBe('UNIT_MISMATCH');
    expect(code('2,5', 'count')).toBe('NOT_INTEGER');
  });
  test('formatNumber đọc lại đúng', () => {
    for (const v of [51.2, 8448, 0.0024, 1984000, 1234.5]) {
      const r = parseQuantity(formatNumber(v), 'W');
      expect(r.ok && r.value).toBe(v);
    }
  });
});

describe('parseMoney', () => {
  test('đồng nguyên, có dấu chấm/khoảng trắng nghìn và hậu tố đ', () => {
    for (const [t, m] of [['1.984.000', '1984000'], ['3200', '3200'], ['16 000 000 đ', '16000000'], ['15.500.000 VND', '15500000'], ['0', '0']])
      expect(parseMoney(t)).toEqual({ ok: true, minor: m });
  });
  test('từ chối rỗng, số lẻ, âm, chữ', () => {
    for (const t of ['', '  ', '1,5', '-100', 'abc', '1.2.3', '1e6']) expect(parseMoney(t).ok, t).toBe(false);
  });
});
