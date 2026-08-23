import { Router, Request, Response, NextFunction } from 'express';
import { supaGet, supaGetWithCount, supaPost, supaUpdate, supaDelete } from './db';
import {
  attachUser, hashPassword, verifyPassword, setSessionCookie, clearSessionCookie,
  ensureBootstrapAdmin, loginRateLimited, recordLoginFailure, clearLoginFailures,
  publicUser, type AppUser,
} from './auth';

const router = Router();

router.use(attachUser);

const ROLES = ['admin', 'editor', 'viewer'] as const;

// ========== AUTH ==========

router.post('/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  const key = req.ip || 'unknown';
  if (loginRateLimited(key)) return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  try {
    await ensureBootstrapAdmin();
    const rows = await supaGet(
      'app_users',
      `username=eq.${encodeURIComponent(String(username))}&select=id,username,password_hash,role,allowed_room_ids`
    );
    const user = rows[0];
    if (!user || !verifyPassword(String(password), user.password_hash)) {
      recordLoginFailure(key);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    clearLoginFailures(key);
    setSessionCookie(res, user.id);
    res.json(publicUser(user));
  } catch (err: any) {
    const msg = String(err.message || '');
    if (msg.includes('does not exist') || msg.includes('Could not find the table')) {
      return res.status(500).json({ error: 'Database not ready: run schema.sql in the Supabase SQL editor (app_users table is missing)' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post('/auth/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ message: 'Logged out' });
});

router.get('/auth/me', (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  res.json(publicUser(req.user));
});

// ========== GUARDS ==========

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin permission required' });
    return;
  }
  next();
}

router.use(requireAuth);

// ========== PERMISSION HELPERS ==========

async function getShelfRoomId(shelfId: number | string): Promise<number | null> {
  const shelves = await supaGet('shelves', `id=eq.${shelfId}&select=room_id`);
  return shelves.length ? shelves[0].room_id : null;
}

function editorAllowedForRoom(user: AppUser, roomId: number | null): boolean {
  return roomId !== null && user.allowed_room_ids.includes(Number(roomId));
}

async function canEditRoomLocation(user: AppUser, roomId: number | null): Promise<boolean> {
  if (user.role === 'admin') return true;
  return user.role === 'editor' && editorAllowedForRoom(user, roomId);
}

async function canEditBook(user: AppUser, currentShelfId: number | null, newShelfId: number | null): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (user.role !== 'editor') return false;
  const oldRoom = currentShelfId ? await getShelfRoomId(currentShelfId) : null;
  const newRoom = newShelfId ? await getShelfRoomId(newShelfId) : null;
  return editorAllowedForRoom(user, oldRoom) && editorAllowedForRoom(user, newRoom);
}

function sanitizeRoomIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter((n: number) => Number.isFinite(n));
}

// ========== USERS (admin only) ==========

router.get('/users', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const users = await supaGet('app_users', 'select=id,username,role,allowed_room_ids,created_at&order=username.asc');
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', requireAdmin, async (req: Request, res: Response) => {
  const { username, password, role, allowed_room_ids } = req.body || {};
  if (!username || !String(username).trim()) return res.status(400).json({ error: 'Username is required' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!role || !ROLES.includes(role)) return res.status(400).json({ error: 'Role must be admin, editor or viewer' });
  try {
    const user = await supaPost('app_users', {
      username: String(username).trim(),
      password_hash: hashPassword(String(password)),
      role,
      allowed_room_ids: sanitizeRoomIds(allowed_room_ids),
    });
    res.status(201).json({ id: user.id, username: user.username, role: user.role, allowed_room_ids: user.allowed_room_ids });
  } catch (err: any) {
    if (err.message.includes('duplicate')) return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id', requireAdmin, async (req: Request, res: Response) => {
  const targetId = Number(req.params.id);
  const { username, password, role, allowed_room_ids } = req.body || {};
  if (targetId === req.user!.id && role && role !== 'admin') {
    return res.status(400).json({ error: 'You cannot change your own role' });
  }
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Role must be admin, editor or viewer' });
  if (password !== undefined && password !== '' && String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const updates: Record<string, unknown> = {};
  if (username && String(username).trim()) updates.username = String(username).trim();
  if (password) updates.password_hash = hashPassword(String(password));
  if (role) updates.role = role;
  if (allowed_room_ids !== undefined) updates.allowed_room_ids = sanitizeRoomIds(allowed_room_ids);
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
  try {
    const users = await supaGet('app_users', `id=eq.${targetId}&select=id,role`);
    if (!users.length) return res.status(404).json({ error: 'User not found' });
    if (role && users[0].role === 'admin' && role !== 'admin') {
      const allAdmins = await supaGet('app_users', 'role=eq.admin&select=id');
      if (allAdmins.length <= 1) return res.status(400).json({ error: 'Cannot demote the last admin' });
    }
    const updated = await supaUpdate('app_users', targetId, updates);
    res.json({ id: updated.id, username: updated.username, role: updated.role, allowed_room_ids: updated.allowed_room_ids });
  } catch (err: any) {
    if (err.message.includes('duplicate')) return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', requireAdmin, async (req: Request, res: Response) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user!.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  try {
    const targets = await supaGet('app_users', `id=eq.${targetId}&select=id,role`);
    if (!targets.length) return res.status(404).json({ error: 'User not found' });
    if (targets[0].role === 'admin') {
      const allAdmins = await supaGet('app_users', 'role=eq.admin&select=id');
      if (allAdmins.length <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });
    }
    await supaDelete('app_users', targetId);
    res.json({ message: 'User deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========== ROOMS ==========

router.get('/rooms', async (_req: Request, res: Response) => {
  try {
    const rooms = await supaGet('rooms', 'select=*,shelves(books(id))&order=name.asc');
    const result = rooms.map((r: any) => ({
      id: r.id,
      name: r.name,
      book_count: r.shelves?.reduce((sum: number, s: any) => sum + (s.books?.length || 0), 0) || 0,
    }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/rooms/:id', async (req: Request, res: Response) => {
  try {
    const rooms = await supaGet('rooms', `id=eq.${req.params.id}&select=*,shelves(books(id))`);
    if (!rooms.length) return res.status(404).json({ error: 'Room not found' });
    const r = rooms[0];
    res.json({
      id: r.id,
      name: r.name,
      book_count: r.shelves?.reduce((sum: number, s: any) => sum + (s.books?.length || 0), 0) || 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rooms', requireAdmin, async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const room = await supaPost('rooms', { name });
    res.status(201).json({ id: room.id, name: room.name, book_count: 0 });
  } catch (err: any) {
    if (err.message.includes('duplicate')) return res.status(409).json({ error: 'Room name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/rooms/:id', requireAdmin, async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const room = await supaUpdate('rooms', String(req.params.id), { name });
    res.json({ id: room.id, name: room.name });
  } catch (err: any) {
    if (err.message.includes('duplicate')) return res.status(409).json({ error: 'Room name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/rooms/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    await supaDelete('rooms', String(req.params.id));
    res.json({ message: 'Room deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========== SHELVES ==========

router.get('/shelves', async (req: Request, res: Response) => {
  try {
    const roomId = req.query.room_id;
    let query = 'select=*,rooms(name),books(id)';
    if (roomId) query += `&room_id=eq.${roomId}`;
    const shelves = await supaGet('shelves', query);
    const result = shelves.map((s: any) => ({
      id: s.id,
      room_id: s.room_id,
      name: s.name,
      room_name: s.rooms?.name,
      book_count: s.books?.length || 0,
    }));
    result.sort((a: any, b: any) => a.room_name?.localeCompare(b.room_name) || a.name.localeCompare(b.name));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/shelves/:id', async (req: Request, res: Response) => {
  try {
    const shelves = await supaGet('shelves', `id=eq.${req.params.id}&select=*,rooms(name),books(id)`);
    if (!shelves.length) return res.status(404).json({ error: 'Shelf not found' });
    const s = shelves[0];
    res.json({
      id: s.id,
      room_id: s.room_id,
      name: s.name,
      room_name: s.rooms?.name,
      book_count: s.books?.length || 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/shelves', async (req: Request, res: Response) => {
  const { room_id, name } = req.body;
  if (!room_id || !name) return res.status(400).json({ error: 'room_id and name are required' });
  if (!(await canEditRoomLocation(req.user!, Number(room_id)))) {
    return res.status(403).json({ error: 'No permission to edit this room' });
  }
  try {
    const shelf = await supaPost('shelves', { room_id, name });
    res.status(201).json({ id: shelf.id, room_id: shelf.room_id, name: shelf.name, book_count: 0 });
  } catch (err: any) {
    if (err.message.includes('duplicate')) return res.status(409).json({ error: 'Shelf name already exists in this room' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/shelves/:id', async (req: Request, res: Response) => {
  const { room_id, name } = req.body;
  if (!room_id || !name) return res.status(400).json({ error: 'room_id and name are required' });
  try {
    const shelves = await supaGet('shelves', `id=eq.${req.params.id}&select=room_id`);
    if (!shelves.length) return res.status(404).json({ error: 'Shelf not found' });
    const oldAllowed = await canEditRoomLocation(req.user!, shelves[0].room_id);
    const newAllowed = await canEditRoomLocation(req.user!, Number(room_id));
    if (!oldAllowed || !newAllowed) return res.status(403).json({ error: 'No permission to edit this room' });
    const shelf = await supaUpdate('shelves', String(req.params.id), { room_id, name });
    res.json({ id: shelf.id, room_id: shelf.room_id, name: shelf.name });
  } catch (err: any) {
    if (err.message.includes('duplicate')) return res.status(409).json({ error: 'Shelf name already exists in this room' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/shelves/:id', async (req: Request, res: Response) => {
  try {
    const shelves = await supaGet('shelves', `id=eq.${req.params.id}&select=room_id`);
    if (!shelves.length) return res.status(404).json({ error: 'Shelf not found' });
    if (!(await canEditRoomLocation(req.user!, shelves[0].room_id))) {
      return res.status(403).json({ error: 'No permission to edit this room' });
    }
    await supaDelete('shelves', String(req.params.id));
    res.json({ message: 'Shelf deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========== BOOKS ==========

router.get('/books', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limitRaw = parseInt(String(req.query.limit), 10) || 24;
    const limit = Math.min(100, Math.max(1, limitRaw));
    const offset = (page - 1) * limit;

    const { shelf_id, room_id, genre, author, search } = req.query;
    const filters: string[] = ['order=title.asc', `limit=${limit}`, `offset=${offset}`];

    if (shelf_id === 'none') filters.push('shelf_id=is.null');
    else if (shelf_id) filters.push(`shelf_id=eq.${shelf_id}`);
    if (room_id) filters.push(`shelves.rooms.id=eq.${room_id}`);
    if (genre) filters.push(`genre=eq.${encodeURIComponent(String(genre))}`);
    if (author) {
      const term = encodeURIComponent(`%${author}%`);
      filters.push(`author.ilike.${term}`);
    }
    if (search) {
      const term = encodeURIComponent(`%${search}%`)
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/,/g, '%2C');
      filters.push(`or=(title.ilike.${term},author.ilike.${term},isbn.ilike.${term},genre.ilike.${term})`);
    }

    const isAdminUser = req.user!.role === 'admin';
    if (req.query.pending === '1') {
      if (!isAdminUser) return res.status(403).json({ error: 'Admin permission required' });
      filters.push('status=eq.pending');
    } else if (!isAdminUser) {
      filters.push(`or=(status.eq.approved,created_by.eq.${req.user!.id})`);
    }

    const query = 'select=*,shelves(room_id,name,rooms(name))&' + filters.join('&');
    const { data, total } = await supaGetWithCount('books', query);

    const result = data.map((b: any) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      isbn: b.isbn,
      genre: b.genre,
      shelf_id: b.shelf_id,
      room_id: b.shelves?.room_id ?? null,
      notes: b.notes,
      status: b.status || 'approved',
      created_by: b.created_by ?? null,
      shelf_name: b.shelves?.name || null,
      room_name: b.shelves?.rooms?.name || null,
      created_at: b.created_at,
      updated_at: b.updated_at,
    }));
    res.json({ data: result, total, page, limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/books/:id', async (req: Request, res: Response) => {
  try {
    const books = await supaGet('books', `id=eq.${req.params.id}&select=*,shelves(room_id,name,rooms(name))`);
    if (!books.length) return res.status(404).json({ error: 'Book not found' });
    const b = books[0];
    if (b.status === 'pending' && req.user!.role !== 'admin' && b.created_by !== req.user!.id) {
      return res.status(404).json({ error: 'Book not found' });
    }
    res.json({
      id: b.id,
      title: b.title,
      author: b.author,
      isbn: b.isbn,
      genre: b.genre,
      shelf_id: b.shelf_id,
      room_id: b.shelves?.room_id ?? null,
      notes: b.notes,
      status: b.status,
      created_by: b.created_by,
      shelf_name: b.shelves?.name || null,
      room_name: b.shelves?.rooms?.name || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/books', async (req: Request, res: Response) => {
  const { title, author, isbn, genre, shelf_id, notes } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  try {
    const user = req.user!;
    let status = 'pending';
    if (shelf_id) {
      const targetRoom = await getShelfRoomId(Number(shelf_id));
      if (!(await canEditRoomLocation(user, targetRoom))) {
        return res.status(403).json({ error: 'No permission: books must be placed inside rooms you are allowed to edit' });
      }
      status = 'approved';
    } else if (user.role === 'admin') {
      status = 'approved';
    }
    const book = await supaPost('books', {
      title, author: author || null, isbn: isbn || null,
      genre: genre || null, shelf_id: shelf_id || null, notes: notes || null,
      status,
      created_by: user.id,
    });
    const full = await supaGet('books', `id=eq.${book.id}&select=*,shelves(room_id,name,rooms(name))`);
    const b = full[0];
    res.status(201).json({
      id: b.id, title: b.title, author: b.author, isbn: b.isbn,
      genre: b.genre, shelf_id: b.shelf_id, room_id: b.shelves?.room_id ?? null, notes: b.notes,
      status: b.status, created_by: b.created_by,
      shelf_name: b.shelves?.name || null, room_name: b.shelves?.rooms?.name || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/books/:id', async (req: Request, res: Response) => {
  const { title, author, isbn, genre, shelf_id, notes } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  try {
    const existing = await supaGet('books', `id=eq.${req.params.id}&select=id,shelf_id,status,created_by`);
    if (!existing.length) return res.status(404).json({ error: 'Book not found' });
    const cur = existing[0];
    const newShelfId = shelf_id ? Number(shelf_id) : null;
    const user = req.user!;

    let allowed = false;
    if (user.role === 'admin') {
      allowed = true;
    } else if (cur.status === 'pending' && cur.created_by === user.id) {
      if (newShelfId) {
        const room = await getShelfRoomId(newShelfId);
        if (!(await canEditRoomLocation(user, room))) {
          return res.status(403).json({ error: 'No permission: you can only place books inside rooms you are allowed to edit' });
        }
      }
      allowed = true;
    } else {
      allowed = await canEditBook(user, cur.shelf_id, newShelfId);
    }
    if (!allowed) return res.status(403).json({ error: 'No permission to edit this book' });

    await supaUpdate('books', String(req.params.id), {
      title, author: author || null, isbn: isbn || null,
      genre: genre || null, shelf_id: newShelfId, notes: notes || null,
      status: newShelfId ? 'approved' : cur.status,
      updated_at: new Date().toISOString(),
    });
    const books = await supaGet('books', `id=eq.${req.params.id}&select=*,shelves(room_id,name,rooms(name))`);
    const b = books[0];
    res.json({
      id: b.id, title: b.title, author: b.author, isbn: b.isbn,
      genre: b.genre, shelf_id: b.shelf_id, room_id: b.shelves?.room_id ?? null, notes: b.notes,
      status: b.status, created_by: b.created_by,
      shelf_name: b.shelves?.name || null, room_name: b.shelves?.rooms?.name || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/books/:id', async (req: Request, res: Response) => {
  try {
    const existing = await supaGet('books', `id=eq.${req.params.id}&select=id,shelf_id,status,created_by`);
    if (!existing.length) return res.status(404).json({ error: 'Book not found' });
    const cur = existing[0];
    const isPendingOwner = cur.status === 'pending' && cur.created_by === req.user!.id;
    if (!(req.user!.role === 'admin' || isPendingOwner || (await canEditBook(req.user!, cur.shelf_id, cur.shelf_id)))) {
      return res.status(403).json({ error: 'No permission to delete this book' });
    }
    await supaDelete('books', String(req.params.id));
    res.json({ message: 'Book deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========== GENRES ==========

router.get('/genres', async (_req: Request, res: Response) => {
  try {
    const books = await supaGet('books', 'select=genre&genre=not.is.null&genre=neq.&status=eq.approved&order=genre.asc');
    const genres = [...new Set(books.map((b: any) => b.genre))].sort();
    res.json(genres);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========== AUTHORS ==========

router.get('/authors', async (_req: Request, res: Response) => {
  try {
    const books = await supaGet('books', 'select=author&author=not.is.null&author=neq.&status=eq.approved');
    const authors = [...new Set(books.map((b: any) => b.author))].sort();
    res.json(authors);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========== STATS ==========

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [books, rooms, shelves] = await Promise.all([
      supaGetWithCount('books', 'select=id&status=eq.approved'),
      supaGetWithCount('rooms', 'select=id'),
      supaGetWithCount('shelves', 'select=id'),
    ]);
    const unassigned = await supaGetWithCount('books', 'select=id&shelf_id=is.null&status=eq.approved');
    const pendingBooks = await supaGetWithCount('books', 'select=id&status=eq.pending');
    const allBooks = await supaGet('books', 'select=genre&genre=not.is.null&genre=neq.&status=eq.approved');
    const genreCount: Record<string, number> = {};
    allBooks.forEach((b: any) => { genreCount[b.genre] = (genreCount[b.genre] || 0) + 1; });
    const top_genres = Object.entries(genreCount)
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.json({
      total_books: books.total,
      total_rooms: rooms.total,
      total_shelves: shelves.total,
      unassigned_books: unassigned.total,
      pending_books: pendingBooks.total,
      top_genres,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
