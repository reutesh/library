/*
 * src/routes.ts — API route definitions
 *
 * Sections (look for the `═══` dividers):
 *   1. Helpers & middleware
 *   2. Auth routes
 *   3. Users (admin CRUD)
 *   4. Rooms CRUD
 *   5. Shelves CRUD
 *   6. Books CRUD (with pending-book workflow)
 *   7. Genre / author / stats endpoints
 *
 * Permission model:
 *   admin  — full access
 *   editor — allowed only in rooms listed in allowed_room_ids
 *   viewer — read-only (except can create "pending" books)
 */

import { Router, type Request, type Response } from 'express';
import {
  supaGet,
  supaGetWithCount,
  supaPost,
  supaUpdate,
  supaDelete,
  toRoom,
  toShelf,
  toBook,
  type DbRoom,
  type DbShelf,
  type DbBook,
  type DbUser,
  type RoomResponse,
  type ShelfResponse,
  type BookResponse,
  type UserResponse,
} from './db';
import {
  signSession,
  verifySession,
  verifyPassword,
  isRateLimited,
  deriveHash,
  type SessionPayload,
} from './auth';

export const router = Router();

// ════════════════════════════════════════════════════════════
// 1. Helpers & middleware
// ════════════════════════════════════════════════════════════

/** Attach session payload to every request that passes through auth. */
declare global {
  namespace Express {
    interface Request {
      session?: SessionPayload;
    }
  }
}

/**
 * Auth middleware — reads the `session` cookie, verifies the HMAC,
 * and attaches the decoded payload to `req.session`.
 * Responds 401 if the cookie is missing or invalid.
 */
function requireAuth(req: Request, res: Response, next: Function) {
  const payload = verifySession(req.cookies.session);
  if (!payload) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  req.session = payload;
  next();
}

/** Shorthand: returns the authenticated user row or sends 501. */
async function getUserOrDie(res: Response, userId: number): Promise<DbUser | null> {
  const rows = await supaGet<DbUser>('app_users', {
    id: `eq.${userId}`,
    select: '*',
  });
  if (rows.length === 0) {
    res.status(501).json({ error: 'User not found' });
    return null;
  }
  return rows[0];
}

/**
 * Wraps an async route handler so thrown errors are caught and
 * returned as JSON instead of crashing the process.
 */
function safeError(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error('[route error]', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  };
}

/**
 * Returns the shelf's room_id, or null if the shelf doesn't exist.
 */
async function getShelfRoomId(shelfId: number): Promise<number | null> {
  if (!shelfId) return null;
  const rows = await supaGet<DbShelf>('shelves', {
    id: `eq.${shelfId}`,
    select: 'room_id',
  });
  return rows.length > 0 ? rows[0].room_id : null;
}

/**
 * Permission check: can this user edit in the given room?
 *   - Admins always can.
 *   - Editors can if the room is in their allowed_room_ids.
 */
function canEditRoomLocation(user: DbUser, roomId: number | null): boolean {
  if (user.role === 'admin') return true;
  if (user.role !== 'editor' || !roomId) return false;
  return user.allowed_room_ids.includes(roomId);
}

/**
 * Permission check: can this user edit a specific book?
 *   - Admins always can.
 *   - Editors can edit books in rooms they have access to.
 *   - Viewers can edit their own pending books.
 */
function canEditBook(
  user: DbUser,
  book: DbBook,
  bookRoomId: number | null,
): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'editor') return canEditRoomLocation(user, bookRoomId);
  // Viewer: can edit own pending books
  if (book.status === 'pending' && book.created_by === user.id) return true;
  return false;
}

// ════════════════════════════════════════════════════════════
// 2. Auth routes
// ════════════════════════════════════════════════════════════

/** POST /auth/login — authenticate and set session cookie. */
router.post(
  '/auth/login',
  safeError(async (req: Request, res: Response) => {
    const { username, password } = req.body ?? {};

    // Rate-limit by IP before hitting the database
    if (isRateLimited(req.ip!)) {
      res.status(429).json({ error: 'Too many failed login attempts. Try again later.' });
      return;
    }

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const rows = await supaGet<DbUser>('app_users', {
      username: `eq.${username}`,
      select: '*',
    });

    if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const token = signSession(rows[0].id);
    res.cookie('session', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    res.json({
      id: rows[0].id,
      username: rows[0].username,
      role: rows[0].role,
    });
  }),
);

/** POST /auth/logout — clear the session cookie. */
router.post('/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

/** GET /auth/me — return the currently logged-in user. */
router.get(
  '/auth/me',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const user = await getUserOrDie(res, req.session!.userId);
    if (!user) return;
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      allowedRoomIds: user.allowed_room_ids,
    });
  }),
);

/** PUT /auth/me — self-service password change. */
router.put(
  '/auth/me',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const { current_password, new_password } = req.body ?? {};

    if (!current_password || !new_password) {
      res.status(400).json({ error: 'Both current_password and new_password are required' });
      return;
    }
    if (new_password.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters' });
      return;
    }

    const rows = await supaGet<DbUser>('app_users', {
      id: `eq.${req.session!.userId}`,
      select: '*',
    });
    if (rows.length === 0 || !verifyPassword(current_password, rows[0].password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const newHash = deriveHash(new_password);
    await supaUpdate('app_users', `eq.${rows[0].id}`, {
      password_hash: newHash,
    });

    res.json({ ok: true });
  }),
);

// ════════════════════════════════════════════════════════════
// 3. Users — admin-only CRUD
// ════════════════════════════════════════════════════════════

/** GET /users — list all users (admin only). */
router.get(
  '/users',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;
    if (me.role !== 'admin') {
      res.status(403).json({ error: 'Admin only' });
      return;
    }

    const rows = await supaGet<DbUser>('app_users', { select: '*' });
    const list: UserResponse[] = rows.map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role,
      allowedRoomIds: r.allowed_room_ids,
    }));
    res.json(list);
  }),
);

/** POST /users — create a user (admin only). */
router.post(
  '/users',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;
    if (me.role !== 'admin') {
      res.status(403).json({ error: 'Admin only' });
      return;
    }

    const { username, password, role, allowed_room_ids } = req.body ?? {};
    if (!username || !password) {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }

    const hash = deriveHash(password);
    const rows = await supaPost<DbUser>('app_users', {
      username,
      password_hash: hash,
      role: role ?? 'viewer',
      allowed_room_ids: allowed_room_ids ?? [],
    });

    res.status(201).json({
      id: rows[0].id,
      username: rows[0].username,
      role: rows[0].role,
      allowedRoomIds: rows[0].allowed_room_ids,
    });
  }),
);

/** PATCH /users/:id — update a user (admin only). */
router.patch(
  '/users/:id',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;
    if (me.role !== 'admin') {
      res.status(403).json({ error: 'Admin only' });
      return;
    }

    const id = Number(req.params.id);
    const updates: Record<string, unknown> = {};

    if (req.body.password) {
      updates.password_hash = deriveHash(req.body.password);
    }
    if (req.body.role) {
      updates.role = req.body.role;
    }
    if (req.body.allowed_room_ids !== undefined) {
      updates.allowed_room_ids = req.body.allowed_room_ids;
    }
    if (req.body.username) {
      updates.username = req.body.username;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }

    const rows = await supaUpdate<DbUser>('app_users', `eq.${id}`, updates);
    if (rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: rows[0].id,
      username: rows[0].username,
      role: rows[0].role,
      allowedRoomIds: rows[0].allowed_room_ids,
    });
  }),
);

/** DELETE /users/:id — delete a user (admin only). */
router.delete(
  '/users/:id',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;
    if (me.role !== 'admin') {
      res.status(403).json({ error: 'Admin only' });
      return;
    }

    const id = Number(req.params.id);
    await supaDelete('app_users', `eq.${id}`);
    res.json({ ok: true });
  }),
);

// ════════════════════════════════════════════════════════════
// 4. Rooms CRUD
// ════════════════════════════════════════════════════════════

/** GET /rooms — list rooms with book counts. */
router.get(
  '/rooms',
  requireAuth,
  safeError(async (_req: Request, res: Response) => {
    const rooms = await supaGet<DbRoom>('rooms', { select: '*', order: 'name' });
    const books = await supaGet<DbBook>('books', {
      select: 'shelf_id',
      status: 'eq.approved',
    });

    // Pre-compute per-room book counts via a shelf_id → room_id lookup
    const shelves = await supaGet<DbShelf>('shelves', { select: 'id,room_id' });
    const shelfToRoom = new Map<number, number>();
    for (const s of shelves) shelfToRoom.set(s.id, s.room_id);

    const counts = new Map<number, number>();
    for (const b of books) {
      if (b.shelf_id == null) continue;
      const rid = shelfToRoom.get(b.shelf_id);
      if (rid != null) counts.set(rid, (counts.get(rid) ?? 0) + 1);
    }

    const result: RoomResponse[] = rooms.map((r) => toRoom(r, counts.get(r.id) ?? 0));
    res.json(result);
  }),
);

/** POST /rooms — create a room (admin/editor). */
router.post(
  '/rooms',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;
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
    res.status(201).json(toRoom(rows[0]));
  }),
);

/** DELETE /rooms/:id — delete a room and clean up stale allowed_room_ids. */
router.delete(
  '/rooms/:id',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;
    if (me.role !== 'admin') {
      res.status(403).json({ error: 'Admin only' });
      return;
    }

    const id = Number(req.params.id);

    // Remove this room from every user's allowed_room_ids array
    const allUsers = await supaGet<DbUser>('app_users', { select: 'id,allowed_room_ids' });
    for (const u of allUsers) {
      if (u.allowed_room_ids.includes(id)) {
        await supaUpdate('app_users', `eq.${u.id}`, {
          allowed_room_ids: u.allowed_room_ids.filter((rid) => rid !== id),
        });
      }
    }

    await supaDelete('rooms', `eq.${id}`);
    res.json({ ok: true });
  }),
);

// ════════════════════════════════════════════════════════════
// 5. Shelves CRUD
// ════════════════════════════════════════════════════════════

/** GET /rooms/:roomId/shelves — list shelves in a room. */
router.get(
  '/rooms/:roomId/shelves',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const roomId = Number(req.params.roomId);
    const shelves = await supaGet<DbShelf>('shelves', {
      room_id: `eq.${roomId}`,
      select: '*',
      order: 'name',
    });
    const books = await supaGet<DbBook>('books', {
      shelf_id: `in.(${shelves.map((s) => s.id).join(',')})`,
      status: 'eq.approved',
      select: 'shelf_id',
    });

    const counts = new Map<number, number>();
    for (const b of books) {
      if (b.shelf_id != null) {
        counts.set(b.shelf_id, (counts.get(b.shelf_id) ?? 0) + 1);
      }
    }

    const result: ShelfResponse[] = shelves.map((s) =>
      toShelf(s, counts.get(s.id) ?? 0),
    );
    res.json(result);
  }),
);

/** POST /rooms/:roomId/shelves — add a shelf to a room. */
router.post(
  '/rooms/:roomId/shelves',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;
    const roomId = Number(req.params.roomId);

    if (!canEditRoomLocation(me, roomId)) {
      res.status(403).json({ error: 'You do not have access to this room' });
      return;
    }

    const { name } = req.body ?? {};
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const rows = await supaPost<DbShelf>('shelves', {
      room_id: roomId,
      name,
    });
    res.status(201).json(toShelf(rows[0]));
  }),
);

/** DELETE /shelves/:id — remove a shelf. */
router.delete(
  '/shelves/:id',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;

    const shelfId = Number(req.params.id);
    const roomId = await getShelfRoomId(shelfId);

    if (!canEditRoomLocation(me, roomId)) {
      res.status(403).json({ error: 'You do not have access to this room' });
      return;
    }

    await supaDelete('shelves', `eq.${shelfId}`);
    res.json({ ok: true });
  }),
);

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
 *   room       – room ID (via shelf → room join)
 *   shelf      – shelf ID
 *   status     – 'approved' (default) | 'pending' (admin/owner only)
 *   page       – 1-based page number (default 1)
 *   limit      – results per page (default 12)
 *   all        – 'true' to skip pagination (used by dashboard)
 */
router.get(
  '/books',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 12));
    const fetchAll = req.query.all === 'true';

    // Start with approved books; admin/owner also get pending
    const statusFilter: string[] = ['status.eq.approved'];
    if (me.role === 'admin' || req.query.status === 'pending') {
      statusFilter.push('status.eq.pending');
    }

    // Build PostgREST filters
    const params: Record<string, string> = {
      select: '*',
      or: `(${statusFilter.join(',')})`,
      order: 'title',
    };

    if (req.query.q) {
      params.or = `(${statusFilter.join(',')},and(title.ilike.*${req.query.q}*,author.ilike.*${req.query.q}*))`;
    }
    if (req.query.genre) params.genre = `eq.${req.query.genre}`;
    if (req.query.author) params.author = `eq.${req.query.author}`;
    if (req.query.shelf) params.shelf_id = `eq.${req.query.shelf}`;

    // Room filter: requires a join through shelves
    let roomBookIds: number[] | null = null;
    if (req.query.room) {
      const roomId = Number(req.query.room);
      const roomShelves = await supaGet<DbShelf>('shelves', {
        room_id: `eq.${roomId}`,
        select: 'id',
      });
      if (roomShelves.length === 0) {
        // No shelves in this room → no books possible
        res.json({ items: [], total: 0, page, limit });
        return;
      }
      params.shelf_id = `in.(${roomShelves.map((s) => s.id).join(',')})`;
    }

    // Fetch books (paginated or all)
    let books: DbBook[];
    let total: number;

    if (fetchAll) {
      books = await supaGet<DbBook>('books', params);
      total = books.length;
    } else {
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      params.offset = String(from);
      params.limit = String(limit);
      const result = await supaGetWithCount<DbBook>('books', params);
      books = result.rows;
      total = result.total;
    }

    // If viewer, only show own pending books
    let filtered = books;
    if (me.role === 'viewer') {
      filtered = books.filter(
        (b) => b.status === 'approved' || b.created_by === me.id,
      );
    }

    // Resolve shelf → room names
    const shelfIds = [...new Set(filtered.map((b) => b.shelf_id).filter(Boolean))] as number[];
    const shelfMap = new Map<number, { name: string; roomId: number }>();
    if (shelfIds.length > 0) {
      const shelfRows = await supaGet<DbShelf>('shelves', {
        id: `in.(${shelfIds.join(',')})`,
        select: '*',
      });
      for (const s of shelfRows) shelfMap.set(s.id, { name: s.name, roomId: s.room_id });
    }
    const roomIds = [...new Set([...shelfMap.values()].map((v) => v.roomId))];
    const roomMap = new Map<number, string>();
    if (roomIds.length > 0) {
      const roomRows = await supaGet<DbRoom>('rooms', {
        id: `in.(${roomIds.join(',')})`,
        select: '*',
      });
      for (const r of roomRows) roomMap.set(r.id, r.name);
    }

    const items: BookResponse[] = filtered.map((b) => {
      const shelf = b.shelf_id ? shelfMap.get(b.shelf_id) : undefined;
      return toBook(
        b,
        shelf?.name ?? null,
        shelf?.roomId ?? null,
        shelf ? (roomMap.get(shelf.roomId) ?? null) : null,
      );
    });

    res.json({ items, total, page, limit });
  }),
);

/** GET /books/:id — get a single book. Viewers only see approved or own pending. */
router.get(
  '/books/:id',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;

    const id = Number(req.params.id);
    const rows = await supaGet<DbBook>('books', {
      id: `eq.${id}`,
      select: '*',
    });
    if (rows.length === 0) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    const book = rows[0];
    if (me.role === 'viewer' && book.status === 'pending' && book.created_by !== me.id) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    // Resolve shelf → room
    const shelf = book.shelf_id
      ? (await supaGet<DbShelf>('shelves', { id: `eq.${book.shelf_id}`, select: '*' }))[0]
      : null;
    const room = shelf
      ? (await supaGet<DbRoom>('rooms', { id: `eq.${shelf.room_id}`, select: '*' }))[0]
      : null;

    res.json(toBook(book, shelf?.name ?? null, shelf?.room_id ?? null, room?.name ?? null));
  }),
);

/**
 * POST /books — create a book.
 *   - Without shelf → status = 'pending'
 *   - With shelf    → must have canEditRoomLocation → status = 'approved'
 *   - Admin-created books are always 'approved'
 */
router.post(
  '/books',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;

    const { title, shelf_id } = req.body ?? {};
    if (!title) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    let status: 'approved' | 'pending' = 'pending';
    let resolvedShelfId = shelf_id ?? null;

    if (resolvedShelfId) {
      const room_id = await getShelfRoomId(resolvedShelfId);
      if (!canEditRoomLocation(me, room_id)) {
        res.status(403).json({ error: 'You do not have access to this shelf' });
        return;
      }
      status = 'approved';
    } else if (me.role === 'admin') {
      status = 'approved';
    }

    const data: Record<string, unknown> = {
      title,
      author: req.body.author ?? null,
      isbn: req.body.isbn ?? null,
      genre: req.body.genre ?? null,
      notes: req.body.notes ?? null,
      shelf_id: resolvedShelfId,
      status,
      created_by: me.id,
    };

    const rows = await supaPost<DbBook>('books', data);
    res.status(201).json(toBook(rows[0]));
  }),
);

/**
 * PUT /books/:id — update a book.
 *   - Editors can only update books in their allowed rooms.
 *   - Viewers can update their own pending books.
 *   - Shelf assignment requires canEditRoomLocation and flips status → approved.
 *   - Removing a shelf flips status → pending.
 */
router.put(
  '/books/:id',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;

    const id = Number(req.params.id);
    const rows = await supaGet<DbBook>('books', { id: `eq.${id}`, select: '*' });
    if (rows.length === 0) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }
    const existing = rows[0];

    const existingShelfRoomId = existing.shelf_id ? await getShelfRoomId(existing.shelf_id) : null;
    if (!canEditBook(me, existing, existingShelfRoomId)) {
      res.status(403).json({ error: 'Not allowed to edit this book' });
      return;
    }

    const { shelf_id, ...rest } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (rest.title !== undefined) updates.title = rest.title;
    if (rest.author !== undefined) updates.author = rest.author || null;
    if (rest.isbn !== undefined) updates.isbn = rest.isbn || null;
    if (rest.genre !== undefined) updates.genre = rest.genre || null;
    if (rest.notes !== undefined) updates.notes = rest.notes || null;

    // Handle shelf assignment / removal
    if (shelf_id !== undefined) {
      if (shelf_id) {
        const newRoomId = await getShelfRoomId(shelf_id);
        if (!canEditRoomLocation(me, newRoomId)) {
          res.status(403).json({ error: 'You do not have access to this shelf' });
          return;
        }
        updates.shelf_id = shelf_id;
        updates.status = 'approved'; // shelf assignment = approval
      } else {
        updates.shelf_id = null;
        updates.status = 'pending'; // removing shelf = back to pending
      }
    }

    updates.updated_at = new Date().toISOString();

    const updated = await supaUpdate<DbBook>('books', `eq.${id}`, updates);
    res.json(toBook(updated[0]));
  }),
);

/** DELETE /books/:id — delete a book.
 *   - Admins can delete anything.
 *   - Owners can delete their own pending books.
 *   - Editors can delete books in their allowed rooms.
 */
router.delete(
  '/books/:id',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;

    const id = Number(req.params.id);
    const rows = await supaGet<DbBook>('books', { id: `eq.${id}`, select: '*' });
    if (rows.length === 0) {
      res.status(404).json({ error: 'Book not found' });
      return;
    }

    const book = rows[0];
    const bookRoomId = book.shelf_id ? await getShelfRoomId(book.shelf_id) : null;

    // Permission check
    if (me.role === 'admin') {
      // OK
    } else if (book.status === 'pending' && book.created_by === me.id) {
      // Owner can delete own pending
    } else if (!canEditBook(me, book, bookRoomId)) {
      res.status(403).json({ error: 'Not allowed to delete this book' });
      return;
    }

    await supaDelete('books', `eq.${id}`);
    res.json({ ok: true });
  }),
);

// ════════════════════════════════════════════════════════════
// 7. Genre / Author / Stats endpoints
// ════════════════════════════════════════════════════════════

/** GET /genres — unique genre list (approved books only). */
router.get(
  '/genres',
  requireAuth,
  safeError(async (_req: Request, res: Response) => {
    const books = await supaGet<DbBook>('books', {
      select: 'genre',
      status: 'eq.approved',
      'not.genre': 'is.null',
    });
    const genres = [...new Set(books.map((b) => b.genre).filter(Boolean))].sort();
    res.json(genres);
  }),
);

/** GET /authors — unique author list (approved books only). */
router.get(
  '/authors',
  requireAuth,
  safeError(async (_req: Request, res: Response) => {
    const books = await supaGet<DbBook>('books', {
      select: 'author',
      status: 'eq.approved',
      'not.author': 'is.null',
    });
    const authors = [...new Set(books.map((b) => b.author).filter(Boolean))].sort();
    res.json(authors);
  }),
);

/** GET /stats — summary counts for the admin dashboard. */
router.get(
  '/stats',
  requireAuth,
  safeError(async (req: Request, res: Response) => {
    const me = await getUserOrDie(res, req.session!.userId);
    if (!me) return;
    if (me.role !== 'admin') {
      res.status(403).json({ error: 'Admin only' });
      return;
    }

    const [books, shelves, rooms, users, pendingBooks] = await Promise.all([
      supaGet<DbBook>('books', { select: 'id', status: 'eq.approved' }),
      supaGet<DbShelf>('shelves', { select: 'id' }),
      supaGet<DbRoom>('rooms', { select: 'id' }),
      supaGet<DbUser>('app_users', { select: 'id' }),
      supaGet<DbBook>('books', { select: 'id', status: 'eq.pending' }),
    ]);

    res.json({
      books: books.length,
      shelves: shelves.length,
      rooms: rooms.length,
      users: users.length,
      pendingBooks: pendingBooks.length,
    });
  }),
);
