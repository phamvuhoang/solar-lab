import { h } from './dom';

export const COACH_KEY = 'solar-lab:coach-v1';

const NOTES = [
  ['view', 'Đây là một hệ thống điện mặt trời hoàn chỉnh: mái, 8 tấm pin, inverter, pin lưu trữ, tải và lưới. Tất cả là mẫu minh họa, không phải báo giá.'],
  ['panel', 'Bấm vào một món trên hình hoặc trong danh sách để xem nó là gì và đổi nó.'],
  ['health', 'Sau mỗi lần sửa, nhìn thanh dưới cùng: lỗi điện, sản lượng, giờ thiếu điện và tiền thay đổi thế nào.'],
] as const;

/**
 * Three callouts, one after the other, for the first look at the sample house; "Bỏ qua" or "Xong" ends them for good.
 * Storage that cannot be read counts as not seen and is never written.
 * Each callout goes in just before what it is about, so it follows the layout: on a phone it sits in the flow and covers
 * nothing; from 720 px the stylesheet lifts it onto the top of the view or panel, or just above the health bar.
 */
export function startCoach(anchors: { view: HTMLElement; panel: HTMLElement; health: HTMLElement }): void {
  let writable = true;
  try { if (localStorage.getItem(COACH_KEY) !== null) return; } catch { writable = false; }
  let i = 0;
  const text = h('p', { id: 'coach-text', 'aria-live': 'polite' });
  const next = h('button', { id: 'coach-next', type: 'button' });
  const skip = h('button', { id: 'coach-skip', type: 'button' }, 'Bỏ qua');
  const box = h('div', { id: 'coach', role: 'dialog', 'aria-label': 'Chú thích', 'aria-describedby': 'coach-text' }, text, next, skip);
  const paint = () => {
    const [at, t] = NOTES[i];
    box.dataset.at = at; text.textContent = t; next.textContent = i === NOTES.length - 1 ? 'Xong' : 'Tiếp';
    // the health bar is rebuilt on every edit: the one on screen now
    const anchor = at === 'health' ? (document.getElementById('ws-health') ?? anchors.health) : anchors[at];
    anchor.before(box);
    box.scrollIntoView({ block: 'nearest' });
  };
  const end = () => {
    box.remove();
    if (writable) try { localStorage.setItem(COACH_KEY, '1'); } catch { /* not remembered: it shows again next time */ }
  };
  next.addEventListener('click', () => { if (++i < NOTES.length) { paint(); next.focus(); } else end(); });
  skip.addEventListener('click', end);
  paint();
}
