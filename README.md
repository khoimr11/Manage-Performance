# Manage Performance · LF Command Center

Bảng điều hành tổng hợp 2 kênh: **Global** (Lignarc · Wayfair CastleGate / Amazon, phụ trách Thuỳ Trang) và **Local** (Kệ 3 tầng · Shopee, phụ trách Đình Phú).

- Live: `https://khoimr11.github.io/Manage-Performance/` · bản demo: thêm `?demo=1`
- Dữ liệu nguồn: đọc thẳng file mã hoá của 2 dash gốc (`/Lignarc-Dashboard/data/lignarc.enc.json`, `/LF---B2C-Local/data/data.enc.json`), giải mã trong trình duyệt nên số liệu khớp với dash gốc.
- Engine (`assets/engine.js`): 60 luật tự phát hiện issue/cơ hội, chia mức P0–P3, gán người phụ trách, SLA, next steps, điều kiện tự đóng. Playbook (`assets/playbook.js`) do agent Giám đốc E-commerce soạn.
- **Lưu trữ (không cần Google):** mọi dữ liệu nằm trong `data/` của repo này, mã hoá AES-256 (`assets/store.js`). Ai đọc được file nào phụ thuộc khoá trong tài khoản:
  - **S**: cả nhóm.
  - **G**: Global (quản lý + Trang).
  - **L**: Local (quản lý + Phú).
  - **M**: chỉ quản lý.
- Mỗi lần lưu là một commit nên có lịch sử đầy đủ.
- Tài khoản (`data/vault.json`): mỗi người một ô khoá mã hoá bằng mật khẩu riêng (PBKDF2 250k vòng). Đổi mật khẩu trong Cài đặt. Nhân viên bị yêu cầu đổi mật khẩu ở lần đăng nhập đầu.
- Chống gian lận:
  - Lệnh của quản lý (giao, duyệt, nhắc, cảnh cáo…) được ký HMAC bằng khoá chỉ quản lý có. Bản ghi giả mạo bị bỏ qua và báo P0.
  - Nhật ký bị xoá bớt cũng bị phát hiện.
  - Thời gian ghi lấy theo giờ máy chủ GitHub.
- Tab **Sheet** (`assets/sheet.js`) thay Google Sheet:
  - Công thức (SUM, AVERAGE, IF, SUMIF, COUNTIF, VLOOKUP…), định dạng ₫/$/%, tô màu, sắp xếp, lọc, cố định tiêu đề.
  - Copy/paste với Excel, nhập/xuất CSV, undo/redo.
  - Phân quyền theo nhóm S/G/L/M, tự lưu, gộp theo từng ô khi 2 người sửa cùng lúc.

## Cài đặt lần đầu (quản lý)
1. Bật GitHub Pages: Settings › Pages › Deploy from a branch › `main` / root.
2. Tạo fine-grained token chỉ cho repo Manage-Performance, quyền **Contents: Read and write**. Đăng nhập Command Center › Cài đặt › GitHub token.
3. Cài đặt › Kết nối dữ liệu nguồn: đăng nhập dash Lignarc và dash Kệ 3 tầng một lần.

## Luật trách nhiệm
- Tuổi issue tính từ lúc sự việc xảy ra trên sàn. Quá SLA (P0 24h · P1 72h · P2 7 ngày) mà chưa giao việc thì tự nâng 1 bậc.
- P0/P1 tồn ≥ 24h mà nhân viên chưa bấm "Em đã nắm" thì tính **Miss báo cáo**.
- Việc quá hạn tự nâng 1 bậc. Cùng một lỗi lặp lại lần 2 trong 30 ngày thì gắn cờ **Nhắc nhở**, lần 3 thì **Cảnh cáo**.
- Nhân viên báo xong nhưng luật vẫn còn bắt lỗi thì hiện cờ **"Báo xong nhưng dữ liệu vẫn còn lỗi"**. Việc chỉ đóng khi quản lý duyệt.
