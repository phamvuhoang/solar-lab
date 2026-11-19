// Fetch one year of hourly PVGIS data for a coordinate and write a Solar Lab weather CSV (offline use afterwards).
// Usage: node scripts/fetch-pvgis.mjs --lat 11.87 --lon 108.2 --year 2023 --name "Tên" --out data/weather/x.csv
// Only latitude, longitude and year are sent to the service.
import { writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const lat = Number(arg('lat')), lon = Number(arg('lon')), year = Number(arg('year'));
const name = arg('name', `PVGIS ${year}`), out = arg('out');
if (![lat, lon, year].every(Number.isFinite) || !out) { console.error('Cần --lat --lon --year --out'); process.exit(2); }

const API = 'https://re.jrc.ec.europa.eu/api/v5_3/seriescalc';
// slope 0 / components=1: Gb(i) is beam on the horizontal plane (BHI), Gd(i) is diffuse horizontal (DHI).
const url = `${API}?lat=${lat}&lon=${lon}&startyear=${year}&endyear=${year}&pvcalculation=0&components=1&angle=0&aspect=0&outputformat=json&browser=0`;
const res = await fetch(url, { headers: { 'User-Agent': 'solar-lab-weather-fetch/1' } });
if (!res.ok) { console.error('PVGIS lỗi HTTP', res.status, await res.text()); process.exit(1); }
const j = await res.json();
const hourly = j.outputs?.hourly ?? [];
if (!hourly.length) { console.error('PVGIS không trả dữ liệu cho tọa độ này (ngoài vùng phủ?)'); process.exit(1); }

const meta = j.inputs.meteo_data, loc = j.inputs.location;
const iso = (t) => `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:00Z`;
const r1 = (x) => Number(x.toFixed(2));
const rows = hourly.map((h) => {
  const bhi = h['Gb(i)'], dhi = h['Gd(i)'], ghi = bhi + dhi;
  const sinH = Math.sin((h.H_sun * Math.PI) / 180);
  // DNI = BHI / sin(sun elevation); below 3° the quotient is noise, so DNI is set to 0 there.
  const dni = h.H_sun > 3 ? Math.min(bhi / sinH, 1300) : 0;
  return [iso(h.time), r1(ghi), r1(dni), r1(dhi), '', h.T2m, h.WS10m].join(',');
});

const header = [
  '# mekoniq-solar-lab weather v1',
  `# name: ${name}`,
  `# latitude: ${lat}`, `# longitude: ${lon}`, `# elevation_m: ${loc.elevation}`,
  `# source: PVGIS (${meta.radiation_db}, meteo ${meta.meteo_db}) EU JRC`,
  '# source_version: PVGIS API v5_3',
  `# source_url: ${API}`,
  `# retrieved: ${new Date().toISOString().slice(0, 10)}`,
  '# method: historical',
  `# period: ${year}`,
  '# timestamp_convention: mid',
  '# step_seconds: 3600',
  '# license: PVGIS © European Communities 2001-2026, reuse authorised with acknowledgement; per-dataset redistribution terms NOT yet confirmed. Underlying reanalysis: ERA5 (Copernicus).',
  '# note: GHI = Gb(i)+Gd(i) on a horizontal plane; DNI = BHI / sin(H_sun) when H_sun > 3 deg else 0; wind is 10 m.',
  'timestamp_utc,ghi_wm2,dni_wm2,dhi_wm2,poa_wm2,temp_air_c,wind_ms',
];
writeFileSync(out, header.join('\n') + '\n' + rows.join('\n') + '\n');
console.log(`${out}: ${rows.length} dòng, db=${meta.radiation_db}, cao độ ${loc.elevation} m`);
