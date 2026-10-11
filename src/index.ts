// Load environment variables from .env if running standalone via tsx/node
try {
  (process as any).loadEnvFile?.();
} catch {}

import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';

import { authRoutes } from './routes/auth.js';
import { billsRoutes } from './routes/bills.js';
import { partsRoutes } from './routes/parts.js';
import { suppliersRoutes } from './routes/suppliers.js';
import { searchRoutes } from './routes/search.js';
import { extractionRoutes } from './routes/extraction.js';
import { syncRoutes } from './routes/sync.js';
import { exportRoutes } from './routes/export.js';

export async function buildApp() {
  const app = fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' },
    bodyLimit: 15 * 1024 * 1024, // 15MB global limit
  });

  // Security Headers
  await app.register(helmet, {
    contentSecurityPolicy: false, // API server
  });

  // CORS
  await app.register(cors, {
    origin: process.env.NODE_ENV === 'development'
      ? true
      : (process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Rate Limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // File upload support
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
      files: 1,
    },
  });

  // Global Error Handler (Never leak stack traces, consistent { error: { code, message } })
  app.setErrorHandler((error: any, request, reply) => {
    request.log.error(error);

    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;

    const code = (error as any).code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');
    const message = statusCode === 500 ? 'An unexpected server error occurred.' : error.message;

    return reply.status(statusCode).send({
      error: {
        code,
        message,
      },
    });
  });

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Register API Routes
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(billsRoutes, { prefix: '/api' });
  await app.register(partsRoutes, { prefix: '/api' });
  await app.register(suppliersRoutes, { prefix: '/api' });
  await app.register(searchRoutes, { prefix: '/api' });
  await app.register(extractionRoutes, { prefix: '/api' });
  await app.register(syncRoutes, { prefix: '/api' });
  await app.register(exportRoutes, { prefix: '/api' });
 
  return app;
}

// Start standalone server when run directly
if (process.env.NODE_ENV !== 'test') {
  const start = async () => {
    const app = await buildApp();
    const port = parseInt(process.env.PORT ?? '3001', 10);
    const host = process.env.HOST ?? '0.0.0.0';

    try {
      await app.listen({ port, host });
      console.log(`SpareTrack backend running on http://${host}:${port}`);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  };

  start();
}
