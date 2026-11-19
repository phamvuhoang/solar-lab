# Mekoniq Solar Lab

Bàn thiết kế, ước tính chi phí và mô phỏng điện mặt trời cho Việt Nam. Thiết kế kỹ thuật, backlog theo wave và W00–W09 đã làm xong; bản hiện tại là ứng viên **1.0.0-rc.2**, chưa phải bản chính thức (còn UAT người thật và kỹ sư điện đối chiếu).

Kiểm nhanh với Node 24.x, chưa cần cài gói:

```sh
npm test
```

Từ checkout sạch (Node 24.x, pnpm 10):

```sh
pnpm install --frozen-lockfile
pnpm dev          # Vite dev server
pnpm build        # typecheck + dist/ + dist/build-meta.json
pnpm run ci       # import guard, typecheck, node/vitest/Playwright, build
```

Bằng chứng nghiệm thu: `docs/evidence/W00.md` … `W09.md`. Bản ứng viên: [docs/release/v1.0.0-rc.2.md](docs/release/v1.0.0-rc.2.md) (trước đó: [rc.1](docs/release/v1.0.0-rc.1.md)) · [ma trận nghiệm thu](docs/release/acceptance-matrix.md) · [rollback](docs/release/rollback.md) · [UAT](docs/uat/protocol.md).

Khóa đầu vào: `node scripts/lock.mjs` (kiểm), `node scripts/lock.mjs --write` (khóa lại sau khi đọc diff).

| Đọc theo thứ tự | Nội dung |
|---|---|
| [01 · Kiến trúc](docs/01-architecture.md) | Nền tảng kỹ thuật, cây thư mục, luồng dữ liệu và ranh giới, chạy và phát hành, phạm vi v1. |
| [02 · Đặc tả miền điện](docs/02-domain-engine.md) | Graph, schema, thuật toán PV, MPPT, dispatch pin/tải, hợp đồng tính và ví dụ nghiệm thu. |
| [03 · Trải nghiệm, catalog và 3D](docs/03-product-3d.md) | Giá VN, 2D/3D, bóng che, bài học, báo cáo và vận hành. |
| [04 · Kế hoạch triển khai](docs/04-implementation.md) | Phụ thuộc, ước lượng, chất lượng, UAT và phát hành. |
| [Danh mục wave](docs/waves/README.md) | Từng spec có hạng mục, file, phụ thuộc, phép thử và đầu ra bàn giao. |
