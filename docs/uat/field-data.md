# Đối chiếu thực địa — điều kiện và trạng thái

**Trạng thái: chưa đo. Không có log inverter/đồng hồ điện nào được cung cấp.** Vì vậy:
- Báo cáo, About và manifest ghi: "đã đối chiếu mô hình; chưa đối chiếu thực địa".
- Không có con số "sai số so thực tế" nào được công bố. Dung sai so pvlib (≤ 0,064 % công suất, 0,003 % năng lượng năm trên fixture Lâm Hà) là sai khác giữa hai phần mềm cùng mô hình, không phải sai số so công trình.

Khi có dữ liệu, cần để gắn nhãn "đã đối chiếu thực địa" cho một cấu hình:
1. **Log thiết bị**: công suất PV (DC hoặc AC), SoC, công suất tải, công suất xả/sạc, theo thời gian, bước ≤ 15 phút, tối thiểu một tuần nắng và một tuần ít nắng.
2. **Đồng bộ giờ**: ghi múi giờ log, độ lệch đồng hồ thiết bị so giờ chuẩn; quy ước đầu/cuối khoảng; cộng dồn hay tức thời. Đổi về UTC, đầu khoảng, trung bình khoảng như `WeatherSeries`.
3. **Bức xạ tại chỗ** (hoặc ghi rõ dùng ERA5/PVGIS thay thế) và nhiệt độ tấm/không khí.
4. **Biên đo**: ghi độ chính xác của đồng hồ/CT và điểm đo (trước hay sau inverter), để so đúng biên (AC out vs DC bus).
5. **Phạm vi công bố**: model nào được so (PV, dispatch, bóng), giờ/mùa nào có dữ liệu, độ phủ %, sai số thống kê (MBE, RMSE) theo biên đo. Phần không có dữ liệu ghi "chưa đo".

Chưa có gì trong repo nhận log; việc nhập log là việc của wave sau.
