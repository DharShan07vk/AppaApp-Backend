import type { FastifyInstance } from 'fastify';
import { eq, and, gt, desc, isNull, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bills, billItems, parts, suppliers, purchaseHistory, shops } from '../db/schema.js';
import { authenticate } from '../lib/middleware.js';
import { calculateLine, calculateBillTotals, isInterState as checkInterState } from '../lib/money.js';

interface SyncItemPayload {
  syncClientId: string;
  operation: 'CREATE_BILL' | 'ARCHIVE_BILL' | 'CREATE_SUPPLIER';
  timestamp: string; // ISO date
  data: any;
}

export async function syncRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // POST /sync/push — batch process offline queue items
  app.post('/sync/push', async (request, reply) => {
    const { shopId, userId } = request;
    const body = request.body as { items: SyncItemPayload[] };

    if (!Array.isArray(body?.items)) {
      return reply.code(400).send({
        error: { code: 'INVALID_PAYLOAD', message: 'Expected items array in sync request.' },
      });
    }

    const results: Array<{
      syncClientId: string;
      status: 'synced' | 'conflict' | 'error';
      serverRecordId?: string;
      message?: string;
      reconciledData?: any;
    }> = [];

    // Fetch shop state for tax calculation
    const [shop] = await db
      .select({ state: shops.state })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);

    for (const item of body.items) {
      try {
        if (item.operation === 'CREATE_BILL') {
          // Idempotency check: see if bill with this syncClientId was already synced
          const [existing] = await db
            .select({ id: bills.id, updatedAt: bills.updatedAt })
            .from(bills)
            .where(and(eq(bills.shopId, shopId), eq(bills.syncClientId, item.syncClientId)))
            .limit(1);

          if (existing) {
            results.push({
              syncClientId: item.syncClientId,
              status: 'synced',
              serverRecordId: existing.id,
            });
            continue;
          }

          const billData = item.data;
          const interState = checkInterState(billData.supplierGstin, shop?.state);

          // Server calculates authoritative totals
          const lineCalcs = (billData.items ?? []).map((line: any) =>
            calculateLine({
              quantity: line.quantity,
              ratePaise: line.ratePaise,
              discountBps: line.discountBps ?? 0,
              gstBps: line.gstBps ?? 1800,
              isInterState: interState,
            }),
          );
          const totals = calculateBillTotals(lineCalcs);

          const created = await db.transaction(async (tx) => {
            // 1. Supplier upsert
            let supplierId = billData.supplierId ?? null;
            if (!supplierId && billData.supplierName) {
              const [existingSupplier] = await tx
                .select({ id: suppliers.id })
                .from(suppliers)
                .where(and(eq(suppliers.shopId, shopId), ilike(suppliers.name, billData.supplierName.trim())))
                .limit(1);

              if (existingSupplier) {
                supplierId = existingSupplier.id;
              } else {
                const [newSupplier] = await tx
                  .insert(suppliers)
                  .values({
                    shopId,
                    name: billData.supplierName.trim(),
                    gstin: billData.supplierGstin ?? '',
                    address: billData.supplierAddress ?? '',
                  })
                  .returning({ id: suppliers.id });
                supplierId = newSupplier.id;
              }
            }

            // 2. Bill insert
            const [newBill] = await tx
              .insert(bills)
              .values({
                shopId,
                supplierId,
                supplierName: billData.supplierName,
                supplierGstin: billData.supplierGstin ?? '',
                supplierAddress: billData.supplierAddress ?? '',
                invoiceNumber: billData.invoiceNumber,
                invoiceDate: billData.invoiceDate,
                placeOfSupply: billData.placeOfSupply ?? 'Tamil Nadu',
                paymentTerms: billData.paymentTerms ?? 'Credit',
                taxableTotalPaise: totals.taxableTotalPaise,
                cgstTotalPaise: totals.cgstTotalPaise,
                sgstTotalPaise: totals.sgstTotalPaise,
                igstTotalPaise: totals.igstTotalPaise,
                roundOffPaise: totals.roundOffPaise,
                grandTotalPaise: totals.grandTotalPaise,
                syncClientId: item.syncClientId,
                createdBy: userId,
              })
              .returning();

            // 3. Bill items, part upserts, and purchase history
            const items = billData.items ?? [];
            for (let i = 0; i < items.length; i++) {
              const line = items[i];
              const calc = lineCalcs[i];

              let partId = line.partId ?? null;
              if (!partId && line.name) {
                const [existingPart] = await tx
                  .select({ id: parts.id })
                  .from(parts)
                  .where(and(
                    eq(parts.shopId, shopId),
                    or(
                      line.partNumber ? ilike(parts.partNumber, line.partNumber) : sql`false`,
                      ilike(parts.name, line.name),
                    ),
                  ))
                  .limit(1);

                if (existingPart) {
                  partId = existingPart.id;
                  await tx.update(parts).set({
                    latestRatePaise: line.ratePaise,
                    latestPurchaseDate: billData.invoiceDate,
                    latestSupplierId: supplierId,
                    ...(line.partNumber ? { partNumber: line.partNumber } : {}),
                    ...(line.hsn ? { hsn: line.hsn } : {}),
                    updatedAt: new Date(),
                  }).where(and(
                    eq(parts.id, partId),
                    sql`${parts.latestPurchaseDate} <= ${billData.invoiceDate}`,
                  ));
                } else {
                  const [newPart] = await tx.insert(parts).values({
                    shopId,
                    name: line.name.toUpperCase().trim(),
                    partNumber: line.partNumber ?? '',
                    hsn: line.hsn ?? '',
                    latestRatePaise: line.ratePaise,
                    latestPurchaseDate: billData.invoiceDate,
                    latestSupplierId: supplierId,
                  }).returning({ id: parts.id });
                  partId = newPart.id;
                }
              }

              const [billItem] = await tx.insert(billItems).values({
                billId: newBill.id,
                shopId,
                partId,
                name: line.name.toUpperCase().trim(),
                partNumber: line.partNumber ?? '',
                hsn: line.hsn ?? '',
                quantity: Math.round(line.quantity ?? 1),
                ratePaise: line.ratePaise,
                discountBps: line.discountBps ?? 0,
                gstBps: line.gstBps ?? 1800,
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
                  billId: newBill.id,
                  billItemId: billItem.id,
                  supplierId,
                  supplierName: billData.supplierName,
                  ratePaise: line.ratePaise,
                  invoiceDate: billData.invoiceDate,
                  invoiceNumber: billData.invoiceNumber,
                });
              }
            }

            return newBill;
          });

          results.push({
            syncClientId: item.syncClientId,
            status: 'synced',
            serverRecordId: created.id,
            reconciledData: {
              taxableTotalPaise: totals.taxableTotalPaise,
              grandTotalPaise: totals.grandTotalPaise,
            },
          });
        } else if (item.operation === 'ARCHIVE_BILL') {
          await db
            .update(bills)
            .set({ archivedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(bills.id, item.data.id), eq(bills.shopId, shopId)));

          results.push({
            syncClientId: item.syncClientId,
            status: 'synced',
          });
        }
      } catch (err: any) {
        request.log.error(err, `Error syncing item ${item.syncClientId}`);
        results.push({
          syncClientId: item.syncClientId,
          status: 'error',
          message: err.message ?? 'Internal error during sync',
        });
      }
    }

    return reply.send({ data: { results } });
  });

  // GET /sync/pull — delta pull for offline client
  app.get('/sync/pull', async (request, reply) => {
    const { shopId } = request;
    const query = request.query as { since?: string };

    const sinceDate = query.since ? new Date(query.since) : new Date(0);

    const rawBills = await db
      .select()
      .from(bills)
      .where(and(eq(bills.shopId, shopId), gt(bills.updatedAt, sinceDate)))
      .orderBy(desc(bills.updatedAt))
      .limit(200);

    const updatedBills = await Promise.all(
      rawBills.map(async (b) => {
        const items = await db.select().from(billItems).where(eq(billItems.billId, b.id));
        return { ...b, items };
      })
    );

    const updatedParts = await db
      .select()
      .from(parts)
      .where(and(eq(parts.shopId, shopId), gt(parts.updatedAt, sinceDate)))
      .orderBy(desc(parts.updatedAt))
      .limit(200);

    const updatedSuppliers = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.shopId, shopId), gt(suppliers.updatedAt, sinceDate)))
      .orderBy(desc(suppliers.updatedAt))
      .limit(200);

    return reply.send({
      data: {
        serverTimestamp: new Date().toISOString(),
        bills: updatedBills,
        parts: updatedParts,
        suppliers: updatedSuppliers,
      },
    });
  });
}
