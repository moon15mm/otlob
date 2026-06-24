import { CartItem, Product } from './types';
import { formatPrice } from './utils/helpers';

// أدوات سلة الطلب للمطاعم: إضافة أصناف بكميات، حساب الإجمالي، وتنسيق الملخّص.

// يضيف صنفاً للسلة. إن كان الصنف موجوداً (نفس productId أو نفس الاسم) تُزاد كميته.
export function addToCart(cart: CartItem[], product: Product, quantity: number): CartItem[] {
  const qty = Math.max(1, Math.floor(quantity || 1));
  const existing = cart.find(
    (c) => (product.id && c.productId === product.id) || c.name === product.name
  );
  if (existing) {
    existing.quantity += qty;
  } else {
    cart.push({
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantity: qty,
    });
  }
  return cart;
}

// إجمالي الكميات (عدد القطع) في السلة.
export function cartCount(cart: CartItem[] = []): number {
  return cart.reduce((sum, c) => sum + c.quantity, 0);
}

// إجمالي سعر السلة.
export function cartTotal(cart: CartItem[] = []): number {
  return cart.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0);
}

// ملخّص نصّي مختصر يُخزَّن في Order.productName ويظهر في اللوحة والتبليغات.
// مثال: «بيتزا مارجريتا ×2، كولا ×1»
export function summarizeCart(cart: CartItem[] = []): string {
  if (cart.length === 0) return '';
  return cart.map((c) => `${c.name} ×${c.quantity}`).join('، ');
}

// ملخّص مفصّل لعرضه للعميل قبل التأكيد (كل سطر بسعره + الإجمالي).
export function formatCartSummary(cart: CartItem[] = []): string {
  if (cart.length === 0) return 'سلتك فارغة.';
  let out = '';
  cart.forEach((c, i) => {
    const line = c.unitPrice * c.quantity;
    out += `${i + 1}. 🍽️ *${c.name}* ×${c.quantity} — ${formatPrice(line)}\n`;
  });
  out += `\n*الإجمالي: ${formatPrice(cartTotal(cart))}*`;
  return out;
}
