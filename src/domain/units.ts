// Storage units: V, A, W, Wh, Ah, m, kg, ratio (0..1), coef (1/°C), count.
// Input is Vietnamese-friendly: "12,5 m", "1.984.000", "95 %", "-0,24 %/°C".
export type Dim = 'V' | 'A' | 'W' | 'Wh' | 'Ah' | 'm' | 'kg' | 'ratio' | 'coef' | 'count';

interface DimDef { base: string; units: Record<string, number>; defaultUnit: string; integer?: boolean }

export const DIMS: Record<Dim, DimDef> = {
  V: { base: 'V', units: { V: 1, mV: 1e-3, kV: 1e3 }, defaultUnit: 'V' },
  A: { base: 'A', units: { A: 1, mA: 1e-3 }, defaultUnit: 'A' },
  W: { base: 'W', units: { W: 1, Wp: 1, kW: 1e3, kWp: 1e3 }, defaultUnit: 'W' },
  Wh: { base: 'Wh', units: { Wh: 1, kWh: 1e3 }, defaultUnit: 'Wh' },
  Ah: { base: 'Ah', units: { Ah: 1, mAh: 1e-3 }, defaultUnit: 'Ah' },
  m: { base: 'm', units: { m: 1, cm: 1e-2, mm: 1e-3 }, defaultUnit: 'm' },
  kg: { base: 'kg', units: { kg: 1, g: 1e-3 }, defaultUnit: 'kg' },
  ratio: { base: 'ratio', units: { '%': 1e-2, ratio: 1 }, defaultUnit: '%' },
  coef: { base: '1/°C', units: { '%/°C': 1e-2, '/°C': 1, '1/°C': 1 }, defaultUnit: '%/°C' },
  count: { base: 'count', units: { count: 1 }, defaultUnit: 'count', integer: true },
};

export type ParseCode = 'EMPTY' | 'NOT_A_NUMBER' | 'UNIT_MISMATCH' | 'NEGATIVE' | 'NOT_INTEGER' | 'OUT_OF_RANGE';
export type ParseResult = { ok: true; value: number; unit: string } | { ok: false; code: ParseCode; message: string };

const fail = (code: ParseCode, message: string): ParseResult => ({ ok: false, code, message });

/** Vietnamese number: comma = decimal, dot = thousands ("1.500" is 1500, "1.5" is 1,5). */
export function parseNumber(token: string): number | null {
  let t = token;
  if (/^[+-]?\d+$/.test(t)) return Number(t);
  if (t.includes(',')) {
    if (!/^[+-]?([1-9]\d{0,2}(\.\d{3})+|\d+),\d+$/.test(t)) return null;
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (/^[+-]?[1-9]\d{0,2}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // a dot group is thousands only if it does not start with 0: "0.500" is 0,5
  else if (!/^[+-]?\d+\.\d+$/.test(t)) return null;
  return Number(t);
}

export function parseQuantity(text: string, dim: Dim, opts: { allowNegative?: boolean } = {}): ParseResult {
  const def = DIMS[dim];
  const m = /^\s*([+-]?[\d.,]+)\s*(.*?)\s*$/.exec(text ?? '');
  if (!text || !text.trim()) return fail('EMPTY', 'Chưa nhập giá trị');
  if (!m) return fail('NOT_A_NUMBER', `Không đọc được số trong "${text}"`);
  const n = parseNumber(m[1]);
  if (n === null || !Number.isFinite(n)) return fail('NOT_A_NUMBER', `Không đọc được số "${m[1]}"`);
  const unit = m[2] || def.defaultUnit;
  const factor = def.units[unit] ?? Object.entries(def.units).find(([u]) => u.toLowerCase() === unit.toLowerCase())?.[1];
  if (factor === undefined) return fail('UNIT_MISMATCH', `Đơn vị "${unit}" không hợp lệ, cần ${Object.keys(def.units).join(', ')}`);
  const value = Number((n * factor).toPrecision(12));
  if (!Number.isFinite(value)) return fail('OUT_OF_RANGE', 'Giá trị quá lớn');
  if (value < 0 && !opts.allowNegative) return fail('NEGATIVE', 'Giá trị không được âm');
  if (def.integer && !Number.isInteger(value)) return fail('NOT_INTEGER', 'Cần số nguyên');
  return { ok: true, value, unit: def.base };
}

/** Display/edit form in vi-VN: 51.2 → "51,2", 8448 → "8.448". Round-trips through parseNumber. */
export const formatNumber = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 9 });

/** Value as the form shows it, in the dimension's default unit (ratio → %, coef → %/°C). */
export function formatQuantity(v: number, dim: Dim): string {
  const d = DIMS[dim];
  return formatNumber(Number((v / d.units[d.defaultUnit]).toPrecision(12)));
}

/** Energy in kWh as screens show it: vi-VN, one decimal, |x| < 5 Wh shows 0 (never "-0"). */
export const formatKWh = (wh: number) => (Math.abs(wh) < 5 ? 0 : wh / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 });

/** VND amount as whole đồng: "1.984.000", "3200 đ", "16 000 000" → "1984000" etc. Fractions are rejected. */
export function parseMoney(text: string): { ok: true; minor: string } | { ok: false; message: string } {
  const t = (text ?? '').replace(/\s*(đ|₫|vnd)\s*$/i, '').replace(/(?<=\d) (?=\d{3}\b)/g, '').trim();
  if (!t) return { ok: false, message: 'Chưa nhập giá' };
  // dots are thousands separators only: "18.00" or "0.500" are typos, not 18 or 500 đồng
  const n = /^(\d+|[1-9]\d{0,2}(\.\d{3})+)$/.test(t) ? parseNumber(t) : null;
  if (n === null || !Number.isSafeInteger(n)) return { ok: false, message: `"${text}" không phải số tiền nguyên (đồng)` };
  return { ok: true, minor: String(n) };
}
