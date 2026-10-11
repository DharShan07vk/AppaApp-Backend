import type { FastifyInstance } from 'fastify';
import { eq, and, isNull, desc, ilike, or, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/client.js';
import { bills, billItems, parts, suppliers, purchaseHistory, shops } from '../db/schema.js';
import { authenticate } from '../lib/middleware.js';
import { CreateBillSchema, UpdateBillSchema } from '../lib/schemas.js';
import { calculateLine, calculateBillTotals, isInterState as checkInterState } from '../lib/money.js';

export async function billsRoutes(app: FastifyInstance) {
  // All bills routes require authentication
  app.addHook('preHandler', authenticate);

  // GET /bills — list bills (shopId scoped, paginated)
  app.get('/bills', async (request, reply) => {
    const { shopId } = request;
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit ?? '20', 10), 100);
    const offset = parseInt(query.offset ?? '0', 10);

    const rows = await db
      .select()
      .from(bills)
      .where(and(eq(bills.shopId, shopId), isNull(bills.archivedAt)))
      .orderBy(desc(bills.invoiceDate), desc(bills.createdAt))
      .limit(limit)
      .offset(offset);

    return reply.send({ data: rows });
  });

  // POST /bills — save bill (transaction: bill + items + part upsert + purchase_history)
  app.post('/bills', async (request, reply) => {
    const { shopId, userId } = request;

    const body = CreateBillSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: body.error.message } });
    }
    const input = body.data;

    // Idempotency check
    const [existing] = await db
      .select({ id: bills.id })
      .from(bills)
      .where(and(eq(bills.shopId, shopId), eq(bills.syncClientId, input.syncClientId)))
      .limit(1);
    if (existing) {
      // Already saved — return the existing bill
      const [bill] = await db.select().from(bills).where(eq(bills.id, existing.id)).limit(1);
      const items = await db.select().from(billItems).where(eq(billItems.billId, existing.id));
      return reply.send({ data: { ...bill, items } });
    }

    // Determine inter-state for CGST/SGST vs IGST
    const [shop] = await db.select({ state: shops.state }).from(shops).where(eq(shops.id, shopId)).limit(1);
    const interState = checkInterState(input.supplierGstin, shop?.state);

    // Calculate all line totals server-side (never trust client)
    const lineCalcs = input.items.map((item) =>
      calculateLine({
        quantity: item.quantity,
        ratePaise: item.ratePaise,
        discountBps: item.discountBps,
        gstBps: item.gstBps,
        isInterState: interState,
      }),
    );
    const totals = calculateBillTotals(lineCalcs);

    const result = await db.transaction(async (tx) => {
      // 1. Upsert supplier
      let supplierId = input.supplierId ?? null;
      if (!supplierId && input.supplierName) {
        const [existingSupplier] = await tx
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(and(eq(suppliers.shopId, shopId), ilike(suppliers.name, input.supplierName.trim())))
          .limit(1);
        if (existingSupplier) {
          supplierId = existingSupplier.id;
        } else {
          const [newSupplier] = await tx.insert(suppliers).values({
            shopId,
            name: input.supplierName.trim(),
            gstin: input.supplierGstin,
            address: input.supplierAddress,
          }).returning({ id: suppliers.id });
          supplierId = newSupplier.id;
        }
      }

      // 2. Insert bill
      const [bill] = await tx.insert(bills).values({
        shopId,
        supplierId,
        supplierName: input.supplierName,
        supplierGstin: input.supplierGstin,
        supplierAddress: input.supplierAddress,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate,
        placeOfSupply: input.placeOfSupply,
        paymentTerms: input.paymentTerms,
        taxableTotalPaise: totals.taxableTotalPaise,
        cgstTotalPaise: totals.cgstTotalPaise,
        sgstTotalPaise: totals.sgstTotalPaise,
        igstTotalPaise: totals.igstTotalPaise,
        roundOffPaise: totals.roundOffPaise,
        grandTotalPaise: totals.grandTotalPaise,
        syncClientId: input.syncClientId,
        createdBy: userId,
      }).returning();

      // 3. Upsert parts + insert bill items + purchase history
      const insertedItems = [];
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        const calc = lineCalcs[i];

        // Match part by part number > HSN+name > name
        let partId = item.partId ?? null;
        if (!partId) {
          const normalized = (item.partNumber || item.hsn || item.name).toLowerCase().replace(/[\s\/\-]+/g, '');
          const [existingPart] = await tx
            .select({ id: parts.id })
            .from(parts)
            .where(and(
              eq(parts.shopId, shopId),
              or(
                item.partNumber ? ilike(parts.partNumber, item.partNumber) : sql`false`,
                ilike(parts.name, item.name),
              ),
            ))
            .limit(1);

          if (existingPart) {
            partId = existingPart.id;
            // Update latest rate if this is newer
            await tx.update(parts).set({
              latestRatePaise: item.ratePaise,
              latestPurchaseDate: input.invoiceDate,
              latestSupplierId: supplierId,
              ...(item.partNumber ? { partNumber: item.partNumber } : {}),
              ...(item.hsn ? { hsn: item.hsn } : {}),
              updatedAt: new Date(),
            }).where(and(
              eq(parts.id, partId),
              // Only update if newer
              sql`${parts.latestPurchaseDate} <= ${input.invoiceDate}`,
            ));
          } else {
            const [newPart] = await tx.insert(parts).values({
              shopId,
              name: item.name.toUpperCase().trim(),
              partNumber: item.partNumber,
              hsn: item.hsn,
              latestRatePaise: item.ratePaise,
              latestPurchaseDate: input.invoiceDate,
              latestSupplierId: supplierId,
            }).returning({ id: parts.id });
            partId = newPart.id;
          }
        }

        const [billItem] = await tx.insert(billItems).values({
          billId: bill.id,
          shopId,
          partId,
          name: item.name.toUpperCase().trim(),
          partNumber: item.partNumber,
          hsn: item.hsn,
          quantity: Math.round(item.quantity),
          ratePaise: item.ratePaise,
          discountBps: item.discountBps,
          gstBps: item.gstBps,
          taxablePaise: calc.taxablePaise,
          cgstPaise: calc.cgstPaise,
          sgstPaise: calc.sgstPaise,
          igstPaise: calc.igstPaise,
          lineTotalPaise: calc.lineTotalPaise,
        }).returning();

        if (partId) {
          await tx.insert(purchaseHistory).values({
            shopId,
            partId,
            billId: bill.id,
            billItemId: billItem.id,
            supplierId,
            supplierName: input.supplierName,
            ratePaise: item.ratePaise,
            invoiceDate: input.invoiceDate,
            invoiceNumber: input.invoiceNumber,
          });
        }

        insertedItems.push(billItem);
      }

      return { bill, items: insertedItems };
    });

    return reply.code(201).send({ data: result });
  });

  // GET /bills/:id — bill detail
  app.get('/bills/:id', async (request, reply) => {
    const { shopId } = request;
    const { id } = request.params as { id: string };

    const [bill] = await db.select().from(bills).where(and(eq(bills.id, id), eq(bills.shopId, shopId))).limit(1);
    if (!bill) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bill not found.' } });

    const items = await db.select().from(billItems).where(eq(billItems.billId, id));

    return reply.send({ data: { ...bill, items } });
  });

  // DELETE /bills/:id — archive (soft delete)
  app.delete('/bills/:id', async (request, reply) => {
    const { shopId } = request;
    const { id } = request.params as { id: string };
    const body = request.body as { confirm?: boolean };

    if (!body?.confirm) {
      return reply.code(400).send({ error: { code: 'CONFIRMATION_REQUIRED', message: 'Send { "confirm": true } to archive this bill.' } });
    }

    const [bill] = await db.select({ id: bills.id }).from(bills).where(and(eq(bills.id, id), eq(bills.shopId, shopId))).limit(1);
    if (!bill) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bill not found.' } });

    await db.transaction(async (tx) => {
      await tx.update(bills).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(bills.id, id));

      // Recompute latest rates for affected parts from remaining non-archived bills
      const affectedItems = await tx.select({ partId: billItems.partId }).from(billItems).where(eq(billItems.billId, id));
      for (const item of affectedItems) {
        if (!item.partId) continue;
        const [latestHistory] = await tx
          .select({
            ratePaise: purchaseHistory.ratePaise,
            invoiceDate: purchaseHistory.invoiceDate,
            supplierId: purchaseHistory.supplierId,
          })
          .from(purchaseHistory)
          .innerJoin(bills, eq(purchaseHistory.billId, bills.id))
          .where(and(
            eq(purchaseHistory.partId, item.partId),
            eq(purchaseHistory.shopId, shopId),
            isNull(bills.archivedAt),
          ))
          .orderBy(desc(purchaseHistory.invoiceDate), desc(purchaseHistory.createdAt))
          .limit(1);

        if (latestHistory) {
          await tx.update(parts).set({
            latestRatePaise: latestHistory.ratePaise,
            latestPurchaseDate: latestHistory.invoiceDate,
            latestSupplierId: latestHistory.supplierId,
            updatedAt: new Date(),
          }).where(eq(parts.id, item.partId));
        }
      }
    });

    return reply.code(204).send();
  });
}
