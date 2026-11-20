import { describe, expect, test } from 'vitest';
import { buildSampleHouse } from '../../src/domain/seed';
import { GLOSSARY } from '../../src/lessons/glossary';
import type { Depth } from '../../src/ui/depth';
import { FINDING_TERMS, findingLines } from '../../src/validation/finding-view';
import { quickFixFor } from '../../src/validation/quick-fix';
import { validateDesign, type Finding } from '../../src/validation/strings';
import { catalog, rig, withSpecs, withStrings } from './helpers';

const OLD = ['kw-kwh', 'mppt', 'soc', 'bms', 'series-parallel', 'shade'];
const NEW = ['voc', 'vmp', 'isc', 'chuoi', 'inverter', 'kwp', 'poa', 'nhiet-do-cell', 'cat-cong-suat', 'mua-luoi', 'gio-thieu-dien', 'khoang-lui-mep', 'gia-dinh', 'thieu-gia'];

describe('glossary', () => {
  test('≥ 20 mục: 6 mục cũ giữ nguyên, thêm 14 mục; id không trùng; lời Cơ bản và Kỹ sư không rỗng', () => {
    const ids = GLOSSARY.map((t) => t.id);
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([...OLD, ...NEW]));
    for (const t of GLOSSARY) for (const k of ['term', 'basic', 'engineer'] as const) expect(t[k].trim(), `${t.id}.${k}`).not.toBe('');
  });
  test('mỗi mã kiểm tra trỏ tới mục có thật trong glossary', () => {
    for (const [code, ids] of Object.entries(FINDING_TERMS)) for (const id of ids) expect(ids.length && GLOSSARY.some((t) => t.id === id), `${code} → ${id}`).toBe(true);
  });
});

describe('findingLines: lời một kiểm tra theo độ sâu', () => {
  const panel = withSpecs(catalog('vsun-620'), { vocV: 50, betaVoc: -0.0025 });
  const inv = withSpecs(catalog('luxpower-sna6000wpv'), { mpptCount: 2, pvIscMaxPerMpptA: 25, pvImaxPerMpptA: 17, pvVocMaxV: 500 });
  const p = withStrings(rig(panel, inv, 12), [{ n: 12, port: 'M1' }]);
  const voc = validateDesign(p).find((f) => f.code === 'VOC_COLD_ABS')!;
  const fix = quickFixFor(p, voc);
  const invLabel = p.instances.find((i) => i.kind === 'inverter')!.label;
  const depths: Depth[] = ['co-ban', 'tho', 'ky-su'];
  const text = (x: { title: string; lines: string[] }) => [x.title, ...x.lines].join('\n');

  test('VOC_COLD_ABS không đạt (cùng dữ liệu cho cả ba độ sâu)', () => {
    expect(voc.status).toBe('fail');
    expect(fix).not.toBeNull();
    expect(voc.formula).not.toBe('');
  });

  test('Cơ bản: "Có lỗi: <hậu quả>", "Hỏi thợ" khi không có sửa nhanh; không có công thức, mã hay số', () => {
    const b = findingLines(voc, 'co-ban', null, p);
    expect(b.title).toBe(`Có lỗi: Chuỗi 1 — ${voc.consequence}`); // names the string it is about
    expect(b.lines).toEqual(['Hỏi thợ lắp đặt về mục này']);
    expect(text(b)).not.toContain(voc.formula);
    expect(text(b)).not.toContain(voc.code);
    expect(findingLines(voc, 'co-ban', fix, p).lines).toEqual([]); // có nút sửa nhanh thì không cần hỏi thợ
  });

  test('Thợ: thêm giá trị / giới hạn, cách sửa, cổng; vẫn chưa có công thức', () => {
    const t = findingLines(voc, 'tho', fix, p);
    expect(t.title).toBe(`Có lỗi: Chuỗi 1 — ${voc.consequence}`);
    expect(t.lines).toContain(`Giá trị ${voc.value!.toLocaleString('vi-VN', { maximumFractionDigits: 3 })} V / giới hạn 500 V`);
    expect(t.lines).toContain(`Cách sửa: ${voc.fix}`);
    expect(t.lines).toContain(`Cổng: ${invLabel} · MPPT 1`);
    expect(text(t)).not.toContain(voc.formula);
    const bare = findingLines(voc, 'tho', fix); // không có dự án: mã cổng, và chủ ngữ của câu đo
    expect(bare.lines).toContain('Cổng: M1');
    expect(bare.title).toBe(`Có lỗi: Voc lạnh Chuỗi 1 — ${voc.consequence}`);
  });

  test('Kỹ sư: thêm mã, công thức và mọi nguồn (nơi · trường = giá trị đơn vị (nguồn gốc))', () => {
    const k = text(findingLines(voc, 'ky-su', fix, p));
    expect(k).toContain(voc.code);
    expect(k).toContain(`Công thức: ${voc.formula}`);
    for (const s of voc.sources) expect(k).toContain(s.where);
    expect(k).toContain(`Thiết lập thiết kế · coldCellTempC = -5 °C (design)`);
  });

  test('mỗi độ sâu giữ nguyên lời của độ sâu trước rồi thêm vào sau (màn hình ẩn phần thêm bằng data-min-depth)', () => {
    for (const fx of [fix, null]) {
      const [b, t, k] = depths.map((d) => findingLines(voc, d, fx, p));
      expect(t.title).toBe(b.title);
      expect(k.title).toBe(b.title);
      expect(t.lines.slice(0, b.lines.length)).toEqual(b.lines);
      expect(k.lines.slice(0, t.lines.length)).toEqual(t.lines);
    }
  });

  test('trạng thái mở đầu ở mọi độ sâu: chưa đủ dữ liệu và bị giới hạn không bị Cơ bản giấu', () => {
    const unknown = validateDesign(withStrings(rig(panel, inv, 8, {}), [{ n: 8, port: 'M1' }])).find((f) => f.code === 'VOC_COLD_ABS')!;
    expect(unknown.status).toBe('unknown');
    const limited: Finding = { ...voc, status: 'limited', severity: 'warning' };
    for (const d of depths) {
      expect(findingLines(unknown, d, null).title, d).toMatch(/^Chưa đủ dữ liệu: /);
      expect(findingLines(limited, d, null, p).title, d).toBe(`Bị giới hạn: Chuỗi 1 — ${voc.consequence}`);
      expect(findingLines(voc, d, null).title, d).toMatch(/^Có lỗi: /);
    }
    // chưa kiểm được thì không nói như thể đã xảy ra, và không bảo "giảm số tấm": nói còn thiếu gì
    expect(findingLines(unknown, 'co-ban', null).title).not.toContain(`Chưa đủ dữ liệu: ${voc.consequence}`);
    expect(findingLines(unknown, 'co-ban', null).lines).toEqual(['Hỏi thợ lắp đặt về mục này']);
    const t = findingLines(unknown, 'tho', null).lines.join('\n');
    expect(t).toContain('Còn thiếu: Thiết lập thiết kế: coldCellTempC');
    expect(t).not.toContain('Cách sửa');
  });

  test('đạt: không hỏi thợ, không cách sửa; "có giả định" chỉ ở Kỹ sư', () => {
    const q = withStrings(rig(panel, inv, 8), [{ n: 8, port: 'M1' }]), pass = validateDesign(q).find((f) => f.code === 'VOC_COLD_ABS')!;
    expect(pass.status).toBe('pass');
    expect(findingLines(pass, 'co-ban', null, q).title).toBe('Đạt: Chuỗi 1 — Voc lạnh Chuỗi 1: trong giới hạn'); // no number at Cơ bản
    expect(findingLines(pass, 'co-ban', null).lines).toEqual([]);
    expect(findingLines(pass, 'tho', null).lines.join('\n')).not.toContain('Cách sửa');
    const assumed: Finding = { ...voc, assumed: true };
    expect(text(findingLines(assumed, 'tho', null))).not.toContain('có giả định');
    expect(text(findingLines(assumed, 'ky-su', null))).toContain('có giả định');
    expect(text(findingLines(voc, 'ky-su', null))).not.toContain('có giả định');
  });
});

describe('findingLines: tiêu đề nêu tên món nó nói tới (Ruling 15)', () => {
  const house = buildSampleHouse('2026-11-20T00:00:00.000Z'), fs = validateDesign(house);
  test('Nhà mẫu: hai VMP_HOT_MIN khác nhau, nêu Chuỗi 1 / Chuỗi 2', () => {
    const titles = fs.filter((f) => f.code === 'VMP_HOT_MIN').map((f) => findingLines(f, 'co-ban', null, house).title);
    expect(titles).toHaveLength(2);
    expect(titles[0]).not.toBe(titles[1]);
    expect(titles.some((t) => t.includes('Chuỗi 1 — '))).toBe(true);
    expect(titles.some((t) => t.includes('Chuỗi 2 — '))).toBe(true);
  });
  test('Nhà mẫu ở Cơ bản: không có hai kiểm tra nào trùng tiêu đề; kiểm tra ở cổng nêu "thiết bị · cổng"', () => {
    const titles = fs.map((f) => findingLines(f, 'co-ban', quickFixFor(house, f), house).title);
    expect(new Set(titles).size).toBe(titles.length);
    const inv = house.instances.find((i) => i.kind === 'inverter')!.label;
    const charge = findingLines(fs.find((f) => f.code === 'BATTERY_CHARGE_LIMIT')!, 'co-ban', null, house).title;
    expect(charge.startsWith(`Bị giới hạn: ${inv} · Pin — `), charge).toBe(true);
  });
});
