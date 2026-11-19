const NS = 'http://www.w3.org/2000/svg';
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: (Node | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) el.append(c);
  return el;
}
const niceMax = (v: number) => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
const W = 640, H = 270, M = { l: 56, r: 12, t: 26, b: 40 };

export interface Line { name: string; values: number[]; dash: string; color: string }

/** Power-vs-hour line chart. Lines differ by dash pattern as well as colour. Y is always labelled with its unit. */
export function lineChart(xs: number[], lines: Line[], opts: { yLabel: string; xLabel: string; label: string }): SVGSVGElement {
  const ymax = niceMax(Math.max(0, ...lines.flatMap((l) => l.values)));
  const x = (v: number) => M.l + ((v - xs[0]) / Math.max(1e-9, xs[xs.length - 1] - xs[0])) * (W - M.l - M.r);
  const y = (v: number) => H - M.b - (v / ymax) * (H - M.t - M.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H + 24 + lines.length * 0}`, role: 'img', 'aria-label': opts.label, style: 'width:100%;max-width:720px;height:auto' });
  for (let i = 0; i <= 4; i++) {
    const v = (ymax * i) / 4;
    svg.append(s('line', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), stroke: '#8884', 'stroke-width': 1 }), s('text', { x: M.l - 6, y: y(v) + 4, 'font-size': 11, 'text-anchor': 'end', fill: 'currentColor' }, String(Math.round(v))));
  }
  for (let h = Math.ceil(xs[0]); h <= xs[xs.length - 1]; h += 3) svg.append(s('text', { x: x(h), y: H - M.b + 16, 'font-size': 11, 'text-anchor': 'middle', fill: 'currentColor' }, String(h)));
  svg.append(s('text', { x: 4, y: 12, 'font-size': 11, fill: 'currentColor' }, opts.yLabel), s('text', { x: (W + M.l) / 2, y: H - 6, 'font-size': 11, 'text-anchor': 'middle', fill: 'currentColor' }, opts.xLabel));
  lines.forEach((l, i) => {
    svg.append(s('polyline', { points: l.values.map((v, k) => `${x(xs[k]).toFixed(1)},${y(v).toFixed(1)}`).join(' '), fill: 'none', stroke: l.color, 'stroke-width': 2, 'stroke-dasharray': l.dash }));
    svg.append(s('line', { x1: M.l + i * 150, x2: M.l + i * 150 + 22, y1: H + 8, y2: H + 8, stroke: l.color, 'stroke-width': 2, 'stroke-dasharray': l.dash }), s('text', { x: M.l + i * 150 + 26, y: H + 12, 'font-size': 11, fill: 'currentColor' }, l.name));
  });
  return svg;
}

/** Bars with the value printed on each bar (readable without colour or hover). */
export function barChart(labels: string[], values: number[], opts: { yLabel: string; label: string }): SVGSVGElement {
  const ymax = niceMax(Math.max(0, ...values));
  const bw = (W - M.l - M.r) / values.length;
  const y = (v: number) => H - M.b - (v / ymax) * (H - M.t - M.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label, style: 'width:100%;max-width:720px;height:auto' });
  svg.append(s('text', { x: 4, y: 12, 'font-size': 11, fill: 'currentColor' }, opts.yLabel));
  values.forEach((v, i) => {
    svg.append(s('rect', { x: M.l + i * bw + 4, y: y(v), width: bw - 8, height: H - M.b - y(v), fill: '#2874a6' }),
      s('text', { x: M.l + i * bw + bw / 2, y: y(v) - 3, 'font-size': 10, 'text-anchor': 'middle', fill: 'currentColor' }, String(Math.round(v))),
      s('text', { x: M.l + i * bw + bw / 2, y: H - M.b + 14, 'font-size': 11, 'text-anchor': 'middle', fill: 'currentColor' }, labels[i]));
  });
  return svg;
}
