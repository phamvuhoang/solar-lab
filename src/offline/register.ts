/**
 * Registers the offline service worker (production build only) and reports its state in #offline-status.
 * states: unsupported · installing · ready (every file cached, works offline) · update-available · update-failed · error
 * An update never reloads the page by itself: the user presses "Cập nhật" (drafts are already saved, every edit is a stored revision).
 */
export type OfflineState = 'unsupported' | 'installing' | 'ready' | 'update-available' | 'update-failed' | 'error';
const TEXT: Record<OfflineState, string> = {
  unsupported: 'Trình duyệt này không hỗ trợ dùng ngoại tuyến.',
  installing: 'Đang tải ứng dụng để dùng ngoại tuyến…',
  ready: 'Dùng ngoại tuyến: sẵn sàng.',
  'update-available': 'Có bản mới.',
  'update-failed': 'Bản cập nhật chưa tải đủ file nên chưa dùng; vẫn đang chạy bản cũ nguyên vẹn. Sẽ thử lại lần mở sau.',
  error: 'Không bật được chế độ ngoại tuyến.',
};

export function registerOffline(host: HTMLElement | null, opts: { url?: string; enabled?: boolean } = {}): void {
  const show = (s: OfflineState, extra?: Node) => {
    if (!host) return;
    host.dataset.state = s;
    host.replaceChildren(TEXT[s], ...(extra ? [' ', extra] : []));
  };
  if (!('serviceWorker' in navigator)) return show('unsupported');
  if (!(opts.enabled ?? import.meta.env.PROD)) return;
  const sw = navigator.serviceWorker;
  // Reload only when the user asked for an update. The first install claims the page too (controllerchange), and that must not reload it.
  let updating = false;
  sw.addEventListener('controllerchange', () => { if (updating) location.reload(); });

  const offerUpdate = (w: ServiceWorker) => {
    const b = document.createElement('button');
    b.id = 'offline-update'; b.type = 'button'; b.textContent = 'Cập nhật';
    b.onclick = () => { b.disabled = true; updating = true; w.postMessage({ type: 'SKIP_WAITING' }); };
    show('update-available', b);
  };
  const watch = (reg: ServiceWorkerRegistration, w: ServiceWorker) => {
    w.addEventListener('statechange', () => {
      if (w.state === 'installed') { if (sw.controller) offerUpdate(w); else show('ready'); }
      if (w.state === 'activated' && !sw.controller) show('ready');
      if (w.state === 'redundant') show(reg.active ? 'update-failed' : 'error');
    });
  };
  sw.register(opts.url ?? './sw.js').then((reg) => {
    if (reg.waiting && sw.controller) offerUpdate(reg.waiting);
    else if (reg.active && !reg.installing) show('ready');
    else if (reg.installing) { show('installing'); watch(reg, reg.installing); }
    reg.addEventListener('updatefound', () => { if (reg.installing) watch(reg, reg.installing); });
  }).catch(() => show('error'));
}
