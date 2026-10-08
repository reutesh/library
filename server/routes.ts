/*
 * server/routes.ts — API route definitions
 *
 * Sections (look for the `═══` dividers):
 *   1. Helpers & middleware
 *   2. Auth routes
 *   3. Users (admin CRUD)
 *   4. Rooms CRUD
 *   5. Shelves CRUD
 *   6. Books CRUD (with pending-book workflow)
 *   7. Genre / author / stats endpoints
 *   8. Loans (lending / returning)
 *
 * Permission model:
 *   admin  — full access
 *   editor — allowed only in rooms listed in allowed_room_ids
 *   viewer — read-only (except can create "pending" books)
 *            lending/returning is admin + editor only
 *
 * Express 5 forwards errors thrown by async handlers to the global
 * error handler in index.ts, so handlers don't need their own try/catch.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  supaGet,
  supaGetWithCount,
  supaCount,
  supaPost,
  supaUpdate,
  supaDelete,
  toRoom,
  toShelf,
  toBook,
  toUser,
  toLoan,
  type DbRoom,
  type DbShelf,
  type DbBook,
  type DbUser,
  type DbLoan,
  type BookResponse,
} from './db';
import {
  signSession,
  verifySession,
  verifyPassword,
  isRateLimited,
  recordLoginFailure,
  clearLoginFailures,
  deriveHash,
  SESSION_MAX_AGE_MS,
} from './auth';

export const router = Router();

// ════════════════════════════════════════════════════════════
// 1. Helpers & middleware
// ════════════════════════════════════════════════════════════

declare global {
  namespace Express {
    interface Request {
      /** The logged-in user, set by `requireAuth`. */
      user?: DbUser;
    }
  }
}

const ROLES = ['admin', 'editor', 'viewer'] as const;
const MIN_PASSWORD_LENGTH = 6;

/**
 * Auth middleware — verifies the `session` cookie and loads the user
 * into `req.user`. Responds 401 if the cookie is invalid or the user
 * no longer exists.
 */
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = verifySession(req.cookies.session);
  const rows = session
    ? await supaGet<DbUser>('app_users', { id: `eq.${session.userId}` })
    : [];
  if (rows.length === 0) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  req.user = rows[0];
  next();
}

/** Must run after `requireAuth`. */
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  next();
}

/** Returns the shelf's room_id, or null if the shelf doesn't exist. */
async function getShelfRoomId(shelfId: number | null): Promise<number | null> {
  if (!shelfId) return null;
  const rows = await supaGet<DbShelf>('shelves', { id: `eq.${shelfId}`, select: 'room_id' });
  return rows[0]?.room_id ?? null;
}

/** Admins can edit any room; editors only rooms in their allowed_room_ids. */
function canEditRoomLocation(user: DbUser, roomId: number | null): boolean {
  if (user.role === 'admin') return true;
  if (user.role !== 'editor' || !roomId) return false;
  return user.allowed_room_ids.includes(roomId);
}

/** Approved books are public; pending books only to admins and their creator. */
function canSeeBook(user: DbUser, book: DbBook): boolean {
  return book.status === 'approved' || user.role === 'admin' || book.created_by === user.id;
}

/**
 * Who may edit / delete a book:
 *   - Admins always.
 *   - Anyone, for their own pending books.
 *   - Editors, for books in rooms they have access to.
 */
function canEditBook(user: DbUser, book: DbBook, bookRoomId: number | null): boolean {
  if (user.role === 'admin') return true;
  if (book.status === 'pending' && book.created_by === user.id) return true;
  return user.role === 'editor' && canEditRoomLocation(user, bookRoomId);
}

/** Admins and editors can lend / return books. */
function canLend(user: DbUser): boolean {
  return user.role === 'admin' || user.role === 'editor';
}

/** Loads a book by id, or sends 404 and returns null. */
async function findBookOr404(res: Response, id: number): Promise<DbBook | null> {
  const rows = await supaGet<DbBook>('books', { id: `eq.${id}` });
  if (rows.length === 0) {
    res.status(404).json({ error: 'Book not found' });
    return null;
  }
  return rows[0];
}

/** Returns a book_id → active (not yet returned) loan map for the given books. */
async function getActiveLoanMap(bookIds: number[]): Promise<Map<number, DbLoan>> {
  if (bookIds.length === 0) return new Map();
  const rows = await supaGet<DbLoan>('loans', {
    book_id: `in.(${bookIds.join(',')})`,
    returned_at: 'is.null',
  });
  return new Map(rows.map((loan) => [loan.book_id, loan]));
}

/** Resolves user IDs → usernames (for loan history display). */
async function getUserNameMap(ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await supaGet<DbUser>('app_users', {
    id: `in.(${unique.join(',')})`,
    select: 'id,username',
  });
  return new Map(rows.map((u) => [u.id, u.username]));
}

/** Adds shelf / room names and loan status to raw book rows. */
async function enrichBooks(books: DbBook[]): Promise<BookResponse[]> {
  const shelfIds = [...new Set(books.map((b) => b.shelf_id).filter((id): id is number => id != null))];
  const [shelves, loans] = await Promise.all([
    shelfIds.length > 0
      ? supaGet<DbShelf>('shelves', { id: `in.(${shelfIds.join(',')})` })
      : Promise.resolve([] as DbShelf[]),
    getActiveLoanMap(books.map((b) => b.id)),
  ]);
  const shelfMap = new Map(shelves.map((s) => [s.id, s]));

  const roomIds = [...new Set(shelves.map((s) => s.room_id))];
  const rooms = roomIds.length > 0
    ? await supaGet<DbRoom>('rooms', { id: `in.(${roomIds.join(',')})` })
    : [];
  const roomNames = new Map(rooms.map((r) => [r.id, r.name]));

  return books.map((b) => {
    const shelf = b.shelf_id != null ? shelfMap.get(b.shelf_id) : undefined;
    const loan = loans.get(b.id);
    return toBook(
      b,
      shelf?.name ?? null,
      shelf?.room_id ?? null,
      shelf ? (roomNames.get(shelf.room_id) ?? null) : null,
      !!loan,
      loan?.borrower_name ?? null,
    );
  });
}

/** Strips characters that have meaning inside PostgREST filter syntax. */
function sanitizeSearch(q: string): string {
  return q.replace(/[,()*"\\]/g, ' ').trim();
}

/** Validates the role / password fields shared by user create & update. */
function validateUserFields(body: { role?: unknown; password?: unknown }): string | null {
  if (body.role !== undefined && !ROLES.includes(body.role as DbUser['role'])) {
    return `role must be one of: ${ROLES.join(', ')}`;
  }
  if (body.password !== undefined && String(body.password).length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// 2. Auth routes
// ════════════════════════════════════════════════════════════

/** POST /auth/login — authenticate and set session cookie. */
router.post('/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};
  const ip = req.ip ?? 'unknown';

  // Rate-limit by IP before hitting the database
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many failed login attempts. Try again later.' });
    return;
  }

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const rows = await supaGet<DbUser>('app_users', { username: `eq.${username}` });
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordLoginFailure(ip);
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  clearLoginFailures(ip);
  res.cookie('session', signSession(user.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_MS,
  });
  res.json(toUser(user));
});

/** POST /auth/logout — clear the session cookie. */
router.post('/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

// Every route below requires a logged-in user.
router.use(requireAuth);

/** GET /auth/me — return the currently logged-in user. */
router.get('/auth/me', (req: Request, res: Response) => {
  res.json(toUser(req.user!));
});

/** PUT /auth/me — self-service password change. */
router.put('/auth/me', async (req: Request, res: Response) => {
  const me = req.user!;
  const { current_password, new_password } = req.body ?? {};

  if (!current_password || !new_password) {
    res.status(400).json({ error: 'Both current_password and new_password are required' });
    return;
  }
  const invalid = validateUserFields({ password: new_password });
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  if (!verifyPassword(current_password, me.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  await supaUpdate('app_users', me.id, { password_hash: deriveHash(new_password) });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// 3. Users — admin-only CRUD
// ════════════════════════════════════════════════════════════

/** GET /users — list all users. */
router.get('/users', requireAdmin, async (_req: Request, res: Response) => {
  const rows = await supaGet<DbUser>('app_users', { order: 'username' });
  res.json(rows.map(toUser));
});

/** POST /users — create a user. */
router.post('/users', requireAdmin, async (req: Request, res: Response) => {
  const { username, password, role, allowed_room_ids } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }
  const invalid = validateUserFields({ role, password });
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }

  const rows = await supaPost<DbUser>('app_users', {
    username,
    password_hash: deriveHash(password),
    role: role ?? 'viewer',
    allowed_room_ids: allowed_room_ids ?? [],
  });
  res.status(201).json(toUser(rows[0]));
});

/** PATCH /users/:id — update a user. */
router.patch('/users/:id', requireAdmin, async (req: Request, res: Response) => {
  const { username, password, role, allowed_room_ids } = req.body ?? {};
  const invalid = validateUserFields({ role, password: password || undefined });
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (username) updates.username = username;
  if (password) updates.password_hash = deriveHash(password);
  if (role) updates.role = role;
  if (allowed_room_ids !== undefined) updates.allowed_room_ids = allowed_room_ids;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }

  const rows = await supaUpdate<DbUser>('app_users', Number(req.params.id), updates);
  if (rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(toUser(rows[0]));
});

/** DELETE /users/:id — delete a user (an admin cannot delete themselves). */
router.delete('/users/:id', requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) {
    res.status(400).json({ error: 'You cannot delete your own account' });
    return;
  }
  await supaDelete('app_users', id);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// 4. Rooms CRUD
// ════════════════════════════════════════════════════════════

/** GET /rooms — list rooms with (approved) book counts. */
router.get('/rooms', async (_req: Request, res: Response) => {
  const [rooms, shelves, books] = await Promise.all([
    supaGet<DbRoom>('rooms', { order: 'name' }),
    supaGet<DbShelf>('shelves', { select: 'id,room_id' }),
    supaGet<DbBook>('books', { select: 'shelf_id', status: 'eq.approved', shelf_id: 'not.is.null' }),
  ]);

  const shelfToRoom = new Map(shelves.map((s) => [s.id, s.room_id]));
  const counts = new Map<number, number>();
  for (const b of books) {
    const roomId = shelfToRoom.get(b.shelf_id!);
    if (roomId != null) counts.set(roomId, (counts.get(roomId) ?? 0) + 1);
  }

  res.json(rooms.map((r) => toRoom(r, counts.get(r.id) ?? 0)));
});

/** POST /rooms — create a room (admin/editor). Editors get edit access to rooms they create. */
router.post('/rooms', async (req: Request, res: Response) => {
  const me = req.user!;
  if (me.role === 'viewer') {
    res.status(403).json({ error: 'Viewers cannot create rooms' });
    return;
  }

  const { name } = req.body ?? {};
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const rows = await supaPost<DbRoom>('rooms', { name });
  if (me.role === 'editor') {
    await supaUpdate('app_users', me.id, {
      allowed_room_ids: [...me.allowed_room_ids, rows[0].id],
    });
  }
  res.status(201).json(toRoom(rows[0]));
});

/** DELETE /rooms/:id — delete a room and clean up stale allowed_room_ids (admin only). */
router.delete('/rooms/:id', requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  // Remove this room from the allowed_room_ids of every user that has it
  const affected = await supaGet<DbUser>('app_users', {
    select: 'id,allowed_room_ids',
    allowed_room_ids: `cs.{${id}}`,
  });
  await Promise.all(
    affected.map((u) =>
      supaUpdate('app_users', u.id, {
        allowed_room_ids: u.allowed_room_ids.filter((rid) => rid !== id),
      }),
    ),
  );

  await supaDelete('rooms', id);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// 5. Shelves CRUD
// ════════════════════════════════════════════════════════════

/** GET /shelves — list every shelf with (approved) book counts. */
router.get('/shelves', async (_req: Request, res: Response) => {
  const [shelves, books] = await Promise.all([
    supaGet<DbShelf>('shelves', { order: 'name' }),
    supaGet<DbBook>('books', { select: 'shelf_id', status: 'eq.approved', shelf_id: 'not.is.null' }),
  ]);

  const counts = new Map<number, number>();
  for (const b of books) counts.set(b.shelf_id!, (counts.get(b.shelf_id!) ?? 0) + 1);

  res.json(shelves.map((s) => toShelf(s, counts.get(s.id) ?? 0)));
});

/** POST /rooms/:roomId/shelves — add a shelf to a room. */
router.post('/rooms/:roomId/shelves', async (req: Request, res: Response) => {
  const roomId = Number(req.params.roomId);
  if (!canEditRoomLocation(req.user!, roomId)) {
    res.status(403).json({ error: 'You do not have access to this room' });
    return;
  }

  const { name } = req.body ?? {};
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const rows = await supaPost<DbShelf>('shelves', { room_id: roomId, name });
  res.status(201).json(toShelf(rows[0]));
});

/** DELETE /shelves/:id — remove a shelf. */
router.delete('/shelves/:id', async (req: Request, res: Response) => {
  const shelfId = Number(req.params.id);
  if (!canEditRoomLocation(req.user!, await getShelfRoomId(shelfId))) {
    res.status(403).json({ error: 'You do not have access to this room' });
    return;
  }

  await supaDelete('shelves', shelfId);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// 6. Books CRUD (with pending-book workflow)
// ════════════════════════════════════════════════════════════

/**
 * GET /books — list books with server-side pagination and filters.
 *
 * Query params:
 *   q          – search (title/author/genre)
 *   genre      – exact genre match
 *   author     – exact author match
 *   room       – room ID (via shelf → room join; ignored when `shelf` is set)
 *   shelf      – shelf ID
 *   status     – omitted: approved books plus the pending books the user may see
 *                'pending': only the pending books the user may see
 *   page       – 1-based page number (default 1)
 *   limit      – results per page (default 12, max 100)
 *
 * Pending books are visible to admins and to the user who created them.
 */
router.get('/books', async (req: Request, res: Response) => {
  const me = req.user!;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 12));

  const params: Record<string, string> = {
    order: 'title',
    offset: String((page - 1) * limit),
    limit: String(limit),
  };
  // Conditions that must all hold; each may itself be an or(...) group.
  const conditions: string[] = [];

  if (req.query.status === 'pending') {
    params.status = 'eq.pending';
    if (me.role !== 'admin') params.created_by = `eq.${me.id}`;
  } else if (me.role !== 'admin') {
    conditions.push(`or(status.eq.approved,created_by.eq.${me.id})`);
  }

  const q = sanitizeSearch(String(req.query.q ?? ''));
  if (q) conditions.push(`or(title.ilike.*${q}*,author.ilike.*${q}*,genre.ilike.*${q}*)`);
  if (conditions.length > 0) params.and = `(${conditions.join(',')})`;

  if (req.query.genre) params.genre = `eq.${req.query.genre}`;
  if (req.query.author) params.author = `eq.${req.query.author}`;

  if (req.query.shelf) {
    params.shelf_id = `eq.${Number(req.query.shelf)}`;
  } else if (req.query.room) {
    const roomShelves = await supaGet<DbShelf>('shelves', {
      room_id: `eq.${Number(req.query.room)}`,
      select: 'id',
    });
    if (roomShelves.length === 0) {
      res.json({ items: [], total: 0, page, limit });
      return;
    }
    params.shelf_id = `in.(${roomShelves.map((s) => s.id).join(',')})`;
  }

  const { rows, total } = await supaGetWithCount<DbBook>('books', params);
  res.json({ items: await enrichBooks(rows), total, page, limit });
});

/** GET /books/:id — get a single book. */
router.get('/books/:id', async (req: Request, res: Response) => {
  const book = await findBookOr404(res, Number(req.params.id));
  if (!book) return;
  if (!canSeeBook(req.user!, book)) {
    res.status(404).json({ error: 'Book not found' });
    return;
  }
  res.json((await enrichBooks([book]))[0]);
});

/**
 * POST /books — create a book.
 *   - With shelf    → must have canEditRoomLocation → status = 'approved'
 *   - Without shelf → 'approved' for admins, otherwise 'pending'
 */
router.post('/books', async (req: Request, res: Response) => {
  const me = req.user!;
  const { title, author, isbn, genre, notes } = req.body ?? {};
  const shelfId = req.body?.shelf_id ? Number(req.body.shelf_id) : null;

  if (!title?.trim()) {
    res.status(400).json({ error: 'Title is required' });
    return;
  }
  if (shelfId && !canEditRoomLocation(me, await getShelfRoomId(shelfId))) {
    res.status(403).json({ error: 'You do not have access to this shelf' });
    return;
  }

  const rows = await supaPost<DbBook>('books', {
    title,
    author: author || null,
    isbn: isbn || null,
    genre: genre || null,
    notes: notes || null,
    shelf_id: shelfId,
    status: shelfId || me.role === 'admin' ? 'approved' : 'pending',
    created_by: me.id,
  });
  res.status(201).json((await enrichBooks(rows))[0]);
});

/**
 * PUT /books/:id — update a book.
 *   - Requires canEditBook.
 *   - Moving to a shelf requires canEditRoomLocation and approves the book.
 *   - Removing the shelf makes it pending again (unless done by an admin).
 */
router.put('/books/:id', async (req: Request, res: Response) => {
  const me = req.user!;
  const id = Number(req.params.id);
  const existing = await findBookOr404(res, id);
  if (!existing) return;

  if (!canEditBook(me, existing, await getShelfRoomId(existing.shelf_id))) {
    res.status(403).json({ error: 'Not allowed to edit this book' });
    return;
  }

  const { title, author, isbn, genre, notes, shelf_id } = req.body ?? {};
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (title !== undefined) {
    if (!String(title).trim()) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }
    updates.title = title;
  }
  if (author !== undefined) updates.author = author || null;
  if (isbn !== undefined) updates.isbn = isbn || null;
  if (genre !== undefined) updates.genre = genre || null;
  if (notes !== undefined) updates.notes = notes || null;

  // Only a change of shelf affects status — re-saving the same shelf must not.
  const newShelfId = shelf_id === undefined ? existing.shelf_id : shelf_id ? Number(shelf_id) : null;
  if (newShelfId !== existing.shelf_id) {
    if (newShelfId && !canEditRoomLocation(me, await getShelfRoomId(newShelfId))) {
      res.status(403).json({ error: 'You do not have access to this shelf' });
      return;
    }
    updates.shelf_id = newShelfId;
    updates.status = newShelfId || me.role === 'admin' ? 'approved' : 'pending';
  }

  const updated = await supaUpdate<DbBook>('books', id, updates);
  res.json((await enrichBooks(updated))[0]);
});

/** DELETE /books/:id — delete a book (same permissions as editing). */
router.delete('/books/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const book = await findBookOr404(res, id);
  if (!book) return;

  if (!canEditBook(req.user!, book, await getShelfRoomId(book.shelf_id))) {
    res.status(403).json({ error: 'Not allowed to delete this book' });
    return;
  }

  await supaDelete('books', id);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// 7. Genre / Author / Stats endpoints
// ════════════════════════════════════════════════════════════

/** Distinct, sorted values of a text column across approved books. */
async function distinctBookValues(column: 'genre' | 'author'): Promise<string[]> {
  const rows = await supaGet<DbBook>('books', {
    select: column,
    status: 'eq.approved',
    [column]: 'not.is.null',
  });
  return [...new Set(rows.map((b) => b[column]!))].sort();
}

/** GET /genres — unique genre list (approved books only). */
router.get('/genres', async (_req: Request, res: Response) => {
  res.json(await distinctBookValues('genre'));
});

/** GET /authors — unique author list (approved books only). */
router.get('/authors', async (_req: Request, res: Response) => {
  res.json(await distinctBookValues('author'));
});

/** GET /stats — summary counts for the admin dashboard. */
router.get('/stats', requireAdmin, async (_req: Request, res: Response) => {
  const [books, shelves, rooms, users, pendingBooks] = await Promise.all([
    supaCount('books', { status: 'eq.approved' }),
    supaCount('shelves'),
    supaCount('rooms'),
    supaCount('app_users'),
    supaCount('books', { status: 'eq.pending' }),
  ]);
  res.json({ books, shelves, rooms, users, pendingBooks });
});

// ════════════════════════════════════════════════════════════
// 8. Loans — lending / returning (admin + editor only)
// ════════════════════════════════════════════════════════════

/** GET /books/:id/loans — full borrowing history for a book (newest first). */
router.get('/books/:id/loans', async (req: Request, res: Response) => {
  const book = await findBookOr404(res, Number(req.params.id));
  if (!book) return;
  if (!canSeeBook(req.user!, book)) {
    res.status(404).json({ error: 'Book not found' });
    return;
  }

  const rows = await supaGet<DbLoan>('loans', {
    book_id: `eq.${book.id}`,
    order: 'lent_at.desc',
  });

  const names = await getUserNameMap(
    rows.flatMap((l) => [l.lent_by, l.returned_by]).filter((v): v is number => v != null),
  );
  const nameOf = (id: number | null) => (id != null ? (names.get(id) ?? null) : null);

  res.json(rows.map((l) => toLoan(l, nameOf(l.lent_by), nameOf(l.returned_by))));
});

/**
 * POST /books/:id/loans — lend the book to someone.
 * Body: { borrower_name: string }  (free text, not an app user)
 * Fails with 409 if the book is already on loan.
 */
router.post('/books/:id/loans', async (req: Request, res: Response) => {
  const me = req.user!;
  if (!canLend(me)) {
    res.status(403).json({ error: 'Only admins and editors can lend books' });
    return;
  }

  const book = await findBookOr404(res, Number(req.params.id));
  if (!book) return;

  const borrowerName = String(req.body?.borrower_name ?? '').trim();
  if (!borrowerName) {
    res.status(400).json({ error: 'borrower_name is required' });
    return;
  }

  if ((await getActiveLoanMap([book.id])).has(book.id)) {
    res.status(409).json({ error: 'The book is already on loan' });
    return;
  }

  const rows = await supaPost<DbLoan>('loans', {
    book_id: book.id,
    borrower_name: borrowerName,
    lent_by: me.id,
  });
  res.status(201).json(toLoan(rows[0], me.username));
});

/** POST /loans/:id/return — mark a loan as returned. */
router.post('/loans/:id/return', async (req: Request, res: Response) => {
  const me = req.user!;
  if (!canLend(me)) {
    res.status(403).json({ error: 'Only admins and editors can return books' });
    return;
  }

  const loanId = Number(req.params.id);
  const rows = await supaGet<DbLoan>('loans', { id: `eq.${loanId}` });
  if (rows.length === 0) {
    res.status(404).json({ error: 'Loan not found' });
    return;
  }
  if (rows[0].returned_at) {
    res.status(400).json({ error: 'This loan was already returned' });
    return;
  }

  const updated = await supaUpdate<DbLoan>('loans', loanId, {
    returned_at: new Date().toISOString(),
    returned_by: me.id,
  });
  res.json(toLoan(updated[0], null, me.username));
});
