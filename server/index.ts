/*
 * src/index.ts — Express application bootstrap
 *
 * Sets up middleware (CORS, body parsing, static files, cookie parsing)
 * and mounts the API router.  A global error handler sits at the bottom
 * so that every thrown error is caught and returned as a clean JSON
 * response instead of leaking stack traces.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { router } from './routes';
import { bootstrapAdmin } from './auth';

const app = express();
const PORT = process.env.PORT ?? 3000;

// ── Middleware ───────────────────────────────────────────────
app.disable('etag');
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// ── Static client (Vite build → /dist) ───────────────────────
const clientDir = path.join(__dirname, '..', 'dist');
app.use(express.static(clientDir, {
  setHeaders(res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
  },
}));

// ── API routes (no browser caching) ─────────────────────────
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
}, router);

// ── Catch-all → single-page app ─────────────────────────────
app.get('{*path}', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, async () => {
  await bootstrapAdmin();
  console.log(`Library Manager listening on http://localhost:${PORT}`);
});
