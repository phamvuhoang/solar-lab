import { expect, test } from 'vitest';
import { parseLocation } from '../../src/ui/location';
import { buildSampleHouse } from '../../src/domain/seed';
import type { Project } from '../../src/domain/types';
import { assumptionsOf } from '../../src/ui/assumptions';
import { BUNDLED_WEATHER, loadBundledWeather } from '../../src/weather/bundled';
import { farWeather, kmBetween, NEAR_KM, nearestBundled } from '../../src/weather/nearest';

test('khoảng cách: Lâm Hà–TP.HCM ≈ 207 km; cùng điểm = 0', () => {
  expect(kmBetween({ latitude: 11.87, longitude: 108.2 }, { latitude: 10.82, longitude: 106.63 })).toBeCloseTo(207.2, 0);
  expect(kmBetween({ latitude: 11.87, longitude: 108.2 }, { latitude: 11.87, longitude: 108.2 })).toBe(0);
});
test('bộ gần nhất: Lâm Hà trùng điểm; Hà Nội xa hơn NEAR_KM', async () => {
  expect(nearestBundled(11.87, 108.2)).toMatchObject({ id: 'lam-ha-2023-pvgis-era5', km: 0 });
  expect(nearestBundled(21.03, 105.85)!.km).toBeGreaterThan(NEAR_KM);
});
test('tọa độ chép trong BUNDLED_WEATHER đúng bằng đầu file CSV của bộ đó', async () => {
  for (const b of BUNDLED_WEATHER) {
    const r = await loadBundledWeather(b.id);
    expect(r?.ok && r.series.location, b.id).toMatchObject(b.location);
  }
});
test('nơi lắp xa bộ thời tiết đang dùng: biết ngay khi vẽ (không chờ lần lưu), và có trong "Giả định đang dùng"', () => {
  const near = buildSampleHouse(), far: Project = { ...near, location: { ...near.location!, latitude: 21.03, longitude: 105.85 } }; // Hà Nội
  expect(farWeather(near)).toBeNull();
  expect(farWeather(far)).toMatchObject({ label: expect.stringContaining('Lâm Hà') });
  expect(farWeather(far)!.km).toBeGreaterThan(NEAR_KM);
  expect(farWeather({ ...far, pv: { ...far.pv, weatherId: 'wx-imported' } })).toBeNull(); // an imported dataset is the site's own
  expect(farWeather({ ...far, location: null })).toBeNull();
  expect(assumptionsOf(near).join('\n')).not.toContain('cách nơi lắp');
  expect(assumptionsOf(far).join('\n')).toMatch(/Bộ thời tiết ".*Lâm Hà.*" cách nơi lắp [\d.]+ km: kết quả sẽ lệch/);
});
test('nhập tọa độ: dấu phẩy như dấu chấm; ngoài phạm vi hoặc chữ thì báo lỗi, không đoán', () => {
  expect(parseLocation('11,87', '108,2')).toEqual({ ok: true, latitude: 11.87, longitude: 108.2 });
  expect(parseLocation('11.87', '108.2')).toEqual({ ok: true, latitude: 11.87, longitude: 108.2 });
  expect(parseLocation('95', '108')).toMatchObject({ ok: false, message: expect.stringContaining('Vĩ độ') });
  expect(parseLocation('11', '200')).toMatchObject({ ok: false, message: expect.stringContaining('Kinh độ') });
  expect(parseLocation('abc', '108')).toMatchObject({ ok: false });
  // three decimals with a dot are decimal degrees, not thousands (TP.HCM); what the form writes back reads back the same
  expect(parseLocation('10.823', '106.629')).toEqual({ ok: true, latitude: 10.823, longitude: 106.629 });
  expect(parseLocation(String(-33.865), String(151.209))).toEqual({ ok: true, latitude: -33.865, longitude: 151.209 });
  expect(parseLocation('−8,5', '115,25')).toEqual({ ok: true, latitude: -8.5, longitude: 115.25 });
  expect(parseLocation('1.234,5', '108')).toMatchObject({ ok: false });
});
