/*
 * server/index.ts — Express application bootstrap
 *
 * Sets up middleware (body + cookie parsing), mounts the API router,
 * and serves the built client from dist/ with an SPA fallback. A global
 * error handler sits at the bottom so that every thrown error is caught
 * and returned as a clean JSON response instead of leaking stack traces.
 */

import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { router } from './routes';
import { bootstrapAdmin } from './auth';

const missing = ['SUPABASE_URL', 'SUPABASE_KEY', 'SESSION_SECRET'].filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')} (see .env.example)`);
  process.exit(1);
}

// The server needs the secret (service_role) key; the public key is blocked by RLS.
const supabaseKey = process.env.SUPABASE_KEY!;
const jwtRole = supabaseKey.startsWith('eyJ')
  ? JSON.parse(Buffer.from(supabaseKey.split('.')[1] ?? '', 'base64url').toString() || '{}').role
  : undefined;
if (supabaseKey.startsWith('sb_publishable_') || jwtRole === 'anon') {
  console.error('SUPABASE_KEY is the public key. Use the secret / service_role key (Settings → API Keys).');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT ?? 3000;
const clientDir = path.join(__dirname, '..', 'dist');

// ── Middleware ───────────────────────────────────────────────
app.disable('etag');
app.use(express.json());
app.use(cookieParser());

// ── API routes (never cached) ───────────────────────────────
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, router);

// ── Built client ────────────────────────────────────────────
// Vite fingerprints everything under assets/, so those can be cached forever.
app.use(express.static(clientDir, {
  index: false,
  setHeaders(res, filePath) {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// ── Catch-all → single-page app ─────────────────────────────
// Paths with a file extension that static didn't serve are real 404s.
app.get(/^(?!\/api).*/, (req, res, next) => {
  if (req.path.includes('.')) return next();

  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(clientDir, 'index.html'), (err) => {
    if (err) {
      res
        .status(503)
        .send('Client not built. Run `npm run build:ui` or use `npm run dev`.');
    }
  });
});

// ── Global error handler ────────────────────────────────────
// Catches any unhandled error thrown inside route handlers and
// returns a safe JSON error response.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

bootstrapAdmin()
  .then(() => {
    app.listen(PORT, () => console.log(`Library Manager listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('[startup] Could not reach the database:', err);
    process.exit(1);
  });
