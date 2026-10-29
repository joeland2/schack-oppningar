// analyses: the engine work done here on a player's games (full analyses, the move-12 look), kept per
// player so every device sees it, logged in or not. GET ?u=name returns them; POST { player, rows }
// adds or replaces some. Open to anyone, like the work itself: each row is checked and cut to size.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, 'content-type': 'application/json' } });
const NAME = /^[A-Za-z0-9_-]{2,30}$/, ID = /^[A-Za-z0-9]{8}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method === 'GET') {
    const player = (new URL(req.url).searchParams.get('u') || '').toLowerCase();
    if (!NAME.test(player)) return json({ error: 'bad' }, 400);
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('analyses').select('id, data').eq('player', player).range(from, from + 999);
      if (error) return json({ error: 'error' }, 500);
      out.push(...data);
      if (data.length < 1000) break;
    }
    return json(out);
  }
  if (req.method !== 'POST') return json({ error: 'bad' }, 405);
  let body: Record<string, any> = {};
  try { body = JSON.parse(await req.text()); } catch { return json({ error: 'bad' }, 400); }
  const player = String(body.player || '').toLowerCase();
  if (!NAME.test(player) || !Array.isArray(body.rows)) return json({ error: 'bad' }, 400);
  const rows = body.rows.slice(0, 600).filter((r: any) => ID.test(r?.id) && r.data && typeof r.data === 'object' && JSON.stringify(r.data).length < 8000)
    .map((r: any) => ({ player, id: r.id, data: r.data, at: new Date().toISOString() }));
  if (!rows.length) return json({ ok: true });
  const { error } = await db.from('analyses').upsert(rows);
  return error ? json({ error: 'error' }, 500) : json({ ok: true });
});
