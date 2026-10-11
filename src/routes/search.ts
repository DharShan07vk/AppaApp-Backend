import type { FastifyInstance } from 'fastify';
import { eq, and, desc, sql, ilike, or, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { parts, bills, suppliers } from '../db/schema.js';
import { authenticate } from '../lib/middleware.js';

/**
 * Normalizes query string for uniform matching (strip special characters, collapse spaces)
 */ 
function normalizeQuery(q: string): string {
  return q.trim().replace(/[\s\/\-_.]+/g, '%');
}

export async function searchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // GET /search?q=... — unified search across parts, bills, suppliers
  app.get('/search', async (request, reply) => {
    const { shopId } = request;
    const query = request.query as { q?: string; limit?: string };
    const rawQuery = (query.q ?? '').trim();
    const limit = Math.min(parseInt(query.limit ?? '5', 10), 20);

    if (!rawQuery) {
      return reply.send({
        data: {
          query: '',
          parts: [],
          bills: [],
          suppliers: [],
          totalCounts: { parts: 0, bills: 0, suppliers: 0 },
        },
      });
    }

    const pattern = `%${normalizeQuery(rawQuery)}%`;
    const simplePattern = `%${rawQuery}%`;

    // 1. Search Parts (matched by name, partNumber, HSN)
    const matchingParts = await db
      .select({
        id: parts.id,
        name: parts.name,
        partNumber: parts.partNumber,
        hsn: parts.hsn,
        latestRatePaise: parts.latestRatePaise,
        latestPurchaseDate: parts.latestPurchaseDate,
        latestSupplierId: parts.latestSupplierId,
      })
      .from(parts)
      .where(
        and(
          eq(parts.shopId, shopId),
          or(
            ilike(parts.name, simplePattern),
            ilike(parts.name, pattern),
            ilike(parts.partNumber, simplePattern),
            ilike(parts.partNumber, pattern),
            ilike(parts.hsn, simplePattern),
          ),
        ),
      )
      .orderBy(desc(parts.latestPurchaseDate), desc(parts.updatedAt))
      .limit(limit);

    // Enrich parts with supplier names
    const partsWithSupplier = await Promise.all(
      matchingParts.map(async (part) => {
        let supplierName: string | null = null;
        if (part.latestSupplierId) {
          const [sup] = await db
            .select({ name: suppliers.name })
            .from(suppliers)
            .where(eq(suppliers.id, part.latestSupplierId))
            .limit(1);
          supplierName = sup?.name ?? null;
        }
        return {
          id: part.id,
          name: part.name,
          partNumber: part.partNumber,
          hsn: part.hsn,
          latestRatePaise: part.latestRatePaise,
          latestPurchaseDate: part.latestPurchaseDate,
          latestSupplierName: supplierName,
        };
      }),
    );

    // 2. Search Bills (matched by invoiceNumber, supplierName)
    const matchingBills = await db
      .select({
        id: bills.id,
        invoiceNumber: bills.invoiceNumber,
        supplierName: bills.supplierName,
        invoiceDate: bills.invoiceDate,
        grandTotalPaise: bills.grandTotalPaise,
      })
      .from(bills)
      .where(
        and(
          eq(bills.shopId, shopId),
          isNull(bills.archivedAt),
          or(
            ilike(bills.invoiceNumber, simplePattern),
            ilike(bills.invoiceNumber, pattern),
            ilike(bills.supplierName, simplePattern),
            ilike(bills.supplierName, pattern),
          ),
        ),
      )
      .orderBy(desc(bills.invoiceDate))
      .limit(limit);

    // 3. Search Suppliers (matched by name, gstin)
    const matchingSuppliers = await db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        gstin: suppliers.gstin,
      })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.shopId, shopId),
          or(
            ilike(suppliers.name, simplePattern),
            ilike(suppliers.name, pattern),
            ilike(suppliers.gstin, simplePattern),
          ),
        ),
      )
      .orderBy(suppliers.name)
      .limit(limit);

    // Enrich suppliers with bill counts
    const suppliersWithCount = await Promise.all(
      matchingSuppliers.map(async (sup) => {
        const [stat] = await db
          .select({ count: sql<number>`count(${bills.id})::int` })
          .from(bills)
          .where(and(eq(bills.shopId, shopId), eq(bills.supplierId, sup.id)));
        return {
          id: sup.id,
          name: sup.name,
          gstin: sup.gstin,
          billCount: stat?.count ?? 0,
        };
      }),
    );

    return reply.send({
      data: {
        query: rawQuery,
        parts: partsWithSupplier,
        bills: matchingBills,
        suppliers: suppliersWithCount,
      },
    });
  });
}
