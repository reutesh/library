/*
 * schema.sql — Supabase database schema for Library Manager
 *
 * Tables:
 *   rooms     – physical library rooms
 *   shelves   – shelves within rooms (each room has shelves)
 *   books     – the book catalogue (approved or pending)
 *   app_users – login accounts with role-based access
 *
 * Run this ONCE via the Supabase SQL Editor to bootstrap the database.
 */

-- ============================================================
-- Rooms
-- ============================================================
CREATE TABLE IF NOT EXISTS rooms (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- ============================================================
-- Shelves
-- ============================================================
CREATE TABLE IF NOT EXISTS shelves (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE(room_id, name)
);

-- ============================================================
-- Books
--   status:     'approved' = visible to everyone
--               'pending'  = visible only to creator + admins
--   created_by: stores who created the book (FK is NOT enforced
--               so the user can be deleted without losing books)
-- ============================================================
CREATE TABLE IF NOT EXISTS books (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  isbn TEXT,
  genre TEXT,
  notes TEXT,
  shelf_id BIGINT REFERENCES shelves(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','pending')),
  created_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- App Users
--   role:            admin | editor | viewer
--   allowed_room_ids: for editors — array of room IDs they may edit
-- ============================================================
CREATE TABLE IF NOT EXISTS app_users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','editor','viewer')),
  allowed_room_ids BIGINT[] DEFAULT '{}'
);

-- ============================================================
-- Indexes — speed up the most common query patterns
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_books_shelf_id ON books(shelf_id);
CREATE INDEX IF NOT EXISTS idx_books_status   ON books(status);
CREATE INDEX IF NOT EXISTS idx_books_genre    ON books(genre);
CREATE INDEX IF NOT EXISTS idx_books_author   ON books(author);
CREATE INDEX IF NOT EXISTS idx_books_title    ON books(title);
CREATE INDEX IF NOT EXISTS idx_shelves_room_id ON shelves(room_id);
