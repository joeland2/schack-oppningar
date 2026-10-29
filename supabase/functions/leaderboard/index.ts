// leaderboard: the players who chose to be on the leaderboard.
// GET returns every row. POST { token, card } adds or updates the caller's own row, DELETE { token }
// removes all of it: the Lichess token is checked with Lichess, and the row is always stored under
// the name Lichess gives back, so nobody can write someone else's row.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS' };
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const SPEEDS = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
const SKILLS = ['Attack', 'Defense', 'Early game', 'Late game', 'Accuracy', 'Speed'];
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, 'content-type': 'application/json' } });
const int = (x: unknown, lo: number, hi: number) => (Number.isFinite(x) ? Math.round(Math.max(lo, Math.min(hi, x as number))) : null);
const num = (x: unknown, lo: number, hi: number) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, x as number)) : null);
const str = (x: unknown, n: number) => (typeof x === 'string' && x ? x.slice(0, n) : null);

async function whoIs(token: unknown) {
  if (typeof token !== 'string' || !token) return null;
  const r = await fetch('https://lichess.org/api/account', { headers: { Authorization: `Bearer ${token}` } });
  return r.ok ? ((await r.json()).username as string) : null;
}

// Only the fields the board shows, each checked and cut to size.
function rowOf(name: string, c: Record<string, any>) {
  if (!SPEEDS.includes(c.speed)) return null;
  const skills: Record<string, number | null> = {};
  for (const k of SKILLS) skills[k] = int(c.skills?.[k], 0, 99);
  const openings = (Array.isArray(c.openings) ? c.openings : []).slice(0, 12)
    .map((o: any) => ({ fam: str(o?.fam, 60), side: o?.side === 'b' ? 'b' : 'w', n: int(o?.n, 0, 100000), score: num(o?.score, 0, 1) }))
    .filter((o: any) => o.fam && o.n !== null && o.score !== null);
  const rating = int(c.rating, 0, 4000), games = int(c.games, 0, 100000);
  if (rating === null || games === null) return null;
  return { name, speed: c.speed, rating, games, analysed: int(c.analysed, 0, 100000) ?? 0, overall: int(c.overall, 0, 99), style: str(c.style, 30), strength: str(c.strength, 30), piece: ['n', 'b', 'r', 'q'].includes(c.piece) ? c.piece : null,
    stars: { green: int(c.stars?.green, 0, 100000) ?? 0, gold: int(c.stars?.gold, 0, 100000) ?? 0, diamond: int(c.stars?.diamond, 0, 100000) ?? 0 },
    skills, gambit_games: int(c.gambit_games, 0, 100000) ?? 0, gambit_score: num(c.gambit_score, 0, 1), openings, updated: new Date().toISOString() };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method === 'GET') {
    const { data, error } = await db.from('players').select('name, speed, rating, games, analysed, overall, style, strength, piece, stars, skills, gambit_games, gambit_score, openings, updated').limit(5000);
    return error ? json({ error: 'error' }, 500) : json(data);
  }
  let body: Record<string, any> = {};
  try { body = JSON.parse(await req.text()); } catch { return json({ error: 'bad' }, 400); }
  const name = await whoIs(body.token);
  if (!name) return json({ error: 'not logged in' }, 401);
  if (req.method === 'DELETE') {
    const { error } = await db.from('players').delete().eq('name', name);
    return error ? json({ error: 'error' }, 500) : json({ ok: true });
  }
  if (req.method !== 'POST') return json({ error: 'bad' }, 405);
  const row = rowOf(name, body.card || {});
  if (!row) return json({ error: 'bad card' }, 400);
  const { error } = await db.from('players').upsert(row);
  return error ? json({ error: 'error' }, 500) : json({ ok: true });
});
