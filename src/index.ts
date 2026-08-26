/*
 * src/index.ts — Express application bootstrap
 *
 * Sets up middleware (CORS, body parsing, static files, cookie parsing)
 * and mounts the API router.  A global error handler sits at the bottom
 * so that every thrown error is caught and returned as a clean JSON
 * response instead of leaking stack traces.
 */

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { router } from './routes';

const app = express();
const PORT = process.env.PORT ?? 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Serve the built client from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── API routes ──────────────────────────────────────────────
app.use('/api', router);

// ── Catch-all → single-page app ─────────────────────────────
app.get('{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Global error handler ────────────────────────────────────
// Catches any unhandled error thrown inside route handlers and
// returns a safe JSON error response.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Library Manager listening on http://localhost:${PORT}`);
});
