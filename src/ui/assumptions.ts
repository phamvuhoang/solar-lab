import type { Project } from '../domain/types';
import { formatHours, simPolicyOf } from '../engine/sim-compile';
import { shadeSettingsOf } from '../shade/sampler';
import { designOf } from '../validation/strings';
import { BUNDLED_WEATHER } from '../weather/bundled';
import { farText, farWeather } from '../weather/nearest';

const num = (x: number) => x.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const pct = (x: number) => `${(x * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} %`;
const temp = (x: number | null) => (x === null ? 'chưa đặt' : `${num(x)} °C`);

/**
 * The assumptions the checks and the run use now, as sentences: what Cơ bản reads instead of the settings forms (read-only).
 * Only what the project holds or its defaults; a value not set says so, nothing is filled in.
 */
export function assumptionsOf(p: Project): string[] {
  const d = designOf(p), sp = simPolicyOf(p), sh = shadeSettingsOf(p), wx = p.pv?.weatherId, far = farWeather(p);
  const outage = sp.outageLocalHours.length ? `, mất lưới ${formatHours(Array.from({ length: 24 }, (_, h) => (sp.outageLocalHours.includes(h) ? 1 : 0)))} h mỗi ngày` : '';
  return [
    `Tcell lạnh ${temp(d.coldCellTempC)}, nóng ${temp(d.hotCellTempC)} · nguồn: ${d.source || 'chưa ghi'}`,
    `Hệ số Isc ${num(d.iscFactor)}`,
    `βVmp giả định: ${d.betaVmpAssumption === null ? 'chưa đặt (chỉ dùng khi tấm không có βVmp)' : `${num(d.betaVmpAssumption * 100)} %/°C`}`,
    ...p.roofFaces.map((f) => `Khoảng lùi mép ${f.label}: ${num(f.setbackM)} m (${f.setbackSource === 'assumption' ? 'giả định' : 'người dùng khai'})`),
    `Dự phòng SoC ${pct(sp.minSoc)}`,
    `SoC đầu ${pct(sp.soc0)}`,
    `Hiệu suất sạc ${pct(sp.etaCharge)}, xả ${pct(sp.etaDischarge)}, inverter ${sp.inverterEfficiency === null ? 'theo datasheet' : pct(sp.inverterEfficiency)} · tự tiêu thụ ${num(sp.standbyW)} W`,
    `Lưới: ${sp.gridAvailable ? `${sp.importAllowed ? 'được nhập' : 'không nhập'}, ${sp.exportAllowed ? 'được bán' : 'không bán'}${outage}` : 'không có'}`,
    !sh.enabled ? 'Bóng che: không bật (coi như không bị che)' : `Mức bóng che: ${sh.mode === 'preview' ? 'xem trước (1 điểm giữa mỗi tấm)' : 'chuẩn'}`,
    `Bộ thời tiết: ${!wx ? 'chưa chọn' : (BUNDLED_WEATHER.find((b) => b.id === wx)?.label ?? `dữ liệu đã nhập (${wx})`)}`,
    ...(far ? [farText(far)] : []),
  ];
}
