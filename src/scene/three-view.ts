import type { Group, Object3D, Sprite } from 'three';
import { enuToThree, type V3 } from '../domain/roof';
import type { SceneModel } from './model';

export interface Layers { roof: boolean; frame: boolean; panels: boolean; wires: boolean; labels: boolean }
export const ALL_LAYERS: Layers = { roof: true, frame: true, panels: true, wires: true, labels: true };
export const STRING_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#dc2626', '#4d7c0f', '#be185d'];
export const stringColor = (index: number) => (index > 0 ? STRING_COLORS[(index - 1) % STRING_COLORS.length] : '#64748b');

export interface ViewHandlers {
  onSelect(ids: string[], mode: 'set' | 'toggle'): void;
  /** Called when a drag of the selected panels ends: delta in the face frame (metres). */
  onMove(ids: string[], delta: [number, number]): void;
  onClear(): void;
  onContextLost(): void;
}
export interface ViewApi {
  canvas: HTMLCanvasElement;
  update(model: SceneModel, selection: ReadonlySet<string>, layers: Layers): void;
  setCamera(kind: 'overview' | 'top'): void;
  /** Frames per second while the camera orbits, measured over `ms`. */
  fps(ms: number): Promise<number>;
  dispose(): void;
}
export class WebGLUnavailable extends Error { constructor(why: string) { super(why); this.name = 'WebGLUnavailable'; } }

/**
 * Three.js scene, loaded only when the 3D tab opens. It draws a SceneModel and nothing else: it never creates instances or prices.
 * Coordinates arrive in ENU and are mapped to Three.js (x = East, y = Up, z = −North) at the very edge.
 */
export async function createThreeView(host: HTMLElement, handlers: ViewHandlers, height = 440): Promise<ViewApi> {
  let THREE: typeof import('three'), OrbitControls: typeof import('three/examples/jsm/controls/OrbitControls.js').OrbitControls;
  try {
    THREE = await import('three');
    ({ OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js'));
  } catch (e) { throw new WebGLUnavailable(`Không tải được Three.js: ${(e as Error).message}`); }

  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Mái nhà 3D. Dùng danh sách tấm bên dưới để chọn bằng bàn phím; phím mũi tên dịch camera.');
  canvas.style.cssText = `width:100%;height:${height}px;display:block;touch-action:none;border:1px solid #8886;border-radius:4px`;
  host.append(canvas);
  let renderer: InstanceType<typeof THREE.WebGLRenderer>;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
  catch (e) { canvas.remove(); throw new WebGLUnavailable((e as Error).message || 'WebGL không khả dụng'); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xf1f5f9);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(-8, 14, 10);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false; // render only on change: no idle GPU use, and no motion for reduced-motion users
  controls.listenToKeyEvents(canvas);
  const content: Group = new THREE.Group();
  scene.add(content);

  let model: SceneModel | null = null, selection: ReadonlySet<string> = new Set(), layers: Layers = ALL_LAYERS;
  let frame = 0, disposed = false, fitted = false;
  const need = () => { if (!frame && !disposed) frame = requestAnimationFrame(() => { frame = 0; renderer.render(scene, camera); }); };
  controls.addEventListener('change', need);

  const to3 = (p: V3) => { const [x, y, z] = enuToThree(p); return new THREE.Vector3(x, y, z); };
  const geometries: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(g: T): T => { geometries.push(g); return g; };
  const textSprite = (text: string, color: string, size: number): Sprite => {
    // width follows the text so long labels ("Bồn nước") are not clipped
    const c = document.createElement('canvas'), w = Math.max(128, Math.round(text.length * 26 + 40)); c.width = w; c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffffd9'; g.fillRect(0, 0, w, 64); g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, 58);
    g.fillStyle = '#111'; g.font = 'bold 38px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, 34);
    const tex = track(new THREE.CanvasTexture(c));
    const sp = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, depthTest: false })));
    sp.scale.set(size * (w / 128), size / 2, 1);
    return sp;
  };
  const panelMeshes = new Map<string, { mesh: Object3D; edges: Object3D }>();

  function rebuild() {
    for (const o of [...content.children]) content.remove(o);
    geometries.splice(0).forEach((g) => g.dispose());
    panelMeshes.clear();
    if (!model) return need();
    const m = model, r = m.bounds.radius;
    const ground = Math.min(m.bounds.min.up, 0);
    const grid = new THREE.GridHelper(Math.ceil(r * 5), Math.ceil(r * 5), 0x94a3b8, 0xcbd5e1);
    grid.position.set(m.bounds.center.e, ground - 0.01, -m.bounds.center.n);
    content.add(grid);
    // north arrow and E marker at the corner of the ground grid
    const base = new THREE.Vector3(m.bounds.min.e - 1, ground, -(m.bounds.max.n + 1));
    content.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), base, Math.max(2, r * 0.5), 0xdc2626, 0.4, 0.25));
    const nLabel = textSprite('Bắc', '#dc2626', Math.max(1.2, r * 0.25)); nLabel.position.set(base.x, base.y + 0.5, base.z - Math.max(2, r * 0.5) - 0.6); content.add(nLabel);

    if (layers.roof) {
      for (const f of m.faces) {
        const contour = f.outlineLocal.map(([a, b]) => new THREE.Vector2(a, b)), holes = f.holesLocal.map((h) => h.map(([a, b]) => new THREE.Vector2(a, b)));
        const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
        const verts = [...contour, ...holes.flat()];
        const pos: number[] = [];
        for (const v of verts) { const w = to3({ e: f.frame.origin.e + v.x * f.frame.u.e + v.y * f.frame.v.e, n: f.frame.origin.n + v.x * f.frame.u.n + v.y * f.frame.v.n, up: f.frame.origin.up + v.x * f.frame.u.up + v.y * f.frame.v.up }); pos.push(w.x, w.y, w.z); }
        const geo = track(new THREE.BufferGeometry());
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(tris.flat());
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, track(new THREE.MeshStandardMaterial({ color: 0xb08968, side: THREE.DoubleSide, roughness: 0.9 })));
        content.add(mesh);
        for (const ring of [f.outline, ...f.holes]) content.add(new THREE.LineLoop(track(new THREE.BufferGeometry().setFromPoints(ring.map(to3))), track(new THREE.LineBasicMaterial({ color: 0x5b4636 }))));
      }
      for (const o of m.obstacles) {
        const c = to3(o.center);
        const geo = o.kind === 'box' ? new THREE.BoxGeometry(Math.hypot(o.footprint[0].e - o.footprint[1].e, o.footprint[0].n - o.footprint[1].n), o.height, Math.hypot(o.footprint[1].e - o.footprint[2].e, o.footprint[1].n - o.footprint[2].n)) : new THREE.CylinderGeometry(o.diameter / 2, o.diameter / 2, o.height, 24);
        const mesh = new THREE.Mesh(track(geo), track(new THREE.MeshStandardMaterial({ color: o.kind === 'box' ? 0x78716c : 0x64748b, roughness: 0.6 })));
        mesh.position.set(c.x, o.baseUp + o.height / 2, c.z);
        if (o.kind === 'box') { const dx = o.footprint[1].e - o.footprint[0].e, dn = o.footprint[1].n - o.footprint[0].n; mesh.rotation.y = Math.atan2(dn, dx); } // x side bearing → Three rotation about Y
        content.add(mesh);
        if (layers.labels) { const t = textSprite(o.label, '#475569', Math.max(1.4, r * 0.3)); t.position.set(c.x, o.baseUp + o.height + 0.5, c.z); content.add(t); }
      }
    }
    if (layers.frame) for (const rl of m.rails) content.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints([to3(rl.from), to3(rl.to)])), track(new THREE.LineBasicMaterial({ color: 0x92400e }))));
    if (layers.panels) {
      for (const pn of m.panels) {
        const c = pn.corners.map(to3);
        const geo = track(new THREE.BufferGeometry());
        geo.setAttribute('position', new THREE.Float32BufferAttribute(c.flatMap((v) => [v.x, v.y, v.z]), 3));
        geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals();
        const sel = selection.has(pn.instanceId);
        const mat = track(new THREE.MeshStandardMaterial({ color: new THREE.Color(stringColor(pn.stringIndex)), side: THREE.DoubleSide, roughness: 0.4, metalness: 0.2, emissive: new THREE.Color(pn.invalid ? 0xef4444 : sel ? 0xfacc15 : 0x000000), emissiveIntensity: pn.invalid || sel ? 0.6 : 0 }));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { instanceId: pn.instanceId, faceId: pn.faceId };
        const edges = new THREE.LineLoop(track(new THREE.BufferGeometry().setFromPoints(c)), track(new THREE.LineBasicMaterial({ color: pn.invalid ? 0xdc2626 : sel ? 0xeab308 : 0x0f172a })));
        content.add(mesh, edges);
        panelMeshes.set(pn.instanceId, { mesh, edges });
      }
    }
    if (layers.wires) for (const rt of m.routes) if (rt.points.length > 1) {
      const line = new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(rt.points.map(to3))), track(new THREE.LineDashedMaterial({ color: new THREE.Color(stringColor(rt.stringIndex)), dashSize: 0.18, gapSize: 0.1 })));
      line.computeLineDistances();
      content.add(line);
    }
    if (layers.labels) {
      const size = Math.max(0.7, Math.min(2.2, r * 0.12));
      for (const rt of m.routes) { const first = to3(rt.points[0]); const sp = textSprite(`S${rt.stringIndex}`, stringColor(rt.stringIndex), size * 1.5); sp.position.set(first.x, first.y + 0.7, first.z); content.add(sp); }
      for (const pn of m.panels) if (pn.seriesIndex > 0) { const sp = textSprite(String(pn.seriesIndex), stringColor(pn.stringIndex), size * 0.8); const c = to3(pn.center); sp.position.set(c.x, c.y + 0.25, c.z); content.add(sp); }
    }
    need();
  }

  const fit = (kind: 'overview' | 'top') => {
    const b = model?.bounds;
    if (!b) return;
    const c = to3(b.center), d = Math.max(6, b.radius * 2.6);
    controls.target.copy(c);
    if (kind === 'top') camera.position.set(c.x, c.y + d * 1.4, c.z + 0.001);
    else camera.position.set(c.x - d * 0.35, c.y + d * 0.75, c.z + d); // from the south-west, looking north-east
    controls.update(); need(); publish();
  };

  // ---- picking and dragging ------------------------------------------------------------------------------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pointer = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)); ray.setFromCamera(ndc, camera); };
  const hit = (e: PointerEvent): string | null => {
    pointer(e);
    const hits = ray.intersectObjects([...panelMeshes.values()].map((x) => x.mesh), false);
    return hits.length ? (hits[0].object.userData.instanceId as string) : null;
  };
  let down: { x: number; y: number; id: string | null; shift: boolean; plane: InstanceType<typeof THREE.Plane> | null; start: InstanceType<typeof THREE.Vector3> | null; dragging: boolean; ids: string[]; faceId: string | null } | null = null;
  const faceOf = (id: string) => model?.panels.find((p) => p.instanceId === id)?.faceId ?? null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const id = hit(e);
    const ids = id && selection.has(id) ? [...selection].filter((x) => faceOf(x) === faceOf(id)) : id ? [id] : [];
    down = { x: e.clientX, y: e.clientY, id, shift: e.shiftKey || e.ctrlKey || e.metaKey, plane: null, start: null, dragging: false, ids, faceId: id ? faceOf(id) : null };
    if (id) { // dragging starts on a panel: orbiting is suspended for this gesture
      const pn = model!.panels.find((p) => p.instanceId === id)!;
      down.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(to3(pn.normal), to3(pn.center)); // a direction maps like a point: x = E, y = Up, z = −N
      const p = new THREE.Vector3();
      ray.ray.intersectPlane(down.plane, p);
      down.start = p;
    }
  }, { capture: true });
  const delta = (e: PointerEvent): { da: number; db: number; shift: InstanceType<typeof THREE.Vector3> } | null => {
    if (!down?.plane || !down.start || !down.faceId) return null;
    pointer(e);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(down.plane, p)) return null;
    const d = p.clone().sub(down.start), f = model!.faces.find((x) => x.id === down!.faceId)!;
    const enu = { e: d.x, n: -d.z, up: d.y };
    const da = enu.e * f.frame.u.e + enu.n * f.frame.u.n + enu.up * f.frame.u.up, db = enu.e * f.frame.v.e + enu.n * f.frame.v.n + enu.up * f.frame.v.up;
    const move = to3({ e: da * f.frame.u.e + db * f.frame.v.e, n: da * f.frame.u.n + db * f.frame.v.n, up: da * f.frame.u.up + db * f.frame.v.up });
    return { da, db, shift: move };
  };
  canvas.addEventListener('pointermove', (e) => {
    if (!down || !down.id) return;
    if (!down.dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
      down.dragging = true; controls.enabled = false;
      if (!selection.has(down.id)) handlers.onSelect([down.id], 'set');
    }
    if (!down.dragging) return;
    const d = delta(e);
    if (d) { for (const id of down.ids) { const x = panelMeshes.get(id); if (x) { x.mesh.position.copy(d.shift); x.edges.position.copy(d.shift); } } need(); }
  });
  const end = (e: PointerEvent) => {
    const d0 = down; down = null;
    controls.enabled = true;
    if (!d0) return;
    if (d0.dragging) {
      down = d0; const d = delta(e); down = null;
      if (d && Math.hypot(d.da, d.db) > 0.005) handlers.onMove(d0.ids, [d.da, d.db]); else { for (const id of d0.ids) { const x = panelMeshes.get(id); if (x) { x.mesh.position.set(0, 0, 0); x.edges.position.set(0, 0, 0); } } need(); }
      return;
    }
    if (Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > 5) return; // an orbit, not a click
    if (d0.id) handlers.onSelect([d0.id], d0.shift ? 'toggle' : 'set'); else handlers.onClear();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('keydown', (e) => { if (e.key === 'Escape') handlers.onClear(); });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); handlers.onContextLost(); });

  /** Mirrors what the canvas shows into data attributes (tests and assistive tools cannot read pixels): ids drawn, ids selected, where each panel is on screen. */
  const publish = () => {
    if (!model) return;
    camera.updateMatrixWorld();
    const pos: Record<string, [number, number]> = {};
    for (const pn of model.panels) { const v = to3(pn.center).project(camera); pos[pn.instanceId] = [Math.round(((v.x + 1) / 2) * canvas.clientWidth), Math.round(((1 - v.y) / 2) * canvas.clientHeight)]; }
    canvas.dataset.panels = String(model.panels.length);
    canvas.dataset.panelIds = model.panels.map((x) => x.instanceId).join(',');
    canvas.dataset.selected = [...selection].join(',');
    canvas.dataset.panelPos = JSON.stringify(pos);
    canvas.dataset.damping = String(controls.enableDamping);
    canvas.dataset.camera = JSON.stringify({ pos: camera.position.toArray().map((x) => +x.toFixed(2)), target: controls.target.toArray().map((x) => +x.toFixed(2)), aspect: +camera.aspect.toFixed(2), fov: camera.fov });
  };
  controls.addEventListener('end', publish);
  const resize = () => { const w = Math.max(200, host.clientWidth); renderer.setSize(w, height, false); camera.aspect = w / height; camera.updateProjectionMatrix(); need(); };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  return {
    canvas,
    update(m, sel, ly) {
      model = m; selection = sel; layers = ly;
      rebuild();
      if (!fitted && m.faces.length) { fitted = true; fit('overview'); } // frame the roof once it exists, not the empty scene
      publish();
    },
    setCamera: fit,
    fps(ms) {
      return new Promise((resolve) => {
        let frames = 0;
        const t0 = performance.now(), target = controls.target.clone(), off = camera.position.clone().sub(target);
        const step = () => {
          const t = performance.now() - t0;
          if (t >= ms) return resolve((frames * 1000) / t);
          const a = (t / 1000) * 0.6;
          camera.position.set(target.x + off.x * Math.cos(a) - off.z * Math.sin(a), off.y + target.y, target.z + off.x * Math.sin(a) + off.z * Math.cos(a));
          camera.lookAt(target);
          renderer.render(scene, camera); frames++;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    },
    dispose() { disposed = true; ro.disconnect(); cancelAnimationFrame(frame); controls.dispose(); geometries.splice(0).forEach((g) => g.dispose()); renderer.dispose(); canvas.remove(); },
  };
}
