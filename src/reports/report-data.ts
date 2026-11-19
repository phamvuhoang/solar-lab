import { buildQuote, type Comparison, type Quote } from '../cost/quote';
import type { Project } from '../domain/types';
import type { PvResult } from '../engine/pv';
import { pvSettingsOf } from '../engine/compile';
import { simPolicyOf } from '../engine/sim-compile';
import type { SimResult } from '../engine/system';
import { shadeSettingsOf } from '../shade/sampler';
import { designOf, validateDesign, type Finding, type Status } from '../validation/strings';
import { localDate, localHour, type WeatherSeries } from '../weather/series';

/** `base` is the design that was run for side A (a stored revision); undefined for the current project. */
export interface ReportRun { label: 'A' | 'B'; title: string; result: SimResult; projectName: string; hash: string; base?: Project }
export interface ReportInput {
  project: Project; weather: WeatherSeries | null; weatherAttached: boolean; pv: PvResult | null; runs: ReportRun[];
  cost: Comparison | null; generatedAt: string; includeContact: boolean; engines: { pv: string; dispatch: string; shade: string }; buildId: string;
}
export type LevelState = 'done' | 'gaps' | 'not-run' | 'off' | 'out-of-scope';
export interface Level { name: string; state: LevelState; detail: string }
export interface ReportFacts {
  title: string; revision: number; generatedAt: string; owner: Project['owner'] | null; scope: string[];
  quote: { quote: Quote; date: string | null; validUntil: string | null; totalText: string; missingText: string[] };
  checks: { counts: Record<Status, number>; notable: Finding[] };
  levels: Level[]; assumptions: string[];
  weather: { name: string; source: string; method: string; period: string; license: string; retrieved: string; steps: number; attached: boolean } | null;
  monthly: { month: string; kWh: number }[] | null; typicalDay: { hours: number[]; avgW: number[] } | null;
  runs: ReportRun[]; socByHour: { label: string; title: string; avgPct: number[] }[]; cost: Comparison | null; energyNote: string | null;
  attached: { label: string; state: string }[];
}

const dateOnly = (s: string | null) => (s ? s.slice(0, 10) : null);
const max = (a: (string | null)[]) => a.filter(Boolean).sort().at(-1) ?? null;
const min = (a: (string | null)[]) => a.filter(Boolean).sort()[0] ?? null;

/** Everything the A4 report states, as plain data: no DOM, so tests can read exactly what the page will say. */
export function reportFacts(i: ReportInput): ReportFacts {
  const p = i.project, quote = buildQuote(p), tz = p.location?.timezone ?? 'Asia/Ho_Chi_Minh';
  const findings = validateDesign({ ...p, design: p.design });
  const counts: Record<Status, number> = { pass: 0, fail: 0, limited: 0, unknown: 0 };
  for (const f of findings) counts[f.status]++;
  const notable = findings.filter((f) => f.status !== 'pass').sort((a, b) => ({ fail: 0, limited: 1, unknown: 2, pass: 3 })[a.status] - ({ fail: 0, limited: 1, unknown: 2, pass: 3 })[b.status]);

  const used = new Set(p.priceSelections.map((s) => s.offerId));
  const offerDates = p.snapshots.offers.filter((o) => used.has(o.offerId));
  const qDate = max([...quote.lines.map((l) => l.recordedAt), ...offerDates.map((o) => o.recordedAt)]);
  const qUntil = min(offerDates.map((o) => o.validUntil));
  const money = (m: string) => `${Number(m).toLocaleString('vi-VN')} đ`;
  const missingText = [
    quote.missing.lineKeys.length && `${quote.missing.lineKeys.length} dòng chưa có giá`,
    quote.missing.scope.length && `thiếu hạng mục ${quote.missing.scope.join(', ')}`,
    quote.missing.unknownVatKeys.length && `${quote.missing.unknownVatKeys.length} dòng chưa rõ VAT`,
    quote.issues.some((x) => x.code === 'KIT_PART_NOT_IN_DESIGN') && 'kit ghi nhiều linh kiện hơn thiết kế có',
  ].filter(Boolean) as string[];

  let monthly: ReportFacts['monthly'] = null, typicalDay: ReportFacts['typicalDay'] = null;
  if (i.pv) {
    const step = i.pv.period.stepSeconds, byMonth = new Map<string, number>(), sum = new Array<number>(24).fill(0), cnt = new Array<number>(24).fill(0);
    i.pv.series.t.forEach((t, k) => {
      const mid = t + step / 2, m = localDate(mid, tz).slice(0, 7), hr = localHour(mid, tz), w = i.pv!.series.pInverterW[k];
      byMonth.set(m, (byMonth.get(m) ?? 0) + (w * step) / 3600 / 1000);
      sum[hr] += w; cnt[hr]++;
    });
    monthly = [...byMonth].map(([month, kWh]) => ({ month, kWh }));
    typicalDay = { hours: Array.from({ length: 24 }, (_, h) => h), avgW: sum.map((s, h) => (cnt[h] ? s / cnt[h] : 0)) };
  }

  const sh = shadeSettingsOf(p), pvs = pvSettingsOf(p), pol = simPolicyOf(p), des = designOf(p);
  const levels: Level[] = [
    { name: 'Dữ liệu dự án (cấu trúc, đơn vị, tham chiếu)', state: 'done', detail: 'Đã qua kiểm tra schema và tham chiếu chéo khi lưu/nhập.' },
    { name: 'Sơ đồ điện và chuỗi (datasheet)', state: counts.unknown || counts.limited ? 'gaps' : 'done', detail: `${counts.pass} đạt · ${counts.fail} không đạt · ${counts.limited} sát giới hạn · ${counts.unknown} chưa kiểm được (thiếu dữ liệu).` },
    { name: 'Mô phỏng PV theo giờ', state: i.pv ? 'done' : 'not-run', detail: i.pv ? `Engine ${i.pv.engineVersion}, mã đầu vào ${i.pv.inputHash.slice(0, 12)}.` : 'Chưa chạy cho báo cáo này.' },
    { name: 'Hệ thống pin, tải, bơm (dispatch)', state: i.runs.length ? (i.runs.every((r) => r.result.dispatch.ledger.toleranceOk) ? 'done' : 'gaps') : 'not-run',
      detail: i.runs.length ? `${i.runs[0].result.dispatch.version}; sổ năng lượng cân trong ngưỡng ở ${i.runs.filter((r) => r.result.dispatch.ledger.toleranceOk).length}/${i.runs.length} phương án.` : 'Chưa chạy cho báo cáo này.' },
    { name: 'Bóng che', state: i.pv?.shade ? 'done' : sh.enabled ? 'not-run' : 'off', detail: i.pv?.shade ? `${i.pv.shade.modelVersion}, ${i.pv.shade.samplesPerPanel} mẫu mỗi tấm, chuỗi tính ${i.pv.shade.stringMode === 'sum' ? 'cộng tấm' : 'tấm yếu nhất'}; bypass diode chưa giải.${i.pv.shade.notes.filter((n) => /chưa đặt lên mái/.test(n)).map((n) => ' ' + n).join('')}` : sh.enabled ? 'Bật nhưng kết quả này không kèm bóng.' : 'Không bật: kết quả giả định không bị che.' },
    { name: 'Thi công và an toàn', state: 'out-of-scope', detail: 'Ngoài phạm vi công cụ. Tiết diện dây, thiết bị bảo vệ, tiếp địa, vị trí lắp thực tế phải do người lắp xác nhận.' },
  ];

  const assumptions = [
    ...(des.source ? [`Thiết lập thiết kế: ${des.source}`] : []),
    `Nhiệt độ cell cho kiểm tra chuỗi: lạnh ${des.coldCellTempC ?? 'chưa đặt'} °C, nóng ${des.hotCellTempC ?? 'chưa đặt'} °C (người dùng đặt).`,
    `Mảng PV: nghiêng ${pvs.tiltDeg ?? 'chưa đặt'}°, hướng ${pvs.azimuthDeg ?? 'chưa đặt'}° (từ Bắc, theo chiều kim đồng hồ), albedo ${pvs.albedo}, tổn hao DC ${(Number(pvs.lossRatio) * 100).toLocaleString('vi-VN')} %, mô hình nhiệt ${pvs.cellModel}.`,
    `Chính sách hệ thống: SoC đầu ${(pol.soc0 * 100).toFixed(0)} %, dự phòng ${(pol.minSoc * 100).toFixed(0)} %, hiệu suất sạc/xả ${pol.etaCharge}/${pol.etaDischarge}, lưới ${pol.gridAvailable ? 'có' : 'không'}.`,
    ...new Set([...(i.pv?.assumptions ?? []), ...i.runs.flatMap((r) => [...r.result.pv.assumptions, ...r.result.dispatch.assumptions])]),
    ...[...new Set(i.runs.flatMap((r) => r.result.dispatch.skipped))].map((x) => `Không áp dụng: ${x}`),
  ];
  const w = i.weather;
  const [a, b] = i.runs.length === 2 ? i.runs : [null, i.runs[0] ?? null];
  const energyNote = a && b && Math.abs(a.result.dispatch.totals.eEndWh - b.result.dispatch.totals.eEndWh) > 1
    ? `Hai phương án kết thúc với năng lượng trong pin khác nhau: B ${b.result.dispatch.totals.eEndWh > a.result.dispatch.totals.eEndWh ? 'còn nhiều hơn' : 'còn ít hơn'} A ${(Math.abs(b.result.dispatch.totals.eEndWh - a.result.dispatch.totals.eEndWh) / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} kWh. Phần này chưa tính là điện đã cấp.` : null;
  const scope = [
    w ? `Kết luận chỉ đúng cho dữ liệu thời tiết "${w.name}" (${w.source.period ?? 'không rõ kỳ'}); không suy ra cho năm hay địa điểm khác.` : 'Chưa có dữ liệu thời tiết nên báo cáo không có kết quả sản lượng.',
    'Đây là ước tính thiết kế sơ bộ, không thay cho bản vẽ thi công hay khảo sát tại chỗ.',
    'Trạng thái kiểm chứng: đã đối chiếu mô hình (PV với pvlib, sổ năng lượng, hình học bóng); CHƯA đối chiếu thực địa vì chưa có phép đo công trình.',
    'Giá là giá trong báo giá đã nhập, theo ngày ghi; giá thiếu được giữ là thiếu, không ước lượng.',
  ];
  return {
    title: p.name, revision: p.revision, generatedAt: i.generatedAt, owner: i.includeContact ? (p.owner ?? null) : null, scope,
    quote: { quote, date: dateOnly(qDate), validUntil: dateOnly(qUntil), totalText: quote.totalMinor !== null ? money(quote.totalMinor) : `chưa đủ để báo tổng (${missingText.join('; ') || 'thiếu dữ liệu'})`, missingText },
    checks: { counts, notable }, levels, assumptions,
    weather: w ? { name: w.name, source: `${w.source.name}${w.source.version ? ' ' + w.source.version : ''}`, method: w.source.method, period: w.source.period ?? 'không rõ', license: w.source.license ?? 'chưa xác nhận', retrieved: w.source.retrieved ?? 'không rõ', steps: w.n, attached: i.weatherAttached } : null,
    monthly, typicalDay, runs: i.runs, cost: i.cost, energyNote,
    socByHour: i.runs.map((r) => {
      const d = r.result.dispatch, sum = new Array<number>(24).fill(0), cnt = new Array<number>(24).fill(0);
      d.series.t.forEach((t, k) => { const hr = localHour(t + d.period.stepSeconds / 2, tz); sum[hr] += d.series.socEnd[k] * 100; cnt[hr]++; });
      return { label: r.label, title: r.title, avgPct: sum.map((x, hr) => (cnt[hr] ? x / cnt[hr] : 0)) };
    }),
    attached: [
      { label: 'Dự án (thiết kế, hình học mái, chính sách)', state: 'đính kèm' },
      { label: 'Phiên bản catalog và báo giá đã dùng', state: 'đính kèm (bản chụp trong dự án)' },
      { label: 'Dữ liệu thời tiết', state: w ? (i.weatherAttached ? 'đính kèm đầy đủ' : `chỉ tham chiếu (${w.name}); không đính kèm số liệu`) : 'không có' },
      { label: 'Kết quả đã chạy', state: i.pv || i.runs.length ? 'chỉ số tổng hợp' : 'không có' },
      { label: 'Thông tin liên hệ', state: i.includeContact ? 'có' : 'đã bỏ' },
    ],
  };
}
