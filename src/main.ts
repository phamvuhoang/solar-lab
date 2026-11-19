import { registerOffline } from './offline/register';
import { explainStartupError } from './persistence/backup';
import { startApp } from './ui/app';

document.getElementById('build-id')!.textContent = __BUILD_ID__;
startApp(document.getElementById('app')!).catch((e) => {
  document.getElementById('app')!.textContent = explainStartupError(e);
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
