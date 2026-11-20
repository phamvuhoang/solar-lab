import { renderDiagram } from '../diagrams/editor';
import { addEdge, indexProject, isStringTarget, portKey, removeEdge, removeString, setStringSize, setStringTarget, stringsOf, dropInstances, unassignedPanels, PORT_TYPE_LABEL } from '../domain/graph';
import { addAcLoad, addBatteryBranch, addPanelBatch, addPumpBranch, applyPreset, proposeStrings, PRESET_LABEL, type PresetKind } from '../domain/presets';
import { refKey, type Component, type Offer, type Project } from '../domain/types';
import { parseNumber, parseQuantity } from '../domain/units';
import { designOf, validateDesign, type Finding } from '../validation/strings';
import { h } from './dom';
import type { Tab } from './route';

export interface DesignCtx {
  project: Project; components: Component[]; offers: Offer[]; selected: string | null;
  /** focusIds: element ids to try, in order, once the screen has re-rendered. */
  select(id: string | null, focusIds?: string[]): void; apply(next: Project): Promise<void>;
  history: { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void };
  go(tab: Tab): void;
}

const STATUS_LABEL = { pass: 'đạt', fail: 'không đạt', limited: 'bị giới hạn công suất', unknown: 'chưa đủ dữ liệu' } as const;
const offersFor = (offers: Offer[], c: Component) => offers.filter((o) => refKey(o.componentRef) === refKey(c));

export function renderDesign(ctx: DesignCtx): Node[] {
  const p = ctx.project;
  const ix = indexProject(p);
  const findings = validateDesign(p);
  const msg = h('p', { role: 'alert', id: 'design-error' });
  const fail = (m: string) => { msg.textContent = m; };
  const run = async (f: () => Project) => { try { await ctx.apply(f()); } catch (e) { fail(errText(e)); } };

  const bad = findings.filter((f) => f.status !== 'pass');
  const good = findings.filter((f) => f.status === 'pass');
  const invComp = [...ix.inst.values()].find((d) => d.inst.kind === 'inverter')?.comp;

  const finding = (f: Finding) => h('li', {}, h('button', { className: `finding ${f.status}`, 'data-code': f.code, onClick: () => ctx.select(f.objectIds[0], fixTargets(f)) },
    `[${STATUS_LABEL[f.status]}${f.assumed ? ', có giả định' : ''}] ${f.message}`));

  const detail = () => {
    const f = findings.find((x) => x.objectIds[0] === ctx.selected) ?? findings.find((x) => ctx.selected && x.objectIds.includes(ctx.selected));
    if (!f) return h('p', { id: 'finding-detail' }, ctx.selected ? 'Không có kiểm tra nào gắn với đối tượng đang chọn.' : 'Chọn một mục trong sơ đồ hoặc danh sách lỗi.');
    return h('div', { id: 'finding-detail', 'aria-live': 'polite' },
      h('h3', {}, f.code), h('p', {}, f.message),
      f.formula && h('p', {}, h('strong', {}, 'Công thức: '), f.formula),
      f.value !== null && h('p', {}, h('strong', {}, 'Giá trị / giới hạn: '), `${f.value} ${f.unit} / ${f.limit ?? '—'} ${f.unit}`),
      f.sources.length ? h('ul', {}, ...f.sources.map((x) => h('li', {}, `${x.where} · ${x.field} = ${x.value ?? 'chưa có'} ${x.unit} (${x.provenance})`))) : null,
      h('p', {}, h('strong', {}, 'Hậu quả: '), f.consequence), h('p', {}, h('strong', {}, 'Cách sửa: '), f.fix));
  };

  return [
    h('h2', {}, `Thiết kế · ${p.name}`),
    h('div', {}, h('button', { id: 'undo', disabled: !ctx.history.canUndo, onClick: ctx.history.undo }, 'Hoàn tác'), h('button', { id: 'redo', disabled: !ctx.history.canRedo, onClick: ctx.history.redo }, 'Làm lại'),
      h('button', { id: 'open-roof', onClick: () => ctx.go('mai') }, ctx.selected && p.strings?.some((x) => x.stringId === ctx.selected) ? 'Xem chuỗi đang chọn trên mái 3D' : 'Mái nhà 3D')),
    msg,
    renderDiagram(p, findings, ctx.selected, (id) => ctx.select(id)),
    h('h3', {}, 'Kiểm tra điện'),
    h('p', { id: 'findings-summary' }, `${findings.filter((f) => f.status === 'fail' && f.severity === 'error').length} lỗi thiết kế · ${findings.filter((f) => f.status === 'limited').length} giới hạn công suất · ${findings.filter((f) => f.status === 'unknown').length} chưa đủ dữ liệu · ${good.length} đạt`),
    h('ul', { id: 'findings' }, ...bad.map(finding)),
    good.length ? h('details', {}, h('summary', {}, `${good.length} kiểm tra đạt`), h('ul', {}, ...good.map(finding))) : null,
    detail(),
    h('h3', {}, 'Thiết lập thiết kế'), settingsForm(ctx, fail),
    h('h3', {}, 'Thêm theo lô'), batchForm(ctx, invComp, fail, run),
    h('h3', {}, 'Preset và nhánh'), presetForm(ctx, run, fail),
    h('h3', {}, 'Kết nối (thay cho kéo thả)'), connections(ctx, run, fail),
  ].filter(Boolean) as Node[];
}

const errText = (e: unknown) => ({ NOT_ENOUGH_PANELS: 'Không đủ tấm chưa gán để thêm vào chuỗi', NO_PANELS: 'Dự án chưa có tấm', NO_INVERTER: 'Cần có inverter trước', INVALID_SIZE: 'Số tấm phải là số nguyên không âm' } as Record<string, string>)[(e as Error).message] ?? (e as Error).message;

/** Controls that fix a finding, most specific first. */
const fixTargets = (f: Finding): string[] => [...(f.stringId ? [`str-target-${f.stringId}`] : []), `edge-del-${f.objectIds[0]}`, 'edge-from'];

function settingsForm(ctx: DesignCtx, fail: (m: string) => void): HTMLElement {
  const d = designOf(ctx.project);
  const cold = h('input', { id: 'd-cold', value: d.coldCellTempC === null ? '' : String(d.coldCellTempC).replace('.', ','), size: 5 });
  const hot = h('input', { id: 'd-hot', value: d.hotCellTempC === null ? '' : String(d.hotCellTempC).replace('.', ','), size: 5 });
  const isc = h('input', { id: 'd-isc', value: String(d.iscFactor).replace('.', ','), size: 5 });
  const beta = h('input', { id: 'd-beta', value: d.betaVmpAssumption === null ? '' : String(d.betaVmpAssumption * 100).replace('.', ','), size: 6, placeholder: 'để trống nếu chưa quyết' });
  const src = h('input', { id: 'd-src', value: d.source, placeholder: 'nguồn của các giá trị này' });
  const temp = (el: HTMLInputElement): number | null | 'bad' => { const t = el.value.trim(); if (!t) return null; const n = parseNumber(t); return n === null ? 'bad' : n; };
  return h('form', { onSubmit: (e: Event) => {
    e.preventDefault();
    const [c, ho, f] = [temp(cold), temp(hot), parseNumber(isc.value.trim() || '1')];
    if (c === 'bad' || ho === 'bad' || f === null) return fail('Nhiệt độ và hệ số Isc phải là số');
    let b: number | null = null;
    if (beta.value.trim()) { const r = parseQuantity(beta.value, 'coef', { allowNegative: true }); if (!r.ok) return fail(`βVmp: ${r.message}`); b = r.value; }
    fail('');
    ctx.apply({ ...structuredClone(ctx.project), design: { coldCellTempC: c, hotCellTempC: ho, iscFactor: f, betaVmpAssumption: b, source: src.value.trim() } }).catch((x) => fail(errText(x)));
  }, 'aria-label': 'Thiết lập thiết kế' },
  h('label', {}, 'Tcell thấp nhất (°C) ', cold), h('label', {}, ' Tcell cao nhất (°C) ', hot), h('label', {}, ' Hệ số Isc ', isc), h('label', {}, ' Giả định βVmp (%/°C) ', beta), h('label', {}, ' Nguồn ', src),
  h('button', { type: 'submit' }, 'Lưu thiết lập'),
  h('p', {}, 'Để trống thì các kiểm tra phụ thuộc trả "chưa đủ dữ liệu". βVmp không được suy từ βPmax.'));
}

function batchForm(ctx: DesignCtx, invComp: Component | undefined, fail: (m: string) => void, run: (f: () => Project) => Promise<void>): HTMLElement {
  const panels = ctx.components.filter((c) => c.kind === 'panel');
  const model = h('select', { id: 'b-model', 'aria-label': 'Model tấm' }, ...panels.map((c) => h('option', { value: refKey(c) }, c.name)));
  const count = h('input', { id: 'b-count', type: 'number', min: 1, value: 8, style: 'width:4.5rem', 'aria-label': 'Số tấm' });
  const preview = h('p', { id: 'b-preview' });
  const update = () => {
    const n = Number(count.value), c = panels.find((x) => refKey(x) === model.value);
    if (!c || !Number.isInteger(n) || n < 1) { preview.textContent = 'Nhập số tấm nguyên dương'; return; }
    const sizes = proposeStrings(n, c, invComp);
    preview.textContent = `Thêm ${n} × ${c.name} → ${sizes.length} chuỗi (${sizes.join(' + ')} tấm)` + (invComp ? ` vào MPPT 1…${sizes.length}` : ', chưa nối vì chưa có inverter');
  };
  [model, count].forEach((el) => el.addEventListener('input', update));
  update();
  return h('form', { onSubmit: (e: Event) => {
    e.preventDefault();
    const n = Number(count.value), c = panels.find((x) => refKey(x) === model.value);
    if (!c || !Number.isInteger(n) || n < 1) return fail('Số tấm phải là số nguyên dương');
    run(() => addPanelBatch(ctx.project, c, n, invComp, offersFor(ctx.offers, c)));
  }, 'aria-label': 'Thêm tấm theo lô' }, h('label', {}, 'Model ', model), h('label', {}, ' Số tấm ', count), preview, h('button', { type: 'submit' }, 'Xác nhận thêm'));
}

function presetForm(ctx: DesignCtx, run: (f: () => Project) => Promise<void>, fail: (m: string) => void): HTMLElement {
  const comps = (k: string) => ctx.components.filter((c) => c.kind === k);
  const pick = (id: string, k: string, label: string) => {
    const sel = h('select', { id, 'aria-label': label }, ...comps(k).map((c) => h('option', { value: refKey(c) }, c.name)));
    return { sel, get: () => comps(k).find((c) => refKey(c) === sel.value)! };
  };
  const preset = h('select', { id: 'preset', 'aria-label': 'Preset' }, ...(Object.keys(PRESET_LABEL) as PresetKind[]).map((k) => h('option', { value: k }, PRESET_LABEL[k])));
  const inv = pick('p-inv', 'inverter', 'Inverter'), bat = pick('p-bat', 'battery', 'Pin'), load = pick('p-load', 'load', 'Tải'), ctl = pick('p-ctl', 'controller', 'Controller');
  const free = unassignedPanels(ctx.project);
  const pumpN = h('input', { id: 'p-pump-n', type: 'number', min: 1, value: 2, style: 'width:4rem', 'aria-label': 'Số tấm cho bơm' });
  const o = (c: Component) => offersFor(ctx.offers, c);
  return h('div', {},
    h('div', {}, preset, inv.sel, h('button', { id: 'apply-preset', onClick: () => run(() => applyPreset(ctx.project, preset.value as PresetKind, inv.get(), o(inv.get()))) }, 'Áp dụng preset (thay mọi chuỗi)')),
    h('div', {}, bat.sel, h('button', { onClick: () => run(() => addBatteryBranch(ctx.project, bat.get(), o(bat.get()))) }, 'Thêm pin vào inverter')),
    h('div', {}, load.sel, h('button', { onClick: () => run(() => addAcLoad(ctx.project, load.get(), o(load.get()))) }, 'Thêm tải AC')),
    h('div', {}, ctl.sel, h('label', {}, ' tấm cho bơm ', pumpN), h('button', { onClick: () => {
      const n = Number(pumpN.value);
      if (!Number.isInteger(n) || n < 1 || n > free.length) return fail(`Cần ${n || '?'} tấm chưa gán, hiện có ${free.length}`);
      const l = comps('load')[0];
      run(() => addPumpBranch(ctx.project, ctl.get(), load.get() ?? l, free.slice(0, n), ctx.offers));
    } }, 'Thêm nhánh bơm PV riêng')));
}

function connections(ctx: DesignCtx, run: (f: () => Project) => Promise<void>, fail: (m: string) => void): HTMLElement {
  const p = ctx.project, ix = indexProject(p);
  const targets = [...ix.inst.values()].flatMap((d) => d.ports.filter((x) => isStringTarget(x.type)).map((x) => ({ key: portKey({ instanceId: d.inst.instanceId, port: x.id }), label: `${d.inst.label.replace(/ #\d+$/, '')} · ${x.label}`, ref: { instanceId: d.inst.instanceId, port: x.id } })));
  const strRows = stringsOf(p).map((st) => {
    const sel = h('select', { id: `str-target-${st.stringId}`, 'aria-label': `Cổng của ${st.label}` }, h('option', { value: '' }, '— chưa nối —'), ...targets.map((t) => h('option', { value: t.key }, t.label)));
    sel.value = st.target ? portKey(st.target) : '';
    sel.addEventListener('change', () => run(() => setStringTarget(p, st.stringId, targets.find((t) => t.key === sel.value)?.ref ?? null)));
    const size = h('input', { type: 'number', min: 0, value: st.panelIds.length, style: 'width:4rem', 'aria-label': `Số tấm của ${st.label}` });
    return h('tr', { 'data-string': st.stringId }, h('td', {}, st.label), h('td', {}, size, h('button', { onClick: () => run(() => setStringSize(p, st.stringId, Number(size.value))) }, 'Đặt số tấm')),
      h('td', {}, sel), h('td', {}, h('button', { 'aria-label': `Xóa ${st.label}`, onClick: () => run(() => removeString(p, st.stringId)) }, 'Xóa')));
  });
  const allPorts = [...ix.inst.values()].filter((d) => d.ports.length).flatMap((d) => d.ports.map((x) => ({ key: portKey({ instanceId: d.inst.instanceId, port: x.id }), label: `${d.inst.label.replace(/ #\d+$/, '')} · ${x.label} (${PORT_TYPE_LABEL[x.type]})`, ref: { instanceId: d.inst.instanceId, port: x.id } })));
  const mk = (id: string, label: string) => h('select', { id, 'aria-label': label }, ...allPorts.map((t) => h('option', { value: t.key }, t.label)));
  const from = mk('edge-from', 'Từ cổng (nguồn)'), to = mk('edge-to', 'Tới cổng (tải)');
  const label = (r: { instanceId: string; port: string }) => allPorts.find((x) => x.key === portKey(r))?.label ?? portKey(r);
  return h('div', {},
    h('table', { id: 'strings-table' }, h('thead', {}, h('tr', {}, ...['Chuỗi', 'Số tấm', 'Nối vào', ''].map((t) => h('th', {}, t)))), h('tbody', {}, ...strRows)),
    h('ul', { id: 'edges' }, ...p.edges.map((e) => h('li', {}, `${label(e.from)} → ${label(e.to)} `, h('button', { id: `edge-del-${e.edgeId}`, onClick: () => run(() => removeEdge(p, e.edgeId)) }, 'Xóa kết nối')))),
    h('form', { onSubmit: (e: Event) => { e.preventDefault(); const a = allPorts.find((x) => x.key === from.value), b = allPorts.find((x) => x.key === to.value); if (!a || !b) return fail('Chọn hai cổng'); run(() => addEdge(p, a.ref, b.ref)); }, 'aria-label': 'Thêm kết nối' },
      h('label', {}, 'Từ ', from), h('label', {}, ' tới ', to), h('button', { type: 'submit' }, 'Nối')),
    h('h4', {}, 'Thiết bị'),
    h('ul', {}, ...[...ix.inst.values()].filter((d) => d.inst.kind !== 'panel').map((d) => h('li', {}, d.inst.label, ' ',
      h('button', { 'aria-label': `Xóa ${d.inst.label}`, onClick: () => run(() => dropInstances(p, new Set([d.inst.instanceId]))) }, 'Xóa')))));
}
