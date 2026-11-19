import { lineChart } from '../diagrams/charts';
import { LESSONS, lessonById, termsOf, type Lesson, type LessonId, type Measure, type Mode, type Verdict } from '../lessons/lessons';
import type { Project } from '../domain/types';
import { h } from './dom';

/** Everything a lesson remembers lives here, in memory. A lesson works on its own copy and never writes a project. */
export interface LessonState {
  mode: Mode; id: LessonId | null; work: Project | null; before: Measure | null; after: Measure | null;
  answer: string | null; verdict: Verdict | null; busy: boolean; error: string | null; showTables: boolean;
}
export const freshLessons = (): LessonState => ({ mode: 'basic', id: null, work: null, before: null, after: null, answer: null, verdict: null, busy: false, error: null, showTables: false });
export interface LessonCtx { state: LessonState; rerender(): void; back(): void; backLabel: string }

const table = (head: string[], rows: string[][], id?: string) =>
  h('table', { id }, h('thead', {}, h('tr', {}, ...head.map((t) => h('th', { scope: 'col' }, t)))), h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, c) : h('td', {}, c)))))));

async function start(ctx: LessonCtx, l: Lesson) {
  const s = ctx.state;
  Object.assign(s, { id: l.id, work: null, before: null, after: null, answer: null, verdict: null, busy: true, error: null });
  ctx.rerender();
  try { s.work = await l.fixture(); s.before = await l.measure(s.work); } catch (e) { s.error = (e as Error).message; }
  s.busy = false;
  ctx.rerender();
}

export function renderLessons(ctx: LessonCtx): Node[] {
  const s = ctx.state, lesson = s.id ? lessonById(s.id) : undefined;
  const head = [
    h('h2', {}, 'Bài học'), h('button', { id: 'ls-back', onClick: ctx.back }, ctx.backLabel),
    h('p', {}, 'Mỗi bài dùng một bản sao riêng của dự án mẫu; làm hỏng gì cũng không ảnh hưởng dự án đã lưu. Bài không dùng chuyển động: mọi số liệu đều có trong bảng.'),
    h('fieldset', {}, h('legend', {}, 'Mức giải thích'),
      ...(['basic', 'engineer'] as const).map((m) => h('label', {}, h('input', { type: 'radio', name: 'ls-mode', id: `ls-mode-${m}`, checked: s.mode === m, onChange: () => { s.mode = m; ctx.rerender(); } }), m === 'basic' ? ' Cơ bản (ngôn ngữ đời thường)' : ' Kỹ sư (công thức, nguồn, mã đầu vào)'))),
    h('ul', { id: 'ls-list' }, ...LESSONS.map((l) => h('li', { 'data-lesson': l.id }, h('button', { id: `ls-start-${l.id}`, 'aria-pressed': String(s.id === l.id), onClick: () => void start(ctx, l) }, l.title), ' ', l.goal))),
  ];
  if (!lesson) return head;
  if (s.busy && !s.before) return [...head, h('p', { id: 'ls-busy', role: 'status' }, 'Đang đo bằng engine…')];
  if (s.error) return [...head, h('p', { id: 'ls-error', role: 'alert' }, `Không chạy được bài: ${s.error}`), h('button', { onClick: () => void start(ctx, lesson) }, 'Thử lại')];
  const before = s.before!, after = s.after;

  const readings = (m: Measure) => table(['Chỉ số', 'Giá trị', 'Ghi chú'], m.readings.map((r) => [r.label, r.value, r.note ?? '']));
  const q = lesson.question;
  const input = q.kind === 'choice'
    ? h('div', { role: 'radiogroup', 'aria-label': 'Dự đoán' }, ...q.options!.map((o) => h('label', {}, h('input', { type: 'radio', name: 'ls-pick', value: o.id, checked: s.answer === o.id, disabled: !!s.answer }), ` ${o.label} `)))
    : h('label', {}, 'Dự đoán của bạn ', h('input', { id: 'ls-answer', inputMode: 'decimal', value: s.answer ?? '', disabled: !!s.answer, size: 8 }), ` ${q.unit ?? ''}`);
  const commit = h('button', { id: 'ls-commit', disabled: !!s.answer }, 'Chốt dự đoán');
  commit.addEventListener('click', () => {
    const v = q.kind === 'choice' ? document.querySelector<HTMLInputElement>('input[name="ls-pick"]:checked')?.value : (document.getElementById('ls-answer') as HTMLInputElement | null)?.value.trim();
    if (!v) { document.getElementById('ls-hint')!.textContent = 'Hãy nhập hoặc chọn một dự đoán trước.'; return; }
    s.answer = v; ctx.rerender();
  });
  const act = h('button', { id: 'ls-act', disabled: !s.answer || !!after || s.busy }, lesson.actionLabel);
  act.addEventListener('click', async () => {
    s.busy = true; ctx.rerender();
    try { const next = lesson.apply(s.work!); s.work = next; s.after = await lesson.measure(next); s.verdict = lesson.check(s.answer!, before, s.after); } catch (e) { s.error = (e as Error).message; }
    s.busy = false; ctx.rerender();
  });
  const reset = h('button', { id: 'ls-reset', onClick: () => void start(ctx, lesson) }, 'Làm lại bài (bản sao mới)');

  const out: (Node | null)[] = [...head,
    h('section', { 'aria-label': lesson.title }, h('h3', {}, lesson.title), h('p', {}, lesson.goal),
      h('h4', {}, 'Bước 1 · Trạng thái ban đầu'), h('div', { id: 'ls-before' }, readings(before)),
      h('h4', {}, 'Bước 2 · Dự đoán trước'), h('p', { id: 'ls-question' }, q.text), input, commit, h('span', { id: 'ls-hint', role: 'status' }),
      h('h4', {}, 'Bước 3 · Thay đổi'), act, ' ', reset,
    ),
  ];
  if (after && s.verdict) {
    out.push(h('section', { id: 'ls-result', 'aria-label': 'Kết quả' },
      h('h4', {}, 'Bước 4 · Kết quả đo được'),
      h('p', { id: 'ls-verdict', 'data-correct': String(s.verdict.correct) }, s.verdict.correct ? `Dự đoán đúng. Đáp án: ${s.verdict.truth}.` : `Chưa đúng. Bạn dự đoán ${s.answer}; đo được ${s.verdict.truth}. Đó là chỗ để học, không phải lỗi.`),
      table(['Chỉ số', 'Trước', 'Sau'], before.readings.map((r, i) => [r.label, r.value, after.readings[i]?.value ?? '—']), 'ls-compare'),
      h('h4', {}, 'Vì sao?'), h('ul', { id: 'ls-explain' }, ...lesson.explain(before, after, s.mode).map((t) => h('li', {}, t))),
      before.series && after.series ? h('div', {}, lineChart(before.series.xs, [{ name: before.series.name, values: before.series.values, dash: '', color: '#2874a6' }, { name: after.series.name, values: after.series.values, dash: '6 4', color: '#c0392b' }], { yLabel: before.series.yLabel, xLabel: before.series.xLabel, label: 'So sánh SoC trước và sau khi đổi giờ bơm' })) : null,
      h('details', { id: 'ls-tables', open: s.showTables, onToggle: (e: Event) => { s.showTables = (e.target as HTMLDetailsElement).open; } }, h('summary', {}, 'Xem bảng số (thay cho hình)'),
        before.table ? h('div', {}, h('h5', {}, 'Trước'), table(before.table.head, before.table.rows)) : null, after.table ? h('div', {}, h('h5', {}, 'Sau'), table(after.table.head, after.table.rows)) : null),
      s.mode === 'engineer' ? h('div', { id: 'ls-engineer' }, h('h4', {}, 'Chi tiết kỹ sư'), h('ul', {}, ...[...before.engineer, ...after.engineer.slice(0, 2).map((x) => `(sau) ${x}`)].map((t) => h('li', {}, t)))) : null));
  }
  out.push(h('section', { 'aria-label': 'Thuật ngữ' }, h('h4', {}, 'Thuật ngữ trong bài'),
    ...termsOf(lesson).map((t) => h('details', { 'data-term': t.id }, h('summary', {}, t.term), h('p', {}, t.basic), s.mode === 'engineer' ? h('p', {}, t.engineer) : null))));
  return out.filter(Boolean) as Node[];
}
