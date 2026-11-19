import { registerOffline } from './offline/register';
import { startApp } from './ui/app';

document.getElementById('build-id')!.textContent = __BUILD_ID__;
startApp(document.getElementById('app')!).catch((e) => {
  document.getElementById('app')!.textContent = `Không mở được kho lưu trữ cục bộ: ${e instanceof Error ? e.message : e}`;
});
registerOffline(document.getElementById('offline-status'));
