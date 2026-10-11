import type { FastifyInstance } from 'fastify';
import { eq, and, desc, sql, ilike } from 'drizzle-orm';
import { db } from '../db/client.js';
import { suppliers, bills, parts, purchaseHistory } from '../db/schema.js';
import { authenticate } from '../lib/middleware.js';
import { SupplierSchema } from '../lib/schemas.js';

export async function suppliersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // GET /suppliers — list suppliers with bill count and total spent
  app.get('/suppliers', async (request, reply) => {
    const { shopId } = request;
    const query = request.query as { limit?: string; offset?: string; q?: string };
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
    const offset = parseInt(query.offset ?? '0', 10);
    const search = query.q?.trim();

    const conditions = [eq(suppliers.shopId, shopId)];
    if (search) {
      conditions.push(ilike(suppliers.name, `%${search}%`));
    }

    const supplierList = await db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        gstin: suppliers.gstin,
        address: suppliers.address,
        phone: suppliers.phone,
        createdAt: suppliers.createdAt,
        updatedAt: suppliers.updatedAt,
      })
      .from(suppliers)
      .where(and(...conditions))
      .orderBy(suppliers.name)
      .limit(limit)
      .offset(offset);

    // Enrich with bill counts
    const enriched = await Promise.all(
      supplierList.map(async (sup) => {
        const [billStats] = await db
          .select({
            billCount: sql<number>`count(${bills.id})::int`,
            lastBillDate: sql<string>`max(${bills.invoiceDate})`,
          })
          .from(bills)
          .where(and(eq(bills.shopId, shopId), eq(bills.supplierId, sup.id)));

        return {
          ...sup,
          billCount: billStats?.billCount ?? 0,
          lastPurchaseDate: billStats?.lastBillDate ?? null,
        };
      }),
    );

    return reply.send({ data: enriched });
  });

  // GET /suppliers/:id — supplier detail with recent bills and parts supplied
  app.get('/suppliers/:id', async (request, reply) => {
    const { shopId } = request;
    const { id } = request.params as { id: string };

    const [supplier] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.shopId, shopId)))
      .limit(1);

    if (!supplier) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Supplier not found.' } });
    }

    // Recent bills from this supplier
    const recentBills = await db
      .select()
      .from(bills)
      .where(and(eq(bills.shopId, shopId), eq(bills.supplierId, id)))
      .orderBy(desc(bills.invoiceDate))
      .limit(10);

    // Distinct parts purchased from this supplier
    const suppliedParts = await db
      .selectDistinct({
        partId: purchaseHistory.partId,
        partName: parts.name,
        partNumber: parts.partNumber,
        latestRatePaise: parts.latestRatePaise,
        lastPurchasedDate: sql<string>`max(${purchaseHistory.invoiceDate})`,
      })
      .from(purchaseHistory)
      .innerJoin(parts, eq(purchaseHistory.partId, parts.id))
      .where(and(eq(purchaseHistory.shopId, shopId), eq(purchaseHistory.supplierId, id)))
      .groupBy(purchaseHistory.partId, parts.name, parts.partNumber, parts.latestRatePaise)
      .limit(20);

    return reply.send({
      data: {
        ...supplier,
        bills: recentBills,
        parts: suppliedParts,
      },
    });
  });

  // POST /suppliers — create supplier
  app.post('/suppliers', async (request, reply) => {
    const { shopId } = request;
    const body = SupplierSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: body.error.message } });
    }

    const [created] = await db
      .insert(suppliers)
      .values({
        shopId,
        name: body.data.name.trim(),
        gstin: body.data.gstin.trim(),
        address: body.data.address.trim(),
        phone: body.data.phone.trim(),
      })
      .returning();

    return reply.code(201).send({ data: created });
  });

  // PUT /suppliers/:id — update supplier
  app.put('/suppliers/:id', async (request, reply) => {
    const { shopId } = request;
    const { id } = request.params as { id: string };
    const body = SupplierSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: body.error.message } });
    }

    const [existing] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.shopId, shopId)))
      .limit(1);

    if (!existing) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Supplier not found.' } });
    }

    const [updated] = await db
      .update(suppliers)
      .set({
        name: body.data.name.trim(),
        gstin: body.data.gstin.trim(),
        address: body.data.address.trim(),
        phone: body.data.phone.trim(),
        updatedAt: new Date(),
      })
      .where(eq(suppliers.id, id))
      .returning();

    return reply.send({ data: updated });
  });
}
