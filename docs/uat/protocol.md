# Quy trình UAT v1 — chủ nhà, thợ, người mới, kỹ sư

**Trạng thái: CHƯA THỰC HIỆN với người thật.** Các kịch bản dưới đây đã được chạy bằng máy (`tests/e2e/uat.spec.ts`, `tests/e2e/lessons.spec.ts`) để chứng minh luồng đi được từ đầu tới cuối. Việc đó không thay thế người dùng thật: máy không biết nhãn nào khó hiểu, bước nào bị bỏ sót, số nào làm người ta nghi ngờ. Mỗi kịch bản cần một người thật làm một mình, người quan sát không gợi ý.

Chuẩn bị: bản build ứng viên mở bằng Chrome, hồ sơ trình duyệt mới. Ghi lại thời gian, chỗ do dự, lời người dùng nói, và liệu họ có làm xong "độc lập" (không cần quan sát viên chỉ).

## 1. Chủ nhà — nhập lại một báo giá và chỉ ra giờ thiếu điện
Việc: "Mở mẫu Lâm Hà. Kho vừa báo pin cũ giá 15.500.000 đ đã gồm VAT; hãy nhập báo giá đó. Rồi cho biết khi nào trong năm nhà bị thiếu điện."
| Tiêu chí đạt | Máy | Người |
|---|---|---|
| Nhập được báo giá; tổng phần đã biết đổi thành 31.372.000 đ | đạt | ☐ |
| Hiểu vì sao tổng hoàn chỉnh "chưa đủ" (thiếu khung, dây, bảo vệ, công) | máy chỉ kiểm nội dung hiển thị | ☐ |
| Chạy mô phỏng, bấm tới lần thiếu điện đầu tiên, đọc được giờ và lý do | đạt | ☐ |
| Phát biểu lại đúng: kết luận chỉ cho dữ liệu thời tiết 2023 đã chọn | — | ☐ |

## 2. Thợ — tạo một SKU, giải thích lỗi MPPT rồi sửa
Việc: "Thêm một pin 51,2 V 100 Ah của cơ sở bạn vào danh mục. Rồi áp mẫu 2 chuỗi cùng một MPPT; app báo lỗi, hãy giải thích cho chủ nhà vì sao và sửa."
| Tiêu chí đạt | Máy | Người |
|---|---|---|
| Tạo SKU, thấy nhãn "chưa kiểm datasheet" | đạt | ☐ |
| Đọc được công thức, giá trị/giới hạn, nguồn số liệu, hậu quả của lỗi Isc | đạt (có đủ các mục) | ☐ |
| Sửa bằng cách chuyển chuỗi 2 sang MPPT 2, lỗi hết | đạt | ☐ |
| Giải thích lại cho chủ nhà bằng lời của mình không cần đọc nguyên văn | — | ☐ |
| Gửi file cho thợ khác và họ mở lại, tái tạo A/B (gói đầy đủ) | đạt (máy B) | ☐ |

## 3. Người mới — bài nối chuỗi, thao tác độc lập
Việc: "Làm bài 1 'Ghép hai tấm'. Đừng hỏi ai."
| Tiêu chí đạt | Máy | Người |
|---|---|---|
| Chốt dự đoán, đổi sang song song, đọc được "đồng hồ" | đạt | ☐ |
| Giải thích lại được vì sao điện áp và dòng đổi mà công suất không đổi | — | ☐ |
| Chế độ cơ bản đủ hiểu (không cần chuyển sang kỹ sư) | — | ☐ |
| Hoàn thành không có người chỉ | — | ☐ |

## 4. Kỹ sư điện — đối chiếu datasheet và giải tay
Xem `engineer-crosscheck.md`: phiếu kiểm từng thông số của 11 thiết bị, sáu fixture giải tay của tác giả, và yêu cầu tự giải thêm ít nhất một fixture.

## 5. Đối chiếu thực địa (tùy dữ liệu có sẵn)
Xem `field-data.md`. **Hiện chưa có phép đo công trình nào**, nên v1 chỉ được ghi "đã đối chiếu mô hình".

## Ký nhận và vấn đề
| Vai trò | Người | Ngày | Kết quả | Ghi chú |
|---|---|---|---|---|
| Chủ nhà | _chưa có_ | | | |
| Thợ | _chưa có_ | | | |
| Người mới | _chưa có_ | | | |
| Kỹ sư điện | _chưa có_ | | | |
| Kỹ sư phần mềm (review mã) | _chưa có; mới có tự soát của tác giả và một lượt soát tự động_ | | | |
