/*
 * src/auth.ts — Authentication & session management
 *
 * Zero-dependency auth stack:
 *   1. Passwords are hashed with Node's built-in scrypt (salt:hex_digest).
 *   2. Sessions are stateless HMAC-SHA256 signed cookies (7-day TTL).
 *   3. Login rate-limiting: 10 failures per IP per 15-minute window.
 *   4. On first boot the admin account is auto-created from .env values
 *      (only if app_users is empty).
 */

import crypto from 'crypto';
import { supaGet, supaPost, type DbUser } from './db';

// ── Password hashing ────────────────────────────────────────

/** Random 16-byte hex salt. */
function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Derive a scrypt hash from a plaintext password.
 * Returns `salt:hex_digest`.
 */
function deriveHash(password: string, salt?: string): string {
  const s = salt ?? generateSalt();
  const hash = crypto.scryptSync(password, s, 64).toString('hex');
  return `${s}:${hash}`;
}

/**
 * Constant-time comparison to prevent timing attacks.
 * Returns true when the plaintext matches the stored `salt:hash`.
 */
export function verifyPassword(plaintext: string, stored: string): boolean {
  const [salt, expectedHash] = stored.split(':');
  const actualHash = crypto.scryptSync(plaintext, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

// ── Session signing ─────────────────────────────────────────

const SESSION_SECRET = process.env.SESSION_SECRET!;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SessionPayload {
  userId: number;
  expiresAt: number;
}

/**
 * Create a signed session cookie value.
 * Format: base64url(payload).base64url(hmac).
 */
export function signSession(userId: number): string {
  const payload: SessionPayload = {
    userId,
    expiresAt: Date.now() + SESSION_MAX_AGE_MS,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

/**
 * Verify and decode a signed session cookie.
 * Returns the payload on success, null if invalid or expired.
 */
export function verifySession(cookie: string | undefined): SessionPayload | null {
  if (!cookie) return null;
  try {
    const [data, sig] = cookie.split('.');
    if (!data || !sig) return null;

    const expected = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(data)
      .digest('base64url');

    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }

    const payload: SessionPayload = JSON.parse(
      Buffer.from(data, 'base64url').toString(),
    );

    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Login rate-limiting ─────────────────────────────────────

interface RateEntry {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateEntry>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 10;

/**
 * Returns true if the IP has exceeded the login failure limit.
 * Automatically resets after the window expires.
 */
export function isRateLimited(ip: string): boolean {
  const entry = rateLimitMap.get(ip);
  if (!entry || Date.now() - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: Date.now() });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// ── Bootstrap admin ─────────────────────────────────────────

/**
 * On first run, create the admin user from .env if the table is empty.
 * Safe to call on every server start — idempotent.
 */
export async function bootstrapAdmin(): Promise<void> {
  const users = await supaGet<DbUser>('app_users', { select: 'id', limit: '1' });
  if (users.length > 0) return;

  const username = process.env.ADMIN_USERNAME ?? 'admin';
  const password = process.env.ADMIN_PASSWORD ?? 'admin123';
  const hash = deriveHash(password);

  await supaPost('app_users', {
    username,
    password_hash: hash,
    role: 'admin',
    allowed_room_ids: [],
  });

  console.log(`[auth] Bootstrap admin created: ${username}`);
}

// ── Password hash export (used by routes to create new users) ──

export { deriveHash };
