import { movePanels } from '../domain/layout-edit';
import type { Project } from '../domain/types';
import { buildSceneModel, type SceneModel } from '../scene/model';
import { ALL_LAYERS, createThreeView, WebGLUnavailable, type Layers, type Overlay, type ViewApi } from '../scene/three-view';
import { h } from './dom';

export interface ViewportHost { project(): Project; selection(): string[]; setSelection(ids: string[]): void; apply(next: Project): Promise<void> }
export interface Viewport { el: HTMLElement; refresh(): void; setOverlay(o: Overlay): void; dispose(): void }

/**
 * The workspace's one 3D view. It lives as long as the workspace: changing step or tab never rebuilds the canvas,
 * and selecting or dragging a panel works the same whichever step is open.
 */
export function createViewport(host: ViewportHost): Viewport {
  let api: ViewApi | null = null, disposed = false, layers: Layers = ALL_LAYERS, overlay: Overlay = { sun: null, heat: null };
  let drawn: { project: Project; sel: string; model: SceneModel } | null = null; // what the canvas shows now

  const draw = () => {
    if (!api) return;
    const project = host.project(), ids = host.selection(), model = buildSceneModel(project);
    api.update(model, new Set(ids.filter((id) => model.panels.some((x) => x.instanceId === id))), layers);
    drawn = { project, sel: ids.join(','), model };
  };
  const why = h('span', {});
  const fallback = h('div', { id: 'webgl-fallback', role: 'status', hidden: true },
    h('p', {}, 'Không dùng được 3D (', why, '). Mặt bằng 2D, các bảng và danh sách tấm vẫn đầy đủ; bạn có thể tiếp tục đặt, sửa tấm và xem bóng như bình thường.'));
  const canvasHost = h('div', {});
  const fpsOut = h('span', { id: 'fps-result' });
  const btn = (id: string, label: string, f: () => void) => h('button', { id, type: 'button', onClick: f }, label);
  const layerBox = (key: keyof Layers, label: string) => {
    const b = h('input', { type: 'checkbox', id: `layer-${key}`, checked: layers[key] });
    b.addEventListener('change', () => { layers = { ...layers, [key]: b.checked }; draw(); });
    return h('label', {}, b, ` ${label}`);
  };
  const box = h('div', { id: 'view3d-box' }, canvasHost, h('div', { className: 'view-tools' },
    btn('cam-overview', 'Tổng quan', () => api?.setCamera('overview')), btn('cam-top', 'Từ trên xuống', () => api?.setCamera('top')),
    btn('measure-fps', 'Đo FPS (4 giây)', async () => {
      if (!api || !drawn) { fpsOut.textContent = '3D chưa sẵn sàng'; return; }
      const m = drawn.model, f = await api.fps(4000);
      fpsOut.textContent = `${f.toFixed(0)} FPS (${m.panels.length} tấm, ${m.obstacles.length} vật cản)`;
    }), fpsOut,
    layerBox('roof', 'Mái'), layerBox('frame', 'Khung'), layerBox('panels', 'Tấm'), layerBox('wires', 'Đường nối'), layerBox('labels', 'Nhãn')));
  /** WebGL failed or was lost: the notice replaces the 3D block; every screen keeps its 2D plan and tables. */
  const fail = (m: string) => { api?.dispose(); api = null; why.textContent = m; fallback.hidden = false; box.hidden = true; };

  createThreeView(canvasHost, {
    onSelect: (ids, mode) => { const s = host.selection(); host.setSelection(mode === 'toggle' ? (s.includes(ids[0]) ? s.filter((x) => x !== ids[0]) : [...s, ids[0]]) : ids); },
    onMove: (ids, d) => { void host.apply(movePanels(host.project(), ids, d, { snap: true })); },
    onClear: () => host.setSelection([]),
    onContextLost: () => fail('Mất ngữ cảnh WebGL'),
  }, matchMedia('(max-width: 719px)').matches ? 300 : 440)
    .then((v) => { if (disposed) return v.dispose(); api = v; v.setOverlay(overlay); draw(); })
    .catch((e) => { if (!disposed) fail(e instanceof WebGLUnavailable ? e.message : String(e)); });

  return {
    el: h('section', { id: 'ws-view', 'aria-label': 'Khung nhìn' }, fallback, box),
    refresh() {
      const d = drawn, ids = host.selection().join(',');
      if (!d || d.project !== host.project() || d.sel !== ids) draw(); // same project and selection: nothing to redraw
    },
    setOverlay(o) { overlay = o; api?.setOverlay(o); },
    dispose() { disposed = true; api?.dispose(); api = null; },
  };
}
