import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bills, billItems, parts, suppliers, purchaseHistory, shops } from '../db/schema.js';
import { authenticate } from '../lib/middleware.js';

export async function exportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // GET /export/data — export all shop data as JSON for backup
  app.get(
    '/export/data',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request;

      const [shop] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
      const allSuppliers = await db.select().from(suppliers).where(eq(suppliers.shopId, shopId));
      const allParts = await db.select().from(parts).where(eq(parts.shopId, shopId));
      const allBills = await db.select().from(bills).where(eq(bills.shopId, shopId));
      const allBillItems = await db.select().from(billItems).where(eq(billItems.shopId, shopId));
      const allHistory = await db.select().from(purchaseHistory).where(eq(purchaseHistory.shopId, shopId));

      const payload = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        shop: {
          id: shop?.id,
          name: shop?.name,
          ownerName: shop?.ownerName,
          gstin: shop?.gstin,
          state: shop?.state,
        },
        counts: {
          suppliers: allSuppliers.length,
          parts: allParts.length,
          bills: allBills.length,
          billItems: allBillItems.length,
          purchaseHistory: allHistory.length,
        },
        data: {
          suppliers: allSuppliers,
          parts: allParts,
          bills: allBills,
          billItems: allBillItems,
          purchaseHistory: allHistory,
        },
      };

      reply.header('Content-Disposition', `attachment; filename="sparetrack-backup-${new Date().toISOString().split('T')[0]}.json"`);
      return reply.send(payload);
    },
  );
}
