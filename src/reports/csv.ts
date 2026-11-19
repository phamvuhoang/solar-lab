import type { Quote } from '../cost/quote';
import { signed } from '../cost/quote';

const CATEGORY_VI: Record<string, string> = {
  equipment: 'Thiết bị', frame: 'Khung', cable: 'Dây', protection: 'Bảo vệ', labor: 'Công lắp', shipping: 'Giao hàng', discount: 'Giảm giá', other: 'Khác',
};
const STATUS_VI = { known: 'đã có giá', missing: 'chưa có giá', 'included-in-kit': 'trong kit' } as const;
const VAT_VI = { included: 'đã gồm VAT', excluded: 'chưa gồm VAT', unknown: 'chưa rõ VAT' } as const;
const UNIT_VI = { piece: 'chiếc', mm: 'mm', W: 'W', m: 'm', set: 'bộ' } as const;

/** Text cells starting with = + - @ are prefixed so spreadsheets do not run them as formulas. */
const text = (v: string | null | undefined) => {
  const s = v ?? '';
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};
const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** UTF-8 with BOM (Excel-friendly), comma separated, numbers are plain integers in đồng. */
export function quoteToCsv(q: Quote, projectName: string): string {
  const head = ['Nhóm', 'Mô tả', 'Số lượng', 'Đơn vị', 'Đơn giá (đ)', 'Đơn vị giá', 'Quy đổi', 'Thành tiền (đ)', 'Trạng thái', 'VAT', 'Nhà bán', 'Ngày báo giá', 'Ghi chú'];
  const rows = q.lines.map((l) => [
    CATEGORY_VI[l.category], text(l.label), l.qtyUnit === 'mm' ? l.qty / 1000 : l.qty, l.qtyUnit === 'mm' ? 'm' : UNIT_VI[l.qtyUnit],
    l.unitPriceMinor, UNIT_VI[l.priceUnit], text(l.basis), l.totalMinor === null ? '' : String(signed(l)), STATUS_VI[l.status], VAT_VI[l.vat],
    text(l.seller), l.recordedAt, text(l.note),
  ]);
  const sum = (label: string, v: string | null) => ['', label, '', '', '', '', '', v ?? '', '', '', '', '', ''];
  const out = [
    [`Dự toán: ${text(projectName)}`], head, ...rows,
    sum('Tổng phần đã biết (chưa VAT)', q.knownSubtotalMinor), sum(`VAT ${q.policy.vatRateBp / 100}% (dòng chưa gồm VAT)`, q.vatMinor),
    sum('Tổng hoàn chỉnh', q.totalMinor),
    ...(q.complete ? [] : [['', 'Chưa đủ để báo tổng: ' + [
      q.missing.lineKeys.length && `${q.missing.lineKeys.length} dòng chưa có giá`, q.missing.scope.length && `thiếu hạng mục ${q.missing.scope.map((c) => CATEGORY_VI[c]).join(', ')}`,
      q.missing.unknownVatKeys.length && `${q.missing.unknownVatKeys.length} dòng chưa rõ VAT`,
      q.issues.some((i) => i.code === 'KIT_PART_NOT_IN_DESIGN') && 'kit ghi nhiều linh kiện hơn thiết kế có'].filter(Boolean).join('; ')]]),
    ['', `Làm tròn: ${q.policy.rounding}`],
  ];
  return '﻿' + out.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
