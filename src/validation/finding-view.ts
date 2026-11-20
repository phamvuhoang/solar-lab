import type { Depth } from '../ui/depth';
import { STATE_LABEL } from '../ui/health';
import type { QuickFix } from './quick-fix';
import type { Finding } from './strings';

/** Glossary ids that explain a check (src/lessons/glossary.ts). */
export const FINDING_TERMS: Record<string, string[]> = {
  VOC_COLD_ABS: ['voc', 'nhiet-do-cell', 'chuoi'], START_VOLTAGE: ['voc', 'nhiet-do-cell'],
  VMP_HOT_MIN: ['vmp', 'mppt', 'nhiet-do-cell'], VMP_COLD_MAX: ['vmp', 'mppt', 'cat-cong-suat'],
  ISC_TRACKER: ['isc', 'mppt', 'series-parallel'], IMP_TRACKER: ['mppt', 'cat-cong-suat'], CTRL_POWER: ['kwp', 'cat-cong-suat'],
  PARALLEL_STRINGS_MISMATCH: ['series-parallel', 'chuoi'], STRING_MIXED_MODELS: ['chuoi'], STRING_EMPTY: ['chuoi'], STRING_UNCONNECTED: ['chuoi', 'mppt'],
  PANEL_UNASSIGNED: ['chuoi'], PANEL_DUPLICATE: ['chuoi'],
  BATTERY_VOLTAGE_WINDOW: ['inverter', 'bms'], BATTERY_VOLTAGE_WINDOW_MAX: ['inverter', 'bms'], BATTERY_CHARGE_LIMIT: ['bms', 'soc'], BATTERY_DISCHARGE_LIMIT: ['bms', 'soc'],
  AC_LOAD_RATED: ['inverter', 'kw-kwh'], CTRL_LOAD_RATED: ['kw-kwh'],
};

const ASK_INSTALLER = 'Hỏi thợ lắp đặt về mục này';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One check in words at a depth. The title opens with its status at every depth (Cơ bản shortens, never hides). Each deeper depth
 * keeps the lines of the one before and adds its own after them, so a screen can render all three and hide the additions by
 * data-min-depth. `port` names the port ("Inverter · MPPT 1"); without it the port id is shown.
 */
export function findingLines(f: Finding, depth: Depth, fix: QuickFix | null, port?: string): { title: string; lines: string[] } {
  const open = f.status === 'fail' || f.status === 'limited';
  // a check that has not run, or passed, must not read as if its consequence happened
  const what = open ? f.consequence : f.status === 'unknown' ? `chưa kiểm được. Nếu không đạt: ${f.consequence}` : f.message;
  const title = `${cap(STATE_LABEL[f.status])}: ${what}`;
  const lines = f.status !== 'pass' && !fix ? [ASK_INSTALLER] : [];
  if (depth === 'co-ban') return { title, lines };

  const q = (x: number | null) => (x === null ? 'chưa có' : `${x.toLocaleString('vi-VN', { maximumFractionDigits: 3 })}${f.unit ? ` ${f.unit}` : ''}`);
  if (f.value !== null || f.limit !== null) lines.push(`Giá trị ${q(f.value)} / giới hạn ${q(f.limit)}`);
  if (open) lines.push(`Cách sửa: ${f.fix}`);
  if (f.status === 'unknown') lines.push(`Còn thiếu: ${f.missing.join('; ') || 'giá trị'}`);
  if (f.port) lines.push(`Cổng: ${port ?? f.port.port}`);
  if (depth === 'tho') return { title, lines };

  lines.push(`Mã: ${f.code}`);
  if (f.formula) lines.push(`Công thức: ${f.formula}`);
  for (const s of f.sources) lines.push(`${s.where} · ${s.field} = ${s.value ?? 'chưa có'} ${s.unit} (${s.provenance})`);
  if (f.assumed) lines.push('Kết quả này có giả định: ít nhất một đầu vào chưa phải số của hãng hay số đo');
  return { title, lines };
}
