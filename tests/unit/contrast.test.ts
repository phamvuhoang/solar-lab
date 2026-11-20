import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 2.x contrast of the colour tokens in src/ui/styles.css, light and dark. A failing token is fixed in the stylesheet, not here.
const css = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8');
const tokens = (body: string) => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1]!, m[2]!]));
const light = tokens(css.match(/:root\s*{([^}]*)}/)![1]!);
const dark = { ...light, ...tokens(css.match(/prefers-color-scheme:\s*dark\)\s*{\s*:root\s*{([^}]*)}/)![1]!) };

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

/** Rules that set both a background and a text colour from tokens: [background, text], e.g. the current step (accent, bg). */
const pairs = [...css.matchAll(/{([^{}]*)}/g)].flatMap(([, body]) => {
  const bg = body!.match(/background:\s*var\(--([\w-]+)\)/)?.[1], fg = body!.match(/(?:^|[;\s])color:\s*var\(--([\w-]+)\)/)?.[1];
  return bg && fg ? [[bg, fg] as const] : [];
});

describe.each([['sáng', light], ['tối', dark]] as const)('tương phản token, nền %s', (_, t) => {
  const ratio = (fg: string, bg: string) => +contrast(t[fg]!, t[bg]!).toFixed(2);
  it.each(['fg', 'muted'])('chữ --%s trên nền ≥ 4,5', (k) => {
    expect(ratio(k, 'bg')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(k, 'node-bg')).toBeGreaterThanOrEqual(4.5); // the diagram's boxes
  });
  it.each(['err', 'lim', 'unk', 'ok', 'accent'])('màu trạng thái --%s trên nền ≥ 3', (k) => { // accent: focus ring, pressed underline
    expect(ratio(k, 'bg')).toBeGreaterThanOrEqual(3);
    expect(ratio(k, 'node-bg')).toBeGreaterThanOrEqual(3);
  });
  it('chữ trên nền trạng thái ≥ 4,5', () => {
    expect(pairs).toContainEqual(['accent', 'bg']); // the current step: never vacuous
    for (const [bg, fg] of pairs) expect(ratio(fg, bg), `--${fg} trên --${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});

it('đọc đủ token cả hai nền', () => {
  for (const k of ['bg', 'fg', 'muted', 'accent', 'ok', 'err', 'lim', 'unk', 'node-bg']) { expect(light[k], k).toMatch(/^#/); expect(dark[k], k).toMatch(/^#/); }
  expect(dark.bg).not.toBe(light.bg);
  expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
});
