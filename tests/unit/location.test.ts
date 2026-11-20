import { expect, test } from 'vitest';
import { parseLocation } from '../../src/ui/location';
import { kmBetween, NEAR_KM, nearestBundled } from '../../src/weather/nearest';

test('khoảng cách: Lâm Hà–TP.HCM ≈ 207 km; cùng điểm = 0', () => {
  expect(kmBetween({ latitude: 11.87, longitude: 108.2 }, { latitude: 10.82, longitude: 106.63 })).toBeCloseTo(207.2, 0);
  expect(kmBetween({ latitude: 11.87, longitude: 108.2 }, { latitude: 11.87, longitude: 108.2 })).toBe(0);
});
test('bộ gần nhất: Lâm Hà trùng điểm; Hà Nội xa hơn NEAR_KM', async () => {
  expect(await nearestBundled(11.87, 108.2)).toMatchObject({ id: 'lam-ha-2023-pvgis-era5', km: 0 });
  expect((await nearestBundled(21.03, 105.85))!.km).toBeGreaterThan(NEAR_KM);
});
test('nhập tọa độ: dấu phẩy như dấu chấm; ngoài phạm vi hoặc chữ thì báo lỗi, không đoán', () => {
  expect(parseLocation('11,87', '108,2')).toEqual({ ok: true, latitude: 11.87, longitude: 108.2 });
  expect(parseLocation('11.87', '108.2')).toEqual({ ok: true, latitude: 11.87, longitude: 108.2 });
  expect(parseLocation('95', '108')).toMatchObject({ ok: false, message: expect.stringContaining('Vĩ độ') });
  expect(parseLocation('11', '200')).toMatchObject({ ok: false, message: expect.stringContaining('Kinh độ') });
  expect(parseLocation('abc', '108')).toMatchObject({ ok: false });
});
