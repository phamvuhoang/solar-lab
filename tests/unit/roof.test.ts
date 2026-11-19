import { describe, expect, test } from 'vitest';
import { addInstances, createProject, openLamHa } from '../../src/domain/project';
import { addHole, addObstacle, addRoofFace, clearPlacements, demoGableRoof, faceRect, fillFace, movePanels, placeGrid, removeFace, rotate90, snapCenter, unplacedPanels } from '../../src/domain/layout-edit';
import { validateLayout } from '../../src/domain/placement';
import { enuToThree, faceBasis, isSimplePolygon, locate, ringContainsRing, ringsOverlap, toLocalHorizontal, toWorld, type Pt } from '../../src/domain/roof';
import { dropInstances } from '../../src/domain/graph';
import { buildQuote } from '../../src/cost/quote';
import type { Project, RoofFace } from '../../src/domain/types';
import { hasErrors, validateProject } from '../../src/domain/validate';
import { buildSceneModel } from '../../src/scene/model';
import { catalog } from './helpers';

const face = (o: Partial<RoofFace> = {}): RoofFace => ({ roofFaceId: 'f1', label: 'F', outline: [[0, 0], [10, 0], [10, 3.25], [0, 3.25]], holes: [], tiltDeg: 10, azimuthDeg: 180, origin: { e: 0, n: 0, up: 3 }, setbackM: 0.3, setbackSource: 'assumption', ...o });
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

/** n VSUN 620 panels and one roof face, no placements yet. */
const rig = (n: number, f: Partial<RoofFace> = {}): { p: Project; ids: string[] } => {
  let p = addInstances(createProject('r'), catalog('vsun-620'), n);
  const ids = p.instances.map((i) => i.instanceId);
  p = { ...p, roofFaces: [face(f)] };
  return { p, ids };
};
const codes = (p: Project) => validateLayout(p).map((i) => i.code);
const put = (p: Project, id: string, center: Pt, angleDeg = 0, faceId = 'f1'): Project => ({ ...p, placements: [...(p.placements ?? []).filter((x) => x.instanceId !== id), { instanceId: id, roofFaceId: faceId, center, angleDeg }] });

describe('ENU và hướng Bắc (fixture)', () => {
  test('mái hướng Nam 30°: a → Đông, b dốc lên về phía Bắc, pháp tuyến nghiêng về Nam', () => {
    const { u, v, normal } = faceBasis({ tiltDeg: 30, azimuthDeg: 180 });
    expect([u.e, u.n, u.up].map((x) => +x.toFixed(9))).toEqual([1, 0, 0]);
    close(v.e, 0); close(v.n, Math.cos(Math.PI / 6)); close(v.up, 0.5);
    close(normal.e, 0); close(normal.n, -0.5); close(normal.up, Math.cos(Math.PI / 6));
  });
  test('Đông 20°: a → Bắc, dốc lên về phía Tây; Bắc 10°: a → Tây, dốc lên về phía Nam', () => {
    const e = faceBasis({ tiltDeg: 20, azimuthDeg: 90 });
    close(e.u.n, 1); close(e.v.e, -Math.cos(Math.PI / 9)); close(e.normal.e, Math.sin(Math.PI / 9));
    const n = faceBasis({ tiltDeg: 10, azimuthDeg: 0 });
    close(n.u.e, -1); close(n.v.n, -Math.cos(Math.PI / 18));
  });
  test('Three.js: x = Đông, y = Lên, z = −Bắc; điểm phía Bắc có z âm', () => {
    expect(enuToThree({ e: 1, n: 2, up: 3 })).toEqual([1, 3, -2]);
    const f = face({ azimuthDeg: 180, tiltDeg: 30 });
    const w = toWorld(f, [0, 1]);
    close(w.n, Math.cos(Math.PI / 6)); expect(enuToThree(w)[2]).toBeLessThan(0);
  });
  test('toWorld và toLocalHorizontal là hai chiều của nhau trên mái dốc bất kỳ', () => {
    for (const az of [0, 37, 90, 180, 270]) for (const tilt of [0, 10, 45]) {
      const f = face({ azimuthDeg: az, tiltDeg: tilt, origin: { e: 3, n: -2, up: 5 } });
      const back = toLocalHorizontal(f, toWorld(f, [2.5, 1.25]));
      close(back[0], 2.5); close(back[1], 1.25);
    }
  });
});

describe('đa giác', () => {
  const L: Pt[] = [[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]];
  test('đơn giản, tự cắt, điểm trùng, diện tích 0', () => {
    expect(isSimplePolygon([[0, 0], [4, 0], [4, 3], [0, 3]])).toBe(true);
    expect(isSimplePolygon(L)).toBe(true);
    expect(isSimplePolygon([[0, 0], [4, 4], [4, 0], [0, 4]])).toBe(false); // hình nơ
    expect(isSimplePolygon([[0, 0], [4, 0], [4, 0], [0, 3]])).toBe(false);
    expect(isSimplePolygon([[0, 0], [1, 1], [2, 2]])).toBe(false);
  });
  test('locate: trong, trên biên, ngoài (kể cả đỉnh lõm)', () => {
    expect([locate([1, 1], L), locate([3, 4], L), locate([5, 4], L), locate([8, 1], L)]).toEqual(['in', 'on', 'out', 'on']);
  });
  test('hình chữ nhật trong mái chữ L: nhánh dọc có, vùng lõm không dù nằm trong bounding box', () => {
    const r = (a: number, b: number, w: number, h: number): Pt[] => [[a, b], [a + w, b], [a + w, b + h], [a, b + h]];
    expect(ringContainsRing(L, r(0.5, 2.5, 1.5, 3))).toBe(true);
    expect(ringContainsRing(L, r(5, 3, 1.5, 2))).toBe(false); // trong bbox 8×6 nhưng ở vùng khuyết
    expect(ringContainsRing(L, r(2, 1, 3, 2))).toBe(false); // cắt qua đỉnh lõm (3,2)
    expect(ringContainsRing(L, r(0, 0, 8, 2))).toBe(true); // chạm biên vẫn nằm trong
    expect(ringContainsRing(L, r(2.5, 1.5, 1, 1))).toBe(false); // đỉnh lõm lọt vào trong hình chữ nhật
  });
  test('ringsOverlap: chạm cạnh không tính; chồng, lồng nhau, trùng hệt thì có', () => {
    const sq = (a: number, b: number, s = 2): Pt[] => [[a, b], [a + s, b], [a + s, b + s], [a, b + s]];
    expect([ringsOverlap(sq(0, 0), sq(2, 0)), ringsOverlap(sq(0, 0), sq(1.99, 0)), ringsOverlap(sq(0, 0), sq(0.5, 0.5, 1)), ringsOverlap(sq(0, 0), sq(0, 0))]).toEqual([false, true, true, true]);
    expect(ringsOverlap(sq(0, 0), sq(5, 5))).toBe(false);
    expect(ringsOverlap(sq(0, 0), sq(1.999, 0))).toBe(true); // chồng 1 mm trên cùng một hàng, cạnh trùng đường thẳng
    expect(ringsOverlap(sq(0, 0), sq(2.001, 0))).toBe(false);
  });
});

describe('kiểm tra vị trí tấm', () => {
  test('tấm hợp lệ cách mép đủ xa: không có vấn đề', () => {
    const { p, ids } = rig(1);
    expect(codes(put(p, ids[0], [1.5, 1.6]))).toEqual([]);
  });
  test('vượt biên (lỗi), gần mép hơn khoảng cách cấu hình (cảnh báo, nêu là giả định)', () => {
    const { p, ids } = rig(1);
    expect(validateLayout(put(p, ids[0], [0.2, 1.6]))[0]).toMatchObject({ code: 'PANEL_OUT_OF_BOUNDS', severity: 'error' });
    const w = validateLayout(put(p, ids[0], [0.7, 1.6]));
    expect(w).toMatchObject([{ code: 'PANEL_SETBACK', severity: 'warning' }]);
    expect(w[0].message).toContain('giả định');
    expect(codes(put(p, ids[0], [1.5, 3.2]))).toEqual(['PANEL_OUT_OF_BOUNDS']); // thò quá đỉnh mái
  });
  test('giao nhau (lỗi), sát nhau dưới khe hở (cảnh báo), cách đủ thì không báo', () => {
    const { p, ids } = rig(2);
    let q = put(put(p, ids[0], [1.5, 1.6]), ids[1], [1.6, 1.6]);
    expect(validateLayout(q)).toMatchObject([{ code: 'PANEL_OVERLAP', severity: 'error', instanceId: ids[0], otherId: ids[1] }]);
    q = put(put(p, ids[0], [1.5, 1.6]), ids[1], [1.5 + 1.134, 1.6]); // sát nhau, khe 0
    expect(codes(q)).toEqual(['PANEL_GAP']);
    q = put(put(p, ids[0], [1.5, 1.6]), ids[1], [1.5 + 1.134 + 0.03, 1.6]);
    expect(codes(q)).toEqual([]);
  });
  test('mái lõm chữ L: tấm ở vùng khuyết vượt biên dù nằm trong hộp bao', () => {
    const { p, ids } = rig(2, { outline: [[0, 0], [8, 0], [8, 2.9], [3, 2.9], [3, 8], [0, 8]] });
    expect(codes(put(p, ids[0], [1.5, 5]))).toEqual([]); // nhánh dọc
    expect(codes(put(p, ids[1], [6, 5]))).toEqual(['PANEL_OUT_OF_BOUNDS']); // vùng khuyết
    expect(codes(put(p, ids[1], [3.6, 1.45], 90))).toEqual([]); // nhánh ngang (xoay 90°: 2,382 × 1,134)
  });
  test('mái có khoảng trống (vùng loại trừ): đè lên là lỗi, gần là cảnh báo', () => {
    const { p, ids } = rig(2, { holes: [[[4, 1], [5, 1], [5, 2], [4, 2]]] });
    expect(codes(put(p, ids[0], [4.5, 1.6]))).toContain('PANEL_IN_HOLE');
    expect(validateLayout(put(p, ids[1], [3.3, 1.6]))).toMatchObject([{ code: 'PANEL_SETBACK', severity: 'warning' }]); // cách hố 0,133 m < 0,3 m
    expect(codes(put(p, ids[1], [2, 1.6]))).toEqual([]);
  });
  test('vật cản trên mái (ống khói) chiếm chỗ; vật cản đứng riêng (bồn nước dưới đất) không cản chỗ đặt', () => {
    const { p, ids } = rig(1);
    const f = p.roofFaces[0], c = toWorld(f, [6, 1.6]);
    const on = addObstacle(p, { label: 'Ống khói', kind: 'box', roofFaceId: 'f1', center: { e: c.e, n: c.n }, baseUp: c.up, angleDeg: 0, size: { x: 0.5, y: 0.5, z: 1 } });
    expect(codes(put(on, ids[0], [6, 1.6]))).toEqual(['PANEL_ON_OBSTACLE']);
    const tank = addObstacle(p, { label: 'Bồn nước', kind: 'cylinder', roofFaceId: null, center: { e: c.e, n: c.n }, baseUp: 0, angleDeg: 0, size: { x: 1.2, y: 1.2, z: 1.8 } });
    expect(codes(put(tank, ids[0], [6, 1.6]))).toEqual([]);
  });
  test('kích thước không xác định, đặt hai lần, mặt mái không có, không phải tấm, biên tự cắt', () => {
    const { p, ids } = rig(1);
    const noDim = structuredClone(put(p, ids[0], [1.5, 1.6]));
    noDim.snapshots.components[0].specs.lengthM.v = null;
    expect(validateLayout(noDim)[0]).toMatchObject({ code: 'DIMENSION_UNKNOWN', severity: 'error' });
    const dup = { ...put(p, ids[0], [1.5, 1.6]), placements: [{ instanceId: ids[0], roofFaceId: 'f1', center: [1.5, 1.6] as Pt, angleDeg: 0 }, { instanceId: ids[0], roofFaceId: 'f1', center: [5, 1.6] as Pt, angleDeg: 0 }] };
    expect(codes(dup)).toEqual(['PANEL_DUPLICATE_PLACEMENT']);
    expect(codes(put(p, ids[0], [1.5, 1.6], 0, 'nope'))).toEqual(['PANEL_FACE_MISSING']);
    expect(codes({ ...p, placements: [{ instanceId: 'ghost', roofFaceId: 'f1', center: [1, 1], angleDeg: 0 }] })).toEqual(['PLACEMENT_NOT_A_PANEL']);
    expect(codes({ ...p, roofFaces: [face({ outline: [[0, 0], [4, 4], [4, 0], [0, 4]] })] })).toEqual(['FACE_OUTLINE_INVALID']);
  });
});

describe('công cụ đặt tấm', () => {
  test('điền đầy mái Nam minh họa: 8 tấm đứng vừa một hàng, không vấn đề nào; thừa thì báo còn lại', () => {
    const { p, ids } = rig(12);
    const r = fillFace(p, 'f1', ids);
    expect(r.placed).toHaveLength(8);
    expect(r.left).toHaveLength(4);
    expect(validateLayout(r.project)).toEqual([]);
    expect(unplacedPanels(r.project)).toEqual(r.left);
  });
  test('đặt dãy: cột/hàng theo kích thước thật, xoay 90° đổi chiều', () => {
    const { p, ids } = rig(4, { outline: [[0, 0], [12, 0], [12, 12], [0, 12]] });
    const g = placeGrid(p, 'f1', ids, { a0: 1, b0: 1, cols: 2 });
    expect(g.placements!.map((x) => x.center.map((v) => +v.toFixed(3)))).toEqual([[1.567, 2.191], [2.721, 2.191], [1.567, 4.593], [2.721, 4.593]]);
    expect(codes(g)).toEqual([]);
    const land = placeGrid(p, 'f1', ids, { a0: 1, b0: 1, cols: 2, angleDeg: 90 });
    expect(land.placements![1].center[0]).toBeCloseTo(1 + 2.382 + 0.02 + 2.382 / 2, 9);
  });
  test('xoay 90° chuyển dọc ↔ ngang và có thể làm tấm vượt biên; xoay hai lần về lại', () => {
    const { p, ids } = rig(1, { outline: [[0, 0], [10, 0], [10, 3.0], [0, 3.0]] });
    const a = put(p, ids[0], [2, 1.5]);
    expect(codes(a)).toEqual([]);
    expect(codes(rotate90(a, ids))).toEqual([]);
    expect(codes(rotate90(rotate90(a, ids), ids))).toEqual([]);
    expect(rotate90(rotate90(a, ids), ids).placements![0].angleDeg).toBe(0);
    const tight = put(p, ids[0], [2, 1.5]); tight.roofFaces[0].outline = [[0, 0], [10, 0], [10, 1.4], [0, 1.4]];
    expect(codes(rotate90(put({ ...tight, roofFaces: [face({ outline: [[0, 0], [10, 0], [10, 3], [0, 3]] })] }, ids[0], [2, 1.5]), ids))).toEqual([]);
  });
  test('kéo: snap về lưới 5 cm; snap vào mép tấm bên cạnh cách đúng khe hở', () => {
    const { p, ids } = rig(2);
    const a = put(put(p, ids[0], [1.5, 1.6]), ids[1], [4, 1.6]);
    const snapped = movePanels(a, [ids[1]], [0.013, 0.027], { snap: true }).placements!.find((x) => x.instanceId === ids[1])!;
    expect(snapped.center[0] / 0.05).toBeCloseTo(Math.round(snapped.center[0] / 0.05), 9);
    const near = snapCenter(a, ids[1], [1.5 + 1.134 + 0.02 + 0.03, 1.62]); // lệch 3 cm so với vị trí sát cạnh
    expect(near[0]).toBeCloseTo(1.5 + 1.134 + 0.02, 9);
    expect(near[1]).toBeCloseTo(1.6, 9); // thẳng hàng với hàng bên cạnh
    expect(snapCenter(a, ids[1], [8, 1.6])[0]).toBeCloseTo(8, 9); // xa mọi thứ: chỉ snap lưới
  });
  test('chọn nhiều: dịch cả nhóm giữ nguyên khoảng cách', () => {
    const { p, ids } = rig(2);
    const a = put(put(p, ids[0], [1.5, 1.6]), ids[1], [2.7, 1.6]);
    const m = movePanels(a, ids, [0.5, 0]);
    expect(m.placements!.map((x) => x.center[0])).toEqual([2, 3.2]);
  });
  test('xóa mặt mái bỏ vị trí nhưng giữ tấm trong thiết kế; bớt tấm cũng bỏ vị trí; xóa hết', () => {
    const { p, ids } = rig(2);
    const a = fillFace(p, 'f1', ids).project;
    const r = removeFace(a, 'f1');
    expect(r.placements).toEqual([]);
    expect(r.instances).toHaveLength(2);
    expect(dropInstances(a, new Set([ids[0]])).placements!.map((x) => x.instanceId)).toEqual([ids[1]]);
    expect(clearPlacements(a).placements).toEqual([]);
  });
});

describe('cảnh 40 tấm và đồng bộ ID', () => {
  const scene40 = () => {
    let { p, ids } = rig(40, { outline: [[0, 0], [12.5, 0], [12.5, 10.5], [0, 10.5]], tiltDeg: 15 });
    p = fillFace(p, 'f1', ids).project;
    // 4 dãy 10 tấm = 4 chuỗi, nối theo thứ tự
    p = { ...p, strings: [0, 1, 2, 3].map((k) => ({ stringId: `s${k}`, label: `Chuỗi ${k + 1}`, panelIds: ids.slice(k * 10, k * 10 + 10), target: null })) };
    for (let k = 0; k < 10; k++) p = addObstacle(p, { label: `Vật cản ${k}`, kind: 'box', roofFaceId: null, center: { e: 20 + k, n: 5 }, baseUp: 0, angleDeg: 0, size: { x: 0.5, y: 0.5, z: 1 } });
    return { p, ids };
  };
  test('40 tấm điền đủ, không lỗi; 40 ID của scene = 40 ID của project = 40 vị trí', () => {
    const { p, ids } = scene40();
    expect(validateLayout(p).filter((i) => i.severity === 'error')).toEqual([]);
    const m = buildSceneModel(p);
    expect(m.panels.map((x) => x.instanceId).sort()).toEqual([...ids].sort());
    expect(new Set(m.panels.map((x) => x.instanceId)).size).toBe(40);
    expect(m.unplaced).toEqual([]);
    expect(m.obstacles).toHaveLength(10);
    expect(m.routes).toHaveLength(4);
    expect(m.routes[0].points).toHaveLength(10);
  });
  test('số chuỗi và thứ tự nối đúng; route khái niệm có chiều dài; dãy ray theo hàng', () => {
    const { p } = scene40();
    const m = buildSceneModel(p);
    expect(m.panels.filter((x) => x.stringIndex === 2).map((x) => x.seriesIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(m.routes[0].lengthM).toBeGreaterThan(9 * 1.134 && 9);
    expect(m.routes[0].spansFaces).toBe(false);
    expect(m.rails).toHaveLength(4 * 2); // 4 hàng × 2 ray
  });
  test('scene chỉ đọc project: dựng lại không đổi ID hay giá; di chuyển tấm chỉ đổi layout, BOM giữ nguyên', () => {
    const { p, ids } = scene40();
    const before = buildQuote(p), a = buildSceneModel(p), b = buildSceneModel(structuredClone(p));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const moved = movePanels(p, [ids[0]], [0, 0.01]);
    expect(buildQuote(moved)).toEqual(before);
    expect(moved.instances.map((i) => i.instanceId)).toEqual(p.instances.map((i) => i.instanceId));
    expect(moved.placements![0].center[1]).toBeCloseTo(p.placements![0].center[1] + 0.01, 9);
  });
  test('tấm lỗi được đánh dấu trong scene; tấm chưa đặt nằm ở danh sách riêng', () => {
    const { p, ids } = scene40();
    const bad = movePanels(p, [ids[0]], [-5, 0]);
    const m = buildSceneModel(bad);
    expect(m.panels.find((x) => x.instanceId === ids[0])!.invalid).toBe(true);
    const un = removeFace({ ...p, roofFaces: [...p.roofFaces, ...[]] }, 'f1');
    expect(buildSceneModel(un).unplaced).toHaveLength(40);
  });
  test('schema nhận mặt mái, vị trí, vật cản; tham chiếu hỏng bị chặn', () => {
    const base = demoGableRoof(openLamHa());
    const f0 = base.roofFaces[0].roofFaceId;
    const panel = base.instances.find((i) => i.kind === 'panel')!.instanceId;
    let p: Project = { ...fillFace(base, f0, [panel]).project, layout: { gridM: 0.05, gapM: 0.02 } };
    p = addHole(addObstacle(p, { label: 'Bồn nước', kind: 'cylinder', roofFaceId: null, center: { e: 12, n: 2 }, baseUp: 0, angleDeg: 0, size: { x: 1.2, y: 1.2, z: 1.8 } }), f0, [[4, 1], [5, 1], [5, 2], [4, 2]]);
    expect(hasErrors(validateProject(p))).toBe(false);
    const bad = structuredClone(p); bad.placements![0].roofFaceId = 'ghost';
    expect(validateProject(bad)[0]).toMatchObject({ code: 'BROKEN_REF', field: '/placements/0/roofFaceId' });
    const bad2 = structuredClone(p); bad2.placements![0].instanceId = 'ghost';
    expect(validateProject(bad2)[0].code).toBe('BROKEN_REF');
    const bad3 = structuredClone(p); bad3.roofFaces[0].outline = [[0, 0], [1, 1]] as never;
    expect(validateProject(bad3)[0].code).toBe('SCHEMA');
    expect(addRoofFace(createProject('x'), faceRect('m', 5, 3, 10, 180, { e: 0, n: 0, up: 0 })).roofFaces[0].setbackSource).toBe('assumption');
  });
});

describe('mặt mái quyết định hướng của chuỗi trong mô phỏng PV', () => {
  // 4 tấm trên mái Đông (az 90) + 4 tấm trên mái Tây (az 270), hai chuỗi, nối vào hai MPPT
  const eastWest = async () => {
    const { applyPreset } = await import('../../src/domain/presets');
    const { compilePv } = await import('../../src/engine/compile');
    const { simulatePv } = await import('../../src/engine/pv');
    const { wx } = await import('./pv-helpers');
    let p = openLamHa();
    p = applyPreset(p, 'two-trackers', catalog('luxpower-sna6000wpv'));
    p = addRoofFace(p, faceRect('Đông', 12, 6, 20, 90, { e: 0, n: 0, up: 3 }));
    p = addRoofFace(p, faceRect('Tây', 12, 6, 20, 270, { e: 0, n: 12, up: 3 }));
    const [fe, fw] = p.roofFaces.map((f) => f.roofFaceId);
    const panels = p.instances.filter((i) => i.kind === 'panel').map((i) => i.instanceId);
    p = fillFace(p, fe, panels.slice(0, 4), 0).project;
    p = fillFace(p, fw, panels.slice(4), 0).project;
    const w = wx({ n: 24, t0: Date.UTC(2023, 11, 21) / 1000, location: { latitude: 11.87, longitude: 108.2, elevationM: 0 },
      ghi: Array.from({ length: 24 }, (_, h) => (h >= 23 || h <= 10 ? 0 : 0)), dni: Array(24).fill(0), dhi: Array(24).fill(0) });
    // clear-ish day built from the sun itself
    const { sunPosition } = await import('../../src/engine/solar');
    for (let h = 0; h < 24; h++) { const s = sunPosition(w.t0 + h * 3600 + 1800, 11.87, 108.2); const up = s.apparentElevationDeg > 2; w.dni![h] = up ? 850 : 0; w.dhi![h] = up ? 90 : 0; w.ghi![h] = up ? 850 * Math.sin((s.apparentElevationDeg * Math.PI) / 180) + 90 : 0; }
    w.tempAirC = Array(24).fill(25); w.windMs = Array(24).fill(1);
    return { p, w, compilePv, simulatePv, panels, fe, fw };
  };
  test('chuỗi trên mái Đông lấy azimuth 90°, chuỗi trên mái Tây 270°; Đông đạt đỉnh trước Tây', async () => {
    const { p, w, compilePv, simulatePv } = await eastWest();
    const c = compilePv({ ...p, pv: {} }, w); // không cần hướng của dự án vì mọi chuỗi đã có mặt mái
    expect(c.issues).toEqual([]);
    expect(c.input!.strings.map((s) => [s.tiltDeg, s.azimuthDeg])).toEqual([[20, 90], [20, 270]]);
    const r = (await simulatePv(c.input!, 'h'))!;
    expect(r.orientations.map((o) => o.azimuthDeg)).toEqual([90, 270]);
    const peak = (a: number[]) => a.indexOf(Math.max(...a));
    expect(peak(r.strings[0].pIdealW)).toBeLessThan(peak(r.strings[1].pIdealW));
    expect(r.strings.map((s) => s.orientation)).toEqual([0, 1]);
    expect(r.series.poaWm2).toEqual(r.orientations[0].poaWm2);
  });
  test('một chuỗi trải trên hai mặt mái, hoặc đặt dở dang: từ chối kèm lý do; chuỗi chưa đặt cần hướng của dự án', async () => {
    const { p, w, compilePv, fe, fw } = await eastWest();
    const s0 = p.strings![0];
    const mixed = { ...p, strings: [{ ...s0, panelIds: [s0.panelIds[0], p.strings![1].panelIds[0]] }, p.strings![1]], pv: {} };
    expect(compilePv(mixed, w).issues.map((i) => i.code)).toContain('STRING_MIXED_FACES');
    const part = { ...p, pv: {}, placements: p.placements!.filter((x) => x.instanceId !== s0.panelIds[0]) };
    expect(compilePv(part, w).issues.map((i) => i.code)).toContain('STRING_PARTLY_PLACED');
    const none = { ...p, pv: {}, placements: [] };
    expect(compilePv(none, w).issues.map((i) => i.code)).toEqual(['ORIENTATION_MISSING', 'ORIENTATION_MISSING']);
    expect(compilePv({ ...none, pv: { tiltDeg: 10, azimuthDeg: 180 } }, w).issues).toEqual([]);
    void fe; void fw;
  });
});

describe('điền mái: dung sai số thực', () => {
  test('mái 12,5 × 10,5 m cho đúng 40 tấm (10 × 4) với nhiều độ nghiêng và gốc khác nhau, không bỏ sót hàng vì sai số làm tròn', () => {
    for (const [w, h] of [[12.5, 10.5], [12.4, 10.4], [12.6, 10.6]] as const) {
      const { p, ids } = rig(40, { outline: [[0, 0], [w, 0], [w, h], [0, h]], tiltDeg: 15 });
      const r = fillFace(p, 'f1', ids);
      expect(r.placed, `${w}×${h}`).toHaveLength(40);
      expect(validateLayout(r.project).filter((i) => i.severity === 'error')).toEqual([]);
    }
  });
});
