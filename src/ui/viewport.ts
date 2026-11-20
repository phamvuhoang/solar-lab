import { renderDiagram } from '../diagrams/editor';
import { renderFacePlan, type PlanHandlers } from '../diagrams/roof-plan';
import { movePanels, removePlacements, rotate90 } from '../domain/layout-edit';
import type { Project } from '../domain/types';
import type { SimResult } from '../engine/system';
import { flowsAt } from '../scene/flows';
import { buildSceneModel, type SceneModel } from '../scene/model';
import { ALL_LAYERS, createThreeView, WebGLUnavailable, type Layers, type Overlay, type ViewApi } from '../scene/three-view';
import { sunVector } from '../shade/geometry';
import { validateDesign } from '../validation/strings';
import { h } from './dom';

export type ViewMode = '3d' | 'diagram' | 'plan';
export interface ViewportHost {
  project(): Project; selection(): string[]; setSelection(ids: string[]): void; apply(next: Project): Promise<void>;
  /** The diagram's selected object (string, device or port id) and picking one there. */
  selected(): string | null; select(id: string): void;
  /** The Delete key on the 3D view with a device (any non-panel item) selected: preview removing what is selected. */
  remove(): void;
  /** The run of the current design that the system screen's replay shows. */
  replay(): SimResult | null;
}
/** setReplay: the replay's time cursor (null = off) sets the sun and the power on each wire, with the numbers as text under the view. */
export interface Viewport { el: HTMLElement; refresh(): void; setOverlay(o: Overlay): void; setReplay(step: number | null): void; setMode(m: ViewMode): void; dispose(): void }

let chosen: ViewMode | null = null; // the mode the person picked: kept for the session, across projects

/**
 * The workspace's one view: 3D, the electrical diagram or the roof plan. It lives as long as the workspace: changing step or tab
 * never rebuilds the canvas, and selecting or moving a panel works the same whichever step is open. While Three.js loads, or when
 * WebGL is unavailable, the plan (the diagram if there is no roof yet) is shown instead of 3D.
 */
export function createViewport(host: ViewportHost): Viewport {
  let api: ViewApi | null = null, disposed = false, layers: Layers = ALL_LAYERS, overlay: Overlay = { sun: null, heat: null };
  let drawn: { project: Project; key: string; model: SceneModel } | null = null; // what the view shows now
  let replayStep: number | null = null;

  const shown = (): ViewMode => (chosen && (chosen !== '3d' || api) ? chosen : api ? '3d' : host.project().roofFaces.length ? 'plan' : 'diagram');
  const key = () => `${shown()}|${host.selection().join(',')}|${host.selected() ?? ''}`;
  const pick = (ids: string[], mode: 'set' | 'toggle') => { const s = host.selection(); host.setSelection(mode === 'toggle' ? (s.includes(ids[0]) ? s.filter((x) => x !== ids[0]) : [...s, ids[0]]) : ids); };
  const plan: PlanHandlers = {
    onSelect: pick, onClear: () => host.setSelection([]),
    onMove: (ids, d, snap) => { void host.apply(movePanels(host.project(), ids, d, { snap })); },
    onRotate: (ids) => { void host.apply(rotate90(host.project(), ids)); },
    onRemove: (ids) => { void host.apply(removePlacements(host.project(), ids)); },
  };

  const why = h('span', {});
  const fallback = h('div', { id: 'webgl-fallback', role: 'status', hidden: true },
    h('p', {}, 'Không dùng được 3D (', why, '). Khung nhìn dùng Mặt bằng 2D và Sơ đồ; các bảng và danh sách tấm vẫn đầy đủ; bạn có thể tiếp tục đặt, sửa tấm và xem bóng như bình thường.'));
  const btn = (id: string, label: string, f: () => void) => h('button', { id, type: 'button', onClick: f }, label);
  const modes = { '3d': btn('view-mode-3d', '3D · đang tải', () => setMode('3d')), diagram: btn('view-mode-diagram', 'Sơ đồ', () => setMode('diagram')), plan: btn('view-mode-plan', 'Mặt bằng', () => setMode('plan')) };
  modes['3d'].disabled = true;
  const canvasHost = h('div', {});
  // Delete in 3D: only panels selected → off the roof, as in the plan (undo brings them back); a device too → the delete preview
  canvasHost.addEventListener('keydown', (e) => {
    const sel = host.selection(), p = host.project();
    if ((e.key !== 'Delete' && e.key !== 'Backspace') || !sel.length) return;
    e.preventDefault();
    if (sel.every((id) => p.instances.some((i) => i.instanceId === id && i.kind === 'panel'))) plan.onRemove(sel); else host.remove();
  });
  const fpsOut = h('span', { id: 'fps-result' });
  const layerBox = (k: keyof Layers, label: string) => {
    const b = h('input', { type: 'checkbox', id: `layer-${k}`, checked: layers[k] });
    b.addEventListener('change', () => { layers = { ...layers, [k]: b.checked }; draw(); });
    return h('label', {}, b, ` ${label}`);
  };
  const box3d = h('div', { id: 'view3d-box', hidden: true }, canvasHost, h('div', { className: 'view-tools' },
    btn('cam-overview', 'Tổng quan', () => api?.setCamera('overview')), btn('cam-top', 'Từ trên xuống', () => api?.setCamera('top')),
    btn('measure-fps', 'Đo FPS (4 giây)', async () => {
      if (!api || !drawn) { fpsOut.textContent = '3D chưa sẵn sàng'; return; }
      const m = drawn.model, f = await api.fps(4000);
      fpsOut.textContent = `${f.toFixed(0)} FPS (${m.panels.length} tấm, ${m.obstacles.length} vật cản)${m.devices.length ? ` · ${m.devices.length} thiết bị` : ''}`;
    }), fpsOut,
    layerBox('roof', 'Mái'), layerBox('frame', 'Khung'), layerBox('panels', 'Tấm'), layerBox('wires', 'Đường nối'), layerBox('labels', 'Nhãn')),
    h('p', { id: 'view-legend' }, 'Dây vẽ minh họa: — AC · - - DC từ tấm · ··· DC pin/bơm · khung nét đứt = kích thước minh họa'));
  const view2d = h('div', { id: 'view-2d' });
  const flowText = h('p', { id: 'view-flows', hidden: true });
  /** Flows follow the model drawn now (wires move with devices); the text shows in every mode, also without WebGL. */
  const paintFlows = () => {
    const r = replayStep === null ? null : host.replay(), at = r && drawn ? flowsAt(drawn.model, r, replayStep!) : null;
    api?.setFlows(at?.flows ?? []);
    flowText.hidden = !at; flowText.textContent = at ? `Bước đang phát lại: ${at.text.join(' · ')}` : '';
  };

  /** Draws the shown mode; the 3D scene is kept current even behind a 2D mode, so switching back is instant. */
  function draw() {
    const project = host.project(), findings = validateDesign(project), model = buildSceneModel(project, findings), mode = shown(), sel = host.selection();
    for (const [m, b] of Object.entries(modes)) b.setAttribute('aria-pressed', String(m === mode));
    box3d.hidden = mode !== '3d'; view2d.hidden = mode === '3d';
    const drawnIds = new Set([...model.panels, ...model.devices].map((x) => x.instanceId));
    api?.update(model, new Set(sel.filter((id) => drawnIds.has(id))), layers);
    if (mode !== '3d') {
      const a = document.activeElement, focused = a instanceof Element && view2d.contains(a) ? a.getAttribute('data-id') : null;
      view2d.replaceChildren(...(mode === 'diagram' ? [renderDiagram(project, findings, host.selected(), host.select)]
        : project.roofFaces.length ? project.roofFaces.map((f) => renderFacePlan(project, f, model, new Set(sel), plan))
          : [h('p', {}, 'Chưa có mặt mái để vẽ mặt bằng. Thêm mặt mái ở bước Bố trí.')]));
      if (focused) view2d.querySelector<SVGElement>(`[data-id="${CSS.escape(focused)}"]`)?.focus(); // keyboard nudges keep their place
    } else view2d.replaceChildren();
    drawn = { project, key: key(), model };
    if (replayStep !== null) paintFlows();
  }
  function setMode(m: ViewMode) { chosen = m; draw(); }
  /** WebGL failed or was lost: the 3D button is off and the view stays 2D; every screen keeps its tables. */
  const fail = (m: string) => { api?.dispose(); api = null; why.textContent = m; fallback.hidden = false; modes['3d'].textContent = '3D'; modes['3d'].disabled = true; draw(); };

  createThreeView(canvasHost, {
    onSelect: pick,
    onMove: (ids, d) => { void host.apply(movePanels(host.project(), ids, d, { snap: true })); },
    onClear: () => host.setSelection([]),
    onContextLost: () => fail('Mất ngữ cảnh WebGL'),
  }, matchMedia('(max-width: 719px)').matches ? 300 : 440)
    .then((v) => {
      if (disposed) return v.dispose();
      api = v; v.setOverlay(overlay);
      modes['3d'].textContent = '3D'; modes['3d'].disabled = false;
      draw();
    })
    .catch((e) => { if (!disposed) fail(e instanceof WebGLUnavailable ? e.message : String(e)); });

  const el = h('section', { id: 'ws-view', 'aria-label': 'Khung nhìn' },
    h('div', { className: 'view-modes', role: 'group', 'aria-label': 'Chế độ khung nhìn' }, modes['3d'], modes.diagram, modes.plan), fallback, box3d, view2d, flowText);
  return {
    el,
    refresh() {
      if (disposed) return;
      if (!drawn || drawn.project !== host.project() || drawn.key !== key()) draw(); // same project, selection and mode: nothing to redraw
    },
    setOverlay(o) { overlay = o; api?.setOverlay(o); },
    setReplay(step) {
      if (step === null && replayStep === null) return;
      replayStep = step;
      const r = step === null ? null : host.replay(), sv = r ? sunVector(r.pv.series.azimuthDeg[step!], r.pv.series.zenithDeg[step!]) : null; // the engine's own sun for that step
      overlay = { sun: sv && { e: sv[0], n: sv[1], up: sv[2] }, heat: null }; api?.setOverlay(overlay);
      paintFlows();
    },
    setMode,
    dispose() { disposed = true; api?.dispose(); api = null; },
  };
}
