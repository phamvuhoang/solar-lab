# 3. Catalog Việt Nam, trải nghiệm học và thiết kế 3D

## Catalog, thiết bị tùy biến và dự toán

Catalog khởi đầu có các họ sản phẩm người dùng đang cân nhắc: VSUN 600/620 W, Hestia 630–650 W, Luxpower SNA 6000 WPV, Dyness DL5.0C và bộ lưu trữ cũ do người dùng khai báo. Mỗi biến thể kỹ thuật dùng một revision riêng; bản ghi thiếu mã chính xác có thể dùng để tính công suất danh nghĩa và so giá, cần đủ thông số trước khi mở kiểm tra MPPT. Mỗi lần chỉnh dữ liệu, lưu tác giả sửa, ngày và nguồn. Phiên bản catalog phát hành sau không tự sửa dự án khách đã gửi.

| Thao tác | Hành vi cần có |
|---|---|
| Tạo từ datasheet | Nhập đơn vị ngay ở trường, chuyển sang hệ nội bộ một lần. Đối chiếu Pmp xấp xỉ Vmp × Imp theo dung sai khai báo, Voc > Vmp và Isc ≥ Imp trong cùng điều kiện STC. Gắn cờ khi hai nguồn khác nhau. |
| Nhân bản/sửa model | Tạo revision riêng của người dùng, hiển thị diff và các dự án có thể nâng cấp. Sửa một báo giá gửi thợ không làm đổi công suất hoặc làm chạy lại engine. |
| Thêm hàng cũ | Lưu tình trạng, bảo hành, ngày đo SoH/dung lượng nếu có. So sánh hai giả định SoH trong sensitivity; chưa có số đo thì dùng nhãn “giả định”. |
| Xây BOM | Một design phát sinh thiết bị; bảng dự toán cho bổ sung khung, thiết bị bảo vệ, tủ, dây, nhân công, giao hàng, thuế. Lưu loại “từ sơ đồ” hoặc “bổ sung” để tránh đếm đôi. |
| Dây và giá theo bậc | Dùng số nguyên mm cho chiều dài và VND/m cho đơn giá. Ví dụ 12,5 m × 18.000 đ/m = 225.000 đ. Quy đổi bằng số nguyên và làm tròn đến đồng theo dòng, trước khi cộng bằng BOM. Tách bước chọn đúng bậc theo số tấm/pallet khỏi bước cộng tiền. |
| Báo giá thiếu | Từng dòng có trạng thái known, missing hoặc included-in-kit. Hiện “đã có giá”, “còn thiếu”, VAT và phạm vi lắp đặt. Một bộ kit giữ bảng cấu phần để đếm số thiết bị; giá gói thay cho giá con. |
| Báo cáo cho khách | In theo khổ A4, xuất CSV UTF-8, JSON dự án di động; ngày báo giá và hiệu lực nguồn hiển thị trên cùng trang tổng. Tách tổng vật tư, nhân công, VAT, vận chuyển, giảm giá và tổng phải trả. |

**Fixture Lâm Hà.** Người dùng cung cấp 3.200 đ/W cho VSUN 620 W mua lẻ tại kho và 16 triệu đồng cho bộ pin cũ 51,2 V × 165 Ah. Một tấm là 1.984.000 đ; tám tấm 15.872.000 đ; hai nhóm hàng cộng 31.872.000 đ. Ngân sách 30 triệu còn thiếu 1.872.000 đ ngay ở tổng phần có giá. Thiếu inverter, khung, dây và công nên tổng hoàn chỉnh là null. Năng lượng danh nghĩa bộ pin là 8,448 kWh; nếu 100 A được xác nhận là dòng liên tục và hiệu suất inverter giả định 93%, tại điện áp danh nghĩa giới hạn tức thời riêng nguồn pin xấp xỉ 4,76 kW AC. Ghi riêng hai điều kiện này trong bài học. Mọi giá trong fixture mang nhãn “báo giá dự án” và ngày lấy giá nếu biết.

**Quy trình dữ liệu.** Một catalog editor nhập → một người kiểm đối chiếu datasheet đúng SKU → script validate schema/đơn vị → phát hành catalog version. Giá thị trường là danh sách offer theo nhà bán, ngày và tỉnh. Khi nguồn chỉ có “liên hệ”, giá là null. Nguồn tham khảo để biên tập: [Dyness DL5.0C tại Gia Hưng Solar](https://giahungsolar.vn/san-pham/pin-luu-tru-dyness-dl5-0c/) · [Luxpower SNA6000WPV tại Titech](https://titech.com.vn/san-pham/bien-tan-nang-luong-mat-troi-luxpower-sna6000wpv/) · [Dòng Hestia tại Venergy](https://venergy.vn/san-pham/tam-pin-nang-luong-mat-troi-hestia-solar-630w-650w/).

## Từ sơ đồ 2D đến bài học tương tác

**Màn hình Thiết kế.** Bên trái là danh mục, giữa là sơ đồ điện, bên phải là inspector của thiết bị/cổng đang chọn. Mobile có danh mục và inspector dạng sheet, đồng thời có danh sách kết nối dùng với bàn phím. Lệnh “Thêm 8 tấm” có preview số lượng, đề nghị nhóm chuỗi và cho xác nhận. Connector hiển thị loại, chiều và ID. Một thiết bị có thể xuất hiện ở sơ đồ, mặt bằng và report, nhưng chỉ có một instance. Undo phục hồi đồng thời graph, số lượng và BOM.

**Màn hình Chạy thử.** Timeline dùng giờ Việt Nam của project. Phát nhanh một ngày, tua đến giờ pin đầy, chạm dự phòng hoặc bơm khởi động. Độ dày nét thể hiện dải công suất; mũi tên thể hiện chiều; con số và đơn vị luôn đọc được khi tắt motion. Dừng animation giữ nguyên dữ liệu và timestamp. Người mới bấm “Vì sao?” để xem một câu giải thích và phép tính; chế độ kỹ sư mở rộng ledger, thông số nguồn, rule code và CSV theo bước.

**Ba bài học ban đầu.** (1) Ghép hai tấm: dự đoán V/A khi nối tiếp, đổi sang song song rồi kiểm tra đồng hồ. (2) Đổi giờ bơm từ 18h sang 11h: dự đoán mức pin tối thiểu rồi xem A/B với cùng thời tiết và tải nhà. (3) Dịch tấm khỏi bóng bồn nước: xem tấm nào bị che, chuỗi nào liên quan và sản lượng thay đổi bao nhiêu trong cùng buổi sáng. Mỗi bài có fixture, hành động cần thực hiện, kết quả đo được và nút reset bản sao của bài.

## Mô hình hình học

Một mặt mái có đa giác biên, lỗ/vùng loại trừ, hệ tọa độ cục bộ, độ dốc và azimuth. Dữ liệu thế giới lưu theo **Đông, Bắc, Lên** tính bằng mét. Adapter Three.js dùng **x=Đông, y=Lên, z=−Bắc**. Azimuth tính theo chiều kim đồng hồ từ Bắc, góc cao mặt trời tính từ đường chân trời. Mỗi panel lưu vị trí tâm và góc trên mặt mái; kích thước lấy từ component revision. Scene lấy kết quả qua selector, không tự tạo instance điện khi vẽ lại.

Editor hỗ trợ vẽ mặt mái dạng đa giác phẳng, nhập kích thước tay, đặt dãy tấm, xoay dọc/ngang, chỉnh khoảng cách, kéo lẻ, chọn nhiều và thêm vật cản hộp/trụ. Kiểm tra bốn góc và giao đa giác với biên mái/vùng cấm, khoảng cách tới mép cấu hình được, va chạm giữa các tấm và kích thước không xác định. Khoảng cách minh họa trong preset có provenance “giả định thiết kế”. Dự án có thể nhập footprint bằng tay nếu thiếu dữ liệu ảnh/bản đồ.

**Đọc cách lắp.** Chế độ phân lớp hiển thị mái → ray/khung minh họa → vị trí tấm → ID string/MPPT → inverter, bank và tải. Bật/tắt overlay route để thấy một chuỗi đi tới cổng nào, chọn dây để đọc số liệu và BOM. Đường dây là định tuyến khái niệm; chiều dài bóc tách có nguồn “người dùng nhập”, “đo theo route” hoặc “ước lượng + dự phòng”. Sơ đồ dùng dạy cấu trúc, báo cáo ghi rõ các thông số thi công cần người lắp xác nhận như tiết diện, thiết bị bảo vệ và vị trí thực tế.

## Sơ đồ 3D phải ảnh hưởng phép tính như thế nào?

1. Tính vector hướng mặt trời tại mỗi khoảng và hướng pháp tuyến tấm. Với góc cao ≤ 0, thành phần trực xạ bằng 0. Tách direct, sky diffuse và ground reflected. Một hệ số bóng trực xạ được áp vào **thành phần trực xạ đúng một lần**.
2. Với cảnh mái/vật cản định hình, lấy mẫu điểm trên mặt mỗi panel, bắn ray về phía mặt trời. Bỏ chính mặt tấm, dùng offset nhỏ được ghi bằng đơn vị mét để tránh tự che. Chỉ số direct access bằng tỷ lệ điểm thấy được mặt trời. Dùng mô hình bóng theo tâm ở preview trong lúc kéo; khi thả, tính lưới mẫu chuẩn và ghi model/version trong run. Scene hiển thị bóng trên GPU; engine đọc kết quả hình học độc lập với độ sáng hoặc số khung hình của màn hình. [Three.js Raycaster](https://threejs.org/docs/#api/en/core/Raycaster)
3. Model v1 nhân direct access với POA direct của tấm. Đóng gói thành shadeSeries theo panel và thời gian. Diffuse/ground giữ theo giả định ghi trong model. Suy từ bức xạ sang tổn thất sản lượng của chuỗi bằng chế độ được công bố. Ở chế độ xấp xỉ, báo “ước tính theo bức xạ, chưa giải bypass diode/hotspot”; không công bố độ chính xác mô phỏng mismatch khi chỉ có phần trăm bóng.
4. Cache theo geometryHash, geolocation, timestamp grid và phiên bản thuật toán. Đổi màu mái/camera chỉ repaint; dịch bồn nước đánh dấu run cũ và tính lại shadow. Đổi giá giữ điện năng cũ. Khi chuyển về 2D hoặc mất WebGL, vẫn đọc được cùng series, heatmap dạng bảng và report.
5. Kiểm bằng các cảnh có nghiệm: mái trống giữa trưa, tấm bị hộp che hết, hai nửa tấm đối xứng, vật cản ở phía ngược mặt trời, tia sát mép và mặt trời dưới chân trời. Cảnh A/B cố định thời tiết; giá trị 3D tại con trỏ phải bằng cùng ô trong CSV.

**Giới hạn hiệu năng đề xuất.** Benchmark trên MacBook Apple Silicon của đội và một Android tầm trung, ghi tên máy/browser/DPR. Mục tiêu bản đầu 40 tấm, 10 vật cản; tương tác camera 3D ≥30 FPS trên máy dev; ngày 3D hoàn chỉnh ≤2 giây trên máy dev sau warm-up. Với năm, gom panel biến đổi giống nhau, dùng bộ tăng tốc giao cắt và tính worker theo batch; kiểm dataset 8.760/8.784 giờ. Nếu chạy lâu, cho xem tiến độ/cancel và xuất lại từ cache. Mọi ngưỡng là mục tiêu nghiệm thu, chỉ chuyển sang “đạt” sau khi đính kèm phép đo.
