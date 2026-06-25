import { Prisma, Shop } from '@prisma/client';

// الطلب مع سطوره (OrderItem) — مصدر الحقيقة الذي نرسله لنظام الكاشير/المطبخ.
export type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

export type { Shop };

export interface PushResult {
  ok: boolean;
  ref?: string;   // معرّف الطلب داخل نظام المطعم (للتتبّع)
  error?: string; // رسالة الخطأ عند الفشل (تُعرض للأدمن وتُحفظ في posSyncError)
}

// كل مزوّد (Foodics / Webhook / ...) ينفّذ هذه الواجهة الموحّدة.
export interface POSProvider {
  id: 'FOODICS' | 'WEBHOOK';
  pushOrder(order: OrderWithItems, shop: Shop): Promise<PushResult>;
}

// إعداد المزوّد محفوظ كـ JSON في Shop.posConfig — تُحلَّل بأمان (لا ترمي عند تلف القيمة).
export function parsePosConfig(shop: Shop): Record<string, any> {
  try {
    return JSON.parse(shop.posConfig || '{}') || {};
  } catch {
    return {};
  }
}

// طريقة الدفع مشتقّة من cardLast4 (CASH/BANK) أو online افتراضاً — تُرسل لنظام المطعم.
export function derivePaymentMethod(order: OrderWithItems): 'CASH' | 'BANK' | 'ONLINE' {
  if (order.cardLast4 === 'CASH') return 'CASH';
  if (order.cardLast4 === 'BANK') return 'BANK';
  return 'ONLINE';
}
