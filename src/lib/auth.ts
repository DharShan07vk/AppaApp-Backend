import jwt from 'jsonwebtoken';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import crypto from 'crypto';

const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-in-prod';
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-in-prod';
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;

export interface AccessTokenPayload {
  sub: string;   // userId
  shopId: string;
  iat?: number;
  exp?: number;
}

// ─── Password ──────────────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,   // 64 MiB
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

// ─── Access token ──────────────────────────────────────────────────────────
export function signAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_TOKEN_SECRET) as AccessTokenPayload;
}

// ─── Refresh token ─────────────────────────────────────────────────────────
/** Generate a random opaque refresh token and its hash for storage */
export function generateRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = nanoid(64);
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { token, hash, expiresAt };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
