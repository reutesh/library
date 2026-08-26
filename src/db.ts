import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY in environment variables');
  process.exit(1);
}

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

async function supaGet<T = Record<string, unknown>>(table: string, query = ''): Promise<T[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T[]>;
}

async function supaGetWithCount<T = Record<string, unknown>>(table: string, query = ''): Promise<{ data: T[]; total: number }> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { headers: { ...headers, Prefer: 'count=exact' } });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as T[];
  const range = res.headers.get('content-range');
  let total = data.length;
  if (range && range.includes('/')) {
    const parsed = parseInt(range.split('/')[1], 10);
    if (!Number.isNaN(parsed)) total = parsed;
  }
  return { data, total };
}

async function supaPost<T = Record<string, unknown>>(table: string, body: Record<string, unknown>): Promise<T> {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return ((await res.json()) as T[])[0];
}

async function supaUpdate<T = Record<string, unknown>>(table: string, id: number | string, body: Record<string, unknown>): Promise<T> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return ((await res.json()) as T[])[0];
}

async function supaDelete(table: string, id: number | string) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 || res.status === 200;
}

export { supaGet, supaGetWithCount, supaPost, supaUpdate, supaDelete };
