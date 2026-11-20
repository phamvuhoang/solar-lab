import './ui/styles.css';
import { registerOffline } from './offline/register';
import { explainStartupError, exportUnopenable } from './persistence/backup';
import { startApp } from './ui/app';
import { applyDepth, readDepth } from './ui/depth';
import { download, h } from './ui/dom';

document.getElementById('build-id')!.textContent = __BUILD_ID__;
applyDepth(readDepth()); // before anything is drawn, so detail hidden at this depth never flashes
startApp(document.getElementById('app')!).catch((e) => {
  const app = document.getElementById('app')!;
  app.replaceChildren(h('p', {}, explainStartupError(e)));
  // data from a newer build: this one cannot open it for writing, but it can read it as it is and hand the user a copy
  if ((e as { name?: string })?.name === 'VersionError')
    app.append(h('button', { onClick: async () => download('mekoniq-tat-ca-du-an.json', await exportUnopenable()) }, 'Xuất dữ liệu ra file (chỉ đọc, không sửa gì)'));
});
// a storage or runtime failure outside a handler must not vanish silently
window.addEventListener('unhandledrejection', (ev) => {
  const app = document.getElementById('app');
  if (!app || document.getElementById('fatal')) return;
  const p = document.createElement('p'); p.id = 'fatal'; p.setAttribute('role', 'alert');
  p.textContent = `Có lỗi không mong đợi: ${ev.reason instanceof Error ? ev.reason.message : String(ev.reason)}. Thay đổi gần nhất có thể chưa được lưu; hãy xuất dự án (JSON) rồi tải lại trang.`;
  app.prepend(p);
});
registerOffline(document.getElementById('offline-status'));
