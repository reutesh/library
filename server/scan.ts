/*
 * server/scan.ts — recognize books in a photo with a local vision model
 *
 * The client sends one photo (base64) that may show several books — covers
 * or spines. A vision model running in Ollama (free, on this machine or any
 * machine reachable at OLLAMA_URL) returns the title and author it reads for
 * each book, which the user then confirms or corrects before anything is saved.
 *
 * Config (all optional):
 *   OLLAMA_URL    – default http://localhost:11434
 *   OLLAMA_MODEL  – default qwen2.5vl:7b
 *
 * If Ollama isn't running or the model isn't pulled, the feature reports
 * itself as unavailable and the rest of the app works normally.
 */

import { z } from 'zod';

export const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5vl:7b';

/**
 * Context window for the scan request. Ollama's default (4096 on a 16 GB Mac)
 * is too small: a 2000px photo alone is ~4000 image tokens.
 */
const SCAN_NUM_CTX = 16384;

/** Local models are slow on a laptop — a busy photo can take a minute or two. */
const SCAN_TIMEOUT_MS = 3 * 60 * 1000;

export const SCAN_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ScanMediaType = (typeof SCAN_MEDIA_TYPES)[number];

const ScanResultSchema = z.object({
  books: z.array(
    z.object({
      title: z.string(),
      author: z.string().nullable(),
      confidence: z.enum(['high', 'medium', 'low']),
    }),
  ),
});

export type ScannedBook = z.infer<typeof ScanResultSchema>['books'][number];

/** JSON schema handed to Ollama so the model's reply is constrained to this shape. */
const RESPONSE_FORMAT = z.toJSONSchema(ScanResultSchema);

const PROMPT = `This photo shows one or more books (covers, spines on a shelf, or a stack).
List every book you can identify, in order from left to right / top to bottom.

For each book:
- title: the title copied character by character exactly as printed on the book.
- author: the author's name copied exactly as printed, or null if it is not visible.
- confidence: "high" if the text is clearly legible, "medium" if partly legible, "low" if you are guessing.

Never translate or transliterate: an English title stays in English, a Hebrew title stays in Hebrew, and the same goes for author names.
Do not guess well-known titles — only write text you can actually see.
Skip objects that are not books. If a spine is unreadable, skip it rather than inventing a title.
If there are no readable books, return {"books": []}.`;

/** Scripts that never belong in a Hebrew/English library — a sign of misread letters. */
const FOREIGN_SCRIPT = /[\u0600-\u06FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;
/** A single word mixing Hebrew with another alphabet, e.g. "תmol". */
const MIXED_WORD = /[\u0590-\u05FF](?:(?![\u0590-\u05FF])\p{L})|(?:(?![\u0590-\u05FF])\p{L})[\u0590-\u05FF]/u;

/** Hebrew vowel points / cantillation marks — some models add niqqud the book doesn't have. */
const NIQQUD = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;

/** Strips niqqud and collapses line breaks / repeated spaces. */
function clean(text: string): string {
  return text.replace(NIQQUD, '').replace(/\s+/g, ' ').trim();
}

/** True when the model's text looks garbled even if it claimed high confidence. */
function looksGarbled(text: string): boolean {
  return FOREIGN_SCRIPT.test(text) || MIXED_WORD.test(text);
}

/** A failure the user can act on (Ollama down, model missing...). */
export class ScanUnavailableError extends Error {}

/** Names of the installed models, or null if Ollama isn't reachable. */
async function installedModels(): Promise<string[] | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const { models } = (await res.json()) as { models?: { name: string }[] };
    return models?.map((m) => m.name) ?? [];
  } catch {
    return null;
  }
}

/** True when an Ollama server answers at OLLAMA_URL. */
export async function isOllamaUp(): Promise<boolean> {
  return (await installedModels()) !== null;
}

/** True when Ollama is reachable and the configured model is installed. */
export async function isScanAvailable(): Promise<boolean> {
  // "qwen2.5vl" and "qwen2.5vl:latest" are the same model
  const wanted = OLLAMA_MODEL.includes(':') ? OLLAMA_MODEL : `${OLLAMA_MODEL}:latest`;
  return !!(await installedModels())?.includes(wanted);
}

/** Sends the photo to the local model and returns the books it recognized. */
export async function scanBooks(imageBase64: string): Promise<ScannedBook[]> {
  let res: globalThis.Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: RESPONSE_FORMAT,
        options: { temperature: 0, num_ctx: SCAN_NUM_CTX },
        messages: [{ role: 'user', content: PROMPT, images: [imageBase64] }],
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new ScanUnavailableError('Recognition took too long. Try a photo with fewer books.');
    }
    throw new ScanUnavailableError(`Ollama is not running at ${OLLAMA_URL}`);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 404) {
      throw new ScanUnavailableError(`Model ${OLLAMA_MODEL} is not installed. Run: ollama pull ${OLLAMA_MODEL}`);
    }
    throw new Error(`Ollama error ${res.status}: ${body.error ?? 'unknown'}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  let parsed: z.infer<typeof ScanResultSchema>;
  try {
    parsed = ScanResultSchema.parse(JSON.parse(data.message?.content ?? ''));
  } catch {
    console.error('[scan] unparseable model output:', data.message?.content);
    throw new ScanUnavailableError('The model returned an unreadable answer. Try again.');
  }

  return parsed.books
    .map((b) => {
      const title = clean(b.title);
      const author = clean(b.author ?? '') || null;
      // Small models sometimes slip Latin/Arabic/Chinese letters into Hebrew words — flag for review.
      const garbled = looksGarbled(title) || looksGarbled(author ?? '');
      // A bare number is usually a series number on the spine, not a title.
      const numberOnly = /^\d+$/.test(title);
      return { title, author, confidence: garbled || numberOnly ? 'low' : b.confidence } as ScannedBook;
    })
    .filter((b) => b.title);
}
