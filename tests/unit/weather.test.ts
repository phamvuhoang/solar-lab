import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseWeatherCsv } from '../../src/weather/csv';
import { formatUtc, localDate, parseTimestamp, yearLengthDays } from '../../src/weather/series';

const META = (extra: Record<string, string> = {}) => Object.entries({
  latitude: '11.87', longitude: '108.2', elevation_m: '978', source: 'test', method: 'synthetic', period: '2023', timestamp_convention: 'start', step_seconds: '3600', ...extra,
}).map(([k, v]) => `# ${k}: ${v}`).join('\n');
const HEAD = 'timestamp_utc,ghi_wm2,dni_wm2,dhi_wm2,poa_wm2,temp_air_c,wind_ms';
const csv = (rows: string[], meta = META(), head = HEAD) => `${meta}\n${head}\n${rows.join('\n')}\n`;
const hourly = (startMs: number, n: number, row = (k: number) => `${k % 24 === 12 ? 800 : 0},0,0,,20,1`) =>
  Array.from({ length: n }, (_, k) => `${formatUtc(startMs / 1000 + k * 3600)},${row(k)}`);
const codes = (r: ReturnType<typeof parseWeatherCsv>) => r.issues.map((i) => i.code);

describe('timestamp', () => {
  test('chỉ nhận ISO 8601 có múi giờ và ngày có thật', () => {
    expect(parseTimestamp('2023-01-01T00:30:00Z')?.epoch).toBe(Date.UTC(2023, 0, 1, 0, 30) / 1000);
    expect(parseTimestamp('2023-01-01T07:00:00+07:00')?.epoch).toBe(Date.UTC(2023, 0, 1) / 1000);
    for (const bad of ['2023-01-01T00:00:00', '2023-02-29T00:00:00Z', '2023-13-01T00:00:00Z', '01/02/2023', '2023-01-01T24:00:00Z']) expect(parseTimestamp(bad), bad).toBeNull();
    expect(parseTimestamp('2024-02-29T00:00:00Z')).not.toBeNull();
  });
  test('năm nhuận có 366 ngày; ngày địa phương theo múi giờ dự án', () => {
    expect([yearLengthDays(2023), yearLengthDays(2024), yearLengthDays(1900), yearLengthDays(2000)]).toEqual([365, 366, 365, 366]);
    expect(localDate(Date.UTC(2023, 0, 1, 20) / 1000, 'Asia/Ho_Chi_Minh')).toBe('2023-01-02'); // 20:00 UTC = 03:00 +07
  });
});

describe('parseWeatherCsv', () => {
  test('chuỗi hợp lệ: chuẩn hóa về đầu khoảng UTC, bỏ cột POA trống', () => {
    const r = parseWeatherCsv(csv(hourly(Date.UTC(2023, 0, 1), 48)));
    expect(r.ok && r.series).toMatchObject({ n: 48, stepSeconds: 3600, t0: Date.UTC(2023, 0, 1) / 1000, poa: null, ghi: expect.any(Array) });
    expect(r.ok && r.series.location).toEqual({ latitude: 11.87, longitude: 108.2, elevationM: 978 });
  });
  test('timestamp giữa khoảng được dịch về đầu khoảng và ghi chú lại', () => {
    const r = parseWeatherCsv(csv(hourly(Date.UTC(2023, 0, 1, 0, 30), 3), META({ timestamp_convention: 'mid' })));
    expect(r.ok && r.series.t0).toBe(Date.UTC(2023, 0, 1) / 1000);
    expect(r.ok && r.series.notes[0]).toContain('đầu khoảng');
  });
  test('múi giờ khác UTC được đổi về UTC', () => {
    const r = parseWeatherCsv(csv(['2023-01-01T07:00:00+07:00,0,0,0,,20,1', '2023-01-01T08:00:00+07:00,0,0,0,,20,1']));
    expect(r.ok && r.series.t0).toBe(Date.UTC(2023, 0, 1) / 1000);
  });
  test('timestamp trùng, lùi, thiếu bước, sai bước', () => {
    const t = (h: number, m = 0) => `2023-01-01T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z,0,0,0,,20,1`;
    const dup = parseWeatherCsv(csv([t(0), t(1), t(1), t(2)]));
    expect(codes(dup)).toContain('DUPLICATE_TIMESTAMP');
    expect(dup.issues.find((i) => i.code === 'DUPLICATE_TIMESTAMP')?.field).toBe('/rows/12'); // 8 dòng meta + 1 header + dòng dữ liệu thứ 3
    expect(codes(parseWeatherCsv(csv([t(0), t(1), t(0)])))).toContain('NOT_MONOTONIC');
    const gap = parseWeatherCsv(csv([t(0), t(1), t(4)]));
    expect(gap.issues.find((i) => i.code === 'GAP')?.message).toContain('Thiếu 2 bước sau 2023-01-01T01:00:00Z');
    expect(codes(parseWeatherCsv(csv([t(0), t(1, 30)])))).toContain('STEP_MISMATCH');
  });
  test('năm nhuận: 8784 giờ trọn năm 2024 hợp lệ; bỏ 29/2 là khoảng trống', () => {
    const full = parseWeatherCsv(csv(hourly(Date.UTC(2024, 0, 1), 8784)));
    expect(full.ok).toBe(true);
    expect(full.issues.find((i) => i.code === 'FULL_YEAR')?.message).toContain('366 ngày');
    const skip = hourly(Date.UTC(2024, 0, 1), 8784).filter((l) => !l.startsWith('2024-02-29'));
    const bad = parseWeatherCsv(csv(skip));
    expect(bad.ok).toBe(false);
    expect(bad.issues.find((i) => i.code === 'GAP')?.message).toContain('Thiếu 24 bước sau 2024-02-28T23:00:00Z');
    expect(parseWeatherCsv(csv(hourly(Date.UTC(2023, 0, 1), 8760))).issues.find((i) => i.code === 'FULL_YEAR')?.message).toContain('365 ngày');
  });
  test('giá trị ngoài phạm vi, không phải số, thiếu một phần', () => {
    expect(codes(parseWeatherCsv(csv(['2023-01-01T00:00:00Z,-5,0,0,,20,1'])))).toContain('OUT_OF_RANGE');
    expect(codes(parseWeatherCsv(csv(['2023-01-01T00:00:00Z,9999,0,0,,20,1'])))).toContain('OUT_OF_RANGE');
    expect(codes(parseWeatherCsv(csv(['2023-01-01T00:00:00Z,abc,0,0,,20,1'])))).toContain('NOT_A_NUMBER');
    expect(codes(parseWeatherCsv(csv(['2023-01-01T00:00:00Z,0,0,0,,20,1', '2023-01-01T01:00:00Z,0,0,0,,,1'])))).toContain('MISSING_VALUE');
    expect(codes(parseWeatherCsv(csv(['2023-01-01T00:00:00Z,0,0,0,,100,1'])))).toContain('OUT_OF_RANGE'); // 100 °C
  });
  test('thiếu metadata, thiếu cột bức xạ, thiếu gió: từ chối hoặc cảnh báo tên trường', () => {
    const noMeta = parseWeatherCsv(csv(['2023-01-01T00:00:00Z,0,0,0,,20,1'], META({ latitude: '' }).replace('# latitude: \n', '')));
    expect(noMeta.issues.find((i) => i.code === 'META_MISSING')?.field).toBe('/meta/latitude');
    const noIrr = parseWeatherCsv(csv(['2023-01-01T00:00:00Z,20'], META(), 'timestamp_utc,temp_air_c'));
    expect(codes(noIrr)).toContain('IRRADIANCE_MISSING');
    const noWind = parseWeatherCsv(csv(['2023-01-01T00:00:00Z,0,0,0,20'], META(), 'timestamp_utc,ghi_wm2,dni_wm2,dhi_wm2,temp_air_c'));
    expect(noWind.ok && noWind.series.windMs).toBeNull();
    expect(codes(noWind)).toContain('WIND_ABSENT');
    expect(parseWeatherCsv(csv([], META({ method: 'guess', latitude: '95' }))).issues.map((i) => i.field)).toEqual(expect.arrayContaining(['/meta/method', '/meta/latitude']));
  });
  test('file quá lớn, rỗng, dòng sai độ rộng; giới hạn số lỗi báo', () => {
    expect(codes(parseWeatherCsv(' '.repeat(25_000_001)))).toEqual(['TOO_LARGE']);
    expect(codes(parseWeatherCsv(''))).toEqual(['EMPTY']);
    expect(codes(parseWeatherCsv(csv(['2023-01-01T00:00:00Z,1,2'])))).toContain('ROW_WIDTH');
    const many = parseWeatherCsv(csv(Array.from({ length: 60 }, (_, k) => `2023-01-01T00:00:00Z,abc${k},0,0,,20,1`)));
    expect(many.issues.filter((i) => i.code === 'NOT_A_NUMBER')).toHaveLength(21);
  });
  test('dataset Lâm Hà đóng gói: hợp lệ, trọn năm 2023, nguồn và giấy phép được ghi', () => {
    const r = parseWeatherCsv(readFileSync(new URL('../../data/weather/lam-ha-2023-pvgis-era5.csv', import.meta.url), 'utf8'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.series).toMatchObject({ n: 8760, stepSeconds: 3600, t0: Date.UTC(2023, 0, 1) / 1000, source: { method: 'historical', period: '2023' }, poa: null });
    expect(r.series.source.name).toContain('PVGIS-ERA5');
    expect(r.series.source.license).toContain('NOT yet confirmed');
    expect(r.issues.map((i) => i.code)).toContain('FULL_YEAR');
    expect(r.series.notes[0]).toContain('đầu khoảng');
  });
  test('template.csv đọc được', () => {
    expect(parseWeatherCsv(readFileSync(new URL('../../data/weather/template.csv', import.meta.url), 'utf8')).ok).toBe(true);
  });
});
