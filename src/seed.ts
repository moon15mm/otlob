import prisma from './services/db';
import { hashPassword } from './utils/auth';

async function main() {
  console.log('Seeding database...');

  // Create or update demo restaurant
  const shop = await prisma.shop.upsert({
    where: { subdomain: 'demo' },
    update: {},
    create: {
      name: 'مطعم اطلب ديمو',
      subdomain: 'demo',
      username: 'demo_admin',
      password: await hashPassword('demo123'),
      whatsappPhoneId: 'YOUR_WHATSAPP_PHONE_ID', // استبدله بمعرف رقم الواتساب الخاص بك
      whatsappToken: 'YOUR_WHATSAPP_ACCESS_TOKEN', // استبدله برمز الوصول الخاص بك
      whatsappVerifyToken: 'my_universal_token_123',
      stripeSecretKey: 'sk_test_your_key', // استبدله بمفتاح Stripe الخاص بك
      stripeWebhookSecret: 'whsec_your_webhook_secret',
      stripeSuccessUrl: 'https://demo.otlob.xyz/success',
      stripeCancelUrl: 'https://demo.otlob.xyz/cancel',
      whatsappAdminGroupId: 'YOUR_ADMIN_GROUP_ID', // اختياري: معرف جروب الإدارة للتبليغ
    },
  });

  console.log(`Demo restaurant created/verified: ${shop.name} (ID: ${shop.id})`);

  // Clear existing menu items of this restaurant to avoid duplication on re-run
  await prisma.product.deleteMany({
    where: { shopId: shop.id },
  });

  // Create menu items (أصناف القائمة)
  await prisma.product.createMany({
    data: [
      {
        shopId: shop.id,
        name: 'شاورما دجاج (ساندويتش)',
        description: 'خبز صاج محمّص مع دجاج متبّل وصلصة ثوم ومخلل',
        price: 12.0,
        imageUrl: 'https://example.com/images/shawarma.jpg',
        category: 'ساندويتشات',
        available: true,
      },
      {
        shopId: shop.id,
        name: 'برجر لحم أنغوس',
        description: 'قطعة لحم أنغوس مشوية مع جبنة شيدر وخس وطماطم',
        price: 28.0,
        imageUrl: 'https://example.com/images/burger.jpg',
        category: 'برجر',
        available: true,
      },
      {
        shopId: shop.id,
        name: 'بيتزا مارجريتا (وسط)',
        description: 'عجينة طازجة مع صلصة طماطم وجبنة موزاريلا وريحان',
        price: 35.0,
        imageUrl: 'https://example.com/images/pizza.jpg',
        category: 'بيتزا',
        available: true,
      },
      {
        shopId: shop.id,
        name: 'بطاطس مقلية',
        description: 'بطاطس مقرمشة مع رشّة ملح',
        price: 9.0,
        imageUrl: 'https://example.com/images/fries.jpg',
        category: 'مقبلات',
        available: true,
      },
      {
        shopId: shop.id,
        name: 'كولا (علبة)',
        description: 'مشروب غازي بارد 330 مل',
        price: 4.0,
        imageUrl: 'https://example.com/images/cola.jpg',
        category: 'مشروبات',
        available: true,
      },
    ],
  });

  console.log('Demo menu items inserted.');
  console.log('Seeding finished successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
