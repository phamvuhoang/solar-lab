import { stringsOf } from './graph';
import { unplacedPanels } from './layout-edit';
import type { Project } from './types';
import { validateDesign } from '../validation/strings';

const num = (x: number) => x.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

/** Plain-language list of what changed between two designs, for previews before the user applies an edit. Strings are matched by label. */
export function describeChange(before: Project, after: Project): string[] {
  const out: string[] = [];
  const old = new Map(stringsOf(before).map((s) => [s.label, s]));
  const findings = validateDesign(after);
  for (const s of stringsOf(after)) {
    const o = old.get(s.label);
    if (o && o.panelIds.length === s.panelIds.length) continue;
    const f = findings.find((x) => x.code === 'VOC_COLD_ABS' && x.stringId === s.stringId);
    const voc = f && f.value !== null && f.limit !== null ? `Voc lạnh ${num(f.value)}/${num(f.limit)} V` : 'Voc lạnh chưa đủ dữ liệu';
    out.push(`${s.label}: ${o ? o.panelIds.length : 0} → ${s.panelIds.length} tấm, ${voc}`);
  }
  const now = new Set(stringsOf(after).map((s) => s.label));
  for (const s of stringsOf(before)) if (!now.has(s.label)) out.push(`${s.label}: bỏ`);
  const seen = new Set(validateDesign(before).filter((f) => f.status === 'fail' && f.severity === 'error').map((f) => f.code + f.objectIds.join()));
  for (const f of findings) if (f.status === 'fail' && f.severity === 'error' && !seen.has(f.code + f.objectIds.join())) out.push(`Lỗi mới: ${f.message}`);
  const placeAt = new Map((after.placements ?? []).map((x) => [x.instanceId, x.roofFaceId]));
  for (const s of stringsOf(after)) {
    const faces = new Set(s.panelIds.flatMap((id) => placeAt.get(id) ?? [])), placed = s.panelIds.filter((id) => placeAt.has(id)).length;
    if (faces.size > 1) out.push(`${s.label}: tấm nằm trên ${faces.size} mặt mái, chưa chạy thử được`);
    if (placed > 0 && placed < s.panelIds.length) out.push(`${s.label}: ${placed}/${s.panelIds.length} tấm đã đặt lên mái, chưa chạy thử được`);
  }
  const kept = new Set(after.instances.map((i) => i.instanceId));
  for (const i of before.instances) if (!kept.has(i.instanceId)) out.push(`Bỏ ${i.label}`);
  const k = before.edges.length - after.edges.length;
  if (k > 0) out.push(`Bỏ ${k} dây nối`);
  const u = unplacedPanels(after).length - unplacedPanels(before).length;
  if (u > 0) out.push(`${u} tấm chưa có chỗ trên mái`);
  return out;
}
