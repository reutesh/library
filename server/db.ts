/*
 * server/db.ts — Supabase REST (PostgREST) helpers
 *
 * Thin wrappers around the Supabase REST API so the rest of the app
 * never talks to PostgREST directly. Every function reads the
 * SUPABASE_URL and SUPABASE_KEY env vars and throws descriptive
 * errors when requests fail.
 *
 * Also defines the DB row types, the API response types and the
 * row → response mappers used by the routes.
 */

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

export interface DbLoan {
  id: number;
  book_id: number;
  borrower_name: string;
  lent_by: number | null;
  returned_by: number | null;
  lent_at: string;
  returned_at: string | null;
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
  onLoan: boolean;
  borrowerName: string | null;
}

export interface UserResponse {
  id: number;
  username: string;
  role: 'admin' | 'editor' | 'viewer';
  allowedRoomIds: number[];
}

export interface LoanResponse {
  id: number;
  bookId: number;
  borrowerName: string;
  lentBy: number | null;
  lentByName: string | null;
  returnedBy: number | null;
  returnedByName: string | null;
  lentAt: string;
  returnedAt: string | null;
}

// ── Row → API mappers ───────────────────────────────────────

/** Maps a raw `rooms` row. */
export function toRoom(row: DbRoom, bookCount = 0): RoomResponse {
  return { id: row.id, name: row.name, bookCount };
}

/** Maps a raw `app_users` row (never exposes the password hash). */
export function toUser(row: DbUser): UserResponse {
  return { id: row.id, username: row.username, role: row.role, allowedRoomIds: row.allowed_room_ids };
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
  onLoan = false,
  borrowerName: string | null = null,
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
    onLoan,
    borrowerName,
  };
}

/** Maps a raw `loans` row. Pass user names when available. */
export function toLoan(
  row: DbLoan,
  lentByName: string | null = null,
  returnedByName: string | null = null,
): LoanResponse {
  return {
    id: row.id,
    bookId: row.book_id,
    borrowerName: row.borrower_name,
    lentBy: row.lent_by,
    lentByName,
    returnedBy: row.returned_by,
    returnedByName,
    lentAt: row.lent_at,
    returnedAt: row.returned_at,
  };
}

// ── Generic Supabase REST helpers ───────────────────────────

function tableUrl(table: string, params: Record<string, string> = {}): string {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set('select', '*');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** Throws a descriptive error when a Supabase response is not 2xx. */
async function ensureOk(res: Response, what: string): Promise<void> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
}

/** GET rows from a table with optional PostgREST query-string params. */
export async function supaGet<T = any>(
  table: string,
  params?: Record<string, string>,
): Promise<T[]> {
  const res = await fetch(tableUrl(table, params), { headers: supaHeaders(), cache: 'no-store' });
  await ensureOk(res, `GET ${table}`);
  return res.json() as Promise<T[]>;
}

/**
 * GET rows plus the total number of matching rows (ignoring limit/offset),
 * read from the `content-range` header that `Prefer: count=exact` adds.
 */
export async function supaGetWithCount<T = any>(
  table: string,
  params?: Record<string, string>,
): Promise<{ rows: T[]; total: number }> {
  const res = await fetch(tableUrl(table, params), {
    headers: supaHeaders({ Prefer: 'count=exact' }),
    cache: 'no-store',
  });
  await ensureOk(res, `GET ${table} (count)`);
  const rows = (await res.json()) as T[];
  const total = Number(res.headers.get('content-range')?.split('/')[1]);
  return { rows, total: Number.isFinite(total) ? total : rows.length };
}

/** Counts matching rows without transferring them. */
export async function supaCount(table: string, params?: Record<string, string>): Promise<number> {
  const { total } = await supaGetWithCount(table, { ...params, select: 'id', limit: '1' });
  return total;
}

/** POST a single row into a table. Returns the inserted row(s). */
export async function supaPost<T = any>(
  table: string,
  data: Record<string, unknown>,
): Promise<T[]> {
  const res = await fetch(tableUrl(table), {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify(data),
  });
  await ensureOk(res, `POST ${table}`);
  return res.json() as Promise<T[]>;
}

/** PATCH the row with the given id. Returns the updated row(s). */
export async function supaUpdate<T = any>(
  table: string,
  id: number,
  data: Record<string, unknown>,
): Promise<T[]> {
  const res = await fetch(tableUrl(table, { id: `eq.${id}` }), {
    method: 'PATCH',
    headers: supaHeaders(),
    body: JSON.stringify(data),
  });
  await ensureOk(res, `PATCH ${table}`);
  return res.json() as Promise<T[]>;
}

/** DELETE the row with the given id. */
export async function supaDelete(table: string, id: number): Promise<void> {
  const res = await fetch(tableUrl(table, { id: `eq.${id}` }), {
    method: 'DELETE',
    headers: supaHeaders({ Prefer: 'return=minimal' }),
  });
  await ensureOk(res, `DELETE ${table}`);
}
