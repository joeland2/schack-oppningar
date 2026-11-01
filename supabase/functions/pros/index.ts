// pros: the known pros' and streamers' games, fetched here so visitors need not wait for Lichess.
// POST ?refresh=1 (every 5 minutes, from pg_cron): the account kept longest ago gets its last 1000 rated
// games fetched again into the public bucket "pros": a Lichess account as <name>.ndjson, the same lines
// Lichess sends; a Chess.com one as cc_<name>.json, the games as Chess.com's monthly archives give them.
// The profile reads that first and asks the site only for the games since.
// POST ?week=1 (every 6 hours): week.json, each person's last 7 days (games, score, blitz rating change,
// the opening played most) from their Lichess file and Chess.com's monthly archives.
// Keep ACCOUNTS in step with PRO_NAMES and VIP_NAMES in profile.js.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, 'content-type': 'application/json' } });
const BUCKET = 'pros', MAX = 1000, DAY = 864e5;

// [account, person, kind]; a Chess.com account is cc:name.
const ACCOUNTS: [string, string, 'pro' | 'vip'][] = [
  ['DrNykterstein', 'Magnus Carlsen', 'pro'], ['DrDrunkenstein', 'Magnus Carlsen', 'pro'], ['DannyTheDonkey', 'Magnus Carlsen', 'pro'], ['manwithavan', 'Magnus Carlsen', 'pro'],
  ['MagnusCarlsen', 'Magnus Carlsen', 'pro'], ['alireza2003', 'Alireza Firouzja', 'pro'], ['nihalsarin2004', 'Nihal Sarin', 'pro'], ['penguingim1', 'Andrew Tang', 'pro'],
  ['Zhigalko_Sergei', 'Sergei Zhigalko', 'pro'], ['Vladimirovich9000', 'Dmitry Andreikin', 'pro'], ['may6enexttime', 'Aleksei Sarana', 'pro'], ['Night-King96', 'Oleksandr Bortnyk', 'pro'],
  ['Konevlad', 'Vladislav Artemiev', 'pro'], ['AnishGiri', 'Anish Giri', 'pro'], ['RebeccaHarris', 'Daniel Naroditsky', 'pro'], ['DanielNaroditsky', 'Daniel Naroditsky', 'pro'],
  ['EricRosen', 'Eric Rosen', 'pro'], ['Fins', 'John Bartholomew', 'pro'],
  ['cc:Hikaru', 'Hikaru Nakamura', 'pro'], ['cc:MagnusCarlsen', 'Magnus Carlsen', 'pro'], ['cc:FabianoCaruana', 'Fabiano Caruana', 'pro'], ['cc:DanielNaroditsky', 'Daniel Naroditsky', 'pro'],
  ['cc:Firouzja2003', 'Alireza Firouzja', 'pro'], ['cc:NihalSarin', 'Nihal Sarin', 'pro'], ['cc:AnishGiri', 'Anish Giri', 'pro'], ['cc:Penguingm1', 'Andrew Tang', 'pro'], ['cc:IMRosen', 'Eric Rosen', 'pro'],
  ['cc:LachesisQ', 'Ian Nepomniachtchi', 'pro'], ['cc:LevonAronian', 'Levon Aronian', 'pro'], ['cc:Duhless', 'Daniil Dubov', 'pro'], ['cc:FairChess_on_YouTube', 'Dmitry Andreikin', 'pro'],
  ['cc:GMBenjaminBok', 'Benjamin Bok', 'pro'], ['cc:Jospem', 'Jose Martinez', 'pro'], ['cc:GMHess', 'Robert Hess', 'pro'],
  ['agadmator', 'Antonio Radić', 'vip'], ['tigerlilov', 'Valeri Lilov', 'vip'], ['cc:agadmator', 'Antonio Radić', 'vip'], ['cc:tigerlilov', 'Valeri Lilov', 'vip'], ['cc:GothamChess', 'Levy Rozman', 'vip'],
  ['cc:AnnaCramling', 'Anna Cramling', 'vip'], ['cc:AlexandraBotez', 'Alexandra Botez', 'vip'], ['cc:NemsKo', 'Nemo Zhou', 'vip'], ['cc:Chessbrah', 'Eric Hansen', 'vip'],
  ['cc:ChessNetwork', 'Jerry (ChessNetwork)', 'vip'], ['cc:TheChessNerd', 'Zachary Saine', 'vip'],
];
const isCC = (a: string) => a.startsWith('cc:');
const file = (a: string) => (isCC(a) ? `cc_${a.slice(3).toLowerCase()}.json` : `${a.toLowerCase()}.ndjson`);
const UA = { 'User-Agent': 'chess-trainer (joeland2.github.io/schack-oppningar)' };

// One game, the same few fields from either site, for the week.
type G = { at: number; speed: string; white: boolean; score: number; rating: number; opening: string | null };

async function refresh() {
  const all = ACCOUNTS.map(([a]) => a);
  const { data: files } = await db.storage.from(BUCKET).list('', { limit: 500 });
  const when = new Map((files || []).map((f) => [f.name, Date.parse(f.updated_at || f.created_at || '') || 0]));
  const a = all.sort((x, y) => (when.get(file(x)) || 0) - (when.get(file(y)) || 0))[0];
  if (Date.now() - (when.get(file(a)) || 0) < 4 * 60e3) return { skipped: a }; // a second call within the 5 minutes does nothing
  if (isCC(a)) return refreshCC(a);
  const res = await fetch(`https://lichess.org/api/games/user/${a}?` + new URLSearchParams({
    max: String(MAX), rated: 'true', perfType: 'bullet,blitz,rapid,classical', moves: 'true', opening: 'true', clocks: 'true', evals: 'true', accuracy: 'true',
  }), { headers: { Accept: 'application/x-ndjson' } });
  if (!res.ok) return { account: a, error: res.status };
  const text = await res.text();
  const { error } = await db.storage.from(BUCKET).upload(file(a), text, { upsert: true, contentType: 'application/x-ndjson', cacheControl: '600' });
  const gs = lichessGames(a, text);
  await db.storage.from(BUCKET).upload(`${a.toLowerCase()}.json`, JSON.stringify(gs), { upsert: true, contentType: 'application/json', cacheControl: '600' });
  return { account: a, games: gs.length, error: error?.message };
}

// A Chess.com account: its last MAX rated standard games in bullet, blitz and rapid, newest first, from
// the monthly archives (newest month first), as Chess.com gives them; the profile makes them over itself.
async function refreshCC(a: string) {
  const u = a.slice(3).toLowerCase();
  const list = await fetch(`https://api.chess.com/pub/player/${u}/games/archives`, { headers: UA }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!list) return { account: a, error: 'archives' };
  const games: unknown[] = [];
  for (const url of [...(list.archives || [])].reverse()) {
    if (games.length >= MAX) break;
    const month = await fetch(url, { headers: UA }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    for (const g of [...(month?.games || [])].reverse()) {
      if (games.length >= MAX) break;
      if (g.rated && g.rules === 'chess' && ['bullet', 'blitz', 'rapid'].includes(g.time_class) && g.pgn) games.push(g);
    }
  }
  const { error } = await db.storage.from(BUCKET).upload(file(a), JSON.stringify(games), { upsert: true, contentType: 'application/json', cacheControl: '600' });
  return { account: a, games: games.length, error: error?.message };
}

// The few fields the week needs, of every game in a Lichess file: kept beside it as <name>.json, so the
// week reads small files instead of parsing every account's games again (CPU time is short here).
function lichessGames(a: string, text: string): G[] {
  const id = a.toLowerCase();
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((g) => g.variant === 'standard').map((g) => {
    const white = g.players.white.user?.id === id, me = g.players[white ? 'white' : 'black'];
    return { at: g.createdAt, speed: g.speed, white, score: g.winner ? (g.winner === (white ? 'white' : 'black') ? 1 : 0) : 0.5, rating: me.rating + (me.ratingDiff || 0), opening: g.opening?.name?.split(':')[0] || null };
  });
}
async function lichessWeek(a: string, since: number): Promise<G[]> {
  const { data } = await db.storage.from(BUCKET).download(`${a.toLowerCase()}.json`);
  return data ? (JSON.parse(await data.text()) as G[]).filter((g) => g.at >= since) : [];
}

// An opening's family from Chess.com's ECOUrl slug, as Lichess names it: the words up to Defense, Opening,
// Game, Gambit, Attack or System ('Sicilian-Defense-Open-2...Nc6' → Sicilian Defense).
function family(slug?: string) {
  if (!slug || /^undefined/i.test(slug)) return null;
  const words = slug.split('-').filter((w) => /^[A-Za-z']+$/.test(w)), end = words.findIndex((w) => /^(Defense|Opening|Game|Gambit|Attack|System)$/i.test(w));
  return (end >= 0 ? words.slice(0, end + 1) : words.slice(0, 2)).join(' ').replace(/\b(King|Queen|Bishop|Alekhine|Owen|Petrov|Bird|Larsen|Philidor)s\b/g, "$1's") || null;
}
console.assert(family('Sicilian-Defense-Open-2...Nc6') === 'Sicilian Defense' && family('Kings-Indian-Attack') === "King's Indian Attack" && family('Undefined') === null, 'family');

async function ccWeek(a: string, since: number): Promise<G[]> {
  const u = a.slice(3).toLowerCase(), out: G[] = [];
  for (const d of [new Date(), new Date(since)]) {
    const r = await fetch(`https://api.chess.com/pub/player/${u}/games/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`, { headers: UA });
    const month = r.ok ? await r.json().catch(() => null) : null;
    for (const g of month?.games || []) {
      if (!g.rated || g.rules !== 'chess' || g.end_time * 1000 < since || out.some((x) => x.at === g.end_time * 1000)) continue;
      const white = g.white.username.toLowerCase() === u, me = white ? g.white : g.black;
      const res = me.result === 'win' ? 1 : ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(me.result) ? 0.5 : 0;
      const eco = /\[ECOUrl "[^"]*\/openings\/([^"]+)"\]/.exec(g.pgn || '')?.[1];
      out.push({ at: g.end_time * 1000, speed: g.time_class, white, score: res, rating: me.rating, opening: family(eco) });
    }
    if (d.getUTCMonth() === new Date(since).getUTCMonth()) break; // the week is all in this month
  }
  return out;
}

// Per person: the games of the last 7 days on all their accounts, the blitz rating change on the account
// with most blitz games, the score, and the opening played most as White and as Black.
async function week() {
  const since = Date.now() - 7 * DAY, people = new Map<string, { kind: string; accounts: string[]; games: G[]; blitz: Map<string, G[]> }>();
  for (const [a, who, kind] of ACCOUNTS) {
    const gs = await (isCC(a) ? ccWeek(a, since) : lichessWeek(a, since)).catch(() => []);
    const p = people.get(who) ?? { kind, accounts: [], games: [], blitz: new Map() };
    p.accounts.push(a); p.games.push(...gs); p.blitz.set(a, gs.filter((g) => g.speed === 'blitz').sort((x, y) => x.at - y.at));
    people.set(who, p);
  }
  const top = (gs: G[]) => { const m = new Map<string, number[]>(); for (const g of gs) if (g.opening) m.set(g.opening, [...(m.get(g.opening) || []), g.score]);
    const [name, s] = [...m.entries()].sort((x, y) => y[1].length - x[1].length)[0] || []; return name ? { name, games: s!.length, score: s!.reduce((a, b) => a + b, 0) / s!.length } : null; };
  const rows = [...people.entries()].map(([who, p]) => {
    const [acct, bl] = [...p.blitz.entries()].sort((x, y) => y[1].length - x[1].length)[0];
    return { who, kind: p.kind, accounts: p.accounts, account: acct, games: p.games.length, score: p.games.length ? p.games.reduce((a, g) => a + g.score, 0) / p.games.length : null,
      blitz: bl.length ? bl.at(-1)!.rating : null, change: bl.length > 1 ? bl.at(-1)!.rating - bl[0].rating : 0, blitzGames: bl.length,
      white: top(p.games.filter((g) => g.white)), black: top(p.games.filter((g) => !g.white)),
      last: p.games.length ? Math.max(...p.games.map((g) => g.at)) : null };
  });
  // Of the week: the most blitz rating gained in the 7 days before, among those with at least 20 blitz
  // games; chosen at the first count of each week (from Monday, UTC) and kept, with its numbers, all week.
  const best = (kind: string) => rows.filter((r) => r.kind === kind && r.blitzGames >= 20).sort((x, y) => y.change - x.change || y.games - x.games)[0] ?? null;
  const day = new Date(), monday = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - (day.getUTCDay() + 6) % 7)).toISOString().slice(0, 10);
  const { data: old } = await db.storage.from(BUCKET).download('week.json');
  const kept = old ? JSON.parse(await old.text()).pick : null;
  const pick = kept?.week === monday ? kept : { week: monday, pro: best('pro'), vip: best('vip') };
  const out = { at: Date.now(), pick, people: rows };
  const { error } = await db.storage.from(BUCKET).upload('week.json', JSON.stringify(out), { upsert: true, contentType: 'application/json', cacheControl: '600' });
  return { week: pick.week, pro: pick.pro?.who, vip: pick.vip?.who, people: rows.length, error: error?.message };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const q = new URL(req.url).searchParams;
  try {
    if (q.has('refresh')) return json(await refresh());
    if (q.has('week')) return json(await week());
  } catch (err) { return json({ error: String(err) }, 500); }
  return json({ error: 'refresh or week' }, 400);
});
