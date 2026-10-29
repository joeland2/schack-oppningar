// userdata: what a logged-in player keeps on the site (stars and progress in every opening, favourites,
// starred players, settings), so every device they log in on shows the same. The Lichess login is the
// key: the token is checked with Lichess, and only that player's own row is read or written.
// GET returns { data }; POST { data } merges keys in, the newer of two values (by its time t) winning.
// data is { [key]: { v: string | null, t: number } }, v being the browser's stored text (null: removed).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-lichess-token, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, 'content-type': 'application/json' } });
const KEY = /^[A-Za-z0-9:._-]{1,80}$/, MAX = 900_000; // characters in all, a player's whole store

// Lichess says whose token it is; kept a while so a page's few calls ask Lichess once.
const who = new Map<string, { id: string; at: number }>();
async function idOf(token: string | null) {
  if (!token) return null;
  const c = who.get(token);
  if (c && Date.now() - c.at < 600_000) return c.id;
  const r = await fetch('https://lichess.org/api/account', { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const { id } = await r.json();
  who.set(token, { id, at: Date.now() });
  return id as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const id = await idOf(req.headers.get('x-lichess-token'));
  if (!id) return json({ error: 'Log in with Lichess first.' }, 401);
  const { data: row, error } = await db.from('user_data').select('data').eq('id', id).maybeSingle();
  if (error) return json({ error: 'error' }, 500);
  const have: Record<string, { v: string | null; t: number }> = row?.data || {};
  if (req.method === 'GET') return json({ data: have });
  if (req.method !== 'POST') return json({ error: 'bad' }, 405);
  let body: Record<string, any> = {};
  try { body = JSON.parse(await req.text()); } catch { return json({ error: 'bad' }, 400); }
  if (!body.data || typeof body.data !== 'object') return json({ error: 'bad' }, 400);
  for (const [k, x] of Object.entries(body.data as Record<string, any>)) {
    if (!KEY.test(k) || !x || typeof x.t !== 'number' || !(x.v === null || typeof x.v === 'string')) continue;
    if (!have[k] || x.t > have[k].t) have[k] = { v: x.v, t: x.t };
  }
  if (JSON.stringify(have).length > MAX) return json({ error: 'Too much to keep.' }, 413);
  const { error: e2 } = await db.from('user_data').upsert({ id, data: have, updated_at: new Date().toISOString() });
  return e2 ? json({ error: 'error' }, 500) : json({ data: have });
});
