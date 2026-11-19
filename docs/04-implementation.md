# 4. Implementation plan và tiêu chí hoàn thành

## Trình tự phát triển

Mỗi wave kết thúc bằng một tính năng chạy được từ entry bình thường của Solar, một fixture đủ nhỏ để code review và một demo có kết quả kiểm tra được. Từ W01, mở app luôn đi được qua luồng mẫu hiện có. Mỗi PR ghi requirement ID, build SHA, phạm vi kiểm, giới hạn còn mở và đường dẫn kết quả. Bắt đầu ở W00; dùng case Lâm Hà xuyên suốt để tránh các module riêng lẻ chạy được nhưng không ghép được.

| Wave | Phụ thuộc | Sản phẩm nhìn thấy | Công ước lượng (người-ngày) |
|---|---|---|---:|
| W00 | Seed đã giao | Ứng dụng Solar độc lập chạy từ checkout sạch | 2–3 |
| W01 | W00 | Project + catalog Việt Nam, lưu cục bộ, tạo linh kiện riêng | 4–6 |
| W02 | W01 | Chọn thiết bị/báo giá, BOM tính cả phụ kiện; so chi phí | 3–5 |
| W03 | W01, giao diện chi phí W02 | Sơ đồ 2D, nối chuỗi/MPPT, lỗi có giải thích | 6–9 |
| W04 | W03 | Nhập thời tiết, tính PV theo giờ và xuất kết quả đối chứng | 6–9 |
| W05 | W04, W02 | Pin, tải, lưới, bơm, replay, A/B ngày và năm | 7–11 |
| W06 | W03 và schema W01 ổn định | Mặt mái, đặt tấm 3D, overlay string và hướng dẫn lắp | 6–9 |
| W07 | W04, W05, W06 | Bóng đổ tác động lên sản lượng và điện thiếu | 6–10 |
| W08 | W05, W07 | Bài học, báo cáo, gói chuyển project, dùng offline | 5–8 |
| W09 | W00–W08 | Bộ regression, UAT người dùng/thợ, gói phát hành v1 | 4–7 |

Tổng **49–77 người-ngày** cho phạm vi trên, gồm phát triển và test từng wave; không tính thời gian chờ datasheet, số đo công trình hoặc phản hồi người thử. Đây là ước lượng sơ bộ cho một người có kinh nghiệm TS, 3D và có kỹ sư điện phản biện. Với hai người, sau W03 có thể phát triển W06 song song W04–W05 khi đã chốt PanelInstance ID, đơn vị và hình học. Rủi ro chính về lịch là dữ liệu linh kiện và đối chiếu mô hình bóng/điện, không phải số màn hình.

## Yêu cầu xuyên suốt và ai xác nhận

| Yêu cầu | Wave chủ trì | Phép kiểm trước khi giao |
|---|---|---|
| REQ-01 · Một codebase | W00 | Build từ checkout sạch của repo này; không import ra ngoài thư mục dự án. |
| REQ-02 · Catalog VN + tạo/sửa | W01 | Sửa giá hoặc thông số tạo đúng revision; mở lại project cũ giữ snapshot cũ. |
| REQ-03 · Tổng chi phí | W02 | Golden 31.872.000 đ, dây số lẻ, tier giá, kit, VAT, phí và báo giá thiếu. |
| REQ-04 · Đấu nối, công suất, tương thích | W03 | Trace từng cảnh báo tới cổng và spec sử dụng. KC: kỹ sư điện đọc fixture kiểm thiết kế. |
| REQ-05 · Sản lượng + pin/tải | W04–W05 | So output PV với pvlib cùng inputs, kiểm sổ năng lượng từng bước, replay cả mùa ít nắng. |
| REQ-06 · Hai phương án Lâm Hà | W05 | Dựng được 8 tấm chung, 6+2, đổi lịch bơm, pin cũ, ngân sách 30 triệu. |
| REQ-07 · Mái, lắp ghép và bóng 3D | W06–W07 | ID xuyên 2D/3D/BOM, hình học kích thước thật, bóng có log và làm đổi engine. |
| REQ-08 · Học và bàn giao cho thợ | W08–W09 | Người mới tự hoàn thành bài; thợ đổi một thiết bị, tái tạo A/B và giải thích kết quả cho chủ nhà. |

**Kiểm thử số học.** Unit test theo đơn vị; property test input biên; fixtures đóng băng cùng phiên bản engine. Đặt ngưỡng mục tiêu cho trường hợp **cùng mô hình và cùng tham số**: sai khác công suất PV so pvlib ≤1% ở điểm có công suất trên 10% Pstc, còn ở mức thấp dùng dung sai tuyệt đối 1% Pstc; sai khác tổng kWh năm ≤2% với fixture đủ dữ liệu. Chênh lệch lớn phải quay lại kiểm biên DC/AC, quy ước azimuth, múi giờ, nhiệt độ và clipping. Với dispatch kiểm residual mỗi bước ≤ max(0,01 Wh; 10⁻⁶ × năng lượng lớn nhất qua bước), kiểm tồn đầu/cuối kỳ khi tổng hợp. Dung sai đối chứng phần mềm không phải cam kết sai số so công trình thực.

**Kiểm thử ứng dụng.** Dùng Node tests cho seed, Vitest cho core, Playwright cho flow trình duyệt. Chỉ tiêu đề xuất cho case 40 tấm: thay đổi số lượng/giá cập nhật BOM và validation p95 ≤150 ms trên máy dev; mô phỏng năm khi đã có thời tiết/không tính lại hình học ≤5 s; tạo 3D shadow series năm trong ≤120 s trên máy dev, hủy tác vụ được trong 500 ms. Đo 5 lượt sau warm-up, lưu máy, browser, số mẫu ray, bước thời gian, p50/p95 và peak memory. Lần chạy lạnh đo riêng. Nếu vượt, xác định bottleneck và đo lại ở cùng độ chính xác; mọi thay đổi model phải tạo version mới.

**Dữ liệu và phục hồi.** Import file có giới hạn kích thước, JSON Schema và tham chiếu nội bộ hợp lệ. Đọc vào staging, tính hash trước khi thay project. Với ID trùng, mặc định nhập thành bản sao mới; nháp cũ chỉ thay sau lựa chọn rõ ràng. Lưu revision bằng compare-and-swap, hai tab sửa đồng thời mở màn hình diff/nhân bản. Rollback release phục vụ build trước, đọc project phiên bản cũ qua migration; trước khi nâng DB lưu được bản export, test nâng từ N−1 và import lại. Dataset/cache có thể tái tạo; giữ bản thiết kế và báo giá người dùng ưu tiên hơn cache khi đầy bộ nhớ.

**Bản ghi nghiệm thu.** Mỗi wave có một file `docs/evidence/Wxx.md`: commit, fixture/hash, máy, lệnh, kỳ vọng, thực tế, status passed/failed/blocked, giới hạn và issue còn lại. Kỹ sư phần mềm kiểm implementation, kỹ sư điện kiểm các giới hạn hãng và giả định, một chủ nhà và một thợ thử quy trình W09. Đối chiếu log inverter thật là mức kiểm chứng riêng, tùy dữ liệu có sẵn; ghi độ phủ theo giờ/mùa và model nào đã so. Chỉ tiêu chưa đo mang trạng thái “chưa đo”.

**Mốc giao demo.** Sau W03, nhận báo giá thật và dựng hai phương án với tổng chi phí. Sau W05, chạy được quyết định bơm trưa hay tối và giải thích lượng điện thiếu. Sau W07, kéo bồn nước hoặc di chuyển tấm để thấy mức thay đổi kWh ở cùng dữ liệu nắng. Sau W09, gửi được một file cho thợ, mở offline trên thiết bị khác và tái tạo đúng số liệu, vị trí, giá và nguồn giả định.
