# Library Manager

A library management app for organizing books into rooms and shelves. Built with React + Express + Supabase.

## Setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Open the **SQL Editor** and run the contents of `schema.sql` to create the tables
3. Go to **Settings → API Keys** and copy your **Project URL** and a **secret key** (`sb_secret_…`, or the legacy `service_role` key). The server refuses to start with the public key: `schema.sql` enables Row Level Security, which locks it out.

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your Supabase credentials:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-secret-key
SESSION_SECRET=any-long-random-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

`SESSION_SECRET` signs login sessions — use a long random string. If the users table is empty on first launch, an initial admin account is created from `ADMIN_USERNAME` / `ADMIN_PASSWORD` — change that password after the first login.

In production, set `NODE_ENV=production` and serve the app over HTTPS so the session cookie is marked `Secure`.

### 3. Install and run

```bash
npm install
npm run build
npm start
```

The app runs at [http://localhost:3000](http://localhost:3000)

### Development

Run the API and the UI in separate terminals or use the combined script:

```bash
npm run dev          # starts the API and the Vite UI together
npm run dev:api      # Express API on http://localhost:3000
npm run dev:ui       # Vite UI on http://localhost:5173
```

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
| editor | everything | only rooms assigned to them (and rooms they create) |
| viewer | everything | nothing |

Books that are not placed on any shelf (pending books) can only be edited/deleted by admins and by the user who created them.

## Tech Stack

- **Frontend:** React 19 + TypeScript (Vite, react-router, fetch + Context)
- **Backend:** Express 5
- **Database:** Supabase (PostgreSQL + PostgREST)
