# Rollback build và phục hồi dự án

Mục tiêu: quay về bản trước mà không ai mất việc. Thứ tự ưu tiên: **bản thiết kế và báo giá của người dùng > cache > dataset** (cache và dataset tạo lại được).

## 1. Chuẩn bị mỗi lần phát hành
- Giữ nguyên thư mục `dist/` của bản trước (ví dụ `releases/<buildId>/`). Mỗi `dist/` tự đủ: `index.html`, `assets/`, `sw.js`, `release-manifest.json`.
- Ghi `release-manifest.json` của hai bản cạnh nhau (engine, định dạng, mã băm catalog/thời tiết) để biết hai bản khác gì.
- `pnpm run ci` phải xanh trên bản sao sạch trước khi phát hành (gồm `verify:lock`: đầu vào bị khóa không đổi).

## 2. Quay lại bản trước (người vận hành)
1. Trỏ máy chủ tĩnh về `releases/<buildId-trước>/`. Không cần xóa gì.
2. Máy khách đã cài service worker của bản mới sẽ thấy `sw.js` cũ khác phiên bản: ô trạng thái hiện "Có bản mới" (thực chất là bản cũ). Người dùng bấm "Cập nhật" khi sẵn sàng. Không bao giờ tự tải lại giữa lúc đang sửa.
3. Nếu bản cũ tải thiếu file (mạng yếu), cài đặt thất bại và máy khách giữ nguyên bản đang chạy (đã kiểm ở `tests/e2e/offline.spec.ts`).

## 3. Dữ liệu trên máy người dùng khi quay lại
| Tình huống | Điều xảy ra | Cách lấy lại việc |
|---|---|---|
| Bản mới chưa nâng DB (người dùng chưa mở) | Bản cũ đọc bình thường | — |
| Bản mới đã nâng DB (v2 → v3) rồi quay về bản cũ | Bản cũ gặp `VersionError`, **không ghi và không xóa gì**; trang nói rõ "dữ liệu do bản MỚI HƠN tạo ra" | (a) mở lại bản mới; (b) nhập file "Xuất tất cả" hoặc file dự án `.json` đã sao lưu; (c) bản mới đã tự sao lưu DB cũ (`mekoniq-solar-lab-backup-v2`) trước khi nâng: màn hình chính có nút "Khôi phục" |
| Mất dữ liệu trình duyệt | Dự án trong IndexedDB mất | Nhập file đã xuất. **Khuyến nghị người dùng bấm "Xuất tất cả dự án" định kỳ** |

## 4. Phục hồi từ sao lưu tự động (bản mới)
Màn hình chính → "Khôi phục": **bản mới nhất** của mỗi dự án trong sao lưu được thêm lại (lịch sử revision của bản sao lưu không được chép sang; DB sao lưu vẫn giữ nguyên tới khi bạn xóa); nếu ID đã tồn tại thì thành **bản sao** "(khôi phục)", không ghi đè. "Xóa bản sao lưu" chỉ khi đã chắc.

## 5. Quy tắc nâng DB (cho lần phát hành sau)
- Mỗi phiên bản DB là một migration thêm cấu trúc, không sửa migration đã phát hành (`src/persistence/db.ts`).
- Trước khi tăng `DB_VERSION`, `backupBeforeUpgrade` đã sao dữ liệu người dùng (dự án, mọi revision, thiết bị và báo giá của họ). Thêm kho dữ liệu mới vào danh sách sao nếu kho đó chứa dữ liệu người dùng.
- Test bắt buộc: N−1 → N giữ dữ liệu, sao lưu đủ, khôi phục, VersionError khi lùi (`tests/unit/backup.test.ts`, `tests/e2e/migration.spec.ts`).

## 6. Giới hạn
- Thời tiết đã nhập (kho `weather`) không nằm trong sao lưu tự động: nhập lại từ file nguồn hoặc gói đầy đủ.
- Một tab cũ đang mở khi bản mới nâng DB sẽ tự đóng kết nối (`versionchange`); tab đó cần tải lại.
- Chưa thử quy trình này trên thiết bị thật của người dùng.
