import type { Issue } from '../domain/validate';
import { formatUtc, parseTimestamp, yearLengthDays, type Convention, type WeatherMethod, type WeatherSeries } from './series';

export const MAX_WEATHER_BYTES = 25_000_000;
const MAX_REPORTED = 20;

const COLUMNS = { ghi_wm2: 'ghi', dni_wm2: 'dni', dhi_wm2: 'dhi', poa_wm2: 'poa', temp_air_c: 'tempAirC', wind_ms: 'windMs' } as const;
type Col = (typeof COLUMNS)[keyof typeof COLUMNS];
const RANGE: Record<Col, [number, number]> = { ghi: [0, 1500], dni: [0, 1400], dhi: [0, 1200], poa: [0, 1800], tempAirC: [-90, 60], windMs: [0, 80] };
const METHODS: WeatherMethod[] = ['measured', 'historical', 'tmy', 'synthetic'];
const CONVENTIONS: Convention[] = ['start', 'mid', 'end'];

export type ParseResult = { ok: true; series: WeatherSeries; issues: Issue[] } | { ok: false; issues: Issue[] };
type Add = (code: string, severity: Issue['severity'], field: string, message: string) => void;

/**
 * Weather CSV → canonical UTC series. Input problems are reported here (code, row, column), never inside the PV model.
 * Format: leading "# key: value" metadata lines, one header row, then rows (see data/weather/template.csv).
 */
export function parseWeatherCsv(text: string, opts: { seriesId?: string } = {}): ParseResult {
  const issues: Issue[] = [];
  const add: Add = (code, severity, field, message) => issues.push({ code, severity, field, message });
  const fail = (code: string, field: string, message: string): ParseResult => { add(code, 'error', field, message); return { ok: false, issues }; };

  if (new TextEncoder().encode(text).length > MAX_WEATHER_BYTES) return fail('TOO_LARGE', '/', `File lớn hơn ${MAX_WEATHER_BYTES / 1e6} MB`);
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const meta = new Map<string, string>();
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (!l.startsWith('#')) break;
    const m = /^#\s*([a-z_]+)\s*:\s*(.*)$/.exec(l);
    if (m) meta.set(m[1], m[2].trim());
  }
  if (i >= lines.length) return fail('EMPTY', '/', 'File không có dòng tiêu đề cột');

  // ---- metadata
  const need = (k: string) => { const v = meta.get(k); if (!v) add('META_MISSING', 'error', `/meta/${k}`, `Thiếu "# ${k}: ..." ở đầu file`); return v; };
  const num = (k: string, lo: number, hi: number, required = true) => {
    const v = required ? need(k) : meta.get(k);
    if (v === undefined || v === '') return null;
    const n = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
    if (!(n >= lo && n <= hi)) { add('META_INVALID', 'error', `/meta/${k}`, `${k}="${v}" cần là số trong [${lo}, ${hi}]`); return null; }
    return n;
  };
  const lat = num('latitude', -90, 90), lon = num('longitude', -180, 180), step = num('step_seconds', 1, 86400);
  const elev = num('elevation_m', -500, 9000, false);
  if (step !== null && !Number.isInteger(step)) add('META_INVALID', 'error', '/meta/step_seconds', 'step_seconds phải là số nguyên');
  const method = need('method') as WeatherMethod | undefined, conv = need('timestamp_convention') as Convention | undefined, source = need('source');
  if (method && !METHODS.includes(method)) add('META_INVALID', 'error', '/meta/method', `method phải là ${METHODS.join('|')}`);
  if (conv && !CONVENTIONS.includes(conv)) add('META_INVALID', 'error', '/meta/timestamp_convention', `timestamp_convention phải là ${CONVENTIONS.join('|')} (timestamp là đầu, giữa hay cuối khoảng)`);

  // ---- header
  const header = lines[i].split(',').map((c) => c.trim());
  i++;
  if (header[0] !== 'timestamp_utc') add('HEADER_INVALID', 'error', '/header/0', 'Cột đầu tiên phải là timestamp_utc');
  const colIdx = new Map<Col, number>();
  header.forEach((h, k) => {
    if (h in COLUMNS) colIdx.set(COLUMNS[h as keyof typeof COLUMNS], k);
    else if (k > 0) add('UNKNOWN_COLUMN', 'warning', `/header/${k}`, `Bỏ qua cột "${h}"`);
  });
  if (new Set(header).size !== header.length) add('HEADER_INVALID', 'error', '/header', 'Có cột trùng tên');
  if (issues.some((x) => x.severity === 'error')) return { ok: false, issues };

  // ---- rows
  const epochs: number[] = [];
  const lineOf: number[] = []; // file line of each parsed row, for error positions
  const cols = new Map<Col, (number | null)[]>([...colIdx.keys()].map((c) => [c, []]));
  const counts = new Map<string, number>();
  const report = (code: string, field: string, message: string, severity: Issue['severity'] = 'error') => {
    const n = (counts.get(code) ?? 0) + 1;
    counts.set(code, n);
    if (n <= MAX_REPORTED) add(code, severity, field, message);
  };
  let offsetSeen = false;
  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const line = i + 1;
    const cells = raw.split(',').map((c) => c.trim());
    if (cells.length !== header.length) { report('ROW_WIDTH', `/rows/${line}`, `Dòng ${line}: ${cells.length} ô, cần ${header.length}`); continue; }
    const ts = parseTimestamp(cells[0]);
    if (!ts) { report('INVALID_TIMESTAMP', `/rows/${line}/timestamp_utc`, `Dòng ${line}: "${cells[0]}" không phải thời điểm ISO 8601 có múi giờ (Z hoặc ±hh:mm) hợp lệ`); continue; }
    offsetSeen ||= ts.offset;
    epochs.push(ts.epoch);
    lineOf.push(line);
    for (const [c, k] of colIdx) {
      const cell = cells[k];
      if (cell === '') { cols.get(c)!.push(null); continue; }
      const n = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cell) ? Number(cell) : NaN;
      if (!Number.isFinite(n)) { report('NOT_A_NUMBER', `/rows/${line}/${header[k]}`, `Dòng ${line}: "${cell}" không phải số`); cols.get(c)!.push(null); continue; }
      const [lo, hi] = RANGE[c];
      if (n < lo || n > hi) report('OUT_OF_RANGE', `/rows/${line}/${header[k]}`, `Dòng ${line}: ${header[k]}=${n} ngoài khoảng [${lo}, ${hi}]`);
      cols.get(c)!.push(n);
    }
  }
  for (const [code, n] of counts) if (n > MAX_REPORTED) add(code, 'error', '/rows', `... và ${n - MAX_REPORTED} lỗi ${code} nữa`);
  if (!epochs.length) return fail('EMPTY', '/rows', 'Không có dòng dữ liệu hợp lệ');

  // A column that is empty everywhere does not exist; partially empty is an error (no silent filling).
  for (const [c, vals] of [...cols]) {
    if (vals.every((v) => v === null)) { cols.delete(c); continue; }
    const missing = vals.filter((v) => v === null).length;
    if (missing && !counts.has('NOT_A_NUMBER')) add('MISSING_VALUE', 'error', `/columns/${c}`, `Cột ${c} thiếu ${missing}/${vals.length} giá trị; điền đủ hoặc bỏ trống cả cột`);
  }

  // ---- time axis: duplicates, order, gaps (leap days included: a missing Feb 29 is a gap)
  const dt = step ?? 0;
  let gaps = 0, firstGap = '';
  for (let k = 1; k < epochs.length; k++) {
    const d = epochs[k] - epochs[k - 1];
    if (d === 0) report('DUPLICATE_TIMESTAMP', `/rows/${lineOf[k]}`, `Thời điểm trùng ${formatUtc(epochs[k])}`);
    else if (d < 0) report('NOT_MONOTONIC', `/rows/${lineOf[k]}`, `Thời gian lùi: ${formatUtc(epochs[k - 1])} → ${formatUtc(epochs[k])}`);
    else if (d !== dt) {
      if (d % dt === 0) { gaps += d / dt - 1; firstGap ||= formatUtc(epochs[k - 1] + dt); report('GAP', `/rows/${lineOf[k]}`, `Thiếu ${d / dt - 1} bước sau ${formatUtc(epochs[k - 1])}`); }
      else report('STEP_MISMATCH', `/rows/${lineOf[k]}`, `Khoảng cách ${d} s khác step_seconds=${dt}`);
    }
  }
  if (issues.some((x) => x.severity === 'error')) return { ok: false, issues };

  // ---- consistency warnings
  const ghi = cols.get('ghi'), dhi = cols.get('dhi');
  if (ghi && dhi) {
    const bad = ghi.filter((g, k) => g! < dhi[k]! - 5).length;
    if (bad) add('INCONSISTENT_IRRADIANCE', 'warning', '/columns/ghi', `${bad} dòng có GHI nhỏ hơn DHI quá 5 W/m²`);
  }
  const hasIrr = (cols.has('ghi') && cols.has('dhi')) || (cols.has('dni') && cols.has('dhi')) || (cols.has('ghi') && cols.has('dni')) || cols.has('poa');
  if (!hasIrr) return fail('IRRADIANCE_MISSING', '/columns', 'Cần ít nhất GHI+DHI, DNI+DHI, GHI+DNI hoặc POA. Chọn phương pháp ước tính có tên hoặc bổ sung dữ liệu.');
  if (!cols.has('tempAirC')) add('AIR_TEMP_ABSENT', 'warning', '/columns/temp_air_c', 'Không có nhiệt độ không khí: chỉ chạy được khi dùng nhiệt độ cell cố định');
  if (!cols.has('windMs')) add('WIND_ABSENT', 'warning', '/columns/wind_ms', 'Không có tốc độ gió: cần khai gió dự phòng có tên khi chạy mô hình Faiman');

  // ---- canonical form: interval start, UTC
  const shift = conv === 'mid' ? -dt / 2 : conv === 'end' ? -dt : 0;
  const notes: string[] = [];
  if (shift) notes.push(`Dịch timestamp ${shift} s: file ghi ${conv === 'mid' ? 'giữa' : 'cuối'} khoảng, chuẩn hóa về đầu khoảng`);
  if (offsetSeen) notes.push('Có timestamp theo múi giờ khác UTC, đã đổi về UTC');
  const t0 = epochs[0] + shift;
  const year = new Date(t0 * 1000).getUTCFullYear();
  if (Date.UTC(year, 0, 1) / 1000 === t0 && epochs.length * dt === yearLengthDays(year) * 86400) add('FULL_YEAR', 'info', '/', `Phủ trọn năm ${year} UTC (${yearLengthDays(year)} ngày)`);
  const g = (c: Col) => cols.get(c) as number[] | undefined ?? null;
  return {
    ok: true, issues,
    series: {
      schemaVersion: 1, seriesId: opts.seriesId ?? `wx-${meta.get('period') ?? formatUtc(t0).slice(0, 10)}`, name: meta.get('name') ?? 'Chuỗi thời tiết',
      location: { latitude: lat!, longitude: lon!, elevationM: elev },
      source: { name: source!, version: meta.get('source_version') ?? null, url: meta.get('source_url') ?? null, retrieved: meta.get('retrieved') ?? null, method: method!, period: meta.get('period') ?? null, license: meta.get('license') ?? null },
      stepSeconds: dt, t0, n: epochs.length, ghi: g('ghi'), dni: g('dni'), dhi: g('dhi'), poa: g('poa'), tempAirC: g('tempAirC'), windMs: g('windMs'), notes,
    },
  };
}
