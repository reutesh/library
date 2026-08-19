# Library Manager

A library management app for organizing books into rooms and shelves. Built with Express + Supabase.

## Setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Open the **SQL Editor** and run the contents of `schema.sql` to create the tables
3. Go to **Settings → API** and copy your **Project URL** and **anon/public key**

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your Supabase credentials:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
```

### 3. Install and run

```bash
npm install
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000)

## Features

- Organize books into **rooms** and **shelves**
- Full CRUD for books, rooms, and shelves
- Search and filter books by title, author, genre, room, or shelf
- Client-side caching for fast navigation
- Hebrew RTL interface

## Tech Stack

- **Frontend:** Vanilla TypeScript (bundled with esbuild)
- **Backend:** Express 5
- **Database:** Supabase (PostgreSQL + PostgREST)
