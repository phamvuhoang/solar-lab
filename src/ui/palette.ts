import { offersFor } from '../catalog/catalog';
import { buildQuote, type Quote } from '../cost/quote';
import { describeChange } from '../domain/change';
import { addObstacle, addRoofFace, faceRect, fillFace } from '../domain/layout-edit';
import { addAcLoad, addBatteryBranch, addFirstInverter, addPanels, addPumpBranch, ALL_DAY, atHour, replaceComponent } from '../domain/presets';
import { addInstances } from '../domain/project';
import { toWorld } from '../domain/roof';
import { refKey, type Component, type Offer, type Project } from '../domain/types';
import { parseNumber } from '../domain/units';
import { errText } from './design';
import { h } from './dom';

/** fold: whether "Thêm" is expanded, kept by the workspace across the rebuild every edit makes. */
export interface PaletteCtx { project: Project; components: Component[]; offers: Offer[]; apply(next: Project): Promise<void>; fold: { open: boolean } }

const vnd = (q: Quote) => Number(q.knownSubtotalMinor).toLocaleString('vi-VN');
/** What an edit would change, in words: describeChange, plus the money when it moves (missing prices are counted, never hidden). */
export function previewLines(before: Project, after: Project): string[] {
  const [a, b] = [buildQuote(before), buildQuote(after)], miss = (q: Quote) => q.missing.lineKeys.length;
  const money = a.knownSubtotalMinor !== b.knownSubtotalMinor || miss(a) !== miss(b) ? [`Tiền đã biết: ${vnd(a)} → ${vnd(b)} đ · dòng chưa có giá: ${miss(a)} → ${miss(b)}`] : [];
  return [...describeChange(before, after), ...money];
}

/** Shows `make()`'s preview (or the domain error as a sentence); confirm applies exactly what was previewed. */
export function previewer(before: Project, ids: { preview: string; confirm: string; cancel: string }, apply: (next: Project) => void, onCancel: () => void) {
  const preview = h('div', { id: ids.preview, role: 'status' });
  const confirm = h('button', { id: ids.confirm, type: 'button', hidden: true }, 'Xác nhận');
  const cancel = h('button', { id: ids.cancel, type: 'button', hidden: true }, 'Thôi');
  let next: Project | null = null;
  const show = (make: () => Project) => {
    try {
      next = make();
      const lines = previewLines(before, next);
      preview.replaceChildren(...(lines.length ? lines : ['Không có gì thay đổi.']).map((l) => h('p', {}, l)));
      confirm.hidden = !lines.length;
    } catch (e) { next = null; preview.replaceChildren(h('p', {}, errText(e))); confirm.hidden = true; }
    cancel.hidden = false;
  };
  const clear = () => { next = null; preview.replaceChildren(); confirm.hidden = cancel.hidden = true; };
  confirm.addEventListener('click', () => { if (next) apply(next); });
  cancel.addEventListener('click', () => { clear(); onCancel(); });
  return { nodes: [preview, h('div', {}, confirm, cancel)], show, clear, confirm };
}

const PUMP = { staticHeadM: null, frictionK: null, curve: null };
const field = (id: string, label: string, value: string, attrs: Record<string, string | number> = { inputMode: 'decimal', size: 5 }) => {
  const el = h('input', { id, value, ...attrs });
  return { el, node: h('label', {}, `${label} `, el), get: () => parseNumber(el.value.trim()) };
};

/**
 * The "Thêm" column: each block is wired already (presets / layout-edit). Pick one → its few fields → a preview of what changes → confirm.
 * Every confirm is one revision, undone with the workspace's undo. Rebuilt whenever the project changes, so a preview is never stale.
 */
export function renderPalette(ctx: PaletteCtx): HTMLElement {
  const p = ctx.project, of = (c: Component) => offersFor(ctx.offers, c);
  const comp = (kind: string, prefer: string) => ctx.components.find((c) => c.kind === kind && c.modelId === prefer) ?? ctx.components.find((c) => c.kind === kind);
  const need = <T,>(x: T | undefined, what: string): T => { if (!x) throw new Error(`Catalog chưa có ${what}.`); return x; };
  const owned = p.instances.find((i) => i.kind === 'panel' && i.componentRef)?.componentRef;
  const panel = (owned && p.snapshots.components.find((c) => refKey(c) === refKey(owned))) ?? comp('panel', 'vsun-620');
  const inverter = p.instances.find((i) => i.kind === 'inverter');
  const battery = ctx.components.find((c) => c.kind === 'battery'), home = comp('load', 'sample-home-load'), pump = comp('load', 'sample-pump-load'), ctl = comp('controller', 'sample-pump-controller');

  /** New panels go on the faces that still have room, in face order. */
  const place = (q: Project, ids: string[]) => { let todo = ids; for (const f of q.roofFaces) { if (!todo.length) break; const r = fillFace(q, f.roofFaceId, todo); q = r.project; todo = r.left; } return q; };

  const nPanels = field('add-panel-n', 'Số tấm', '2', { type: 'number', min: 1, step: 1, style: 'width:4.5rem' });
  const invs = ctx.components.filter((c) => c.kind === 'inverter');
  const invModel = h('select', { id: 'add-inverter-model', 'aria-label': 'Model inverter', 'data-min-depth': 'tho' }, ...invs.map((c) => h('option', { value: refKey(c) }, c.name)));
  const other = invs.find((c) => !inverter?.componentRef || refKey(c) !== refKey(inverter.componentRef));
  if (other) invModel.value = refKey(other);
  const fw = field('add-face-w', 'Rộng (m)', '10'), fs = field('add-face-s', 'Dài theo dốc (m)', '3,25'), ft = field('add-face-t', 'Nghiêng (°)', '10'), fa = field('add-face-a', 'Hướng (°, Bắc = 0)', '180');
  const obsKind = h('select', { id: 'add-obs-kind', 'aria-label': 'Dạng vật cản' }, h('option', { value: 'box' }, 'Hộp'), h('option', { value: 'cylinder' }, 'Trụ'));
  const ox = field('add-obs-x', 'Rộng hoặc đường kính (m)', '1'), oy = field('add-obs-y', 'Sâu (m, hộp)', '1'), oz = field('add-obs-z', 'Cao (m)', '1'), oe = field('add-obs-e', 'Tâm: Đông (m)', '-2'), on = field('add-obs-n', 'Bắc (m)', '1');
  const note = (t: string) => h('p', {}, t);

  const items: { id: string; label: string; fields: Node[]; make: () => Project }[] = [
    { id: 'add-panel', label: 'Tấm pin', fields: [note(panel ? `Model ${panel.name}; chuỗi trên inverter được chia lại, tấm mới đặt lên mặt mái còn chỗ.` : ''), h('div', { 'data-min-depth': 'tho' }, nPanels.node)], make: () => {
      const n = nPanels.get();
      if (n === null || !Number.isInteger(n) || n < 1) throw new Error('Số tấm phải là số nguyên dương.');
      return addPanels(p, need(panel, 'tấm pin'), n, of(panel!)).project;
    } },
    { id: 'add-inverter', label: 'Inverter', fields: [note(inverter ? `Thay ${inverter.label}; giữ chuỗi, dây và vị trí.` : 'Thêm inverter và nối mọi tấm vào các MPPT của nó.'), invModel], make: () => {
      const c = need(invs.find((x) => refKey(x) === invModel.value), 'inverter');
      return inverter ? replaceComponent(p, [inverter.instanceId], c, of(c)) : addFirstInverter(p, c, of(c));
    } },
    { id: 'add-battery', label: 'Pin', fields: [note(battery ? `${battery.name}, nối vào cổng pin của inverter.` : '')], make: () => addBatteryBranch(p, need(battery, 'pin lưu trữ'), of(battery!)) },
    { id: 'add-load', label: 'Tải', fields: [note(home ? `${home.name}, nối vào AC, chạy cả ngày (lịch mặc định; sửa lịch ở bước ③, chế độ Thợ).` : '')], make: () => addAcLoad(p, need(home, 'tải'), of(home!), { fractions: ALL_DAY, priority: 1 }) },
    { id: 'add-pump-ac', label: 'Bơm (AC)', fields: [note(pump ? `${pump.name}, nối vào AC, chạy 1 giờ lúc 18h (lịch mặc định; sửa lịch ở bước ③, chế độ Thợ).` : '')], make: () => addAcLoad(p, need(pump, 'bơm'), of(pump!), { fractions: atHour(18), priority: 2, pump: PUMP }) },
    { id: 'add-pump-pv', label: 'Bơm cấp bằng tấm riêng', fields: [note('2 tấm mới → controller → bơm DC, không qua inverter; bơm chạy 1 giờ lúc 11h.')], make: () => {
      const old = new Set(p.instances.map((i) => i.instanceId)), pv = need(panel, 'tấm pin');
      let next = addInstances(p, pv, 2, of(pv));
      const fresh = next.instances.filter((i) => !old.has(i.instanceId)).map((i) => i.instanceId);
      next = place(next, fresh);
      return addPumpBranch(next, need(ctl, 'controller'), need(pump, 'bơm'), fresh, ctx.offers, { fractions: atHour(11), priority: 2, pump: PUMP });
    } },
    { id: 'add-face', label: 'Mặt mái', fields: [fw.node, fs.node, ft.node, fa.node], make: () => {
      const [w, s, t, a] = [fw.get(), fs.get(), ft.get(), fa.get()];
      if (w === null || s === null || t === null || a === null || w <= 0 || s <= 0 || t < 0 || t > 89 || a < 0 || a >= 360) throw new Error('Rộng và dài theo dốc là số dương; nghiêng 0–89°; hướng 0–359,9° (Bắc = 0).');
      const east = p.roofFaces.flatMap((f) => f.outline.map((q) => toWorld(f, q).e)); // the new face starts 1 m east of the others
      return addRoofFace(p, faceRect(`Mái ${p.roofFaces.length + 1}`, w, s, t, a, { e: east.length ? Math.max(...east) + 1 : 0, n: 0, up: 3 }));
    } },
    { id: 'add-obstacle', label: 'Vật cản', fields: [obsKind, ox.node, oy.node, oz.node, oe.node, on.node], make: () => {
      const [x, y, z, e, n] = [ox.get(), oy.get(), oz.get(), oe.get(), on.get()], cyl = obsKind.value === 'cylinder';
      if (x === null || y === null || z === null || e === null || n === null || x <= 0 || y <= 0 || z <= 0) throw new Error('Kích thước là số mét dương; tâm là số mét.');
      return addObstacle(p, { label: `Vật cản ${(p.obstacles?.length ?? 0) + 1}`, kind: cyl ? 'cylinder' : 'box', roofFaceId: null, center: { e, n }, baseUp: 0, angleDeg: 0, size: { x, y: cyl ? x : y, z } });
    } },
  ];

  const body = h('div', { id: 'add-body' });
  let open: { button: HTMLButtonElement; make: () => Project } | null = null;
  const pv = previewer(p, { preview: 'add-preview', confirm: 'add-confirm', cancel: 'add-cancel' },
    (next) => { open?.button.focus(); void ctx.apply(next); }, // focus goes back to the block, which the repaint keeps
    () => { body.replaceChildren(); open?.button.setAttribute('aria-expanded', 'false'); open?.button.focus(); open = null; });
  body.addEventListener('input', () => open && pv.show(open.make)); // inputs and selects
  const buttons = items.map((it) => {
    const button = h('button', { id: it.id, type: 'button', 'aria-expanded': 'false', 'aria-controls': 'add-body' }, it.label);
    button.addEventListener('click', () => {
      for (const b of buttons) b.setAttribute('aria-expanded', String(b === button));
      open = { button, make: it.make };
      body.replaceChildren(h('h3', {}, it.label), ...it.fields, ...pv.nodes);
      pv.show(it.make);
    });
    return button;
  });
  const fold: HTMLDetailsElement = h('details', { open: ctx.fold.open, onToggle: () => { ctx.fold.open = fold.open; } },
    h('summary', {}, 'Thêm'), h('div', { className: 'add-items' }, ...buttons), body);
  return h('aside', { id: 'ws-add', 'aria-label': 'Thêm' }, fold);
}
