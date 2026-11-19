// Sun position, low-precision Astronomical Almanac / Meeus form (about 0.01° for 1950–2050), plus SPA-style refraction.
// Azimuth: degrees clockwise from North. Elevation/zenith in degrees. Time: UTC epoch seconds.
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const norm360 = (x: number) => ((x % 360) + 360) % 360;

export interface SunPosition { zenithDeg: number; apparentZenithDeg: number; elevationDeg: number; apparentElevationDeg: number; azimuthDeg: number }

/** Standard-atmosphere pressure (Pa) at an altitude in metres, same formula as pvlib.atmosphere.alt2pres. */
export const pressureAt = (altitudeM: number) => 101325 * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);

export function sunPosition(epochSeconds: number, latDeg: number, lonDeg: number, opts: { pressurePa?: number; refractionTempC?: number } = {}): SunPosition {
  const jd = epochSeconds / 86400 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = norm360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = norm360(357.52911 + T * (35999.05029 - 0.0001537 * T));
  const C = (1.914602 - T * (0.004817 + 0.000014 * T)) * Math.sin(M * D2R) + (0.019993 - 0.000101 * T) * Math.sin(2 * M * D2R) + 0.000289 * Math.sin(3 * M * D2R);
  const omega = 125.04 - 1934.136 * T;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega * D2R)) * D2R;
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - 0.001813 * T))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega * D2R)) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = norm360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T);
  const H = norm360(gmst + lonDeg - ra * R2D) * D2R;
  const phi = latDeg * D2R;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl))) * R2D;
  const az = norm360(Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) * R2D + 180);

  // Atmospheric refraction as in NREL SPA (applied when the sun is above −(0.26667 + 0.5667)°).
  const P = (opts.pressurePa ?? 101325) / 100, Tc = opts.refractionTempC ?? 12;
  const refr = el >= -(0.26667 + 0.5667) ? ((P / 1010) * (283 / (273 + Tc)) * 1.02) / (60 * Math.tan((el + 10.3 / (el + 5.11)) * D2R)) : 0;
  return { zenithDeg: 90 - el, apparentZenithDeg: 90 - (el + refr), elevationDeg: el, apparentElevationDeg: el + refr, azimuthDeg: az };
}
