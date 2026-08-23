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
SESSION_SECRET=any-long-random-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

`SESSION_SECRET` signs login sessions — use a long random string. If the users table is empty on first launch, an initial admin account is created from `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

### 3. Install and run

```bash
npm install
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000)

## Features

- **Login system with roles**: admin (full access), editor (view all, edit only assigned rooms), viewer (read-only)
- Admins manage users from a dedicated page: create accounts, change roles, assign editable rooms, reset passwords
- Organize books into **rooms** and **shelves**
- Full CRUD for books, rooms, and shelves (enforced on the server per role)
- Server-side **pagination** for the books list
- Search and filter books by title, author, genre, room, or shelf
- Hebrew RTL interface

## Roles

| Role | View | Edit |
|------|------|------|
| admin | everything | everything + user management |
| editor | everything | only rooms explicitly assigned to them |
| viewer | everything | nothing |

Books that are not placed on any shelf can only be edited/deleted by admins.

## Tech Stack

- **Frontend:** Vanilla TypeScript (bundled with esbuild)
- **Backend:** Express 5
- **Database:** Supabase (PostgreSQL + PostgREST)
