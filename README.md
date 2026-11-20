# Mekoniq Solar Lab

Bàn thiết kế, ước tính chi phí và mô phỏng điện mặt trời cho Việt Nam. Các wave W00–W15 đã làm xong phần máy.

Bản hiện tại là ứng viên **1.1.0-rc.1**: giao diện mới (W10–W15) trên engine của `1.0.0-rc.2`. Đây chưa phải bản chính thức:
- UAT với người thật theo bốn tiêu chí "Đo thành công" chưa làm;
- kỹ sư điện chưa đối chiếu datasheet.

`1.0.0-rc.2` vẫn là mốc engine đã khóa; bản 1.0 không phát hành với giao diện cũ.

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

Bằng chứng nghiệm thu: `docs/evidence/W00.md` … `W15.md`. Bản ứng viên: [docs/release/v1.1.0-rc.1.md](docs/release/v1.1.0-rc.1.md) (mốc engine: [1.0.0-rc.2](docs/release/v1.0.0-rc.2.md); trước đó: [rc.1](docs/release/v1.0.0-rc.1.md)) · [ma trận nghiệm thu](docs/release/acceptance-matrix.md) · [rollback](docs/release/rollback.md) · [UAT](docs/uat/protocol.md) · [spec giao diện mới](docs/05-experience-v2.md).

Khóa đầu vào: `node scripts/lock.mjs` (kiểm), `node scripts/lock.mjs --write` (khóa lại sau khi đọc diff).

| Đọc theo thứ tự | Nội dung |
|---|---|
| [01 · Kiến trúc](docs/01-architecture.md) | Nền tảng kỹ thuật, cây thư mục, luồng dữ liệu và ranh giới, chạy và phát hành, phạm vi v1. |
| [02 · Đặc tả miền điện](docs/02-domain-engine.md) | Graph, schema, thuật toán PV, MPPT, dispatch pin/tải, hợp đồng tính và ví dụ nghiệm thu. |
| [03 · Trải nghiệm, catalog và 3D](docs/03-product-3d.md) | Giá VN, 2D/3D, bóng che, bài học, báo cáo và vận hành. |
| [04 · Kế hoạch triển khai](docs/04-implementation.md) | Phụ thuộc, ước lượng, chất lượng, UAT và phát hành. |
| [Danh mục wave](docs/waves/README.md) | Từng spec có hạng mục, file, phụ thuộc, phép thử và đầu ra bàn giao. |
