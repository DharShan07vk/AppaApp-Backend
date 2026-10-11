import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signAccessToken, verifyAccessToken } from '../lib/auth.js';

describe('Auth Utilities (Argon2 & JWT)', () => {
  it('hashes password with Argon2 and verifies successfully', async () => {
    const password = 'CorrectHorseBatteryStaple123!';
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(password);
    expect(hash).toMatch(/^\$argon2id\$/);

    const isValid = await verifyPassword(hash, password);
    expect(isValid).toBe(true);

    const isInvalid = await verifyPassword(hash, 'WrongPassword!');
    expect(isInvalid).toBe(false);
  });

  it('signs and verifies JWT access token with payload', () => {
    const payload = {
      sub: '11111111-1111-1111-1111-111111111111',
      shopId: '22222222-2222-2222-2222-222222222222',
    };

    const token = signAccessToken(payload);
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');

    const decoded = verifyAccessToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.sub).toBe(payload.sub);
    expect(decoded?.shopId).toBe(payload.shopId);
  });

  it('rejects tampered or malformed JWT token', () => {
    const invalidToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.tamperedSignature';
    expect(() => verifyAccessToken(invalidToken)).toThrow();
  });
});
