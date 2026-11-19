import { describe, expect, test } from 'vitest';
import { DISPATCH_VERSION } from '../../src/engine/dispatch';
import { ENGINE_VERSION } from '../../src/engine/pv';
import { SHADE_MODEL_VERSION } from '../../src/shade/geometry';
import { DB_VERSION } from '../../src/persistence/db';
import { PACKAGE_VERSION } from '../../src/reports/package';
// @ts-expect-error plain .mjs build script
import { buildManifest } from '../../scripts/make-manifest.mjs';

describe('manifest phát hành', () => {
  test('phiên bản engine, định dạng và DB trong manifest đúng bằng hằng số trong mã', () => {
    const m = buildManifest({ BUILD_ID: 'x', GIT_COMMIT: 'abc' });
    expect(m.engines).toEqual({ pv: ENGINE_VERSION, dispatch: DISPATCH_VERSION, shade: SHADE_MODEL_VERSION });
    expect(m.formats).toEqual({ project: 1, package: PACKAGE_VERSION, indexedDb: DB_VERSION });
    expect(m.app).toMatchObject({ version: '1.0.0-rc.1', buildId: 'x', commit: 'abc' });
  });
  test('xác định: hai lần tạo cho cùng nội dung; nói thẳng cái gì chưa được kiểm', () => {
    expect(JSON.stringify(buildManifest({ BUILD_ID: 'x' }))).toBe(JSON.stringify(buildManifest({ BUILD_ID: 'x' })));
    const m = buildManifest({});
    expect(m.verification.field).toContain('chưa đối chiếu thực địa');
    expect(m.catalog.unreviewed.length).toBe(m.catalog.components); // chưa thiết bị nào được người thứ hai kiểm datasheet
    expect(m.weather[0]).toMatchObject({ id: 'lam-ha-2023-pvgis-era5', rows: 8760 });
    expect(m.catalog.sha256.components).toMatch(/^[0-9a-f]{64}$/);
  });
});
