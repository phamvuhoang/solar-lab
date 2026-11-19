# 1. Kiến trúc

**Quyết định ngày 19/11/2026.** Solar Lab là một dự án độc lập: một thư mục gốc, một lịch sử Git, một package ứng dụng, một lockfile JavaScript và một bản build web. Tất cả model, worker chạy mô phỏng, màn hình 2D, cảnh 3D, fixture và kiểm thử cùng phiên bản. Người dùng chỉ cần mở ứng dụng web để chạy một project đã có dữ liệu thời tiết.

## Nền tảng và quyết định kỹ thuật

| Phần | Quyết định | Hợp đồng hoặc phần việc |
|---|---|---|
| `tsconfig.base.json` | ES2022, Bundler và TypeScript strict | `tsconfig.json` kế thừa base và giới hạn include vào mã của Solar; cấu hình con quyết định entry và test. |
| `package.json` | Node 24, pnpm, một manifest ở gốc | Schema JSON viết trong cùng cây (`schemas/`). |
| `src/cost/bom.ts` | Hàm cộng tiền nền của dự toán | `calculateBom` cộng VND bằng số nguyên, bắt sai tiền tệ, đơn giá thiếu và số lượng không nguyên. Lớp dự toán bao quanh (W02) tính dây, VAT và báo giá. |
| Editor sơ đồ | Viết riêng cho Solar | Instance, cổng, nối dây, sửa lỗi, kết quả hết hiệu lực khi thiết kế đổi. |
| Mô hình miền | Hợp đồng riêng | Panel instance, MPPT, string, battery bank, load, layout. |
| Lưu trữ | IndexedDB riêng `mekoniq-solar-lab` | Commit bản sửa và revision trong cùng transaction; migration theo phiên bản; test quota, nâng version và xung đột hai tab. |
| Giao diện | Chọn đối tượng chung, thanh thời gian, xuất báo cáo | Replay đọc timestamp, dòng điện và trạng thái pin; renderer biểu đồ và export riêng. |
| Công cụ | Vite, TypeScript, Vitest, Playwright | Nạp Three.js khi mở 3D. Ghim dependency trong lockfile tại W00/W06. |

Khi cần đổi hành vi của BOM, thêm module bao quanh (W02) thay vì sửa trực tiếp `bom.ts`; nếu buộc phải sửa, chuyển kiểm tra sang fixture tương thích và ghi quyết định trong cùng PR.

## Cây đích khi hoàn thành

```text
solar-lab/
  package.json, pnpm-lock.yaml, index.html, vite.config.ts
  src/
    main.ts                 # điều hướng, đăng ký worker, chọn ngôn ngữ
    app/                    # lệnh chỉnh sửa, undo/redo, so sánh, luồng bài học
    domain/                 # schema và đơn vị, graph, catalog và project
    catalog/  cost/         # tra cứu, override, offer, tính dòng dự toán
    validation/             # topology, giới hạn điện, độ đầy đủ của dữ liệu
    engine/                 # pv, inverter, dispatch, loads, ledger, metrics
    weather/                # đọc file, chuẩn hóa, cache metadata nguồn
    worker/                 # hợp đồng run/progress/cancel/result
    persistence/            # IndexedDB, revision, migration và import/export
    ui/  diagrams/          # inspector, sơ đồ điện, timeline dùng chung
    scene/  shade/          # bố trí 3D, nắng, lấy mẫu bóng và chuyển về engine
    reports/  lessons/      # share-file, CSV, in PDF, bài tập hướng dẫn
  data/                     # thành phần, báo giá mẫu, bài Lâm Hà, thời tiết
  schemas/                  # JSON Schema lưu trữ/trao đổi, schemaVersion
  scripts/                  # khóa đầu vào, chuẩn hóa dataset, tạo fixture chuẩn, manifest
  tests/                    # unit, contract, golden, browser, performance
  docs/                     # thiết kế, wave, hướng dẫn release và bằng chứng
```

## Luồng dữ liệu và ranh giới

| Điểm xử lý | Đầu vào → đầu ra | Quy tắc triển khai |
|---|---|---|
| Editor và store | Thao tác người dùng → project revision | Một lệnh sửa là một transaction có thể undo. Di chuyển camera và tua thời gian là trạng thái view. Đổi thiết bị hoặc layout ghi revision mới. |
| Compile | Project + bản chụp catalog → graph đã chuẩn hóa, BOM và issues | Thuần TypeScript. Tính được từng kết quả ngay khi đủ dữ liệu cho kết quả đó. Report chứa trường cụ thể phải bổ sung. |
| Weather | CSV, dataset mẫu hoặc dữ liệu đã tải → WeatherSeries | Chuẩn hóa về khoảng thời gian UTC, đơn vị SI và nguồn. Cache theo nội dung. Công cụ lấy dữ liệu đặt trong scripts cùng repo, xuất file offline; lần mở app đầu tiên dùng được preset đóng gói. |
| Worker | Graph + thời tiết + lịch tải + policy + shadow series → run | Cùng một lõi chạy trong worker trình duyệt và Node để kiểm thử. Thông điệp có runId, revision và input hash. Đổi thiết kế khi worker chạy thì hủy hoặc lưu kết quả vào đúng revision cũ. |
| View 2D/3D và report | Project + kết quả tại cùng timestamp → hiển thị | Cả hai dùng một selection ID, một con trỏ thời gian và cùng giá trị đã tính. Khi render chậm, bỏ bớt khung hình; không bỏ bước tích phân. |
| Reference | Fixture và thông số mô hình → kết quả đối chứng | Script Python dùng pvlib/SAM khi thích hợp, khóa phiên bản và lưu output + metadata trong repo. Python phục vụ kỹ thuật, không nằm trong đường chạy của người dùng. |

**Chạy và phát hành.** Vite tạo một thư mục `dist/` có thể host tĩnh qua HTTPS hoặc chạy local. Lưu/cập nhật project trên trình duyệt. Chia sẻ thiết kế qua file export đính kèm báo cáo, người nhận import được trên một máy khác. Không cần tài khoản hay API thường trực cho v1. Cache vỏ ứng dụng và dataset mẫu theo build ID; cập nhật build sau khi lưu draft. Nếu nguồn thời tiết lỗi hoặc địa điểm chưa có dữ liệu thì vẫn dùng được editor, BOM và import CSV. Đồng bộ nhiều người sửa cùng lúc, giám sát inverter trực tiếp và thanh toán là các quyết định sản phẩm về sau.

**Phạm vi v1.** Thiết kế một nhà/mái hoặc nhà vườn có nhiều mặt mái, nhiều string và MPPT, một hybrid/off-grid inverter chính và một bank pin tương thích. Có tải AC, nhánh bơm PV độc lập khi có controller, lưới tùy chọn theo policy. Ghép dòng inverter song song, ghép cell tự do và hệ ba pha mất cân bằng cần model riêng. UI nhận diện topology ngoài phạm vi trước khi công bố kết quả.
