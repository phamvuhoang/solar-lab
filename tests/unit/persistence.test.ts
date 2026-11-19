import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { mkdirSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { BUILTIN_COMPONENTS, findComponent } from '../../src/catalog/catalog';
import { cloneForEdit } from '../../src/domain/component';
import { diff } from '../../src/domain/diff';
import { addInstances, createProject, openLamHa } from '../../src/domain/project';
import type { Component, Offer } from '../../src/domain/types';
import { DB_NAME, DB_VERSION, done, openDb } from '../../src/persistence/db';
import { exportProject, stageImport } from '../../src/persistence/exchange';
import { ConflictError, ProjectRepository } from '../../src/persistence/repository';

let factory: IDBFactory;
let n = 0;
const clock = () => `2026-11-19T10:00:${String(n++).padStart(2, '0')}Z`;
const open = () => ProjectRepository.open({ factory, now: clock });
beforeEach(() => { factory = new IDBFactory(); n = 0; });

const usedBattery = () => findComponent(BUILTIN_COMPONENTS, { modelId: 'used-battery', revision: 1 })!;
const offer = (id: string, seller: string, price: string): Offer => ({
  schemaVersion: 1, offerId: id, componentRef: { modelId: 'mdl-a', revision: 1 }, seller, recordedAt: '2026-11-19', region: null,
  priceMinor: price, currency: 'VND', unit: 'piece', tiers: [], vat: 'unknown', condition: 'new', shippingMinor: null,
  warrantyMonths: null, validUntil: null, label: 'chào giá',
});

describe('ProjectRepository', () => {
  test('lưu nháp rồi mở lại sau khi đóng DB (reload giữ draft)', async () => {
    let repo = await open();
    const p = await repo.createProject(openLamHa());
    const p2 = await repo.saveRevision(p.revision, { ...p, name: 'Lâm Hà nháp' });
    repo.close();
    repo = await open();
    expect(p2.revision).toBe(2);
    expect((await repo.listProjects())[0]).toMatchObject({ name: 'Lâm Hà nháp', headRevision: 2 });
    expect((await repo.loadRevision(p.projectId))?.name).toBe('Lâm Hà nháp');
    expect((await repo.loadRevision(p.projectId, 1))?.name).toBe('Lâm Hà');
    expect((await repo.listRevisions(p.projectId)).map((r) => r.revision)).toEqual([1, 2]);
  });

  test('hai tab sửa cùng revision: tab đến sau nhận ConflictError, không ghi gì', async () => {
    const tabA = await open();
    const tabB = await open();
    const p = await tabA.createProject(createProject('x'));
    await tabA.saveRevision(1, { ...p, name: 'A' });
    await expect(tabB.saveRevision(1, { ...p, name: 'B' })).rejects.toBeInstanceOf(ConflictError);
    expect((await tabB.loadRevision(p.projectId))?.name).toBe('A');
    expect((await tabB.listRevisions(p.projectId)).length).toBe(2);
  });

  test('createProject trùng ID bị từ chối', async () => {
    const repo = await open();
    const p = await repo.createProject(createProject('x'));
    await expect(repo.createProject(p)).rejects.toThrow('PROJECT_EXISTS');
  });

  test('hai báo giá cùng SKU chỉ sinh một technical revision', async () => {
    const repo = await open();
    const draft = (({ revision: _r, ...c }) => c)({ ...cloneForEdit(usedBattery(), 'mdl-a', 'tester', '2026-11-19T00:00:00Z') });
    const first = await repo.saveComponent(draft);
    await repo.saveOffer(offer('off-1', 'Kho A', '16000000'));
    const second = await repo.saveComponent({ ...draft, author: 'khác', editedAt: '2026-11-20T00:00:00Z', notes: 'báo giá thứ hai' });
    await repo.saveOffer(offer('off-2', 'Kho B', '15500000'));
    expect(first).toMatchObject({ created: true, ref: { modelId: 'mdl-a', revision: 1 } });
    expect(second).toMatchObject({ created: false, ref: { modelId: 'mdl-a', revision: 1 } });
    expect(await repo.listComponents()).toHaveLength(1);
    expect(await repo.listOffers()).toHaveLength(2);
  });

  test('sửa Ah trên bản nhân bản giữ nguyên dữ liệu gốc; sửa kỹ thuật tạo revision 2', async () => {
    const repo = await open();
    const orig = structuredClone(usedBattery());
    const copy = cloneForEdit(usedBattery(), 'mdl-a', 'tester', '2026-11-19T00:00:00Z');
    copy.specs.capacityAh.v = 180;
    const { revision: _r, ...draft } = copy;
    const r1 = await repo.saveComponent(draft);
    const edited = structuredClone(draft); edited.specs.capacityAh.v = 190;
    const r2 = await repo.saveComponent(edited);
    expect([r1.ref.revision, r2.ref.revision]).toEqual([1, 2]);
    expect(usedBattery()).toEqual(orig);
    expect(orig.specs.capacityAh.v).toBe(165);
    expect((await repo.listComponents()).map((c) => c.specs.capacityAh.v)).toEqual([180, 190]);
  });

  test('project cũ giữ snapshot cũ khi linh kiện có revision mới', async () => {
    const repo = await open();
    const copy = cloneForEdit(usedBattery(), 'mdl-a', 'tester', '2026-11-19T00:00:00Z');
    const { revision: _r, ...draft } = copy;
    const r1 = (await repo.saveComponent(draft)).component;
    let p = await repo.createProject(addInstances(createProject('x'), r1, 1));
    const edited = structuredClone(draft); edited.specs.capacityAh.v = 200;
    await repo.saveComponent(edited);
    p = (await repo.loadRevision(p.projectId))!;
    expect(p.snapshots.components[0].specs.capacityAh.v).toBe(165);
    expect(p.instances[0].componentRef).toEqual({ modelId: 'mdl-a', revision: 1 });
  });

  test('cloneProject tạo ID mới, bản gốc không đổi', async () => {
    const repo = await open();
    const p = await repo.createProject(openLamHa());
    const c = await repo.cloneProject(p.projectId);
    await repo.saveRevision(1, { ...c, name: 'đổi tên bản sao' });
    expect(c.projectId).not.toBe(p.projectId);
    expect((await repo.loadRevision(p.projectId))?.name).toBe('Lâm Hà');
    expect((await repo.listProjects()).length).toBe(2);
  });
});

describe('export / import', () => {
  test('round-trip: xuất rồi nhập lại giữ nguyên từng byte nội dung', async () => {
    const p = openLamHa();
    const staged = await stageImport(await exportProject(p), new Set());
    expect(staged).toMatchObject({ ok: true, renamed: false });
    expect(staged.ok && diff(p, staged.project)).toEqual([]);
  });

  test('ID trùng nhập thành bản sao mới, không ghi đè', async () => {
    const p = openLamHa();
    const staged = await stageImport(await exportProject(p), new Set([p.projectId]));
    expect(staged.ok && staged.renamed).toBe(true);
    expect(staged.ok && staged.project.projectId).not.toBe(p.projectId);
    expect(staged.ok && staged.project.name).toBe('Lâm Hà (bản nhập)');
  });

  test('sai đơn vị: báo đúng trường, nháp hiện tại không đổi', async () => {
    const repo = await open();
    const draft = await repo.createProject(openLamHa());
    const bad = structuredClone(draft);
    const bat = bad.snapshots.components.findIndex((c) => c.modelId === 'used-battery');
    bad.snapshots.components[bat].specs.nominalWh.u = 'kWh';
    bad.snapshots.components[bat].specs.capacityAh.v = -3;
    const staged = await stageImport(await exportProject(bad), new Set([draft.projectId]));
    expect(staged.ok).toBe(false);
    expect(!staged.ok && staged.issues.map((i) => [i.code, i.field])).toEqual(expect.arrayContaining([
      ['UNIT_MISMATCH', `/snapshots/components/${bat}/specs/nominalWh/u`],
      ['NEGATIVE', `/snapshots/components/${bat}/specs/capacityAh/v`],
    ]));
    expect(await repo.loadRevision(draft.projectId)).toEqual(draft);
  });

  test('file hỏng: JSON lỗi, sai format, quá lớn, thiếu trường bắt buộc', async () => {
    const code = async (t: string) => { const s = await stageImport(t, new Set()); return s.ok ? 'OK' : s.issues[0].code; };
    expect(await code('{nope')).toBe('INVALID_JSON');
    expect(await code('{"format":"other"}')).toBe('WRONG_FORMAT');
    expect(await code(' '.repeat(5_000_001))).toBe('TOO_LARGE');
    const doc = JSON.parse(await exportProject(openLamHa()));
    delete doc.project.name;
    const s = await stageImport(JSON.stringify(doc), new Set());
    expect(!s.ok && s.issues[0]).toMatchObject({ code: 'SCHEMA', field: '' });
  });

  test('sửa tay nội dung: nhập được nhưng cảnh báo HASH_MISMATCH', async () => {
    const doc = JSON.parse(await exportProject(openLamHa()));
    doc.project.name = 'Lâm Hà sửa tay';
    const s = await stageImport(JSON.stringify(doc), new Set());
    expect(s.ok && s.issues.map((i) => i.code)).toEqual(['HASH_MISMATCH']);
  });
});

// W01 evidence: two project snapshots from the clone→edit→save flow. Run: W01_EVIDENCE=docs/evidence/W01 pnpm test:unit
test.runIf(process.env.W01_EVIDENCE)('ghi snapshot bằng chứng W01', async () => {
  const dir = process.env.W01_EVIDENCE!;
  const repo = await open();
  const before = await repo.createProject(openLamHa());
  const copy = cloneForEdit(usedBattery(), 'mdl-lamha-battery-180', 'kỹ sư', '2026-11-19T10:00:00Z');
  copy.specs.capacityAh.v = 180;
  copy.specs.nominalWh.v = 9216;
  const { revision: _r, ...draft } = copy;
  const saved = (await repo.saveComponent(draft)).component as Component;
  let p = structuredClone(before);
  const old = p.instances.find((i) => i.kind === 'battery')!;
  p.instances = p.instances.filter((i) => i !== old);
  p = addInstances(p, saved, 1);
  const after = await repo.saveRevision(before.revision, p);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/snapshot-1-lam-ha-rev1.json`, JSON.stringify(before, null, 2));
  writeFileSync(`${dir}/snapshot-2-lam-ha-rev2-clone-180ah.json`, JSON.stringify(after, null, 2));
  writeFileSync(`${dir}/diff-rev1-rev2.json`, JSON.stringify(diff(before, after), null, 2));
});

describe('sau review W09: lỗi lưu trữ phải mang theo nguyên nhân', () => {
  test('lỗi ở một request (trùng khóa; Safari báo hết chỗ theo kiểu này) làm done() reject bằng chính lỗi đó, không phải null', async () => {
    const db = await openDb(factory, 'probe', 1);
    const tx = db.transaction('offers', 'readwrite');
    tx.objectStore('offers').add({ offerId: 'o1' });
    tx.objectStore('offers').add({ offerId: 'o1' }); // request thứ hai lỗi ConstraintError, nổi lên transaction
    const err = await done(tx).then(() => 'resolved', (e) => e);
    expect(err).not.toBeNull();
    expect((err as DOMException).name).toBe('ConstraintError');
    db.close();
  });
});

describe('sau review W09: tab cũ khi bản mới nâng kho', () => {
  test('tab khác mở kho ở phiên bản cao hơn: kết nối tab này đóng lại (không chặn bản mới) và tab này được báo để nhắc tải lại trang', async () => {
    let told = 0;
    const repo = await ProjectRepository.open({ factory, onClosed: () => told++ });
    await new Promise((ok, no) => { const r = factory.open(DB_NAME, DB_VERSION + 1); r.onsuccess = () => { r.result.close(); ok(null); }; r.onblocked = () => no(new Error('bị chặn')); });
    expect(told).toBe(1);
    expect(await repo.listProjects().then(() => 'mở', (e) => (e as DOMException).name)).toBe('InvalidStateError');
  });
});
