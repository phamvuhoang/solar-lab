import { buildQuote } from '../cost/quote';
import { unplacedPanels } from '../domain/layout-edit';
import { stringsOf } from '../domain/graph';
import type { Project } from '../domain/types';
import type { Target } from '../ui/route';
import { validateDesign } from '../validation/strings';

export type ProgressId = 'noi-lap' | 'mai' | 'dat-tam' | 'inverter' | 'pin' | 'tai' | 'loi-do' | 'chay-thu' | 'gia';
export interface ProgressItem { id: ProgressId; n: number; label: string; status: 'done' | 'todo' | 'optional'; action: Target & { label: string } }

export function progressOf(p: Project, o: { simRan: boolean }): ProgressItem[] {
  const has = (k: string) => p.instances.some((i) => i.kind === k);
  const planned = new Set((p.loadPlans ?? []).map((l) => l.instanceId));
  const loads = p.instances.filter((i) => i.kind === 'load');
  const hasPanels = has('panel');
  const t = (step: Target['step'], tab: Target['tab'], label: string, focusId?: string) => ({ step, tab, label, ...(focusId ? { focusId } : {}) });
  const row = (id: ProgressId, label: string, done: boolean, action: ProgressItem['action'], notDone: 'todo' | 'optional' = 'todo') =>
    ({ id, label, status: done ? 'done' : notDone, action } as Omit<ProgressItem, 'n'>);
  const rows = [
    row('noi-lap', 'Chọn nơi lắp', p.location !== null && !!p.pv?.weatherId, t('chay-thu', 'pv', 'Chọn nơi lắp', 'loc-lat')),
    row('mai', 'Dựng mặt mái', p.roofFaces.length > 0, t('bo-tri', 'mai', 'Dựng mặt mái', 'add-rect')),
    row('dat-tam', 'Đặt tấm lên mái', hasPanels && unplacedPanels(p).length === 0,
      hasPanels ? t('bo-tri', 'mai', 'Đặt tấm', 'fill-face') : t('dau-noi', 'thiet-ke', 'Thêm tấm', 'add-panel')),
    row('inverter', 'Chọn inverter', has('inverter'), t('dau-noi', 'thiet-ke', 'Chọn inverter', 'add-inverter')),
    row('pin', 'Thêm pin (bỏ qua được)', has('battery'), t('dau-noi', 'thiet-ke', 'Thêm pin (bỏ qua được)', 'add-battery'), 'optional'),
    row('tai', 'Thêm tải và lịch chạy', loads.some((l) => planned.has(l.instanceId)),
      loads.length ? t('chay-thu', 'he-thong', 'Đặt lịch tải') : t('dau-noi', 'thiet-ke', 'Thêm tải', 'add-load')),
    row('loi-do', 'Nối chuỗi và sửa lỗi đỏ',
      stringsOf(p).some((s) => s.target !== null) && !validateDesign(p).some((f) => f.status === 'fail' && f.severity === 'error'),
      t('dau-noi', 'thiet-ke', 'Sửa lỗi đỏ', 'findings')),
    row('chay-thu', 'Chạy thử', o.simRan, t('chay-thu', 'he-thong', 'Chạy thử', 'sim-run')),
    row('gia', 'Nhập giá', buildQuote(p).complete, t('chi-phi', 'du-toan', 'Nhập giá còn thiếu')),
  ];
  return rows.map((r, i) => ({ ...r, n: i + 1 }));
}

export const progressComplete = (items: ProgressItem[]) => !items.some((i) => i.status === 'todo');
