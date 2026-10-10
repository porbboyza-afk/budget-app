# Budget Draft 01 — บันทึกส่งต่อ

วันที่: 10 ตุลาคม 2026

## ความต้องการที่ใช้ทำดราฟ

- สร้างโปรเจกต์ใหม่ทั้งหมด แยกจาก budget-app เดิม
- เน้นรายรับ–รายจ่าย ใช้ง่าย และปุ่มสำคัญมองเห็น
- ผู้ใช้เลือกเอิร์ทโทน: ครีม น้ำตาล และดินเผา
- ฟอร์มกับรายการอยู่ข้างกันบนคอม; จัดเรียงแนวตั้งบนจอแคบ

## หลักฐานการตรวจ

- เปิดจริงใน Brave ที่ http://127.0.0.1:8770
- ผ่านการลองฟอร์มจริง: เพิ่ม 123.45 บาท แก้เป็น 124.50 บาท ลบ และย้อนกลับ
- หลังรีเฟรชพบรายการที่บันทึก และแสดงในหน้าจอ; คืนข้อมูลตัวอย่างก่อนทดสอบแล้ว
- ผู้ตรวจ subagent อิสระอ่านโค้ด ตรวจภาพเอิร์ทโทน และรัน model tests: จำนวนเงินหน่วยสตางค์, วันที่ leap year, ยอดข้ามปี, import ผิดรูปแบบ/ID ซ้ำ และยอดรวมเกิน safe integer ผ่าน
- ตรวจการจัดหน้าแคบใน Brave ด้วยการย่อหน้าต่าง; ไม่ได้ทดสอบบนโทรศัพท์จริง
- ภาพดราฟอยู่ที่ previews/desktop.png และ previews/mobile.png

## ขอบเขตที่ยังต้องพัฒนา

ดราฟนี้ใช้ข้อมูลตัวอย่างและ browser localStorage ไม่มี login/cloud/PWA/ย้ายข้อมูลเก่า การกู้คืน JSON และ CSV มีโค้ดตรวจข้อมูล แต่ยังไม่ได้ทดสอบทุกเส้นทางผ่าน browser

การอัปเดตหลายแท็บมี storage event และตรวจค่าก่อนเขียนเพื่อป้องกันข้อมูลค้าง แต่ไม่ใช่การเขียนแบบ atomic; ระบบเก็บข้อมูลจริงในรุ่นถัดไปต้องรองรับ conflict อย่างรัดกุม

Undo คืนได้เฉพาะการลบล่าสุดระหว่างเปิดหน้า ไม่มีประวัติถังขยะหลังรีเฟรช

ข้อมูลตัวอย่างระบุด้วย banner; เริ่มชุดของตัวเองด้วยปุ่มเริ่มจดข้อมูลของฉัน หากเพิ่มรายการระหว่างโหมดตัวอย่าง ข้อมูลยังอยู่ในชุดตัวอย่าง ต้องสำรองก่อนเริ่มใหม่

## ถัดไปหลังผู้ใช้ดูดราฟ

ปรับหน้าตาและตำแหน่งปุ่มจากการใช้งานจริง แล้วทำระบบข้อมูลและซิงค์ที่เชื่อถือได้ ผู้ทำกับผู้ตรวจต้องเป็นคนละ subagent และยืนยันจากการรัน/ภาพจริงตามสิ่งที่รายงาน
# Draft 02 — Quick entry (2026-10-10)

## Release verification — 2026-10-10

User requested continuing through remaining implementation and deployment. New D1 cloud sync, owner auth and quotas configured; no old data imported. Real text/image AI calls passed (synthetic Thai receipt total115 once, slip350). Brave owner login, cloud CRUD/undo, refresh persistence and selected-month AI answer passed. Test row removed; database returned to empty. Original GitHub Pages entry will redirect to new Pages host. No API token/key in notes or Git.

## Start fresh — 2026-10-10

User explicitly discarded the need for old financial data: “ข้อมูลเก่าทิ้งเลยไม่มีประโยชน์ละ”. Migration removed from release requirements; new installations now start empty rather than seeded samples. Existing new-draft records retained; no remote data purge performed.

## AI implementation — 2026-10-10

User authorized DeepSeek from existing env and requested replacing the correct Budget GitHub app with security prioritized.
Added reviewed text/image proposals and selected-month questions, server-only credential, production verified owner auth and D1 quotas, loopback development server on 8771.
Source reviewed independently; build completed. No new tests/paid API calls run.
Production replacement pending old data migration and owner configuration; see RELEASE_HANDOFF.md.

User approved simplifying the primary flow: totals → quick entry → recent entries.
Earth colors retained. Amount alone is sufficient; omitted notes use รายรับ/รายจ่าย.
New entries default to expenses and today's local date, independent of the viewed month.
Notes, date, category, edit/delete, monthly summary, and backup remain visible.
After saving, the amount clears and receives focus; feedback includes the saved amount.
Entries with the same date show the most recently added first.
Existing storage and sample data are retained. This change does not add cloud sync.
This revision was reviewed from source; no new automated or interaction tests were run.
Independent reviewer identified that active filters could hide a saved entry; saving now clears them.
Sample mode still permits trial entries; use “เริ่มจดข้อมูลของฉัน” before recording real data.

