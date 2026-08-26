/*
 * src/db.ts — Supabase REST (PostgREST) helpers
 *
 * Thin wrappers around the Supabase REST API so the rest of the app
 * never talks to PostgREST directly.  Every function reads the
 * SUPABASE_URL and SUPABASE_KEY env vars at call-time and throws
 * descriptive errors when requests fail.
 *
 * Types are defined here once and re-used across routes and the client.
 */

import { URL } from 'url';

// ── Helpers ─────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;

function supaHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extra,
  };
}

/** Thrown on Supabase REST errors so routes get a 500 + safe message. */
function err(msg: string, cause?: unknown): never {
  const e = new Error(msg);
  (e as any).cause = cause;
  throw e;
}

// ── Database row types ──────────────────────────────────────

export interface DbRoom {
  id: number;
  name: string;
}

export interface DbShelf {
  id: number;
  room_id: number;
  name: string;
}

export interface DbBook {
  id: number;
  title: string;
  author: string | null;
  isbn: string | null;
  genre: string | null;
  notes: string | null;
  shelf_id: number | null;
  status: 'approved' | 'pending';
  created_by: number | null;
  updated_at: string;
}

export interface DbUser {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'editor' | 'viewer';
  allowed_room_ids: number[];
}

// ── API response types (what the client receives) ───────────

export interface RoomResponse {
  id: number;
  name: string;
  bookCount: number;
}

export interface ShelfResponse {
  id: number;
  roomId: number;
  name: string;
  bookCount: number;
}

export interface BookResponse {
  id: number;
  title: string;
  author: string | null;
  isbn: string | null;
  genre: string | null;
  notes: string | null;
  shelfId: number | null;
  shelfName: string | null;
  roomId: number | null;
  roomName: string | null;
  status: 'approved' | 'pending';
  createdBy: number | null;
  updatedAt: string;
}

export interface UserResponse {
  id: number;
  username: string;
  role: 'admin' | 'editor' | 'viewer';
  allowedRoomIds: number[];
}

// ── Row → API mappers ───────────────────────────────────────

/** Maps a raw `rooms` row. */
export function toRoom(row: DbRoom, bookCount = 0): RoomResponse {
  return { id: row.id, name: row.name, bookCount };
}

/** Maps a raw `shelves` row. */
export function toShelf(row: DbShelf, bookCount = 0): ShelfResponse {
  return { id: row.id, roomId: row.room_id, name: row.name, bookCount };
}

/** Maps a raw `books` row.  Pass resolved shelf/room names when available. */
export function toBook(
  row: DbBook,
  shelfName: string | null = null,
  roomId: number | null = null,
  roomName: string | null = null,
): BookResponse {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    isbn: row.isbn,
    genre: row.genre,
    notes: row.notes,
    shelfId: row.shelf_id,
    shelfName,
    roomId,
    roomName,
    status: row.status,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
  };
}

// ── Generic Supabase REST helpers ───────────────────────────

/**
 * GET rows from a table with optional PostgREST query-string params.
 * @returns  parsed JSON array
 */
export async function supaGet<T = any>(
  table: string,
  params?: Record<string, string>,
): Promise<T[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set('select', '*');
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), { headers: supaHeaders() });
  if (!res.ok) {
    const body = await res.text();
    err(`GET ${table} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T[]>;
}

/**
 * GET rows with a PostgREST count header (used for pagination totals).
 * Sets `Prefer: count=exact` so the response includes a `content-range` header.
 * @returns  { rows, total }
 */
export async function supaGetWithCount<T = any>(
  table: string,
  params?: Record<string, string>,
): Promise<{ rows: T[]; total: number }> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set('select', '*');
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: supaHeaders({ Prefer: 'count=exact' }),
  });
  if (!res.ok) {
    const body = await res.text();
    err(`GET ${table} (count) failed: ${res.status} ${body}`);
  }
  const rows = (await res.json()) as T[];
  const range = res.headers.get('content-range') ?? '';
  const total = parseInt(range.split('/')[1] || '0', 10);
  return { rows, total };
}

/**
 * POST a single row into a table.
 * Returns the inserted row(s).
 */
export async function supaPost<T = any>(
  table: string,
  data: Record<string, unknown>,
): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text();
    err(`POST ${table} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T[]>;
}

/**
 * PATCH rows matching a filter.
 * @param filter  PostgREST filter string, e.g. "id.eq.1"
 */
export async function supaUpdate<T = any>(
  table: string,
  filter: string,
  data: Record<string, unknown>,
): Promise<T[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set('id', filter);
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: supaHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text();
    err(`PATCH ${table} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T[]>;
}

/**
 * DELETE rows matching a PostgREST filter.
 * @param filter  e.g. "id.eq.1"
 */
export async function supaDelete(table: string, filter: string): Promise<void> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set('id', filter);
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: supaHeaders({ Prefer: 'return=minimal' }),
  });
  if (!res.ok) {
    const body = await res.text();
    err(`DELETE ${table} failed: ${res.status} ${body}`);
  }
}
