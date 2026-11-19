import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateBom } from '../src/cost/bom.ts';

const panels = { id: 'vsun-620', quantity: 8, priceMinor: '1984000', currency: 'VND' };
const battery = { id: 'used-battery', quantity: 1, priceMinor: '16000000', currency: 'VND' };

test('Lâm Hà: tám tấm và bộ pin theo báo giá trong dự án', () => {
  assert.deepEqual(calculateBom([panels, battery], 'VND'), { totalMinor: '31872000', missingIds: [] });
});
test('giá chưa có giữ trạng thái thiếu', () => {
  assert.deepEqual(calculateBom([panels, { ...battery, priceMinor: null }], 'VND'),
    { totalMinor: null, missingIds: ['used-battery'] });
});
test('từ chối cộng lẫn tiền tệ', () => {
  assert.throws(() => calculateBom([{ ...battery, currency: 'USD' }], 'VND'), /CURRENCY_CONVERSION_REQUIRED/);
});
test('số lượng theo chiếc phải là số nguyên dương', () => {
  assert.throws(() => calculateBom([{ ...panels, quantity: 1.5 }], 'VND'), /INVALID_QUANTITY/);
});
