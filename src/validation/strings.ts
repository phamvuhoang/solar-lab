import { edgeVerdict, indexProject, isStringTarget, portKey, stringsOf, unassignedPanels, PORT_TYPE_LABEL, type Indexed, type PortRef } from '../domain/graph';
import type { Provenance } from '../domain/specs';
import { refKey, type Component, type DesignSettings, type Project, type StringDef } from '../domain/types';

export type Status = 'pass' | 'fail' | 'limited' | 'unknown';
export type Severity = 'error' | 'warning' | 'info';
export interface Source { where: string; field: string; value: number | null; unit: string; provenance: Provenance | 'design' }
export interface Finding {
  code: string; status: Status; severity: Severity;
  /** First id is the one the UI focuses: a string id, an instance id, or "instanceId:port". */
  objectIds: string[]; port?: PortRef; stringId?: string;
  formula: string; value: number | null; limit: number | null; unit: string;
  sources: Source[]; /** true when some input is a design assumption */ assumed: boolean; missing: string[];
  message: string; consequence: string; fix: string;
}
export interface Badge { dataComplete: boolean; powerLimited: boolean; exceedsLimit: boolean }

/**
 * The one status a check shows on every screen (health bar, summary, list, inspector, wiring page). A structural warning
 * (status fail, severity below error: panels outside every string, a battery not wired) has not been checked yet: it reads
 * "chưa đủ dữ liệu", never "có lỗi".
 */
export const displayStatus = (f: Finding): Status => (f.status === 'fail' && f.severity !== 'error' ? 'unknown' : f.status);
/** The one set of words for a status (docs/05-experience-v2.md: đạt · có lỗi · bị giới hạn · chưa đủ dữ liệu). */
export const STATUS_LABEL: Record<Status, string> = { pass: 'đạt', fail: 'có lỗi', limited: 'bị giới hạn', unknown: 'chưa đủ dữ liệu' };

export const DEFAULT_DESIGN: DesignSettings = { coldCellTempC: null, hotCellTempC: null, iscFactor: 1, betaVmpAssumption: null, source: '' };
export const designOf = (p: Project): DesignSettings => ({ ...DEFAULT_DESIGN, ...p.design });

const r6 = (x: number) => Number(x.toPrecision(12)); // 50 × 1.075 × 8 must read 430, not 430.00000000000006
const fmt = (x: number) => r6(x).toLocaleString('vi-VN', { maximumFractionDigits: 3 });

const spec = (c: Component | undefined, key: string): Source => ({
  where: c?.name ?? 'thiết bị chưa rõ', field: key, value: c?.specs[key]?.v ?? null, unit: c?.specs[key]?.u ?? '', provenance: c?.specs[key]?.p ?? 'assumption',
});
const design = (d: DesignSettings, key: 'coldCellTempC' | 'hotCellTempC' | 'iscFactor' | 'betaVmpAssumption', unit: string): Source =>
  ({ where: 'Thiết lập thiết kế', field: key, value: d[key], unit, provenance: 'design' });

interface CheckArgs {
  code: string; objectIds: string[]; port?: PortRef; stringId?: string; formula: string; unit: string; label: string;
  value: number | null; limit: number | null; op: '<=' | '>='; sources: Source[];
  fail: { status: 'fail' | 'limited'; severity: Severity }; consequence: string; fix: string;
}
function check(a: CheckArgs): Finding {
  const missing = a.sources.filter((s) => s.value === null).map((s) => `${s.where}: ${s.field}`);
  const base = { code: a.code, objectIds: a.objectIds, port: a.port, stringId: a.stringId, formula: a.formula, unit: a.unit, sources: a.sources, missing,
    assumed: a.sources.some((s) => s.provenance === 'assumption' || (s.provenance === 'design' && s.field === 'betaVmpAssumption')), consequence: a.consequence, fix: a.fix };
  if (a.value === null || a.limit === null || missing.length)
    return { ...base, status: 'unknown', severity: 'info', value: a.value, limit: a.limit, message: `${a.label}: chưa đủ dữ liệu (thiếu ${missing.join('; ') || 'giá trị'})` };
  const value = r6(a.value), limit = r6(a.limit);
  const ok = a.op === '<=' ? value <= limit : value >= limit;
  return { ...base, status: ok ? 'pass' : a.fail.status, severity: ok ? 'info' : a.fail.severity, value, limit,
    message: `${a.label}: ${fmt(value)} ${a.unit} ${ok ? a.op : a.op === '<=' ? '>' : '<'} ${fmt(limit)} ${a.unit}` };
}
const structural = (code: string, severity: Severity, objectIds: string[], message: string, fix: string, consequence: string, extra: Partial<Finding> = {}): Finding =>
  ({ code, status: 'fail', severity, objectIds, formula: '', value: null, limit: null, unit: '', sources: [], assumed: false, missing: [], message, consequence, fix, ...extra });

// ---- string electrics ---------------------------------------------------------------------------------------
interface StringPanels { panels: (Component | undefined)[]; models: Component[] }
function panelsOf(ix: Indexed, s: StringDef): StringPanels {
  const panels = s.panelIds.map((id) => ix.inst.get(id)?.comp);
  const seen = new Map<string, Component>();
  for (const c of panels) if (c) seen.set(refKey(c), c);
  return { panels, models: [...seen.values()] };
}
const sourcesFor = (sp: StringPanels, keys: string[]): Source[] =>
  sp.models.length ? sp.models.flatMap((c) => keys.map((k) => spec(c, k))) : keys.map((k) => spec(undefined, k));

/** Σ over panels of val × [1 + β × (T − 25)]; null if any input is missing. */
function sumAt(sp: StringPanels, T: number | null, valKey: string, betaKey: string, betaFallback: number | null): number | null {
  if (T === null || sp.panels.some((c) => !c)) return null;
  let total = 0;
  for (const c of sp.panels as Component[]) {
    const v = c.specs[valKey]?.v ?? null, b = c.specs[betaKey]?.v ?? betaFallback;
    if (v === null || b === null) return null;
    total += v * (1 + b * (T - 25));
  }
  return total;
}
/** String current is set by its weakest panel (series). */
const weakest = (sp: StringPanels, key: string): number | null => {
  if (!sp.panels.length || sp.panels.some((c) => !c)) return null;
  const vs = (sp.panels as Component[]).map((c) => c.specs[key]?.v ?? null);
  return vs.some((v) => v === null) ? null : Math.min(...(vs as number[]));
};

export function validateDesign(p: Project): Finding[] {
  const ix = indexProject(p);
  const d = designOf(p);
  const out: Finding[] = [];
  const strings = stringsOf(p);

  // panels: duplicates and unassigned
  const owners = new Map<string, string[]>();
  for (const s of strings) for (const id of s.panelIds) owners.set(id, [...(owners.get(id) ?? []), s.stringId]);
  for (const [id, who] of owners) if (who.length > 1)
    out.push(structural('PANEL_DUPLICATE', 'error', [id, ...who], `Tấm ${ix.inst.get(id)?.inst.label ?? id} nằm ${who.length} lần trong các chuỗi`,
      'Chỉ giữ tấm này trong một chuỗi', 'Một tấm vật lý bị đếm hai lần: điện áp/dòng chuỗi và sản lượng đều sai'));
  const free = unassignedPanels(p);
  if (free.length) out.push(structural('PANEL_UNASSIGNED', 'warning', free, `${free.length} tấm chưa thuộc chuỗi nào`, 'Tạo chuỗi hoặc tăng số tấm của một chuỗi', 'Các tấm này chưa được tính vào sản lượng'));

  // strings
  for (const s of strings) {
    if (!s.panelIds.length) { out.push(structural('STRING_EMPTY', 'warning', [s.stringId], `${s.label} chưa có tấm`, 'Đặt số tấm hoặc xóa chuỗi', 'Chuỗi rỗng không phát điện')); continue; }
    if (!s.target) { out.push(structural('STRING_UNCONNECTED', 'warning', [s.stringId], `${s.label} chưa nối vào MPPT`, 'Chọn cổng MPPT cho chuỗi', 'Chuỗi chưa nối không phát điện')); continue; }
    const target = ix.inst.get(s.target.instanceId), port = ix.port(s.target);
    const key = portKey(s.target);
    if (!target || !port) { out.push(structural('PORT_NOT_FOUND', 'error', [s.stringId, key], `${s.label} nối tới cổng không tồn tại (${key})`, 'Chọn lại cổng đích', 'Kết nối không có thật', { port: s.target, stringId: s.stringId })); continue; }
    if (!isStringTarget(port.type)) {
      out.push(structural('PORT_TYPE_MISMATCH', 'error', [s.stringId, key], `${s.label} (nguồn PV) nối vào cổng "${PORT_TYPE_LABEL[port.type]}" của ${target.inst.label}`,
        'Nối chuỗi vào cổng MPPT của inverter hoặc cổng PV của controller', 'Nối PV DC vào cổng sai loại có thể gây hỏng thiết bị', { port: s.target, stringId: s.stringId }));
      continue;
    }
    const sp = panelsOf(ix, s);
    const ctx = { objectIds: [s.stringId, key], port: s.target, stringId: s.stringId };
    const inv = target.inst.kind === 'inverter';
    const lim = (k: string) => spec(target.comp, k);
    const betaVmp = d.betaVmpAssumption;

    if (sp.models.length > 1) out.push(structural('STRING_MIXED_MODELS', 'warning', [s.stringId], `${s.label} có ${sp.models.length} model tấm khác nhau`, 'Dùng một model cho mỗi chuỗi hoặc đánh giá mismatch riêng', 'Dòng chuỗi bị giới hạn bởi tấm yếu nhất', { status: 'limited' }));

    out.push(check({ ...ctx, code: 'VOC_COLD_ABS', label: `Voc lạnh ${s.label}`, unit: 'V', op: '<=', value: sumAt(sp, d.coldCellTempC, 'vocV', 'betaVoc', null),
      limit: lim('pvVocMaxV').value, formula: `Σ Voc × [1 + βVoc × (Tcell,lạnh − 25)] ≤ Voc tối đa của ${target.inst.label}`,
      sources: [...sourcesFor(sp, ['vocV', 'betaVoc']), design(d, 'coldCellTempC', '°C'), lim('pvVocMaxV')], fail: { status: 'fail', severity: 'error' },
      consequence: 'Vượt điện áp hở mạch tuyệt đối khi lạnh có thể làm hỏng thiết bị và mất bảo hành', fix: 'Giảm số tấm trong chuỗi hoặc chọn thiết bị có giới hạn Voc cao hơn' }));

    if (inv) {
      out.push(check({ ...ctx, code: 'START_VOLTAGE', label: `Voc nóng ${s.label} so với điện áp khởi động`, unit: 'V', op: '>=', value: sumAt(sp, d.hotCellTempC, 'vocV', 'betaVoc', null),
        limit: lim('pvStartV').value, formula: 'Σ Voc × [1 + βVoc × (Tcell,nóng − 25)] ≥ điện áp khởi động',
        sources: [...sourcesFor(sp, ['vocV', 'betaVoc']), design(d, 'hotCellTempC', '°C'), lim('pvStartV')], fail: { status: 'fail', severity: 'error' },
        consequence: 'Inverter có thể không khởi động khi tấm nóng hoặc ánh sáng yếu', fix: 'Thêm tấm vào chuỗi hoặc chọn inverter có ngưỡng khởi động thấp hơn' }));
      const vmpSrc = [...sourcesFor(sp, ['vmpV', 'betaVmp']), ...(betaVmp !== null ? [design(d, 'betaVmpAssumption', '1/°C')] : [])];
      const noBeta = (sources: Source[]) => (betaVmp !== null ? sources.filter((x) => !(x.field === 'betaVmp' && x.value === null)) : sources);
      out.push(check({ ...ctx, code: 'VMP_HOT_MIN', label: `Vmp nóng ${s.label} so với đáy dải MPPT`, unit: 'V', op: '>=', value: sumAt(sp, d.hotCellTempC, 'vmpV', 'betaVmp', betaVmp),
        limit: lim('mpptVminV').value, formula: 'Σ Vmp × [1 + βVmp × (Tcell,nóng − 25)] ≥ MPPT thấp nhất (βVmp từ datasheet hoặc giả định thiết kế; không suy từ βPmax)',
        sources: [...noBeta(vmpSrc), design(d, 'hotCellTempC', '°C'), lim('mpptVminV')], fail: { status: 'fail', severity: 'error' },
        consequence: 'Điện áp rơi dưới dải MPPT lúc nóng: inverter không bám được điểm công suất cực đại, mất sản lượng', fix: 'Thêm tấm vào chuỗi hoặc dùng inverter có dải MPPT thấp hơn' }));
      out.push(check({ ...ctx, code: 'VMP_COLD_MAX', label: `Vmp lạnh ${s.label} so với đỉnh dải MPPT`, unit: 'V', op: '<=', value: sumAt(sp, d.coldCellTempC, 'vmpV', 'betaVmp', betaVmp),
        limit: lim('mpptVmaxV').value, formula: 'Σ Vmp × [1 + βVmp × (Tcell,lạnh − 25)] ≤ MPPT cao nhất',
        sources: [...noBeta(vmpSrc), design(d, 'coldCellTempC', '°C'), lim('mpptVmaxV')], fail: { status: 'limited', severity: 'warning' },
        consequence: 'Vmp vượt đỉnh dải MPPT lúc lạnh: inverter kẹp điện áp, mất một phần công suất (không phải lỗi an toàn)', fix: 'Giảm số tấm trong chuỗi nếu tổn thất đáng kể' }));
    } else {
      out.push(check({ ...ctx, code: 'CTRL_POWER', label: `Công suất STC ${s.label} so với controller`, unit: 'W', op: '<=',
        value: sp.panels.some((c) => !c) ? null : (sp.panels as Component[]).reduce((a, c) => a + (c.specs.pstcW?.v ?? NaN), 0) || null,
        limit: lim('ratedW').value, formula: 'Σ Pstc ≤ công suất PV danh định của controller', sources: [...sourcesFor(sp, ['pstcW']), lim('ratedW')],
        fail: { status: 'limited', severity: 'warning' }, consequence: 'Controller giới hạn công suất đầu vào, phần dư bị cắt', fix: 'Giảm số tấm hoặc chọn controller công suất lớn hơn' }));
    }
  }

  // trackers: group strings by port
  const byPort = new Map<string, StringDef[]>();
  for (const s of strings) if (s.target && s.panelIds.length) byPort.set(portKey(s.target), [...(byPort.get(portKey(s.target)) ?? []), s]);
  for (const [key, group] of byPort) {
    const target = ix.inst.get(group[0].target!.instanceId);
    const port = target && ix.port(group[0].target!);
    if (!target || !port || !isStringTarget(port.type)) continue;
    const inv = target.inst.kind === 'inverter';
    const sps = group.map((s) => panelsOf(ix, s));
    const sum = (k: string) => { const v = sps.map((sp) => weakest(sp, k)); return v.some((x) => x === null) ? null : (v as number[]).reduce((a, b) => a + b, 0); };
    const ctx = { objectIds: [key, ...group.map((s) => s.stringId)], port: group[0].target!, stringId: group[0].stringId };
    const lim = (k: string) => spec(target.comp, k);
    const srcs = (keys: string[]) => sps.flatMap((sp) => sourcesFor(sp, keys)).filter((x, i, a) => a.findIndex((y) => y.where === x.where && y.field === x.field) === i);
    const iscSum = sum('iscA');
    out.push(check({ ...ctx, code: 'ISC_TRACKER', label: `Tổng Isc trên ${port.label} của ${target.inst.label}`, unit: 'A', op: '<=', value: iscSum === null ? null : iscSum * d.iscFactor,
      limit: lim(inv ? 'pvIscMaxPerMpptA' : 'pvIscMaxA').value, formula: `${d.iscFactor === 1 ? '' : d.iscFactor + ' × '}Σ_chuỗi min(Isc) ≤ Isc cho phép của cổng`,
      sources: [...srcs(['iscA']), design(d, 'iscFactor', '×'), lim(inv ? 'pvIscMaxPerMpptA' : 'pvIscMaxA')], fail: { status: 'fail', severity: 'error' },
      consequence: 'Dòng ngắn mạch vượt giới hạn cổng có thể làm hỏng tracker', fix: 'Chia các chuỗi sang tracker khác hoặc bớt chuỗi song song' }));
    if (inv) out.push(check({ ...ctx, code: 'IMP_TRACKER', label: `Tổng Imp trên ${port.label} của ${target.inst.label}`, unit: 'A', op: '<=', value: sum('impA'),
      limit: lim('pvImaxPerMpptA').value, formula: 'Σ_chuỗi min(Imp) ≤ dòng vào vận hành tối đa của cổng', sources: [...srcs(['impA']), lim('pvImaxPerMpptA')],
      fail: { status: 'limited', severity: 'warning' }, consequence: 'Dòng vượt giới hạn vận hành: inverter cắt bớt công suất (clipping), không phải lỗi an toàn', fix: 'Chia các chuỗi sang tracker khác để giảm cắt công suất' }));
    if (group.length > 1) {
      const sig = (sp: StringPanels) => `${sp.panels.length}|${sp.models.map(refKey).sort().join(',')}`;
      if (new Set(sps.map(sig)).size > 1)
        out.push(structural('PARALLEL_STRINGS_MISMATCH', 'warning', ctx.objectIds, `Các chuỗi song song trên ${port.label} khác số tấm hoặc model`, 'Dùng chuỗi giống nhau trên cùng tracker', 'Chuỗi song song ép chung một điện áp: chuỗi lệch làm mất công suất', { status: 'limited', port: ctx.port }));
    }
  }

  // edges
  for (const e of p.edges) {
    const a = ix.inst.get(e.from.instanceId), b = ix.inst.get(e.to.instanceId);
    const pa = a && ix.port(e.from), pb = b && ix.port(e.to);
    const ids = [e.edgeId, portKey(e.from), portKey(e.to)];
    if (!a || !pa || !b || !pb) { out.push(structural('PORT_NOT_FOUND', 'error', ids, `Kết nối ${e.edgeId} trỏ tới cổng không tồn tại`, 'Xóa kết nối hoặc chọn lại cổng', 'Kết nối không có thật')); continue; }
    const v = edgeVerdict(pa.type, pb.type);
    if (v === 'mismatch') out.push(structural('PORT_TYPE_MISMATCH', 'error', ids, `${a.inst.label}.${pa.label} (${PORT_TYPE_LABEL[pa.type]}) không nối được với ${b.inst.label}.${pb.label} (${PORT_TYPE_LABEL[pb.type]})`, 'Chọn cổng cùng loại tương ứng', 'Nối DC/AC sai loại có thể gây hỏng thiết bị'));
    else if (v === 'reversed') out.push(structural('PORT_DIRECTION', 'error', ids, `Chiều công suất ngược: ${a.inst.label}.${pa.label} là cổng vào, ${b.inst.label}.${pb.label} là cổng ra`, 'Đảo chiều kết nối (nguồn → tải)', 'Chiều công suất sai không có nghĩa trong mô hình'));
  }
  for (const [id, { inst, ports }] of ix.inst) for (const pt of ports) {
    const n = ix.edgesAt({ instanceId: id, port: pt.id }).length;
    if ((pt.type === 'battery-dc' || pt.type === 'ac-in' || pt.type === 'pump-dc-in') && n > 1)
      out.push(structural('PORT_OVER_CAPACITY', 'error', [`${id}:${pt.id}`, id], `${inst.label}.${pt.label} có ${n} kết nối, chỉ nhận một`, 'Giữ một kết nối', 'Ghép song song bank/inverter cần mô hình riêng, ngoài phạm vi v1', { port: { instanceId: id, port: pt.id } }));
    if (n === 0 && inst.kind === 'battery')
      out.push(structural('BATTERY_UNCONNECTED', 'warning', [id], `${inst.label} chưa nối vào inverter`, 'Nối cổng DC pin với cổng Pin của inverter', 'Pin chưa nối không tham gia cấp/nhận điện'));
  }
  for (const [id, { inst, ports }] of ix.inst) if (inst.kind === 'load' && !ports.some((pt) => ix.edgesAt({ instanceId: id, port: pt.id }).length))
    out.push(structural('LOAD_UNCONNECTED', 'warning', [id], `${inst.label} chưa nối nguồn`, 'Nối tải vào cổng AC của inverter hoặc cổng ra của controller', 'Tải chưa nối không được cấp điện'));

  // battery ↔ inverter, AC loads, controller ↔ load
  const other = (e: Project['edges'][number], id: string) => (e.from.instanceId === id ? e.to : e.from);
  for (const [id, { inst, comp, ports }] of ix.inst) {
    if (inst.kind === 'inverter') {
      const bat = ix.edgesAt({ instanceId: id, port: 'BAT' }).map((e) => other(e, id)).map((r) => ix.inst.get(r.instanceId)).find((x) => x?.inst.kind === 'battery');
      if (bat && ports.some((x) => x.id === 'BAT')) {
        const ctx = { objectIds: [`${id}:BAT`, bat.inst.instanceId], port: { instanceId: id, port: 'BAT' } };
        out.push(check({ ...ctx, code: 'BATTERY_VOLTAGE_WINDOW', label: `Điện áp danh định pin so với dải pin của ${inst.label}`, unit: 'V', op: '>=', value: spec(bat.comp, 'nominalV').value,
          limit: spec(comp, 'batteryVminV').value, formula: 'Vmin,inverter ≤ Vdanh định,pin ≤ Vmax,inverter (kiểm đáy)', sources: [spec(bat.comp, 'nominalV'), spec(comp, 'batteryVminV')],
          fail: { status: 'fail', severity: 'error' }, consequence: 'Điện áp pin ngoài dải inverter: không sạc/xả được', fix: 'Chọn pin hoặc inverter cùng dải điện áp' }));
        out.push(check({ ...ctx, code: 'BATTERY_VOLTAGE_WINDOW_MAX', label: `Điện áp danh định pin so với đỉnh dải pin của ${inst.label}`, unit: 'V', op: '<=', value: spec(bat.comp, 'nominalV').value,
          limit: spec(comp, 'batteryVmaxV').value, formula: 'Vdanh định,pin ≤ Vmax,inverter', sources: [spec(bat.comp, 'nominalV'), spec(comp, 'batteryVmaxV')],
          fail: { status: 'fail', severity: 'error' }, consequence: 'Điện áp pin ngoài dải inverter: không sạc/xả được', fix: 'Chọn pin hoặc inverter cùng dải điện áp' }));
        for (const [code, invKey, batKey, what] of [['BATTERY_CHARGE_LIMIT', 'batteryMaxChargeA', 'maxChargeA', 'sạc'], ['BATTERY_DISCHARGE_LIMIT', 'batteryMaxDischargeA', 'maxDischargeA', 'xả']] as const)
          out.push(check({ ...ctx, code, label: `Dòng ${what} tối đa của inverter so với pin`, unit: 'A', op: '<=', value: spec(comp, invKey).value, limit: spec(bat.comp, batKey).value,
            formula: `Dòng ${what} inverter ≤ dòng ${what} tối đa của pin`, sources: [spec(comp, invKey), spec(bat.comp, batKey)], fail: { status: 'limited', severity: 'warning' },
            consequence: `Dòng ${what} thực tế bị giới hạn bởi pin, thấp hơn khả năng inverter`, fix: 'Thêm module pin song song (nếu hãng cho phép) hoặc chấp nhận giới hạn' }));
      }
      const loads = ix.edgesAt({ instanceId: id, port: 'AC' }).map((e) => ix.inst.get(other(e, id).instanceId)).filter((x) => x?.inst.kind === 'load');
      if (loads.length) {
        const w = loads.map((l) => l!.comp?.specs.powerW?.v ?? null);
        out.push(check({ objectIds: [`${id}:AC`, id], port: { instanceId: id, port: 'AC' }, code: 'AC_LOAD_RATED', label: `Tổng tải AC so với công suất liên tục của ${inst.label}`, unit: 'W', op: '<=',
          value: w.some((x) => x === null) ? null : (w as number[]).reduce((a, b) => a + b, 0), limit: spec(comp, 'acRatedW').value, formula: 'Σ công suất tải ≤ công suất AC liên tục',
          sources: [...loads.map((l) => spec(l!.comp, 'powerW')), spec(comp, 'acRatedW')], fail: { status: 'limited', severity: 'warning' },
          consequence: 'Tải vượt công suất liên tục: inverter quá tải hoặc ngắt (chưa tính khởi động motor)', fix: 'Giảm tải đồng thời hoặc chọn inverter lớn hơn' }));
      }
    }
    if (inst.kind === 'controller') {
      const loadsOut = ix.edgesAt({ instanceId: id, port: 'OUT' }).map((e) => ix.inst.get(other(e, id).instanceId)).filter((x) => x?.inst.kind === 'load');
      for (const l of loadsOut) out.push(check({ objectIds: [`${id}:OUT`, id, l!.inst.instanceId], port: { instanceId: id, port: 'OUT' }, code: 'CTRL_LOAD_RATED', label: `Công suất ${l!.inst.label} so với controller`, unit: 'W', op: '<=',
        value: spec(l!.comp, 'powerW').value, limit: spec(comp, 'ratedW').value, formula: 'Công suất tải ≤ công suất định mức controller', sources: [spec(l!.comp, 'powerW'), spec(comp, 'ratedW')],
        fail: { status: 'limited', severity: 'warning' }, consequence: 'Controller không cấp đủ công suất cho tải', fix: 'Chọn controller lớn hơn hoặc tải nhỏ hơn' }));
    }
  }

  const rank = (f: Finding) => (f.status === 'fail' && f.severity === 'error' ? 0 : f.status === 'limited' || (f.status === 'fail') ? 1 : f.status === 'unknown' ? 2 : 3);
  return out.map((f, i) => ({ f, i })).sort((x, y) => rank(x.f) - rank(y.f) || x.i - y.i).map((x) => x.f);
}

/** Three independent badges for one object (string, port, device). */
export function badgeOf(findings: readonly Finding[], id: string): Badge {
  const mine = findings.filter((f) => f.objectIds.some((o) => o === id || o.startsWith(id + ':')));
  return {
    dataComplete: !mine.some((f) => f.status === 'unknown'),
    powerLimited: mine.some((f) => f.status === 'limited'),
    exceedsLimit: mine.some((f) => f.status === 'fail' && f.severity === 'error'),
  };
}
