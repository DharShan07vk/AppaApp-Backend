import { pgTable, text, integer, timestamp, uuid, boolean, index, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Enums ─────────────────────────────────────────────────────────────────
export const syncStateEnum = pgEnum('sync_state', ['pending', 'synced', 'failed']);

// ─── shops ─────────────────────────────────────────────────────────────────
export const shops = pgTable('shops', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ownerName: text('owner_name').notNull(),
  gstin: text('gstin').notNull().default(''),
  state: text('state').notNull().default('Tamil Nadu'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── users ─────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── refresh_tokens ────────────────────────────────────────────────────────
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── suppliers ─────────────────────────────────────────────────────────────
export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  gstin: text('gstin').notNull().default(''),
  address: text('address').notNull().default(''),
  phone: text('phone').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t: any) => [
  index('idx_suppliers_shop').on(t.shopId),
]);

// ─── parts ─────────────────────────────────────────────────────────────────
export const parts = pgTable('parts', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  partNumber: text('part_number').notNull().default(''),
  hsn: text('hsn').notNull().default(''),
  // Latest purchase snapshot (updated on every bill save/delete)
  latestRatePaise: integer('latest_rate_paise').notNull().default(0),
  latestPurchaseDate: text('latest_purchase_date').notNull().default(''),  // YYYY-MM-DD
  latestSupplierId: uuid('latest_supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t: any) => [
  index('idx_parts_shop').on(t.shopId),
  index('idx_parts_part_number').on(t.shopId, t.partNumber),
  index('idx_parts_hsn').on(t.shopId, t.hsn),
]);

// ─── bills ─────────────────────────────────────────────────────────────────
export const bills = pgTable('bills', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  // Denormalized for display (stable even if supplier is deleted)
  supplierName: text('supplier_name').notNull(),
  supplierGstin: text('supplier_gstin').notNull().default(''),
  supplierAddress: text('supplier_address').notNull().default(''),
  invoiceNumber: text('invoice_number').notNull(),
  invoiceDate: text('invoice_date').notNull(),  // YYYY-MM-DD
  placeOfSupply: text('place_of_supply').notNull().default('Tamil Nadu'),
  paymentTerms: text('payment_terms').notNull().default('Credit'),
  // All money in paise (integer)
  taxableTotalPaise: integer('taxable_total_paise').notNull().default(0),
  cgstTotalPaise: integer('cgst_total_paise').notNull().default(0),
  sgstTotalPaise: integer('sgst_total_paise').notNull().default(0),
  igstTotalPaise: integer('igst_total_paise').notNull().default(0),
  roundOffPaise: integer('round_off_paise').notNull().default(0),
  grandTotalPaise: integer('grand_total_paise').notNull().default(0),
  imageKey: text('image_key'),        // S3 / storage key
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  syncClientId: text('sync_client_id').notNull().unique(),  // idempotency key
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t: any) => [
  index('idx_bills_shop_date').on(t.shopId, t.invoiceDate),
  index('idx_bills_invoice_number').on(t.shopId, t.invoiceNumber),
  index('idx_bills_sync_client').on(t.syncClientId),
]);

// ─── bill_items ─────────────────────────────────────────────────────────────
export const billItems = pgTable('bill_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  billId: uuid('bill_id').notNull().references(() => bills.id, { onDelete: 'cascade' }),
  shopId: uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  partId: uuid('part_id').references(() => parts.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  partNumber: text('part_number').notNull().default(''),
  hsn: text('hsn').notNull().default(''),
  quantity: integer('quantity').notNull().default(1),  // stored as ×100 for decimals
  ratePaise: integer('rate_paise').notNull(),
  discountBps: integer('discount_bps').notNull().default(0),
  gstBps: integer('gst_bps').notNull().default(1800),
  taxablePaise: integer('taxable_paise').notNull(),
  cgstPaise: integer('cgst_paise').notNull().default(0),
  sgstPaise: integer('sgst_paise').notNull().default(0),
  igstPaise: integer('igst_paise').notNull().default(0),
  lineTotalPaise: integer('line_total_paise').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t: any) => [
  index('idx_bill_items_bill').on(t.billId),
  index('idx_bill_items_part').on(t.partId),
]);

// ─── purchase_history ──────────────────────────────────────────────────────
export const purchaseHistory = pgTable('purchase_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  partId: uuid('part_id').notNull().references(() => parts.id, { onDelete: 'cascade' }),
  billId: uuid('bill_id').notNull().references(() => bills.id, { onDelete: 'cascade' }),
  billItemId: uuid('bill_item_id').notNull().references(() => billItems.id, { onDelete: 'cascade' }),
  supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  supplierName: text('supplier_name').notNull(),
  ratePaise: integer('rate_paise').notNull(),
  invoiceDate: text('invoice_date').notNull(),
  invoiceNumber: text('invoice_number').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t: any) => [
  index('idx_ph_part_date').on(t.partId, t.invoiceDate),
  index('idx_ph_shop').on(t.shopId),
]);

// ─── Relations ─────────────────────────────────────────────────────────────
export const shopsRelations = relations(shops, ({ many }: any) => ({
  users: many(users),
  suppliers: many(suppliers),
  parts: many(parts),
  bills: many(bills),
}));

export const usersRelations = relations(users, ({ one }: any) => ({
  shop: one(shops, { fields: [users.shopId], references: [shops.id] }),
}));

export const suppliersRelations = relations(suppliers, ({ one, many }: any) => ({
  shop: one(shops, { fields: [suppliers.shopId], references: [shops.id] }),
  bills: many(bills),
}));

export const partsRelations = relations(parts, ({ one, many }: any) => ({
  shop: one(shops, { fields: [parts.shopId], references: [shops.id] }),
  latestSupplier: one(suppliers, { fields: [parts.latestSupplierId], references: [suppliers.id] }),
  history: many(purchaseHistory),
  items: many(billItems),
}));

export const billsRelations = relations(bills, ({ one, many }: any) => ({
  shop: one(shops, { fields: [bills.shopId], references: [shops.id] }),
  supplier: one(suppliers, { fields: [bills.supplierId], references: [suppliers.id] }),
  createdByUser: one(users, { fields: [bills.createdBy], references: [users.id] }),
  items: many(billItems),
}));

export const billItemsRelations = relations(billItems, ({ one }: any) => ({
  bill: one(bills, { fields: [billItems.billId], references: [bills.id] }),
  part: one(parts, { fields: [billItems.partId], references: [parts.id] }),
}));

export const purchaseHistoryRelations = relations(purchaseHistory, ({ one }: any) => ({
  part: one(parts, { fields: [purchaseHistory.partId], references: [parts.id] }),
  bill: one(bills, { fields: [purchaseHistory.billId], references: [bills.id] }),
  supplier: one(suppliers, { fields: [purchaseHistory.supplierId], references: [suppliers.id] }),
}));
