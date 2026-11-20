import { indexProject, stringsOf } from '../domain/graph';
import type { Project } from '../domain/types';
import type { Depth } from '../ui/depth';
import type { QuickFix } from './quick-fix';
import { displayStatus, STATUS_LABEL, type Finding } from './strings';

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
/** The subject of the measured sentence: "Voc lạnh Chuỗi 1: 645 V > 500 V" → "Voc lạnh Chuỗi 1". */
const subject = (f: Finding) => f.message.split(':')[0];

/** Names by id as the screens use them: a string, a device, "device · port"; a panel only when the check is about one panel. */
function namesIn(p: Project, f: Finding): (id: string) => string | undefined {
  const ix = indexProject(p), strings = stringsOf(p);
  const panels = f.objectIds.filter((id) => ix.inst.get(id)?.inst.kind === 'panel').length;
  return (id) => {
    const s = strings.find((x) => x.stringId === id);
    if (s) return s.label;
    const [inst, port] = id.split(':'), d = ix.inst.get(inst);
    if (!d || (d.inst.kind === 'panel' && panels > 1)) return undefined;
    return port ? `${d.inst.label} · ${ix.port({ instanceId: inst, port })?.label ?? port}` : d.inst.label;
  };
}

/**
 * One check in words at a depth. The title opens with its status at every depth (Cơ bản shortens, never hides). Each deeper depth
 * keeps the lines of the one before and adds its own after them, so a screen can render all three and hide the additions by
 * data-min-depth. The title names the item (Ruling 15) so two strings failing the same check read apart; the project gives the
 * names (without it: the sentence's subject and the port id).
 */
export function findingLines(f: Finding, depth: Depth, fix: QuickFix | null, p?: Project): { title: string; lines: string[] } {
  const open = f.status === 'fail' || f.status === 'limited';
  // a check that has not run, or passed, must not read as if its consequence happened; a pass carries no number until Thợ
  const what = open ? f.consequence : f.status === 'unknown' ? `chưa kiểm được. Nếu không đạt: ${f.consequence}` : `${subject(f)}: trong giới hạn`;
  // the item: its first object with a name (a tracker check names its port, not the first of its strings; an edge its source
  // port), else its string; a set of panels or a check read without its project fall back to the sentence's subject
  const name = p && namesIn(p, f);
  const item = (name && [...f.objectIds, f.stringId ?? ''].map(name).find(Boolean)) || subject(f);
  const title = `${cap(STATUS_LABEL[displayStatus(f)])}: ${item} — ${what}`;
  const lines = f.status !== 'pass' && !fix ? [ASK_INSTALLER] : [];
  if (depth === 'co-ban') return { title, lines };

  const q = (x: number | null) => (x === null ? 'chưa có' : `${x.toLocaleString('vi-VN', { maximumFractionDigits: 3 })}${f.unit ? ` ${f.unit}` : ''}`);
  if (f.value !== null || f.limit !== null) lines.push(`Giá trị ${q(f.value)} / giới hạn ${q(f.limit)}`);
  if (open) lines.push(`Cách sửa: ${f.fix}`);
  if (f.status === 'unknown') lines.push(`Còn thiếu: ${f.missing.join('; ') || 'giá trị'}`);
  if (f.port) lines.push(`Cổng: ${(name && name(`${f.port.instanceId}:${f.port.port}`)) ?? f.port.port}`);
  if (depth === 'tho') return { title, lines };

  lines.push(`Mã: ${f.code}`);
  if (f.formula) lines.push(`Công thức: ${f.formula}`);
  for (const s of f.sources) lines.push(`${s.where} · ${s.field} = ${s.value ?? 'chưa có'} ${s.unit} (${s.provenance})`);
  if (f.assumed) lines.push('Kết quả này có giả định: có đầu vào mang nguồn "assumption" (số giả định, chưa phải số của hãng hay số đo), hoặc kiểm tra này dùng βVmp giả định trong Thiết lập thiết kế');
  return { title, lines };
}
