/*
 * server/ollama.ts — start Ollama together with the app
 *
 * Photo scanning needs an Ollama server (see scan.ts). On startup, if none
 * is reachable at OLLAMA_URL and the `ollama` command is installed, we start
 * `ollama serve` as a child process and stop it when the app exits. If
 * Ollama is already running (the desktop app, another terminal), it's left
 * alone. Set OLLAMA_AUTOSTART=false to turn this off.
 */

import { spawn, type ChildProcess } from 'child_process';
import { OLLAMA_URL, OLLAMA_MODEL, isOllamaUp, isScanAvailable } from './scan';

let child: ChildProcess | null = null;

function isLocal(url: string): boolean {
  const { hostname } = new URL(url);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function stopChild() {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  child = null;
}

/** Starts `ollama serve` if needed. Never throws — scanning is optional. */
export async function startOllamaIfNeeded(): Promise<void> {
  if (process.env.OLLAMA_AUTOSTART === 'false' || !isLocal(OLLAMA_URL)) return;
  if (await isOllamaUp()) return reportModel();

  const { port } = new URL(OLLAMA_URL);
  child = spawn('ollama', ['serve'], {
    stdio: 'ignore',
    env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${port || 11434}` },
  });
  child.on('error', (err: NodeJS.ErrnoException) => {
    child = null;
    if (err.code === 'ENOENT') {
      console.log('[scan] Ollama is not installed — "add books from a photo" is disabled (see README)');
    } else {
      console.error('[scan] Could not start Ollama:', err.message);
    }
  });

  process.on('exit', stopChild);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopChild();
      process.exit(0);
    });
  }

  // `ollama serve` is usually up within a second or two
  for (let i = 0; i < 20 && child; i++) {
    if (await isOllamaUp()) {
      console.log('[scan] Started Ollama');
      return reportModel();
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (child) console.error('[scan] Ollama did not start in time — photo scanning may be unavailable');
}

async function reportModel() {
  if (!(await isScanAvailable())) {
    console.log(`[scan] Model ${OLLAMA_MODEL} is not installed. Run once: ollama pull ${OLLAMA_MODEL}`);
  }
}
