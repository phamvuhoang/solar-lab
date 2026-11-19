import { BUILTIN_COMPONENTS, BUILTIN_OFFERS, filterComponents, offersFor } from '../catalog/catalog';
import { capabilities, blankSpecs, cloneForEdit } from '../domain/component';
import { diff } from '../domain/diff';
import { newId, nowIso } from '../domain/ids';
import { addInstances, createProject, openLamHa } from '../domain/project';
import { KINDS, KIND_LABEL, SPEC_DEFS, type Kind } from '../domain/specs';
import { refKey, type Component, type Offer, type Project } from '../domain/types';
import { formatNumber } from '../domain/units';
import { buildQuote } from '../cost/quote';
import { exportProject, stageImport } from '../persistence/exchange';
import { renderQuote } from './quote';
import { ConflictError, ProjectRepository } from '../persistence/repository';
import { componentForm } from './component-form';
import { download, h } from './dom';

const vnd = (minor: string) => Number(minor).toLocaleString('vi-VN') + ' đ';
const HEADLINE: Record<Kind, string> = { panel: 'pstcW', inverter: 'acRatedW', battery: 'nominalWh', controller: 'ratedW', load: 'powerW' };
const AUTHOR = 'người dùng';

export async function startApp(root: HTMLElement) {
  const repo = await ProjectRepository.open();
  let project: Project | null = null;
  let userComponents: Component[] = [];
  let userOffers: Offer[] = [];
  let message = '';
  let filter: { kind: Kind | 'all'; text: string } = { kind: 'all', text: '' };

  const say = (m: string) => { message = m; };
  const reload = async () => { [userComponents, userOffers] = [await repo.listComponents(), await repo.listOffers()]; };
  const mutate = async (next: Project) => {
    try { project = await repo.saveRevision(project!.revision, next); say(''); }
    catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      say(`Dự án đã được sửa ở tab khác (revision ${e.head.headRevision}). Bấm "Mở bản mới nhất" để xem; thay đổi của bạn chưa được lưu.`);
    }
  };
  const show = (...kids: (Node | false)[]) => {
    root.replaceChildren(h('h1', {}, 'Mekoniq Solar Lab'), message && h('p', { role: 'status', id: 'status' }, message), ...kids.filter(Boolean) as Node[]);
  };

  // ---- home ---------------------------------------------------------------------------------
  async function home() {
    const heads = await repo.listProjects();
    const name = h('input', { name: 'name', value: 'Dự án mới', required: true });
    const file = h('input', { type: 'file', accept: 'application/json,.json', id: 'import-file' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const staged = await stageImport(await f.text(), new Set((await repo.listProjects()).map((x) => x.projectId)));
      if (!staged.ok) {
        say('Không nhập được file; dự án hiện có không bị thay đổi.');
        show(...issueList(staged.issues), h('button', { onClick: () => home() }, 'Quay lại'));
        return;
      }
      project = await repo.createProject(staged.project);
      say(staged.renamed ? 'ID trùng: đã nhập thành bản sao mới.' : 'Đã nhập dự án.');
      projectScreen();
    });
    show(
      h('form', { onSubmit: async (e: Event) => { e.preventDefault(); project = await repo.createProject(createProject(name.value)); say(''); projectScreen(); } },
        h('label', {}, 'Tên dự án ', name), h('button', { type: 'submit' }, 'Tạo dự án')),
      h('button', { type: 'button', onClick: async () => { project = await repo.createProject(openLamHa()); say(''); projectScreen(); } }, 'Mở mẫu Lâm Hà'),
      h('label', {}, 'Nhập dự án (JSON) ', file),
      h('h2', {}, 'Dự án đã lưu'),
      heads.length ? h('ul', { id: 'saved' }, ...heads.map((p) => h('li', {},
        h('button', { onClick: async () => { project = (await repo.loadRevision(p.projectId))!; say(''); projectScreen(); } }, `Mở: ${p.name}`),
        ` · bản nháp, revision ${p.headRevision}`))) : h('p', {}, 'Chưa có dự án.'));
  }

  const issueList = (issues: { code: string; severity: string; field: string; message: string }[]) =>
    [h('ul', { id: 'issues' }, ...issues.map((i) => h('li', {}, `${i.severity === 'error' ? 'Lỗi' : 'Cảnh báo'} ${i.code} tại ${i.field || '/'}: ${i.message}`)))];

  // ---- project --------------------------------------------------------------------------------
  async function projectScreen() {
    const p = project!;
    const q = buildQuote(p);
    const revs = await repo.listRevisions(p.projectId);
    const labelOf = (key: string) => p.snapshots.components.find((c) => `${c.modelId}@${c.revision}` === key)?.name ?? key;
    const diffOut = h('div', { id: 'diff' });
    show(
      h('section', { 'aria-label': 'Bản thiết kế nháp' },
        h('h2', {}, p.name), h('p', {}, `Bản nháp · revision ${p.revision}`),
        h('ul', { id: 'devices' }, ...Object.entries(q.deviceCounts).map(([k, n]) => h('li', {}, `${n} × ${labelOf(k)}`))),
        h('p', { id: 'bom-total' }, p.instances.length ? `Tổng phần đã biết (chưa VAT): ${vnd(q.knownSubtotalMinor)}${q.complete ? '' : ' · tổng hoàn chỉnh: chưa đủ'}` : 'Chưa có linh kiện.')),
      h('button', { onClick: () => quoteScreen() }, 'Dự toán'),
      h('button', { onClick: () => catalogScreen() }, 'Thiết bị'),
      h('button', { onClick: async () => download(`${p.name}.json`, await exportProject(p)) }, 'Xuất JSON'),
      h('button', { onClick: async () => { project = await repo.cloneProject(p.projectId); say('Đã nhân bản dự án.'); projectScreen(); } }, 'Nhân bản dự án'),
      message.includes('Mở bản mới nhất') && h('button', { onClick: async () => { project = (await repo.loadRevision(p.projectId))!; say(''); projectScreen(); } }, 'Mở bản mới nhất'),
      h('button', { onClick: () => { say(''); home(); } }, 'Quay lại'),
      h('h3', {}, 'Lịch sử revision'),
      h('ol', { id: 'revisions' }, ...revs.map((r, i) => h('li', {}, `revision ${r.revision} · ${r.savedAt} `,
        i > 0 && h('button', { onClick: async () => {
          const [a, b] = await Promise.all([repo.loadRevision(p.projectId, revs[i - 1].revision), repo.loadRevision(p.projectId, r.revision)]);
          const changes = diff(a, b).filter((c) => !c.path.endsWith('/updatedAt') && c.path !== '/revision');
          diffOut.replaceChildren(h('ul', {}, ...changes.slice(0, 50).map((c) => h('li', {}, `${c.path}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`))));
        } }, `So với revision ${revs[i - 1].revision}`)))),
      diffOut);
  }

  async function quoteScreen() {
    await reload();
    const p = project!;
    show(...renderQuote({
      project: p, offers: [...BUILTIN_OFFERS, ...userOffers], revisions: await repo.listRevisions(p.projectId),
      loadRevision: (n) => repo.loadRevision(p.projectId, n), saveOffer: (o) => repo.saveOffer(o),
      apply: async (next) => { await mutate(next); await quoteScreen(); }, back: () => projectScreen(),
    }));
  }

  // ---- catalog ----------------------------------------------------------------------------------
  async function catalogScreen() {
    await reload();
    const all = [...BUILTIN_COMPONENTS, ...userComponents];
    const kindSel = h('select', { id: 'filter-kind', 'aria-label': 'Loại' }, h('option', { value: 'all' }, 'Tất cả'),
      ...KINDS.map((k) => h('option', { value: k }, KIND_LABEL[k])));
    kindSel.value = filter.kind;
    const text = h('input', { id: 'filter-text', value: filter.text, placeholder: 'Tìm hãng, tên, SKU', 'aria-label': 'Tìm' });
    const apply = () => { filter = { kind: kindSel.value as Kind | 'all', text: text.value }; catalogScreen(); };
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
        project && h('label', {}, 'Số lượng ', qty),
        project && h('button', { onClick: async () => {
          await mutate(addInstances(project!, c, Math.max(1, Number(qty.value) | 0), [...BUILTIN_OFFERS, ...userOffers].filter((o) => refKey(o.componentRef) === refKey(c))));
          projectScreen();
        } }, 'Thêm vào dự án'),
        h('button', { onClick: () => formScreen(cloneForEdit(c, newId('mdl'), AUTHOR, nowIso())) }, 'Nhân bản'),
        mine && h('button', { onClick: () => formScreen({ ...c, derivedFrom: c.derivedFrom, editedAt: nowIso() }) }, 'Sửa'));
    };
    show(h('h2', {}, 'Thiết bị'), h('div', {}, kindSel, text),
      h('div', {}, newKind, h('button', { onClick: () => {
        const kind = newKind.value as Kind;
        formScreen({ schemaVersion: 1, modelId: newId('mdl'), sku: null, brand: '', name: '', kind, condition: 'new', specs: blankSpecs(kind), attrs: {},
          datasheet: null, review: 'unreviewed', author: AUTHOR, editedAt: nowIso(), derivedFrom: null });
      } }, 'Tạo thiết bị từ đầu')),
      ...filterComponents(all, filter).map(card),
      h('button', { onClick: () => (project ? projectScreen() : home()) }, 'Quay lại'));
  }

  function formScreen(base: Omit<Component, 'revision'>) {
    show(componentForm(base, async ({ draft }) => {
      const r = await repo.saveComponent({ ...draft, editedAt: nowIso(), author: AUTHOR });
      say(r.created ? `Đã lưu ${draft.name} (revision ${r.ref.revision}).` : `Nội dung kỹ thuật không đổi, giữ revision ${r.ref.revision}.`);
      catalogScreen();
    }, () => catalogScreen()));
  }

  await reload();
  home();
}
