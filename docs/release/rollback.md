# Rollback build và phục hồi dự án

Mục tiêu: quay về bản trước mà không ai mất việc. Thứ tự ưu tiên: **bản thiết kế và báo giá của người dùng > cache > dataset** (cache và dataset tạo lại được).

## 1. Chuẩn bị mỗi lần phát hành
- Giữ nguyên thư mục `dist/` của bản trước (ví dụ `releases/<buildId>/`). Mỗi `dist/` tự đủ: `index.html`, `assets/`, `sw.js`, `release-manifest.json`.
- Ghi `release-manifest.json` của hai bản cạnh nhau (engine, định dạng, mã băm catalog/thời tiết) để biết hai bản khác gì.
- `pnpm run ci` phải xanh trên bản sao sạch trước khi phát hành (gồm `verify:lock`: đầu vào bị khóa không đổi).

## 2. Quay lại bản trước (người vận hành)
1. Trỏ máy chủ tĩnh về `releases/<buildId-trước>/`. Không cần xóa gì. Nếu bản trước có `DB_VERSION` thấp hơn, người dùng đã mở bản mới sẽ không dùng được bản trước cho tới khi bản mới quay lại (xem §3): chỉ lùi qua mốc nâng DB khi bắt buộc.
2. Máy khách đã cài service worker của bản mới sẽ thấy `sw.js` cũ khác phiên bản: ô trạng thái hiện "Có bản mới" (thực chất là bản cũ). Người dùng bấm "Cập nhật" khi sẵn sàng. Không bao giờ tự tải lại giữa lúc đang sửa.
3. Nếu bản cũ tải thiếu file (mạng yếu), cài đặt thất bại và máy khách giữ nguyên bản đang chạy (đã kiểm ở `tests/e2e/offline.spec.ts`).

## 3. Dữ liệu trên máy người dùng khi quay lại
| Tình huống | Điều xảy ra | Cách lấy lại việc |
|---|---|---|
| Bản mới chưa nâng DB (người dùng chưa mở) | Bản cũ đọc bình thường | — |
| Bản mới đã nâng DB rồi quay về bản cũ | Bản cũ gặp `VersionError`, **không ghi và không xóa gì**; trang nói rõ "dữ liệu do bản MỚI HƠN tạo ra". Bản cũ không có ô nhập file trong tình huống này | (a) mở lại bản mới: mọi dự án còn nguyên; (b) trên màn báo lỗi, bấm "Xuất dữ liệu ra file" (chỉ đọc kho mới, không sửa gì; có từ bản sau rc.1) để giữ một bản; (c) **không** xóa dữ liệu trang để ép dùng bản cũ: việc đó xóa luôn kho mới và mọi bản sao lưu tự động |
| Mất dữ liệu trình duyệt | Dự án trong IndexedDB mất | Nhập file đã xuất. **Khuyến nghị người dùng bấm "Xuất tất cả dự án" định kỳ** |

## 4. Phục hồi từ sao lưu tự động (bản mới)
Màn hình chính → "Khôi phục": **bản mới nhất** của mỗi dự án trong sao lưu được thêm lại (lịch sử revision của bản sao lưu không được chép sang; DB sao lưu vẫn giữ nguyên tới khi bạn xóa). Dự án trong máy y hệt bản sao lưu thì bỏ qua; cùng ID nhưng đã sửa khác thì bản sao lưu thành **bản sao** "(khôi phục)", không ghi đè. Bấm "Khôi phục" lần nữa (sau lỗi giữa chừng) chỉ thêm phần còn thiếu. Nhập lại cùng file "Xuất tất cả" cũng vậy; dự án hỏng trong file được liệt kê kèm vị trí, các dự án khác vẫn nhập. "Xóa bản sao lưu" chỉ khi đã chắc.

## 5. Quy tắc nâng DB (cho lần phát hành sau)
- Mỗi phiên bản DB là một migration thêm cấu trúc, không sửa migration đã phát hành (`src/persistence/db.ts`).
- Trước khi tăng `DB_VERSION`, `backupBeforeUpgrade` đã sao dữ liệu người dùng (dự án, mọi revision, thiết bị và báo giá của họ). Thêm kho dữ liệu mới vào danh sách sao nếu kho đó chứa dữ liệu người dùng.
- Test bắt buộc: N−1 → N giữ dữ liệu, sao lưu đủ, khôi phục, VersionError khi lùi (`tests/unit/backup.test.ts`, `tests/e2e/migration.spec.ts`).

## 6. Giới hạn
- Thời tiết đã nhập (kho `weather`) không nằm trong sao lưu tự động: nhập lại từ file nguồn hoặc gói đầy đủ.
- Thiết bị và báo giá người dùng tự tạo được chép vào sao lưu tự động nhưng "Khôi phục" và "Xuất tất cả" chỉ lấy lại dự án. Dự án vẫn mở đúng vì mỗi dự án giữ bản chụp thiết bị/báo giá nó dùng; thiết bị chưa dùng trong dự án nào thì không lấy lại được qua giao diện.
- Sao lưu tự động chỉ được coi là có khi đã ghi xong trọn vẹn (có dấu hoàn tất); bản dở dang do tab bị đóng giữa chừng được làm lại ở lần mở sau.
- Một tab cũ đang mở khi bản mới nâng DB sẽ tự đóng kết nối (`versionchange`); tab đó cần tải lại.
- Chưa thử quy trình này trên thiết bị thật của người dùng.
