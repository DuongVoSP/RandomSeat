# RandomSeat – Sơ đồ chỗ ngồi từ file TXT

Web app 1 trang (single-page), chạy offline, đọc dữ liệu `.txt` dạng:

```
rows cols
rows cols
...
```

Mỗi dòng tương ứng **1 khu/vùng** chỗ ngồi, render thành lưới ghế.

## Cách chạy

Vì trình duyệt có thể chặn đọc file nếu bạn mở trực tiếp `index.html`, khuyến nghị chạy bằng Python:

```bash
python -m http.server 8000
```

Sau đó mở:

- `http://localhost:8000/`

## File mẫu

Xem `sample.txt`.

