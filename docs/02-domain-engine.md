# 2. Dữ liệu, mô hình điện và hợp đồng tính toán

## Từ thiết bị thị trường đến một lần chạy

| Đối tượng | Định danh và thuộc tính tối thiểu |
|---|---|
| ComponentRevision | modelId, revision, variant/SKU, hãng, loại, kích thước, thông số có đơn vị, datasheet URL/trang và ngày kiểm. Trường có thể mang provenance manufacturer, seller, measured, user hoặc assumption. Giá trị chưa biết dùng null. |
| Offer | offerId, componentRevision, seller, ngày ghi nhận, khu vực/kho, VND, đơn vị tính, bậc số lượng, VAT đã gồm/chưa gồm/chưa rõ, mới/cũ, phí giao, bảo hành, ngày hết hiệu lực nếu có. |
| ProjectRevision | projectId, revision, schemaVersion, tọa độ, múi giờ IANA, danh sách instances và edges, mặt mái, giá đã chọn, lịch tải, thiết lập dự phòng. Lưu bản chụp linh kiện để mở lại báo giá cũ. |
| Instance / Port / Edge | ID ổn định cho từng tấm, inverter, bank, bơm, controller và tải. Port có loại PV string, MPPT input, battery DC, AC load, grid hoặc pump DC. Giao diện cho phép tạo nhiều tấm cùng lúc và mở xem từng tấm. |
| Layout | roofFaceId, footprint theo mét, độ dốc/hướng mái; panelInstanceId, tọa độ trong mặt mái, hướng xoay, kích thước; vật cản và tọa độ địa lý. Một tấm có một vị trí và một assignment điện trong mỗi chế độ. |
| Scenario | projectRevision, weatherRef, khoảng thời gian, bước, policy tự dùng/độc lập, SoC đầu kỳ, ưu tiên tải, giả định và lịch chuyển chế độ được phép. A/B ghi lại những trường đã đổi. |
| Run / Report | engineVersion, inputHash, weatherHash, catalogRevisions, shadeModelVersion, timeStep, boundaryConditions, runId, status, issues, series, metrics và đơn vị. Report thêm pricingHash để phát hiện giá đổi trong khi điện năng vẫn đúng. |

Ví dụ payload mô tả assignment điện (trích từ một project, các instance và port liên quan đã tồn tại). Tám tấm cùng watt có thể chia thành hai chuỗi gắn vào hai MPPT riêng. Độ phù hợp chỉ xác định sau khi nạp thông số tấm và inverter.

```json
{
  "strings": [
    {"id":"S1","panelIds":["P1","P2","P3","P4"],"mpptPortId":"INV1.M1"},
    {"id":"S2","panelIds":["P5","P6","P7","P8"],"mpptPortId":"INV1.M2"}
  ],
  "batteryBank":{"id":"B1","inverterPort":"INV1.BAT"},
  "loads":[{"id":"pump","sourcePort":"INV1.AC","scheduleId":"pump-day"}],
  "policy":{"gridAvailable":false,"exportAllowed":false,"minSoc":0.20}
}
```

**Thông số theo loại.** Tấm pin có Pstc, Voc/Vmp, Isc/Imp, hệ số nhiệt Voc, Pmax và Vmp khi có, kích thước, mặt trước/sau. Inverter có giới hạn Voc tuyệt đối, điện áp khởi động, khoảng MPPT, dòng hoạt động và dòng ngắn mạch cho phép từng tracker, công suất DC/AC, đường hiệu suất, tự tiêu thụ, VA/W liên tục và đỉnh theo thời lượng, dải pin và giới hạn sạc/xả. Battery có hóa học, V danh định và vận hành, Ah hoặc kWh danh nghĩa/khả dụng, số module song song được hãng cho phép, dòng liên tục/đỉnh có thời lượng, BMS, SoH, SoC tối thiểu/tối đa. Ghi giao thức và chứng cứ phù hợp theo đúng model/firmware để phân biệt tương thích điện với giao tiếp BMS. Tải có W hoặc VA và hệ số công suất, lịch, tính ưu tiên, dòng hoặc VA khởi động. Bơm muốn ước tính nước cần đường Q–H và tổng cột áp gồm tổn thất đường ống.

**Phân quyền kết quả theo dữ liệu.** Thiếu giá chặn tổng hoàn chỉnh, vẫn tính điện. Thiếu Voc hoặc giới hạn của cổng chặn kết luận tương thích của chuỗi đó. Chế độ học cho chạy với giả định minh họa ghi rõ trong report; một kết quả vi phạm giới hạn tuyệt đối chỉ xuất chẩn đoán, loại khỏi danh sách phương án khả thi. Thiếu đường cong bơm vẫn có thể tính tải điện từ W và lịch chạy. Mỗi issue có code ổn định, severity, objectIds, field, giá trị, giới hạn, đơn vị, nguồn và hành động sửa.

## Compile và kiểm tra sơ đồ

1. Kiểm tra schema, ID duy nhất, cổng có tồn tại, DC/AC đúng loại, chiều công suất, số cổng và cấp tham chiếu. Đếm mỗi instance vật lý đúng một lần trong BOM. Khi một nhóm được bung thành nhiều tấm, giữ ID để map report/3D.
2. Tạo tập string theo từng MPPT. Trong chuỗi cùng model, điện áp các tấm cộng, dòng bị giới hạn bởi phần tử yếu. Chuỗi song song cùng tracker có cùng điện áp vận hành và cộng dòng. Cấu hình tấm hỗn hợp hay hình học khác nhau trên cùng tracker cần model mismatch, gắn cảnh báo hoặc giới hạn mức kết luận.
3. Kiểm Voc lạnh theo `Voc(T) = Voc_STC × [1 + βVoc × (Tcell − 25)]`. Lưu β theo phân số/°C, chuyển từ % đúng một lần. Dùng nhiệt độ thiết kế thấp của địa điểm và phương pháp ghi trong project. Đối chiếu Vmp nóng/lạnh với dải tracking; ngưỡng khởi động và dòng Isc tối đa là các kiểm riêng. Không suy βVmp từ βPmax. Các hệ số dự phòng thiết kế lấy theo hồ sơ đã chọn và nguồn, không gán một hệ số bất biến cho mọi hãng.
4. Kiểm dải DC pin, giới hạn liên tục/đỉnh của cả bank và inverter, điện áp và giới hạn controller bơm. MPPT current clipping có thể là giới hạn vận hành; vượt điện áp tuyệt đối hoặc vượt giới hạn ngắn mạch là lỗi thiết kế. Nêu rõ phép kiểm dùng datasheet nào. [Ví dụ hướng dẫn DC của SMA](https://manuals.sma.de/STP8-10-3AV-40/en-US/391157771.html)
5. Cho phép hai trạng thái của case Lâm Hà nếu project khai báo chuyển nguồn mô phỏng. Mỗi trạng thái có graph độc lập, một tấm chỉ được một controller sử dụng trong một khoảng. Khi đổi trạng thái, chụp topology trước và sau; gộp điện năng theo thời gian. Thiết kế một trạng thái tĩnh cho mỗi phương án là đường triển khai đầu tiên.

## Thời tiết và công suất PV

**Đầu vào.** Chấp nhận chuỗi giờ CSV mẫu hoặc file nhập theo template. Từng bản ghi có timestamp, quy ước đầu/cuối khoảng, Δt, GHI/DNI/DHI hoặc POA được khai báo rõ, nhiệt độ không khí và gió nếu model yêu cầu. Lưu vị trí, cao độ nếu biết, nguồn, phiên bản, khoảng năm và phương pháp dữ liệu (đo, lịch sử, năm điển hình hoặc giả lập). Đổi UTC sang giờ địa phương khi áp lịch tải; phát hiện timestamp trùng, khoảng trống, năm nhuận và dữ liệu ngoài phạm vi. Nếu thiếu trường, yêu cầu chọn phương pháp ước tính có tên hoặc từ chối phép tính bị ảnh hưởng. Dataset một ngày phục vụ bài học; báo cáo theo năm yêu cầu chuỗi phủ cả kỳ hoặc một năm điển hình được khai báo.

**Model v1.** Tính vị trí mặt trời theo tọa độ và thời gian. Nếu đầu vào là GHI/DNI/DHI, chuyển về bức xạ trên mặt phẳng tấm (POA) theo hướng mái, độ nghiêng và phản xạ mặt đất. Ghi rõ model transposition và nhiệt độ (ví dụ isotropic + Faiman với hệ số đã công bố trong fixture). POA đầu vào trực tiếp sử dụng đúng hướng mặt phẳng đã khai báo. Từ bức xạ hữu hiệu và nhiệt độ cell, ước tính `Pdc = max(0, Pstc × Geff / 1000 × [1 + γP × (Tcell−25)])`. Công bố khả năng mô hình theo fixture; xét tổn hao dây và hiệu suất tại đúng ranh giới. Khi đủ thông số, profile nâng cao dùng I–V/diode để giải điểm làm việc chung của chuỗi. Bước đầu có thể chỉ dùng model gần đúng cho chuỗi đồng nhất; UI hiển thị model đang dùng. [pvlib ModelChain](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.modelchain.ModelChain.html) · [pvlib đọc dữ liệu PVGIS theo giờ](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.iotools.get_pvgis_hourly.html)

## Dispatch theo bước thời gian

Chọn hệ DC-coupled với một cổng AC ra tải. Nội bộ dùng W và Wh, Δt tính theo giờ. Bắt đầu từ PV sau tổn hao phía dàn, công suất pin tại DC bus, tải AC và hiệu suất tầng chuyển đổi. Ở mỗi bước:

1. Mở trạng thái graph và lịch tải có hiệu lực, lấy khả năng phát từng MPPT. Trừ tự dùng đúng phía thiết bị theo cấu hình. Giới hạn đầu vào và đầu ra được ghi bằng lý do riêng.
2. Ưu tiên PV cấp tải. Phần PV dư sạc bank tới giới hạn thấp nhất trong mức dư, BMS, inverter và dung lượng còn trống trong Δt. Phần còn lại cho xuất nếu policy và model cho phép, hoặc ghi điện bị cắt. Cấu hình độc lập có nhập/xuất lưới bằng 0.
3. Khi PV thiếu, pin cấp phần còn lại trong giới hạn dòng × điện áp, giới hạn inverter và lượng Wh trên mức dự phòng. Sau đó lấy lưới nếu được phép, còn thiếu ghi `unservedWh` theo tải. Chia giữa tải theo ưu tiên đã khai báo. Chỉ cấp một thao tác khởi động motor nếu đạt yêu cầu công suất và thời lượng đỉnh (cần VA, hệ số công suất/đặc tính motor và datasheet khi liên quan). Dữ liệu giờ không thể giải quá độ mili giây; xuất kết quả kiểm điều kiện riêng.
4. Cập nhật `E_end = E_start + ηcharge × Echarge_bus − Edischarge_bus / ηdischarge`. Với bước dài, tính giới hạn Wh trước khi tích phân; cùng một bank chỉ sạc hoặc xả trong một bước. Nếu dung lượng đầu vào đã là usable, xác định dải SoC trên cùng cơ sở để tránh trừ DoD hai lần.
5. Ghi ledger và reason codes cho mỗi bước. Báo DC clipping, export và curtailed ở các vị trí riêng; công suất PV tiềm năng với phần đã cấp có cùng ranh giới đo. Nhánh bơm DC có ledger riêng rồi gộp vào công trình. Đổi lịch chạy giữa một giờ dữ liệu khí tượng bằng chia khoảng dispatch; ghi bước khí tượng và bước dispatch độc lập.

**Phương trình kiểm.** Tại biên toàn hệ, `PV_potential + grid_import + E_start = loads_served + grid_export + curtailed + all_losses + E_end` (Wh). `all_losses` gồm các tổn hao nằm sau biên PV đã chọn và điện tự dùng; mỗi khoản được ghi một lần. `load_requested = load_served + unserved`. Tự tiêu thụ PV và mức tự chủ là hai mẫu số khác nhau; nếu lưới có sạc pin trong một profile tương lai, bắt buộc theo dõi nguồn Wh sạc trước khi gắn nhãn “điện mặt trời tự dùng”.

**Ví dụ xác định.** Với 1 giờ, 2.000 Wh PV tại bus, tải AC 900 Wh, inverter 90%, bank còn chỗ và hiệu suất sạc 95%: cấp inverter 1.000 Wh, sạc 1.000 Wh phía bus, tăng 950 Wh trong pin, tổn hao 150 Wh. Ban đêm với 1.000 Wh trên mức dự phòng, ηxả=95% và ηinv=90%, tối đa 855 Wh tới tải nếu giới hạn công suất cho phép. Dùng cả hai ví dụ làm unit test; đổi độ dài bước phải cho kết quả tương đương với tải và nắng không đổi.

## Hợp đồng worker và hiệu lực của báo cáo

```ts
type RunRequest = { type: "run"; runId: string; inputHash: string; input: CompiledScenario };
type RunEvent =
  | { type: "progress"; runId: string; completedSteps: number; totalSteps: number }
  | { type: "result"; runId: string; inputHash: string; result: RunResult }
  | { type: "failure"; runId: string; issues: Issue[] }
  | { type: "cancelled"; runId: string };
type Cancel = { type: "cancel"; runId: string };
```

`compile(project, snapshots)` và `simulate(input, progress, cancel)` có thể gọi từ Node và worker. Đóng băng array order có ý nghĩa; sắp xếp map theo ID trước khi hash. Dùng JSON canonical + SHA-256; loại camera, giá và thời điểm tạo run khỏi khóa năng lượng, có hash riêng cho layout gây bóng, thời tiết và policy. Một lần chạy mới nhận input bất biến. Engine chỉ ghi result sau khi hoàn tất tất cả bước và kiểm ledger. Worker nhường event loop theo batch để nhận cancel; khi timeout có thể terminate và tạo worker mới. UI đối chiếu runId/inputHash trước khi hiển thị. Mở lại report lịch sử đọc snapshot của lần chạy đó.

**Metrics.** kWp danh nghĩa; PV khả dụng và thực thu theo biên; AC tải phục vụ; tổn hao theo tầng; phần bị cắt; giờ và Wh thiếu; SoC tối thiểu; thời điểm chạm dự phòng; tỷ lệ đáp ứng = served/requested; điện tự dùng theo định nghĩa nguồn; suất phát kWh/kWp theo kỳ; tổng vốn và chi phí tăng thêm giữa A/B. Với mẫu số bằng 0, trả null kèm diễn giải. Ước tính sản lượng và mức pin luôn đi kèm thời tiết, giả định, bước và topology. Không suy thời gian hoàn vốn từ hệ off-grid khi chưa có chi phí thay thế do người dùng cung cấp.
