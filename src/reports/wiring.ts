import { indexProject, stringsOf, type PortRef } from '../domain/graph';
import type { Project } from '../domain/types';
import { validateDesign } from '../validation/strings';

export interface WiringRow { from: string; to: string; detail: string }
export const WIRING_NOTE = 'Tiết diện dây và thiết bị bảo vệ do người lắp xác nhận.';

const num = (x: number) => x.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const base = (label: string) => label.replace(/ #\d+$/, '');

/** One row per string, then one per battery / AC / pump edge, in the order a person reads the diagram. */
export function wiringTable(p: Project): WiringRow[] {
  const ix = indexProject(p), findings = validateDesign(p);
  const at = (r: PortRef) => { const d = ix.inst.get(r.instanceId); return `${d ? base(d.inst.label) : 'thiết bị đã xóa'} · ${d?.ports.find((x) => x.id === r.port)?.label ?? r.port}`; };
  const type = (r: PortRef) => ix.port(r)?.type;
  const rows: WiringRow[] = stringsOf(p).map((s) => {
    const voc = findings.find((f) => f.code === 'VOC_COLD_ABS' && f.stringId === s.stringId);
    const order = s.panelIds.map((id) => ix.inst.get(id)?.inst.label.match(/#\d+$/)?.[0] ?? '?').join(' → ');
    return { from: `${s.label} (${s.panelIds.length} tấm: ${order})`, to: s.target ? at(s.target) : 'chưa nối', detail: voc && voc.value !== null && voc.limit !== null ? `Voc lạnh ${num(voc.value)}/${num(voc.limit)} V` : 'chưa đủ dữ liệu' };
  });
  for (const e of p.edges) {
    const [a, b] = [e.from, e.to], ta = type(a), tb = type(b);
    if (ta === 'battery-dc' && tb === 'battery-dc') { const [bat, inv] = ix.inst.get(a.instanceId)?.inst.kind === 'battery' ? [a, b] : [b, a]; rows.push({ from: at(bat), to: at(inv), detail: 'cáp DC pin' }); }
    else if (ta === 'ac-out' || ta === 'ac-in') rows.push({ from: at(ta === 'ac-out' ? a : b), to: at(ta === 'ac-out' ? b : a), detail: 'AC' });
    else if (ta === 'pump-dc-out' || ta === 'pump-dc-in') rows.push({ from: at(ta === 'pump-dc-out' ? a : b), to: at(ta === 'pump-dc-out' ? b : a), detail: 'DC bơm' });
  }
  return rows;
}
