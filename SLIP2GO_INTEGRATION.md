# Slip2Go Integration — บันทึกระบบ

## สถานะ
ระบบเสถียร ✅ — ตรวจสอบสลิปได้ปกติ

---

## Environment Variables (เก็บอยู่บน Render)

| Key | คำอธิบาย |
|-----|---------|
| `SLIP2GO_API_KEY` | API Secret จาก Slip2Go dashboard |
| `BOT_TOKEN` | Telegram Bot Token |
| `WEBHOOK_URL` | URL สำหรับรับ Telegram webhook |
| `ADMIN_GROUP_ID` | Telegram Group ID สำหรับแจ้งเตือน admin |
| `BOT_USERNAME` | Username ของ Telegram bot |
| `DATABASE_URL` | PostgreSQL connection string |
| `SECRET_KEY` | Secret key สำหรับ session/token signing |
| `ADMIN_PASSCODE` | รหัสผ่านสำหรับเข้า Admin Panel |
| `ADMIN_TELEGRAM_IDS` | Telegram ID ของ admin (คั่นด้วยจุลภาค) |
| `SLIP2GO_API_URL` | (Optional) Override base URL — default: `https://connect.slip2go.com` |

> ตัวแปรทั้งหมดเก็บใน Render Environment Variables ไม่มีการ hardcode ในโค้ด

---

## Slip2Go API — ข้อมูลที่ถูกต้อง

| รายการ | ค่า |
|--------|-----|
| Base URL | `https://connect.slip2go.com` |
| Endpoint (base64) | `POST /api/verify-slip/qr-base64/info` |
| Auth Header | `Authorization: Bearer {SLIP2GO_API_KEY}` |
| Request Body | `{"payload": {"imageBase64": "data:image/jpeg;base64,..."}}` |
| Data URI Prefix | **ต้องส่งมาด้วย** (`data:image/jpeg;base64,...`) |
| Response HTTP | `200` เสมอ — ดูผลจาก `code` field |

### Response Codes

| Code | ความหมาย |
|------|---------|
| `200000` | Slip Found ✅ |
| `200001` | Get Info Success ✅ |
| `200200` | Slip is Valid ✅ |
| `200202` | Successfully Queue ✅ |
| `200401` | บัญชีผู้รับไม่ถูกต้อง ❌ |
| `200402` | ยอดโอนเงินไม่ตรงเงื่อนไข ❌ |
| `200403` | วันที่โอนไม่ตรงเงื่อนไข ❌ |
| `200404` | ไม่พบข้อมูลสลิปในระบบธนาคาร ❌ |
| `200500` | สลิปเสีย / สลิปปลอม ❌ |
| `200501` | สลิปซ้ำ ❌ |
| `200502` | Error จากธนาคาร กรุณาลองใหม่ ❌ |

---

## ประวัติปัญหาที่เจอและแก้ไข

### ปัญหาที่ 1 — Base URL ผิด (HTTP 405)
- **อาการ**: `Slip2Go endpoint ผิด method (HTTP 405)`
- **สาเหตุ**: โค้ดเดิมใช้ `https://app.slip2go.com` ซึ่งไม่ใช่ API server จริง
- **แก้ไข**: เปลี่ยนเป็น `https://connect.slip2go.com`

### ปัญหาที่ 2 — Path ผิด (Cannot POST)
- **อาการ**: `Cannot POST /api/verify-slip/base64/info`
- **สาเหตุ**: ใช้ path `/api/verify-slip/base64/info` ซึ่งไม่มีอยู่ใน Slip2Go
- **แก้ไข**: เปลี่ยนเป็น `/api/verify-slip/qr-base64/info`

### ปัญหาที่ 3 — Request Body ผิดรูปแบบ
- **สาเหตุ**: ส่ง `{"image": "..."}` ตรงๆ แต่ Slip2Go ต้องการ wrapper `{"payload": {...}}`
  และ key ต้องเป็น `imageBase64` ไม่ใช่ `image`
- **แก้ไข**: เปลี่ยน body เป็น `{"payload": {"imageBase64": "data:image/jpeg;base64,..."}}`

### ปัญหาที่ 4 — ตัด Data URI Prefix ออก
- **สาเหตุ**: โค้ดเดิม strip `data:image/jpeg;base64,` ออกก่อนส่ง แต่ Slip2Go ต้องการ prefix นี้
- **แก้ไข**: เก็บ prefix ไว้ ถ้าไม่มีให้เติมให้อัตโนมัติ

### ปัญหาที่ 5 — Response Parsing ผิด
- **สาเหตุ**: โค้ดดูที่ `success: true/false` แต่ Slip2Go ใช้ numeric `code` (200000, 200200 ฯลฯ)
- **แก้ไข**: กลับมาใช้ `code` field และ `SUCCESS_CODES` set
