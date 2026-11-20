# 5. Trải nghiệm v2: mở ra là thấy hệ thống

**Trạng thái: ĐỀ XUẤT, chờ duyệt (20/11/2026).** Tài liệu này là spec cho đợt nâng cấp sau `1.0.0-rc.2`. Nó không đổi công thức, số liệu hay kết quả nào của engine; nó đổi cách người dùng đi tới các kết quả đó. Kế hoạch chi tiết từng wave (W10–W15) chỉ viết sau khi spec này được duyệt.

## Vì sao phải làm

Engine, kiểm tra điện, dự toán, bóng che và báo cáo đã có và đã đối chiếu. Phần chặn người dùng là lớp vỏ:

| Hiện trạng (rc.2) | Hậu quả |
|---|---|
| Trang đầu là một ô nhập tên và một hàng nút không có kiểu dáng; cột nội dung rộng 48rem | Người mới không biết bấm gì trước, không thấy sản phẩm làm được gì. |
| Màn hình dự án là 13 nút ngang hàng (Thiết kế, Mái nhà 3D, Bóng che, Mô phỏng PV, Hệ thống, Báo cáo, Bài học, Dự toán, Thiết bị, …) | Không có thứ tự công việc; mỗi nút thay toàn bộ trang nên mất ngữ cảnh. |
| "Mở mẫu Lâm Hà" chỉ tạo 8 tấm + 1 pin: chưa có mái, inverter, chuỗi, tải | Mẫu mở ra là một danh sách, không chạy được gì cho tới khi người dùng tự dựng thêm 5–6 bước ở 4 màn hình. |
| 3D chỉ có ở màn hình Mái/Bóng che và chỉ vẽ mái, tấm, ray, đường chuỗi, vật cản | Inverter, pin, tải, bơm, lưới không có hình: người mới không thấy "hệ thống". |
| Mỗi kết quả phải tự bấm chạy ở màn hình riêng (PV → Hệ thống → Báo cáo), sau khi tự chọn thời tiết | Sửa một tấm xong không biết điện, tiền, lỗi đổi thế nào. |
| Thêm/bớt thiết bị bằng `select` + nút trong form "Preset và nhánh", "Kết nối (thay cho kéo thả)" | Thợ dùng được nhưng chậm; người mới không hiểu nhãn. |
| Chế độ cơ bản/kỹ sư chỉ có trong Bài học | Kỹ sư phải lội qua lời giải thích; người mới bị ngợp bởi mã lỗi và công thức. |
| UAT với người thật chưa làm (`docs/uat/protocol.md`) | Chưa có bằng chứng người nào tự dùng được. |

## Mục tiêu

1. **Không bấm gì vẫn thấy một hệ thống hoàn chỉnh trong 3D**: lần đầu mở app là vào "Nhà mẫu", đã lắp đủ, không có lỗi đỏ, đã có kết quả.
2. **Thiết kế bằng cách thêm/bớt/đổi từ thứ đang thấy**, hoặc **bắt đầu từ số 0** với danh sách bước dẫn đường.
3. **Sửa xong là thấy hậu quả**: lỗi điện, sản lượng, giờ thiếu điện và tiền tự cập nhật ở một chỗ cố định.
4. **Một app, ba độ sâu** (Cơ bản · Thợ · Kỹ sư): cùng dự án, cùng con số, khác lượng chi tiết. Mỗi nhóm có thứ đáng mang về (bảng dưới).
5. **Dùng được trên điện thoại** ở công trình, và vẫn dùng được khi không có WebGL hoặc tắt chuyển động.

| Nhóm | Câu hỏi họ mang tới | Thứ họ mang về |
|---|---|---|
| Người mới / chủ nhà (Cơ bản) | "Nhà tôi cần gì, hết bao nhiêu, có đủ điện không?" | Hình hệ thống có tên từng món, ba con số bằng lời thường (tự lo được bao nhiêu phần điện và thiếu bao nhiêu giờ/năm, tiền đã biết và còn thiếu giá gì, lỗi phải hỏi thợ), nút "Vì sao?", bài học. |
| Thợ lắp đặt (Thợ) | "Bộ này đấu thế nào, có vượt MPPT không, báo giá bao nhiêu?" | Lắp nhanh từ khối có sẵn, kiểm chuỗi/MPPT/pin có cách sửa, SKU của cửa hàng mình, BOM + báo giá A4, bảng đấu nối theo chuỗi/cổng, gói gửi thợ khác. |
| Kỹ sư / chuyên gia (Kỹ sư) | "Số này từ đâu ra, giả định gì, tôi kiểm lại được không?" | Công thức, giá trị/giới hạn, nguồn từng thông số, giả định, ledger theo bước, CSV, A/B theo revision, hash đầu vào, phạm vi kiểm chứng. |

**Đo thành công** (ghi vào bằng chứng W15, làm với người thật theo `docs/uat/protocol.md`):

- Người mới, không ai chỉ, trong 5 phút: đổi Nhà mẫu từ 8 lên 10 tấm rồi đọc đúng tiền đã biết và lượng điện mua lưới mỗi năm trước/sau.
- Thợ, trong 10 phút: từ số 0 dựng 6 tấm + inverter + pin + 1 tải, hết lỗi đỏ, in báo giá.
- Kỹ sư: từ một lỗi bất kỳ tới công thức + nguồn số liệu trong ≤ 2 thao tác.
- Lần đầu mở: thấy Nhà mẫu (ảnh 2D ngay, 3D khi Three.js tải xong) mà không cần thao tác nào.

## Ngoài phạm vi và điều phải tránh

**Không làm trong đợt này:** đổi thuật toán PV/dispatch/bóng che; thêm loại thiết bị điện mới vào engine (aptomat, SPD, công tơ vẫn là dòng dự toán); nhiều inverter song song, ba pha; tài khoản, đồng bộ, backend; đa ngôn ngữ; vẽ mái từ ảnh vệ tinh; đổi framework.

**Làm ra mà sai thì coi như hỏng:**

- Chế độ Cơ bản che lỗi, che giả định hoặc làm con số trông chắc chắn hơn thực tế. Ẩn chi tiết thì được, ẩn trạng thái "lỗi / giới hạn / chưa đủ dữ liệu" thì không.
- Nhà mẫu bị hiểu là khuyến nghị hay báo giá. Nó luôn mang nhãn "mẫu minh họa", giá thiếu vẫn hiện là thiếu.
- Hình 3D nói khác engine. Mọi thứ vẽ ra mà engine không tính (tủ điện, công tơ, đường dây) mang nhãn "minh họa" và không có số liệu bịa.
- Dự án đã lưu ở rc.2 mở ra bị đổi kết quả, hoặc gói đã xuất không nhập lại được.
- Bỏ đường bàn phím: mọi thao tác trên 3D phải có đường tương đương bằng danh sách/nút như hiện nay.

## Ràng buộc

- Giữ nguyên: vanilla TypeScript + `h()` (`src/ui/dom.ts`), Three.js nạp lười, IndexedDB, offline service worker, một lockfile, không thêm dependency.
- `tests/fixtures/golden/lamha-matrix.json` và mọi unit test của engine phải xanh mà không sửa. `docs/release/input-lock.json` được khóa lại có chủ đích (`node scripts/lock.mjs --write` sau khi đọc diff) ở wave nào đổi `schemas/` hoặc `data/`; diff khóa chỉ được chứa đúng các file wave đó nêu, số golden không đổi.
- Schema dự án chỉ được thêm trường tùy chọn (như đã làm với `owner`); `schemas/project-v1.json` đang `additionalProperties: false` nên phải cập nhật cùng lúc, kèm test nhập lại file rc.2.
- `openLamHa()` và preset Lâm Hà giữ nguyên hành vi (fixture của UAT, golden và e2e).
- E2E hiện có 1.480 dòng bám vào `id` của điều khiển. Điều khiển nào còn tồn tại thì giữ `id`; điều hướng đổi thì sửa test trong cùng wave, không để đỏ qua wave.
- Báo cáo A4 (`.report-page`, `@media print`) không đổi bố cục.
- Repo công khai, độc lập.

## Các hướng đã cân nhắc

| Hướng | Nội dung | Được | Mất |
|---|---|---|---|
| **A. Vỏ workspace trên nền hiện có** (chọn) | Viết lại lớp điều hướng và bố cục (`src/ui/app.ts`, CSS), giữ từng màn hình hiện có làm panel; mở rộng `SceneModel` để vẽ cả thiết bị; thêm seed, tự chạy, ba độ sâu. | Không thêm dependency, engine và phần lớn test không đụng tới, giao được từng wave, mỗi wave dùng được ngay. | `app.ts` phải tách lại; kiểu "vẽ lại cả màn hình sau mỗi lần sửa" cần siết để form bên cạnh không mất nội dung. |
| B. Viết lại UI bằng framework (React/Svelte + react-three-fiber) | Dựng lại toàn bộ 2.000 dòng `src/ui` | Component và state chuẩn hơn về lâu dài. | Thêm dependency lớn, viết lại gần hết e2e, vài tuần không có gì mới cho người dùng; vấn đề hiện tại là bố cục và luồng, không phải thiếu framework. |
| C. Thêm trình hướng dẫn từng bước lên giao diện cũ | Wizard dẫn qua các màn hình hiện có | Rẻ nhất. | Không có "mở ra là thấy 3D", không có thêm/bớt trực tiếp, thợ và kỹ sư không được gì. |

Chọn **A**, lấy phần hay của C (danh sách bước dẫn đường) cho chế độ bắt đầu từ số 0. Đây là lựa chọn của người viết spec; chủ dự án đã giao phần "làm thế nào".

## Thiết kế

### 1. Bố cục workspace

Một dự án = một màn hình làm việc, không còn trang nút. Khung nhìn (3D/sơ đồ/mặt bằng) luôn ở giữa và không bị dựng lại khi đổi bước.

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ Solar Lab ▸ Nhà mẫu ▾   ↶ ↷   Đã lưu · r12      [Cơ bản|Thợ|Kỹ sư]   ? Trợ giúp │
├───────────────────────────────────────────────────────────────────────────────┤
│ ① Bố trí   ② Đấu nối   ③ Chạy thử   ④ Chi phí   ⑤ Báo cáo                       │
├─────────────┬────────────────────────────────────────────┬────────────────────┤
│ THÊM        │                                            │ ĐANG CHỌN          │
│ ▦ Tấm pin   │        KHUNG NHÌN  [3D | Sơ đồ | Mặt bằng] │ Chuỗi 1 · 4 tấm    │
│ ▣ Inverter  │   nhà, mái, tấm, inverter, pin, tải, bơm   │ → MPPT 1           │
│ ▤ Pin       │                                            │ Voc lạnh 212/480 V │
│ ⌂ Tải       │                                            │ [Đổi model] [Xóa]  │
│ ≈ Bơm       │   lớp: ☑mái ☑khung ☑dây ☑nhãn   ☀ 11:00    │ Vì sao?            │
│ ▲ Mặt mái   │                                            │                    │
│ ◼ Vật cản   │                                            │ (panel của bước    │
│             │                                            │  hiện tại ở dưới)  │
├─────────────┴────────────────────────────────────────────┴────────────────────┤
│ Điện: 0 lỗi · 2 giới hạn │ ☀ … MWh/năm │ 🔋 thiếu 0 giờ · mua lưới … kWh │ ₫ … tr · thiếu 5 giá │
└───────────────────────────────────────────────────────────────────────────────┘
```

Số trong hình là chỗ giữ chỗ, không phải kết quả.

- **Thanh bước** thay 13 nút. Mỗi bước mở panel bên phải bằng chính nội dung màn hình hiện có:

  | Bước | Gom từ màn hình rc.2 | Việc chính |
  |---|---|---|
  | ① Bố trí | Mái nhà 3D, phần vật cản/bóng theo ngày của Bóng che | Mặt mái, đặt tấm, vật cản, xem nắng theo giờ |
  | ② Đấu nối | Thiết kế | Chuỗi, MPPT, pin, tải, kiểm tra điện |
  | ③ Chạy thử | Mô phỏng PV, Hệ thống, phần cả năm của Bóng che | Thời tiết, lịch tải, phát lại một ngày, A/B |
  | ④ Chi phí | Dự toán, Thiết bị | Báo giá, dòng bổ sung, catalog, SKU riêng |
  | ⑤ Báo cáo | Báo cáo và chia sẻ, Xuất JSON, lịch sử revision | In A4, gói chia sẻ, so revision |

  Bước là lối đi gợi ý, không khóa: bấm bước nào cũng được. Bài học, Phiên bản và phạm vi kiểm chứng, sao lưu nằm trong "Trợ giúp" và trang đầu.
- **Thanh sức khỏe** (dưới cùng) là nơi cố định để đọc hậu quả. Bốn ô: kiểm tra điện (đếm lỗi / giới hạn / chưa đủ dữ liệu) · sản lượng PV năm · cấp điện (`hoursShort` theo giờ/năm; khi có lưới thêm kWh mua lưới; engine không có số "ngày", không bịa thêm) · tiền đã biết và số dòng thiếu giá. Bấm một ô là nhảy tới bước và đối tượng liên quan. Mỗi ô có đúng một trong bốn trạng thái, luôn bằng chữ kèm màu: đạt · có lỗi · bị giới hạn · chưa đủ dữ liệu (kèm thiếu gì). Kết quả cũ hơn thiết kế hiện tại hiện "đang tính lại…" chứ không hiện số cũ như số mới.
- **Một lựa chọn chung**: chọn ở 3D, sơ đồ, mặt bằng, bảng BOM hay danh sách lỗi đều chọn cùng một đối tượng (cơ chế `selection` đã có, mở rộng từ tấm/chuỗi sang mọi thiết bị).
- **Địa chỉ theo hash** (`#/p/<projectId>/<bước>`): tải lại trang hay bấm Back của trình duyệt không văng về trang đầu.
- **Điện thoại (< 720 px)**: khung nhìn ở trên, thanh sức khỏe thu thành một dòng, bảng Thêm và panel bước thành tấm kéo từ dưới lên; thanh bước cuộn ngang.
- **Kiểu dáng**: một stylesheet với biến màu/khoảng cách, sáng/tối theo hệ thống, cỡ chạm ≥ 44 px, tôn trọng `prefers-reduced-motion`. Không thư viện CSS.

### 2. Trang đầu và lần mở đầu tiên

- **Lần đầu (chưa có dự án nào):** vào thẳng workspace của **Nhà mẫu** ở dạng xem thử. Dự án chỉ được lưu vào IndexedDB khi người dùng sửa lần đầu (tránh mỗi lần ghé thăm đẻ ra một bản mẫu). Ba chú thích nổi lần lượt, bỏ qua được: "đây là hệ thống", "bấm vào một món để xem và đổi", "nhìn hậu quả ở thanh dưới".
- **Các lần sau:** mở lại dự án làm gần nhất; trang đầu là lưới thẻ dự án (tên, số tấm/kWp, tổng đã biết, ngày sửa) với ba lối vào cùng cỡ:

  | Lối vào | Hành vi |
  |---|---|
  | **Khám phá Nhà mẫu** | Bản sao mới của seed. |
  | **Bắt đầu từ số 0** | Dự án trống + danh sách bước (mục 5). |
  | **Mở / nhập** | Dự án đã lưu, file JSON, gói, bản sao lưu (luồng hiện có). |

  "Mẫu Lâm Hà (bài toán gốc)" vẫn có trong danh sách mẫu, hành vi như rc.2.

### 3. Nhà mẫu (seed)

Một dự án thật, dựng từ dự án trống bằng các hàm miền đã có (`addInstances`, `buildLamHaConfig`, `addRoofFace`/`faceRect`, `placeGrid`, `addObstacle`), không đi qua `openLamHa()` và không phải ảnh tĩnh. Nội dung:

| Thành phần | Trong seed | Nguồn |
|---|---|---|
| Địa điểm, thời tiết | Lâm Hà, bộ PVGIS-ERA5 2023 đóng gói sẵn | `data/presets`, `data/weather` |
| Mái | Mái hai dốc, mặt Nam đủ rộng cho 12 tấm đứng (8 tấm sẵn + chỗ thêm 4), mặt Bắc để trống | `faceRect` (rộng hơn `demoGableRoof` 8 tấm) |
| Tấm pin | 8 × VSUN 620 W trên mặt Nam, 2 chuỗi × 4 vào MPPT 1 và MPPT 2 | `proposeStrings` |
| Khung/ray | Vẽ theo hàng tấm (minh họa) | `SceneModel.rails` |
| Inverter | Luxpower SNA6000WPV | catalog |
| Pin lưu trữ | Dyness DL5.0C (chưa có báo giá trong catalog nên hiện "còn thiếu giá") | catalog |
| Tải | Tải sinh hoạt 300 W cả ngày, bơm 750 W lúc 18 h (AC) | catalog + `loadPlans` |
| Lưới | Có lưới, cho nhập, không bán (hiện bằng công tơ minh họa). Với cấu hình này thiếu 0 giờ, mua lưới khoảng 344 kWh/năm; thêm tấm/pin làm số mua lưới giảm | `SimPolicy` |
| Giả định thiết kế | Nhiệt độ cell 5 °C / 70 °C, nguồn "giả định" (như bài học và golden) | `DesignSettings` |
| Vật cản | Bồn nước che một phần buổi sáng | `obstacles` |
| Dự toán | Chỉ giá tấm có sẵn; pin, inverter, khung, dây, bảo vệ, công hiện "còn thiếu giá" | `costLines`, `offers` |

Nhánh **bơm PV riêng (controller + 2 tấm)** không nằm sẵn trong seed mà là một khối thêm một chạm ("≈ Bơm → cấp bằng tấm riêng"), vì để sẵn thì người mới phải hiểu hai nhánh điện cùng lúc. *(Lựa chọn của người viết spec.)*

Seed có sẵn 2 finding "bị giới hạn" (inverter 140 A so với dòng sạc/xả của pin) và 4 "chưa đủ dữ liệu" (VSUN không in βVmp). Giữ nguyên, không sửa catalog cho đẹp: đó là chỗ để người mới gặp ba trạng thái ngay từ đầu. *(Lựa chọn của người viết spec, cùng với việc chọn seed có lưới và pin Dyness chưa có giá.)*

Điều kiện nghiệm thu của seed, kiểm bằng unit test: không có finding `fail`; thêm 2 và thêm 4 tấm qua bảng Thêm vẫn không có `fail` và mọi tấm nằm trên mặt Nam; chạy được PV và dispatch cả năm với thời tiết đóng gói; mọi tấm đã đặt hợp lệ; dựng hai lần cho cùng nội dung (trừ id và thời điểm).

### 4. Thêm, bớt, đổi

- **Bảng Thêm** (trái): mỗi mục là một khối đã đấu sẵn, dùng lại hàm trong `src/domain/presets.ts` và `layout-edit.ts`. Chọn mục → xem trước ("thêm 2 tấm → Chuỗi 1 thành 5 tấm, Voc lạnh 265/480 V") → xác nhận.

  | Khối | Việc nó làm |
  |---|---|
  | Tấm pin (N tấm) | Thêm tấm, **chia lại chuỗi cho toàn bộ tấm cùng model trên inverter đó** bằng `proposeStrings` (hàm miền mới `restringPanels`; `addPanelBatch` hiện chỉ xâu riêng các tấm mới nên 8→10 sinh hai chuỗi 1 tấm và 4 lỗi đỏ), tự đặt lên mặt mái còn chỗ (`fillFace`). Xem trước nêu rõ chuỗi nào đổi |
  | Inverter | Thêm hoặc thay inverter chính |
  | Pin | Nối vào cổng BAT (`addBatteryBranch`) |
  | Tải | Nối vào AC, kèm lịch mặc định sửa được (`addAcLoad`) |
  | Bơm | Bơm AC, hoặc nhánh bơm PV riêng (`addPumpBranch`) |
  | Mặt mái / Vật cản | Hình chữ nhật theo kích thước nhập; đa giác tự do ở chế độ Thợ/Kỹ sư |

- **Bớt:** chọn → Xóa (phím Delete hoặc nút). Xóa thiết bị kéo theo dây và chuỗi của nó, báo trước những gì bị kéo theo; hoàn tác được.
- **Đổi model:** trong panel Đang chọn, "Đổi model" liệt kê thiết bị cùng loại, giữ nguyên vị trí, chuỗi và dây. Hàm miền mới của mục này: `replaceComponent` và `restringPanels`.
- **Mỗi thao tác là một revision, hoàn tác được** (giữ nguyên hợp đồng hiện có).
- Người dùng bàn phím/trình đọc màn hình dùng danh sách thiết bị và bảng kết nối hiện có, nay nằm trong panel ② Đấu nối.

### 5. Bắt đầu từ số 0

Dự án trống, khung nhìn là nền đất với la bàn. Panel phải là danh sách bước, mỗi bước một việc và một nút chính; bước xong tự đánh dấu theo trạng thái dự án (không phải theo việc đã bấm):

1. Chọn nơi lắp (tỉnh/tọa độ; mặc định bộ thời tiết đóng gói gần nhất, nói rõ nếu không có bộ nào gần) → 2. Dựng mặt mái → 3. Đặt tấm → 4. Chọn inverter → 5. Thêm pin (bỏ qua được) → 6. Khai tải → 7. Sửa hết lỗi đỏ → 8. Xem chạy thử → 9. Nhập giá còn thiếu.

Danh sách này cũng hiện (thu gọn) trong mọi dự án chưa đủ bước, kể cả dự án rc.2 cũ, để ai mở ra cũng biết còn thiếu gì.

### 6. 3D toàn hệ thống

- `SceneModel` thêm **thiết bị ngoài mái**: inverter, bank pin, controller, tải, bơm vẽ bằng khối đơn giản có nhãn tên; kích thước lấy từ thông số nếu có (pin có dài/rộng/dày), không có thì dùng khối mặc định mang nhãn "kích thước minh họa".
- **Vị trí thiết bị**: trường tùy chọn mới `devicePlacements?: { instanceId, e, n, up }[]`. Thiếu trường này thì tự xếp trên một "vách thiết bị" cạnh nhà theo thứ tự cố định, nên dự án cũ có hình ngay mà không phải migrate. Vị trí thiết bị không vào phép tính nào.
- **Dây khái niệm** theo `edges` và `strings`: DC từ chuỗi tới cổng MPPT, pin ↔ inverter, AC tới tải; ba kiểu nét + chú giải (không chỉ dựa vào màu). Tủ bảo vệ và công tơ là hình minh họa suy từ dòng dự toán loại "bảo vệ" và `sim.gridAvailable`.
- **Phát lại trên hình** (bước ③): con trỏ thời gian chung điều khiển bóng nắng và chiều/độ dày dòng công suất trên dây; số và đơn vị luôn hiện bằng chữ; tắt chuyển động thì bước từng giờ.
- **Lớp lỗi**: thiết bị có finding `fail`/`limited` có viền và huy hiệu; bấm vào mở đúng finding.
- **Không có WebGL / mất ngữ cảnh**: khung nhìn chuyển sang Sơ đồ (SVG hiện có) + Mặt bằng, mọi chức năng vẫn làm được (đường lui hiện có, nay là mặc định thay vì thông báo).
- Ngân sách: giữ mục tiêu ≥ 30 FPS khi xoay với 40 tấm + 10 vật cản + thiết bị; Three.js vẫn nạp lười, trước khi nạp xong hiện Mặt bằng 2D.

### 7. Kết quả tự cập nhật

- Kiểm tra điện và dự toán chạy đồng bộ sau mỗi lần sửa (đã nhanh).
- PV, bóng che và dispatch chạy trong worker hiện có, tự khởi động sau khi thiết kế đứng yên ~1 giây, hủy lượt cũ khi có sửa mới, lưu theo hash đầu vào (hợp đồng `runId/revision/input hash` đã có). Nút "Chạy" ở từng màn hình vẫn còn cho Thợ/Kỹ sư.
- Mặc định khi tự chạy: bóng che ở mức xem trước; bấm "tính chuẩn" để có số đưa vào báo cáo. Thanh sức khỏe ghi rõ đang là số xem trước.
- Hướng mảng đã lấy từ mặt mái (`src/engine/compile.ts`, `ORIENTATION_MISSING`); không đổi. Thiếu thời tiết hoặc hướng thì ô tương ứng ghi "chưa đủ dữ liệu: thiếu …" kèm nút tới chỗ nhập, không tự bịa mặc định.
- **Sửa nhanh**: finding có cách sửa xác định được thì có nút làm luôn, có xem trước và hoàn tác. Đợt đầu chỉ ba loại: chuyển chuỗi sang MPPT còn trống (`ISC_TRACKER`, `IMP_TRACKER`), chia lại số tấm mỗi chuỗi (`VOC_COLD_ABS`, `VMP_HOT_MIN`), đặt lại tấm lấn mép/chồng nhau. Các loại khác giữ lời hướng dẫn `fix` hiện có.

### 8. Ba độ sâu

Công tắc ở thanh trên, nhớ theo trình duyệt (`localStorage`), không lưu vào dự án, không đổi phép tính. Mặc định Cơ bản.

| | Cơ bản | Thợ | Kỹ sư |
|---|---|---|---|
| Lỗi điện | Câu thường + hậu quả + "hỏi thợ" hoặc nút sửa nhanh | + giá trị/giới hạn, cách sửa, cổng liên quan | + mã, công thức, nguồn từng số, giả định |
| Bảng Thêm | Khối đấu sẵn | + chọn model, số lượng, cổng | + tạo/sửa SKU, thông số, datasheet |
| Chạy thử | Một ngày phát lại + "đủ điện mấy ngày" | + lịch tải, giờ bơm, A/B | + chính sách điều phối, ledger, CSV, bảng theo bước |
| Chi phí | Tổng đã biết / còn thiếu gì | + báo giá theo dòng, kit, VAT, dây theo mét | + nguồn giá, hiệu lực, so revision |
| Thiết lập | Ẩn sau "Giả định đang dùng" (chỉ đọc) | Sửa nhiệt độ cell, khoảng lùi mép | Mọi tham số mô hình |

- Mọi thuật ngữ trong giao diện có "Vì sao?/là gì?" lấy từ `src/lessons/glossary.ts` (mở rộng từ 6 lên khoảng 20 mục, mỗi mục có lời Cơ bản và lời Kỹ sư).
- **Thứ mới cho Thợ:** bảng đấu nối in được (chuỗi → cổng, thứ tự tấm, pin, tải; ghi rõ "tiết diện dây và thiết bị bảo vệ do người lắp xác nhận") thêm vào báo cáo A4 như một trang tùy chọn.
- **Thứ mới cho Kỹ sư:** từ mọi con số trên thanh sức khỏe đi tới nguồn và giả định của nó trong một thao tác.
- Chế độ Cơ bản không bao giờ ẩn một trạng thái lỗi/giới hạn/chưa đủ dữ liệu; chỉ rút gọn cách nói.

## Lộ trình theo wave

Mỗi wave giao được một bản chạy được, có bằng chứng `docs/evidence/Wxx.md` theo nếp W00–W09. Thứ tự là thứ tự phụ thuộc.

| Wave | Giao | Phụ thuộc | Nghiệm thu chính |
|---|---|---|---|
| **W10 · Vỏ workspace** | Stylesheet + token; khung trên/bước/trái/phải/thanh sức khỏe (số liệu tĩnh từ validate + quote); địa chỉ theo hash; tách `src/ui/app.ts` thành shell + các panel; màn hình cũ chạy trong panel, nội dung chưa đổi | — | Mọi e2e hiện có xanh sau khi sửa phần điều hướng; tải lại trang giữ đúng dự án và bước; dùng được ở 360 px |
| **W11 · Nhà mẫu, số 0, trang đầu** | Hàm dựng seed + test; xem thử không lưu; trang đầu dạng thẻ; danh sách bước theo trạng thái; ba chú thích lần đầu | W10 | Seed không có `fail`, chạy đủ năm; e2e "lần đầu mở thấy Nhà mẫu"; e2e đi hết 9 bước từ số 0 |
| **W12 · 3D toàn hệ thống** | Thiết bị và dây trong `SceneModel`/`three-view`; `devicePlacements` + schema + khóa lại đầu vào; `restringPanels`, `replaceComponent`; lựa chọn chung cho mọi thiết bị; bảng Thêm, Xóa, Đổi model | W10, W11 | Nhập lại file rc.2 không đổi hash kết quả; 30 FPS theo ngân sách; mọi thao tác 3D có đường bàn phím |
| **W13 · Kết quả tự cập nhật** | Tự chạy trong worker + hủy + cache; thanh sức khỏe sống; ba sửa nhanh; phát lại dòng công suất trên hình | W12 | Sửa một tấm → bốn ô cập nhật mà không bấm chạy; số trên thanh bằng số ở màn hình chi tiết và CSV; golden Lâm Hà không đổi |
| **W14 · Ba độ sâu** | Công tắc chế độ áp vào mọi panel; glossary ~20 mục; bảng đấu nối cho thợ; đường "số → nguồn" cho kỹ sư | W13 | Test: cùng dự án, ba chế độ cho cùng số; Cơ bản không ẩn trạng thái lỗi nào |
| **W15 · Điện thoại, tiếp cận, UAT thật, 1.1** | Rà bố cục hẹp, bàn phím, độ tương phản, tắt chuyển động; UAT 4 nhóm với người thật; ghi chú phát hành | W10–W14 | Bốn tiêu chí "Đo thành công" ở trên có kết quả người thật; ma trận nghiệm thu cập nhật |

**Về bản 1.0:** đề xuất giữ `1.0.0-rc.2` làm mốc engine đã khóa, không phát hành chính thức với giao diện hiện tại; UAT người thật còn nợ của W09 làm trên giao diện mới ở W15 và bản phát hành là 1.1. *(Lựa chọn của người viết spec; chủ dự án quyết.)*

## Việc để lại cho người làm từng wave

- Tên file/module cụ thể khi tách `app.ts`, và cách giữ form không mất nội dung khi panel bên cạnh vẽ lại.
- Hình khối, màu và vị trí mặc định của từng thiết bị trên "vách thiết bị".
- Lời văn của chú thích lần đầu, danh sách bước và các mục glossary mới (tiếng Việt thường, theo giọng `glossary.ts` hiện có).
- Thời gian chờ trước khi tự chạy và mức lấy mẫu bóng xem trước, chọn theo phép đo trên máy dev và một Android tầm trung như W07/W09.
- Cách sửa từng spec e2e khi điều hướng đổi, miễn là kịch bản UAT trong `tests/e2e/uat.spec.ts` vẫn kiểm đúng các tiêu chí của `docs/uat/protocol.md`.
