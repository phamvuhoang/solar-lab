import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { addObstacle, addRoofFace } from '../../src/domain/layout-edit';
import { addInstances, createProject } from '../../src/domain/project';
import type { Project } from '../../src/domain/types';
import { sunPosition } from '../../src/engine/solar';
import { blocked, buildOccluders, rayHitsBox, rayHitsCylinder, rayHitsTri, sunVector, triangulate, type OrientedBox, type Vec } from '../../src/shade/geometry';
import { buildShadeSpec, computeShade, directAccess, ShadeCache, shadedPoa } from '../../src/shade/sampler';
import { catalog, withSpecs } from './helpers';
import { wx } from './pv-helpers';

const box = (center: Vec, half: Vec, angleDeg = 0): OrientedBox => {
  const a = (angleDeg * Math.PI) / 180, ex: Vec = [Math.sin(a), Math.cos(a), 0], ey: Vec = [-Math.cos(a), Math.sin(a), 0];
  return { kind: 'box', id: 'b', label: 'b', center, axes: [ex, ey, [0, 0, 1]], half, min: [-9, -9, -9], max: [9, 9, 9] };
};
const unit = (v: Vec): Vec => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };

describe('vector Mặt Trời: Đông = +e, Bắc = +n', () => {
  test('hướng chuẩn: Đông, Bắc, Nam, Tây, thiên đỉnh', () => {
    const r = (v: Vec) => v.map((x) => +x.toFixed(9) + 0); // + 0 turns -0 into 0
    expect(r(sunVector(90, 90))).toEqual([1, 0, 0]);
    expect(r(sunVector(0, 90))).toEqual([0, 1, 0]);
    expect(r(sunVector(180, 90))).toEqual([0, -1, 0]);
    expect(r(sunVector(270, 90))).toEqual([-1, 0, 0]);
    expect(r(sunVector(123, 0))).toEqual([0, 0, 1]);
  });
  test('đông chí tại 11,87°N: trưa Mặt Trời ở phía Nam (n < 0) và cao; sáng ở phía Đông (e > 0), chiều phía Tây', () => {
    const at = (h: number, m = 0) => { const s = sunPosition(Date.UTC(2023, 11, 21, h, m) / 1000, 11.87, 108.2); return sunVector(s.azimuthDeg, s.apparentZenithDeg); };
    const noon = at(4, 47), morning = at(0, 30), afternoon = at(9, 0);
    expect(noon[1]).toBeLessThan(-0.5);
    expect(noon[2]).toBeGreaterThan(0.75);
    expect(morning[0]).toBeGreaterThan(0.3);
    expect(afternoon[0]).toBeLessThan(-0.3);
  });
});

describe('giao tia: ray sát cạnh không bị tính là che', () => {
  const b = box([0, 0, 0], [1, 1, 1]);
  test('hộp: trúng, trượt, sát mặt, sát cạnh, sát đỉnh; vừa vào trong 1 µm thì che, vừa ra ngoài thì không', () => {
    const d: Vec = [1, 0, 0];
    expect(rayHitsBox([-5, 0, 0], d, b)).toBe(true);
    expect(rayHitsBox([-5, 2, 0], d, b)).toBe(false);
    expect(rayHitsBox([-5, 1, 0], d, b)).toBe(false); // chạy dọc đúng mặt y = 1
    expect(rayHitsBox([-5, 1, 1], d, b)).toBe(false); // đúng cạnh
    expect(rayHitsBox([-5, 1 - 1e-6, 0], d, b)).toBe(true);
    expect(rayHitsBox([-5, 1 + 1e-6, 0], d, b)).toBe(false);
    expect(rayHitsBox([0, 2, 0], unit([1, -1, 0]), b)).toBe(false); // chỉ chạm đỉnh (1, 1)
    expect(rayHitsBox([0, 2, 0], unit([1, -1.0001, 0]), b)).toBe(true);
  });
  test('hộp xoay 45° và tia chiếu xiên từ trên xuống', () => {
    const r = box([0, 0, 0], [1, 1, 1], 45);
    expect(rayHitsBox([-5, 0, 0], [1, 0, 0], r)).toBe(true);
    expect(rayHitsBox([-5, -1.5, 0], [1, 0, 0], r)).toBe(false); // dưới đỉnh dưới của hình thoi (cách tâm 1,414)
    expect(rayHitsBox([-5, -1.3, 0], [1, 0, 0], r)).toBe(true); // sát đỉnh nhưng vẫn cắt
    expect(rayHitsBox([0, 0, 5], [0, 0, -1], r)).toBe(true);
    expect(rayHitsBox([5, 0, 5], unit([-1, 0, -1]), b)).toBe(true);
  });
  test('trụ tròn đúng (không phải đa giác): trúng, sát tiếp tuyến, trên nắp, rơi thẳng xuống nắp', () => {
    const c = { kind: 'cylinder' as const, id: 'c', label: 'c', cx: 0, cn: 0, z0: 0, z1: 2, r: 1, min: [-1, -1, 0] as Vec, max: [1, 1, 2] as Vec };
    expect(rayHitsCylinder([-5, 0, 1], [1, 0, 0], c)).toBe(true);
    expect(rayHitsCylinder([-5, 1, 1], [1, 0, 0], c)).toBe(false); // tiếp tuyến
    expect(rayHitsCylinder([-5, 0.999, 1], [1, 0, 0], c)).toBe(true);
    expect(rayHitsCylinder([-5, 0, 2.5], [1, 0, 0], c)).toBe(false);
    expect(rayHitsCylinder([0, 0, 5], [0, 0, -1], c)).toBe(true);
    expect(rayHitsCylinder([0, 0, 5], unit([1, 0, -0.5]), c)).toBe(false); // chạm đáy ngoài biên
    expect(rayHitsCylinder([-5, 0, 0], [1, 0, 0], c)).toBe(false); // ngang đúng mặt đáy: sát, không che
  });
  test('tam giác (mặt mái khác): hai chiều, chỉ phía trước', () => {
    const t = { a: [0, 0, 1] as Vec, b: [2, 0, 1] as Vec, c: [0, 2, 1] as Vec, faceId: 'f' };
    expect(rayHitsTri([0.5, 0.5, 0], [0, 0, 1], t)).toBe(true);
    expect(rayHitsTri([0.5, 0.5, 2], [0, 0, 1], t)).toBe(false); // tam giác nằm sau lưng
    expect(rayHitsTri([1.5, 1.5, 0], [0, 0, 1], t)).toBe(false);
    expect(rayHitsTri([0.5, 0.5, 0], [1, 0, 0], t)).toBe(false);
  });
  test('chia tam giác: mái chữ L giữ nguyên diện tích', () => {
    const L: [number, number][] = [[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]];
    const tris = triangulate(L);
    const area = tris.reduce((s, [i, j, k]) => s + Math.abs((L[j][0] - L[i][0]) * (L[k][1] - L[i][1]) - (L[k][0] - L[i][0]) * (L[j][1] - L[i][1])) / 2, 0);
    expect(tris).toHaveLength(4);
    expect(area).toBeCloseTo(28, 9);
  });
});

describe('trộn thành phần bức xạ (nghiệm thu)', () => {
  test('trực xạ 800, khuếch tán 200, phản xạ đất 0, direct access 0,5 → POA hiệu dụng 600 W/m²', () => {
    expect(shadedPoa(800, 200, 0, 0.5)).toBe(600);
  });
  test('tấm bị che hoàn toàn vẫn còn khuếch tán (và phản xạ) theo model; không che thì đủ', () => {
    expect(shadedPoa(800, 200, 30, 0)).toBe(230);
    expect(shadedPoa(800, 200, 30, 1)).toBe(1030);
  });
});

// ---- fixture ranh bóng: tường chắn phía Nam, tấm 1×1 m nằm ngang (nghiêng 0°) ----------------------------------
const panelOnWall = async (wall = true) => {
  const sq = withSpecs(catalog('vsun-620'), { lengthM: 1, widthM: 1 });
  let p = addInstances(createProject('shade'), sq, 1);
  p = addRoofFace(p, { label: 'phẳng', outline: [[0, 0], [10, 0], [10, 3], [0, 3]], holes: [], tiltDeg: 0, azimuthDeg: 180, origin: { e: 0, n: 0, up: 3 }, setbackM: 0.3, setbackSource: 'assumption' });
  const id = p.instances[0].instanceId;
  p = { ...p, placements: [{ instanceId: id, roofFaceId: p.roofFaces[0].roofFaceId, center: [5, 0.5], angleDeg: 0 }] };
  if (wall) p = addObstacle(p, { label: 'Tường', kind: 'box', roofFaceId: null, center: { e: 5, n: -1.4 }, baseUp: 3, angleDeg: 0, size: { x: 0.2, y: 10, z: 2 } });
  return { p, id };
};
const south45: Vec = sunVector(180, 45);
const weatherFor = (n = 24) => ({ t0: Date.UTC(2023, 11, 21) / 1000, stepSeconds: 3600, n, location: { latitude: 11.87, longitude: 108.2, elevationM: 0 } });

describe('direct access trên fixture ranh bóng', () => {
  test('tường cao 2 m phía Nam, Mặt Trời hướng Nam cao 45°: vùng bóng tới n = 0,639 m; 1 điểm = 0; 4×4 = 0,25; 8×8 = 0,375 (đúng: 0,361)', async () => {
    const { p } = await panelOnWall();
    const f = async (mode: 'preview' | 'standard', grid: number) => { const s = await buildShadeSpec(p, weatherFor(), { mode, grid }); return directAccess(s.panels[0], south45, s.occluders); };
    expect(await f('preview', 1)).toBe(0);
    expect(await f('standard', 4)).toBe(0.25);
    expect(await f('standard', 8)).toBe(0.375);
    expect(Math.abs((await f('standard', 4)) - (await f('standard', 8)))).toBeLessThanOrEqual(1 / 8 + 1e-9); // 4×4 so với lưới dày gấp đôi: ≤ 1/8 trên ranh bóng này
    expect(Math.abs((await f('standard', 8)) - 0.361)).toBeLessThan(0.02);
  });
  test('không có vật cản: access = 1; Mặt Trời ở sau lưng tấm: access = 0 dù không bị che', async () => {
    const { p } = await panelOnWall(false);
    const s = await buildShadeSpec(p, weatherFor(), { mode: 'standard', grid: 4 });
    expect(directAccess(s.panels[0], south45, s.occluders)).toBe(1);
    expect(directAccess(s.panels[0], [0, 0, -1], s.occluders)).toBe(0);
  });
  test('mặt mái khác che được: tia từ tấm quay về phía mái đối diện cao hơn bị chặn; tấm không tự che mình hay mái của nó', async () => {
    const { p } = await panelOnWall(false);
    const hi = addRoofFace(p, { label: 'dốc cao', outline: [[0, 0], [10, 0], [10, 2], [0, 2]], holes: [], tiltDeg: 80, azimuthDeg: 0, origin: { e: 10, n: -1.2, up: 3 }, setbackM: 0.3, setbackSource: 'assumption' });
    const s = await buildShadeSpec(hi, weatherFor(), { mode: 'standard', grid: 4 });
    expect(s.occluders.tris.length).toBeGreaterThan(0);
    const ownOnly = await buildShadeSpec(p, weatherFor(), { mode: 'standard', grid: 4 });
    expect(blocked(ownOnly.panels[0].samples[0], south45, ownOnly.occluders, ownOnly.panels[0].faceId)).toBe(false);
    expect(directAccess(s.panels[0], south45, s.occluders)).toBeLessThan(1);
  });
  test('chỉ số mẫu: số mẫu = lưới², ghi vị trí vật cản trong field', async () => {
    const { p } = await panelOnWall();
    const s = await buildShadeSpec(p, weatherFor(), { mode: 'standard', grid: 4 });
    expect(s.samplesPerPanel).toBe(16);
    expect(s.panels[0].samples).toHaveLength(16);
    const run = (await computeShade(s, null, [0, 1]))!;
    expect(run.field.obstacles).toEqual([{ id: expect.any(String), label: 'Tường', kind: 'box', center: [5, -1.4, 4], size: [0.2, 10, 2] }]);
    expect(run.field.modelVersion).toBe('shade-raycast-1.0.0');
    expect(run.field.stepSeconds).toBe(3600);
  });
});

describe('cache: hit/miss và invalidation', () => {
  test('tính một ngày: lần đầu tính, lần hai dùng lại hết; đêm có access 0 và vẫn đánh dấu xong', async () => {
    const { p } = await panelOnWall();
    const s = await buildShadeSpec(p, weatherFor(48), { mode: 'standard', grid: 4 });
    const cache = new ShadeCache();
    expect(cache.missing(s.key, s.n, 0, 24)).toBe(24);
    const a = (await computeShade(s, cache.get(s.key), [0, 24]))!;
    cache.put(a.field);
    expect([a.computed, a.reused]).toEqual([24, 0]);
    expect(cache.missing(s.key, s.n, 0, 24)).toBe(0);
    expect(cache.missing(s.key, s.n, 0, 48)).toBe(24); // ngày kế vẫn chưa có
    const b = (await computeShade(s, cache.get(s.key), [0, 24]))!;
    expect([b.computed, b.reused]).toEqual([0, 24]);
    expect(a.field.access[0][12]).toBe(0); // bước 12:00–13:00 UTC = 19:00–20:00 giờ địa phương: mặt trời đã lặn
    expect(a.field.access[0][3]).toBeGreaterThan(0); // 10:00–11:00 giờ địa phương: Mặt Trời cao phía Nam, tấm thấy một phần trời
    expect(Array.from(a.field.done.slice(0, 24)).every((x) => x === 1)).toBe(true);
  });
  test('lượt một ngày bắt đầu trước, xong sau lượt cả năm: cache vẫn đủ cả năm, không mất bước nào', async () => {
    const { p } = await panelOnWall();
    const s = await buildShadeSpec(p, weatherFor(48), { mode: 'standard', grid: 4 });
    const cache = new ShadeCache();
    const day = (await computeShade(s, cache.get(s.key), [24, 48]))!; // started on an empty cache
    const year = (await computeShade(s, null))!;
    cache.put(year.field);
    const want = Array.from(year.field.access[0]);
    cache.put(day.field); // finishes last
    expect(cache.missing(s.key, s.n, 0, s.n)).toBe(0);
    expect(Array.from(cache.get(s.key)!.access[0])).toEqual(want);
  });
  test('dời vật cản đổi key (miss); dời camera, đổi màu, đổi giá thì không; đổi lưới/mẫu, vị trí hay lưới thời gian đều đổi key', async () => {
    const { p } = await panelOnWall();
    const key = async (q: Project, g = 4, w = weatherFor()) => (await buildShadeSpec(q, w, { mode: 'standard', grid: g })).key;
    const k0 = await key(p);
    expect(await key(structuredClone(p))).toBe(k0);
    const moved = structuredClone(p); moved.obstacles![0].center.n += 0.5;
    expect(await key(moved)).not.toBe(k0);
    const repriced = structuredClone(p); repriced.snapshots.offers = [];
    expect(await key(repriced)).toBe(k0); // giá không phải đầu vào của bóng
    expect(await key(p, 5)).not.toBe(k0);
    expect(await key(p, 4, weatherFor(25))).not.toBe(k0);
    expect(await key(p, 4, { ...weatherFor(), location: { latitude: 12, longitude: 108.2, elevationM: 0 } })).not.toBe(k0);
    const noise = structuredClone(p); noise.obstacles![0].center.n += 1e-12; // rung số thực: không đổi key
    expect(await key(noise)).toBe(k0);
    const slid = structuredClone(p); slid.placements![0].center[0] += 0.1;
    expect(await key(slid)).not.toBe(k0);
  });
  test('hủy giữa chừng trả null; bước đã xong vẫn đúng; tính tiếp chỉ làm phần còn lại', async () => {
    const { p } = await panelOnWall();
    const s = await buildShadeSpec(p, weatherFor(48), { mode: 'standard', grid: 4 });
    let calls = 0;
    const cut = await computeShade(s, null, [0, 48], { batch: 4, isCancelled: () => ++calls > 3 });
    expect(cut).toBeNull();
  });
  test('hủy rồi tính tiếp dùng lại phần đã xong (cache không bị hỏng)', async () => {
    const { p } = await panelOnWall();
    const s = await buildShadeSpec(p, weatherFor(48), { mode: 'standard', grid: 4 });
    const field = (await computeShade(s, null, [0, 8]))!.field;
    const more = (await computeShade(s, field, [0, 16]))!;
    expect([more.reused, more.computed]).toEqual([8, 8]);
    expect(more.field).toBe(field);
  });
});

describe('không đọc pixel', () => {
  test('mã tính bóng không dùng readPixels, getImageData, toDataURL hay WebGL', () => {
    for (const f of readdirSync(new URL('../../src/shade/', import.meta.url))) {
      const src = readFileSync(new URL(`../../src/shade/${f}`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/readPixels|getImageData|toDataURL|WebGL|getContext/);
    }
  });
});

describe('dời vật cản ra rồi về', () => {
  test('dời 0,5 m về Nam rồi 0,5 m về Bắc cho đúng hình học cũ (cùng khóa cache), dù cộng trừ số thực', async () => {
    const { moveObstacle } = await import('../../src/domain/layout-edit');
    const { p } = await panelOnWall();
    const id = p.obstacles![0].obstacleId;
    let q = structuredClone(p); q.obstacles![0].center.n = -0.9; // giá trị không biểu diễn chính xác bằng nhị phân
    const back = moveObstacle(moveObstacle(q, id, 0, -0.5), id, 0, 0.5);
    expect(back.obstacles![0].center).toEqual(q.obstacles![0].center);
    const k = async (x: Project) => (await buildShadeSpec(x, weatherFor(), { mode: 'standard', grid: 4 })).key;
    expect(await k(back)).toBe(await k(q));
    expect(await k(moveObstacle(q, id, 0, -0.5))).not.toBe(await k(q));
  });
});
