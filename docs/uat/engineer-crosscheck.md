# Đối chiếu datasheet của kỹ sư điện — phiếu kiểm

**Trạng thái: CHƯA THỰC HIỆN.** Không có kỹ sư điện độc lập nào đã đối chiếu. Bảng dưới được sinh từ `data/catalog/components.json` để người kiểm có sẵn danh sách; mọi thiết bị hiện mang `review: unreviewed` và giao diện ghi "chưa kiểm datasheet".

Cách kiểm: mở datasheet theo link/trang, so từng số với cột *Giá trị*, ghi *Khớp / Sai / Không thấy* và chữ ký. Giá trị có nguồn `user`/`assumption` không phải số của hãng: kiểm xem nhãn đó có đúng không.

Quy tắc cần quyết định (không phải lỗi số): βVmp thường không in trong datasheet; app KHÔNG suy từ βPmax, và kiểm tra Vmp nóng ở mức "chưa kiểm được" cho tới khi người thiết kế nhập giả định βVmp.

## VSUN 620 W N-type TOPCon bifacial (`vsun-620` rev 1)

- Loại: panel · new · SKU: VSUN620N-132BMHR-DG · review: **unreviewed**
- Datasheet: https://www.stellavolta.com/content/VSUN%20VSUN635N-132BMHR-DG%20635W%20Datasheet%20por%20Stellavolta.pdf (VSUN 610–635 W, Version 1.0, Update Time 2025.01.14, sha256 e82eaee4fad054d4d0733bd6d9342995fd94c654e94a89a9b0191081de4d517e) · trang 2 · kiểm lúc 2026-11-19

| Thông số | Giá trị | Đơn vị | Nguồn | Kết quả đối chiếu |
|---|---|---|---|---|
| pstcW | 620 | W | manufacturer | ☐ |
| vocV | 48.7 | V | manufacturer | ☐ |
| iscA | 15.95 | A | manufacturer | ☐ |
| vmpV | 41.23 | V | manufacturer | ☐ |
| impA | 15.04 | A | manufacturer | ☐ |
| betaVoc | -0.0024 | 1/°C | manufacturer | ☐ |
| betaIsc | 0.0004 | 1/°C | manufacturer | ☐ |
| betaPmax | -0.0029 | 1/°C | manufacturer | ☐ |
| efficiency | 0.2295 | ratio | manufacturer | ☐ |
| bifaciality | 0.8 | ratio | manufacturer | ☐ |
| maxSystemV | 1500 | V | manufacturer | ☐ |
| maxSeriesFuseA | 30 | A | manufacturer | ☐ |
| lengthM | 2.382 | m | manufacturer | ☐ |
| widthM | 1.134 | m | manufacturer | ☐ |
| thicknessM | 0.03 | m | manufacturer | ☐ |
| weightKg | 33.3 | kg | manufacturer | ☐ |
| bypassDiodes | 3 | count | manufacturer | ☐ |

## Hestia 650 W N-type TOPCon (`hestia-650` rev 1)

- Loại: panel · new · SKU: HTS-132210RH650LDG · review: **unreviewed**
- Datasheet: https://venergy.vn/san-pham/tam-pin-nang-luong-mat-troi-hestia-solar-630w-650w/ · kiểm lúc 2026-11-19

| Thông số | Giá trị | Đơn vị | Nguồn | Kết quả đối chiếu |
|---|---|---|---|---|
| pstcW | 650 | W | seller | ☐ |
| vocV | 49.6 | V | seller | ☐ |
| iscA | 16.44 | A | seller | ☐ |
| vmpV | 42.4 | V | seller | ☐ |
| impA | 15.34 | A | seller | ☐ |
| betaVoc | -0.0025 | 1/°C | seller | ☐ |
| betaIsc | 0.0005 | 1/°C | seller | ☐ |
| betaPmax | -0.0029 | 1/°C | seller | ☐ |
| efficiency | 0.241 | ratio | seller | ☐ |
| maxSystemV | 1500 | V | seller | ☐ |
| maxSeriesFuseA | 35 | A | seller | ☐ |
| lengthM | 2.382 | m | seller | ☐ |
| widthM | 1.134 | m | seller | ☐ |
| thicknessM | 0.03 | m | seller | ☐ |
| weightKg | 32.5 | kg | seller | ☐ |

## Hestia 630 W (biến thể chưa đủ thông số điện) (`hestia-630` rev 1)

- Loại: panel · new · SKU: HTS-132210RH630LDG · review: **unreviewed**
- Datasheet: https://venergy.vn/san-pham/tam-pin-nang-luong-mat-troi-hestia-solar-630w-650w/ · kiểm lúc 2026-11-19

| Thông số | Giá trị | Đơn vị | Nguồn | Kết quả đối chiếu |
|---|---|---|---|---|
| pstcW | 630 | W | seller | ☐ |
| betaVoc | -0.0025 | 1/°C | seller | ☐ |
| betaIsc | 0.0005 | 1/°C | seller | ☐ |
| betaPmax | -0.0029 | 1/°C | seller | ☐ |
| efficiency | 0.2332 | ratio | seller | ☐ |
| lengthM | 2.382 | m | seller | ☐ |
| widthM | 1.134 | m | seller | ☐ |
| thicknessM | 0.03 | m | seller | ☐ |
| weightKg | 32.5 | kg | seller | ☐ |

## Luxpower SNA6000WPV off-grid 6 kW (`luxpower-sna6000wpv` rev 1)

- Loại: inverter · new · SKU: SNA6000WPV · review: **unreviewed**
- Datasheet: SNA-3-6K-User-manual-English-OffGrid-Single-Phase-LuxpowerTek.pdf (SNA 3000-6000 WPV, 25.12.3) · trang 52 · kiểm lúc 2026-11-19

| Thông số | Giá trị | Đơn vị | Nguồn | Kết quả đối chiếu |
|---|---|---|---|---|
| acRatedW | 6000 | W | manufacturer | ☐ |
| pvMaxPowerW | 9600 | W | manufacturer | ☐ |
| pvVocMaxV | 480 | V | manufacturer | ☐ |
| pvStartV | 100 | V | manufacturer | ☐ |
| mpptVminV | 120 | V | manufacturer | ☐ |
| mpptVmaxV | 385 | V | manufacturer | ☐ |
| mpptCount | 2 | count | manufacturer | ☐ |
| pvImaxPerMpptA | 17 | A | manufacturer | ☐ |
| pvIscMaxPerMpptA | 25 | A | manufacturer | ☐ |
| batteryVminV | 46.4 | V | manufacturer | ☐ |
| batteryVmaxV | 60 | V | manufacturer | ☐ |
| batteryMaxChargeA | 140 | A | manufacturer | ☐ |
| batteryMaxDischargeA | 140 | A | manufacturer | ☐ |
| efficiencyMax | 0.93 | ratio | manufacturer | ☐ |
| surgeW | 12000 | W | manufacturer | ☐ |

## Dyness DL5.0C LiFePO4 51,2 V 100 Ah (`dyness-dl5-0c` rev 1)

- Loại: battery · new · SKU: DL5.0C · review: **unreviewed**
- Datasheet: DL5.0CDatasheet.pdf (file version 20241218-EN) · trang 2 · kiểm lúc 2026-11-19

| Thông số | Giá trị | Đơn vị | Nguồn | Kết quả đối chiếu |
|---|---|---|---|---|
| nominalV | 51.2 | V | manufacturer | ☐ |
| vMinV | 44.8 | V | manufacturer | ☐ |
| vMaxV | 57.6 | V | manufacturer | ☐ |
| capacityAh | 100 | Ah | manufacturer | ☐ |
| nominalWh | 5120 | Wh | manufacturer | ☐ |
| usableWh | 4608 | Wh | manufacturer | ☐ |
| maxChargeA | 75 | A | manufacturer | ☐ |
| maxDischargeA | 100 | A | manufacturer | ☐ |
| lengthM | 0.558 | m | manufacturer | ☐ |
| widthM | 0.545 | m | manufacturer | ☐ |
| thicknessM | 0.15 | m | manufacturer | ☐ |
| weightKg | 54 | kg | manufacturer | ☐ |
| peakDischargeA | 110 | A | manufacturer | ☐ |

## Bộ pin cũ 51,2 V × 165 Ah (người dùng khai) (`used-battery` rev 1)

- Loại: battery · used · SKU: used-battery · review: **unreviewed**
- Datasheet: chưa có

| Thông số | Giá trị | Đơn vị | Nguồn | Kết quả đối chiếu |
|---|---|---|---|---|
| nominalV | 51.2 | V | user | ☐ |
| capacityAh | 165 | Ah | user | ☐ |
| nominalWh | 8448 | Wh | user | ☐ |
| maxDischargeA | 100 | A | assumption | ☐ |

## Victron SmartSolar MPPT 150/35 (`victron-mppt-150-35` rev 1)

- Loại: controller · new · SKU: SmartSolar MPPT 150/35 · review: **unreviewed**
- Datasheet: Datasheet-SmartSolar-charge-controller-MPPT-150-35-&-150-45-EN.pdf · trang 1 · kiểm lúc 2026-11-19

| Thông số | Giá trị | Đơn vị | Nguồn | Kết quả đối chiếu |
|---|---|---|---|---|
| ratedW | 2000 | W | manufacturer | ☐ |
| vMaxV | 145 | V | manufacturer | ☐ |
| iMaxA | 35 | A | manufacturer | ☐ |
| pvVocMaxV | 150 | V | manufacturer | ☐ |
| pvIscMaxA | 40 | A | manufacturer | ☐ |
| efficiencyMax | 0.98 | ratio | manufacturer | ☐ |
| weightKg | 1.25 | kg | manufacturer | ☐ |

## Victron SmartSolar MPPT 150/45 (`victron-mppt-150-45` rev 1)

- Loại: controller · new · SKU: SmartSolar MPPT 150/45 · review: **unreviewed**
- Datasheet: Datasheet-SmartSolar-charge-controller-MPPT-150-35-&-150-45-EN.pdf · trang 1 · kiểm lúc 2026-11-19

| Thông số | Giá trị | Đơn vị | Nguồn | Kết quả đối chiếu |
|---|---|---|---|---|
| ratedW | 2600 | W | manufacturer | ☐ |
| vMaxV | 145 | V | manufacturer | ☐ |
| iMaxA | 45 | A | manufacturer | ☐ |
| pvVocMaxV | 150 | V | manufacturer | ☐ |
| pvIscMaxA | 50 | A | manufacturer | ☐ |
| efficiencyMax | 0.98 | ratio | manufacturer | ☐ |
| weightKg | 1.25 | kg | manufacturer | ☐ |

## Controller bơm PV mẫu 750 W (`sample-pump-controller` rev 1)

- Loại: controller · new · SKU: sample-pump-controller · review: **unreviewed**
- Datasheet: chưa có

| Thông số | Giá trị | Đơn vị | Nguồn | Kết quả đối chiếu |
|---|---|---|---|---|
| ratedW | 750 | W | assumption | ☐ |
| vMinV | 60 | V | assumption | ☐ |
| vMaxV | 200 | V | assumption | ☐ |
| iMaxA | 10 | A | assumption | ☐ |

## Bơm nước 750 W (tải mẫu) (`sample-pump-load` rev 1)

- Loại: load · new · SKU: sample-pump-load · review: **unreviewed**
- Datasheet: chưa có

| Thông số | Giá trị | Đơn vị | Nguồn | Kết quả đối chiếu |
|---|---|---|---|---|
| powerW | 750 | W | assumption | ☐ |
| powerFactor | 0.8 | ratio | assumption | ☐ |
| startupW | 2250 | W | assumption | ☐ |

## Tải sinh hoạt 300 W (tải mẫu) (`sample-home-load` rev 1)

- Loại: load · new · SKU: sample-home-load · review: **unreviewed**
- Datasheet: chưa có

| Thông số | Giá trị | Đơn vị | Nguồn | Kết quả đối chiếu |
|---|---|---|---|---|
| powerW | 300 | W | assumption | ☐ |
| powerFactor | 0.9 | ratio | assumption | ☐ |

## Fixture giải tay

Sáu fixture H1–H6 trong `tests/unit/hand-calcs.test.ts` (Voc lạnh/nóng 204,1504 V / 173,7616 V; Isc/Imp so cổng; POA 500 W/m² → 2336,16 W; pin 8448 Wh, 6758,4 Wh dùng được, 4761,6 W; đêm không nắng: xả bus 6420,48 Wh, cấp 5971,0464 Wh, thiếu 1978,9536 Wh; tiền 31.872.000 đ). Số được tính trên giấy trong chú thích từng test. **Tác giả engine viết các fixture này**, nên chúng kiểm phép tính và nối dây, chưa phải đánh giá độc lập.

Sai khác ghi nhận giữa tay và engine: **không có** (mọi fixture khớp ở 1e-6). Kỹ sư điện cần tự giải thêm ít nhất một fixture của riêng họ và ghi sai khác.

## Ký nhận

| Vai trò | Tên | Ngày | Kết luận |
|---|---|---|---|
| Kỹ sư điện | _chưa có_ | | |
