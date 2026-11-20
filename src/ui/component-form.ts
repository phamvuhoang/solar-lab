import { checkComponent, type Issue } from '../domain/validate';
import { KIND_LABEL, PROVENANCE, SPEC_DEFS, type Kind, type Provenance } from '../domain/specs';
import { DIMS, formatQuantity, parseQuantity } from '../domain/units';
import { blankSpecs } from '../domain/component';
import type { Component } from '../domain/types';
import { h } from './dom';

const PROV_LABEL: Record<Provenance, string> = {
  manufacturer: 'Hãng', seller: 'Nhà bán', measured: 'Đo thực tế', user: 'Người dùng', assumption: 'Giả định',
};

export interface FormResult { draft: Omit<Component, 'revision'> }

/** Form for "tạo thiết bị từ đầu" (kind only) and "nhân bản/sửa" (prefilled). */
export function componentForm(
  base: Omit<Component, 'revision'>, onSave: (r: FormResult) => void | Promise<void>, onCancel: () => void,
): HTMLElement {
  const kind: Kind = base.kind;
  const defs = SPEC_DEFS[kind];
  const specs = { ...blankSpecs(kind), ...structuredClone(base.specs) };
  const inputs: Record<string, { text: HTMLInputElement; prov: HTMLSelectElement; err: HTMLElement }> = {};

  const field = (label: string, input: HTMLElement, id: string) => h('div', {}, h('label', { htmlFor: id }, label + ' '), input);
  const name = h('input', { id: 'f-name', value: base.name, required: true });
  const brand = h('input', { id: 'f-brand', value: base.brand, required: true });
  const sku = h('input', { id: 'f-sku', value: base.sku ?? '' });
  // a link or a file name with its version (the built-in catalog holds both): type=url would block the save without a word on the page
  const url = h('input', { id: 'f-url', value: base.datasheet?.url ?? '' });
  const cond = h('select', { id: 'f-cond' }, h('option', { value: 'new' }, 'Mới'), h('option', { value: 'used' }, 'Đã dùng'));
  cond.value = base.condition;
  const notes = h('textarea', { id: 'f-notes', value: base.notes ?? '' });
  const summary = h('div', { role: 'alert', id: 'form-issues' });

  const rows = Object.entries(defs).map(([key, def]) => {
    const cell = specs[key];
    const id = `s-${key}`;
    const text = h('input', {
      id, value: cell.v === null ? '' : formatQuantity(cell.v, def.dim), inputMode: 'decimal', autocomplete: 'off',
      'aria-describedby': `${id}-err`,
    });
    const prov = h('select', { id: `${id}-p`, 'aria-label': `Nguồn của ${def.label}` },
      ...PROVENANCE.map((p) => h('option', { value: p }, PROV_LABEL[p])));
    prov.value = cell.p;
    const err = h('span', { id: `${id}-err`, role: 'alert', className: 'err' });
    inputs[key] = { text, prov, err };
    return h('tr', {}, h('th', { scope: 'row' }, h('label', { htmlFor: id }, def.label)), h('td', {}, text, ' ', DIMS[def.dim].defaultUnit),
      h('td', {}, prov), h('td', {}, err));
  });

  const save = async (e: Event) => {
    e.preventDefault();
    const out: Component['specs'] = {};
    let bad = false;
    for (const [key, def] of Object.entries(defs)) {
      const { text, prov, err } = inputs[key];
      err.textContent = '';
      const raw = text.value.trim();
      if (!raw) { out[key] = { v: null, u: DIMS[def.dim].base, p: prov.value as Provenance }; continue; }
      const r = parseQuantity(raw, def.dim, { allowNegative: def.allowNegative });
      if (!r.ok) { err.textContent = r.message; bad = true; continue; }
      const prev = specs[key];
      out[key] = { v: r.value, u: r.unit, p: prov.value as Provenance, ...(prev.src && prev.v === r.value ? { src: prev.src } : {}) };
    }
    const draft: Omit<Component, 'revision'> = {
      ...base, name: name.value.trim(), brand: brand.value.trim(), sku: sku.value.trim() || null,
      condition: cond.value as 'new' | 'used', specs: out, notes: notes.value,
      datasheet: url.value.trim() ? { url: url.value.trim(), page: base.datasheet?.page ?? null, checkedAt: base.datasheet?.checkedAt ?? null } : null,
    };
    const issues: Issue[] = draft.name && draft.brand ? checkComponent({ ...draft, revision: 1 }) : [{ code: 'REQUIRED', severity: 'error', field: '/name', message: 'Cần tên và hãng' }];
    summary.replaceChildren(...issues.map((i) => h('p', { className: i.severity }, `${i.severity === 'error' ? 'Lỗi' : 'Cảnh báo'} ${i.field}: ${i.message}`)));
    if (bad || issues.some((i) => i.severity === 'error')) return;
    await onSave({ draft });
  };

  return h('form', { onSubmit: save, 'aria-label': 'Thiết bị' },
    h('h2', {}, `${base.derivedFrom ? 'Nhân bản' : 'Tạo'} thiết bị · ${KIND_LABEL[kind]}`),
    field('Tên', name, 'f-name'), field('Hãng', brand, 'f-brand'), field('SKU / mã', sku, 'f-sku'),
    field('Tình trạng', cond, 'f-cond'), field('Datasheet (link hoặc tên file)', url, 'f-url'),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Thông số'), h('th', {}, 'Giá trị'), h('th', {}, 'Nguồn'), h('th', {}, ''))), h('tbody', {}, ...rows)),
    field('Ghi chú', notes, 'f-notes'), summary,
    h('button', { type: 'submit' }, 'Lưu thiết bị'), h('button', { type: 'button', onClick: onCancel }, 'Hủy'));
}
