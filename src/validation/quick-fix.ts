import { indexProject, portsOf, setStringTarget, stringsOf } from '../domain/graph';
import { fillFace, removePlacements } from '../domain/layout-edit';
import { validateLayout, type PlacementIssue } from '../domain/placement';
import { restringPanels } from '../domain/presets';
import { refKey, type Project } from '../domain/types';
import { validateDesign, type Finding } from './strings';

export interface QuickFix { label: string; apply(p: Project): Project }

const open = (f: Finding) => f.status === 'fail' || f.status === 'limited';
const designCount = (p: Project, code: string) => validateDesign(p).filter((x) => x.code === code && open(x)).length;
const layoutCount = (p: Project, code: string) => validateLayout(p).filter((x) => x.code === code && x.severity === 'error').length;

/** Offered only when applying it strictly reduces the open findings of the same code. */
const verified = (p: Project, fix: QuickFix, count: (q: Project) => number): QuickFix | null => {
  try { return count(fix.apply(p)) < count(p) ? fix : null; } catch { return null; }
};

export function quickFixFor(p: Project, f: Finding): QuickFix | null {
  const count = (q: Project) => designCount(q, f.code);
  if ((f.code === 'ISC_TRACKER' || f.code === 'IMP_TRACKER') && f.port && open(f)) {
    const inv = indexProject(p).inst.get(f.port.instanceId);
    if (inv?.inst.kind !== 'inverter') return null;
    const strings = stringsOf(p).filter((s) => s.panelIds.length && s.target?.instanceId === f.port!.instanceId);
    const group = strings.filter((s) => s.target!.port === f.port!.port);
    const used = new Set(strings.map((s) => s.target!.port));
    const to = portsOf(inv.inst, inv.comp).find((x) => x.type === 'mppt-in' && !used.has(x.id));
    if (group.length < 2 || !to) return null;
    const last = group[group.length - 1];
    return verified(p, { label: `Chuyển ${last.label} sang ${to.label}`, apply: (q) => setStringTarget(q, last.stringId, { instanceId: f.port!.instanceId, port: to.id }) }, count);
  }
  if ((f.code === 'VOC_COLD_ABS' || f.code === 'VMP_HOT_MIN') && f.status === 'fail') {
    const ix = indexProject(p), s = stringsOf(p).find((x) => x.stringId === f.stringId);
    const models = new Set((s?.panelIds ?? []).map((id) => { const r = ix.inst.get(id)?.inst.componentRef; return r ? refKey(r) : ''; }));
    if (!s?.target || models.size !== 1 || ix.inst.get(s.target.instanceId)?.inst.kind !== 'inverter') return null;
    const [model] = models;
    return verified(p, { label: 'Chia lại số tấm mỗi chuỗi', apply: (q) => restringPanels(q, s.target!.instanceId, model) }, count);
  }
  return null;
}

export function quickFixForLayout(p: Project, i: PlacementIssue): QuickFix | null {
  if (!['PANEL_OUT_OF_BOUNDS', 'PANEL_SETBACK', 'PANEL_OVERLAP'].includes(i.code) || i.severity !== 'error' || !i.instanceId) return null;
  const ids = [i.instanceId, i.otherId].filter(Boolean) as string[];
  const faceId = i.faceId ?? p.placements?.find((x) => x.instanceId === i.instanceId)?.roofFaceId;
  if (!faceId) return null;
  const apply = (q: Project) => {
    const base = removePlacements(q, ids), was = q.placements?.find((x) => x.instanceId === ids[0])?.angleDeg ?? 0;
    for (const angle of [was, 0]) { // keep the panel's orientation if it fits, else upright
      const r = fillFace(base, faceId, ids, angle);
      if (!r.left.length) return r.project;
    }
    throw new Error('NO_ROOM');
  };
  return verified(p, { label: 'Đặt lại tấm vào chỗ trống', apply }, (q) => layoutCount(q, i.code));
}
