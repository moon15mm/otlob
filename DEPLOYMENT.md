# اطلب (Otlob) — دليل النشر والتشغيل

نسخة المطاعم من نظام «وردات». SaaS متعدد المستأجرين يحوّل المطاعم إلى بوت طلبات آلي على واتساب
عبر الذكاء الاصطناعي، مع **سلة طلب متعددة الأصناف**، لوحة تحكم لكل مطعم، وبوت تلجرام لإدارة القائمة.

- **الموقع المباشر:** https://otlob.xyz (و `www` و `demo.otlob.xyz`)
- **المستودع:** https://github.com/moon15mm/otlob (فرع `main`)
- **فحص الصحة:** https://otlob.xyz/health → `{"status":"ok"}`

---

## 1) البنية والتقنيات (Stack)
- Node.js + TypeScript + Express — البناء `tsc` → `dist/`، التشغيل `node dist/index.js`.
- Prisma + PostgreSQL. الواجهة HTML ثابتة في `public/` (login, dashboard, superadmin, success/cancel, privacy, reset-password, test-simulator).
- الذكاء الاصطناعي لكل مطعم: OpenAI أو Gemini (`aiProvider`).
- واتساب لكل مطعم: Meta Cloud API (`BUSINESS`) أو Baileys/باركود (`NORMAL`).
- بوابات الدفع لكل مطعم: Stripe / Moyasar / Tap / MyFatoorah.

## 2) أهم فرق عن وردات: السلة متعددة الأصناف
وردات = منتج واحد لكل طلب. «اطلب» يضيف **سلة بعدة أصناف وكميات**:
- نموذج Prisma جديد `OrderItem` (`orderId, name, unitPrice, quantity, lineTotal`).
- `Order.productName` = ملخّص نصّي للسلة، `Order.price` = الإجمالي.
- حالات محادثة جديدة `ADDING_ITEM_QTY` + `CART_REVIEW`؛ حُذف تدفّق «المستلم/الإهداء».
- أدوات السلة في `src/cart.ts`. التدفّق: قائمة الطعام → اختيار صنف → كمية → مراجعة السلة (أضف/«إنهاء») → اسم → توصيل/استلام → وقت → تأكيد → دفع.

## 3) النشر على الخادم
خادم VPS مشترك على `167.86.77.174` (root) يستضيف تطبيقات أخرى (estlem-*, medo-platform, sentinel, **wardat-saas**).
> ⚠️ لا تلمس غير `otlob-saas`. لا تُعِد تشغيل أو تعدّل أي عملية أخرى.

| المكوّن | القيمة |
|---|---|
| مجلد الكود | `/root/otlob` (مستنسخ من GitHub) |
| عملية pm2 | `otlob-saas` — `dist/index.js` — `PORT=3009` |
| قاعدة البيانات | Postgres محلي (5432): role `otlob_user` / db `otlob_db` (منفصلة عن وردات) |
| nginx | `/etc/nginx/sites-available/otlob.xyz` → `localhost:3009`، `server_name otlob.xyz *.otlob.xyz` |
| TLS | certbot (اسم الشهادة `otlob.xyz`، يغطّي otlob.xyz/www/demo)، تجديد تلقائي، تحويل http→https |
| DNS | Namecheap BasicDNS — سجلات A لـ `@`/`www`/`*` → `167.86.77.174` |
| المتغيرات السرّية | في `/root/otlob/.env` فقط (chmod 600) — لا في git |

### إعداد أوّلي من الصفر (مرجع)
```bash
git clone https://github.com/moon15mm/otlob.git /root/otlob && cd /root/otlob
# قاعدة بيانات منفصلة:
sudo -u postgres psql -c "CREATE ROLE otlob_user LOGIN PASSWORD '***'; CREATE DATABASE otlob_db OWNER otlob_user;"
sudo -u postgres psql -d otlob_db -c "GRANT ALL ON SCHEMA public TO otlob_user; ALTER SCHEMA public OWNER TO otlob_user;"
# .env إنتاج (PORT=3009, DATABASE_URL=otlob_db, APP_BASE_URL=https://otlob.xyz, SESSION_SECRET, ADMIN_*, TELEGRAM_BOT_TOKEN)
# الخادم يشغّل baileys v7؛ المستودع يثبّت ^6.7.9 — ارفعه قبل التثبيت:
sed -i 's#"@whiskeysockets/baileys": "\^6.7.9"#"@whiskeysockets/baileys": "^7.0.0-rc13"#' package.json
npm install && npx prisma generate && npx prisma db push && npm run build && npm run seed
pm2 start dist/index.js --name otlob-saas --update-env && pm2 save
# nginx site + certbot --nginx -d otlob.xyz -d www.otlob.xyz -d demo.otlob.xyz --redirect
```

## 4) تحديث / إعادة النشر
**تغييرات ثابتة فقط** (ملفات تحت `public/`): على الخادم `git pull origin main` **فقط** — بلا build/restart؛ التغيير حيّ فوراً.
```bash
cd /root/otlob && git pull origin main
```
**تغييرات الباك-إند (TS/Prisma):** بعد الدفع إلى GitHub:
```bash
cd /root/otlob
git pull origin main
sed -i 's#"@whiskeysockets/baileys": "\^6.7.9"#"@whiskeysockets/baileys": "^7.0.0-rc13"#' package.json   # عند الحاجة
npm install               # فقط إن تغيّرت التبعيات
npx prisma generate && npx prisma db push   # فقط إن تغيّر المخطط
npm run build
pm2 restart otlob-saas --update-env
```
> الخادم يحتفظ بتعديل محلي على `package.json`/`package-lock.json` (رفع baileys). إن صادف `git pull` تعارضاً بسببه ولأن الـcommit يغيّر package.json أيضاً: `git checkout -- package.json package-lock.json` ثم أعد المحاولة + sed.

التحقق: `curl localhost:3009/health` و `pm2 logs otlob-saas`.

## 5) بوت تلجرام لإدارة القائمة
- بوت واحد على مستوى المنصّة: **OtlobMenuBot** (`https://t.me/OtlobMenuBot`). توكنه في `/root/otlob/.env` (`TELEGRAM_BOT_TOKEN`).
- يجب أن يكون بوتاً مستقلاً عن وردات (وضع polling حصري لكل توكن).
- صاحب المطعم: `/link اسم_المستخدم كلمة_المرور` (نفس بيانات لوحة التحكم) → يُحفظ في `shop.ownerTelegramId`، ثم يرسل صورة الصنف → يُضاف للقائمة.
- بطاقة QR + شرح موجودة في لوحة التحكم → تبويب **الإعدادات** (`public/dashboard/telegram-bot-qr.svg`).

## 6) إعدادات كل مطعم (من لوحة تحكمه)
لتفعيل استقبال الطلبات فعلياً يُدخل كل مطعم: رقم/توكن واتساب، مفتاح الذكاء الاصطناعي، وبوابة الدفع.
الإنشاء وإدارة الاشتراكات من **لوحة المشرف العام** `/superadmin`.

## 7) النسخ الاحتياطي
نسخ يومي تلقائي (cron): `pg_dump` لقاعدة `otlob_db` + أرشيف جلسات واتساب، بأسماء `otlob-db-*.sql.gz` / `otlob-sessions-*.tar.gz`. الاستعادة من لوحة المشرف العام (تأخذ لقطة أمان قبل الكتابة).

## 8) بيانات الاعتماد (المواضع فقط — لا قيم)
- أسرار التطبيق ومفاتيح كل مطعم: `/root/otlob/.env` (chmod 600) وقاعدة البيانات.
- المشرف العام: `ADMIN_USERNAME`/`ADMIN_PASSWORD` في `.env`. مطعم الديمو: subdomain `demo`، مستخدم `demo_admin`.
- نسخ `.env` الاحتياطية: `/root/otlob/.env.bak.<ts>` (خارج git).

## 9) ملاحظات أمنية
- لا تُودِع أي توكن/كلمة مرور في المستودع. `.env` و`*.bak` مستثناة في `.gitignore`.
- الشهادة تغطّي otlob.xyz/www/demo فقط؛ نطاقات المستأجرين الأخرى تحتاج شهادة wildcard لاحقاً.
- بعد أي وصول SSH بكلمة مرور ظهرت في مكان غير آمن، غيّر كلمة مرور root.
