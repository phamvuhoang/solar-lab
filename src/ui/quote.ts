import { buildQuote, compareQuotes, settingsOf, type Quote, type QuoteLine } from '../cost/quote';
import { addCostLine, removeCostLine, selectOffer, setQuantity, setQuoteSettings, today } from '../cost/edit';
import { newId } from '../domain/ids';
import { CATEGORIES, refKey, type Category, type Offer, type Project, type Ref, type VatMode } from '../domain/types';
import { parseMoney, parseNumber, parseQuantity } from '../domain/units';
import { validateOffer } from '../domain/validate';
import { quoteToCsv } from '../reports/csv';
import { download, h } from './dom';

const vnd = (m: string | null) => (m === null ? '—' : Number(m).toLocaleString('vi-VN') + ' đ');
const CAT: Record<Category, string> = { equipment: 'Thiết bị', frame: 'Khung', cable: 'Dây', protection: 'Thiết bị bảo vệ', labor: 'Công lắp', shipping: 'Giao hàng', discount: 'Giảm giá', other: 'Khác' };
const STATUS = { known: 'đã có giá', missing: 'chưa có giá', 'included-in-kit': 'trong kit' } as const;
const VAT = { included: 'đã gồm VAT', excluded: 'chưa gồm VAT', unknown: 'chưa rõ VAT' } as const;
const REASON = { NO_OFFER: 'chưa chọn báo giá', NO_PRICE: 'báo giá "liên hệ"', NO_WATTAGE: 'thiếu công suất W để quy đổi', OFFER_MISMATCH: 'báo giá thuộc thiết bị khác', UNSUPPORTED_UNIT: 'đơn vị giá không dùng được' } as const;

export interface QuoteCtx {
  project: Project; offers: Offer[]; revisions: { revision: number }[];
  loadRevision(n: number): Promise<Project | undefined>; saveOffer(o: Offer): Promise<void>;
  apply(next: Project): Promise<void>;
  /** Quote line keys (design:model@rev) of the instances selected elsewhere; their rows are highlighted. */
  selectedKeys?: string[];
  /** A device row's label selects every instance of that model in the shared selection. */
  select?(ids: string[]): void;
}

const num = (v: string) => (v.trim() ? parseNumber(v.trim()) : null);

export function renderQuote(ctx: QuoteCtx): Node[] {
  const p = ctx.project;
  const q = buildQuote(p);
  const st = settingsOf(p);
  const errBox = h('p', { role: 'alert', id: 'quote-error' });
  const fail = (m: string) => { errBox.textContent = m; };

  const picked = new Set(ctx.selectedKeys ?? []);
  const instancesOf = (key: string) => p.instances.filter((i) => i.componentRef && `design:${refKey(i.componentRef)}` === key).map((i) => i.instanceId);
  const label = (l: QuoteLine) => {
    const ids = l.source === 'design' && ctx.select ? instancesOf(l.key.replace(/:kit$/, '')) : [];
    return ids.length ? h('button', { type: 'button', className: 'bom-pick', 'aria-label': `Chọn ${ids.length} × ${l.label}`, onClick: () => ctx.select!(ids) }, l.label) : l.label;
  };
  const row = (l: QuoteLine) => h('tr', { 'data-key': l.key, className: picked.has(l.key.replace(/:kit$/, '')) ? 'selected' : '', 'aria-selected': String(picked.has(l.key.replace(/:kit$/, ''))) },
    h('td', {}, CAT[l.category]), h('td', {}, label(l)),
    h('td', {}, l.qtyUnit === 'mm' ? `${(l.qty / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 3 })} m` : String(l.qty)),
    h('td', {}, l.status === 'missing' ? `chưa có giá (${REASON[l.reason!]})` : l.basis),
    h('td', { className: 'num' }, l.totalMinor === null ? '—' : (l.sign === -1 ? '−' : '') + vnd(l.totalMinor)),
    h('td', {}, STATUS[l.status]), h('td', {}, VAT[l.vat]), h('td', { 'data-min-depth': 'ky-su' }, [l.seller, l.recordedAt].filter(Boolean).join(' · ')),
    l.source === 'extra' && h('td', {}, h('button', { 'aria-label': `Xóa ${l.label}`, onClick: () => ctx.apply(removeCostLine(p, l.key.slice('extra:'.length))) }, 'Xóa')));

  const reasons = [
    // named, not only counted: in Cơ bản the line table is hidden and this sentence is "còn thiếu gì"
    q.missing.lineKeys.length && `${q.missing.lineKeys.length} dòng chưa có giá (${q.missing.lineKeys.map((k) => q.lines.find((l) => l.key === k)?.label ?? k).join(', ')})`,
    q.missing.scope.length && `thiếu hạng mục: ${q.missing.scope.map((c) => CAT[c]).join(', ')}`,
    q.missing.unknownVatKeys.length && `${q.missing.unknownVatKeys.length} dòng chưa rõ VAT`,
    q.issues.some((i) => i.code === 'KIT_PART_NOT_IN_DESIGN') && 'kit ghi nhiều linh kiện hơn thiết kế có',
  ].filter(Boolean).join('; ');

  const waive = h('div', { 'data-min-depth': 'tho' }, h('strong', {}, 'Phạm vi cần có: '), ...st.requiredCategories.map((c) => {
    const box = h('input', { type: 'checkbox', checked: st.waived.includes(c), id: `waive-${c}` });
    box.addEventListener('change', () => ctx.apply(setQuoteSettings(p, { waived: box.checked ? [...st.waived, c] : st.waived.filter((x) => x !== c) })));
    return h('label', {}, box, ` ${CAT[c]}: không áp dụng `);
  }));
  const vatInput = h('input', { id: 'vat-rate', value: String(st.vatRateBp / 100).replace('.', ','), size: 4, 'aria-label': 'Thuế suất VAT (%)' });
  vatInput.addEventListener('change', () => {
    const n = num(vatInput.value);
    if (n === null || n < 0 || n > 100) return fail('Thuế suất VAT phải từ 0 đến 100 %');
    ctx.apply(setQuoteSettings(p, { vatRateBp: Math.round(n * 100) }));
  });

  return [
    h('h2', {}, `Dự toán · ${p.name}`),
    h('p', {}, `revision ${p.revision} · làm tròn nửa lên từng dòng · VAT ${st.vatRateBp / 100}% (giả định, sửa được) `, h('label', { 'data-min-depth': 'tho' }, 'VAT % ', vatInput)),
    h('table', { id: 'quote-table', 'data-min-depth': 'tho' },
      h('thead', {}, h('tr', {}, ...['Nhóm', 'Mô tả', 'SL', 'Quy đổi', 'Thành tiền', 'Trạng thái', 'VAT', 'Nhà bán · ngày', ''].map((t) => h('th', { 'data-min-depth': t === 'Nhà bán · ngày' ? 'ky-su' : undefined }, t)))),
      h('tbody', {}, ...q.lines.map(row))),
    h('p', { id: 'quote-known' }, `Tổng phần đã biết (chưa VAT): ${vnd(q.knownSubtotalMinor)}`),
    h('p', { id: 'quote-vat', 'data-min-depth': 'tho' }, `VAT trên dòng chưa gồm VAT: ${vnd(q.vatMinor)} · giao hàng: ${vnd(q.shippingMinor)}`),
    h('p', { id: 'quote-total' }, q.complete ? `Tổng hoàn chỉnh: ${vnd(q.totalMinor)}` : `Tổng hoàn chỉnh: chưa đủ để báo (${reasons || 'chưa có dòng nào'})`),
    waive,
    q.issues.length ? h('ul', {}, ...q.issues.map((i) => h('li', {}, `Cảnh báo ${i.code}: ${i.message}`))) : null,
    errBox,
    h('h3', { 'data-min-depth': 'tho' }, 'Thiết bị trong thiết kế'), ...devices(ctx, q, fail),
    h('h3', { 'data-min-depth': 'tho' }, 'Thêm dòng bổ sung'), extraForm(ctx, fail),
    h('h3', { 'data-min-depth': 'ky-su' }, 'So sánh A/B với revision cũ'), compare(ctx, q),
    h('button', { id: 'export-csv', 'data-min-depth': 'tho', onClick: () => download(`${p.name}-du-toan.csv`, quoteToCsv(q, p.name), 'text/csv;charset=utf-8') }, 'Xuất CSV'),
  ].filter(Boolean) as Node[];
}

function devices(ctx: QuoteCtx, q: Quote, fail: (m: string) => void): Node[] {
  const p = ctx.project;
  return Object.entries(q.deviceCounts).map(([key, count]) => {
    const comp = p.snapshots.components.find((c) => refKey(c) === key)!;
    const ref: Ref = { modelId: comp.modelId, revision: comp.revision };
    const qty = h('input', { type: 'number', min: 0, value: count, 'aria-label': `Số lượng ${comp.name}`, style: 'width:4.5rem' });
    const avail = new Map<string, Offer>();
    for (const o of [...p.snapshots.offers, ...ctx.offers]) if (refKey(o.componentRef) === key) avail.set(o.offerId, o);
    const sel = p.priceSelections.find((s) => refKey(s.componentRef) === key)?.offerId;
    const pick = h('select', { 'aria-label': `Báo giá ${comp.name}` }, h('option', { value: '' }, '— chưa chọn —'),
      ...[...avail.values()].map((o) => h('option', { value: o.offerId }, `${o.seller} · ${o.priceMinor ? vnd(o.priceMinor) + '/' + o.unit : 'liên hệ'}${o.recordedAt ? ' · ' + o.recordedAt : ''}`)));
    pick.value = sel ?? '';
    const formHost = h('div', {});
    return h('div', { className: 'card', 'data-device': key, 'data-min-depth': 'tho' },
      h('strong', {}, comp.name), ' ',
      h('label', {}, 'SL ', qty), h('button', { onClick: () => {
        const n = Number(qty.value);
        if (!Number.isInteger(n) || n < 0) return fail('Số lượng phải là số nguyên không âm');
        ctx.apply(setQuantity(p, ref, n));
      } }, 'Cập nhật SL'), ' ',
      pick, h('button', { onClick: () => { const o = avail.get(pick.value); if (o) ctx.apply(selectOffer(p, o)); else fail('Chọn một báo giá'); } }, 'Dùng báo giá'), ' ',
      h('button', { onClick: () => formHost.replaceChildren(offerForm(ref, comp.condition, async (o) => { await ctx.saveOffer(o); await ctx.apply(selectOffer(p, o)); }, () => formHost.replaceChildren())) }, 'Thêm báo giá'),
      formHost);
  });
}

function offerForm(ref: Ref, condition: 'new' | 'used', onSave: (o: Offer) => Promise<void>, onCancel: () => void): HTMLElement {
  const f = (id: string, label: string, el: HTMLElement) => h('div', {}, h('label', { htmlFor: id }, label + ' '), el);
  const seller = h('input', { id: 'o-seller', required: true });
  const unit = h('select', { id: 'o-unit' }, h('option', { value: 'piece' }, 'đ/chiếc'), h('option', { value: 'W' }, 'đ/W'), h('option', { value: 'set' }, 'đ/bộ'));
  const price = h('input', { id: 'o-price', placeholder: 'để trống nếu "liên hệ"' });
  const vat = h('select', { id: 'o-vat' }, h('option', { value: 'unknown' }, 'chưa rõ'), h('option', { value: 'included' }, 'đã gồm'), h('option', { value: 'excluded' }, 'chưa gồm'));
  const date = h('input', { id: 'o-date', type: 'date', value: today() });
  const region = h('input', { id: 'o-region' });
  const ship = h('input', { id: 'o-ship', placeholder: 'để trống nếu chưa rõ' });
  const tiers = h('textarea', { id: 'o-tiers', placeholder: 'mỗi dòng: số lượng tối thiểu: giá, ví dụ 36: 2.800' });
  const valid = h('input', { id: 'o-valid', type: 'date' });
  const err = h('div', { role: 'alert', id: 'offer-error' });
  const submit = async (e: Event) => {
    e.preventDefault();
    const issues: string[] = [];
    let priceMinor: string | null = null, shippingMinor: string | null = null;
    if (price.value.trim()) { const r = parseMoney(price.value); if (r.ok) priceMinor = r.minor; else issues.push(`Giá: ${r.message}`); }
    if (ship.value.trim()) { const r = parseMoney(ship.value); if (r.ok) shippingMinor = r.minor; else issues.push(`Phí giao: ${r.message}`); }
    const tierList: Offer['tiers'] = [];
    for (const raw of tiers.value.split('\n').map((x) => x.trim()).filter(Boolean)) {
      const m = /^(\d+)\s*[:\s]\s*(.+)$/.exec(raw);
      const r = m && parseMoney(m[2]);
      if (!m || !r || !r.ok) issues.push(`Bậc giá "${raw}" cần dạng "số lượng: giá"`); else tierList.push({ minQty: Number(m[1]), priceMinor: r.minor });
    }
    const offer: Offer = {
      schemaVersion: 1, offerId: newId('off'), componentRef: ref, seller: seller.value.trim(), recordedAt: date.value || null, region: region.value.trim() || null,
      priceMinor, currency: 'VND', unit: unit.value as Offer['unit'], tiers: tierList, vat: vat.value as VatMode, condition, shippingMinor, warrantyMonths: null,
      validUntil: valid.value || null, label: 'báo giá người dùng nhập',
    };
    if (!issues.length) issues.push(...validateOffer(offer).map((i) => `${i.field}: ${i.message}`));
    err.replaceChildren(...issues.map((m) => h('p', {}, m)));
    if (!issues.length) await onSave(offer);
  };
  return h('form', { onSubmit: submit, 'aria-label': 'Báo giá mới' }, f('o-seller', 'Nhà bán', seller), f('o-unit', 'Đơn vị giá', unit), f('o-price', 'Đơn giá', price),
    f('o-vat', 'VAT', vat), f('o-date', 'Ngày báo giá', date), h('div', { 'data-min-depth': 'ky-su' }, h('label', { htmlFor: 'o-valid' }, 'Hết hiệu lực '), valid), f('o-region', 'Khu vực/kho', region), f('o-ship', 'Phí giao (đ)', ship),
    f('o-tiers', 'Bậc giá', tiers), err, h('button', { type: 'submit' }, 'Lưu báo giá'), h('button', { type: 'button', onClick: onCancel }, 'Hủy'));
}

function extraForm(ctx: QuoteCtx, fail: (m: string) => void): HTMLElement {
  const cat = h('select', { id: 'x-cat', 'aria-label': 'Nhóm' }, ...CATEGORIES.filter((c) => c !== 'equipment').map((c) => h('option', { value: c }, CAT[c])));
  const label = h('input', { id: 'x-label', placeholder: 'Mô tả', required: true });
  const qty = h('input', { id: 'x-qty', value: '1', size: 8, 'aria-label': 'Số lượng (cho dây: 12,5 m)' });
  const price = h('input', { id: 'x-price', placeholder: 'Đơn giá (đ; dây: đ/m)', 'aria-label': 'Đơn giá' });
  const vat = h('select', { id: 'x-vat', 'aria-label': 'VAT' }, h('option', { value: 'unknown' }, 'VAT chưa rõ'), h('option', { value: 'included' }, 'đã gồm VAT'), h('option', { value: 'excluded' }, 'chưa gồm VAT'));
  const seller = h('input', { id: 'x-seller', placeholder: 'Nhà bán', 'aria-label': 'Nhà bán' });
  return h('form', { onSubmit: (e: Event) => {
    e.preventDefault();
    fail('');
    let qtyN: number, unit: 'piece' | 'mm';
    if (cat.value === 'cable' && /[a-z]/i.test(qty.value)) {
      const r = parseQuantity(qty.value, 'm');
      if (!r.ok) return fail(`Số lượng: ${r.message}`);
      qtyN = Math.round(r.value * 1000); unit = 'mm';
    } else if (cat.value === 'cable') {
      const n = num(qty.value);
      if (n === null || n <= 0) return fail('Chiều dài dây phải là số mét dương');
      qtyN = Math.round(n * 1000); unit = 'mm';
    } else {
      const n = num(qty.value);
      if (n === null || !Number.isInteger(n) || n < 1) return fail('Số lượng phải là số nguyên dương');
      qtyN = n; unit = 'piece';
    }
    let unitPriceMinor: string | null = null;
    if (price.value.trim()) { const r = parseMoney(price.value); if (!r.ok) return fail(`Đơn giá: ${r.message}`); unitPriceMinor = r.minor; }
    ctx.apply(addCostLine(ctx.project, { category: cat.value as Category, label: label.value.trim(), qty: qtyN, qtyUnit: unit, unitPriceMinor,
      vat: vat.value as VatMode, seller: seller.value.trim() || null, recordedAt: today() }));
  }, 'aria-label': 'Dòng bổ sung', 'data-min-depth': 'tho' }, cat, label, qty, price, vat, seller, h('button', { type: 'submit' }, 'Thêm dòng'));
}

function compare(ctx: QuoteCtx, current: Quote): HTMLElement {
  const others = ctx.revisions.filter((r) => r.revision !== ctx.project.revision);
  const out = h('div', { id: 'compare-out' });
  if (!others.length) return h('p', { 'data-min-depth': 'ky-su' }, 'Chưa có revision cũ để so sánh. Mỗi lần đổi số lượng, báo giá hay dòng bổ sung sẽ tạo revision mới.');
  const sel = h('select', { id: 'cmp-rev', 'aria-label': 'Revision A' }, ...others.map((r) => h('option', { value: String(r.revision) }, `revision ${r.revision}`)));
  sel.value = String(others[others.length - 1].revision);
  const run = async () => {
    const a = await ctx.loadRevision(Number(sel.value));
    if (!a) return;
    const c = compareQuotes(buildQuote(a), current);
    const d = (m: string | null) => (m === null ? '—' : (BigInt(m) > 0n ? '+' : '') + Number(m).toLocaleString('vi-VN') + ' đ');
    out.replaceChildren(
      h('table', {}, h('thead', {}, h('tr', {}, ...['Dòng', `A (rev ${sel.value})`, `B (rev ${ctx.project.revision})`, 'Chênh B − A'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...c.rows.map((r) => h('tr', {}, h('td', {}, r.label), h('td', {}, r.a ? `${r.a.qty}× ${r.a.totalMinor === null ? 'chưa có giá' : vnd(r.a.totalMinor)}` : '—'),
          h('td', {}, r.b ? `${r.b.qty}× ${r.b.totalMinor === null ? 'chưa có giá' : vnd(r.b.totalMinor)}` : '—'), h('td', {}, r.deltaMinor === null ? 'không tính (chưa có giá)' : d(r.deltaMinor)))))),
      h('p', { id: 'cmp-known' }, `Chênh phần đã biết: ${c.knownDeltaMinor === null ? 'không công bố vì hai phương án thiếu giá/hạng mục khác nhau' : d(c.knownDeltaMinor)}`),
      h('p', { id: 'cmp-total' }, `Chênh toàn hệ: ${c.totalDeltaMinor === null ? 'không công bố vì chưa đủ giá ở một hoặc cả hai phương án' : d(c.totalDeltaMinor)}`),
      h('p', {}, `Phụ: giao hàng A ${vnd(c.summary.shipping.a)} → B ${vnd(c.summary.shipping.b)}; VAT A ${vnd(c.summary.vat.a)} → B ${vnd(c.summary.vat.b)}; dòng chưa giá A ${c.missingCount.a} → B ${c.missingCount.b}.`));
  };
  return h('div', { 'data-min-depth': 'ky-su' }, h('label', {}, 'A = ', sel), h('button', { id: 'cmp-run', onClick: run }, 'So sánh'), out);
}
