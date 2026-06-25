import axios from 'axios';
import logger from '../../utils/logger';
import { assertSafeOutboundUrl, ssrfSafeHttpAgent, ssrfSafeHttpsAgent } from '../../utils/ssrf';
import { POSProvider, OrderWithItems, Shop, PushResult, parsePosConfig } from './types';

/**
 * مزوّد Foodics: ينشئ الطلب مباشرة في نظام Foodics فيظهر بالكاشير وشاشة المطبخ (KDS)
 * ويخصم مخزون المطعم ويُصدر فاتورة ZATCA.
 *
 * إعداد المطعم (Shop.posConfig):
 *   { apiToken, branchId, menuMap: { "<ourProductId>": "<foodicsProductId>" },
 *     baseUrl?, deliveryType?, pickupType? }
 *
 * ⚠️ يجب تأكيد الشكل الدقيق لحمولة POST /orders وقيم `type` وآلية الـtoken من توثيق
 * Foodics v5 الرسمي (developers.foodics.com) قبل التشغيل الإنتاجي. الحمولة أدناه
 * بنية مبدئية معقولة، ومعزولة هنا فيسهل تعديلها دون لمس بقية النظام.
 */

const DEFAULT_BASE = 'https://api.foodics.com/v5';
// قيم `type` في Foodics أعداد صحيحة؛ نجعلها قابلة للتهيئة لتفادي تثبيت قيمة خاطئة.
const DEFAULT_DELIVERY_TYPE = 1;
const DEFAULT_PICKUP_TYPE = 2;

export const foodicsProvider: POSProvider = {
  id: 'FOODICS',
  async pushOrder(order: OrderWithItems, shop: Shop): Promise<PushResult> {
    const cfg = parsePosConfig(shop);
    const apiToken = String(cfg.apiToken || '').trim();
    const branchId = String(cfg.branchId || '').trim();
    const menuMap: Record<string, string> = (cfg.menuMap && typeof cfg.menuMap === 'object') ? cfg.menuMap : {};
    const baseUrl = String(cfg.baseUrl || DEFAULT_BASE).replace(/\/$/, '');

    if (!apiToken) return { ok: false, error: 'Foodics API Token غير مضبوط في إعدادات نظام الكاشير.' };
    if (!branchId) return { ok: false, error: 'Foodics Branch ID غير مضبوط في إعدادات نظام الكاشير.' };

    // حوّل سطور السلة إلى منتجات Foodics عبر خريطة الربط. أي صنف غير مربوط = فشل واضح.
    const products: any[] = [];
    const unmapped: string[] = [];
    for (const item of order.items) {
      const foodicsId = item.productId ? menuMap[item.productId] : undefined;
      if (!foodicsId) {
        unmapped.push(item.name);
        continue;
      }
      products.push({
        product_id: foodicsId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
      });
    }
    if (unmapped.length > 0) {
      return { ok: false, error: `أصناف غير مربوطة بقائمة Foodics: ${unmapped.join('، ')}. اربطها من إعدادات نظام الكاشير.` };
    }
    if (products.length === 0) {
      return { ok: false, error: 'لا توجد أصناف صالحة لإرسالها إلى Foodics.' };
    }

    const type = order.fulfillmentType === 'PICKUP'
      ? Number(cfg.pickupType ?? DEFAULT_PICKUP_TYPE)
      : Number(cfg.deliveryType ?? DEFAULT_DELIVERY_TYPE);

    const payload = {
      business_reference: order.id, // مرجعنا الخارجي — يربط طلب Foodics بطلبنا (idempotency على جانبهم)
      branch_id: branchId,
      type,
      products,
      customer: { name: order.customerName, phone: order.customerPhone },
    };

    // SSRF guard: a shop could override baseUrl to an internal address.
    const ordersUrl = `${baseUrl}/orders`;
    try {
      assertSafeOutboundUrl(ordersUrl);
    } catch (e: any) {
      return { ok: false, error: `عنوان Foodics غير صالح: ${e.message}` };
    }

    try {
      const res = await axios.post(ordersUrl, payload, {
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        timeout: 20000,
        maxRedirects: 0,
        httpAgent: ssrfSafeHttpAgent,
        httpsAgent: ssrfSafeHttpsAgent,
      });
      const ref = res?.data?.data?.id ?? res?.data?.id;
      logger.info(`[POS:foodics] Order ${order.id} created in Foodics (ref: ${ref || 'n/a'})`);
      return { ok: true, ref: ref != null ? String(ref) : undefined };
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.response?.statusText || e?.message || 'foodics create order failed';
      return { ok: false, error: `فشل إنشاء الطلب في Foodics: ${msg}` };
    }
  },
};
