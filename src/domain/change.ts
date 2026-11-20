import { indexProject, portKey, stringsOf } from './graph';
import { unplacedPanels } from './layout-edit';
import { refKey, type Project, type Ref } from './types';
import { validateDesign } from '../validation/strings';

const num = (x: number) => x.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

/** Plain-language list of what changed between two designs, for previews before the user applies an edit. Strings are matched by label. */
export function describeChange(before: Project, after: Project): string[] {
  const out: string[] = [];
  const was = new Map(before.instances.map((i) => [i.instanceId, i]));
  const added = after.instances.filter((i) => !was.has(i.instanceId)), panels = added.filter((i) => i.kind === 'panel').length;
  if (panels) out.push(`Thêm ${panels} tấm`);
  for (const i of added) if (i.kind !== 'panel') out.push(`Thêm ${i.label}`);
  const renamed = new Map<string, number>(); // a model swap relabels "<model> #k": one line per old → new model
  const name = (l: string) => l.replace(/ #\d+$/, ''), ref = (r: Ref | null | undefined) => (r ? refKey(r) : '');
  for (const i of after.instances) {
    const o = was.get(i.instanceId);
    if (!o || (o.label === i.label && ref(o.componentRef) === ref(i.componentRef))) continue;
    // same name, other model or revision (new specs or price under the old name): say which revision, or the swap reads as nothing
    const [a, b] = [o.componentRef, i.componentRef];
    const k = o.label !== i.label ? `${name(o.label)} → ${name(i.label)}`
      : a && b && a.modelId === b.modelId ? `${name(i.label)} revision ${a.revision} → ${b.revision}` : `${name(i.label)} (${ref(a)} → ${ref(b)})`;
    renamed.set(k, (renamed.get(k) ?? 0) + 1);
  }
  for (const [k, n] of renamed) out.push(`Đổi model: ${n > 1 ? `${n} × ` : ''}${k}`);
  const faces = new Set(before.roofFaces.map((f) => f.roofFaceId));
  const obs = new Set((before.obstacles ?? []).map((o) => o.obstacleId)), obsAfter = new Set((after.obstacles ?? []).map((o) => o.obstacleId));
  for (const f of after.roofFaces) if (!faces.has(f.roofFaceId)) out.push(`Thêm mặt mái ${f.label}`);
  for (const o of after.obstacles ?? []) if (!obs.has(o.obstacleId)) out.push(`Thêm vật cản ${o.label}`);
  for (const o of before.obstacles ?? []) if (!obsAfter.has(o.obstacleId)) out.push(`Bỏ vật cản ${o.label}`);
  const old = new Map(stringsOf(before).map((s) => [s.label, s]));
  const findings = validateDesign(after);
  for (const s of stringsOf(after)) {
    const o = old.get(s.label);
    if (o && o.panelIds.length === s.panelIds.length) continue;
    const f = findings.find((x) => x.code === 'VOC_COLD_ABS' && x.stringId === s.stringId);
    const voc = f && f.value !== null && f.limit !== null ? `Voc lạnh ${num(f.value)}/${num(f.limit)} V` : 'Voc lạnh chưa đủ dữ liệu';
    out.push(`${s.label}: ${o ? o.panelIds.length : 0} → ${s.panelIds.length} tấm, ${voc}`);
  }
  // a removed device (or an edited port) leaves its strings elsewhere: say where they no longer go
  const portName = (p: Project, t: { instanceId: string; port: string }) => indexProject(p).port(t)?.label ?? t.port;
  for (const s of stringsOf(after)) {
    const o = old.get(s.label);
    if (!o?.target || (s.target && portKey(s.target) === portKey(o.target))) continue;
    out.push(s.target ? `${s.label}: chuyển sang ${portName(after, s.target)}` : `${s.label}: tháo khỏi ${portName(before, o.target)} (${s.panelIds.length} tấm, không phát điện)`);
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
  const oldAt = new Map((before.placements ?? []).map((x) => [x.instanceId, x]));
  const replaced = new Map<string, number>(); // panels that were placed before and now sit elsewhere, per face
  for (const x of after.placements ?? []) {
    const o = oldAt.get(x.instanceId);
    if (o && (o.roofFaceId !== x.roofFaceId || o.angleDeg !== x.angleDeg || o.center[0] !== x.center[0] || o.center[1] !== x.center[1])) replaced.set(x.roofFaceId, (replaced.get(x.roofFaceId) ?? 0) + 1);
  }
  for (const [id, n] of replaced) out.push(`Đặt lại ${n} tấm trên ${after.roofFaces.find((f) => f.roofFaceId === id)?.label ?? id}`);
  const kept = new Set(after.instances.map((i) => i.instanceId));
  for (const i of before.instances) if (!kept.has(i.instanceId)) out.push(`Bỏ ${i.label}`);
  const k = before.edges.length - after.edges.length;
  if (k > 0) out.push(`Bỏ ${k} dây nối`);
  const u = unplacedPanels(after).length - unplacedPanels(before).length;
  if (u > 0) out.push(`${u} tấm chưa có chỗ trên mái`);
  return out;
}
