import type { FastifyInstance } from 'fastify';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, shops, refreshTokens } from '../db/schema.js';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from '../lib/auth.js';
import { LoginSchema, RegisterSchema, RefreshSchema } from '../lib/schemas.js';
import { v4 as uuidv4 } from 'uuid';

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/register
  app.post('/auth/register', async (request, reply) => {
    const body = RegisterSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: body.error.message } });
    }

    const { shopName, ownerName, gstin, state, email, password } = body.data;

    // Check email not already taken
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return reply.code(409).send({ error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists.' } });
    }

    const passwordHash = await hashPassword(password);

    // Create shop + user in a transaction
    const result = await db.transaction(async (tx) => {
      const [shop] = await tx.insert(shops).values({
        name: shopName,
        ownerName,
        gstin: gstin ?? '',
        state,
      }).returning();

      const [user] = await tx.insert(users).values({
        shopId: shop.id,
        email,
        passwordHash,
      }).returning({ id: users.id, shopId: users.shopId, email: users.email });

      return { shop, user };
    });

    const accessToken = signAccessToken({ sub: result.user.id, shopId: result.shop.id });
    const { token: refreshToken, hash, expiresAt } = generateRefreshToken();

    await db.insert(refreshTokens).values({
      userId: result.user.id,
      tokenHash: hash,
      expiresAt,
    });

    return reply.code(201).send({
      data: {
        accessToken,
        refreshToken,
        shop: {
          id: result.shop.id,
          name: result.shop.name,
          ownerName: result.shop.ownerName,
          gstin: result.shop.gstin,
          state: result.shop.state,
        },
      },
    });
  });

  // POST /auth/login
  app.post('/auth/login', async (request, reply) => {
    const body = LoginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: body.error.message } });
    }

    const { email, password } = body.data;

    const [user] = await db
      .select({ id: users.id, shopId: users.shopId, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      // Constant-time response to prevent user enumeration
      await hashPassword('dummy-to-prevent-timing-attack');
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
    }

    // Get shop details
    const [shop] = await db.select().from(shops).where(eq(shops.id, user.shopId)).limit(1);

    const accessToken = signAccessToken({ sub: user.id, shopId: user.shopId });
    const { token: refreshToken, hash, expiresAt } = generateRefreshToken();

    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hash,
      expiresAt,
    });

    return reply.send({
      data: {
        accessToken,
        refreshToken,
        shop: {
          id: shop.id,
          name: shop.name,
          ownerName: shop.ownerName,
          gstin: shop.gstin,
          state: shop.state,
        },
      },
    });
  });

  // POST /auth/refresh
  app.post('/auth/refresh', async (request, reply) => {
    const body = RefreshSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: body.error.message } });
    }

    const { refreshToken } = body.data;
    const tokenHash = hashRefreshToken(refreshToken);
    const now = new Date();

    const [existing] = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .limit(1);

    if (!existing || existing.expiresAt < now) {
      return reply.code(401).send({ error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token invalid or expired. Please log in again.' } });
    }

    // Rotate: revoke old, issue new
    await db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(eq(refreshTokens.id, existing.id));

    const [user] = await db
      .select({ id: users.id, shopId: users.shopId })
      .from(users)
      .where(eq(users.id, existing.userId))
      .limit(1);

    if (!user) {
      return reply.code(401).send({ error: { code: 'USER_NOT_FOUND', message: 'Account not found.' } });
    }

    const newAccessToken = signAccessToken({ sub: user.id, shopId: user.shopId });
    const { token: newRefreshToken, hash: newHash, expiresAt } = generateRefreshToken();

    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: newHash,
      expiresAt,
    });

    return reply.send({ data: { accessToken: newAccessToken, refreshToken: newRefreshToken } });
  });

  // POST /auth/logout
  app.post('/auth/logout', async (request, reply) => {
    const body = RefreshSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(204).send(); // best-effort logout
    }

    const tokenHash = hashRefreshToken(body.data.refreshToken);
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));

    return reply.code(204).send();
  });
}
