import { indexProject, portKey, stringsOf, unassignedPanels, type PortDef } from '../domain/graph';
import type { Project } from '../domain/types';
import { badgeOf, type Finding } from '../validation/strings';

// Screen coordinates are computed here from connectivity; nothing in the project stores x/y.
const NS = 'http://www.w3.org/2000/svg';
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: (Node | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) el.append(c);
  return el;
}

const COL = { strings: 20, mid: 340, right: 640 };
interface Box { x: number; y: number; w: number; h: number }

export function renderDiagram(p: Project, findings: readonly Finding[], selected: string | null, onSelect: (id: string) => void): SVGSVGElement {
  const ix = indexProject(p);
  const boxes = new Map<string, Box>();
  const ports = new Map<string, { x: number; y: number; def: PortDef; side: 'l' | 'r' }>();
  const nodes: SVGElement[] = [];
  const wires: SVGElement[] = [];

  const tags = (id: string) => {
    const b = badgeOf(findings, id);
    const hasAny = findings.some((f) => f.objectIds.some((o) => o === id || o.startsWith(id + ':')));
    return { b, text: [b.exceedsLimit && 'vượt giới hạn thiết kế', b.powerLimited && 'bị giới hạn công suất', hasAny && (b.dataComplete ? 'đủ dữ liệu' : 'chưa đủ dữ liệu')].filter(Boolean) as string[] };
  };
  const trunc = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  /** Height: header 48 + port rows + one line per status tag. */
  const heightFor = (id: string, rows: number) => 48 + rows * 26 + tags(id).text.length * 13 + 10;
  const frame = (id: string, box: Box, title: string, sub: string, rows = 0) => {
    const { b, text } = tags(id);
    const g = s('g', { 'data-id': id, tabindex: 0, role: 'button', 'aria-label': `${title}. ${sub}. ${text.join(', ')}`, class: 'node' + (selected === id ? ' selected' : '') });
    g.append(s('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 6, fill: 'var(--node-bg, #fff)', stroke: b.exceedsLimit ? '#c0392b' : b.powerLimited ? '#d68910' : '#555',
      'stroke-width': selected === id ? 3 : 1.5, 'stroke-dasharray': b.powerLimited && !b.exceedsLimit ? '6 3' : '' }));
    g.append(s('title', {}, `${title} · ${sub}`));
    g.append(s('text', { x: box.x + 8, y: box.y + 18, 'font-size': 13, 'font-weight': 600, fill: 'currentColor' }, trunc(title, 26)));
    g.append(s('text', { x: box.x + 8, y: box.y + 34, 'font-size': 11, fill: 'currentColor' }, trunc(sub, 32)));
    text.forEach((t, i) => g.append(s('text', { x: box.x + 8, y: box.y + 48 + rows * 26 + i * 13, 'font-size': 10, fill: b.exceedsLimit && i === 0 ? '#c0392b' : 'currentColor' }, t)));
    g.addEventListener('click', () => onSelect(id));
    g.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); onSelect(id); } });
    nodes.push(g);
  };

  // strings column
  const strs = stringsOf(p);
  let yStr = 20;
  strs.forEach((st, i) => {
    const box = { x: COL.strings, y: yStr, w: 250, h: heightFor(st.stringId, 0) };
    yStr += box.h + 16;
    boxes.set(st.stringId, box);
    frame(st.stringId, box, st.label, `${st.panelIds.length} tấm nối tiếp`);
  });
  const free = unassignedPanels(p);
  if (free.length) {
    const box = { x: COL.strings, y: yStr, w: 250, h: heightFor('unassigned', 0) };
    yStr += box.h + 16;
    frame('unassigned', box, `${free.length} tấm chưa gán`, 'cần tạo chuỗi');
  }

  // devices: inverter & controller in the middle, battery & loads on the right
  let yMid = 20, yRight = 20;
  const devices = [...ix.inst.values()].filter((d) => d.inst.kind !== 'panel');
  for (const d of [...devices.filter((x) => x.inst.kind === 'inverter'), ...devices.filter((x) => x.inst.kind === 'controller'), ...devices.filter((x) => x.inst.kind === 'battery'), ...devices.filter((x) => x.inst.kind === 'load')]) {
    const left = d.ports.filter((x) => x.type === 'mppt-in' || x.type === 'ctrl-pv-in' || x.type === 'ac-in' || x.type === 'pump-dc-in' || (x.type === 'battery-dc' && d.inst.kind === 'battery'));
    const right = d.ports.filter((x) => !left.includes(x));
    const rows = Math.max(left.length, right.length, 1);
    const mid = d.inst.kind === 'inverter' || d.inst.kind === 'controller';
    const box = { x: mid ? COL.mid : COL.right, y: mid ? yMid : yRight, w: mid ? 220 : 240, h: heightFor(d.inst.instanceId, rows) };
    boxes.set(d.inst.instanceId, box);
    if (mid) yMid += box.h + 24; else yRight += box.h + 24;
    frame(d.inst.instanceId, box, d.inst.label.replace(/ #\d+$/, ''), d.comp?.sku ?? d.inst.kind, rows);
    const place = (list: PortDef[], side: 'l' | 'r') => list.forEach((def, i) => {
      const pos = { x: side === 'l' ? box.x : box.x + box.w, y: box.y + 48 + i * 26, def, side };
      ports.set(portKey({ instanceId: d.inst.instanceId, port: def.id }), pos);
    });
    place(left, 'l'); place(right, 'r');
  }

  // wires: strings → their target port, then explicit edges
  const wire = (a: { x: number; y: number }, b: { x: number; y: number }, bad: boolean, lim: boolean, dash = false) => {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    wires.push(s('path', { d: `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`, fill: 'none', stroke: bad ? '#c0392b' : lim ? '#d68910' : '#2874a6', 'stroke-width': 2, 'stroke-dasharray': dash || lim ? '6 3' : '' }));
  };
  for (const st of strs) {
    const from = boxes.get(st.stringId)!, to = st.target && ports.get(portKey(st.target));
    if (!to) continue;
    const b = badgeOf(findings, st.stringId);
    wire({ x: from.x + from.w, y: from.y + from.h / 2 }, to, b.exceedsLimit, b.powerLimited);
  }
  for (const e of p.edges) {
    const a = ports.get(portKey(e.from)), b = ports.get(portKey(e.to));
    if (!a || !b) continue;
    const bad = findings.some((f) => f.severity === 'error' && f.objectIds[0] === e.edgeId);
    // draw left-to-right regardless of declared direction so crossed wires stay readable
    wire(a.x <= b.x ? a : b, a.x <= b.x ? b : a, bad, false);
  }
  for (const [key, pt] of ports) {
    const g = s('g', { 'data-id': key, tabindex: 0, role: 'button', 'aria-label': `Cổng ${pt.def.label}`, class: 'port' + (selected === key ? ' selected' : '') });
    const { b } = tags(key);
    g.append(s('circle', { cx: pt.x, cy: pt.y, r: 6, fill: b.exceedsLimit ? '#c0392b' : b.powerLimited ? '#d68910' : '#fff', stroke: '#333', 'stroke-width': selected === key ? 3 : 1.5 }));
    g.append(s('text', { x: pt.side === 'l' ? pt.x + 10 : pt.x - 10, y: pt.y + 4, 'font-size': 11, 'text-anchor': pt.side === 'l' ? 'start' : 'end', fill: 'currentColor' }, pt.def.label));
    g.addEventListener('click', (e) => { e.stopPropagation(); onSelect(key); });
    g.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); onSelect(key); } });
    nodes.push(g);
  }

  const height = Math.max(160, yMid, yRight, yStr) + 10;
  return s('svg', { viewBox: `0 0 ${COL.right + 260} ${height}`, role: 'group', 'aria-label': 'Sơ đồ điện', class: 'diagram', style: 'width:100%;max-width:900px;height:auto' }, ...wires, ...nodes);
}
