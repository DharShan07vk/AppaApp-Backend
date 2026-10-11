import type { FastifyInstance } from 'fastify';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { parts, purchaseHistory, suppliers, billItems } from '../db/schema.js';
import { authenticate } from '../lib/middleware.js';

export async function partsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // GET /parts — list parts with latest rate
  app.get('/parts', async (request, reply) => {
    const { shopId } = request;
    const query = request.query as { limit?: string; offset?: string; q?: string };
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
    const offset = parseInt(query.offset ?? '0', 10);

    const rows = await db.query.parts.findMany({
      where: eq(parts.shopId, shopId),
      with: { latestSupplier: true } as any,
      orderBy: [desc(parts.latestPurchaseDate), desc(parts.updatedAt)],
      limit,
      offset,
    });

    return reply.send({ data: rows });
  });

  // GET /parts/:id — part detail with purchase history summary
  app.get('/parts/:id', async (request, reply) => {
    const { shopId } = request;
    const { id } = request.params as { id: string };

    const part = await db.query.parts.findFirst({
      where: and(eq(parts.id, id), eq(parts.shopId, shopId)),
      with: {
        latestSupplier: true,
        history: {
          orderBy: [desc(purchaseHistory.invoiceDate)],
          limit: 5,
        },
      },
    });

    if (!part) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Part not found.' } });

    return reply.send({ data: part });
  });

  // GET /parts/:id/history — full purchase history (paginated)
  app.get('/parts/:id/history', async (request, reply) => {
    const { shopId } = request;
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
    const offset = parseInt(query.offset ?? '0', 10);

    const [part] = await db.select({ id: parts.id }).from(parts).where(and(eq(parts.id, id), eq(parts.shopId, shopId))).limit(1);
    if (!part) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Part not found.' } });

    const history = await db
      .select()
      .from(purchaseHistory)
      .where(and(eq(purchaseHistory.partId, id), eq(purchaseHistory.shopId, shopId)))
      .orderBy(desc(purchaseHistory.invoiceDate), desc(purchaseHistory.createdAt))
      .limit(limit)
      .offset(offset);

    return reply.send({ data: history });
  });

  // POST /parts/merge — merge two parts (never auto-merges)
  app.post('/parts/merge', async (request, reply) => {
    const { shopId } = request;
    const body = request.body as { keepId: string; mergeId: string };

    if (!body?.keepId || !body?.mergeId || body.keepId === body.mergeId) {
      return reply.code(400).send({ error: { code: 'INVALID_INPUT', message: 'Provide distinct keepId and mergeId.' } });
    }

    // Verify both parts belong to this shop
    const [keepPart] = await db.select().from(parts).where(and(eq(parts.id, body.keepId), eq(parts.shopId, shopId))).limit(1);
    const [mergePart] = await db.select().from(parts).where(and(eq(parts.id, body.mergeId), eq(parts.shopId, shopId))).limit(1);

    if (!keepPart || !mergePart) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'One or both parts not found.' } });
    }

    await db.transaction(async (tx) => {
      // Reassign purchase history
      await tx.update(purchaseHistory).set({ partId: body.keepId }).where(eq(purchaseHistory.partId, body.mergeId));
      // Reassign bill items
      await tx.update(billItems).set({ partId: body.keepId }).where(eq(billItems.partId, body.mergeId));
      // Delete merged part
      await tx.delete(parts).where(eq(parts.id, body.mergeId));
      // Recompute latest rate for kept part from history
      const [latest] = await tx
        .select({ ratePaise: purchaseHistory.ratePaise, invoiceDate: purchaseHistory.invoiceDate, supplierId: purchaseHistory.supplierId })
        .from(purchaseHistory)
        .where(eq(purchaseHistory.partId, body.keepId))
        .orderBy(desc(purchaseHistory.invoiceDate))
        .limit(1);
      if (latest) {
        await tx.update(parts).set({
          latestRatePaise: latest.ratePaise,
          latestPurchaseDate: latest.invoiceDate,
          latestSupplierId: latest.supplierId,
          updatedAt: new Date(),
        }).where(eq(parts.id, body.keepId));
      }
    });

    return reply.send({ data: { merged: body.mergeId, into: body.keepId } });
  });
}
