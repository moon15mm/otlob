import prisma from '../db';
import logger from '../../utils/logger';
import { sendToAdminGroup, WhatsAppConfig } from '../whatsapp';
import { POSProvider, OrderWithItems, Shop } from './types';
import { foodicsProvider } from './foodics';
import { webhookProvider } from './webhook';

// سجل المزوّدين — إضافة مزوّد جديد لاحقاً = سطر واحد هنا + ملف تنفيذه.
const REGISTRY: Record<string, POSProvider> = {
  FOODICS: foodicsProvider,
  WEBHOOK: webhookProvider,
};

// كل الأنظمة المدعومة — متاحة لكل مطعم ليختار نظامه بنفسه (لا قيد على مستوى المنصّة).
export const SUPPORTED_POS_PROVIDERS: string[] = Object.keys(REGISTRY);

export function getProvider(id: string | null | undefined): POSProvider | undefined {
  if (!id) return undefined;
  return REGISTRY[id.toUpperCase()];
}

/**
 * النقطة الموحّدة: تُستدعى من كل نقاط تأكيد الطلب (نقدي/أونلاين/تأكيد الأدمن).
 * - لا ترمي استثناءً للأعلى أبداً (لا تحجب رد العميل على واتساب).
 * - Idempotent: تتخطّى الطلب إن سبق إرساله (posSyncStatus === 'SENT').
 * - عند الفشل: تحفظ posSyncStatus='FAILED' + posSyncError وتُشعر الأدمن؛ والكرون يعيد المحاولة.
 */
export async function pushOrderToPOS(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) {
      logger.warn(`[POS] Order ${orderId} not found; skip sync`);
      return;
    }

    const shop = await prisma.shop.findUnique({ where: { id: order.shopId } });
    if (!shop) return;

    const providerId = (shop.posProvider || 'NONE').toUpperCase();
    if (providerId === 'NONE') return; // المطعم لا يستخدم تكامل كاشير

    // Idempotency: لا تُرسل مرتين (يمنع تكرار الفاتورة في نظام المطعم).
    if (order.posSyncStatus === 'SENT') {
      logger.info(`[POS] Order ${orderId} already synced; skip`);
      return;
    }

    const provider = getProvider(providerId);
    if (!provider) {
      logger.warn(`[POS] Unknown provider '${providerId}' for shop ${shop.id}; skip`);
      return;
    }

    await prisma.order.update({ where: { id: order.id }, data: { posSyncStatus: 'PENDING', posSyncError: null } });

    let result;
    try {
      result = await provider.pushOrder(order as OrderWithItems, shop);
    } catch (e: any) {
      result = { ok: false, error: e?.message || String(e) };
    }

    if (result.ok) {
      await prisma.order.update({
        where: { id: order.id },
        data: { posSyncStatus: 'SENT', posRef: result.ref || null, posSyncError: null },
      });
      logger.info(`[POS] Order ${order.id} synced to ${providerId} (ref: ${result.ref || 'n/a'})`);
    } else {
      const errMsg = (result.error || 'unknown error').slice(0, 500);
      await prisma.order.update({
        where: { id: order.id },
        data: { posSyncStatus: 'FAILED', posSyncError: errMsg },
      });
      logger.error(`[POS] Order ${order.id} sync to ${providerId} FAILED: ${errMsg}`);
      await notifyAdminFailure(shop, order, providerId, errMsg);
    }
  } catch (err: any) {
    // حماية نهائية: حتى لو فشل كل شيء، لا نرمي للأعلى.
    logger.error(`[POS] pushOrderToPOS(${orderId}) crashed: ${err?.message || err}`);
  }
}

// يُشعر مجموعة الأدمن على واتساب أن طلباً لم يصل لنظام الكاشير (مع رقم الطلب والسبب).
async function notifyAdminFailure(shop: Shop, order: OrderWithItems, providerId: string, error: string): Promise<void> {
  if (!shop.whatsappAdminGroupId) return;
  const whatsappConfig: WhatsAppConfig = {
    whatsappType: shop.whatsappType as 'BUSINESS' | 'NORMAL',
    shopId: shop.id,
    token: shop.whatsappToken,
    phoneId: shop.whatsappPhoneId,
    adminGroupId: shop.whatsappAdminGroupId,
    ultramsgInstanceId: shop.ultramsgInstanceId,
    ultramsgToken: shop.ultramsgToken,
  };
  const msg =
    `⚠️ تعذّر إرسال الطلب لنظام الكاشير (${providerId})\n` +
    `━━━━━━━━━━━━━━\n` +
    `📋 رقم الطلب: ${order.id}\n` +
    `🍽️ الطلب: ${order.productName || 'N/A'}\n` +
    `💰 المبلغ: ${order.price} SAR\n` +
    `❌ السبب: ${error}\n` +
    `سيُعاد المحاولة تلقائياً. يمكن إصدار الفاتورة يدوياً عند الحاجة.\n` +
    `━━━━━━━━━━━━━━`;
  try {
    await sendToAdminGroup(whatsappConfig, msg);
  } catch (e) {
    logger.warn(`[POS] Failed to notify admin about POS sync failure for order ${order.id}`);
  }
}

/**
 * إعادة محاولة المزامنات الفاشلة — يستدعيها كرون دوري.
 * يلتقط طلبات FAILED خلال آخر 24 ساعة ويعيد pushOrderToPOS لها (idempotent).
 */
export async function retryFailedPosSyncs(): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let failed;
  try {
    failed = await prisma.order.findMany({
      where: { posSyncStatus: 'FAILED', timestamp: { gte: since } },
      select: { id: true },
      take: 100,
    });
  } catch (e: any) {
    logger.error(`[POS] retryFailedPosSyncs query failed: ${e?.message || e}`);
    return;
  }
  if (failed.length === 0) return;
  logger.info(`[POS] Retrying ${failed.length} failed POS sync(s)...`);
  for (const o of failed) {
    await pushOrderToPOS(o.id);
  }
}
