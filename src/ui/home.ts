import { findComponent } from '../catalog/catalog';
import { buildQuote } from '../cost/quote';
import type { Project } from '../domain/types';
import { deleteBackup, exportAll, listBackups, restoreBackup } from '../persistence/backup';
import { isQuotaError, storageEstimate } from '../persistence/import';
import type { ProjectHead, ProjectRepository } from '../persistence/repository';
import { download, h } from './dom';
import { formatRoute } from './route';

export interface HomeCard { projectId: string; name: string; panels: number; kWp: number; knownMinor: string; updatedAt: string }
interface HomeCtx { repo: ProjectRepository; say(m: string): void; message(): string; importFile(f: File): Promise<void>; openLamHa(): Promise<void> }

export function cardOf(head: ProjectHead, p: Project): HomeCard {
  const panels = p.instances.filter((i) => i.kind === 'panel');
  const w = panels.reduce((a, i) => a + ((i.componentRef && findComponent(p.snapshots.components, i.componentRef)?.specs.pstcW?.v) || 0), 0);
  return { projectId: head.projectId, name: head.name, panels: panels.length, kWp: w / 1000, knownMinor: buildQuote(p).knownSubtotalMinor, updatedAt: head.updatedAt };
}

const cardLine = (c: HomeCard) =>
  `${c.panels} tấm · ${c.kWp.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} kWp · ${Number(c.knownMinor).toLocaleString('vi-VN')} đ đã biết · sửa ${new Date(c.updatedAt).toLocaleDateString('vi-VN')}`;

/** The home page: three entries of the same size, the saved projects as cards, the samples, help. One root, repainted in place. */
export async function renderHome(ctx: HomeCtx): Promise<Node[]> {
  const { repo, say } = ctx;
  const heads = await repo.listProjects(), backups = await listBackups();
  const saved = await Promise.all(heads.map(async (head) => ({ head, p: await repo.loadRevision(head.projectId) })));
  const again = async () => { const [next] = await renderHome(ctx); if (el.isConnected) el.replaceWith(next!); };
  const go = (hash: string) => () => { say(''); location.hash = hash; };

  const file = h('input', { type: 'file', accept: 'application/json,.json', id: 'import-file' });
  file.addEventListener('change', () => { const f = file.files?.[0]; if (f) void ctx.importFile(f); });
  const note = h('p', { id: 'storage-note' });
  void storageEstimate().then((e) => { if (e) note.textContent = `Bộ nhớ trình duyệt: đã dùng ${(e.usage / 1e6).toFixed(1)} MB trên ${(e.quota / 1e6).toFixed(0)} MB.`; });

  const el = h('div', { id: 'home' },
    ctx.message() && h('p', { role: 'status', id: 'status' }, ctx.message()),
    h('div', { id: 'entries' },
      h('button', { id: 'entry-sample', className: 'entry', type: 'button', onClick: go(formatRoute({ kind: 'preview', what: 'mau' })) },
        h('strong', {}, 'Khám phá Nhà mẫu'), h('span', {}, 'Một hệ thống hoàn chỉnh để bấm vào và đổi thử. Chỉ lưu khi bạn sửa.')),
      h('button', { id: 'entry-new', className: 'entry', type: 'button', onClick: go(formatRoute({ kind: 'preview', what: 'moi' })) },
        h('strong', {}, 'Bắt đầu từ số 0'), h('span', {}, 'Dự án trống, làm từng bước. Chỉ lưu khi bạn sửa.')),
      h('section', { id: 'entry-open', className: 'entry', 'aria-labelledby': 'entry-open-h' },
        h('h2', { id: 'entry-open-h' }, 'Mở / nhập'),
        h('label', {}, 'Nhập file dự án, gói hoặc bản sao lưu (JSON) ', file), note,
        h('button', { id: 'export-all', type: 'button', onClick: async () => { download('mekoniq-tat-ca-du-an.json', await exportAll(repo)); } }, 'Xuất tất cả dự án (sao lưu)'),
        ...backups.map((b) => h('p', { className: 'backup', 'data-backup': b.name }, `Có bản sao lưu tự động trước khi nâng cấp kho từ v${b.fromVersion}. `,
          h('button', { className: 'restore-backup', type: 'button', onClick: async (ev: Event) => {
            (ev.currentTarget as HTMLButtonElement).disabled = true; // a second click while it runs would race the first
            try { const r = await restoreBackup(repo, b.name); say(`Đã khôi phục ${r.restored} dự án (bản mới nhất của từng dự án, không kèm lịch sử revision; bản sao lưu vẫn giữ nguyên)${r.copies ? `; ${r.copies} dự án trùng ID được khôi phục thành bản sao` : ''}${r.skipped ? `; ${r.skipped} dự án đã có sẵn, bỏ qua` : ''}.`); }
            catch (e) { say((e as Error)?.name === 'BackupGone' ? (e as Error).message : `${isQuotaError(e) ? 'Hết dung lượng.' : 'Lỗi lưu trữ.'} Khôi phục dở: ${(e as Error)?.message}. Bản sao lưu vẫn còn nguyên; bấm "Khôi phục" lần nữa sẽ chỉ thêm phần còn thiếu.`); }
            await again();
          } }, 'Khôi phục'),
          h('button', { className: 'delete-backup', type: 'button', onClick: async () => { await deleteBackup(b.name); await again(); } }, 'Xóa bản sao lưu'))))),
    h('h2', {}, 'Dự án đã lưu'),
    saved.length ? h('ul', { id: 'saved' }, ...saved.map(({ head, p }) => h('li', {},
      h('button', { type: 'button', onClick: go(formatRoute({ kind: 'project', projectId: head.projectId, step: 'bo-tri', tab: 'mai' })) }, `Mở: ${head.name}`),
      p && h('p', {}, cardLine(cardOf(head, p)))))) : h('p', { id: 'saved' }, 'Chưa có dự án.'),
    h('h2', {}, 'Mẫu'),
    h('p', {}, h('button', { type: 'button', onClick: () => { void ctx.openLamHa(); } }, 'Mở mẫu Lâm Hà'), ' Bài toán gốc; mở là lưu ngay thành một dự án.'),
    h('p', {},
      h('button', { id: 'about-btn', type: 'button', onClick: () => { location.hash = formatRoute({ kind: 'help', page: 'phien-ban' }); } }, 'Phiên bản và phạm vi kiểm chứng'),
      h('button', { id: 'lessons-home-btn', type: 'button', onClick: () => { location.hash = formatRoute({ kind: 'help', page: 'bai-hoc' }); } }, 'Bài học')));
  return [el];
}
