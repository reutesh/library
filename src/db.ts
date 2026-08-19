const SUPABASE_URL = 'https://taxcwrlegxjomavwqars.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ASKIw8Ydi6up6evrPiLQfQ_aYPQ8l6o';

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

async function supaGet(table: string, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function supaPost(table: string, body: Record<string, unknown>) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json())[0];
}

async function supaUpdate(table: string, id: number | string, body: Record<string, unknown>) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json())[0];
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

export { supaGet, supaPost, supaUpdate, supaDelete };
