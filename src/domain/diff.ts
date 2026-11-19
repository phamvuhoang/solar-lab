export interface Change { path: string; before: unknown; after: unknown }

/** Structural diff of two JSON values. Arrays compare by index. */
export function diff(a: unknown, b: unknown, path = ''): Change[] {
  if (Object.is(a, b)) return [];
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return [{ path: path || '/', before: a, after: b }];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].sort().flatMap((k) => diff(a[k], b[k], `${path}/${k}`));
}
