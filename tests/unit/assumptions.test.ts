import { expect, test } from 'vitest';
import { Lru } from '../../src/app/autorun';
import { runAuto } from '../../src/app/auto-sim';
import { createProject } from '../../src/domain/project';
import { buildSampleHouse } from '../../src/domain/seed';
import { REASONS } from '../../src/engine/dispatch';
import { simulateSystem, type SimResult } from '../../src/engine/system';
import { daysShort } from '../../src/reports/days';
import { computeShade } from '../../src/shade/sampler';
import { assumptionsOf } from '../../src/ui/assumptions';
import { loadBundledWeather } from '../../src/weather/bundled';

const T = '2026-11-20T00:00:00.000Z';

test('Nhà mẫu: giả định đang dùng, chỉ đọc, đủ mọi mục', () => {
  const a = assumptionsOf(buildSampleHouse(T)).join('\n');
  for (const x of ['Tcell lạnh 5 °C', 'nóng 70 °C', 'Giả định minh họa', 'Hệ số Isc 1', 'βVmp giả định: chưa đặt',
    'Khoảng lùi mép Mái Nam (minh họa): 0,3 m (giả định)', 'Khoảng lùi mép Mái Bắc (minh họa): 0,3 m (giả định)',
    'Dự phòng SoC 20 %', 'SoC đầu 50 %', 'Hiệu suất sạc 95 %, xả 95 %, inverter theo datasheet', 'Lưới: được nhập, không bán',
    'bóng che: xem trước', 'Bộ thời tiết: Lâm Hà']) expect(a).toContain(x);
});

test('dự án trống: nói là chưa đặt, không bịa số', () => {
  const a = assumptionsOf(createProject('x', T)).join('\n');
  for (const x of ['Tcell lạnh chưa đặt', 'nóng chưa đặt', 'Lưới: không có', 'Bóng che: không bật', 'Bộ thời tiết: chưa chọn']) expect(a).toContain(x);
  expect(a).not.toContain('Khoảng lùi mép');
});

/** The sample house's own automatic run, in process. */
async function sampleRun(): Promise<SimResult> {
  const a = await runAuto(buildSampleHouse(T), {
    loadWeather: async (id) => { const r = await loadBundledWeather(id); return r?.ok ? r.series : undefined; },
    runner: { pv: async () => null, shade: async (spec) => (await computeShade(spec, null))?.field ?? null, sim: async (input, hash) => { const o = await simulateSystem(input, hash); return o?.ok ? o.result : null; } },
    cache: new Lru<SimResult>(1), signal: new AbortController().signal,
  });
  if (a.kind !== 'done') throw new Error(JSON.stringify(a));
  return a.result;
}

test('daysShort: đếm lại chuỗi theo giờ, chỉ ngày địa phương đủ 24 bước', async () => {
  const r = await sampleRun();
  // UTC 2023 → giờ Việt Nam: 01/01/2023 có 17 giờ, 01/01/2024 có 7 giờ; hai ngày đó không tính
  expect(daysShort(r, 'Asia/Ho_Chi_Minh')).toEqual({ short: 0, days: 364 });
  expect(daysShort(r, 'UTC')).toEqual({ short: 0, days: 365 });

  const s = r.dispatch.series, bit = 1 << REASONS.indexOf('UNSERVED_LOAD'), reasons = s.reasons.slice();
  reasons[0] |= bit; // 07:00 01/01/2023 giờ địa phương: ngày thiếu dữ liệu, không tính
  reasons[100] |= bit; reasons[101] |= bit; // 11:00 và 12:00 ngày 05/01/2023: một ngày
  expect(daysShort({ ...r, dispatch: { ...r.dispatch, series: { ...s, reasons } } }, 'Asia/Ho_Chi_Minh')).toEqual({ short: 1, days: 364 });
}, 120_000);
