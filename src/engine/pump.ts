/** Pump curve H_pump(Q) meets the system curve H_sys(Q) = static + k·Q². Q in m³/h, head in m. */
export interface PumpCurve { qM3h: number[]; headM: number[] }

const interp = (xs: number[], ys: number[], x: number): number => {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
};

export type OperatingPoint =
  | { ok: true; qM3h: number; headM: number }
  | { ok: false; reason: 'NO_CURVE' | 'NO_STATIC_HEAD' | 'CANNOT_LIFT'; message: string };

/** Q at the working point by bisection; no curve or no head → not computed, with the reason (never guessed). */
export function operatingPoint(curve: PumpCurve | null, staticHeadM: number | null, frictionK: number | null): OperatingPoint {
  if (!curve) return { ok: false, reason: 'NO_CURVE', message: 'Thiếu đường cong Q–H của bơm' };
  if (staticHeadM === null) return { ok: false, reason: 'NO_STATIC_HEAD', message: 'Thiếu cột áp tĩnh' };
  const k = frictionK ?? 0, qMax = curve.qM3h[curve.qM3h.length - 1];
  const f = (q: number) => interp(curve.qM3h, curve.headM, q) - (staticHeadM + k * q * q);
  if (f(curve.qM3h[0]) <= 0) return { ok: false, reason: 'CANNOT_LIFT', message: `Bơm không thắng cột áp ${staticHeadM} m ở lưu lượng thấp nhất của đường cong` };
  if (f(qMax) > 0) return { ok: true, qM3h: qMax, headM: staticHeadM + k * qMax * qMax }; // curve ends before it meets the system curve
  let lo = curve.qM3h[0], hi = qMax;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
  const q = (lo + hi) / 2;
  return { ok: true, qM3h: q, headM: staticHeadM + k * q * q };
}
