try {
  (process as any).loadEnvFile?.();
} catch {}

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

const connStr = process.env.DATABASE_URL;
const poolConfig: pg.PoolConfig = {
  connectionString: connStr,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

// Guard against SCRAM auth crash if password was not set in connection string
if (connStr) {
  try {
    const parsed = new URL(connStr);
    if (!parsed.password) {
      poolConfig.password = process.env.PGPASSWORD ?? '';
    }
  } catch {
    poolConfig.password = process.env.PGPASSWORD ?? '';
  }
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export const db = drizzle(pool, { schema, logger: process.env.NODE_ENV === 'development' });

export type DB = typeof db;
