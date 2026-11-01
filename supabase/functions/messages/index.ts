// messages: a logged-in player's thread with the admins. The Lichess login is the key: the token is
// checked with Lichess; a player reads and writes only their own thread, an admin every thread.
// GET: your thread, [{ at, author, body }]. An admin: GET ?threads (every thread's last message, newest
// first) and GET ?player=<id> (that thread). POST { body } adds to your thread; an admin adds { to }.
import { createClient } from 'npm:@supabase/supabase-js@2';

const ADMINS = ['joelandersson', 'sicko88'];
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-lichess-token, content-type, apikey, authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, 'content-type': 'application/json' } });

// Lichess says whose token it is; kept a while so polling asks Lichess once in ten minutes.
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
const thread = async (player: string) => {
  const { data, error } = await db.from('messages').select('at, author, body').eq('player', player).order('at').limit(500);
  return error ? json({ error: 'error' }, 500) : json(data);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const id = await idOf(req.headers.get('x-lichess-token'));
  if (!id) return json({ error: 'Log in with Lichess first.' }, 401);
  const admin = ADMINS.includes(id), q = new URL(req.url).searchParams;
  if (req.method === 'GET') {
    if (admin && q.has('threads')) {
      // shortcut: reads the newest 2000 messages; group in SQL once there are many more
      const { data, error } = await db.from('messages').select('at, player, author, body').order('at', { ascending: false }).limit(2000);
      if (error) return json({ error: 'error' }, 500);
      const last = new Map<string, { player: string; at: string; author: string; body: string; n: number }>();
      for (const m of data || []) { const t = last.get(m.player); if (t) t.n++; else last.set(m.player, { ...m, n: 1 }); }
      return json([...last.values()]);
    }
    return thread(admin && q.get('player') ? q.get('player')!.toLowerCase().slice(0, 30) : id);
  }
  if (req.method !== 'POST') return json({ error: 'bad' }, 405);
  let b: { body?: unknown; to?: unknown } = {};
  try { b = JSON.parse(await req.text()); } catch { return json({ error: 'bad' }, 400); }
  const body = typeof b.body === 'string' ? b.body.trim().slice(0, 2000) : '';
  if (!body) return json({ error: 'Write something first.' }, 400);
  const player = admin && typeof b.to === 'string' && b.to ? b.to.toLowerCase().slice(0, 30) : id;
  // At most 20 messages a player in an hour, so the thread cannot be flooded.
  if (!admin) {
    const { count } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('author', id).gte('at', new Date(Date.now() - 36e5).toISOString());
    if ((count ?? 0) >= 20) return json({ error: 'That is a lot of messages: try again in a while.' }, 429);
  }
  const { error } = await db.from('messages').insert({ player, author: id, body });
  if (error) return json({ error: 'error' }, 500);
  return thread(player);
});
