/*
 * client/src/api.ts — API client and shared types
 *
 * Thin fetch wrappers around the Express REST API.  Every call points at
 * `/api/...`, which Vite proxies to the backend in dev and is served by
 * Express in production.  Errors throw an Error with the server's message.
 */

export interface Me {
  id: number;
  username: string;
  role: 'admin' | 'editor' | 'viewer';
  allowedRoomIds: number[];
}

export interface Room {
  id: number;
  name: string;
  bookCount: number;
}

export interface Shelf {
  id: number;
  roomId: number;
  name: string;
  bookCount: number;
}

export interface Book {
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

export interface User {
  id: number;
  username: string;
  role: string;
  allowedRoomIds: number[];
}

export interface BookPage {
  items: Book[];
  total: number;
  page: number;
  limit: number;
}

export interface Stats {
  books: number;
  shelves: number;
  rooms: number;
  users: number;
  pendingBooks: number;
}

export interface BookInput {
  title: string;
  author?: string | null;
  isbn?: string | null;
  genre?: string | null;
  notes?: string | null;
  shelf_id?: number | null;
}

interface ErrBody {
  error?: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    cache: 'no-store',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as ErrBody;
      if (body.error) message = body.error;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // ── Auth ──────────────────────────────────────────────
  login(username: string, password: string) {
    return request<Me>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  logout() {
    return request<{ ok: boolean }>('/auth/logout', { method: 'POST' });
  },
  me() {
    return request<Me>('/auth/me');
  },
  changePassword(current_password: string, new_password: string) {
    return request<{ ok: boolean }>('/auth/me', {
      method: 'PUT',
      body: JSON.stringify({ current_password, new_password }),
    });
  },

  // ── Books ─────────────────────────────────────────────
  books(params: URLSearchParams) {
    return request<BookPage>(`/books?${params.toString()}`);
  },
  book(id: number) {
    return request<Book>(`/books/${id}`);
  },
  createBook(data: BookInput) {
    return request<Book>('/books', { method: 'POST', body: JSON.stringify(data) });
  },
  updateBook(id: number, data: BookInput) {
    return request<Book>(`/books/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  deleteBook(id: number) {
    return request<{ ok: boolean }>(`/books/${id}`, { method: 'DELETE' });
  },
  genres() {
    return request<string[]>('/genres');
  },
  authors() {
    return request<string[]>('/authors');
  },

  // ── Rooms & shelves ───────────────────────────────────
  rooms() {
    return request<Room[]>('/rooms');
  },
  createRoom(name: string) {
    return request<Room>('/rooms', { method: 'POST', body: JSON.stringify({ name }) });
  },
  deleteRoom(id: number) {
    return request<{ ok: boolean }>(`/rooms/${id}`, { method: 'DELETE' });
  },
  shelves(roomId: number) {
    return request<Shelf[]>(`/rooms/${roomId}/shelves`);
  },
  createShelf(roomId: number, name: string) {
    return request<Shelf>(`/rooms/${roomId}/shelves`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },
  deleteShelf(id: number) {
    return request<{ ok: boolean }>(`/shelves/${id}`, { method: 'DELETE' });
  },

  // ── Users (admin) ─────────────────────────────────────
  users() {
    return request<User[]>('/users');
  },
  createUser(data: Record<string, unknown>) {
    return request<User>('/users', { method: 'POST', body: JSON.stringify(data) });
  },
  updateUser(id: number, data: Record<string, unknown>) {
    return request<User>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  deleteUser(id: number) {
    return request<{ ok: boolean }>(`/users/${id}`, { method: 'DELETE' });
  },

  // ── Stats ─────────────────────────────────────────────
  stats() {
    return request<Stats>('/stats');
  },
};