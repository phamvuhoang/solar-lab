import { buildQuote } from '../cost/quote';
import { addHole, addObstacle, addRoofFace, clearPlacements, demoGableRoof, faceRect, fillFace, movePanels, placeGrid, removeFace, removeObstacle, removePlacements, rotate90, unplacedPanels, updateFace } from '../domain/layout-edit';
import { isSimplePolygon, type Pt } from '../domain/roof';
import { refKey, type Project } from '../domain/types';
import { parseNumber } from '../domain/units';
import { buildSceneModel } from '../scene/model';
import { h } from './dom';
import type { Tab } from './route';

export interface RoofState { faceId: string | null; angle: 0 | 90; stepCm: number }
export interface RoofCtx {
  project: Project; selection: string[]; state: RoofState;
  apply(next: Project): Promise<void>; setSelection(ids: string[]): void; rerender(): void;
  history: { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void }; go(tab: Tab): void;
}

const dec = (x: number) => String(Math.round(x * 1000) / 1000).replace('.', ',');
const num = (t: string) => { const v = t.trim() ? parseNumber(t.trim()) : null; return v; };

/** "a b; a b; a b" (decimal comma or dot, vertices separated by ; or newline) → polygon, or an error message. */
export function parsePolygon(text: string): { ok: true; ring: Pt[] } | { ok: false; message: string } {
  const parts = text.split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
  const ring: Pt[] = [];
  for (const part of parts) {
    const m = /^(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)$/.exec(part);
    if (!m) return { ok: false, message: `Đỉnh "${part}" cần dạng "a b" (mét, cách nhau bằng dấu cách)` };
    ring.push([Number(m[1].replace(',', '.')), Number(m[2].replace(',', '.'))]);
  }
  if (ring.length < 3) return { ok: false, message: 'Cần ít nhất 3 đỉnh' };
  if (!isSimplePolygon(ring)) return { ok: false, message: 'Đa giác tự cắt, trùng đỉnh hoặc diện tích 0' };
  return { ok: true, ring };
}
const ringText = (r: Pt[]) => r.map(([a, b]) => `${dec(a)} ${dec(b)}`).join('; ');

export function renderRoof(ctx: RoofCtx): Node[] {
  const p = ctx.project, st = ctx.state, model = buildSceneModel(p), sel = new Set(ctx.selection.filter((id) => model.panels.some((x) => x.instanceId === id)));
  const msg = h('div', { id: 'roof-messages', role: 'alert' });
  const say = (lines: string[]) => msg.replaceChildren(...lines.map((l) => h('p', {}, l)));
  const run = (f: () => Project) => { try { void ctx.apply(f()); } catch (e) { say([(e as Error).message]); } };
  const faceId = st.faceId && p.roofFaces.some((f) => f.roofFaceId === st.faceId) ? st.faceId : p.roofFaces[0]?.roofFaceId ?? null;
  const unplaced = unplacedPanels(p);
  const ids = [...sel];

  const btn = (label: string, f: () => void, id?: string, disabled = false) => h('button', { id, onClick: f, disabled }, label);
  // ---- 1. roof and obstacles --------------------------------------------------------------------------------
  const faceEditors = p.roofFaces.map((f) => {
    const f_ = (id: string, label: string, v: string, size = 7) => { const el = h('input', { id: `${id}-${f.roofFaceId}`, value: v, size }); return { el, node: h('label', {}, label + ' ', el) }; };
    const lab = f_('rf-label', 'Tên', f.label, 16), tilt = f_('rf-tilt', 'Nghiêng (°)', dec(f.tiltDeg), 5), az = f_('rf-az', 'Hướng (°, Bắc = 0)', dec(f.azimuthDeg), 5), sb = f_('rf-sb', 'Cách mép tối thiểu (m)', dec(f.setbackM), 5);
    const oe = f_('rf-oe', 'Gốc Đông', dec(f.origin.e), 6), on = f_('rf-on', 'Bắc', dec(f.origin.n), 6), ou = f_('rf-ou', 'Cao', dec(f.origin.up), 6);
    const outline = h('textarea', { id: `rf-outline-${f.roofFaceId}`, rows: 2, cols: 40, value: ringText(f.outline), 'aria-label': 'Đường biên mặt mái' });
    const holes = h('textarea', { id: `rf-holes-${f.roofFaceId}`, rows: 2, cols: 40, value: f.holes.map(ringText).join('\n'), placeholder: 'mỗi dòng một vùng loại trừ: a b; a b; a b', 'aria-label': 'Vùng loại trừ' });
    return h('details', { className: 'card', 'data-face': f.roofFaceId, open: p.roofFaces.length === 1 }, h('summary', {}, `${f.label} · ${f.tiltDeg}° · hướng ${f.azimuthDeg}°`),
      lab.node, tilt.node, az.node, sb.node, h('br'), oe.node, on.node, ou.node, h('br'),
      h('label', {}, 'Biên (a b; a b; … mét trong khung mặt mái) ', outline), h('br'), h('label', {}, 'Vùng loại trừ ', holes), h('br'),
      btn('Lưu mặt mái', () => {
        const o = parsePolygon(outline.value);
        if (!o.ok) return say([`${f.label}: ${o.message}`]);
        const hs: Pt[][] = [];
        for (const line of holes.value.split('\n').map((x) => x.trim()).filter(Boolean)) { const r = parsePolygon(line); if (!r.ok) return say([`${f.label}, vùng loại trừ: ${r.message}`]); hs.push(r.ring); }
        const v = [num(tilt.el.value), num(az.el.value), num(sb.el.value), num(oe.el.value), num(on.el.value), num(ou.el.value)];
        if (v.some((x) => x === null) || v[0]! < 0 || v[0]! > 89 || v[1]! < 0 || v[1]! >= 360 || v[2]! < 0) return say([`${f.label}: nghiêng 0–89°, hướng 0–359,9°, khoảng cách ≥ 0, gốc là số`]);
        say([]);
        run(() => updateFace(p, f.roofFaceId, { label: lab.el.value.trim() || f.label, outline: o.ring, holes: hs, tiltDeg: v[0]!, azimuthDeg: v[1]!, setbackM: v[2]!, setbackSource: 'user', origin: { e: v[3]!, n: v[4]!, up: v[5]! } }));
      }, `save-face-${f.roofFaceId}`), btn('Xóa mặt mái', () => run(() => removeFace(p, f.roofFaceId))),
      h('p', {}, `Khoảng cách tối thiểu ${f.setbackM} m là ${f.setbackSource === 'assumption' ? 'giả định thiết kế, chưa phải số đo' : 'số người dùng khai'}.`));
  });
  const rectForm = (() => {
    const g = (id: string, label: string, v: string) => { const el = h('input', { id, value: v, size: 5 }); return { el, node: h('label', {}, label + ' ', el) }; };
    const w = g('nr-w', 'Rộng (m)', '10'), sl = g('nr-s', 'Dài theo dốc (m)', '3,25'), t = g('nr-t', 'Nghiêng (°)', '10'), a = g('nr-a', 'Hướng (°)', '180');
    return h('form', { 'aria-label': 'Thêm mặt mái chữ nhật', onSubmit: (e: Event) => { e.preventDefault(); const v = [w, sl, t, a].map((x) => num(x.el.value)); if (v.some((x) => x === null || x < 0) || v[0]! <= 0 || v[1]! <= 0) return say(['Kích thước phải là số dương, nghiêng và hướng ≥ 0']); say([]); run(() => addRoofFace(p, faceRect(`Mái ${p.roofFaces.length + 1}`, v[0]!, v[1]!, v[2]!, v[3]!, { e: 0, n: 0, up: 3 }))); } },
      w.node, sl.node, t.node, a.node, h('button', { type: 'submit', id: 'add-rect' }, 'Thêm mặt mái chữ nhật'));
  })();
  const obstacleList = (p.obstacles ?? []).map((o) => h('li', {}, h('button', { type: 'button', 'aria-label': `Chọn ${o.label}`, onClick: () => ctx.setSelection([o.obstacleId]) }, o.label), ` · ${o.kind === 'box' ? 'hộp' : 'trụ'} ${dec(o.size.x)}×${dec(o.size.y)}×${dec(o.size.z)} m · tại (${dec(o.center.e)}, ${dec(o.center.n)}) ${o.roofFaceId ? '· trên mái' : '· đứng riêng'} `, btn('Xóa', () => run(() => removeObstacle(p, o.obstacleId)))));

  // ---- 2. placement tools -----------------------------------------------------------------------------------
  const faceSel = h('select', { id: 'place-face', 'aria-label': 'Mặt mái' }, ...p.roofFaces.map((f) => h('option', { value: f.roofFaceId }, f.label)));
  if (faceId) faceSel.value = faceId;
  faceSel.addEventListener('change', () => { st.faceId = faceSel.value; ctx.rerender(); });
  const angle = h('select', { id: 'place-angle', 'aria-label': 'Hướng đặt' }, h('option', { value: '0' }, 'Dọc (cạnh dài theo dốc)'), h('option', { value: '90' }, 'Ngang'));
  angle.value = String(st.angle);
  angle.addEventListener('change', () => { st.angle = Number(angle.value) as 0 | 90; });
  const cols = h('input', { id: 'grid-cols', value: '4', size: 3, 'aria-label': 'Số cột' }), a0 = h('input', { id: 'grid-a0', value: '0,5', size: 4, 'aria-label': 'a0' }), b0 = h('input', { id: 'grid-b0', value: '0,5', size: 4, 'aria-label': 'b0' });
  const stepSel = h('select', { id: 'nudge-step', 'aria-label': 'Bước dịch' }, ...[1, 5, 10, 50].map((c) => h('option', { value: String(c) }, `${c} cm`)));
  stepSel.value = String(st.stepCm);
  stepSel.addEventListener('change', () => { st.stepCm = Number(stepSel.value); });
  const nudge = (da: number, db: number) => () => { if (!ids.length) return say(['Chọn tấm trước']); run(() => movePanels(p, ids, [da * (st.stepCm / 100), db * (st.stepCm / 100)])); };
  const tools = h('div', { id: 'place-tools' },
    h('p', {}, `Đã đặt ${model.panels.length}/${model.panels.length + unplaced.length} tấm; chưa đặt ${unplaced.length}.`),
    h('label', {}, 'Mặt mái ', faceSel), h('label', {}, ' ', angle),
    btn('Điền đầy mái bằng tấm chưa đặt', () => {
      if (!faceId) return say(['Thêm mặt mái trước']);
      if (!unplaced.length) return say(['Mọi tấm đã có vị trí']);
      const r = fillFace(p, faceId, unplaced, st.angle);
      say([r.placed.length ? `Đặt ${r.placed.length} tấm${r.left.length ? `; còn ${r.left.length} tấm không vừa mặt mái này` : ''}.` : 'Không đặt được tấm nào: mặt mái quá nhỏ hoặc thiếu kích thước tấm.']);
      if (r.placed.length) void ctx.apply(r.project);
    }, 'fill-face'),
    h('label', {}, ' Đặt dãy: cột ', cols), h('label', {}, ' từ a ', a0), h('label', {}, ' b ', b0),
    btn('Đặt dãy', () => {
      const [c, a, b] = [num(cols.value), num(a0.value), num(b0.value)];
      if (!faceId || c === null || !Number.isInteger(c) || c < 1 || a === null || b === null) return say(['Số cột nguyên dương và a, b là số mét']);
      if (!unplaced.length) return say(['Mọi tấm đã có vị trí']);
      run(() => placeGrid(p, faceId, unplaced, { a0: a, b0: b, cols: c, angleDeg: st.angle }));
    }, 'place-grid'),
    h('div', {}, h('strong', {}, 'Tấm đang chọn: '), `${sel.size}`, ' ',
      btn('Xoay 90°', () => (ids.length ? run(() => rotate90(p, ids)) : say(['Chọn tấm trước'])), 'rotate-sel'), btn('Xóa vị trí', () => (ids.length ? run(() => removePlacements(p, ids)) : say(['Chọn tấm trước'])), 'remove-sel'),
      btn('Bỏ chọn', () => ctx.setSelection([]), 'clear-sel'), btn('Chọn tất cả', () => ctx.setSelection(model.panels.map((x) => x.instanceId)), 'select-all'), btn('Xóa mọi vị trí', () => run(() => clearPlacements(p)), 'clear-all')),
    h('div', {}, 'Dịch tấm chọn: ', h('label', {}, stepSel), btn('←', nudge(-1, 0), 'nudge-left'), btn('→', nudge(1, 0), 'nudge-right'), btn('↑ lên dốc', nudge(0, 1), 'nudge-up'), btn('↓ xuống dốc', nudge(0, -1), 'nudge-down'),
      h('span', {}, ' (hoặc kéo trên mặt bằng/3D, rời chuột thì snap lưới 5 cm và cạnh tấm bên cạnh; mặt bằng: ←→↑↓, Shift = 1 cm, R xoay, Delete xóa, Esc bỏ chọn)')));

  // selection details: same ids as the BOM
  const quote = buildQuote(p);
  const info = (() => {
    if (sel.size === 0) return h('p', { id: 'sel-info' }, 'Chưa chọn tấm nào. Bấm một tấm trong 3D, mặt bằng, danh sách hoặc sơ đồ điện.');
    if (sel.size > 1) return h('p', { id: 'sel-info' }, `Đang chọn ${sel.size} tấm: ${[...sel].map((i) => model.panels.find((x) => x.instanceId === i)!.label.replace(/^.* #/, '#')).join(', ')}`);
    const pn = model.panels.find((x) => x.instanceId === ids[0])!, pl = p.placements!.find((x) => x.instanceId === pn.instanceId)!, inst = p.instances.find((i) => i.instanceId === pn.instanceId)!;
    const key = inst.componentRef ? refKey(inst.componentRef) : '', line = quote.lines.find((l) => l.key === `design:${key}`), count = quote.deviceCounts[key] ?? 0;
    return h('dl', { id: 'sel-info' }, h('dt', {}, 'Tấm'), h('dd', {}, `${pn.label} (${pn.instanceId})`), h('dt', {}, 'Mặt mái · vị trí'), h('dd', {}, `${p.roofFaces.find((f) => f.roofFaceId === pn.faceId)?.label} · a=${dec(pl.center[0])} m, b=${dec(pl.center[1])} m, ${pl.angleDeg ? 'ngang' : 'dọc'}`),
      h('dt', {}, 'Chuỗi'), h('dd', {}, pn.stringIndex ? `Chuỗi ${pn.stringIndex}, vị trí ${pn.seriesIndex} trong chuỗi` : 'chưa vào chuỗi'),
      h('dt', {}, 'BOM'), h('dd', {}, `${count} chiếc cùng loại${line?.unitPriceMinor ? ` · đơn giá ${Number(line.unitPriceMinor).toLocaleString('vi-VN')} đ/${line.priceUnit}` : ''} (đặt hay dịch tấm không đổi số lượng hay giá)`));
  })();

  // ---- 4. issues, table, routes -----------------------------------------------------------------------------
  const issues = model.issues.length
    ? h('ul', { id: 'layout-issues' }, ...model.issues.map((i) => h('li', {}, h('button', { className: `finding ${i.severity === 'error' ? 'fail' : 'limited'}`, 'data-code': i.code, onClick: () => ctx.setSelection([i.instanceId, i.otherId].filter(Boolean) as string[]) }, `${i.severity === 'error' ? 'Lỗi' : 'Cảnh báo'} ${i.code}: ${i.message}`))))
    : h('p', { id: 'layout-issues' }, model.panels.length ? 'Mọi vị trí hợp lệ: trong biên mái, không giao nhau, đủ khoảng cách.' : 'Chưa có tấm nào được đặt.');
  const rows = p.instances.filter((i) => i.kind === 'panel').map((i) => {
    const pn = model.panels.find((x) => x.instanceId === i.instanceId), pl = (p.placements ?? []).find((x) => x.instanceId === i.instanceId);
    const own = model.issues.filter((x) => x.instanceId === i.instanceId || x.otherId === i.instanceId);
    return h('tr', { 'data-id': i.instanceId, className: sel.has(i.instanceId) ? 'selected' : '', 'aria-selected': String(sel.has(i.instanceId)) },
      h('td', {}, h('button', { onClick: () => ctx.setSelection([i.instanceId]), 'aria-label': `Chọn ${i.label}` }, i.label)), h('td', {}, i.instanceId.slice(0, 12)),
      h('td', {}, pl ? p.roofFaces.find((f) => f.roofFaceId === pl.roofFaceId)?.label ?? '?' : 'chưa đặt'), h('td', { className: 'num' }, pl ? dec(pl.center[0]) : '—'), h('td', { className: 'num' }, pl ? dec(pl.center[1]) : '—'),
      h('td', {}, pl ? (pl.angleDeg ? 'ngang' : 'dọc') : '—'), h('td', {}, pn?.stringIndex ? `S${pn.stringIndex}·${pn.seriesIndex}` : '—'), h('td', {}, !pl ? 'chưa đặt' : own.some((x) => x.severity === 'error') ? 'lỗi' : own.length ? 'cảnh báo' : 'hợp lệ'));
  });
  const routes = model.routes.length ? h('table', { id: 'routes-table' }, h('thead', {}, h('tr', {}, ...['Chuỗi', 'Tấm đã đặt', 'Chiều dài đường nối (m)', 'Nguồn'].map((t) => h('th', {}, t)))),
    h('tbody', {}, ...model.routes.map((r) => h('tr', {}, h('td', {}, `S${r.stringIndex} · ${r.label}`), h('td', {}, String(r.points.length)), h('td', { className: 'num' }, dec(r.lengthM)),
      h('td', {}, `ước lượng khái niệm theo tâm tấm${r.spansFaces ? ' (qua nhiều mặt mái)' : ''}; chưa gồm dây về inverter, tiết diện và thiết bị bảo vệ do người lắp xác nhận`))))) : null;

  return [
    h('h2', {}, `Mái nhà 3D · ${p.name}`),
    h('div', {}, btn('Hoàn tác', ctx.history.undo, 'undo', !ctx.history.canUndo), btn('Làm lại', ctx.history.redo, 'redo', !ctx.history.canRedo), btn('Sơ đồ điện', () => ctx.go('thiet-ke'), 'to-design'), btn('Bóng che', () => ctx.go('bong'), 'to-shade')), msg,
    h('p', {}, 'Tọa độ ENU (Đông, Bắc, Lên) tính bằng mét; hướng mặt mái theo chiều kim đồng hồ từ Bắc. Mái và vật cản minh họa là giả định: thay bằng số đo công trình.'),
    h('h3', {}, '1. Mái và vật cản'),
    p.roofFaces.length ? null : h('p', {}, 'Chưa có mặt mái.'),
    btn('Thêm mái minh họa (hai mái dốc 10×3,25 m)', () => run(() => demoGableRoof(p)), 'add-demo-roof'),
    ...faceEditors, rectForm,
    h('div', {}, btn('Thêm mặt mái chữ L (lõm) minh họa', () => run(() => { let n = addRoofFace(p, { ...faceRect(`Mái chữ L ${p.roofFaces.length + 1}`, 8, 6, 10, 180, { e: 0, n: 0, up: 3 }), outline: [[0, 0], [8, 0], [8, 2.9], [3, 2.9], [3, 6], [0, 6]] }); return n; }), 'add-l-roof'),
      btn('Thêm vùng loại trừ 1×1 m vào mặt mái đầu', () => (p.roofFaces[0] ? run(() => addHole(p, p.roofFaces[0].roofFaceId, [[4, 1], [5, 1], [5, 2], [4, 2]])) : say(['Thêm mặt mái trước'])), 'add-hole')),
    h('div', {}, btn('Thêm bồn nước (trụ Ø1,2 × 1,8 m) cạnh nhà', () => run(() => addObstacle(p, { label: 'Bồn nước', kind: 'cylinder', roofFaceId: null, center: { e: 12.5, n: 3.2 }, baseUp: 0, angleDeg: 0, size: { x: 1.2, y: 1.2, z: 1.8 } })), 'add-tank'),
      btn('Thêm hộp 0,6×0,6×0,8 m trên mái', () => (p.roofFaces[0] ? run(() => addObstacle(p, { label: 'Ống thông hơi', kind: 'box', roofFaceId: p.roofFaces[0].roofFaceId, center: { e: 5, n: 1.2 }, baseUp: 3.2, angleDeg: 0, size: { x: 0.6, y: 0.6, z: 0.8 } })) : say(['Thêm mặt mái trước'])), 'add-box')),
    obstacleList.length ? h('ul', { id: 'obstacles' }, ...obstacleList) : null,
    h('h3', {}, '2. Đặt tấm'), tools,
    h('h3', {}, '3. Xem'), h('p', {}, 'Mặt bằng từng mặt mái ở khung nhìn, nút "Mặt bằng".'), info,
    h('h3', {}, 'Kiểm tra vị trí'), issues,
    h('h3', {}, 'Danh sách tấm'),
    h('table', { id: 'panel-table' }, h('thead', {}, h('tr', {}, ...['Tấm', 'ID', 'Mặt mái', 'a (m)', 'b (m)', 'Hướng đặt', 'Chuỗi', 'Trạng thái'].map((t) => h('th', {}, t)))), h('tbody', {}, ...rows)),
    routes,
  ].filter(Boolean) as Node[];
}
