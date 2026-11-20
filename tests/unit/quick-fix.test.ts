import { describe, expect, test } from 'vitest';
import { movePanels } from '../../src/domain/layout-edit';
import { validateLayout } from '../../src/domain/placement';
import { buildSampleHouse } from '../../src/domain/seed';
import { quickFixFor, quickFixForLayout } from '../../src/validation/quick-fix';
import { validateDesign } from '../../src/validation/strings';
import { catalog, rig, withSpecs, withStrings } from './helpers';

const panel = catalog('vsun-620');
const inv = (over: Record<string, number | null> = {}) => withSpecs(catalog('luxpower-sna6000wpv'), { mpptCount: 2, pvIscMaxPerMpptA: 25, pvImaxPerMpptA: 17, ...over });
const open = (p: Parameters<typeof validateDesign>[0], c: string) => validateDesign(p).filter((f) => f.code === c && f.status === 'fail');

describe('W13 quick fixes', () => {
  test('2 chuỗi cùng M1 vượt Isc → chuyển Chuỗi 2 sang M2, hết ISC_TRACKER', () => {
    const p = withStrings(rig(panel, inv(), 8), [{ n: 4, port: 'M1' }, { n: 4, port: 'M1' }]);
    const f = open(p, 'ISC_TRACKER')[0];
    const fix = quickFixFor(p, f)!;
    expect(fix.label).toBe('Chuyển Chuỗi 2 sang MPPT 2');
    expect(open(fix.apply(p), 'ISC_TRACKER')).toHaveLength(0);
  });
  test('một chuỗi 12 tấm vượt Voc lạnh → chia lại 6+6, hết VOC_COLD_ABS', () => {
    const big = withSpecs(panel, { vocV: 50, betaVoc: -0.0025 });
    const p = withStrings(rig(big, inv({ pvVocMaxV: 500 }), 12), [{ n: 12, port: 'M1' }]);
    const f = open(p, 'VOC_COLD_ABS')[0];
    const fix = quickFixFor(p, f)!;
    expect(fix.label).toBe('Chia lại số tấm mỗi chuỗi');
    const q = fix.apply(p);
    expect(q.strings!.map((s) => s.panelIds.length)).toEqual([6, 6]);
    expect(open(q, 'VOC_COLD_ABS')).toHaveLength(0);
  });
  test('tấm chồng nhau trên Nhà mẫu → đặt lại, validateLayout rỗng', () => {
    const base = buildSampleHouse();
    expect(validateLayout(base)).toEqual([]);
    const [a, b] = base.placements!;
    const bad = movePanels(base, [a.instanceId], [b.center[0] - a.center[0] + 0.5, b.center[1] - a.center[1]]);
    const issue = validateLayout(bad).find((i) => i.severity === 'error')!;
    const fix = quickFixForLayout(bad, issue)!;
    expect(fix.label).toBe('Đặt lại tấm vào chỗ trống');
    expect(validateLayout(fix.apply(bad))).toEqual([]);
  });
  test('không còn MPPT trống → null', () => {
    const p = withStrings(rig(panel, inv(), 8), [{ n: 4, port: 'M1' }, { n: 2, port: 'M1' }, { n: 2, port: 'M2' }]);
    expect(quickFixFor(p, open(p, 'ISC_TRACKER')[0])).toBeNull();
  });
});
