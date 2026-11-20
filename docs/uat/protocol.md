# Quy trình UAT 1.1: bốn tiêu chí "Đo thành công" và bốn nhóm người

**Trạng thái: CHƯA THỰC HIỆN với người thật.** Mỗi tiêu chí dưới đây đã có bản máy trong `tests/e2e/uat.spec.ts` (các test "Đo thành công (a)…(d)"). Bản máy cho thấy đường đi có thật và vừa giới hạn thời gian. Nó không cho biết một người lần đầu có tự tìm ra đường đó không, nhãn nào khó hiểu, hay số nào làm họ nghi. Việc đó chỉ người thật trả lời được. Kết quả ghi vào `docs/evidence/W15.md`. Bản 1.1.0 chính thức chỉ phát hành khi cả bốn tiêu chí đạt với người thật.

Bốn tiêu chí lấy từ `docs/05-experience-v2.md`, mục "Đo thành công".

## Chuẩn bị

- **Bản build:** bản ứng viên (`1.1.0-rc.1` hoặc mới hơn). Xem số phiên bản ở Trợ giúp → "Phiên bản và phạm vi kiểm chứng".
- **Trình duyệt:**
  - Máy tính: Chrome, cửa sổ từ 1280×720 trở lên.
  - Điện thoại: ít nhất một iPhone thật (Safari) và một Android tầm trung (Chrome).
- **Hồ sơ trình duyệt mới cho mỗi người** (hoặc cửa sổ ẩn danh mới). Lần mở đầu phải thật sự là lần đầu: chưa có dự án nào, chú thích lần đầu còn hiện, độ sâu ở mặc định Cơ bản.
- **Người quan sát** đọc to việc cần làm (chữ in nghiêng ở mỗi tiêu chí) rồi im lặng:
  - Không chỉ, không gật đầu, không trả lời câu hỏi về giao diện. Nếu người làm hỏi, nói: "Bạn cứ làm như bạn nghĩ."
  - Nếu người làm bế tắc quá giới hạn thời gian, hoặc người quan sát phải chỉ, tiêu chí đó **không đạt** với người này. Vẫn ghi lại chỗ vấp và câu đã nói.
- **Bấm giờ** từ lúc đọc xong việc cần làm tới lúc người làm nói "xong" và đọc kết quả.
- **Ghi lại:**
  - chỗ dừng quá 10 giây;
  - lần bấm nhầm;
  - lời người làm nói ra;
  - họ có đổi độ sâu không.
- **Không ghi tên thật vào repo.** Dùng mã người (N1, C1, T1, K1…). Danh sách mã ↔ người giữ ngoài repo.

**Công tắc độ sâu (Cơ bản · Thợ · Kỹ sư):**
- Trên máy tính: nằm ở thanh trên cùng.
- Trên điện thoại (màn hẹp hơn 720 px): nằm trong menu "⋯" (Tùy chọn) ở thanh trên, cùng Trang đầu, Hoàn tác, Làm lại và Trợ giúp.

Đổi độ sâu chỉ ẩn hoặc hiện chi tiết. Nó không đổi số nào.

## Bốn nhóm và việc của mỗi nhóm

Ai cũng bắt đầu bằng (d), vì đó là lần đầu họ mở app.

| Nhóm | Ai | Làm theo thứ tự |
|---|---|---|
| Người mới | Chưa từng dùng app, không làm nghề điện mặt trời | (d) → (a) → kịch bản 3 (bài học) |
| Chủ nhà | Người đang tính lắp cho nhà mình | (d) → (a) → kịch bản 1 (báo giá, giờ thiếu điện) |
| Thợ | Thợ lắp đặt điện mặt trời | (d) → (b) → kịch bản 2 (SKU, lỗi MPPT) |
| Kỹ sư điện | Người đọc được datasheet và tự kiểm thông số | (d) → (c) → `engineer-crosscheck.md` |

## (d) Lần đầu mở: thấy Nhà mẫu mà không cần thao tác nào

*"Mở đường dẫn này. Đừng bấm gì cả. Nói cho tôi bạn đang thấy gì."*

**Đạt khi, không có thao tác nào:**
- Người làm thấy một ngôi nhà có mái và tấm pin. Hình 2D hiện ngay; hình 3D hiện khi Three.js tải xong.
- Họ thấy nhãn "Mẫu minh họa · không phải báo giá".
- Họ không hiểu đây là báo giá hay khuyến nghị cho nhà mình. Hỏi sau cùng: "Đây có phải giá cho nhà bạn không?" Trả lời "phải" là **không đạt**.

**Giới hạn thời gian:** spec không đặt số giây. "Ngay" nghĩa là người làm không phải chờ, không phải hỏi, và không bấm gì mà vẫn có hình 2D. Nếu 3D lâu mới hiện, ghi lại; việc đó không làm tiêu chí hỏng, miễn là hình 2D đã hiện.

**Ghi trên điện thoại:**
- thời gian tới hình đầu tiên;
- thời gian tới khi có hình 3D;
- thời gian tới khi thanh dưới cùng có số (☀ … MWh/năm, mua lưới … kWh).

**Bản máy:** "Đo thành công (d)". Test giữ Three.js lại và kiểm Mặt bằng 2D với 8 tấm. Sau đó nó thả Three.js ra và kiểm 3D tự lên, không có cú bấm nào.

## (a) Người mới, không ai chỉ, trong 5 phút: Nhà mẫu 8 → 10 tấm, đọc tiền và điện mua lưới trước/sau

*"Đây là một nhà mẫu có 8 tấm pin. Trước hết, đọc cho tôi hai số: số tiền đã biết, và lượng điện phải mua của lưới mỗi năm. Rồi cho nhà này 10 tấm, và đọc lại hai số đó."*

**Đạt khi, trong 5 phút và không ai chỉ:**
- Nhà có 10 tấm.
- Người làm đọc đúng bốn số đang hiện trên màn hình: tiền đã biết trước và sau, điện mua lưới mỗi năm trước và sau.
- Họ nói đúng chiều đổi: tiền tăng, điện mua lưới giảm.
- Họ không phải rời Cơ bản. Nếu họ tự đổi độ sâu, ghi lại; việc đổi không làm tiêu chí này hỏng.

**Số tham chiếu** (bản máy ngày 20/11/2026, thời tiết đóng gói, bóng che xem trước):

| | Tiền đã biết | Mua lưới mỗi năm |
|---|---|---|
| 8 tấm | 15.872.000 đ | 343,4 kWh |
| 10 tấm | 19.840.000 đ | 326 kWh |

Nếu màn hình hiện số khác, tin màn hình và ghi cả hai.

**Bản máy:** "Đo thành công (a)". Đường đi gồm 5 thao tác: ba chú thích lần đầu, "Tấm pin" trong khối Thêm, "Xác nhận". Bản máy mất khoảng 11,1–11,6 giây; phần lớn là chờ tự chạy. Sau đó test kiểm số tiền trên thanh bằng phần đã biết ở Dự toán.

## (b) Thợ, trong 10 phút: từ số 0 dựng 6 tấm + inverter + pin + 1 tải, hết lỗi đỏ, in báo giá

*"Bạn là thợ. Làm một dự án mới từ đầu, không dùng nhà mẫu. Dựng 6 tấm pin, một inverter, một bộ pin lưu trữ và một tải. Khi không còn lỗi đỏ nào, in báo giá (lưu PDF cũng được)."*

**Đạt khi, trong 10 phút và không ai chỉ:**
- Thanh dưới cùng ghi "Điện: 0 lỗi". Các mục "bị giới hạn" (màu cam) và "chưa đủ dữ liệu" không phải lỗi đỏ.
- Hộp thoại in (hoặc file PDF) có trang báo cáo A4, với phần "Chi phí" và dòng 6 tấm pin.
- Thiết bị chưa có giá in ra là "CHƯA CÓ GIÁ", không phải 0 đ. Thiếu giá không làm tiêu chí hỏng.

**Độ sâu:** người làm tự chuyển sang Thợ. Việc chuyển tính trong 10 phút. Ghi lại họ có tìm thấy công tắc không, nhất là trên điện thoại, nơi nó nằm trong menu "⋯".

**Số tham chiếu** (bản máy):
- Thanh dưới: "Điện: 0 lỗi · 2 giới hạn · 4 chưa đủ dữ liệu".
- Dòng báo giá:
  - VSUN 620 W × 6: 11.904.000 đ;
  - inverter Luxpower: CHƯA CÓ GIÁ;
  - pin Dyness: CHƯA CÓ GIÁ.

**Bản máy:** "Đo thành công (b)".
- Đường đi: trang đầu → "Bắt đầu từ số 0" → Thợ → mặt mái chữ nhật → khối Thêm: Tấm pin (số tấm 6), Inverter, Pin, Tải → ⑤ Báo cáo → "In / lưu PDF (A4)".
- Test kiểm "0 lỗi" ở thanh và ở danh sách kiểm tra.
- Test kiểm nút in gọi hộp thoại in, rồi kiểm trang in ra PDF khổ A4.

## (c) Kỹ sư: từ một lỗi bất kỳ tới công thức và nguồn số liệu trong ≤ 2 thao tác

*"Mở nhà mẫu và chuyển sang chế độ Kỹ sư. Chọn một lỗi hoặc giới hạn bất kỳ mà app đang báo, rồi cho tôi xem công thức đã dùng và số liệu lấy từ đâu."* Làm lại với ít nhất ba mục khác nhau, trong đó ít nhất một mục không phải mục đầu danh sách.

Nhà mẫu không có lỗi đỏ nào (0 lỗi, 2 giới hạn, 4 chưa đủ dữ liệu), nên làm thêm **một lần với lỗi đỏ**:
- Người quan sát chuẩn bị sẵn, không tính vào thao tác: trang đầu → "Mở mẫu Lâm Hà" → ② Đấu nối → chọn mẫu "2 chuỗi song song trên MPPT 1" → "Áp dụng preset (thay mọi chuỗi)" → bấm bước ① Bố trí.
- Thanh dưới cùng khi đó báo "có lỗi" và danh sách có mục "Có lỗi: … Dòng ngắn mạch vượt giới hạn cổng".
- Việc đọc to: *"App đang báo một lỗi đỏ. Cho tôi xem công thức và số liệu của lỗi đó."*

**Phạm vi:** Kiểm tra cấu trúc (chuỗi, tải hay pin chưa nối; cổng sai loại hoặc sai chiều) vốn không có công thức hay nguồn số liệu: chi tiết của nó nêu quy tắc bị vi phạm và cách sửa. Vì vậy tiêu chí (c) áp dụng cho các kiểm tra có tính toán. Nếu kỹ sư chọn một kiểm tra cấu trúc, ghi lại; lần đó không tính vào tiêu chí, và người làm chọn mục khác.

**Đếm thao tác:**
- Bắt đầu đếm từ lúc người làm đã thấy lỗi, ở thanh dưới cùng hoặc trong danh sách.
- Mỗi lần bấm, chạm hoặc Enter là một thao tác.
- Cuộn trang và việc đổi độ sâu lúc đầu không tính.

**Đạt khi:**
- Mỗi lần, người làm tới được "Công thức: …" và dòng nguồn ("thiết bị · thông số = giá trị (nguồn)") trong tối đa 2 thao tác.
- Kỹ sư xác nhận công thức và nguồn đó đúng là của kiểm tra họ đã chọn.

**Giới hạn thời gian:** không có trong spec. Vẫn ghi thời gian mỗi lần.

**Bản máy:** "Đo thành công (c)".
- Ô Điện ở thanh dưới: 1 thao tác tới kiểm tra nặng nhất.
- Mỗi mục trong 6 mục của nhà mẫu: 2 thao tác (bước ② Đấu nối, rồi chính mục đó), bắt đầu từ bước ①.
- Lỗi đỏ ISC_TRACKER của Lâm Hà (2 chuỗi trên MPPT 1): ô Điện 1 thao tác; từ danh sách 2 thao tác. Chi tiết có "Công thức: … Σ_chuỗi min(Isc) …" và dòng nguồn.
- Test kiểm chi tiết hiện đúng mục đã bấm.

Lúc viết bản máy, test này tìm ra một lỗi thật: pin có hai giới hạn trên cùng một cổng (dòng sạc và dòng xả). Bấm "dòng xả" lại mở chi tiết của "dòng sạc". Lỗi đã sửa trong W15.

## Phiếu ghi: mỗi người một dòng cho mỗi tiêu chí

| Tiêu chí | Mã người | Nhóm | Ngày | Thiết bị · trình duyệt | Thời gian (mm:ss) | Số thao tác (c) | Số đọc được (a) / kết quả in (b) | Chỗ vấp, lời nói | Có người chỉ? | Đạt / không |
|---|---|---|---|---|---|---|---|---|---|---|
| (d) | | | | | | — | — | | | |
| (a) | | | | | | — | trước: … đ, … kWh; sau: … đ, … kWh | | | |
| (b) | | | | | | — | "0 lỗi"? PDF có Chi phí + 6 tấm? | | | |
| (c) | | | | | | lần 1: … · lần 2: … · lần 3: … · lỗi đỏ: … | — | | | |

Thời gian của (d) ghi ba số, cách nhau bằng "/": tới hình đầu / tới 3D / tới khi thanh có số.

## Điện thoại: kiểm riêng trên iPhone thật

- **Menu "⋯" trên iPhone (Safari):** chạm "⋯", rồi chạm lần lượt từng mục: Trang đầu, Hoàn tác, Làm lại, Cơ bản, Thợ, Kỹ sư, Trợ giúp. Xem mỗi mục có tác dụng thật không; với độ sâu, nút được chọn phải đổi.
  - Lý do phải thử: Safari không đưa focus vào nút khi chạm, mà menu tự đóng khi focus rời khỏi nó. Có khả năng menu đóng trước khi cú chạm kịp tới nút.
  - Máy tính và Chrome giả lập không kiểm được điều này.
- Tấm "Thêm ▲" và "Bảng bước ▲" mở và đóng bằng cách chạm, không có kéo. Ghi lại nếu người làm cố kéo.
- Chạm một thiết bị trên hình 3D thì "Bảng bước" mở lên và che tới 60 % khung nhìn. Ghi lại người làm có tìm được cách quay lại hình không.

## Kịch bản theo vai trò (từ v1, vẫn làm)

### 1. Chủ nhà: nhập lại một báo giá và chỉ ra giờ thiếu điện

*"Mở mẫu Lâm Hà. Kho vừa báo pin cũ giá 15.500.000 đ đã gồm VAT; hãy nhập báo giá đó. Rồi cho biết khi nào trong năm nhà bị thiếu điện."*

**Có một bước chủ nhà không tự làm ở Cơ bản.** Muốn thấy giờ thiếu điện, Lâm Hà phải được dựng thành cấu hình A (8 tấm chung vào inverter) bằng nút "Dựng A · tất cả tấm vào inverter, bơm AC" (`#cfg-shared8`) ở ③ Chạy thử → Hệ thống. Nút đó chỉ hiện từ độ sâu Thợ, vì dựng hệ thống điện là việc của thợ.
- Người quan sát nói trước: "Bước dựng cấu hình là việc thợ làm; khi tới đó, chuyển sang Thợ, bấm 'Dựng A', rồi về Cơ bản."
- Công tắc nằm ở thanh trên; trên điện thoại nó nằm trong menu "⋯".
- Câu nói trước này không tính là chỉ. Bản máy (`UAT chủ nhà` trong `uat.spec.ts`) cũng chuyển sang Thợ đúng một bước đó.

| Tiêu chí đạt | Máy | Người |
|---|---|---|
| Nhập được báo giá; tổng phần đã biết đổi thành 31.372.000 đ | đạt | ☐ |
| Hiểu vì sao tổng hoàn chỉnh "chưa đủ" (thiếu khung, dây, bảo vệ, công; sau khi dựng cấu hình còn thiếu giá inverter) | máy chỉ kiểm nội dung hiển thị | ☐ |
| Chạy mô phỏng, bấm tới lần thiếu điện đầu tiên, đọc được giờ và lý do | đạt | ☐ |
| Phát biểu lại đúng: kết luận chỉ cho dữ liệu thời tiết 2023 đã chọn | — | ☐ |

### 2. Thợ: tạo một SKU, giải thích lỗi MPPT rồi sửa

*"Thêm một pin 51,2 V 100 Ah của cơ sở bạn vào danh mục. Rồi áp mẫu 2 chuỗi cùng một MPPT; app báo lỗi, hãy giải thích cho chủ nhà vì sao và sửa."*

Cần độ sâu Thợ để thấy form thiết kế. Công thức và nguồn chỉ hiện ở Kỹ sư.

| Tiêu chí đạt | Máy | Người |
|---|---|---|
| Tạo SKU, thấy nhãn "chưa kiểm datasheet" | đạt | ☐ |
| Đọc được công thức, giá trị/giới hạn, nguồn số liệu, hậu quả của lỗi Isc | đạt (có đủ các mục) | ☐ |
| Sửa bằng cách chuyển chuỗi 2 sang MPPT 2, lỗi hết | đạt | ☐ |
| Giải thích lại cho chủ nhà bằng lời của mình không cần đọc nguyên văn | — | ☐ |
| Gửi file cho thợ khác và họ mở lại, tái tạo A/B (gói đầy đủ) | đạt (máy B) | ☐ |

### 3. Người mới: bài nối chuỗi, thao tác độc lập

*"Làm bài 1 'Ghép hai tấm'. Đừng hỏi ai."* Bài học nằm ở Trợ giúp → Bài học.

| Tiêu chí đạt | Máy | Người |
|---|---|---|
| Chốt dự đoán, đổi sang song song, đọc được "đồng hồ" | đạt | ☐ |
| Giải thích lại được vì sao điện áp và dòng đổi mà công suất không đổi | — | ☐ |
| Chế độ cơ bản đủ hiểu (không cần chuyển sang kỹ sư) | — | ☐ |
| Hoàn thành không có người chỉ | — | ☐ |

### 4. Kỹ sư điện: đối chiếu datasheet và giải tay

Xem `engineer-crosscheck.md`. File đó có:
- phiếu kiểm từng thông số của 11 thiết bị;
- sáu fixture giải tay của tác giả;
- yêu cầu tự giải thêm ít nhất một fixture.

### 5. Đối chiếu thực địa (tùy dữ liệu có sẵn)

Xem `field-data.md`. **Hiện chưa có phép đo công trình nào**, nên app chỉ được ghi "đã đối chiếu mô hình".

## Ký nhận và vấn đề

| Vai trò | Người | Ngày | Kết quả | Ghi chú |
|---|---|---|---|---|
| Người mới | _chưa có_ | | | |
| Chủ nhà | _chưa có_ | | | |
| Thợ | _chưa có_ | | | |
| Kỹ sư điện | _chưa có_ | | | |
| Kỹ sư phần mềm (review mã) | _chưa có; mới có tự soát của tác giả và một lượt soát tự động_ | | | |
