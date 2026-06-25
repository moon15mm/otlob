# AGENTS.md — ملف ذاكرة/سياق النظام (اقرأه أولاً قبل أي تعديل)

> هذا الملف موجّه لأي مساعد ذكاء اصطناعي يعمل على هذا الكود. اقرأه بالكامل قبل تعديل أي شيء.
> الهدف: تفهم النظام بسرعة، وتعدّل بأمان **دون كسر** الأجزاء المترابطة.
> (مرجع النشر التفصيلي في `DEPLOYMENT.md`.)

---

## 0) ما هو النظام باختصار
**اطلب (Otlob)** = SaaS متعدد المستأجرين يحوّل **المطاعم** إلى بوت طلبات آلي على واتساب بالذكاء الاصطناعي.
هو **نسخة مستقلة (fork)** من نظام **وردات (Wardat)** الموجّه لمحلات الورد/الهدايا. النظامان **متطابقان بنيوياً**؛
الفروق دلالية (مطعم/أصناف بدل متجر/منتجات) + ميزة **السلة متعددة الأصناف** في اطلب.

| | اطلب (Otlob) | وردات (Wardat) |
|---|---|---|
| المجال | مطاعم / قائمة طعام | ورد وهدايا |
| الموقع | https://otlob.xyz | https://wardat.xyz |
| GitHub | `moon15mm/otlob` | `moon15mm/wardat` |
| pm2 / منفذ | `otlob-saas` / 3009 | `wardat-saas` / 3008 |
| قاعدة البيانات | `otlob_db` / `otlob_user` | `wardat_db` / `wardat_user` |
| بوت تلجرام | `OtlobMenuBot` | `WardatAdminBot` |
| سلة متعددة الأصناف | ✅ نعم | ❌ لا (منتج واحد/طلب) |

كلاهما على **نفس الخادم** `167.86.77.174` (root) مع تطبيقات أخرى (estlem-*, medo-platform, sentinel).

---

## 1) ⛔ قواعد ذهبية — لا تكسرها
1. **مفاتيح `localStorage` اسمها `wardat_*` في الواجهتين** (`wardat_token`, `wardat_role`, `wardat_theme`, `wardat_shop_id`, `wardat_name`...). **لا تُعِد تسميتها** — مشتركة بين كل صفحات الواجهة (login/dashboard/superadmin)؛ تغييرها يكسر تسجيل الدخول. (نعم، حتى في otlob بقيت `wardat_*` عمداً.)
2. **نماذج Prisma تبقى بأسمائها الإنجليزية** (`Shop`, `Product`, `Order`, `Session`, `OrderItem`...). `Shop`=مطعم، `Product`=صنف. النصوص العربية في الواجهة تقول «مطعم/صنف» لكن **الكود/الـIDs/الـAPI إنجليزية** — لا تترجم المعرّفات.
3. **في `public/*.html`: احذر تكرار `id`.** `getElementById` يُرجع أول عنصر فقط؛ تكرار نفس الـid يُنشئ حقولاً «ميّتة» لا تُحفظ. (سبق إصلاح تكرار حقول Stripe — لا تُعِده.)
4. **التزامن**: كل رسالة تُعالَج عبر `runSerialized(\`${shopId}:${phone}\`, …)` ([src/index.ts]). لا تزل هذا — يمنع تضارب القراءة/الكتابة على الجلسة، ويسمح للعملاء المختلفين بالعمل بالتوازي.
5. **عملية واحدة فقط (single process).** خرائط في الذاكرة (`src/utils/concurrency.ts`: سلاسل التزامن + dedup، وطابور Baileys لكل متجر في `src/services/whatsapp.ts`) تعني **لا يمكن تشغيل نسختين** خلف موزّع أحمال دون نقلها إلى Redis/BullMQ. لا تفترض scaling أفقي.
6. **على الخادم: لا تلمس غير `otlob-saas`** (لـ otlob) — لا تُعِد تشغيل/تعدّل estlem/medo/sentinel/wardat-saas.
7. **بوت تلجرام بوضع polling حصري لكل توكن** — لكل نظام بوته الخاص؛ لا تشارك توكناً واحداً بين otlob ووردات.
8. **لا تُودِع أسراراً في git.** `.env` و`*.bak` و`public/uploads`/`public/catalogs` مستثناة في `.gitignore`.

---

## 2) التقنيات وخريطة الملفات
Node + TypeScript + Express، Prisma + PostgreSQL، pm2. البناء `tsc`→`dist/`، التشغيل `node dist/index.js`.

```
prisma/schema.prisma     # Shop, Product, Order, OrderItem, Session, BlockedCustomer, AiUsage, Prospect, PlatformSetting
src/index.ts             # Express app، الويبهوكس (واتساب/سترايب)، توجيه الرسائل عبر runSerialized، الكرون، إقلاع تلجرام
src/agents/
  agent-1-conversation.ts# قلب المحادثة + آلة الحالات + تدفّق السلة + تدفّق المالك (إضافة صنف بصورة)
  agent-2-payment.ts     # إنشاء رابط الدفع (محايد للبوابة)
  agent-3-excel.ts       # addOrder/updateOrderStatus (كتابة الطلبات في DB)
  agent-4-finance.ts     # تأكيد الدفع (ويبهوك سترايب) + إشعار الأدمن
src/cart.ts              # أدوات السلة: addToCart, cartTotal, summarizeCart, formatCartSummary
src/products.ts          # قراءة الأصناف + تنسيق قائمة الطعام + كولاج الكتالوج
src/services/
  openai.ts              # SYSTEM_PROMPT + getAIResponse + classifyIntent (OpenAI/Gemini)
  session.ts             # getSession (يعيد بناء selectedProduct من selectedProductId) / saveSession
  whatsapp.ts            # إرسال (BUSINESS=Cloud API / NORMAL=Baileys) + طابور لكل متجر
  baileys-manager.ts     # جلسات باركود واتساب في العملية
  db.ts                  # PrismaClient
  telegram-catalog-bot.ts# بوت تلجرام لإدارة القائمة (/link ثم صورة الصنف)
  stripe|moyasar|tap|myfatoorah-service.ts  # بوابات الدفع
  backup.ts              # نسخ احتياطي يومي (otlob-db-*.sql.gz / otlob-sessions-*.tar.gz)
  email.ts, settings.ts, ai-usage.ts, abandoned-cart.ts, acquisition-agent.ts, outreach.ts, lead-finder.ts
  gift-card.ts           # موروث من وردات، غير مستخدم في اطلب (غير مستورد) — لا تَبْنِ عليه
src/utils/               # helpers (formatPrice/maskPhone...), auth, concurrency, logger
public/                  # واجهة ثابتة: index, login, dashboard/, superadmin/, success/cancel, privacy, reset-password, test-simulator
```

## 3) النموذج وتدفّق الطلب (السلة متعددة الأصناف)
- `Order`: `productName`=ملخّص نصّي للسلة، `price`=الإجمالي، `recipientName` **nullable** (موروث، غير مستخدم).
- `OrderItem`: سطر لكل صنف (`name, unitPrice, quantity, lineTotal`) مرتبط بـ`Order` (onDelete Cascade).
- السلة أثناء المحادثة في `session.orderData.cart` (JSON محفوظ)؛ تتحوّل إلى `OrderItem[]` عند إنشاء الطلب في `proceedWithPaymentMethod`.
- **آلة الحالات** (`ConversationState` في `src/types/index.ts`):
  `GREETING → BROWSING → SELECTING_PRODUCT → ADDING_ITEM_QTY → CART_REVIEW → COLLECTING_NAME → [COLLECTING_PHONE] → COLLECTING_FULFILLMENT → COLLECTING_LOCATION/COLLECTING_TIME → CONFIRMING_ORDER → COLLECTING_PAYMENT_METHOD → AWAITING_PAYMENT/AWAITING_BANK_TRANSFER → COMPLETED`
  وحالات المالك: `OWNER_COLLECTING_PRODUCT_NAME/PRICE/DESC`.
  (حالات `COLLECTING_RECIPIENT*` حُذفت في اطلب — لا تُعِدها.)
- `getSession` يعيد بناء `selectedProduct` من `selectedProductId` بين الرسائل — تدفّق «اختيار ثم كمية» يعتمد على ذلك.

## 4) تعدّد المستأجرين والإعدادات
- نموذج مركزي `Shop`؛ لكل مطعم بيانات واتساب/AI/دفع خاصة + لوحة تحكم. المشرف العام (`ADMIN_*`) ينشئ المطاعم من `/superadmin`.
- **واتساب لكل مطعم**: `BUSINESS` (Meta Cloud API، ويبهوك موقّع) أو `NORMAL` (Baileys/باركود في العملية).
- **AI لكل مطعم**: `OPENAI` أو `GEMINI` (`aiProvider`)، مفتاح خاص بكل مطعم (مفتاح المنصّة احتياطي).
- **الدفع لكل مطعم**: `paymentGateway` ∈ STRIPE/MOYASAR/TAP/MYFATOORAH. حقول Stripe تظهر فقط عند اختياره (`#stripeFieldsGroup`).
- بوت تلجرام يربط المالك بمتجره عبر `/link username password` → `shop.ownerTelegramId`.

## 5) النشر (ملخّص — التفصيل في DEPLOYMENT.md)
- **تغيير ثابت فقط** (ملفات `public/`): على الخادم `git pull origin main` **فقط** — بلا build/restart؛ حيّ فوراً.
- **تغيير باك-إند** (TS/Prisma): `git pull` → (sed لـ baileys v7 عند الحاجة) → `npm install` (إن تغيّرت التبعيات) → `prisma generate && db push` (إن تغيّر المخطط) → `npm run build` → `pm2 restart otlob-saas --update-env`.
- **caveat baileys**: الخادم يشغّل `^7.0.0-rc13`، المستودع يثبّت `^6.7.9` (تعديل محلي على package.json على الخادم). إن أبطل `git pull` بسبب تعارض package.json: `git checkout -- package.json package-lock.json` ثم أعد + sed.
- **DNS**: Namecheap BasicDNS، A لـ `@`/`www`/`*` → `167.86.77.174`. **TLS**: certbot (otlob.xyz/www/demo فقط — ليست wildcard).
- التحقق: `curl localhost:3009/health`.

## 6) أعراف ومحاذير إضافية
- بناء التزامن يجعل **عملاء مختلفين متوازين**؛ رسائل نفس العميل **متسلسلة**. ١٥ محادثة متزامنة (٥ مطاعم × ٣) = حِمل تافه.
- طابور Baileys لكل متجر يُرسل ردود نفس المتجر تتابعياً (تأخير جزء ثانية) لتفادي حظر واتساب — ليس خطأ.
- خطة `SILVER` لها حدود (500 طلب/شهر، 3 طلبات نشطة/عميل) مطبّقة في الكود.
- بيانات السرّ في DB/الواجهة تُقنّع (`maskSecret`) — لا تكشف المفاتيح الحيّة.
- النصوص العربية كثيراً ما تُستخدم في regex لمطابقة نية العميل (إلغاء/استلام/...) — لا تُبدّلها باستبدال أعمى.

## 7) إذا احتجت تعديلاً — افعل
1. حدّد إن كان **ثابتاً (public/)** أم **باك-إند** — لتعرف خطوات النشر الصحيحة.
2. ابحث عن نمط موجود وأعد استخدامه (cart.ts، helpers، services) قبل كتابة جديد.
3. عدّل النصوص العربية للواجهة دون لمس المعرّفات الإنجليزية/مفاتيح `wardat_*`.
4. بعد التعديل: `npm run build` محلياً (للباك-إند)، ثم commit + push، ثم انشر بالخطوات أعلاه، ثم تحقّق من `/health` والسلوك فعلياً.
5. لا تلمس وردات أو تطبيقات الخادم الأخرى إلا بطلب صريح.

> الفروق نفسها تنطبق على **وردات** (نفس البنية، دلالات ورد/هدايا، بلا سلة متعددة). عند العمل على وردات: استبدل otlob→wardat في الجدول أعلاه، والتزم نفس القواعد الذهبية.
