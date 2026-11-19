import { bomOf, createProject, openLamHa, type DraftProject } from './domain/project';

const vnd = (minor: string) => Number(minor).toLocaleString('vi-VN') + ' đ';

function render(app: HTMLElement, project: DraftProject | null) {
  app.replaceChildren();
  const h1 = Object.assign(document.createElement('h1'), { textContent: 'Mekoniq Solar Lab' });
  app.append(h1);
  if (project) return renderDraft(app, project);

  const form = document.createElement('form');
  form.innerHTML = `
    <label>Tên dự án <input name="name" value="Dự án mới" required></label>
    <button type="submit">Tạo dự án</button>
    <button type="button" id="open-lamha">Mở mẫu Lâm Hà</button>`;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    render(app, createProject(String(new FormData(form).get('name'))));
  });
  form.querySelector('#open-lamha')!.addEventListener('click', () => render(app, openLamHa()));
  app.append(form);
}

function renderDraft(app: HTMLElement, p: DraftProject) {
  const bom = bomOf(p);
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'Bản thiết kế nháp');
  const h2 = Object.assign(document.createElement('h2'), { textContent: p.name });
  const status = Object.assign(document.createElement('p'), { textContent: 'Bản nháp' });
  const total = Object.assign(document.createElement('p'), {
    id: 'bom-total',
    textContent: p.lines.length
      ? `Tổng phần có giá: ${bom.totalMinor ? vnd(bom.totalMinor) : 'chưa đủ giá'}`
      : 'Chưa có linh kiện.',
  });
  const back = Object.assign(document.createElement('button'), { textContent: 'Quay lại' });
  back.addEventListener('click', () => render(app, null));
  section.append(h2, status, total, back);
  app.append(section);
}

const app = document.getElementById('app')!;
render(app, null);
document.getElementById('build-id')!.textContent = __BUILD_ID__;
