import axios from 'axios';
import crypto from 'crypto';
import logger from '../../utils/logger';
import { POSProvider, OrderWithItems, Shop, PushResult, parsePosConfig, derivePaymentMethod } from './types';

/**
 * مزوّد Webhook عام: يرسل الطلب كـ JSON موحّد إلى رابط يحدده المطعم.
 * يغطّي أي نظام كاشير/مطبخ آخر (Marn/Odoo/مخصّص) أو وسيط (Zapier/Make/n8n).
 * المستقبِل يحوّل البيانات إلى فاتورة داخل نظامه.
 */
export const webhookProvider: POSProvider = {
  id: 'WEBHOOK',
  async pushOrder(order: OrderWithItems, shop: Shop): Promise<PushResult> {
    const cfg = parsePosConfig(shop);
    const url = String(cfg.url || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'رابط الويبهوك (URL) غير مضبوط أو غير صالح في إعدادات نظام الكاشير.' };
    }

    const payload = buildPayload(order, shop);
    const body = JSON.stringify(payload);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // توقيع HMAC-SHA256 ليتحقق المستقبِل أن الطلب صادر منّا فعلاً.
    if (cfg.secret) {
      headers['X-Otlob-Signature'] = crypto.createHmac('sha256', String(cfg.secret)).update(body).digest('hex');
    }

    try {
      const res = await axios.post(url, body, { headers, timeout: 15000 });
      const ref = res?.data?.id ?? res?.data?.ref ?? res?.data?.orderId;
      logger.info(`[POS:webhook] Order ${order.id} delivered to ${url}`);
      return { ok: true, ref: ref != null ? String(ref) : undefined };
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.response?.statusText || e?.message || 'webhook post failed';
      return { ok: false, error: `فشل إرسال الطلب للويبهوك: ${msg}` };
    }
  },
};

// جسم JSON الموحّد المرسَل للويبهوك (مستقر — يمكن للمطاعم الاعتماد على شكله).
function buildPayload(order: OrderWithItems, shop: Shop) {
  return {
    event: 'order.confirmed',
    orderId: order.id,
    timestamp: order.timestamp,
    shop: { id: shop.id, name: shop.name },
    customer: { name: order.customerName, phone: order.customerPhone },
    items: order.items.map((i) => ({
      productId: i.productId,
      name: i.name,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    summary: order.productName,
    total: order.price,
    paymentStatus: order.paymentStatus,
    paymentMethod: derivePaymentMethod(order),
    fulfillmentType: order.fulfillmentType, // DELIVERY | PICKUP
    preferredTime: order.preferredTime,
    locationUrl: order.locationUrl || null,
  };
}
