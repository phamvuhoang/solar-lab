import { indexProject, portKey, stringsOf, type Indexed } from '../domain/graph';
import type { Component, LoadPlan, Project, SimPolicy } from '../domain/types';
import type { Issue } from '../domain/validate';
import type { WeatherSeries } from '../weather/series';
import { compilePv } from './compile';
import type { Bank, DispatchLoad } from './dispatch';
import { simHash, type DispatchSpec, type SimInput } from './system';

export const SIM_DEFAULTS: SimPolicy = {
  minSoc: 0.2, soc0: 0.5, etaCharge: 0.95, etaDischarge: 0.95, inverterEfficiency: null, standbyW: 0,
  gridAvailable: false, importAllowed: false, exportAllowed: false, outageLocalHours: [],
};
export const simPolicyOf = (p: Project): SimPolicy => ({ ...SIM_DEFAULTS, ...p.sim });
const err = (code: string, field: string, message: string): Issue => ({ code, severity: 'error', field, message });
const v = (c: Component | undefined, k: string) => c?.specs[k]?.v ?? null;

/**
 * Fractions per local hour from text like "11", "6-8,18-22", "18-20@0,5" (comma or dot decimal). Tokens are read one at a time,
 * so a comma can be both a list separator and a decimal point. Returns an error message instead of guessing.
 */
export function parseHours(text: string): { ok: true; fractions: number[] } | { ok: false; message: string } {
  const f = new Array<number>(24).fill(0);
  const t = text.trim();
  const token = /(\d{1,2})(?:\s*-\s*(\d{1,2}))?(?:\s*@\s*(\d+(?:[.,]\d+)?))?/y;
  let pos = 0;
  while (pos < t.length) {
    const sep = /^[,;\s]*/.exec(t.slice(pos))![0].length;
    pos += sep;
    if (pos >= t.length) break;
    token.lastIndex = pos;
    const m = token.exec(t);
    if (!m) return { ok: false, message: `"${t.slice(pos)}" không đọc được; dùng dạng 11 hoặc 6-8,18-22 hoặc 18-20@0,5` };
    pos = token.lastIndex;
    const a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2]), share = m[3] === undefined ? 1 : Number(m[3].replace(',', '.'));
    if (a > 23 || b > 23 || b < a) return { ok: false, message: `Giờ "${m[0]}" phải trong 0–23 và tăng dần` };
    if (!(share > 0 && share <= 1)) return { ok: false, message: `Tỉ lệ "${m[3]}" phải trong (0, 1]` };
    for (let h = a; h <= b; h++) f[h] = share;
  }
  return { ok: true, fractions: f };
}
export function formatHours(f: readonly number[]): string {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    if (!f[h]) continue;
    let e = h;
    while (e + 1 < 24 && f[e + 1] === f[h]) e++;
    out.push(`${h === e ? h : `${h}-${e}`}${f[h] === 1 ? '' : `@${String(f[h]).replace('.', ',')}`}`);
    h = e;
  }
  return out.join(',');
}

function bankOf(ix: Indexed, invId: string, policy: SimPolicy, issues: Issue[], notes: string[]): { bank: Bank | null; nominalV: number | null } {
  const edges = ix.edgesAt({ instanceId: invId, port: 'BAT' });
  const batteries = edges.map((e) => (e.from.instanceId === invId ? e.to : e.from)).map((r) => ix.inst.get(r.instanceId)).filter((x) => x?.inst.kind === 'battery');
  if (batteries.length > 1) { issues.push(err('BATTERY_COUNT', '/edges', 'Nhiều hơn một bank pin nối vào inverter; ghép song song cần mô hình riêng')); return { bank: null, nominalV: null }; }
  if (!batteries.length) { notes.push('Không có pin nối vào inverter'); return { bank: null, nominalV: null }; }
  const c = batteries[0]!.comp, label = batteries[0]!.inst.label;
  const nominalV = v(c, 'nominalV'), ah = v(c, 'capacityAh');
  const nominalWh = v(c, 'nominalWh') ?? (nominalV !== null && ah !== null ? nominalV * ah : null);
  if (nominalV === null || nominalWh === null) { issues.push(err('BATTERY_SPEC_MISSING', `/instances/${batteries[0]!.inst.instanceId}`, `${label}: thiếu điện áp danh định hoặc dung lượng (V, Ah hoặc Wh)`)); return { bank: null, nominalV: null }; }
  const soh = v(c, 'sohRatio');
  if (soh === null) notes.push(`${label}: SoH chưa đo, coi là 100 % (giả định)`);
  const usable = v(c, 'usableWh');
  const hwMin = v(c, 'socMinRatio') ?? (usable !== null ? Math.max(0, 1 - usable / nominalWh) : 0);
  const chA = v(c, 'maxChargeA'), disA = v(c, 'maxDischargeA');
  return { nominalV, bank: { nominalWh, sohRatio: soh ?? 1, socMin: Math.max(policy.minSoc, hwMin), socMax: v(c, 'socMaxRatio') ?? 1, nominalV, maxChargeW: chA === null ? null : chA * nominalV, maxDischargeW: disA === null ? null : disA * nominalV } };
}

/** Project + weather → PV input and dispatch spec. Anything missing is refused with its field. */
export async function compileSim(p: Project, weather: WeatherSeries): Promise<{ input: SimInput | null; hash: string | null; issues: Issue[]; notes: string[] }> {
  const pvc = compilePv(p, weather);
  const issues: Issue[] = [...pvc.issues], notes: string[] = [];
  const policy = simPolicyOf(p);
  if (!(policy.minSoc >= 0 && policy.minSoc < 1)) issues.push(err('POLICY_RANGE', '/sim/minSoc', 'Dự phòng SoC phải trong [0, 1)'));
  if (!(policy.soc0 >= 0 && policy.soc0 <= 1)) issues.push(err('POLICY_RANGE', '/sim/soc0', 'SoC đầu phải trong [0, 1]'));
  if (!pvc.input) return { input: null, hash: null, issues, notes };
  const ix = indexProject(p);
  const invIds = pvc.input.inverters.map((x) => x.id);
  if (invIds.length !== 1) { issues.push(err('INVERTER_COUNT', '/instances', invIds.length ? 'Ghép nhiều inverter cần mô hình riêng; v1 chỉ một inverter' : 'Chưa có chuỗi PV nối vào inverter')); return { input: null, hash: null, issues, notes }; }
  const inv = ix.inst.get(invIds[0])!;
  const acRated = v(inv.comp, 'acRatedW'), eff = policy.inverterEfficiency ?? v(inv.comp, 'efficiencyMax');
  if (acRated === null) issues.push(err('INVERTER_SPEC_MISSING', `/instances/${invIds[0]}`, `${inv.inst.label}: thiếu công suất AC liên tục (acRatedW)`));
  if (eff === null) issues.push(err('INVERTER_EFFICIENCY_MISSING', '/sim/inverterEfficiency', `${inv.inst.label}: thiếu hiệu suất (efficiencyMax); nhập hiệu suất inverter trong chính sách`));
  if (policy.inverterEfficiency === null && eff !== null) notes.push(`Hiệu suất inverter ${(eff * 100).toFixed(1)} % lấy từ datasheet (giá trị đỉnh, không đổi theo tải)`);
  const { bank, nominalV } = bankOf(ix, invIds[0], policy, issues, notes);
  const chA = v(inv.comp, 'batteryMaxChargeA'), disA = v(inv.comp, 'batteryMaxDischargeA');

  // loads: AC loads on the inverter AC port, DC pump loads on a controller OUT port
  const plans = new Map((p.loadPlans ?? []).map((l) => [l.instanceId, l]));
  const loads: DispatchLoad[] = [];
  let branchTrackerId: string | null = null;
  const addLoad = (id: string, feed: 'inverter' | 'controller') => {
    const L = ix.inst.get(id);
    if (!L) return;
    const plan: LoadPlan | undefined = plans.get(id), powerW = v(L.comp, 'powerW');
    if (!plan) { issues.push(err('LOAD_PLAN_MISSING', `/loadPlans/${id}`, `${L.inst.label}: chưa đặt lịch chạy (giờ và ưu tiên)`)); return; }
    if (powerW === null) { issues.push(err('LOAD_SPEC_MISSING', `/instances/${id}`, `${L.inst.label}: thiếu công suất (powerW)`)); return; }
    loads.push({ id, label: L.inst.label.replace(/ #\d+$/, ''), powerW, startupW: v(L.comp, 'startupW'), priority: plan.priority, fractions: plan.fractions, feed, pump: plan.pump ?? null });
  };
  for (const e of ix.edgesAt({ instanceId: invIds[0], port: 'AC' })) addLoad((e.from.instanceId === invIds[0] ? e.to : e.from).instanceId, 'inverter');
  for (const [id, d] of ix.inst) if (d.inst.kind === 'controller') {
    const key = portKey({ instanceId: id, port: 'PV' });
    const fed = stringsOf(p).some((s) => s.target && portKey(s.target) === key && s.panelIds.length);
    const outs = ix.edgesAt({ instanceId: id, port: 'OUT' }).map((e) => (e.from.instanceId === id ? e.to : e.from).instanceId);
    if (fed) branchTrackerId = key;
    for (const lid of outs) { if (!fed) issues.push(err('BRANCH_WITHOUT_PV', `/instances/${lid}`, `${ix.inst.get(lid)?.inst.label}: nhánh bơm DC chưa có chuỗi PV`)); else addLoad(lid, 'controller'); }
  }
  if (issues.length) return { input: null, hash: null, issues, notes };
  const spec: DispatchSpec = {
    timeZone: p.location?.timezone ?? 'Asia/Ho_Chi_Minh', inverterId: invIds[0], bank, policy, loads, branchTrackerId, notes,
    inverter: { acRatedW: acRated!, surgeW: v(inv.comp, 'surgeW'), efficiency: eff!, maxChargeW: chA === null || nominalV === null ? null : chA * nominalV, maxDischargeW: disA === null || nominalV === null ? null : disA * nominalV },
  };
  const input: SimInput = { pv: pvc.input, spec };
  input.pv.weatherHash = '';
  return { input, hash: await simHash(input), issues, notes };
}
