import { footprintOnFace, type Pt } from '../domain/roof';
import { layoutOf, panelDims, panelRing } from '../domain/placement';
import type { Project, RoofFace } from '../domain/types';
import type { SceneModel } from '../scene/model';
import { stringColor } from '../scene/three-view';

const NS = 'http://www.w3.org/2000/svg';
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: (Node | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) el.append(c);
  return el;
}

export interface PlanHandlers {
  /** 'drag': the panel a drag moved, selected with it (see ViewHandlers). */
  onSelect(ids: string[], mode: 'set' | 'toggle' | 'drag'): void;
  onMove(ids: string[], delta: [number, number], snap: boolean): void;
  onRotate(ids: string[]): void;
  onRemove(ids: string[]): void;
  onClear(): void;
}

/**
 * Plan view of one roof face in its own frame (a to the right, b up the slope), in metres. It is both the placement editor and the
 * fallback when WebGL is unavailable: same selection, same validator colours, same ids as the 3D view.
 */
export function renderFacePlan(p: Project, face: RoofFace, model: SceneModel, selection: ReadonlySet<string>, h: PlanHandlers): SVGSVGElement {
  const xs = face.outline.map((q) => q[0]), ys = face.outline.map((q) => q[1]);
  const m = 0.6, minA = Math.min(...xs) - m, maxA = Math.max(...xs) + m, minB = Math.min(...ys) - m, maxB = Math.max(...ys) + m;
  const Y = (b: number) => maxB + minB - b; // b grows upward
  const pts = (r: Pt[]) => r.map(([a, b]) => `${a.toFixed(4)},${Y(b).toFixed(4)}`).join(' ');
  const svg = s('svg', { viewBox: `${minA} ${minB} ${maxA - minA} ${maxB - minB}`, role: 'group', 'aria-label': `Mặt bằng ${face.label}`, id: `plan-${face.roofFaceId}`, style: 'width:100%;max-width:760px;height:auto;touch-action:none;background:#fff;border:1px solid #8886;border-radius:4px' });
  svg.append(s('polygon', { points: pts(face.outline), fill: '#f3e8d8', stroke: '#5b4636', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  for (const hole of face.holes) svg.append(s('polygon', { points: pts(hole), fill: '#cbd5e1', stroke: '#475569', 'stroke-dasharray': '5 3', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }, s('title', {}, 'Vùng loại trừ')));
  for (const o of p.obstacles ?? []) if (o.roofFaceId === face.roofFaceId) svg.append(s('polygon', { points: pts(footprintOnFace(o, face)), fill: '#a8a29e', stroke: '#44403c', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }, s('title', {}, o.label)));
  // one short line that fits the viewBox; the full convention is in the tooltip
  svg.append(s('text', { x: minA + 0.1, y: minB + 0.4, 'font-size': 0.3, fill: '#475569' }, s('title', {}, 'Hướng: Bắc = 0°, theo chiều kim đồng hồ. a: dọc mép mái; b: lên theo dốc; mép dưới là mép mái.'), `${face.label} · ${face.tiltDeg}° · hướng ${Math.round(face.azimuthDeg)}°`));

  const layer = s('g', {});
  svg.append(layer);
  const mine = model.panels.filter((x) => x.faceId === face.roofFaceId);
  const nodes = new Map<string, SVGGElement>();
  for (const pn of mine) {
    const pl = (p.placements ?? []).find((x) => x.instanceId === pn.instanceId)!, d = panelDims(p, pn.instanceId)!;
    const ring = panelRing(d, pl), sel = selection.has(pn.instanceId);
    const g = s('g', { 'data-id': pn.instanceId, tabindex: 0, role: 'button', 'aria-label': `${pn.label}${pn.stringIndex ? `, chuỗi ${pn.stringIndex} vị trí ${pn.seriesIndex}` : ', chưa vào chuỗi'}${pn.invalid ? ', vị trí không hợp lệ' : ''}${sel ? ', đang chọn' : ''}`, class: 'panel' + (sel ? ' selected' : ''), style: 'cursor:grab' });
    g.append(s('polygon', { points: pts(ring), fill: stringColor(pn.stringIndex), 'fill-opacity': 0.75, stroke: pn.invalid ? '#dc2626' : sel ? '#eab308' : '#0f172a', 'stroke-width': sel || pn.invalid ? 3 : 1.2, 'vector-effect': 'non-scaling-stroke' }));
    if (sel) g.append(s('polygon', { points: pts(panelRing(d, pl, face.setbackM)), fill: 'none', stroke: '#eab308', 'stroke-dasharray': '4 3', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, s('title', {}, `Khoảng cách tối thiểu ${face.setbackM} m`)));
    g.append(s('text', { x: pl.center[0], y: Y(pl.center[1]) + 0.12, 'font-size': 0.34, 'text-anchor': 'middle', fill: '#fff', 'font-weight': 700, 'pointer-events': 'none' }, pn.stringIndex ? `S${pn.stringIndex}·${pn.seriesIndex}` : '–'));
    if (pn.invalid) g.append(s('text', { x: pl.center[0] + d.widthM / 2 - 0.15, y: Y(pl.center[1]) - d.lengthM / 2 + 0.35, 'font-size': 0.4, fill: '#fecaca', 'font-weight': 700, 'pointer-events': 'none' }, '!'));
    g.append(s('title', {}, pn.label));
    layer.append(g);
    nodes.set(pn.instanceId, g);
  }

  // ---- interaction: select, drag (snap on release), keyboard nudge ---------------------------------------
  const toLocal = (e: PointerEvent): Pt => {
    const ctm = svg.getScreenCTM()!.inverse(), pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm);
    return [pt.x, maxB + minB - pt.y];
  };
  let drag: { start: Pt; ids: string[]; px: number; py: number; moved: boolean; id: string; additive: boolean } | null = null;
  svg.addEventListener('pointerdown', (e) => {
    const g = (e.target as Element).closest('g[data-id]') as SVGGElement | null;
    if (!g) { h.onClear(); return; }
    const id = g.dataset.id!;
    const ids = selection.has(id) ? [...selection].filter((x) => nodes.has(x)) : [id];
    drag = { start: toLocal(e), ids, px: e.clientX, py: e.clientY, moved: false, id, additive: e.shiftKey || e.ctrlKey || e.metaKey };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.px, e.clientY - drag.py) < 5) return;
    drag.moved = true;
    const now = toLocal(e), da = now[0] - drag.start[0], db = now[1] - drag.start[1];
    for (const id of drag.ids) nodes.get(id)?.setAttribute('transform', `translate(${da},${-db})`);
  });
  svg.addEventListener('pointerup', (e) => {
    const d = drag; drag = null;
    if (!d) return;
    if (!d.moved) { h.onSelect([d.id], d.additive ? 'toggle' : 'set'); return; }
    const now = toLocal(e);
    if (!selection.has(d.id)) h.onSelect([d.id], 'drag');
    h.onMove(d.ids, [now[0] - d.start[0], now[1] - d.start[1]], true);
  });
  svg.addEventListener('keydown', (e) => {
    const g = (e.target as Element).closest('g[data-id]') as SVGGElement | null;
    if (!g) return;
    const id = g.dataset.id!, ids = selection.has(id) ? [...selection] : [id];
    const step = e.shiftKey ? 0.01 : layoutOf(p).gridM;
    const arrows: Record<string, Pt> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (arrows[e.key]) { e.preventDefault(); h.onMove(ids, arrows[e.key], false); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); h.onRotate(ids); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); h.onRemove(ids); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); h.onSelect([id], e.shiftKey || e.ctrlKey ? 'toggle' : 'set'); }
    else if (e.key === 'Escape') h.onClear();
  });
  return svg;
}
