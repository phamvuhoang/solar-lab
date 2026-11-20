# Trải nghiệm v2 (W10–W15): kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng lại lớp vỏ thành một workspace "mở ra là thấy hệ thống": Nhà mẫu trong 3D, 5 bước, thanh sức khỏe tự cập nhật, ba độ sâu. Engine giữ nguyên; giao theo 6 wave, wave nào cũng dùng được ngay.

**Architecture:** `src/ui/app.ts` chỉ còn khởi động, router theo hash, trang đầu và luồng nhập. Mỗi dự án mở trong `src/ui/workspace.ts`: khung trên, thanh bước, bảng Thêm (trái), khung nhìn dùng chung (giữa, không dựng lại khi đổi bước), panel của bước (phải, chạy chính các hàm `renderX` hiện có) và thanh sức khỏe (dưới). Các hàm miền mới (`buildSampleHouse`, `restringPanels`, `addPanels`, `replaceComponent`, `describeChange`, `quickFixFor`) là hàm thuần trong `src/domain`/`src/validation`, có unit test. Tự chạy dùng worker và `Runner` sẵn có, khóa cache theo `simHash`.

**Tech Stack:** TypeScript 5.9 vanilla + `h()` (`src/ui/dom.ts`), Vite 7, Three.js 0.180 nạp lười, IndexedDB, Vitest 4 (môi trường node, không DOM), Playwright 1.64 (chạy trên `vite preview`, nên phải `pnpm build` trước e2e), Node 24, pnpm 10.

**Spec:** `docs/05-experience-v2.md` (đọc kèm; plan lập luận từ spec, không chép lại spec).

**Đã kiểm trên HEAD `4ba0e48` trước khi viết plan** (bằng test nháp, đã xóa): Nhà mẫu dựng như Task 6 cho 0 finding `fail`, đúng 2 `limited` (`BATTERY_CHARGE_LIMIT`, `BATTERY_DISCHARGE_LIMIT`) và 4 `unknown` (`VMP_HOT_MIN`, `VMP_COLD_MAX` × 2 chuỗi); thiếu 0 giờ/năm; mua lưới 343,4 kWh/năm (bóng xem trước), 339,8 kWh khi không bóng; 8→10 tấm chia lại 5+5 thì mua lưới 326,0 kWh, 8→12 tấm chia 6+6 thì 315,4 kWh, không có `fail`; mái Nam 15 × 3,25 m đặt đủ 12 tấm đứng một hàng; dự toán biết 15.872.000 đ, thiếu 2 dòng (inverter, pin Dyness) + 4 hạng mục (khung, dây, bảo vệ, công).

**Phụ thuộc vào 7 lựa chọn của người viết spec:** plan giả định chủ dự án duyệt cả 7. Đổi lựa chọn nào thì sửa đúng task đó: (1) lưới → Task 6 `sim`; (2) pin Dyness chưa giá → Task 6, 9; (3) giữ 2 giới hạn + 4 chưa đủ dữ liệu → Task 6; (4) nhánh bơm PV là khối thêm → Task 17; (5) `restringPanels` + mái rộng → Task 6, 13; (6) `devicePlacements` + khóa lại → Task 12; (7) phát hành 1.1 → Task 31.

## Global Constraints

- Giữ nguyên: vanilla TypeScript + `h()` (`src/ui/dom.ts`), Three.js nạp lười, IndexedDB, offline service worker, một lockfile, **không thêm dependency** (kể cả devDependency: không jsdom, không axe).
- `tests/fixtures/golden/lamha-matrix.json` và mọi unit test của engine phải xanh mà không sửa.
- `docs/release/input-lock.json` chỉ khóa lại ở wave đổi `schemas/` hoặc `data/` (chỉ W12, chỉ `schemas/project-v1.json`), bằng `node scripts/lock.mjs --write` sau khi đọc diff; số golden không đổi.
- Schema dự án chỉ thêm trường tùy chọn; `schemas/project-v1.json` (`additionalProperties: false`) cập nhật cùng lúc, kèm test nhập lại file rc.2.
- `openLamHa()` và `data/presets/lam-ha.json` giữ nguyên hành vi.
- E2E: điều khiển nào còn tồn tại thì giữ `id`; điều hướng đổi thì sửa test trong cùng task; không để `pnpm run ci` đỏ ở cuối bất kỳ wave nào.
- Báo cáo A4 (`.report-page`, `@media print`) không đổi bố cục; trang mới (bảng đấu nối) là trang riêng.
- Cơ bản được ẩn chi tiết, **không bao giờ** ẩn trạng thái lỗi / giới hạn / chưa đủ dữ liệu. Nhà mẫu luôn mang nhãn "mẫu minh họa"; giá thiếu hiện là thiếu. Thứ gì vẽ ra mà engine không tính (công tơ, tủ bảo vệ, kích thước mặc định) mang chữ "minh họa" và không có số liệu.
- Mọi thao tác trên 3D có đường tương đương bằng nút/danh sách dùng được bằng bàn phím.
- Chữ trong giao diện: tiếng Việt thường, giọng `src/lessons/glossary.ts`. Mã nguồn và commit: tiếng Anh, tiền tố `W1x:` như `git log`.
- Commit **không** thêm dòng `Co-Authored-By` hay ghi công AI (quy tắc của chủ repo). Repo công khai, độc lập: không nhắc tới repo riêng nào.
- Ngoài phạm vi (spec): đổi thuật toán PV/dispatch/bóng; loại thiết bị điện mới trong engine; nhiều inverter, ba pha; tài khoản, backend; đa ngôn ngữ; vẽ mái từ ảnh vệ tinh; đổi framework.

## Review Focus

1. **Thiết kế chỉ có cảnh báo cấu trúc** (vd. Lâm Hà vừa mở: 8 tấm chưa vào chuỗi, finding `fail`/`warning`) → ô Điện phải là "chưa đủ dữ liệu" kèm lý do, không bao giờ "đạt". Test: Task 2.
2. **Địa chỉ hash trỏ tới dự án không có** (đã xóa, bookmark từ máy khác) → về trang đầu kèm câu giải thích, không trắng trang. Test: Task 3.
3. **Tự chạy xong khi người dùng đang gõ dở một form** trong panel → giá trị đang gõ còn nguyên; kết quả mới chờ một nút "Hiện". Test: Task 20.
4. **Hai tab cùng sửa một dự án** → tab sau báo "đã được sửa ở tab khác" và có nút mở bản mới nhất ngay trong workspace (rc.2 chỉ có nút này ở trang dự án cũ, rất dễ rơi mất khi viết lại). Test: Task 3.
5. **Ô nhập tọa độ mới** nhận "11,87" như "11.87", từ chối vĩ độ ngoài [-90, 90] bằng câu rõ ràng, không lưu gì. Test: Task 8.

## Quy ước chạy

- Unit: `pnpm exec vitest run tests/unit/<file>.test.ts`
- E2E: `pnpm build && pnpm exec playwright test tests/e2e/<file>.spec.ts`
- Cuối mỗi wave: `pnpm run ci` (lock, import guard, typecheck, node test, vitest, build, Playwright) phải xanh.
- Test UI chỉ kiểm hàm thuần trong Vitest (không có DOM); phần DOM kiểm bằng Playwright.
- Helper e2e chung: `tests/e2e/nav.ts` (tạo ở Task 3, mở rộng ở Task 9, 24).

---

# W10 · Vỏ workspace

### Task 1: Địa chỉ theo hash và bảng bước

**Files:**
- Create: `src/ui/route.ts`
- Test: `tests/unit/route.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Step = 'bo-tri' | 'dau-noi' | 'chay-thu' | 'chi-phi' | 'bao-cao';
  export type Tab = 'mai' | 'bong' | 'thiet-ke' | 'pv' | 'he-thong' | 'du-toan' | 'thiet-bi' | 'bao-cao' | 'du-an';
  export interface StepDef { id: Step; n: number; label: string; tabs: { id: Tab; label: string; elId: string }[] }
  export const STEPS: readonly StepDef[];
  export interface Target { step: Step; tab: Tab; focusId?: string }
  export type Route = { kind: 'home' } | { kind: 'project'; projectId: string; step: Step; tab: Tab } | { kind: 'help'; page: 'bai-hoc' | 'phien-ban' };
  export function parseRoute(hash: string): Route | null;   // null = hash rỗng (app quyết định lần mở đầu)
  export function formatRoute(r: Route): string;
  export function stepOfTab(t: Tab): Step;
  export function tabDef(t: Tab): { id: Tab; label: string; elId: string };
  ```
- `STEPS` (giá trị cố định; `elId` là id nút cũ mà e2e đang dùng, giữ nguyên):

  | Step (n, label) | Tab id · label · elId |
  |---|---|
  | `bo-tri` (1, "Bố trí") | `mai` · Mái nhà 3D · `roof-btn`; `bong` · Bóng che · `shade-btn` |
  | `dau-noi` (2, "Đấu nối") | `thiet-ke` · Thiết kế · `design-btn` |
  | `chay-thu` (3, "Chạy thử") | `pv` · Mô phỏng PV · `pv-btn`; `he-thong` · Hệ thống (pin, tải, bơm) · `sim-btn` |
  | `chi-phi` (4, "Chi phí") | `du-toan` · Dự toán · `quote-btn`; `thiet-bi` · Thiết bị · `catalog-btn` |
  | `bao-cao` (5, "Báo cáo") | `bao-cao` · Báo cáo và chia sẻ · `report-btn`; `du-an` · Dự án · `project-btn` |

  Phần "cả năm" của Bóng che vẫn ở tab `bong` (W10–W12); từ W13 tự chạy tính bóng cả năm nên không cần tab riêng ở ③.

- [ ] **Step 1: Viết test hỏng**

```ts
import { describe, expect, test } from 'vitest';
import { STEPS, formatRoute, parseRoute, stepOfTab } from '../../src/ui/route';

describe('địa chỉ theo hash', () => {
  test('hash rỗng là chưa quyết; #/ là trang đầu; lạ thì về trang đầu', () => {
    expect(parseRoute('')).toBeNull();
    expect(parseRoute('#')).toBeNull();
    expect(parseRoute('#/')).toEqual({ kind: 'home' });
    expect(parseRoute('#/linh-tinh')).toEqual({ kind: 'home' });
    expect(parseRoute('#/bai-hoc')).toEqual({ kind: 'help', page: 'bai-hoc' });
  });
  test('dự án: thiếu bước → bước 1; thiếu tab hoặc tab không thuộc bước → tab đầu của bước', () => {
    expect(parseRoute('#/p/prj-1')).toEqual({ kind: 'project', projectId: 'prj-1', step: 'bo-tri', tab: 'mai' });
    expect(parseRoute('#/p/prj-1/chay-thu')).toEqual({ kind: 'project', projectId: 'prj-1', step: 'chay-thu', tab: 'pv' });
    expect(parseRoute('#/p/prj-1/chay-thu/he-thong')).toEqual({ kind: 'project', projectId: 'prj-1', step: 'chay-thu', tab: 'he-thong' });
    expect(parseRoute('#/p/prj-1/dau-noi/pv')).toEqual({ kind: 'project', projectId: 'prj-1', step: 'dau-noi', tab: 'thiet-ke' });
    expect(parseRoute('#/p/prj-1/khong-co')).toEqual({ kind: 'project', projectId: 'prj-1', step: 'bo-tri', tab: 'mai' });
  });
  test('khứ hồi mọi bước/tab; id dự án có ký tự lạ được mã hóa', () => {
    for (const s of STEPS) for (const t of s.tabs) {
      const r = { kind: 'project' as const, projectId: 'prj-a/b c', step: s.id, tab: t.id };
      expect(parseRoute(formatRoute(r))).toEqual(r);
      expect(stepOfTab(t.id)).toBe(s.id);
    }
  });
  test('5 bước, tab và elId không trùng', () => {
    expect(STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
    const tabs = STEPS.flatMap((s) => s.tabs);
    expect(new Set(tabs.map((t) => t.id)).size).toBe(tabs.length);
    expect(new Set(tabs.map((t) => t.elId)).size).toBe(tabs.length);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận hỏng** — `pnpm exec vitest run tests/unit/route.test.ts` → FAIL (không tìm thấy module).
- [ ] **Step 3: Viết `src/ui/route.ts`** theo Interfaces. Định dạng: `#/`, `#/p/<encodeURIComponent(id)>/<step>/<tab>`, `#/bai-hoc`, `#/phien-ban`. Module này không import DOM.
- [ ] **Step 4: Chạy lại** → PASS.
- [ ] **Step 5: Commit** — `git add src/ui/route.ts tests/unit/route.test.ts && git commit -m "W10: hash routes and the five-step table"`

### Task 2: Thanh sức khỏe (số tĩnh từ kiểm tra điện và dự toán)

**Files:**
- Create: `src/ui/health.ts`
- Test: `tests/unit/health.test.ts`

**Interfaces:**
- Consumes: `Target`, `Step`, `Tab` (Task 1); `validateDesign`, `Status` (`src/validation/strings.ts`); `buildQuote` (`src/cost/quote.ts`).
- Produces:
  ```ts
  export type CellKey = 'electric' | 'pv' | 'supply' | 'money';
  export interface HealthCell { key: CellKey; state: Status; text: string; missing: string | null; target: Target }
  export const STATE_LABEL: Record<Status, string>; // { pass: 'đạt', fail: 'có lỗi', limited: 'bị giới hạn', unknown: 'chưa đủ dữ liệu' }
  export function healthOf(p: Project): HealthCell[];          // luôn 4 ô theo thứ tự electric, pv, supply, money (W13 thêm tham số thứ hai)
  export function renderHealth(cells: HealthCell[], go: (t: Target) => void): HTMLElement; // footer#ws-health
  ```
- Quy tắc ô (ghim):
  - **electric**: không có instance → `unknown`, text `Điện: chưa có thiết bị`. Ngược lại đếm `err` = `status==='fail' && severity==='error'`, `lim` = `limited`, `unk` = `unknown` + số finding `fail` có `severity!=='error'` (cảnh báo cấu trúc). `state` = `err ? 'fail' : lim ? 'limited' : unk ? 'unknown' : 'pass'`. Text `Điện: ${err} lỗi · ${lim} giới hạn · ${unk} chưa đủ dữ liệu`. `missing` = message của finding đầu tiên làm ô thành `unknown`. Target `{ step: 'dau-noi', tab: 'thiet-ke', focusId: 'findings' }`.
  - **pv** / **supply** (W10): `unknown`, text `☀ chưa chạy` / `Cấp điện: chưa chạy`, `missing: 'chưa chạy thử'`, target ③ `pv` / `he-thong`.
  - **money**: `q = buildQuote(p)`, `n = q.missing.lineKeys.length + q.missing.scope.length`. Không có instance → `unknown`. Ngược lại `state = n ? 'unknown' : 'pass'`, text `${Number(q.knownSubtotalMinor).toLocaleString('vi-VN')} đ đã biết${n ? ` · thiếu ${n} giá` : ''}`. Target ④ `du-toan`.
- DOM: mỗi ô là `button#health-<key>` có `data-state`, chữ trạng thái (`STATE_LABEL`) luôn hiện cạnh màu; `footer` có `aria-live="polite"`.

- [ ] **Step 1: Viết test hỏng**

```ts
import { expect, test } from 'vitest';
import { openLamHa, createProject } from '../../src/domain/project';
import { healthOf } from '../../src/ui/health';
import { catalog, rig, withStrings } from './helpers';

const cell = (p: Parameters<typeof healthOf>[0], k: string) => healthOf(p).find((c) => c.key === k)!;

test('Lâm Hà vừa mở: chỉ có cảnh báo cấu trúc → Điện "chưa đủ dữ liệu", không bao giờ "đạt"', () => {
  const e = cell(openLamHa(), 'electric');
  expect(e.state).toBe('unknown');
  expect(e.text).toContain('0 lỗi');
  expect(e.missing).toContain('chưa thuộc chuỗi');
});
test('Lâm Hà: tiền đã biết 31.872.000 đ, thiếu 4 giá (khung, dây, bảo vệ, công)', () => {
  const m = cell(openLamHa(), 'money');
  expect(m.text).toContain('31.872.000'); expect(m.text).toContain('thiếu 4 giá'); expect(m.state).toBe('unknown');
});
test('chuỗi 12 tấm vượt Voc lạnh → Điện "có lỗi"', () => {
  const r = rig(catalog('vsun-620'), catalog('luxpower-sna6000wpv'), 12);
  expect(cell(withStrings(r, [{ n: 12, port: 'M1' }]), 'electric').state).toBe('fail');
});
test('dự án trống: Điện và tiền "chưa đủ dữ liệu"; PV và cấp điện "chưa chạy"', () => {
  const cs = healthOf(createProject('x'));
  expect(cs.map((c) => c.key)).toEqual(['electric', 'pv', 'supply', 'money']);
  expect(cs.every((c) => c.state === 'unknown')).toBe(true);
  expect(cs[1].text).toContain('chưa chạy');
});
```

- [ ] **Step 2: Chạy** `pnpm exec vitest run tests/unit/health.test.ts` → FAIL.
- [ ] **Step 3: Viết `src/ui/health.ts`** theo quy tắc trên.
- [ ] **Step 4: Chạy lại** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W10: health cells from design checks and quote"` (kèm hai file).

### Task 3: Vỏ workspace, tách `app.ts`, stylesheet, sửa e2e điều hướng

**Files:**
- Create: `src/ui/workspace.ts`, `src/ui/catalog.ts`, `src/ui/styles.css`, `tests/e2e/nav.ts`, `tests/e2e/workspace.spec.ts`
- Modify: `src/ui/app.ts` (còn: `startApp`, router, trang đầu, nhập file/gói/sao lưu), `src/main.ts` (`import './ui/styles.css'`), `index.html` (bỏ `<style>` inline; giữ `<footer>`), `src/ui/design.ts`, `src/ui/roof.ts`, `src/ui/shade.ts`, `src/ui/pv.ts`, `src/ui/sim.ts`, `src/ui/quote.ts`, `src/ui/report.ts`, `src/ui/imported.ts`, mọi `tests/e2e/*.spec.ts` có điều hướng.

**Interfaces:**
- Consumes: Task 1, Task 2; `ProjectRepository`, `History`, mọi `renderX` hiện có.
- Produces:
  ```ts
  // workspace.ts
  export interface WorkspaceDeps {
    root: HTMLElement; repo: ProjectRepository;
    say(m: string): void; message(): string; reloadNeeded(): boolean; reloadNote(): HTMLElement;
  }
  export interface Workspace { readonly projectId: string; show(step: Step, tab: Tab): Promise<void>; dispose(): void }
  export function openWorkspace(deps: WorkspaceDeps, project: Project): Workspace;
  // catalog.ts: catalogScreen/formScreen chuyển nguyên văn từ app.ts, render vào panel
  export function renderCatalog(ctx: { project: Project; repo: ProjectRepository; mutate(next: Project): Promise<void>; rerender(): void; say(m: string): void }): Promise<Node[]>;
  ```
- Ctx của màn hình cũ: bỏ `back()` và nút "Quay lại dự án"; mọi `goX()`/`openRoof()` thay bằng `go(tab: Tab): void`. Nút liên kết chéo giữ id và chữ (`#to-design`, `#to-shade`, `#open-roof`, `#sh-to-roof`, "Thời tiết và PV").
- DOM của workspace (id cố định, các wave sau dùng):
  `#ws` · `#ws-top` (chứa `h1` "Mekoniq Solar Lab", `button#ws-home` "Danh sách dự án", `h2#ws-name`, `#ws-rev` = `Đã lưu · r${revision}`, `p#status` luôn có mặt, `#ws-undo`/`#ws-redo`, `details#ws-help` chứa `#lessons-btn` "Bài học", `#ws-about` "Phiên bản và phạm vi kiểm chứng" và `#ws-export-all` "Xuất tất cả dự án (sao lưu)", `button#ws-latest` "Mở bản mới nhất" chỉ khi message có xung đột) · `nav#ws-steps` (nút `#step-<id>` text `${n} ${label}`, `aria-current="step"`) · `#ws-tabs` (`role=tablist`, nút theo `elId`, `aria-selected`) · `section#ws-panel` · `footer#ws-health`.
- Tab `du-an` = phần thân của `projectScreen` cũ trừ các nút điều hướng: `#devices`, `#bom-total`, "Bản nháp · revision N", "Xuất JSON", "Nhân bản dự án", "Lịch sử revision" + `#diff`, `#recorded-btn` (mở `renderImported` ngay trong panel).
- Router (`app.ts`): `hashchange` → `parseRoute(location.hash) ?? { kind: 'home' }`. `project`: nếu `workspace?.projectId === id` thì `show(step, tab)`, ngược lại `repo.loadRevision(id)`; không có → `say('Không tìm thấy dự án này trong trình duyệt (có thể đã bị xóa hoặc đang mở trên máy khác).')` rồi `location.replace('#/')`. `help` → trang Bài học / Phiên bản toàn màn hình, nút quay lại gọi `history.back()`. Mở dự án từ trang đầu = đặt hash `#/p/<id>/bo-tri/mai`.
- Vẽ lại: một lần sửa chỉ vẽ lại `#ws-panel`, `#ws-top` (revision, status) và `#ws-health`; không đụng khu khác. Logic `save`/`mutate`/`historyFor`/`focusKey`/`setSelection` chuyển nguyên văn từ `app.ts`.
- `styles.css`: token trên `:root` (`--bg --fg --muted --accent --ok --err --lim --unk --border --radius --space-1..4 --touch: 44px`), ghi đè trong `@media (prefers-color-scheme: dark)`; `button, input, select { min-height: var(--touch) }`; `@media (prefers-reduced-motion: reduce)` tắt transition/animation; mọi rule inline cũ của `index.html` chuyển nguyên văn. Lưới ≥ 720 px: vùng `top / steps / panel / health` (W10 Task 4 thêm `view`); < 720 px: một cột, `#ws-steps` `overflow-x: auto`, thanh sức khỏe một dòng cuộn ngang. In: giữ rule cũ và thêm `#ws-top, #ws-steps, #ws-tabs, #ws-health, #ws-panel > :not(.report-page) { display: none !important }`.
- `tests/e2e/nav.ts`:
  ```ts
  export async function tab(page: Page, t: Tab): Promise<void>; // bấm #step-<stepOfTab(t)> rồi #<tabDef(t).elId>
  ```

- [ ] **Step 1: Viết `tests/e2e/workspace.spec.ts` (hỏng)** với 5 test:
  - `'tải lại trang giữ đúng dự án, bước và tab; Back của trình duyệt về tab trước'`: mở Lâm Hà → `tab(page,'he-thong')` → `page.reload()` → `#ws-name` chứa "Lâm Hà", `#step-chay-thu` có `aria-current="step"`, `#sim-btn` có `aria-selected="true"`; `page.goBack()` → `#step-bo-tri` là bước hiện tại.
  - `'360 px: không cuộn ngang ở trang đầu và workspace'`: `setViewportSize({ width: 360, height: 740 })`; ở mỗi bước `document.scrollingElement.scrollWidth <= 360`; `#ws-health` hiển thị.
  - `'hash tới dự án không có → về trang đầu kèm lời giải thích'`: `goto('/#/p/prj-khong-co/bo-tri')` → URL kết thúc `#/`, `#status` chứa "Không tìm thấy dự án".
  - `'hai tab cùng sửa: tab sau báo xung đột và mở được bản mới nhất'`: hai `page` cùng context mở cùng dự án, sửa ở trang 1 rồi trang 2 → `#status` trang 2 chứa "đã được sửa ở tab khác"; bấm `#ws-latest` → `#ws-rev` tăng đúng revision của trang 1.
  - `'thanh sức khỏe: Lâm Hà chưa đủ dữ liệu, bấm ô tiền tới Dự toán'`: `#health-electric[data-state="unknown"]` chứa "chưa đủ dữ liệu"; `#health-money` chứa "31.872.000" và "thiếu 4 giá"; bấm → `#quote-known` hiển thị.
- [ ] **Step 2: Chạy** `pnpm build && pnpm exec playwright test tests/e2e/workspace.spec.ts` → FAIL.
- [ ] **Step 3: Tách `app.ts`**, viết `workspace.ts`, `catalog.ts`, `styles.css`; sửa ctx các màn hình cũ như trên. `pnpm typecheck` sạch.
- [ ] **Step 4: Chạy lại** `workspace.spec.ts` → PASS.
- [ ] **Step 5: Sửa e2e cũ** bằng `tests/e2e/nav.ts`: xóa mọi `getByRole('button', { name: 'Quay lại dự án' }).click()` và thay cú bấm điều hướng kế tiếp (`#pv-btn`, `#design-btn`, `#roof-btn`, `#shade-btn`, `#sim-btn`, `#report-btn`, "Dự toán", "Thiết bị") bằng `tab(page, …)`; dự án → trang đầu ("Quay lại") thành `#ws-home`; kiểm `#bom-total`/`#devices`/"Xuất JSON"/"Bản nháp · revision" sau `tab(page,'du-an')`; `getByRole('heading', { name: 'Lâm Hà' })` thành `#ws-name`. Kịch bản `uat.spec.ts` vẫn kiểm đúng các tiêu chí của `docs/uat/protocol.md`.
- [ ] **Step 6: Chạy toàn bộ** `pnpm build && pnpm exec playwright test` → mọi spec PASS (gồm in A4 trong `report.spec.ts`: `h1` ẩn, `#report` hiện, PDF A4).
- [ ] **Step 7: Commit** — `git commit -m "W10: workspace shell (steps, tabs, panel, health bar), hash router, stylesheet; e2e navigation updated"`

### Task 4: Khung nhìn 3D dùng chung, không dựng lại khi đổi bước

**Files:**
- Create: `src/ui/viewport.ts`
- Modify: `src/ui/roof.ts` (bỏ `view` cấp module, `releaseRoofView`, `failView`, khối "3. Xem" chỉ còn mặt bằng + `#sel-info`; `RoofState` còn `{ faceId, angle, stepCm }`), `src/ui/shade.ts` (bỏ view riêng; `ShadeCtx` thêm `setOverlay(o: Overlay): void`; `releaseShadeView` → `stopShadePlayback()` chỉ dừng `timer`), `src/ui/workspace.ts` (vùng `#ws-view`; xóa overlay khi rời tab `bong`), `src/ui/styles.css` (vùng `view`: giữa trên desktop, trên cùng ở điện thoại), `tests/e2e/workspace.spec.ts`.

**Interfaces:**
- Consumes: `createThreeView`, `Layers`, `ALL_LAYERS`, `Overlay`, `WebGLUnavailable` (`src/scene/three-view.ts`), `buildSceneModel`, `movePanels`.
- Produces:
  ```ts
  export interface ViewportHost { project(): Project; selection(): string[]; setSelection(ids: string[]): void; apply(next: Project): Promise<void> }
  export interface Viewport { el: HTMLElement; refresh(): void; setOverlay(o: Overlay): void; dispose(): void }
  export function createViewport(host: ViewportHost): Viewport; // el = section#ws-view
  ```
- Giữ nguyên id e2e đang dùng, nay nằm trong `#ws-view`: `#view3d-box`, `#webgl-fallback` (câu chứa "vẫn đầy đủ"), `#cam-overview`, `#cam-top`, `#measure-fps`, `#fps-result`, `#layer-roof|frame|panels|wires|labels`. Chiều cao canvas: `matchMedia('(max-width: 719px)').matches ? 300 : 440`. `onMove` → `host.apply(movePanels(…, { snap: true }))`, không phụ thuộc bước.

- [ ] **Step 1: Thêm test hỏng** vào `workspace.spec.ts`: `'khung nhìn giữ nguyên canvas khi đổi bước'` — mở Lâm Hà, `#add-demo-roof`, `#fill-face`, chờ `canvas[data-panels="8"]`, đánh dấu `canvas.dataset.mark = 'x'`, `tab(page,'du-toan')` rồi `tab(page,'bong')` → vẫn đúng canvas có `data-mark="x"` và `page.locator('canvas')` có đúng 1 phần tử.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Viết `viewport.ts`**, sửa `roof.ts`, `shade.ts`, `workspace.ts`.
- [ ] **Step 4: Chạy** `pnpm build && pnpm exec playwright test tests/e2e/workspace.spec.ts tests/e2e/roof.spec.ts tests/e2e/shade.spec.ts` → PASS (gồm test WebGL bị tắt và test cảm ứng/giảm chuyển động).
- [ ] **Step 5: Commit** — `git commit -m "W10: one persistent 3D viewport shared by every step"`

### Task 5: Bằng chứng W10

**Files:** Create `docs/waves/W10.md` (backlog cùng dạng `W09.md`), `docs/evidence/W10.md` (cùng cấu trúc `W09.md`: đã làm gì, lệnh, kết quả, ảnh 360 px và desktop, việc để lại); Modify `docs/waves/README.md` (thêm dòng W10).

- [ ] **Step 1:** `pnpm run ci` → xanh; dán tóm tắt kết quả vào evidence.
- [ ] **Step 2:** `node scripts/lock.mjs` → `input lock ok` (W10 không đổi `schemas/`, `data/`).
- [ ] **Step 3: Commit** — `git commit -m "W10: evidence and wave backlog"`

---

# W11 · Nhà mẫu, bắt đầu từ số 0, trang đầu

### Task 6: Hàm dựng Nhà mẫu

**Files:**
- Create: `src/domain/seed.ts`
- Test: `tests/unit/seed.test.ts`

**Interfaces:**
- Consumes: `createProject`, `addInstances` (`project.ts`); `buildLamHaConfig` (`presets.ts`); `addRoofFace`, `faceRect`, `fillFace`, `addObstacle` (`layout-edit.ts`); `BUILTIN_COMPONENTS`, `BUILTIN_OFFERS`, `findComponent`, `offersFor`; `location` của `data/presets/lam-ha.json`.
- Produces:
  ```ts
  export const SAMPLE_NAME = 'Nhà mẫu (minh họa)';
  export const SAMPLE_WEATHER_ID = 'lam-ha-2023-pvgis-era5';
  export function buildSampleHouse(now?: string, id?: string): Project;
  export const isSample = (p: Project) => p.name.startsWith('Nhà mẫu'); // ponytail: nhận theo tên; cần cờ trong schema nếu người dùng đổi tên mà vẫn phải giữ nhãn
  ```
- Thứ tự dựng (ghim giá trị): `createProject(SAMPLE_NAME, now, id)` + `location` Lâm Hà → `addInstances(vsun-620, 8, offers)` → `buildLamHaConfig(p, 'shared8', { inverter: luxpower-sna6000wpv, battery: dyness-dl5-0c, home: sample-home-load, pump: sample-pump-load, controller: sample-pump-controller }, offersOf)` → `addRoofFace(faceRect('Mái Nam (minh họa)', 15, 3.25, 10, 180, { e: 0, n: 0, up: 3 }))` → `addRoofFace(faceRect('Mái Bắc (minh họa)', 15, 3.25, 10, 0, { e: 15, n: 6.4, up: 3 }))` → `fillFace(p, mái Nam, 8 tấm).project` → `addObstacle({ label: 'Bồn nước', kind: 'cylinder', roofFaceId: null, center: { e: 10.5, n: -1 }, baseUp: 3, angleDeg: 0, size: { x: 1.2, y: 1.2, z: 1.8 } })` → gán `design: { coldCellTempC: 5, hotCellTempC: 70, iscFactor: 1, betaVmpAssumption: null, source: 'Giả định minh họa (như bài học và golden Lâm Hà)' }`, `pv: { weatherId: SAMPLE_WEATHER_ID }`, `sim: { gridAvailable: true, importAllowed: true, exportAllowed: false }`, `shade: { enabled: true, mode: 'preview' }`. Không gọi `openLamHa()`. Thiếu model trong catalog → `throw new Error('SEED_CATALOG')`.

- [ ] **Step 1: Viết test hỏng** (`tests/unit/seed.test.ts`), 5 test:

```ts
const T = '2026-11-20T00:00:00.000Z';
const ids = (p: Project) => { const seen = new Map<string, string>(); return canonicalJson(p).replace(/\b(?:prj|ins|str|edg|roof|obs)-[0-9a-z-]+/g, (m) => seen.get(m) ?? (seen.set(m, `#${seen.size}`), `#${seen.size - 1}`)); };

test('hợp lệ, không lỗi đỏ, đúng 2 giới hạn và 4 chưa đủ dữ liệu', () => {
  const p = buildSampleHouse(T), f = validateDesign(p);
  expect(hasErrors(validateProject(p))).toBe(false);
  expect(f.filter((x) => x.status === 'fail')).toEqual([]);
  expect(f.filter((x) => x.status === 'limited').map((x) => x.code).sort()).toEqual(['BATTERY_CHARGE_LIMIT', 'BATTERY_DISCHARGE_LIMIT']);
  expect(f.filter((x) => x.status === 'unknown').map((x) => x.code).sort()).toEqual(['VMP_COLD_MAX', 'VMP_COLD_MAX', 'VMP_HOT_MIN', 'VMP_HOT_MIN']);
});
test('8 tấm hợp lệ trên Mái Nam, 2 chuỗi 4+4 vào M1/M2, còn chỗ cho 4 tấm nữa', () => { /* validateLayout(p) = []; mọi placement ở mặt có label 'Mái Nam (minh họa)'; strings → [4,4] và ['M1','M2']; fillFace(addInstances(p, vsun, 4), mái Nam, 4 id mới).left = [] */ });
test('chạy cả năm PV + dispatch với thời tiết đóng gói và bóng xem trước', async () => {
  // weather = loadBundledWeather(SAMPLE_WEATHER_ID); field = computeShade(await buildShadeSpec(p, w, shadeSettingsOf(p)), null).field
  // compileSim(p, w, { shade: field }).issues = []; simulateSystem ok
  expect(r.dispatch.period.n).toBe(8760);
  expect(r.dispatch.ledger.toleranceOk).toBe(true);
  expect(r.dispatch.metrics.hoursShort).toBe(0);
  expect(r.dispatch.totals.gridImportWh).toBeGreaterThan(300_000);
  expect(r.dispatch.totals.gridImportWh).toBeLessThan(400_000); // đo được 343,4 kWh
  expect(r.dispatch.totals.exportWh).toBe(0);
}, 120000);
test('dự toán chỉ biết giá tấm: 15.872.000 đ; inverter và pin Dyness thiếu giá; tổng hoàn chỉnh null', () => { /* knownSubtotalMinor '15872000'; missing.lineKeys chứa 'design:luxpower-sna6000wpv@1' và 'design:dyness-dl5-0c@1'; totalMinor null */ });
test('dựng hai lần cho cùng nội dung (trừ id và thời điểm)', () => {
  expect(ids(buildSampleHouse(T, 'prj-a'))).toBe(ids(buildSampleHouse(T, 'prj-b')));
});
```

- [ ] **Step 2: Chạy** `pnpm exec vitest run tests/unit/seed.test.ts` → FAIL.
- [ ] **Step 3: Viết `src/domain/seed.ts`.**
- [ ] **Step 4: Chạy lại** → PASS; `pnpm exec vitest run tests/unit/regression-lamha.test.ts` vẫn PASS (golden không đổi).
- [ ] **Step 5: Commit** — `git commit -m "W11: sample house seed built from domain functions"`

### Task 7: Danh sách 9 bước theo trạng thái dự án

**Files:**
- Create: `src/app/progress.ts`
- Test: `tests/unit/progress.test.ts`

**Interfaces:**
- Consumes: `Target` (Task 1), `unplacedPanels`, `validateDesign`, `buildQuote`, `stringsOf`.
- Produces:
  ```ts
  export type ProgressId = 'noi-lap' | 'mai' | 'dat-tam' | 'inverter' | 'pin' | 'tai' | 'loi-do' | 'chay-thu' | 'gia';
  export interface ProgressItem { id: ProgressId; n: number; label: string; status: 'done' | 'todo' | 'optional'; action: Target & { label: string } }
  export function progressOf(p: Project, o: { simRan: boolean }): ProgressItem[];
  export const progressComplete: (items: ProgressItem[]) => boolean; // không còn 'todo'
  ```
- Điều kiện xong (ghim) và đích của nút chính:

  | n · id | Xong khi | Nút chính → đích |
  |---|---|---|
  | 1 · noi-lap | `p.location !== null && !!p.pv?.weatherId` | "Chọn nơi lắp" → ③ `pv`, focus `loc-lat` |
  | 2 · mai | `p.roofFaces.length > 0` | "Dựng mặt mái" → ① `mai`, focus `add-rect` |
  | 3 · dat-tam | có ≥ 1 tấm và `unplacedPanels(p).length === 0` | chưa có tấm: "Thêm tấm" → ② `thiet-ke`, focus `b-count`; có tấm chưa đặt: "Đặt tấm" → ① `mai`, focus `fill-face` |
  | 4 · inverter | có instance `inverter` | "Chọn inverter" → ② `thiet-ke`, focus `p-inv` |
  | 5 · pin | có `battery` → `done`, không có → `optional` | "Thêm pin (bỏ qua được)" → ② `thiet-ke`, focus `p-bat` |
  | 6 · tai | có tải mang `loadPlan` | chưa có tải: "Thêm tải" → ② focus `p-load`; có tải chưa lịch: "Đặt lịch tải" → ③ `he-thong` |
  | 7 · loi-do | có chuỗi nối đích và không finding `fail`+`error` | "Sửa lỗi đỏ" → ② focus `findings` |
  | 8 · chay-thu | `o.simRan` | "Chạy thử" → ③ `he-thong`, focus `sim-run` |
  | 9 · gia | `buildQuote(p).complete` | "Nhập giá còn thiếu" → ④ `du-toan` |

- [ ] **Step 1: Viết test hỏng**

```ts
const st = (p: Project, simRan = false) => progressOf(p, { simRan }).map((i) => i.status);
test('dự án trống: mọi bước còn làm, pin bỏ qua được', () => {
  expect(st(createProject('x'))).toEqual(['todo', 'todo', 'todo', 'todo', 'optional', 'todo', 'todo', 'todo', 'todo']);
});
test('Nhà mẫu: xong 7 bước đầu; còn chạy thử và giá', () => {
  expect(st(buildSampleHouse())).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'done', 'todo', 'todo']);
  expect(st(buildSampleHouse(), true)[7]).toBe('done');
});
test('Lâm Hà rc.2 vừa mở cũng có danh sách: có pin, còn lại chưa xong', () => {
  expect(st(openLamHa())).toEqual(['todo', 'todo', 'todo', 'todo', 'done', 'todo', 'todo', 'todo', 'todo']);
});
test('bước 3 đổi nút theo trạng thái: chưa có tấm → Thêm tấm; có tấm chưa đặt → Đặt tấm', () => { /* action.focusId 'b-count' rồi 'fill-face' */ });
```

- [ ] **Step 2: Chạy** → FAIL. **Step 3:** viết `progress.ts`. **Step 4:** chạy → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W11: nine-step progress derived from project state"`

### Task 8: Chọn nơi lắp và bộ thời tiết gần nhất

**Files:**
- Create: `src/weather/nearest.ts`, `src/ui/location.ts`
- Modify: `src/ui/pv.ts` (mục "0. Nơi lắp" ở đầu màn hình, dùng `renderLocationForm`)
- Test: `tests/unit/location.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // nearest.ts
  export const NEAR_KM = 50;
  export function kmBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number; // haversine, R = 6371 km
  export async function nearestBundled(latitude: number, longitude: number): Promise<{ id: string; label: string; km: number } | null>; // đọc location của từng BUNDLED_WEATHER
  // location.ts
  export function parseLocation(lat: string, lon: string): { ok: true; latitude: number; longitude: number } | { ok: false; message: string };
  export function renderLocationForm(p: Project, apply: (next: Project) => Promise<void>): HTMLElement; // #loc-lat #loc-lon #loc-save #loc-note
  ```
- Lưu: `location = { latitude, longitude, timezone: p.location?.timezone ?? 'Asia/Ho_Chi_Minh' }`; nếu `!p.pv?.weatherId` thì đặt `pv.weatherId = nearest.id`. `#loc-note`: trong `NEAR_KM` → `Dùng bộ thời tiết đóng gói "<label>" (cách <km> km).`; xa hơn → `Bộ thời tiết đóng gói gần nhất cách <km> km ("<label>"): kết quả sẽ lệch so với nơi lắp; nên nhập CSV thời tiết của nơi lắp ở mục Thời tiết.`
- Chọn theo tỉnh: **không làm trong plan này** (cần nguồn tọa độ tỉnh có giấy phép rõ; xem câu hỏi mở cuối plan).

- [ ] **Step 1: Viết test hỏng**

```ts
test('khoảng cách: Lâm Hà–TP.HCM ≈ 207 km; cùng điểm = 0', () => {
  expect(kmBetween({ latitude: 11.87, longitude: 108.2 }, { latitude: 10.82, longitude: 106.63 })).toBeCloseTo(207.2, 0);
  expect(kmBetween({ latitude: 11.87, longitude: 108.2 }, { latitude: 11.87, longitude: 108.2 })).toBe(0);
});
test('bộ gần nhất: Lâm Hà trùng điểm; Hà Nội xa hơn NEAR_KM', async () => {
  expect(await nearestBundled(11.87, 108.2)).toMatchObject({ id: 'lam-ha-2023-pvgis-era5', km: 0 });
  expect((await nearestBundled(21.03, 105.85))!.km).toBeGreaterThan(NEAR_KM); // ≈ 1.049 km
});
test('nhập tọa độ: dấu phẩy như dấu chấm; ngoài phạm vi hoặc chữ thì báo lỗi, không đoán', () => {
  expect(parseLocation('11,87', '108,2')).toEqual({ ok: true, latitude: 11.87, longitude: 108.2 });
  expect(parseLocation('11.87', '108.2')).toEqual({ ok: true, latitude: 11.87, longitude: 108.2 });
  expect(parseLocation('95', '108')).toMatchObject({ ok: false, message: expect.stringContaining('Vĩ độ') });
  expect(parseLocation('11', '200')).toMatchObject({ ok: false, message: expect.stringContaining('Kinh độ') });
  expect(parseLocation('abc', '108')).toMatchObject({ ok: false });
});
```

- [ ] **Step 2: Chạy** → FAIL. **Step 3:** viết hai module, nối vào `pv.ts` (dùng `parseNumber` của `src/domain/units.ts`). **Step 4:** chạy → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W11: site location form with nearest bundled weather"`

### Task 9: Xem thử không lưu, lần mở đầu, trang đầu dạng thẻ

**Files:**
- Create: `src/ui/home.ts`, `tests/e2e/first-run.spec.ts`
- Modify: `src/ui/route.ts` (+ `{ kind: 'preview'; what: 'mau' | 'moi' }` ↔ `#/mau`, `#/moi`), `tests/unit/route.test.ts`, `src/ui/app.ts`, `src/ui/workspace.ts`, `tests/e2e/*.spec.ts` (`page.goto('/')` → `page.goto('/#/')` ở mọi test bắt đầu từ trang đầu), `tests/e2e/nav.ts`

**Interfaces:**
- Consumes: `buildSampleHouse`, `isSample` (Task 6); `ProjectHead`.
- Produces:
  ```ts
  // workspace.ts (đổi chữ ký)
  export function openWorkspace(deps: WorkspaceDeps, project: Project, opts: { stored: boolean }): Workspace;
  // home.ts
  export interface HomeCard { projectId: string; name: string; panels: number; kWp: number; knownMinor: string; updatedAt: string }
  export function cardOf(head: ProjectHead, p: Project): HomeCard;
  export async function renderHome(ctx: { repo: ProjectRepository; say(m: string): void; message(): string; importFile(f: File): Promise<void>; openLamHa(): Promise<void> }): Promise<Node[]>;
  ```
- Xem thử: `stored: false` thì `save()` lần đầu gọi `repo.createProject(next)`, đặt `stored = true` và `history.replaceState(null, '', formatRoute({ kind: 'project', … }))` (không phát `hashchange`). Tải lại `#/mau` dựng seed mới, vẫn không lưu.
- Lần mở đầu (hash rỗng): không có dự án → `location.replace('#/mau')`; có → mở dự án có `updatedAt` mới nhất ở `bo-tri/mai`.
- Nhãn: `#ws-badge` "Mẫu minh họa · không phải báo giá" khi `isSample(p)`.
- Đổi tên (thay ô "Tên dự án" cũ của trang đầu): trong tab `du-an`, `#p-name` + `#p-name-save`.
- Trang đầu: ba lối vào cùng cỡ `#entry-sample` "Khám phá Nhà mẫu" (→ `#/mau`), `#entry-new` "Bắt đầu từ số 0" (→ `#/moi`, `createProject('Dự án mới')` chưa lưu), `#entry-open` "Mở / nhập" (khu chứa `#import-file`, `#export-all`, sao lưu). Mục "Mẫu": nút "Mở mẫu Lâm Hà" (giữ chữ, hành vi rc.2: lưu ngay). `ul#saved > li` mỗi thẻ có nút `Mở: ${name}` và dòng `8 tấm · 4,96 kWp · 31.872.000 đ đã biết · sửa <ngày>`; không có dự án → `p` "Chưa có dự án." như cũ. Giữ `#about-btn`, `#lessons-home-btn`, `.backup`, `.restore-backup`, `.delete-backup`, `#storage-note`.

- [ ] **Step 1: Test hỏng.** `tests/unit/route.test.ts` thêm `parseRoute('#/mau')` = `{ kind: 'preview', what: 'mau' }` và khứ hồi. Unit `cardOf`: Lâm Hà → `{ panels: 8, kWp: 4.96, knownMinor: '31872000' }` (thêm vào `tests/unit/seed.test.ts`). `tests/e2e/first-run.spec.ts`:
  - `'lần đầu mở: thấy Nhà mẫu ngay, có nhãn mẫu, không lưu gì'`: context mới, `goto('/')` → URL kết thúc `#/mau`; `#ws-name` chứa "Nhà mẫu"; `#ws-badge` chứa "minh họa"; `canvas[data-panels="8"]`; `#health-electric[data-state="limited"]` chứa "0 lỗi"; `#health-money` chứa "15.872.000" và "thiếu 6 giá"; `goto('/#/')` → `#saved` chứa "Chưa có dự án".
  - `'sửa lần đầu thì mới lưu'`: từ `#/mau` bấm `#add-box` (bước ①) → URL thành `#/p/prj-…/bo-tri/mai`; `goto('/#/')` → `#saved li` đếm 1.
  - `'tải lại #/mau vẫn là xem thử'` và `'lần sau mở lại dự án gần nhất'`: sau khi có 1 dự án, `goto('/')` → URL `#/p/<id>/…`.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Viết** `home.ts`, sửa router/workspace như trên; đổi `page.goto('/')` → `page.goto('/#/')` trong các e2e cũ.
- [ ] **Step 4: Chạy** `pnpm exec vitest run tests/unit/route.test.ts tests/unit/seed.test.ts` và `pnpm build && pnpm exec playwright test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W11: first visit opens the sample house unsaved; card home with three entries"`

### Task 10: Danh sách bước trong panel và ba chú thích lần đầu

**Files:**
- Create: `src/ui/checklist.ts`, `src/ui/coach.ts`, `tests/e2e/from-zero.spec.ts`
- Modify: `src/ui/workspace.ts`, `src/ui/sim.ts` (`Run` thêm `revision?: number`, gán khi chạy), `tests/e2e/first-run.spec.ts`

**Interfaces:**
- Consumes: `progressOf`, `progressComplete` (Task 7); `renderLocationForm` (Task 8).
- Produces:
  ```ts
  export function renderChecklist(items: ProgressItem[], go: (t: Target) => void, open: boolean): HTMLElement; // details#checklist, li[data-progress][data-status], nút #do-<id>
  export const COACH_KEY = 'solar-lab:coach-v1';
  export function startCoach(anchors: { view: HTMLElement; panel: HTMLElement; health: HTMLElement }): void; // #coach, #coach-next, #coach-skip
  ```
- `simRan` = `simState.runs.some((r) => r.source.kind === 'current' && r.revision === project.revision)` (W13 thay bằng kết quả tự chạy).
- `#checklist` đứng đầu `#ws-panel` khi `!progressComplete(items)`; mở sẵn khi dự án chưa có instance, còn lại thu gọn; `summary` = `Còn ${số todo} bước`.
- Chú thích chỉ hiện ở `#/mau` khi `localStorage[COACH_KEY]` chưa có (mọi truy cập localStorage bọc try/catch; lỗi thì coi như chưa xem và không ghi). Ba câu: (1) "Đây là một hệ thống điện mặt trời hoàn chỉnh: mái, 8 tấm pin, inverter, pin lưu trữ, tải và lưới. Tất cả là mẫu minh họa, không phải báo giá." gắn khung nhìn; (2) "Bấm vào một món trên hình hoặc trong danh sách bên phải để xem nó là gì và đổi nó." gắn panel; (3) "Sau mỗi lần sửa, nhìn thanh dưới cùng: lỗi điện, sản lượng, giờ thiếu điện và tiền thay đổi thế nào." gắn thanh sức khỏe. `#coach-next` "Tiếp" (câu cuối: "Xong"), `#coach-skip` "Bỏ qua".

- [ ] **Step 1: Test hỏng.** `first-run.spec.ts` thêm `'ba chú thích lần đầu, bỏ qua được, không hiện lại'` (thấy câu 1 → Tiếp → câu 2 → Tiếp → Xong → `#coach` biến mất → reload → không có `#coach`). `from-zero.spec.ts`: `'đi hết 9 bước từ số 0'` — `goto('/#/')` → `#entry-new` → `#checklist[open]`, 8 `todo` + 1 `optional`; làm từng bước qua nút `#do-<id>` và điều khiển sẵn có (tọa độ "11,87"/"108,2"; `#add-rect`; `#b-count` 8 + xác nhận; `#fill-face`; `#preset` `two-trackers` + `#apply-preset`; thêm pin; thêm tải + "Lưu lịch"; `#sim-run`; ở ④ thêm báo giá cho inverter và pin bằng form "Thêm báo giá" (`#o-seller`, `#o-price`) và tick `#waive-frame`, `#waive-cable`, `#waive-protection`, `#waive-labor`); sau mỗi bước `li[data-progress=<id>]` có `data-status="done"`; cuối cùng `#checklist` không còn.
- [ ] **Step 2: Chạy** → FAIL. **Step 3:** viết `checklist.ts`, `coach.ts`, nối vào workspace. **Step 4:** `pnpm build && pnpm exec playwright test tests/e2e/first-run.spec.ts tests/e2e/from-zero.spec.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W11: step checklist in the panel and first-visit callouts"`

### Task 11: Bằng chứng W11

Như Task 5: `docs/waves/W11.md`, `docs/evidence/W11.md` (ghi số đo của seed từ test Task 6, thời gian mở lần đầu trên máy dev), dòng trong `docs/waves/README.md`; `pnpm run ci` xanh; `node scripts/lock.mjs` ok. Commit `W11: evidence and wave backlog`.

---

# W12 · 3D toàn hệ thống

### Task 12: `devicePlacements`, khóa lại đầu vào, file rc.2 nhập lại không đổi hash

**Files:**
- Create: `tests/unit/compat-rc2.test.ts`, `tests/fixtures/rc2/lamha-8-tank.json`, `tests/fixtures/rc2/lamha-8-tank.hash.txt`
- Modify: `src/domain/types.ts`, `schemas/project-v1.json`, `src/domain/validate.ts`, `src/domain/graph.ts` (`dropInstances`), `docs/release/input-lock.json`

**Interfaces:**
- Produces:
  ```ts
  /** Illustrative position of a non-panel device in ENU metres. No calculation reads it. */
  export interface DevicePlacement { instanceId: string; e: number; n: number; up: number }
  // Project: devicePlacements?: DevicePlacement[]
  ```
- Schema: thuộc tính `devicePlacements` = mảng object `additionalProperties: false`, `required: ['instanceId','e','n','up']`, `instanceId` string `minLength: 1`, `e/n/up` number.
- `validateProject`: `DUPLICATE_ID` (field `devicePlacements`), `BROKEN_REF` tại `/devicePlacements/<i>/instanceId`, `NOT_A_DEVICE` khi trỏ vào tấm (tấm đặt trên mặt mái). `dropInstances` lọc luôn `devicePlacements`.

- [ ] **Step 1: Tạo fixture rc.2 trước khi đổi schema** (code vẫn là rc.2). Trong `compat-rc2.test.ts`, khi `process.env.WRITE_RC2_FIXTURE === '1'` thì ghi `exportProject(p)` và `simHash` của `p` vào hai file fixture, với `p` = Lâm Hà 8 tấm `shared8` + `demoGableRoof` + `fillFace` + bồn nước sát mái + `shade: { enabled: true, mode: 'standard', grid: 4 }` (dựng như `lamHa(8, 11, 'near')` trong `regression-lamha.test.ts`); khi thiếu file mà không có biến môi trường thì test FAIL. Chạy `WRITE_RC2_FIXTURE=1 pnpm exec vitest run tests/unit/compat-rc2.test.ts`, rồi commit riêng: `git commit -m "W12: rc.2 export fixture recorded before the schema change"`.
- [ ] **Step 2: Viết test hỏng** trong cùng file:

```ts
test('file rc.2 nhập lại được, không cảnh báo, hash kết quả bằng hash đã ghi lúc rc.2', async () => { /* stageImport(text, new Set()) ok, issues []; compileSim(staged, w, { shade }).hash === readFile(hash.txt).trim() */ }, 120000);
test('devicePlacements không vào phép tính', async () => { /* p2 = {...p, devicePlacements: [{ instanceId: inverterId, e: 20, n: 1, up: 0 }]}; validateProject(p2) không lỗi; hash(p2) === hash(p) */ });
test('xóa thiết bị kéo theo vị trí của nó', () => { /* dropInstances(p2, new Set([inverterId])).devicePlacements = [] */ });
test('kiểm tham chiếu: id lạ → BROKEN_REF; trỏ vào tấm → NOT_A_DEVICE; trùng → DUPLICATE_ID', () => { /* … */ });
```

- [ ] **Step 3: Chạy** → FAIL (schema từ chối `devicePlacements`).
- [ ] **Step 4: Sửa** types, schema, validate, `dropInstances`.
- [ ] **Step 5: Khóa lại có chủ đích:** `node scripts/lock.mjs` → báo `đã đổi: schemas/project-v1.json`; đọc `git diff schemas/`; `node scripts/lock.mjs --write`; `git diff docs/release/input-lock.json` chỉ đổi đúng sha của `schemas/project-v1.json`.
- [ ] **Step 6: Chạy** `pnpm exec vitest run` (toàn bộ, gồm golden) → PASS.
- [ ] **Step 7: Commit** — `git commit -m "W12: optional devicePlacements in the project schema; input lock re-locked for schemas/project-v1.json only"`

### Task 13: Thêm tấm có chia lại chuỗi, và mô tả thay đổi để xem trước

**Files:**
- Create: `src/domain/change.ts`, `tests/unit/add-panels.test.ts`
- Modify: `src/domain/presets.ts`

**Interfaces:**
- Consumes: `proposeStrings`, `addString`, `portsOf`, `indexProject`, `fillFace`, `validateDesign`, `buildSampleHouse`.
- Produces:
  ```ts
  /** Strings on this inverter made only of `modelKey` panels, plus unassigned panels of that model, re-split by proposeStrings over the MPPT ports no other string uses. Series order kept (existing strings in order, then unassigned in instance order). Throws NO_INVERTER, NO_FREE_MPPT. */
  export function restringPanels(p: Project, inverterId: string, modelKey: string): Project;
  /** Bảng Thêm "Tấm pin": addInstances, restring trên inverter đầu tiên (nếu có), đặt tấm mới lên mặt mái còn chỗ (mặt đang có tấm cùng model trước). */
  export function addPanels(p: Project, panel: Component, n: number, offers?: readonly Offer[]): { project: Project; left: number };
  // change.ts
  export function describeChange(before: Project, after: Project): string[];
  ```
- `restringPanels`: số cổng tự do dùng cho `proposeStrings` bằng cách truyền bản sao inverter có `mpptCount.v = freePorts.length` (ghi `ponytail:` — trần công suất mỗi tracker cũng chia theo số cổng tự do). Chuỗi mới qua `addString`, gán cổng tự do theo thứ tự.
- `describeChange` (khớp chuỗi theo `label`, số định dạng `vi-VN` một chữ số thập phân):
  - chuỗi đổi số tấm hoặc mới: `${label}: ${trước} → ${sau} tấm, Voc lạnh ${v}/${limit} V` (lấy từ finding `VOC_COLD_ABS` của `after`; chưa đủ dữ liệu thì `Voc lạnh chưa đủ dữ liệu`);
  - chuỗi mất: `${label}: bỏ`; finding `fail`+`error` mới: `Lỗi mới: ${message}`; instance mất: `Bỏ ${label}`; số edge mất k > 0: `Bỏ ${k} dây nối`; tấm chưa có vị trí tăng k: `${k} tấm chưa có chỗ trên mái`.

- [ ] **Step 1: Viết test hỏng**

```ts
const seed = () => buildSampleHouse('2026-11-20T00:00:00.000Z');
const sizes = (p: Project) => (p.strings ?? []).map((s) => [s.panelIds.length, s.target?.port]);
test('Nhà mẫu + 2 tấm: chia lại 5+5 vào M1/M2, không lỗi đỏ, 10 tấm trên Mái Nam', () => {
  const { project: p, left } = addPanels(seed(), catalog('vsun-620'), 2);
  expect(left).toBe(0);
  expect(sizes(p)).toEqual([[5, 'M1'], [5, 'M2']]);
  expect(validateDesign(p).filter((f) => f.status === 'fail')).toEqual([]);
  expect(validateLayout(p)).toEqual([]);
  expect(new Set(p.placements!.map((x) => x.roofFaceId)).size).toBe(1);
  expect(p.placements).toHaveLength(10);
});
test('Nhà mẫu + 4 tấm: 6+6, 12 tấm trên Mái Nam, không lỗi đỏ', () => { /* như trên với [[6,'M1'],[6,'M2']] và 12 */ });
test('addPanelBatch cũ vẫn xâu riêng tấm mới (giữ hành vi rc.2 cho form Thêm theo lô)', () => { /* addPanelBatch(seed, vsun, 2, inv) → 4 chuỗi */ });
test('xem trước nêu rõ chuỗi nào đổi', () => {
  const before = seed(), after = addPanels(before, catalog('vsun-620'), 2).project;
  expect(describeChange(before, after)).toEqual(expect.arrayContaining(['Chuỗi 1: 4 → 5 tấm, Voc lạnh 255,2/480 V', 'Chuỗi 2: 4 → 5 tấm, Voc lạnh 255,2/480 V']));
});
test('chuỗi model khác trên cùng inverter giữ nguyên; hết cổng tự do thì báo NO_FREE_MPPT', () => { /* rig: 4 Hestia-650 trên M2 + 4 VSUN trên M1, thêm 2 VSUN → VSUN [6] trên M1, chuỗi Hestia y nguyên; cả M1 và M2 bị model khác chiếm → throw 'NO_FREE_MPPT' */ });
```

- [ ] **Step 2: Chạy** → FAIL. **Step 3:** viết. **Step 4:** chạy → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W12: restringPanels and addPanels re-split the whole model; describeChange for previews"`

### Task 14: Đổi model, tải và bơm có lịch mặc định

**Files:**
- Modify: `src/domain/presets.ts`
- Test: `tests/unit/replace.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Same kind only. Keeps instance ids, so strings, edges, placements and load plans stay. Relabels "<new name> #k" keeping k. Throws KIND_MISMATCH, UNKNOWN_INSTANCE. */
  export function replaceComponent(p: Project, instanceIds: string[], next: Component, offers?: readonly Offer[]): Project;
  export const ALL_DAY: number[];                 // 24 × 1
  export const atHour: (h: number) => number[];   // 1 ở giờ h, còn lại 0
  export function addAcLoad(p: Project, load: Component, offers?: readonly Offer[], plan?: Omit<LoadPlan, 'instanceId'>): Project;      // tham số thứ 4 mới, tùy chọn
  export function addPumpBranch(p: Project, controller: Component, pump: Component, panels: string[], offers?: readonly Offer[], plan?: Omit<LoadPlan, 'instanceId'>): Project;
  ```
- Mặc định của bảng Thêm (Task 17 dùng): tải sinh hoạt `{ fractions: ALL_DAY, priority: 1 }`; bơm AC `{ fractions: atHour(18), priority: 2, pump: { staticHeadM: null, frictionK: null, curve: null } }`; bơm nhánh PV riêng `atHour(11)` (nhánh DC không có pin, 18h không còn nắng: golden `8tam-6+2-bom18h` phục vụ < 1 %).

- [ ] **Step 1: Viết test hỏng:** `'đổi pin Dyness → bộ pin cũ: giữ id, dây; dự toán biết tăng 16.000.000 đ'` (`knownSubtotalMinor` `'31872000'`, `edges` bằng trước); `'đổi 4 tấm của Chuỗi 1 sang Hestia 650: chuỗi và vị trí giữ nguyên, nhãn theo model mới'`; `'khác loại → KIND_MISMATCH'`; `'addAcLoad có lịch thì có loadPlan; không có lịch thì như cũ'`; `'Nhà mẫu + nhánh bơm PV riêng (2 tấm mới, controller, bơm 11h): không lỗi đỏ, compileSim không lỗi'` (đặt `shade: { enabled: false }` cho test này).
- [ ] **Step 2–4:** chạy FAIL → viết → PASS; `regression-lamha.test.ts` vẫn PASS.
- [ ] **Step 5: Commit** — `git commit -m "W12: replaceComponent; optional default schedules for added loads and pump branch"`

### Task 15: Thiết bị, dây và hình minh họa trong `SceneModel`

**Files:**
- Modify: `src/scene/model.ts`
- Test: `tests/unit/scene-devices.test.ts`

**Interfaces:**
- Consumes: `devicePlacements` (Task 12), `badgeOf`, `Finding`, `simPolicyOf`, `indexProject`.
- Produces (thêm vào `SceneModel`, chữ ký hàm thêm tham số tùy chọn):
  ```ts
  devices: { instanceId: string; kind: 'inverter' | 'battery' | 'controller' | 'load'; label: string; center: V3; size: { x: number; y: number; z: number }; sizeSource: 'spec' | 'illustrative'; placed: boolean; status: 'fail' | 'limited' | null }[];
  wires: { id: string; kind: 'dc-pv' | 'dc-bat' | 'dc-pump' | 'ac'; from: V3; to: V3; refId: string }[];   // refId = stringId hoặc edgeId
  props: { kind: 'meter' | 'protection'; label: string; center: V3 }[];                                      // chỉ minh họa, không số liệu
  export function buildSceneModel(p: Project, findings?: readonly Finding[]): SceneModel;
  ```
- Vách thiết bị (thiếu `devicePlacements`): thứ tự `inverter, battery, controller, load` rồi theo thứ tự instance; `e = max(e của mặt mái/vật cản, 0) + 1.5`, `n = minN + k × 1.2`, `center.up = size.z / 2`. Kích thước: pin có `lengthM/widthM/thicknessM` → `{ x: lengthM, y: widthM, z: thicknessM }`, `'spec'`; còn lại khối mặc định `'illustrative'`: inverter `0.5 × 0.2 × 0.6`, controller `0.3 × 0.15 × 0.4`, tải `0.6 × 0.6 × 0.9`. `status` từ `badgeOf(findings, id)`: `exceedsLimit` → `'fail'`, `powerLimited` → `'limited'`.
- Dây: chuỗi có đích → `dc-pv` từ tâm tấm cuối trong chuỗi (bỏ qua nếu chuỗi chưa đặt) tới thiết bị đích; edge pin → `dc-bat`; AC → `ac`; ra bơm DC → `dc-pump`.
- Props: `meter` "Công tơ (minh họa)" khi `simPolicyOf(p).gridAvailable`, cạnh inverter; `protection` "Tủ bảo vệ (minh họa)" khi có `costLines` loại `protection`. `bounds` gồm cả thiết bị.

- [ ] **Step 1: Viết test hỏng:** Nhà mẫu → kinds sắp xếp `['battery','inverter','load','load']`; pin `sizeSource 'spec'`, size `{ x: 0.558, y: 0.545, z: 0.15 }`; inverter `'illustrative'`; mọi `center.e > 15` (ngoài mái); wires đếm `{ 'dc-pv': 2, 'dc-bat': 1, ac: 2 }`; có `meter`, không có `protection`; với `validateDesign(p)` truyền vào thì inverter và pin `status 'limited'`; `devicePlacements` của inverter `{ e: 20, n: 2, up: 1 }` → `center` đúng vậy, `placed: true`; dựng hai lần cho JSON bằng nhau và mọi id trong model đều có trong dự án; dự án Lâm Hà `shared8` không có `devicePlacements` vẫn có đủ thiết bị.
- [ ] **Step 2–4:** FAIL → viết → PASS (test cũ của `roof.test.ts`/`shade.test.ts` vẫn xanh).
- [ ] **Step 5: Commit** — `git commit -m "W12: devices, conceptual wires and illustrative props in the scene model"`

### Task 16: Vẽ thiết bị trong 3D, ba chế độ khung nhìn, ngân sách FPS

**Files:**
- Modify: `src/scene/three-view.ts`, `src/ui/viewport.ts`, `src/ui/roof.ts` (bỏ mặt bằng khỏi panel, chuyển vào khung nhìn), `src/ui/design.ts` (bỏ `renderDiagram`, chuyển vào khung nhìn), `src/ui/styles.css`, `tests/e2e/roof.spec.ts`, `tests/e2e/design.spec.ts`, `tests/e2e/workspace.spec.ts`

**Interfaces:**
- Consumes: Task 15.
- Produces:
  ```ts
  // three-view.ts: thiết bị là hộp có nhãn; kích thước minh họa thì viền nét đứt và nhãn thêm " (kích thước minh họa)"; huy hiệu đỏ/vàng theo status;
  // dây: ac = Line liền, dc-pv = LineDashed (0,3/0,15), dc-bat và dc-pump = LineDashed (0,08/0,08); lớp "wires" bật/tắt mọi dây, lớp "labels" mọi nhãn.
  // Chọn bằng raycast gồm cả thiết bị → onSelect([instanceId], mode). canvas.dataset.devices (id nối bằng dấu phẩy) và dataset.devicePos (như panelPos) cho e2e.
  // viewport.ts
  export type ViewMode = '3d' | 'diagram' | 'plan';
  export interface Viewport { el: HTMLElement; refresh(): void; setOverlay(o: Overlay): void; setMode(m: ViewMode): void; dispose(): void }
  ```
- Nút chế độ `#view-mode-3d` "3D", `#view-mode-diagram` "Sơ đồ", `#view-mode-plan` "Mặt bằng" (`aria-pressed`). Sơ đồ = `renderDiagram(p, findings, selected, onSelect)`; Mặt bằng = `renderFacePlan` cho từng mặt mái với các handler roof cũ (dịch, xoay, xóa vị trí, bỏ chọn; giữ phím ←→↑↓, Shift, R, Delete, Esc). Chú giải `#view-legend` bằng chữ: "— AC · - - DC từ tấm · ··· DC pin/bơm · khung nét đứt = kích thước minh họa".
- Mặc định `'3d'`; khi Three.js đang tải hoặc không dùng được: hiện Mặt bằng (không có mặt mái thì Sơ đồ) cùng `#webgl-fallback`, nút 3D bị tắt nếu lỗi. Người dùng chọn chế độ nào thì giữ chế độ đó trong phiên.

- [ ] **Step 1: Test hỏng.** `workspace.spec.ts`: `'Nhà mẫu trong 3D có 4 thiết bị, chú giải bằng chữ, công tơ ghi minh họa'` (`canvas[data-devices]` 4 id; `#view-legend` chứa "AC" và "minh họa"); `'WebGL tắt: khung nhìn là Mặt bằng, chọn tấm vẫn được'`. `roof.spec.ts`: thêm FPS cho 40 tấm + 10 vật cản + thiết bị của Nhà mẫu, cùng ngưỡng với test FPS W06 hiện có.
- [ ] **Step 2: Chạy** → FAIL.
- [ ] **Step 3: Viết;** trong `roof.spec.ts`/`design.spec.ts` bấm `#view-mode-plan` / `#view-mode-diagram` trước các bước tương tác với mặt bằng/sơ đồ.
- [ ] **Step 4: Chạy** `pnpm build && pnpm exec playwright test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W12: devices and wires drawn in 3D; 3D / diagram / plan modes; 2D first while Three.js loads"`

### Task 17: Lựa chọn chung, panel "Đang chọn", bảng Thêm, Xóa, Đổi model

**Files:**
- Create: `src/ui/inspector.ts`, `src/ui/palette.ts`, `tests/e2e/system3d.spec.ts`
- Modify: `src/ui/workspace.ts` (lựa chọn mọi loại; cột trái `#ws-add`), `src/domain/layout-edit.ts` (`moveDevice`), `src/ui/styles.css`, `src/ui/quote.ts` (bấm dòng BOM chọn các instance của model đó)
- Test: `tests/unit/replace.test.ts` (thêm `moveDevice`)

**Interfaces:**
- Consumes: Task 13, 14, 15, 16; `addBatteryBranch`, `addRoofFace`, `faceRect`, `addObstacle`, `dropInstances`, `fillFace`.
- Produces:
  ```ts
  // layout-edit.ts
  export function moveDevice(p: Project, instanceId: string, dE: number, dN: number, from: V3): Project; // upsert devicePlacements từ vị trí hiện tại, làm tròn 1e-6 m
  // inspector.ts
  export interface InspectorCtx { project: Project; selection: string[]; findings: Finding[]; components: Component[]; offers: Offer[]; apply(next: Project): Promise<void>; select(ids: string[]): void; go(t: Target): void }
  export function renderInspector(ctx: InspectorCtx): HTMLElement;   // section#inspector, đầu #ws-panel
  // palette.ts
  export interface PaletteCtx { project: Project; components: Component[]; offers: Offer[]; apply(next: Project): Promise<void> }
  export function renderPalette(ctx: PaletteCtx): HTMLElement;       // aside#ws-add
  ```
- Lựa chọn trong workspace là danh sách instance id mọi loại (thêm id vật cản và id chuỗi khi chọn từ sơ đồ). Id từ sơ đồ: `inst:port` → instance; id chuỗi → các tấm của chuỗi.
- `#inspector`: chưa chọn → "Chưa chọn gì. Bấm một món trên hình hoặc trong danh sách."; tấm của một chuỗi → `Chuỗi k · n tấm → MPPT m` + `Voc lạnh v/limit V`; thiết bị → tên, model, kết nối, trạng thái finding bằng chữ. Nút: `#insp-replace` "Đổi model" (`#insp-model` chỉ liệt kê cùng loại → `#insp-preview` từ `describeChange` → `#insp-confirm`), `#insp-delete` "Xóa" (xem trước những gì bị kéo theo → `#insp-confirm`), `#insp-why` "Vì sao?" (→ ② với finding đầu của đối tượng), thiết bị có `#insp-move-left|right|up|down` (bước 0,1 m, `moveDevice`).
- Phím Delete trên canvas/mặt bằng khi đang chọn thiết bị mở cùng bước xem trước của `#insp-delete`.
- Bảng Thêm: `#add-panel` "Tấm pin" (`#add-panel-n`, mặc định 2; model = model tấm đang có trong dự án, không có thì `vsun-620`) → `addPanels`; `#add-inverter` "Inverter" (có rồi → `replaceComponent`, chưa có → `addInstances` + `restringPanels` cho từng model tấm); `#add-battery` "Pin" → `addBatteryBranch` (pin đầu tiên trong catalog); `#add-load` "Tải" → `addAcLoad(…, { fractions: ALL_DAY, priority: 1 })`; `#add-pump-ac` "Bơm (AC)" → `addAcLoad` lịch 18h; `#add-pump-pv` "Bơm cấp bằng tấm riêng" → 2 tấm mới (`addInstances` + `fillFace`) + `addPumpBranch(…, lịch 11h)`; `#add-face` "Mặt mái" (rộng, dài theo dốc, nghiêng, hướng → `faceRect`); `#add-obstacle` "Vật cản" (hộp/trụ, kích thước, tâm). Mỗi mục: chọn → `#add-preview` (dòng từ `describeChange`) → `#add-confirm` "Xác nhận" / `#add-cancel` "Thôi". Mỗi xác nhận là một revision, hoàn tác bằng `#ws-undo`.
- Lỗi miền (`NO_INVERTER`, `NO_FREE_MPPT`, `KIND_MISMATCH`) hiện bằng câu thường trong `#add-preview`/`#insp-preview`, không lưu gì.

- [ ] **Step 1: Test hỏng.** Unit `'moveDevice cộng dồn từ vị trí hiện tại'`. `system3d.spec.ts`:
  - `'chọn pin trên 3D → đổi model → tiền đổi → hoàn tác'`: bấm vị trí pin theo `data-device-pos` → `#inspector` chứa "Dyness" → `#insp-replace`, chọn "Bộ pin cũ", `#insp-confirm` → `#health-money` chứa "31.872.000" → `#ws-undo` → "15.872.000".
  - `'thêm 2 tấm từ bảng Thêm: xem trước nêu chuỗi đổi, 3D có 10 tấm, không lỗi đỏ'`: `#add-panel` → `#add-preview` chứa "Chuỗi 1: 4 → 5 tấm" → `#add-confirm` → `canvas[data-panels="10"]`, `#health-electric` chứa "0 lỗi".
  - `'chỉ bàn phím: thêm tải, chọn trong danh sách, xóa có báo dây bị kéo theo'`: dùng `focus()` + `Enter` (không `click`) qua `#add-load`, `#add-confirm`, nút chọn tải trong danh sách thiết bị ở ②, `#insp-delete` (xem trước chứa "Bỏ 1 dây nối"), `#insp-confirm`.
  - `'phím Delete trên 3D mở xem trước xóa'`.
- [ ] **Step 2: Chạy** → FAIL. **Step 3:** viết. **Step 4:** `pnpm exec vitest run tests/unit/replace.test.ts` và `pnpm build && pnpm exec playwright test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W12: shared selection for every device, inspector (replace, delete with preview), add palette"`

### Task 18: Bằng chứng W12

Như Task 5, thêm vào evidence: diff khóa đầu vào (chỉ `schemas/project-v1.json`), hash rc.2 khớp, FPS đo được (máy dev + Android tầm trung nếu có, như W07/W09). Commit `W12: evidence and wave backlog`.

---

# W13 · Kết quả tự cập nhật

### Task 19: Bộ hẹn giờ tự chạy và cache

**Files:**
- Create: `src/app/autorun.ts`
- Test: `tests/unit/autorun.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const AUTORUN_DELAY_MS = 1000; // chỉnh theo phép đo máy dev + Android tầm trung (spec để lại cho wave)
  export function createScheduler(delayMs: number): { schedule(task: (signal: AbortSignal) => Promise<void>): void; cancel(): void };
  export class Lru<V> { constructor(max: number); get(key: string): V | undefined; set(key: string, v: V): void }
  ```
- `schedule`: hủy (`abort`) lượt trước dù đang chờ hay đang chạy, hẹn lượt mới sau `delayMs` với `AbortController` mới. `Lru.get` làm mới thứ tự.

- [ ] **Step 1: Viết test hỏng** (dùng `vi.useFakeTimers()`): `'gom nhiều lần sửa trong 1 giây thành một lượt'` (A lúc 0, B lúc 300 ms → chỉ B chạy sau 1.300 ms); `'sửa mới hủy lượt đang chạy'` (signal của A `aborted` khi B được hẹn); `'cancel() hủy lượt đang chờ'`; `'Lru bỏ mục cũ nhất, get làm mới thứ tự'` (max 2: set a, b, get a, set c → b mất).
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W13: debounced, cancellable scheduler and LRU cache"`

### Task 20: Tự chạy PV + bóng + dispatch; thanh sức khỏe sống

**Files:**
- Create: `src/app/auto-sim.ts`, `tests/unit/auto-sim.test.ts`, `tests/e2e/autorun.spec.ts`
- Modify: `src/ui/health.ts` (`healthOf(p, auto)`), `src/domain/units.ts` (`formatKWh`), `src/ui/sim.ts` (dùng `formatKWh`; nút `#shade-standard` "Tính bóng chuẩn (cho báo cáo)" khi bóng đang xem trước), `src/ui/workspace.ts`, `src/app/progress.ts` (không đổi chữ ký; workspace truyền `simRan` từ trạng thái tự chạy), `tests/unit/health.test.ts`

**Interfaces:**
- Consumes: Task 19; `Runner` (`src/reports/replay.ts`, đã có `browserRunner` trong `src/ui/imported.ts`); `compileSim`, `buildShadeSpec`, `shadeSettingsOf`, `shadeCache`, `simMetrics`.
- Produces:
  ```ts
  export type AutoState =
    | { kind: 'idle' } | { kind: 'running' }
    | { kind: 'blocked'; message: string; target: Target }
    | { kind: 'done'; hash: string; result: SimResult; shadePreview: boolean };
  export async function runAuto(p: Project, deps: { loadWeather(id: string): Promise<WeatherSeries | undefined>; runner: Runner; cache: Lru<SimResult>; signal: AbortSignal }): Promise<AutoState>;
  export function healthOf(p: Project, auto?: AutoState): HealthCell[];   // health.ts
  export const formatKWh: (wh: number) => string;                        // units.ts; giống `kwh` hiện có của sim.ts
  ```
- `runAuto`: không `weatherId` → `blocked` "chưa đủ dữ liệu: thiếu thời tiết" đích ③ `pv` focus `wx-select`; bật bóng → spec theo **cài đặt của dự án** (Nhà mẫu và dự án mới mặc định `preview`; dự án cũ đặt `standard` thì tính chuẩn), lấy từ `shadeCache` hoặc `runner.shade`, ghi lại vào `shadeCache`; `compileSim` có issue → `blocked` với message của issue đầu, đích theo mã (`ORIENTATION_MISSING` → ③ `pv` focus `pv-tilt`; `LOAD_PLAN_MISSING` → ③ `he-thong`; `NO_STRINGS`/`INVERTER_COUNT`/`STRING_*` → ② `thiet-ke`; còn lại ③ `he-thong`); cache trúng theo `hash` → `done`; không thì `runner.sim`. `signal` bị hủy → `idle`, không ghi cache.
- Ô sống: `running` → pv/supply `unknown`, text `☀ đang tính lại…` / `Cấp điện: đang tính lại…` (không kèm số cũ). `blocked` → `unknown`, `missing = message`, `target` của trạng thái. `done` → số lấy từ `simMetrics(result)`: pv `pass`, text `☀ ${MWh} MWh/năm` (MWh = `pv.eInverterWh/1e6`, tối đa 2 chữ số thập phân) + ` (bóng: xem trước)` khi `shadePreview`; supply `hoursShort > 0 ? 'limited' : 'pass'`, text `Cấp điện: thiếu ${giờ} giờ/năm` + (`gridAvailable`) ` · mua lưới ${formatKWh(dispatch.gridImportWh)} kWh`.
- Workspace: mỗi lần dự án đổi → đặt `auto = running`, vẽ lại thanh sức khỏe, `schedule(runAuto…)`. Khi xong: cập nhật thanh và khung nhìn; nếu tab là `he-thong` hoặc `pv` thì đưa kết quả thành run "hiện tại" trong `simState` khi chưa có run hợp lệ nào (không đè cặp A/B người dùng đã chạy); **vẽ lại panel chỉ khi trong panel không có `input`/`select`/`textarea` đang focus**, ngược lại hiện `#ws-fresh` "Có kết quả mới · Hiện". Nút "Chạy" ở từng màn hình giữ nguyên.

- [ ] **Step 1: Test hỏng.** Unit `auto-sim.test.ts` (runner trong tiến trình: `computeShade` + `simulateSystem`, có đếm số lần gọi): `'Nhà mẫu: ra kết quả, lần hai trúng cache không chạy lại'`; `'thiếu thời tiết → blocked, chỉ tới ③ chọn thời tiết'`; `'bỏ lịch tải → blocked, message LOAD_PLAN_MISSING'`; `'hủy giữa chừng → idle, không ghi cache'`. `health.test.ts`: `'done: PV pass có MWh/năm và (bóng: xem trước); cấp điện thiếu 0 giờ, mua lưới = formatKWh(gridImportWh)'`; `'running: không còn chữ số nào trong ô PV và cấp điện'`. `autorun.spec.ts`:
  - `'sửa một tấm: bốn ô cập nhật mà không bấm chạy'`: Nhà mẫu → chờ `#health-pv[data-state="pass"]` (timeout 60 s), đọc số mua lưới → `#add-panel` 2 + `#add-confirm` → `#health-pv` chứa "đang tính lại…" → chờ `pass` → số mua lưới mới nhỏ hơn.
  - `'số trên thanh bằng màn Hệ thống và CSV'`: `tab(page,'he-thong')` → ô nhập/xuất lưới trong `#sim-result` chứa đúng số kWh của `#health-supply`; tải `#sim-csv`, tổng cột `grid_import_wh` / 1000 lệch ≤ 0,05 kWh.
  - `'đang gõ dở thì kết quả mới không xóa ô nhập'`: sửa bằng bảng Thêm → `tab(page,'he-thong')` → gõ "25" vào `#s-min` (không lưu) → chờ `#health-pv[data-state="pass"]` → `#s-min` vẫn "25", `#ws-fresh` hiện.
- [ ] **Step 2: Chạy** → FAIL. **Step 3:** viết. **Step 4:** `pnpm exec vitest run` (golden Lâm Hà vẫn PASS) và `pnpm build && pnpm exec playwright test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W13: auto-run in the worker after edits, cached by input hash; live health bar"`

### Task 21: Sửa nhanh ba loại lỗi

**Files:**
- Create: `src/validation/quick-fix.ts`, `tests/unit/quick-fix.test.ts`
- Modify: `src/ui/design.ts` (nút `button.quick-fix` cạnh finding), `src/ui/roof.ts` (cạnh lỗi vị trí), `tests/e2e/design.spec.ts`

**Interfaces:**
- Consumes: `restringPanels` (Task 13), `describeChange`, `setStringTarget`, `removePlacements`, `fillFace`, `PlacementIssue`.
- Produces:
  ```ts
  export interface QuickFix { label: string; apply(p: Project): Project }
  export function quickFixFor(p: Project, f: Finding): QuickFix | null;
  export function quickFixForLayout(p: Project, i: PlacementIssue): QuickFix | null;
  ```
- Chỉ trả về khi `apply(p)` thật sự giảm số lỗi cùng mã (tự kiểm bên trong):
  - `ISC_TRACKER`/`IMP_TRACKER`, cổng có ≥ 2 chuỗi và inverter còn MPPT trống → chuyển chuỗi cuối sang cổng trống; label `Chuyển ${chuỗi} sang ${cổng}`.
  - `VOC_COLD_ABS`/`VMP_HOT_MIN` `fail`, chuỗi một model trên inverter → `restringPanels`; label "Chia lại số tấm mỗi chuỗi".
  - `PANEL_OUT_OF_BOUNDS`/`PANEL_SETBACK`/`PANEL_OVERLAP` `error` → bỏ vị trí các tấm liên quan rồi `fillFace` trên cùng mặt; chỉ khi đặt lại được hết; label "Đặt lại tấm vào chỗ trống".
- UI: bấm → xem trước `describeChange` → xác nhận → một revision, hoàn tác được. Loại khác giữ lời `fix` hiện có.

- [ ] **Step 1: Test hỏng:** `'2 chuỗi cùng M1 vượt Isc → chuyển Chuỗi 2 sang M2, hết ISC_TRACKER'` (rig 8 VSUN, `[{n:4,port:'M1'},{n:4,port:'M1'}]`: 2 × 15,95 = 31,9 A > 25 A); `'một chuỗi 12 tấm vượt Voc lạnh → chia lại 6+6, hết VOC_COLD_ABS'`; `'tấm chồng nhau trên Nhà mẫu → đặt lại, validateLayout rỗng'` (`movePanels` một tấm 0,5 m sang tấm bên cạnh); `'không còn MPPT trống → null'`.
- [ ] **Step 2–4:** FAIL → viết → PASS; thêm vào `design.spec.ts` một ca bấm sửa nhanh ISC rồi `#ws-undo`.
- [ ] **Step 5: Commit** — `git commit -m "W13: three quick fixes with preview and undo"`

### Task 22: Phát lại dòng công suất trên hình

**Files:**
- Create: `src/scene/flows.ts`, `tests/unit/flows.test.ts`
- Modify: `src/scene/three-view.ts` (`setFlows`), `src/ui/viewport.ts`, `src/ui/sim.ts` (thanh `#replay-slider` gọi `ctx.onReplayStep(step)`), `src/ui/workspace.ts`, `tests/e2e/sim.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Flow { wireId: string; w: number; dir: 1 | -1 }   // w ≥ 0 (W); dir 1 = theo chiều from → to
  export function flowsAt(model: SceneModel, r: SimResult, step: number): { flows: Flow[]; text: string[] };
  // ViewApi.setFlows(flows: Flow[]): void; Viewport.setReplay(step: number | null): void
  ```
- `dc-pv` của chuỗi s: `r.pv.strings.find(id).pTrackerW[step]`; `dc-bat`: (sạc − xả)/giờ bước từ `dispatch.series.chargeBusWh/dischargeBusWh`, `dir` 1 khi sạc; `ac`: mọi dây AC mang tổng `loadServedWh/giờ` (ghi `ponytail:` — dispatch chưa có chuỗi theo từng tải, tách khi engine có); `dc-pump`: `r.pv.branches[0].pW[step]`. `text` (luôn có số + đơn vị): `PV vào inverter ${kW} kW`, `Pin: sạc|xả ${kW} kW`, `Tải: ${kW} kW`, `Lưới: ${kW} kW`.
- 3D: mũi tên (nón) dọc dây, cỡ ∝ √w, theo `dir`; chữ ở `#view-flows`. Con trỏ thời gian chung: bước phát lại đặt luôn Mặt Trời (`setOverlay` như màn Bóng che). Tắt chuyển động: không có hoạt ảnh, chỉ bước từng giờ.

- [ ] **Step 1: Test hỏng:** với kết quả chạy Nhà mẫu: bước 11h của một ngày nắng → hai `dc-pv` có `w > 0`; bước 0h → `dc-pv` = 0; mọi `text` có "kW", không có `NaN`.
- [ ] **Step 2–4:** FAIL → viết → PASS; `sim.spec.ts` thêm: kéo `#replay-slider` → `canvas.dataset.flows` không rỗng, `#view-flows` chứa "kW".
- [ ] **Step 5: Commit** — `git commit -m "W13: replay drives power-flow arrows and sun on the shared view"`

### Task 23: Bằng chứng W13

Như Task 5, thêm: thời gian tự chạy đo được (máy dev, Android tầm trung), giá trị `AUTORUN_DELAY_MS` và mức bóng xem trước đã chọn, golden Lâm Hà không đổi. Commit `W13: evidence and wave backlog`.

---

# W14 · Ba độ sâu

### Task 24: Công tắc Cơ bản · Thợ · Kỹ sư

**Files:**
- Create: `src/ui/depth.ts`, `tests/unit/depth.test.ts`, `tests/e2e/depth.spec.ts`
- Modify: `src/ui/workspace.ts` (công tắc ở `#ws-top`), `src/ui/styles.css`, các panel (gắn `data-min-depth`), `src/ui/lessons.ts` (chế độ ban đầu theo độ sâu), `tests/e2e/nav.ts` + mọi e2e cũ (đặt Kỹ sư trước khi chạy)

**Interfaces:**
- Produces:
  ```ts
  export type Depth = 'co-ban' | 'tho' | 'ky-su';
  export const DEPTH_KEY = 'solar-lab:depth';
  export function readDepth(store?: Pick<Storage, 'getItem'> | null): Depth;   // mặc định và mọi lỗi → 'co-ban'
  export function writeDepth(d: Depth, store?: Pick<Storage, 'setItem'> | null): void;  // lỗi thì bỏ qua
  export function applyDepth(d: Depth): void;  // document.documentElement.dataset.depth = d
  // tests/e2e/nav.ts
  export async function asEngineer(page: Page): Promise<void>; // addInitScript đặt DEPTH_KEY = 'ky-su'
  ```
- Ẩn bằng CSS: `:root[data-depth="co-ban"] [data-min-depth]` và `:root[data-depth="tho"] [data-min-depth="ky-su"]` → `display: none`. **Không bao giờ** gắn `data-min-depth` lên `.finding`, `[data-state]`, `#checklist`, ô sức khỏe, `#assumptions`.
- Gắn (theo bảng §8 của spec): Thợ — form thiết lập Tcell, khoảng lùi mép, bảng kết nối/preset/thêm theo lô, lịch tải, A/B, dòng báo giá/kit/VAT/dây, chọn model và số lượng ở bảng Thêm, tạo/sửa thiết bị, sửa biên đa giác mái; Kỹ sư — hệ số Isc, βVmp, chính sách điều phối, ledger, CSV, bảng theo bước, nguồn giá, hiệu lực, so revision, công thức và nguồn trong chi tiết finding.
- Công tắc `#depth-co-ban` "Cơ bản", `#depth-tho` "Thợ", `#depth-ky-su` "Kỹ sư" (`aria-pressed`). Không lưu vào dự án, không đổi phép tính.

- [ ] **Step 1: Test hỏng.** Unit: `readDepth` với kho `'tho'` → `'tho'`; `'x'` → `'co-ban'`; `null` → `'co-ban'`; kho ném lỗi → `'co-ban'`. `depth.spec.ts`: `'cùng dự án, ba độ sâu cho cùng số'` (text `#ws-health` giống hệt ở 3 chế độ); `'Cơ bản không ẩn trạng thái nào'` (ở ②, số `.finding.fail`, `.finding.limited`, `.finding.unknown` đang hiển thị bằng nhau giữa Cơ bản và Kỹ sư); `'Cơ bản ẩn chính sách điều phối nhưng hiện giả định đang dùng'` (`#s-min` ẩn, `#assumptions` hiện — `#assumptions` làm ở Task 27, test này bật ở đó).
- [ ] **Step 2: Chạy** → FAIL. **Step 3:** viết; thêm `asEngineer(page)` vào `beforeEach` của mọi spec cũ (trừ kịch bản người mới trong `uat.spec.ts`). **Step 4:** `pnpm build && pnpm exec playwright test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W14: depth switch (basic, installer, engineer) gating detail only"`

### Task 25: Glossary ~20 mục, "Vì sao?", lời finding theo độ sâu

**Files:**
- Create: `src/ui/term.ts`, `src/validation/finding-view.ts`, `tests/unit/finding-view.test.ts`
- Modify: `src/lessons/glossary.ts`, `src/ui/design.ts`, `src/ui/inspector.ts`, `tests/unit/lessons.test.ts`

**Interfaces:**
- Consumes: `Term`, `GLOSSARY`, `Depth`, `QuickFix`.
- Produces:
  ```ts
  export function term(id: string, depth: Depth): HTMLElement; // details.term[data-term], summary "Vì sao?"; co-ban: basic; tho: basic; ky-su: basic + engineer
  export function findingLines(f: Finding, depth: Depth, fix: QuickFix | null): { title: string; lines: string[] };
  ```
- Glossary: giữ 6 mục cũ, thêm 14 id: `voc`, `vmp`, `isc`, `chuoi`, `inverter`, `kwp`, `poa`, `nhiet-do-cell`, `cat-cong-suat`, `mua-luoi`, `gio-thieu-dien`, `khoang-lui-mep`, `gia-dinh`, `thieu-gia` (lời văn do người làm wave viết, giọng các mục hiện có).
- `findingLines`: title luôn mở đầu bằng `STATE_LABEL[f.status]` viết hoa chữ đầu và dấu hai chấm ("Có lỗi: …", "Bị giới hạn: …", "Chưa đủ dữ liệu: …") ở mọi độ sâu. Cơ bản: title = trạng thái + `f.consequence`; lines = `fix ? [] : ['Hỏi thợ lắp đặt về mục này']`. Thợ: + `Giá trị ${value} ${unit} / giới hạn ${limit} ${unit}`, `Cách sửa: ${f.fix}`, cổng liên quan. Kỹ sư: + mã `f.code`, `Công thức: ${f.formula}`, mỗi nguồn `where · field = value unit (provenance)`, và "có giả định" khi `f.assumed`.

- [ ] **Step 1: Test hỏng:** `GLOSSARY.length >= 20`, id không trùng, `basic`/`engineer` không rỗng; với finding `VOC_COLD_ABS` fail: Cơ bản bắt đầu "Có lỗi", có "Hỏi thợ" khi không có sửa nhanh, không chứa `f.formula`; Kỹ sư chứa `f.formula` và mọi `source.where`; finding `unknown` ở Cơ bản vẫn bắt đầu "Chưa đủ dữ liệu".
- [ ] **Step 2–4:** FAIL → viết → PASS (`lessons.test.ts` vẫn xanh).
- [ ] **Step 5: Commit** — `git commit -m "W14: twenty glossary terms, why-links, finding wording per depth"`

### Task 26: Bảng đấu nối cho thợ

**Files:**
- Create: `src/reports/wiring.ts`, `tests/unit/wiring.test.ts`
- Modify: `src/ui/report.ts` (`ReportState.includeWiring`, checkbox `#rp-wiring` gắn `data-min-depth="tho"`), `src/ui/styles.css` (`#rp-wiring-page { break-before: page }`), `tests/e2e/report.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface WiringRow { from: string; to: string; detail: string }
  export function wiringTable(p: Project): WiringRow[];
  export const WIRING_NOTE = 'Tiết diện dây và thiết bị bảo vệ do người lắp xác nhận.';
  ```
- Dòng: mỗi chuỗi `from = '${label} (${n} tấm: #1 → #2 → …)'` theo thứ tự nối tiếp, `to = '${inverter} · MPPT k'`, `detail = 'Voc lạnh v/limit V'` hoặc "chưa đủ dữ liệu"; edge pin `→ '${inverter} · Pin'`; edge AC `'${inverter} · Ra tải AC' → tải`; nhánh bơm. Trang `section.report-page#rp-wiring-page` riêng, cuối trang có `WIRING_NOTE`. Trang báo cáo cũ không đổi.

- [ ] **Step 1: Test hỏng:** `wiringTable(Nhà mẫu)` có 5 dòng: 2 chuỗi tới "MPPT 1"/"MPPT 2" chứa "4 tấm", 1 dòng tới "Pin", 2 dòng "Ra tải AC". E2E: bật `#rp-wiring` → in (media print) → `#rp-wiring-page` hiện, PDF vẫn A4 595,28 × 841,89.
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W14: printable wiring table page for installers"`

### Task 27: Từ con số tới nguồn (Kỹ sư), giả định chỉ đọc (Cơ bản), "đủ điện mấy ngày"

**Files:**
- Create: `src/ui/assumptions.ts`, `src/reports/days.ts`, `tests/unit/assumptions.test.ts`
- Modify: `src/ui/health.ts` (đích có `focusId` tới nguồn), `src/ui/sim.ts` (`#sim-assumptions`, `#sim-ledger` làm mốc; khối Cơ bản "Đủ điện"), `src/ui/quote.ts` (`#quote-lines` có cột người bán và ngày ghi giá), `src/ui/design.ts` (`#assumptions` thay form thiết lập ở Cơ bản), `tests/e2e/depth.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function assumptionsOf(p: Project): string[];
  export function daysShort(r: SimResult, timeZone: string): { short: number; days: number }; // chỉ tính ngày địa phương có đủ 24 bước
  ```
- Đích ô sức khỏe: electric → ② và chọn finding không đạt đầu tiên (`#finding-detail` có công thức + nguồn); pv → ③ `he-thong` focus `sim-assumptions`; supply → ③ focus `sim-ledger`; money → ④ focus `quote-lines`. Một cú bấm.
- `assumptionsOf`: Tcell lạnh/nóng + nguồn, hệ số Isc, βVmp giả định, khoảng lùi mép từng mặt + nguồn, dự phòng SoC, SoC đầu, hiệu suất, lưới (nhập/bán), mức bóng, bộ thời tiết.
- Cơ bản ở ③: `Đủ điện ${days − short}/${days} ngày (chỉ tính ngày đủ 24 giờ dữ liệu của ${tên bộ thời tiết})`. Đây là đếm lại chuỗi theo giờ của engine, không phải số mới; thanh sức khỏe vẫn dùng giờ.

- [ ] **Step 1: Test hỏng:** `assumptionsOf(Nhà mẫu)` chứa "Tcell lạnh 5 °C", "bóng che: xem trước", "Lưới: được nhập, không bán"; `daysShort(kết quả Nhà mẫu, 'Asia/Ho_Chi_Minh')` = `{ short: 0, days: 364 }` (dữ liệu UTC 2023 → ngày địa phương 01/01/2023 và 01/01/2024 không đủ 24 giờ). E2E Kỹ sư: `'từ một lỗi tới công thức và nguồn trong ≤ 2 thao tác'` (bấm `#health-electric` → `#finding-detail` chứa "Công thức" và một dòng nguồn); bật lại test `#assumptions` của Task 24.
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W14: number-to-source links, read-only assumptions, days with full supply"`

### Task 28: Bằng chứng W14

Như Task 5. Commit `W14: evidence and wave backlog`.

---

# W15 · Điện thoại, tiếp cận, UAT thật, 1.1

### Task 29: Điện thoại

**Files:**
- Create: `tests/e2e/mobile.spec.ts`
- Modify: `src/ui/styles.css`, `src/ui/workspace.ts` (nút `#sheet-add` "Thêm ▲" và `#sheet-panel` "Bảng bước ▲", `aria-expanded`)

**Interfaces:** < 720 px: `#ws-add` và `#ws-panel` thành tấm cố định đáy (trên thanh sức khỏe), cao tối đa 70vh, mở/đóng bằng nút (ghi `ponytail:` — chạm để mở, chưa có kéo; thêm kéo khi UAT cần).

- [ ] **Step 1: Test hỏng** (`viewport 360 × 740`, `hasTouch`): Nhà mẫu → `#sheet-add` → thêm 2 tấm → thanh sức khỏe cập nhật; mỗi bước `scrollWidth <= 360`; chạm thiết bị trên canvas chọn được.
- [ ] **Step 2–4:** FAIL → viết → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W15: bottom sheets for the add palette and step panel on phones"`

### Task 30: Tiếp cận

**Files:**
- Create: `tests/unit/contrast.test.ts`, `tests/e2e/a11y.spec.ts`
- Modify: `src/ui/styles.css` (chỉnh token nếu test chỉ ra)

- [ ] **Step 1: Test hỏng.** Unit đọc `src/ui/styles.css`, lấy token `:root` sáng và tối, tính tỉ lệ tương phản WCAG: chữ/nền ≥ 4,5; màu trạng thái (`--err --lim --unk --ok`) trên nền ≥ 3; chữ trên nền trạng thái ≥ 4,5. E2E: Tab đi qua `#ws-top` → `#ws-steps` → `#ws-add` → `#ws-view` → `#ws-panel` → `#ws-health` theo đúng thứ tự, mỗi điểm có viền focus thấy được (`:focus-visible`); `reducedMotion: 'reduce'` → phát lại không tự chạy, `canvas[data-damping="false"]`; `#ws-steps` có `aria-current`, tab có `role="tab"`/`aria-selected`.
- [ ] **Step 2–4:** FAIL → chỉnh → PASS.
- [ ] **Step 5: Commit** — `git commit -m "W15: contrast, focus order and reduced-motion checks"`

### Task 31: UAT người thật và phát hành 1.1

**Files:**
- Modify: `docs/uat/protocol.md` (bốn tiêu chí "Đo thành công" của spec + phiếu ghi thời gian), `tests/e2e/uat.spec.ts` (bản máy của bốn tiêu chí), `docs/release/acceptance-matrix.md`, `package.json` (`version`), `README.md`
- Create: `docs/release/v1.1.0.md`, `docs/evidence/W15.md`, `docs/waves/W15.md`

- [ ] **Step 1: Viết bản máy của bốn tiêu chí** trong `uat.spec.ts`: (a) người mới, Cơ bản: Nhà mẫu 8 → 10 tấm bằng bảng Thêm, đọc tiền đã biết và kWh mua lưới trước/sau từ thanh sức khỏe; (b) thợ, độ sâu Thợ: từ số 0 dựng 6 tấm + inverter + pin + 1 tải, `#health-electric` "0 lỗi", in báo giá; (c) kỹ sư: từ một lỗi tới công thức + nguồn ≤ 2 thao tác; (d) lần đầu mở thấy Nhà mẫu không cần thao tác. Giữ các test kiểm số liệu (NaN/null, máy yếu, About, file sửa tay) đang có.
- [ ] **Step 2: Chạy** `pnpm run ci` → xanh.
- [ ] **Step 3: UAT với người thật (việc của người, agent không làm thay):** bốn nhóm theo `docs/uat/protocol.md`, không ai chỉ; ghi thời gian, chỗ vấp, kết quả đạt/không vào `docs/evidence/W15.md`. Tiêu chí nào không đạt → mở việc sửa, chạy lại, **chưa phát hành**.
- [ ] **Step 4: Khi bốn tiêu chí đạt:** `package.json` `version` `1.1.0`; `docs/release/v1.1.0.md` (cùng cấu trúc `v1.0.0-rc.2.md`; ghi rõ rc.2 là mốc engine, 1.0 không phát hành với giao diện cũ); cập nhật ma trận nghiệm thu và README; `pnpm run ci` xanh.
- [ ] **Step 5: Commit** — `git commit -m "W15: real-user UAT results, release 1.1.0"`

---

## Câu hỏi mở (không chặn W10)

- **Chọn nơi lắp theo tỉnh:** spec ghi "tỉnh/tọa độ"; plan chỉ làm tọa độ vì danh sách tọa độ 63 tỉnh cần nguồn có giấy phép rõ và sẽ thành file `data/` mới (phải khóa lại). Nếu cần, thêm một task ở W11 khi có nguồn.
- **"Đủ điện mấy ngày" (§8):** plan đếm lại ngày đủ 24 giờ từ chuỗi giờ của engine (Task 27). Nếu chủ dự án muốn tuyệt đối không có số "ngày", bỏ khối đó, giữ giờ.
