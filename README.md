# NovelTrans v10 Pro — Multi-file Edition

## โครงสร้างไฟล์
```
NovelTrans/
├── index.html   ← หน้าหลัก
├── style.css    ← CSS ทั้งหมด
├── app.js       ← JavaScript ทั้งหมด
├── serve.sh     ← สคริปต์เปิด server
└── README.md    ← ไฟล์นี้
```

## วิธีใช้บน Termux

### 1. ติดตั้ง Python (ถ้ายังไม่มี)
```bash
pkg update && pkg install python
```

### 2. คัดลอกโฟลเดอร์ไปที่ต้องการ
```bash
cp -r NovelTrans ~/storage/shared/NovelTrans
```

### 3. เปิด server
```bash
cd ~/storage/shared/NovelTrans
chmod +x serve.sh
./serve.sh
```

### 4. เปิด browser
ไปที่ `http://localhost:8080`

---

## หรือเปิดทีเดียวด้วยคำสั่งเดียว
```bash
cd ~/path/to/NovelTrans && python3 -m http.server 8080
```

แล้วเปิด browser → `http://localhost:8080`

---

## หมายเหตุ
- **ห้ามเปิดแบบ `file://`** เพราะ IndexedDB จะไม่ทำงานข้ามไฟล์
- ข้อมูลทั้งหมด (Workspace, Chapter) เก็บใน IndexedDB ของ browser
- API Key เก็บใน localStorage ของ browser
