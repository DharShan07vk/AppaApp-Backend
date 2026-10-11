import { db } from './db/client.js';
import { shops, users, suppliers, parts, bills, billItems, purchaseHistory } from './db/schema.js';
import { hashPassword } from './lib/auth.js';
import { calculateLine, calculateBillTotals } from './lib/money.js';

async function seed() {
  console.log('Seeding SpareTrack database...');

  // 1. Create Demo Shop
  const [shop] = await db
    .insert(shops)
    .values({
      name: 'Sri Murugan Auto Spares',
      ownerName: 'P. Murugesan',
      gstin: '33AAAAA0000A1Z5',
      state: 'Tamil Nadu',
    })
    .returning();

  console.log(`Created shop: ${shop.name} (${shop.id})`);

  // 2. Create Owner User
  const passwordHash = await hashPassword('SpareTrack@123');
  const [user] = await db
    .insert(users)
    .values({
      shopId: shop.id,
      email: 'owner@sparetrack.local',
      passwordHash,
    })
    .returning();

  console.log(`Created user: ${user.email}`);

  // 3. Create Suppliers
  const [kishindas] = await db
    .insert(suppliers)
    .values({
      shopId: shop.id,
      name: 'Kishindas Auto Parts',
      gstin: '33ABCDE1234F1Z1',
      address: 'G.P. Road, Chennai',
      phone: '9840012345',
    })
    .returning();

  const [lakshmi] = await db
    .insert(suppliers)
    .values({
      shopId: shop.id,
      name: 'Sri Lakshmi Traders',
      gstin: '33AAKCS2087E1Z6',
      address: 'No. 18, Broadway, Chennai',
      phone: '9840054321',
    })
    .returning();

  // 4. Create Parts
  const [engineKit] = await db
    .insert(parts)
    .values({
      shopId: shop.id,
      name: 'XCENT/110 KAPP 1.2L ENGINE KIT',
      partNumber: '21100-04000',
      hsn: '8708',
      latestRatePaise: 354000, // 3540.00
      latestPurchaseDate: '2025-01-15',
      latestSupplierId: kishindas.id,
    })
    .returning();

  const [tataAceKit] = await db
    .insert(parts)
    .values({
      shopId: shop.id,
      name: 'TATA ACE KIT',
      partNumber: '2525-0112',
      hsn: '8708',
      latestRatePaise: 224000, // 2240.00
      latestPurchaseDate: '2025-01-15',
      latestSupplierId: kishindas.id,
    })
    .returning();

  // 5. Create Canonical Bill (Worked Example: 3540 @ 2%, 2240 @ 2%, 18% GST)
  const line1 = calculateLine({
    quantity: 1,
    ratePaise: 354000,
    discountBps: 200,
    gstBps: 1800,
    isInterState: false,
  });

  const line2 = calculateLine({
    quantity: 1,
    ratePaise: 224000,
    discountBps: 200,
    gstBps: 1800,
    isInterState: false,
  });

  const totals = calculateBillTotals([line1, line2]);

  const [bill] = await db
    .insert(bills)
    .values({
      shopId: shop.id,
      supplierId: kishindas.id,
      supplierName: kishindas.name,
      supplierGstin: kishindas.gstin,
      supplierAddress: kishindas.address,
      invoiceNumber: 'CHE/25-2773989',
      invoiceDate: '2025-01-15',
      placeOfSupply: 'Tamil Nadu',
      paymentTerms: 'Credit 30 Days',
      taxableTotalPaise: totals.taxableTotalPaise,
      cgstTotalPaise: totals.cgstTotalPaise,
      sgstTotalPaise: totals.sgstTotalPaise,
      igstTotalPaise: totals.igstTotalPaise,
      roundOffPaise: totals.roundOffPaise,
      grandTotalPaise: totals.grandTotalPaise,
      syncClientId: 'sync-seed-001',
      createdBy: user.id,
    })
    .returning();

  // Insert Bill Items
  const [bi1] = await db
    .insert(billItems)
    .values({
      billId: bill.id,
      shopId: shop.id,
      partId: engineKit.id,
      name: engineKit.name,
      partNumber: engineKit.partNumber,
      hsn: engineKit.hsn,
      quantity: 1,
      ratePaise: 354000,
      discountBps: 200,
      gstBps: 1800,
      taxablePaise: line1.taxablePaise,
      cgstPaise: line1.cgstPaise,
      sgstPaise: line1.sgstPaise,
      igstPaise: line1.igstPaise,
      lineTotalPaise: line1.lineTotalPaise,
    })
    .returning();

  const [bi2] = await db
    .insert(billItems)
    .values({
      billId: bill.id,
      shopId: shop.id,
      partId: tataAceKit.id,
      name: tataAceKit.name,
      partNumber: tataAceKit.partNumber,
      hsn: tataAceKit.hsn,
      quantity: 1,
      ratePaise: 224000,
      discountBps: 200,
      gstBps: 1800,
      taxablePaise: line2.taxablePaise,
      cgstPaise: line2.cgstPaise,
      sgstPaise: line2.sgstPaise,
      igstPaise: line2.igstPaise,
      lineTotalPaise: line2.lineTotalPaise,
    })
    .returning();

  // Insert Purchase History
  await db.insert(purchaseHistory).values([
    {
      shopId: shop.id,
      partId: engineKit.id,
      billId: bill.id,
      billItemId: bi1.id,
      supplierId: kishindas.id,
      supplierName: kishindas.name,
      ratePaise: 354000,
      invoiceDate: bill.invoiceDate,
      invoiceNumber: bill.invoiceNumber,
    },
    {
      shopId: shop.id,
      partId: tataAceKit.id,
      billId: bill.id,
      billItemId: bi2.id,
      supplierId: kishindas.id,
      supplierName: kishindas.name,
      ratePaise: 224000,
      invoiceDate: bill.invoiceDate,
      invoiceNumber: bill.invoiceNumber,
    },
  ]);

  console.log('Seeding completed successfully!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
