# Ma trận nghiệm thu REQ-01…08

Cột **Người review** chỉ ghi người thật đã đọc và ký. Hiện **chưa có người review độc lập nào**; mọi dòng dưới đây mới có tự kiểm của tác giả và test tự động. "Đạt (máy)" nghĩa là test tự động đạt, không phải chữ ký của con người.

| REQ | Tiêu chí (docs/04) | Artifact | Trạng thái | Người review |
|---|---|---|---|---|
| REQ-01 Một codebase | Build từ checkout sạch của repo này, không import ra ngoài thư mục dự án | `docs/evidence/W00.md`; `scripts/check-imports.mjs`; CI chạy ở bản sao rsync không có `.git` | Đạt (máy) | chưa có |
| REQ-02 Catalog VN + tạo/sửa | Sửa giá/thông số tạo đúng revision; project cũ giữ snapshot | `docs/evidence/W01.md`, `W01/*.json`; `tests/unit/{catalog,persistence}.test.ts` | Đạt (máy). **11/11 thiết bị chưa kiểm datasheet bởi người thứ hai** | chưa có |
| REQ-03 Tổng chi phí | Golden 31.872.000 đ, dây lẻ, tier, kit, VAT, phí, thiếu giá | `docs/evidence/W02.md`; `tests/unit/quote.test.ts`; `hand-calcs.test.ts` H6; regression 6/8 tấm (27.904.000 / 31.872.000) | Đạt (máy) | chưa có |
| REQ-04 Đấu nối, công suất, tương thích | Cảnh báo truy tới cổng và spec; kỹ sư điện đọc fixture | `docs/evidence/W03.md`; `tests/unit/design.test.ts`; `hand-calcs.test.ts` H1–H2; `docs/uat/engineer-crosscheck.md` | Máy đạt; **KC kỹ sư điện: chưa thực hiện** | chưa có |
| REQ-05 Sản lượng + pin/tải | So pvlib cùng input, sổ năng lượng từng bước, replay mùa ít nắng | `docs/evidence/W04.md` (+ `W04/reference-comparison.json`), `W05.md`; `tests/unit/{pv-reference,dispatch,sim-compile}.test.ts`; `hand-calcs.test.ts` H3–H5 | Đạt (máy): công suất ≤ 0,064 %, năng lượng năm 0,003 % so pvlib; ledger ~1e-12 Wh. **Không phải sai số so công trình** | chưa có |
| REQ-06 Hai phương án Lâm Hà | 8 tấm chung, 6+2, đổi lịch bơm, pin cũ, ngân sách 30 triệu | `docs/evidence/W05.md`; `tests/unit/regression-lamha.test.ts` (6/8 tấm × bơm 18h/11h × bồn; 6+2 × bơm 18h/11h) + golden `tests/fixtures/golden/lamha-matrix.json`; `tests/e2e/sim.spec.ts` | **Một phần (máy)**: 8 tấm chung, 6+2, đổi lịch bơm, pin cũ đạt. **Ngân sách 30 triệu chưa có trong app** (chỉ là phép tính trong test: phần đã biết 31.872.000 đ, thiếu 1.872.000 đ) | chưa có |
| REQ-07 Mái, lắp ghép, bóng 3D | ID xuyên 2D/3D/BOM, kích thước thật, bóng có log và làm đổi engine | `docs/evidence/W06.md`, `W07.md`, `W07/benchmark.json`; `tests/unit/{roof,shade,shade-pv}.test.ts`; regression: bồn sát mái giảm ≈ 63,6 kWh/năm (0,7 %), bồn xa mái vẫn che lúc nắng thấp ≈ 9,4 kWh/năm (0,1 %) | Đạt (máy). Mái/bồn trong demo là minh họa | chưa có |
| REQ-08 Học và bàn giao cho thợ | Người mới tự hoàn thành bài; thợ đổi thiết bị, tái tạo A/B, giải thích cho chủ nhà | `docs/evidence/W08.md`; `tests/e2e/{lessons,report,offline,uat}.spec.ts`; `docs/uat/protocol.md` | Luồng đạt (máy, kể cả máy B ngoại tuyến). **UAT người thật: chưa thực hiện** | chưa có |

## Nghiệm thu chung W09
| Tiêu chí | Kết quả |
|---|---|
| PV golden đạt dung sai | Đạt (W04); ma trận Lâm Hà khóa golden ở 1e-9 |
| Ledger cân bằng | Đạt: mọi tổ hợp 8.760 bước, residual < 0,01 Wh |
| Cảnh 3D có biến đổi năng lượng định lượng | Đạt: bồn sát mái giảm `pv.eInverterWh` ≈ 63,6 kWh/năm, bồn xa ≈ 9,4 kWh/năm (regression) |
| Test phục hồi dữ liệu và rollback | Đạt: `backup.test.ts`, `migration.spec.ts` |
| Một file khách nhận mở lại và giải thích được | Đạt (máy B ngoại tuyến, `report.spec.ts`) |
| Nhãn kiểm chứng | **"Đã đối chiếu mô hình"**; KHÔNG gắn "đã đối chiếu thực địa" (chưa có phép đo) |

## Bốn tiêu chí "Đo thành công" (1.1, spec `docs/05-experience-v2.md`)
Có thêm từ `1.1.0-rc.1`. Bản 1.1.0 chính thức chỉ phát hành khi cả bốn dòng có kết quả người thật đạt.

| Tiêu chí | Bản máy (`tests/e2e/uat.spec.ts`) | Giao thức người thật | Trạng thái | Người review |
|---|---|---|---|---|
| (a) Người mới, không ai chỉ, ≤ 5 phút: Nhà mẫu 8 → 10 tấm, đọc tiền đã biết và điện mua lưới mỗi năm trước/sau | "Đo thành công (a)": 15.872.000 → 19.840.000 đ; 343,4 → 326 kWh/năm; 5 thao tác ở Cơ bản | `docs/uat/protocol.md` (a) | **Máy đạt; người thật: chưa** | chưa có |
| (b) Thợ, ≤ 10 phút: từ số 0 dựng 6 tấm + inverter + pin + 1 tải, hết lỗi đỏ, in báo giá | "Đo thành công (b)": "Điện: 0 lỗi", nút in gọi hộp thoại in, trang A4 có dự toán (6 tấm) | `docs/uat/protocol.md` (b) | **Máy đạt; người thật: chưa** | chưa có |
| (c) Kỹ sư: từ một lỗi bất kỳ tới công thức + nguồn số liệu ≤ 2 thao tác | "Đo thành công (c)": ô Điện 1 thao tác; mỗi mục trong 6 mục của Nhà mẫu 2 thao tác | `docs/uat/protocol.md` (c) | **Máy đạt; người thật: chưa** | chưa có |
| (d) Lần đầu mở: thấy Nhà mẫu (2D ngay, 3D khi Three.js tải xong), không thao tác | "Đo thành công (d)": Mặt bằng 2D lúc Three.js còn bị giữ, 3D tự lên | `docs/uat/protocol.md` (d) | **Máy đạt; người thật: chưa** | chưa có |

Bằng chứng: `docs/evidence/W15.md`. Engine, golden và khóa đầu vào không đổi từ rc.2, trừ lần khóa lại có chủ đích `schemas/project-v1.json` ở W12. Vì vậy các dòng REQ-01…08 ở trên vẫn đúng cho 1.1.0-rc.1.
