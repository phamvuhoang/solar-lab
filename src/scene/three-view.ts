import type { Group, Object3D, Sprite } from 'three';
import { enuToThree, type V3 } from '../domain/roof';
import type { Flow } from './flows';
import type { SceneModel } from './model';

export interface Layers { roof: boolean; frame: boolean; panels: boolean; wires: boolean; labels: boolean }
export const ALL_LAYERS: Layers = { roof: true, frame: true, panels: true, wires: true, labels: true };
export const STRING_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#dc2626', '#4d7c0f', '#be185d'];
export const stringColor = (index: number) => (index > 0 ? STRING_COLORS[(index - 1) % STRING_COLORS.length] : '#64748b');
/** Grid, labels and camera distance scale from at least this radius (m), so an empty or one-box scene is not all label. */
const MIN_RADIUS = 4;
const DEVICE_COLOR = { inverter: 0x334155, battery: 0x0f766e, controller: 0x7c3aed, load: 0x9a3412 };
/** Wire kind → colour and dash (metres); the dash pattern, not the colour, tells the kinds apart (legend in the viewport). */
const WIRE_STYLE: Record<SceneModel['wires'][number]['kind'], { color: number; dash: [number, number] | null }> = {
  ac: { color: 0x111827, dash: null }, 'dc-pv': { color: 0x2563eb, dash: [0.3, 0.15] }, 'dc-bat': { color: 0x15803d, dash: [0.08, 0.08] }, 'dc-pump': { color: 0x0e7490, dash: [0.08, 0.08] },
};

export interface ViewHandlers {
  onSelect(ids: string[], mode: 'set' | 'toggle'): void;
  /** Called when a drag of the selected panels ends: delta in the face frame (metres). */
  onMove(ids: string[], delta: [number, number]): void;
  onClear(): void;
  onContextLost(): void;
}
/** Direct-beam access 0..1 → colour. Dark = shaded, bright = full sun. Numbers are always printed next to it (colour is not the only cue). */
export function heatColor(f: number): string {
  const stops = ['#440154', '#3b528b', '#21908d', '#5dc863', '#fde725'];
  const x = Math.max(0, Math.min(1, f)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), t = x - i;
  const h = (c: string) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  const a = h(stops[i]), b = h(stops[i + 1]);
  return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * t).toString(16).padStart(2, '0')).join('');
}
/** sun: unit vector to the sun in ENU (null = no sun, no shadows); heat: panel id → direct access. */
export interface Overlay { sun: V3 | null; heat: ReadonlyMap<string, number> | null }
export interface ViewApi {
  canvas: HTMLCanvasElement;
  setOverlay(o: Overlay): void;
  /** Replay: one cone per wire at its middle, pointing the way power goes, size ∝ √W; [] clears. Static: nothing animates. */
  setFlows(flows: Flow[]): void;
  update(model: SceneModel, selection: ReadonlySet<string>, layers: Layers): void;
  setCamera(kind: 'overview' | 'top'): void;
  /** Frames per second while the camera orbits, measured over `ms`. */
  fps(ms: number): Promise<number>;
  dispose(): void;
}
export class WebGLUnavailable extends Error { constructor(why: string) { super(why); this.name = 'WebGLUnavailable'; } }

/**
 * Three.js scene, loaded lazily by the workspace view. It draws a SceneModel and nothing else: it never creates instances or prices.
 * Coordinates arrive in ENU and are mapped to Three.js (x = East, y = Up, z = −North) at the very edge.
 * The canvas fills `host`: the stylesheet gives the host its height.
 */
export async function createThreeView(host: HTMLElement, handlers: ViewHandlers): Promise<ViewApi> {
  let THREE: typeof import('three'), OrbitControls: typeof import('three/examples/jsm/controls/OrbitControls.js').OrbitControls;
  try {
    THREE = await import('three');
    ({ OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js'));
  } catch (e) { throw new WebGLUnavailable(`Không tải được Three.js: ${(e as Error).message}`); }

  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Nhà, mái, tấm và thiết bị 3D. Chọn bằng bàn phím ở Mặt bằng, Sơ đồ hoặc danh sách tấm; phím mũi tên dịch camera.');
  canvas.style.cssText = 'width:100%;height:100%;box-sizing:border-box;display:block;touch-action:none;border:1px solid #8886;border-radius:4px';
  host.append(canvas);
  let renderer: InstanceType<typeof THREE.WebGLRenderer>;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
  catch (e) { canvas.remove(); throw new WebGLUnavailable((e as Error).message || 'WebGL không khả dụng'); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xf1f5f9);
  renderer.shadowMap.enabled = true; // shadows are drawn on the GPU for the eye; the energy numbers come from the CPU rays
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.1);
  sunLight.position.set(-8, 14, 10);
  sunLight.shadow.mapSize.set(2048, 2048); sunLight.shadow.bias = -0.0005; sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight, sunLight.target);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false; // render only on change: no idle GPU use, and no motion for reduced-motion users
  controls.listenToKeyEvents(canvas);
  const content: Group = new THREE.Group();
  scene.add(content);

  let model: SceneModel | null = null, selection: ReadonlySet<string> = new Set(), layers: Layers = ALL_LAYERS, overlay: Overlay = { sun: null, heat: null }, flows: Flow[] = [];
  let frame = 0, disposed = false, fitted: boolean | null = null; // null: never framed; false: framed an empty scene; true: framed a roof
  const need = () => { if (!frame && !disposed) frame = requestAnimationFrame(() => { frame = 0; renderer.render(scene, camera); }); };
  controls.addEventListener('change', need);

  const to3 = (p: V3) => { const [x, y, z] = enuToThree(p); return new THREE.Vector3(x, y, z); };
  const geometries: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(g: T): T => { geometries.push(g); return g; };
  const textSprite = (text: string, color: string, size: number): Sprite => {
    // width follows the longest line so long labels ("Bồn nước") are not clipped; '\n' starts a new line
    const lines = text.split('\n'), c = document.createElement('canvas'), w = Math.max(128, Math.round(Math.max(...lines.map((l) => l.length)) * 26 + 40)), ht = 64 * lines.length; c.width = w; c.height = ht;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffffd9'; g.fillRect(0, 0, w, ht); g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, ht - 6);
    g.fillStyle = '#111'; g.font = 'bold 38px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; lines.forEach((l, i) => g.fillText(l, w / 2, 34 + i * 64));
    const tex = track(new THREE.CanvasTexture(c));
    const sp = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, depthTest: false })));
    sp.scale.set(size * (w / 128), (size / 2) * lines.length, 1);
    return sp;
  };
  const panelMeshes = new Map<string, { mesh: Object3D; edges: Object3D }>();
  const pickable: Object3D[] = []; // panels and devices: what a click can select
  /** A box standing on its centre (size.z is the height); illustrative sizes get a dashed outline. */
  const box = (center: V3, size: { x: number; y: number; z: number }, color: number, edge: number, dashed: boolean, glow: boolean) => {
    const geo = track(new THREE.BoxGeometry(size.x, size.z, size.y)), at = to3(center);
    const mesh = new THREE.Mesh(geo, track(new THREE.MeshStandardMaterial({ color, roughness: 0.7, emissive: new THREE.Color(glow ? 0xfacc15 : 0x000000), emissiveIntensity: glow ? 0.5 : 0 })));
    const edges = new THREE.LineSegments(track(new THREE.EdgesGeometry(geo)), track(dashed ? new THREE.LineDashedMaterial({ color: edge, dashSize: 0.06, gapSize: 0.05 }) : new THREE.LineBasicMaterial({ color: edge })));
    edges.computeLineDistances();
    mesh.position.copy(at); edges.position.copy(at); mesh.castShadow = true; mesh.receiveShadow = true;
    content.add(mesh, edges);
    return mesh;
  };

  function rebuild() {
    for (const o of [...content.children]) content.remove(o);
    geometries.splice(0).forEach((g) => g.dispose());
    panelMeshes.clear(); pickable.length = 0;
    if (!model) return need();
    const m = model, r = Math.max(MIN_RADIUS, m.bounds.radius);
    const ground = Math.min(m.bounds.min.up, 0);
    const grid = new THREE.GridHelper(Math.ceil(r * 5), Math.ceil(r * 5), 0x94a3b8, 0xcbd5e1);
    grid.position.set(m.bounds.center.e, ground - 0.01, -m.bounds.center.n);
    content.add(grid);
    // sun: a directional light with a shadow map when an instant is set, else the fixed key light
    const noSun = !overlay.sun || overlay.sun.up <= 0;
    sunLight.intensity = overlay.sun ? (noSun ? 0 : 1.2) : 1.1;
    sunLight.castShadow = !noSun;
    if (overlay.sun && !noSun) {
      const c = to3(m.bounds.center), d = to3(overlay.sun).normalize();
      sunLight.position.copy(c).addScaledVector(d, r * 6);
      sunLight.target.position.copy(c); sunLight.target.updateMatrixWorld();
      const cam = sunLight.shadow.camera; cam.left = -r * 1.8; cam.right = r * 1.8; cam.top = r * 1.8; cam.bottom = -r * 1.8; cam.near = 0.5; cam.far = r * 14; cam.updateProjectionMatrix();
    } else sunLight.position.set(-8, 14, 10);
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
        mesh.castShadow = true; mesh.receiveShadow = true;
        content.add(mesh);
        for (const ring of [f.outline, ...f.holes]) content.add(new THREE.LineLoop(track(new THREE.BufferGeometry().setFromPoints(ring.map(to3))), track(new THREE.LineBasicMaterial({ color: 0x5b4636 }))));
      }
      for (const o of m.obstacles) {
        const c = to3(o.center);
        const geo = o.kind === 'box' ? new THREE.BoxGeometry(Math.hypot(o.footprint[0].e - o.footprint[1].e, o.footprint[0].n - o.footprint[1].n), o.height, Math.hypot(o.footprint[1].e - o.footprint[2].e, o.footprint[1].n - o.footprint[2].n)) : new THREE.CylinderGeometry(o.diameter / 2, o.diameter / 2, o.height, 24);
        const mesh = new THREE.Mesh(track(geo), track(new THREE.MeshStandardMaterial({ color: o.kind === 'box' ? 0x78716c : 0x64748b, roughness: 0.6 })));
        mesh.castShadow = true; mesh.receiveShadow = true;
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
        const heat = overlay.heat?.get(pn.instanceId);
        const mat = track(new THREE.MeshStandardMaterial({ color: new THREE.Color(heat !== undefined ? heatColor(heat) : stringColor(pn.stringIndex)), side: THREE.DoubleSide, roughness: 0.4, metalness: 0.2, emissive: new THREE.Color(pn.invalid ? 0xef4444 : sel ? 0xfacc15 : 0x000000), emissiveIntensity: pn.invalid || sel ? 0.6 : 0 }));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData = { instanceId: pn.instanceId, faceId: pn.faceId };
        const edges = new THREE.LineLoop(track(new THREE.BufferGeometry().setFromPoints(c)), track(new THREE.LineBasicMaterial({ color: pn.invalid ? 0xdc2626 : sel ? 0xeab308 : 0x0f172a })));
        content.add(mesh, edges);
        panelMeshes.set(pn.instanceId, { mesh, edges }); pickable.push(mesh);
      }
    }
    if (layers.wires) for (const rt of m.routes) if (rt.points.length > 1) {
      const line = new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(rt.points.map(to3))), track(new THREE.LineDashedMaterial({ color: new THREE.Color(stringColor(rt.stringIndex)), dashSize: 0.18, gapSize: 0.1 })));
      line.computeLineDistances();
      content.add(line);
    }
    if (layers.wires) for (const w of m.wires) {
      const st = WIRE_STYLE[w.kind], geo = track(new THREE.BufferGeometry().setFromPoints([to3(w.from), to3(w.to)]));
      const line = new THREE.Line(geo, track(st.dash ? new THREE.LineDashedMaterial({ color: st.color, dashSize: st.dash[0], gapSize: st.dash[1] }) : new THREE.LineBasicMaterial({ color: st.color })));
      line.computeLineDistances();
      content.add(line);
    }
    if (layers.wires) for (const f of flows) {
      const w = m.wires.find((x) => x.id === f.wireId);
      if (!w || f.w < 1) continue; // no power, no arrow; the number is still in the text under the view
      const a = to3(f.dir === 1 ? w.from : w.to), d = to3(f.dir === 1 ? w.to : w.from).sub(a), rad = 0.25 * Math.sqrt(f.w / 1000);
      if (d.length() < 1e-6) continue;
      const cone = new THREE.Mesh(track(new THREE.ConeGeometry(rad, rad * 3, 16)), track(new THREE.MeshBasicMaterial({ color: WIRE_STYLE[w.kind].color })));
      cone.position.copy(a).addScaledVector(d, 0.5);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      content.add(cone);
    }
    const tag = Math.max(0.6, Math.min(1.6, r * 0.11)), short = (t: string) => (t.length > 28 ? t.slice(0, 27) + '…' : t); // full names are in the diagram
    let floor = -Infinity; // device labels stand on a ladder with a leader line each, so neighbours on the wall never cover each other
    // ponytail: one ladder for all devices; devices placed far apart (T17 moves) get needlessly high labels, group by distance if that shows
    for (const d of m.devices) {
      const sel = selection.has(d.instanceId), edge = d.status === 'fail' ? 0xdc2626 : d.status === 'limited' ? 0xd97706 : sel ? 0xeab308 : 0x0f172a;
      const mesh = box(d.center, d.size, DEVICE_COLOR[d.kind], edge, d.sizeSource === 'illustrative', sel);
      mesh.userData = { instanceId: d.instanceId };
      pickable.push(mesh);
      // the status is a word on a red/amber badge, never hidden, not even with the labels layer off
      const lines = [...(d.status ? [d.status === 'fail' ? 'Lỗi' : 'Giới hạn'] : []), ...(layers.labels ? [short(d.label), ...(d.sizeSource === 'illustrative' ? ['(kích thước minh họa)'] : [])] : [])];
      if (!lines.length) continue;
      const t = textSprite(lines.join('\n'), d.status === 'fail' ? '#dc2626' : d.status === 'limited' ? '#d97706' : '#334155', tag);
      const top = mesh.position.y + d.size.z / 2, y = Math.max(top + 0.3, floor);
      floor = y + (tag / 2) * lines.length + 0.15;
      t.center.set(0.5, 0); t.position.set(mesh.position.x, y, mesh.position.z); t.renderOrder = 1; // over obstacle labels
      content.add(t, new THREE.Line(track(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(mesh.position.x, top, mesh.position.z), new THREE.Vector3(mesh.position.x, y, mesh.position.z)])), track(new THREE.LineBasicMaterial({ color: 0x64748b }))));
    }
    for (const pr of m.props) { // illustration only: dashed outline, the label says so
      box(pr.center, pr.kind === 'meter' ? { x: 0.2, y: 0.15, z: 0.3 } : { x: 0.4, y: 0.2, z: 0.5 }, 0xcbd5e1, 0x475569, true, false);
      if (layers.labels) { const t = textSprite(pr.label, '#64748b', tag * 0.8); t.center.set(0.5, 1); const c = to3(pr.center); t.position.set(c.x, c.y - 0.2, c.z); content.add(t); }
    }
    if (layers.labels) {
      const size = Math.max(0.7, Math.min(2.2, r * 0.12));
      for (const rt of m.routes) { const first = to3(rt.points[0]); const sp = textSprite(`S${rt.stringIndex}`, stringColor(rt.stringIndex), size * 1.5); sp.position.set(first.x, first.y + 0.7, first.z); content.add(sp); }
      for (const pn of m.panels) if (pn.seriesIndex > 0 || overlay.heat?.has(pn.instanceId)) { const h = overlay.heat?.get(pn.instanceId); const sp = textSprite(h !== undefined ? `${Math.round(h * 100)}%` : String(pn.seriesIndex), h !== undefined ? heatColor(h) : stringColor(pn.stringIndex), size * 0.8); const c = to3(pn.center); sp.position.set(c.x, c.y + 0.25, c.z); content.add(sp); }
    }
    need();
  }

  const fit = (kind: 'overview' | 'top') => {
    const b = model?.bounds;
    if (!b) return;
    const c = to3(b.center), d = Math.max(MIN_RADIUS, b.radius) * 2.6;
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
    const hits = ray.intersectObjects(pickable, false);
    return hits.length ? (hits[0].object.userData.instanceId as string) : null;
  };
  let down: { x: number; y: number; id: string | null; shift: boolean; plane: InstanceType<typeof THREE.Plane> | null; start: InstanceType<typeof THREE.Vector3> | null; dragging: boolean; ids: string[]; faceId: string | null } | null = null;
  const faceOf = (id: string) => model?.panels.find((p) => p.instanceId === id)?.faceId ?? null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const id = hit(e), pn = id ? model?.panels.find((p) => p.instanceId === id) : undefined;
    const ids = pn && selection.has(pn.instanceId) ? [...selection].filter((x) => faceOf(x) === pn.faceId) : pn ? [pn.instanceId] : [];
    down = { x: e.clientX, y: e.clientY, id, shift: e.shiftKey || e.ctrlKey || e.metaKey, plane: null, start: null, dragging: false, ids, faceId: pn?.faceId ?? null };
    if (pn) { // dragging starts on a panel: orbiting is suspended for this gesture; a device is only picked (moving it is a list action)
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
    if (!down?.id || !down.plane) return;
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
    const pos = (xs: { instanceId: string; center: V3 }[]) => JSON.stringify(Object.fromEntries(xs.map((x) => { const v = to3(x.center).project(camera); return [x.instanceId, [Math.round(((v.x + 1) / 2) * canvas.clientWidth), Math.round(((1 - v.y) / 2) * canvas.clientHeight)]]; })));
    canvas.dataset.panels = String(model.panels.length);
    canvas.dataset.panelIds = model.panels.map((x) => x.instanceId).join(',');
    canvas.dataset.selected = [...selection].join(',');
    canvas.dataset.panelPos = pos(model.panels);
    canvas.dataset.devices = model.devices.map((x) => x.instanceId).join(',');
    canvas.dataset.devicePos = pos(model.devices);
    canvas.dataset.props = model.props.map((x) => x.label).join(',');
    canvas.dataset.sun = overlay.sun ? JSON.stringify([overlay.sun.e, overlay.sun.n, overlay.sun.up].map((x) => +x.toFixed(3))) : '';
    canvas.dataset.flows = flows.length ? JSON.stringify(flows.map((f) => ({ ...f, w: Math.round(f.w) }))) : '';
    canvas.dataset.heat = overlay.heat ? JSON.stringify(Object.fromEntries([...overlay.heat].map(([k, v]) => [k, +v.toFixed(3)]))) : '';
    canvas.dataset.damping = String(controls.enableDamping);
    canvas.dataset.camera = JSON.stringify({ pos: camera.position.toArray().map((x) => +x.toFixed(2)), target: controls.target.toArray().map((x) => +x.toFixed(2)), aspect: +camera.aspect.toFixed(2), fov: camera.fov });
  };
  controls.addEventListener('end', publish);
  // also republishes positions: the canvas may have been drawn while hidden (2D mode) or before a window resize
  const resize = () => { const w = Math.max(200, host.clientWidth), ht = Math.max(150, host.clientHeight); renderer.setSize(w, ht, false); camera.aspect = w / ht; camera.updateProjectionMatrix(); need(); publish(); };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  return {
    canvas,
    update(m, sel, ly) {
      model = m; selection = sel; layers = ly;
      rebuild();
      // frame once, and once more when the roof first appears; an unframed camera sits at the origin, inside the north arrow
      if (fitted === null || (!fitted && m.faces.length)) { fitted = m.faces.length > 0; fit('overview'); }
      publish();
    },
    setOverlay(o) { overlay = o; rebuild(); publish(); },
    setFlows(f) { if (!f.length && !flows.length) return; flows = f; rebuild(); publish(); },
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
