import { offersFor } from '../catalog/catalog';
import { dropInstances, indexProject, stringsOf } from '../domain/graph';
import { moveDevice, moveObstacle, removeObstacle } from '../domain/layout-edit';
import { replaceComponent } from '../domain/presets';
import { refKey, type Component, type Offer, type Project } from '../domain/types';
import { buildSceneModel } from '../scene/model';
import { displayStatus, STATUS_LABEL, type Finding } from '../validation/strings';
import { errText, findingTitle } from './design';
import { h } from './dom';
import { previewer } from './palette';
import type { Target } from './route';
import { term } from './term';

export interface InspectorCtx {
  project: Project; selection: string[]; findings: Finding[]; components: Component[]; offers: Offer[];
  apply(next: Project): Promise<void>;
  /** Any id the workspace understands: instance, obstacle, string, "instance:port". */
  select(ids: string[]): void;
  go(t: Target): void;
  /** Open with the delete preview showing (the Delete key on the 3D view, "Xóa" in the device list). */
  open?: 'delete';
}

const num = (x: number) => x.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
/** "… là gì?" under one device of this kind. */
const KIND_TERMS: Record<string, string[]> = { inverter: ['inverter', 'mppt'], battery: ['soc', 'bms'], load: ['kw-kwh'], controller: ['mppt'] };
const STEP_M = 0.1;

/** "Đang chọn": what the shared selection is, its checks in words, and the edits on it (replace model, delete, nudge), each previewed first. */
export function renderInspector(ctx: InspectorCtx): HTMLElement {
  const p = ctx.project, ix = indexProject(p), sel = new Set(ctx.selection);
  const insts = p.instances.filter((i) => sel.has(i.instanceId)), obs = (p.obstacles ?? []).filter((o) => sel.has(o.obstacleId));
  const box = h('section', { id: 'inspector', 'aria-label': 'Đang chọn', tabIndex: -1 }, h('h2', {}, 'Đang chọn'));
  // the status line, with nothing selected too: the workspace reads it out (with the first line) through its one live region
  const live = (text: string) => h('p', { id: 'insp-status' }, text);
  if (!insts.length && !obs.length) { box.append(live('Chưa chọn gì. Bấm một món trên hình hoặc trong danh sách.')); return box; }

  // ---- what it is -----------------------------------------------------------------------------------------------
  const strs = stringsOf(p).filter((s) => s.panelIds.some((id) => sel.has(id)));
  const objs = new Set([...sel, ...strs.map((s) => s.stringId)]);
  const hit = (o: string) => objs.has(o) || objs.has(o.split(':')[0]);
  const mine = ctx.findings.filter((f) => f.objectIds.some(hit));
  const one = insts.length + obs.length === 1, dev = one && insts[0] && insts[0].kind !== 'panel' ? insts[0] : null, ob = one ? obs[0] : undefined;
  const port = (r: { instanceId: string; port: string }) => ix.port(r)?.label ?? r.port;
  const lines: string[] = [];
  let terms: string[] = [];
  if (insts.length && !obs.length && insts.every((i) => i.kind === 'panel') && strs.length === 1) {
    const s = strs[0], voc = ctx.findings.find((f) => f.code === 'VOC_COLD_ABS' && f.stringId === s.stringId);
    if (one) lines.push(insts[0].label);
    lines.push(`${s.label} · ${s.panelIds.length} tấm → ${s.target ? port(s.target) : 'chưa nối'}`,
      voc && voc.value !== null && voc.limit !== null ? `Voc lạnh ${num(voc.value)}/${num(voc.limit)} V` : 'Voc lạnh chưa đủ dữ liệu');
    if (insts.length < s.panelIds.length) lines.push(`Đang chọn ${insts.length}/${s.panelIds.length} tấm của chuỗi`);
    terms = ['chuoi', 'voc'];
  } else if (!one) lines.push(`${insts.length + obs.length} món: ${[...insts.map((i) => i.label), ...obs.map((o) => o.label)].join(', ')}`);
  else if (ob) { lines.push(ob.label, `${ob.kind === 'box' ? 'Hộp' : 'Trụ'} ${num(ob.size.x)} × ${num(ob.size.y)} × ${num(ob.size.z)} m · ${ob.roofFaceId ? 'trên mái' : 'đứng riêng'}`); terms = ['shade']; }
  else {
    const i = insts[0], c = ix.inst.get(i.instanceId)?.comp;
    const conn = [
      ...p.edges.filter((e) => e.from.instanceId === i.instanceId || e.to.instanceId === i.instanceId).map((e) => {
        const [me, other] = e.from.instanceId === i.instanceId ? [e.from, e.to] : [e.to, e.from];
        return `${port(me)} ↔ ${ix.inst.get(other.instanceId)?.inst.label ?? 'thiết bị đã xóa'} · ${port(other)}`;
      }),
      ...stringsOf(p).filter((s) => s.target?.instanceId === i.instanceId).map((s) => `${port(s.target!)} ← ${s.label} (${s.panelIds.length} tấm)`),
    ];
    lines.push(i.label, `Model: ${c ? `${c.name}${c.sku ? ` (${c.sku})` : ''}` : 'chưa gắn model'}`, conn.length ? `Kết nối: ${conn.join('; ')}` : i.kind === 'panel' ? 'Chưa vào chuỗi nào.' : 'Chưa nối với gì.');
    terms = i.kind === 'panel' ? ['chuoi'] : KIND_TERMS[i.kind] ?? [];
  }
  // statuses in words, one line; the findings themselves fold underneath
  const bad = mine.filter((f) => f.status !== 'pass');
  const counts = (['fail', 'limited', 'unknown'] as const).map((st) => [st, bad.filter((f) => displayStatus(f) === st).length] as const).filter(([, n]) => n);
  const status = live(bad.length ? `Kiểm tra: ${counts.map(([st, n]) => `${n} ${STATUS_LABEL[st]}`).join(', ')}` : mine.length ? `Kiểm tra: ${mine.length} mục đạt` : 'Chưa có kiểm tra điện nào gắn với món này.');

  // ---- edits: replace model, delete (both previewed), why, nudge --------------------------------------------------
  const modelBox = h('div', {});
  const pv = previewer(p, { preview: 'insp-preview', confirm: 'insp-confirm', cancel: 'insp-cancel' }, (next) => { box.focus(); void ctx.apply(next); }, () => modelBox.replaceChildren()); // the repaint gives focus back to the new #inspector
  const kinds = new Set(insts.map((i) => i.kind)), models = new Set(insts.map((i) => (i.componentRef ? refKey(i.componentRef) : '')));
  const choices = !obs.length && kinds.size === 1 ? ctx.components.filter((c) => c.kind === insts[0].kind && !(models.size === 1 && models.has(refKey(c)))) : [];
  const replace = () => {
    const model = h('select', { id: 'insp-model', 'aria-label': 'Model mới' }, ...choices.map((c) => h('option', { value: refKey(c) }, c.name)));
    const make = () => { const c = choices.find((x) => refKey(x) === model.value)!; return replaceComponent(p, insts.map((i) => i.instanceId), c, offersFor(ctx.offers, c)); };
    model.addEventListener('change', () => pv.show(make));
    modelBox.replaceChildren(h('label', {}, 'Đổi sang ', model));
    pv.show(make);
    model.focus();
  };
  const remove = () => {
    modelBox.replaceChildren();
    pv.show(() => obs.reduce((q, o) => removeObstacle(q, o.obstacleId), insts.length ? dropInstances(p, new Set(insts.map((i) => i.instanceId))) : p));
    if (!pv.confirm.hidden) pv.confirm.focus();
  };
  const why = bad[0] ?? mine[0], whyId = why?.objectIds.find(hit);
  const center = dev && buildSceneModel(p).devices.find((d) => d.instanceId === dev.instanceId)?.center;
  const move = (dE: number, dN: number) => () => {
    try { void ctx.apply(center ? moveDevice(p, dev!.instanceId, dE, dN, center) : moveObstacle(p, ob!.obstacleId, dE, dN)); }
    catch (e) { pv.nodes[0].replaceChildren(h('p', {}, errText(e))); }
  };
  const btn = (id: string, label: string, f: () => void, aria?: string) => h('button', { id, type: 'button', onClick: f, 'aria-label': aria }, label);

  box.append(
    ...lines.map((l) => h('p', {}, l)), status,
    h('div', { className: 'insp-actions' },
      choices.length ? btn('insp-replace', 'Đổi model', replace) : '',
      btn('insp-delete', 'Xóa', remove),
      whyId ? btn('insp-why', 'Vì sao?', () => { ctx.select([whyId]); ctx.go({ step: 'dau-noi', tab: 'thiet-ke', focusId: 'finding-detail' }); }) : ''),
    (center || ob) ? h('div', { role: 'group', 'aria-label': `Dịch ${num(STEP_M)} m` }, `Dịch ${num(STEP_M)} m: `,
      btn('insp-move-left', '←', move(-STEP_M, 0), 'Dịch về Tây'), btn('insp-move-right', '→', move(STEP_M, 0), 'Dịch về Đông'),
      btn('insp-move-up', '↑', move(0, STEP_M), 'Dịch về Bắc'), btn('insp-move-down', '↓', move(0, -STEP_M), 'Dịch về Nam'),
      center ? h('span', {}, ' Vị trí thiết bị là minh họa, không vào phép tính nào.') : '') : '',
    modelBox, ...pv.nodes,
    ...terms.map(term),
    bad.length ? h('details', {}, h('summary', {}, 'Các kiểm tra chưa đạt'), h('ul', {}, ...bad.map((f) => h('li', {}, ...findingTitle(f, p))))) : '');
  if (ctx.open === 'delete') remove();
  return box;
}
