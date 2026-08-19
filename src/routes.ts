import { Router, Request, Response } from 'express';
import { supaGet, supaPost, supaUpdate, supaDelete } from './db';

const router = Router();

// ========== ROOMS ==========

router.get('/rooms', async (_req: Request, res: Response) => {
  try {
    const rooms = await supaGet('rooms', 'select=*,shelves(books(id))');
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

router.post('/rooms', async (req: Request, res: Response) => {
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

router.put('/rooms/:id', async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const room = await supaUpdate('rooms', req.params.id, { name });
    res.json({ id: room.id, name: room.name });
  } catch (err: any) {
    if (err.message.includes('duplicate')) return res.status(409).json({ error: 'Room name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/rooms/:id', async (req: Request, res: Response) => {
  try {
    await supaDelete('rooms', req.params.id);
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
    const shelf = await supaUpdate('shelves', req.params.id, { room_id, name });
    res.json({ id: shelf.id, room_id: shelf.room_id, name: shelf.name });
  } catch (err: any) {
    if (err.message.includes('duplicate')) return res.status(409).json({ error: 'Shelf name already exists in this room' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/shelves/:id', async (req: Request, res: Response) => {
  try {
    await supaDelete('shelves', req.params.id);
    res.json({ message: 'Shelf deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========== BOOKS ==========

router.get('/books', async (req: Request, res: Response) => {
  try {
    const { shelf_id, room_id, genre, author, search } = req.query;
    let query = 'select=*,shelves(name,rooms(name))';
    const filters: string[] = [];

    if (shelf_id) filters.push(`shelf_id=eq.${shelf_id}`);
    if (room_id) filters.push(`shelves.rooms.id=eq.${room_id}`);
    if (genre) filters.push(`genre=eq.${encodeURIComponent(String(genre))}`);
    if (author) {
      const term = encodeURIComponent(`%${author}%`);
      filters.push(`author.ilike.${term}`);
    }
    if (search) {
      const term = encodeURIComponent(`%${search}%`);
      filters.push(`or(title.ilike.${term},author.ilike.${term},isbn.ilike.${term},genre.ilike.${term})`);
    }
    if (filters.length) query += '&' + filters.join('&');

    const books = await supaGet('books', query);
    const result = books.map((b: any) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      isbn: b.isbn,
      genre: b.genre,
      shelf_id: b.shelf_id,
      notes: b.notes,
      shelf_name: b.shelves?.name || null,
      room_name: b.shelves?.rooms?.name || null,
      created_at: b.created_at,
      updated_at: b.updated_at,
    }));
    result.sort((a: any, b: any) => a.title.localeCompare(b.title));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/books/:id', async (req: Request, res: Response) => {
  try {
    const books = await supaGet('books', `id=eq.${req.params.id}&select=*,shelves(name,rooms(name))`);
    if (!books.length) return res.status(404).json({ error: 'Book not found' });
    const b = books[0];
    res.json({
      id: b.id,
      title: b.title,
      author: b.author,
      isbn: b.isbn,
      genre: b.genre,
      shelf_id: b.shelf_id,
      notes: b.notes,
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
    const book = await supaPost('books', {
      title, author: author || null, isbn: isbn || null,
      genre: genre || null, shelf_id: shelf_id || null, notes: notes || null,
    });
    const full = await supaGet('books', `id=eq.${book.id}&select=*,shelves(name,rooms(name))`);
    const b = full[0];
    res.status(201).json({
      id: b.id, title: b.title, author: b.author, isbn: b.isbn,
      genre: b.genre, shelf_id: b.shelf_id, notes: b.notes,
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
    await supaUpdate('books', req.params.id, {
      title, author: author || null, isbn: isbn || null,
      genre: genre || null, shelf_id: shelf_id || null, notes: notes || null,
      updated_at: new Date().toISOString(),
    });
    const books = await supaGet('books', `id=eq.${req.params.id}&select=*,shelves(name,rooms(name))`);
    if (!books.length) return res.status(404).json({ error: 'Book not found' });
    const b = books[0];
    res.json({
      id: b.id, title: b.title, author: b.author, isbn: b.isbn,
      genre: b.genre, shelf_id: b.shelf_id, notes: b.notes,
      shelf_name: b.shelves?.name || null, room_name: b.shelves?.rooms?.name || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/books/:id', async (req: Request, res: Response) => {
  try {
    await supaDelete('books', req.params.id);
    res.json({ message: 'Book deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========== GENRES ==========

router.get('/genres', async (_req: Request, res: Response) => {
  try {
    const books = await supaGet('books', 'select=genre&genre=not.is.null&genre=neq.');
    const genres = [...new Set(books.map((b: any) => b.genre))].sort();
    res.json(genres);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========== STATS ==========

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [books, rooms, shelves] = await Promise.all([
      supaGet('books', 'select=id'),
      supaGet('rooms', 'select=id'),
      supaGet('shelves', 'select=id'),
    ]);
    const unassigned = await supaGet('books', 'select=id&shelf_id=is.null');
    const allBooks = await supaGet('books', 'select=genre&genre=not.is.null&genre=neq.');
    const genreCount: Record<string, number> = {};
    allBooks.forEach((b: any) => { genreCount[b.genre] = (genreCount[b.genre] || 0) + 1; });
    const top_genres = Object.entries(genreCount)
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.json({
      total_books: books.length,
      total_rooms: rooms.length,
      total_shelves: shelves.length,
      unassigned_books: unassigned.length,
      top_genres,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
