import { BUILTIN_COMPONENTS, BUILTIN_OFFERS, filterComponents } from '../catalog/catalog';
import { capabilities, blankSpecs, cloneForEdit } from '../domain/component';
import { newId, nowIso } from '../domain/ids';
import { addInstances } from '../domain/project';
import { KINDS, KIND_LABEL, SPEC_DEFS, type Kind } from '../domain/specs';
import { refKey, type Component, type Project } from '../domain/types';
import { formatNumber } from '../domain/units';
import type { ProjectRepository } from '../persistence/repository';
import { componentForm } from './component-form';
import { h } from './dom';

const HEADLINE: Record<Kind, string> = { panel: 'pstcW', inverter: 'acRatedW', battery: 'nominalWh', controller: 'ratedW', load: 'powerW' };
const AUTHOR = 'người dùng';

export interface CatalogCtx { project: Project; repo: ProjectRepository; mutate(next: Project): Promise<void>; rerender(): void; say(m: string): void }

// what the catalog panel remembers between re-renders
let filter: { kind: Kind | 'all'; text: string } = { kind: 'all', text: '' };
let editing: Omit<Component, 'revision'> | null = null;

/** The device catalog, or the device form while one is being edited. */
export async function renderCatalog(ctx: CatalogCtx): Promise<Node[]> {
  const { project, repo, mutate, say } = ctx;
  const [userComponents, userOffers] = [await repo.listComponents(), await repo.listOffers()];
  const formScreen = (base: Omit<Component, 'revision'>) => { editing = base; ctx.rerender(); };
  const catalogScreen = () => { editing = null; ctx.rerender(); };

  if (editing) return [componentForm(editing, async ({ draft }) => {
    const r = await repo.saveComponent({ ...draft, editedAt: nowIso(), author: AUTHOR });
    say(r.created ? `Đã lưu ${draft.name} (revision ${r.ref.revision}).` : `Nội dung kỹ thuật không đổi, giữ revision ${r.ref.revision}.`);
    catalogScreen();
  }, () => catalogScreen())];

  const all = [...BUILTIN_COMPONENTS, ...userComponents];
  const kindSel = h('select', { id: 'filter-kind', 'aria-label': 'Loại' }, h('option', { value: 'all' }, 'Tất cả'),
    ...KINDS.map((k) => h('option', { value: k }, KIND_LABEL[k])));
  kindSel.value = filter.kind;
  const text = h('input', { id: 'filter-text', value: filter.text, placeholder: 'Tìm hãng, tên, SKU', 'aria-label': 'Tìm' });
  const apply = () => { filter = { kind: kindSel.value as Kind | 'all', text: text.value }; ctx.rerender(); };
  kindSel.addEventListener('change', apply);
  text.addEventListener('change', apply);
  const newKind = h('select', { id: 'new-kind', 'aria-label': 'Loại thiết bị mới' }, ...KINDS.map((k) => h('option', { value: k }, KIND_LABEL[k])));

  const card = (c: Component) => {
    const hl = c.specs[HEADLINE[c.kind]]?.v;
    const missing = capabilities(c).filter((s) => !s.ok);
    const qty = h('input', { type: 'number', min: 1, value: 1, 'aria-label': `Số lượng ${c.name}`, style: 'width:4rem' });
    const mine = userComponents.includes(c);
    return h('article', { className: 'card', 'data-model': c.modelId },
      h('h3', {}, c.name),
      h('p', {}, `${c.brand} · ${KIND_LABEL[c.kind]} · ${c.condition === 'used' ? 'đã dùng' : 'mới'} · ${c.sku ?? 'chưa rõ SKU'} · revision ${c.revision}` +
        (hl != null ? ` · ${SPEC_DEFS[c.kind][HEADLINE[c.kind]].label} ${formatNumber(hl)} ${c.specs[HEADLINE[c.kind]].u}` : '') +
        (c.review === 'unreviewed' ? ' · chưa kiểm datasheet' : '')),
      missing.length ? h('p', { className: 'missing' }, 'Chưa kiểm được: ' + missing.map((s) => `${s.label} (thiếu ${s.missing.map((k) => SPEC_DEFS[c.kind][k].label).join(', ')})`).join('; '))
        : h('p', {}, 'Đủ thông số cho mọi kiểm tra hiện có.'),
      h('label', {}, 'Số lượng ', qty),
      h('button', { onClick: async () => {
        await mutate(addInstances(project, c, Math.max(1, Number(qty.value) | 0), [...BUILTIN_OFFERS, ...userOffers].filter((o) => refKey(o.componentRef) === refKey(c))));
        ctx.rerender();
      } }, 'Thêm vào dự án'),
      h('button', { onClick: () => formScreen(cloneForEdit(c, newId('mdl'), AUTHOR, nowIso())) }, 'Nhân bản'),
      mine && h('button', { onClick: () => formScreen({ ...c, derivedFrom: c.derivedFrom, editedAt: nowIso() }) }, 'Sửa'));
  };
  return [h('h2', {}, 'Thiết bị'), h('div', {}, kindSel, text),
    h('div', {}, newKind, h('button', { onClick: () => {
      const kind = newKind.value as Kind;
      formScreen({ schemaVersion: 1, modelId: newId('mdl'), sku: null, brand: '', name: '', kind, condition: 'new', specs: blankSpecs(kind), attrs: {},
        datasheet: null, review: 'unreviewed', author: AUTHOR, editedAt: nowIso(), derivedFrom: null });
    } }, 'Tạo thiết bị từ đầu')),
    ...filterComponents(all, filter).map(card)];
}
