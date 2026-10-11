import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../lib/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    shopId: string;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header.' } });
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    request.userId = payload.sub;
    request.shopId = payload.shopId;
  } catch {
    return reply.code(401).send({ error: { code: 'TOKEN_EXPIRED', message: 'Access token expired or invalid. Please refresh.' } });
  }
}
