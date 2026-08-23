import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { supaGet, supaPost } from './db';

const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  console.error('Missing SESSION_SECRET in environment variables');
  process.exit(1);
}

export interface AppUser {
  id: number;
  username: string;
  role: 'admin' | 'editor' | 'viewer';
  allowed_room_ids: number[];
}

export function publicUser(user: AppUser) {
  return { id: user.id, username: user.username, role: user.role, allowed_room_ids: user.allowed_room_ids };
}

// ========== PASSWORDS ==========

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// ========== SESSION TOKENS (HMAC-signed, stateless) ==========

function sign(data: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET!).update(data).digest('base64url');
}

export function createSessionToken(userId: number): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readSessionToken(token: string): number | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.uid !== 'number' || typeof data.exp !== 'number') return null;
    if (Date.now() > data.exp) return null;
    return data.uid;
  } catch {
    return null;
  }
}

const COOKIE_NAME = 'session';

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

export function setSessionCookie(res: Response, userId: number): void {
  const token = createSessionToken(userId);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`);
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AppUser;
    }
  }
}

export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.user = undefined;
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) {
    const uid = readSessionToken(token);
    if (uid !== null) {
      try {
        const rows = await supaGet('app_users', `id=eq.${uid}&select=id,username,role,allowed_room_ids`);
        if (rows.length) req.user = rows[0] as AppUser;
      } catch {
        req.user = undefined;
      }
    }
  }
  next();
}

// ========== LOGIN RATE LIMITING ==========

const failures = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

export function loginRateLimited(key: string): boolean {
  const rec = failures.get(key);
  return !!rec && Date.now() < rec.resetAt && rec.count >= MAX_ATTEMPTS;
}

export function recordLoginFailure(key: string): void {
  const rec = failures.get(key);
  if (!rec || Date.now() > rec.resetAt) failures.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else rec.count++;
}

export function clearLoginFailures(key: string): void {
  failures.delete(key);
}

// ========== FIRST ADMIN BOOTSTRAP ==========

let bootstrapped = false;

export async function ensureBootstrapAdmin(): Promise<void> {
  if (bootstrapped) return;
  const existing = await supaGet('app_users', 'select=id&limit=1');
  if (!existing.length) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    await supaPost('app_users', { username, password_hash: hashPassword(password), role: 'admin' });
    console.log(`Created initial admin account "${username}" - change its password from the Users page`);
  }
  bootstrapped = true;
}
