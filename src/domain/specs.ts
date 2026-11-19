import type { Dim } from './units';

export const KINDS = ['panel', 'inverter', 'battery', 'controller', 'load'] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = {
  panel: 'Tấm pin', inverter: 'Inverter', battery: 'Pin lưu trữ', controller: 'Controller bơm', load: 'Tải',
};
export const PROVENANCE = ['manufacturer', 'seller', 'measured', 'user', 'assumption'] as const;
export type Provenance = (typeof PROVENANCE)[number];

export interface SpecDef { dim: Dim; label: string; allowNegative?: boolean }

// Every numeric field a component may carry, per kind. Keys are the storage contract.
export const SPEC_DEFS: Record<Kind, Record<string, SpecDef>> = {
  panel: {
    pstcW: { dim: 'W', label: 'Pmax (STC)' }, vocV: { dim: 'V', label: 'Voc' }, iscA: { dim: 'A', label: 'Isc' },
    vmpV: { dim: 'V', label: 'Vmp' }, impA: { dim: 'A', label: 'Imp' },
    betaVoc: { dim: 'coef', label: 'Hệ số nhiệt Voc', allowNegative: true },
    betaIsc: { dim: 'coef', label: 'Hệ số nhiệt Isc', allowNegative: true },
    betaPmax: { dim: 'coef', label: 'Hệ số nhiệt Pmax', allowNegative: true },
    efficiency: { dim: 'ratio', label: 'Hiệu suất module' }, bifaciality: { dim: 'ratio', label: 'Bifaciality' },
    maxSystemV: { dim: 'V', label: 'Điện áp hệ thống tối đa' }, maxSeriesFuseA: { dim: 'A', label: 'Cầu chì chuỗi tối đa' },
    lengthM: { dim: 'm', label: 'Dài' }, widthM: { dim: 'm', label: 'Rộng' }, thicknessM: { dim: 'm', label: 'Dày' },
    weightKg: { dim: 'kg', label: 'Khối lượng' },
  },
  inverter: {
    acRatedW: { dim: 'W', label: 'Công suất AC liên tục' }, pvMaxPowerW: { dim: 'W', label: 'PV tối đa' },
    pvVocMaxV: { dim: 'V', label: 'Voc tuyệt đối tối đa' }, pvStartV: { dim: 'V', label: 'Điện áp khởi động' },
    mpptVminV: { dim: 'V', label: 'MPPT từ' }, mpptVmaxV: { dim: 'V', label: 'MPPT đến' },
    mpptCount: { dim: 'count', label: 'Số MPPT' }, pvImaxPerMpptA: { dim: 'A', label: 'Dòng vào tối đa mỗi MPPT' },
    pvIscMaxPerMpptA: { dim: 'A', label: 'Isc cho phép mỗi MPPT' },
    batteryVminV: { dim: 'V', label: 'Dải pin từ' }, batteryVmaxV: { dim: 'V', label: 'Dải pin đến' },
    batteryMaxChargeA: { dim: 'A', label: 'Dòng sạc tối đa' }, batteryMaxDischargeA: { dim: 'A', label: 'Dòng xả tối đa' },
    efficiencyMax: { dim: 'ratio', label: 'Hiệu suất tối đa' },
  },
  battery: {
    nominalV: { dim: 'V', label: 'Điện áp danh định' }, vMinV: { dim: 'V', label: 'Điện áp vận hành từ' },
    vMaxV: { dim: 'V', label: 'Điện áp vận hành đến' }, capacityAh: { dim: 'Ah', label: 'Dung lượng' },
    nominalWh: { dim: 'Wh', label: 'Năng lượng danh nghĩa' }, usableWh: { dim: 'Wh', label: 'Năng lượng khả dụng' },
    maxChargeA: { dim: 'A', label: 'Dòng sạc tối đa' }, maxDischargeA: { dim: 'A', label: 'Dòng xả tối đa' },
    sohRatio: { dim: 'ratio', label: 'SoH' }, socMinRatio: { dim: 'ratio', label: 'SoC tối thiểu' },
    socMaxRatio: { dim: 'ratio', label: 'SoC tối đa' },
    lengthM: { dim: 'm', label: 'Dài' }, widthM: { dim: 'm', label: 'Rộng' }, thicknessM: { dim: 'm', label: 'Dày' },
    weightKg: { dim: 'kg', label: 'Khối lượng' },
  },
  controller: {
    ratedW: { dim: 'W', label: 'Công suất định mức' }, vMinV: { dim: 'V', label: 'Điện áp vào từ' },
    vMaxV: { dim: 'V', label: 'Điện áp vào đến' }, iMaxA: { dim: 'A', label: 'Dòng ra tối đa' },
  },
  load: {
    powerW: { dim: 'W', label: 'Công suất' }, powerFactor: { dim: 'ratio', label: 'Hệ số công suất' },
    startupW: { dim: 'W', label: 'Công suất khởi động' },
  },
};

/** Fields every min/max pair must keep ordered. */
export const RANGE_PAIRS: [Kind, string, string][] = [
  ['inverter', 'mpptVminV', 'mpptVmaxV'], ['inverter', 'batteryVminV', 'batteryVmaxV'],
  ['battery', 'vMinV', 'vMaxV'], ['battery', 'socMinRatio', 'socMaxRatio'], ['controller', 'vMinV', 'vMaxV'],
];

/** What a design check needs. A component with missing fields still lists, but the check is blocked. */
export const CHECKS: Record<Kind, { id: string; label: string; needs: string[] }[]> = {
  panel: [
    { id: 'nominal-power', label: 'Công suất danh nghĩa và so giá', needs: ['pstcW'] },
    { id: 'string-voltage', label: 'Điện áp chuỗi (Voc lạnh, Vmp)', needs: ['vocV', 'vmpV', 'betaVoc'] },
    { id: 'string-current', label: 'Dòng chuỗi và Isc', needs: ['iscA', 'impA'] },
  ],
  inverter: [
    { id: 'mppt-window', label: 'Dải MPPT', needs: ['mpptVminV', 'mpptVmaxV'] },
    { id: 'voc-limit', label: 'Voc tuyệt đối', needs: ['pvVocMaxV'] },
    { id: 'start-voltage', label: 'Điện áp khởi động', needs: ['pvStartV'] },
    { id: 'isc-limit', label: 'Isc mỗi MPPT', needs: ['pvIscMaxPerMpptA'] },
    { id: 'battery-window', label: 'Dải điện áp pin', needs: ['batteryVminV', 'batteryVmaxV'] },
    { id: 'battery-current', label: 'Dòng sạc/xả pin', needs: ['batteryMaxChargeA', 'batteryMaxDischargeA'] },
  ],
  battery: [
    { id: 'energy', label: 'Năng lượng danh nghĩa', needs: ['nominalV', 'capacityAh'] },
    { id: 'dc-window', label: 'Dải điện áp vận hành', needs: ['vMinV', 'vMaxV'] },
    { id: 'current-limits', label: 'Giới hạn dòng sạc/xả', needs: ['maxChargeA', 'maxDischargeA'] },
  ],
  controller: [{ id: 'power-window', label: 'Dải điện áp và công suất', needs: ['ratedW', 'vMinV', 'vMaxV'] }],
  load: [{ id: 'load-power', label: 'Tải theo W và lịch', needs: ['powerW'] }],
};
