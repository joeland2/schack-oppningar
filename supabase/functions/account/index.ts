// account: Chess Labs accounts, for players without Lichess. Chess.com lets no other site log its players
// in, so an account here is an email and a password (kept by Supabase Auth, never by us) with a Chess.com
// name linked to it, the name being checked with Chess.com and linked to one account only.
// POST ?signup { email, password, chesscom } and POST ?login { email, password } give { token, name }:
// token is cl_… (kept here only hashed, in site_sessions) and name is 'cc:<Chess.com name>', which the
// other functions (userdata, messages, supporter, leaderboard) take in place of a Lichess token.
// POST ?logout with the token in x-lichess-token ends that session.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-lichess-token, content-type, apikey, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const URL_ = Deno.env.get('SUPABASE_URL')!;
const db = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
// Signing in on its own client, so the service client never takes on a player's session.
const auth = () => createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } }).auth;
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, 'content-type': 'application/json' } });
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

async function session(player: string, name: string) {
  const token = 'cl_' + hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const { error } = await db.from('site_sessions').insert({ hash: await sha(token), player, name });
  return error ? json({ error: 'Could not log you in. Try again in a minute.' }, 500) : json({ token, name });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'bad' }, 405);
  const q = new URL(req.url).searchParams;
  if (q.has('logout')) {
    const t = req.headers.get('x-lichess-token') || '';
    if (t.startsWith('cl_')) await db.from('site_sessions').delete().eq('hash', await sha(t));
    return json({ ok: true });
  }
  let b: { email?: unknown; password?: unknown; chesscom?: unknown } = {};
  try { b = JSON.parse(await req.text()); } catch { return json({ error: 'bad' }, 400); }
  const email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ error: 'That is not an email address.' }, 400);
  if (password.length < 8 || password.length > 200) return json({ error: 'The password needs at least 8 characters.' }, 400);

  if (q.has('login')) {
    const { data, error } = await auth().signInWithPassword({ email, password });
    if (error || !data.user) return json({ error: 'Wrong email or password.' }, 401);
    const { data: acct } = await db.from('site_accounts').select('player, name').eq('uid', data.user.id).maybeSingle();
    return acct ? session(acct.player, acct.name) : json({ error: 'This account has no Chess.com name. Message the admins.' }, 400);
  }

  if (q.has('signup')) {
    const typed = String(b.chesscom || '').trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_-]{3,25}$/.test(typed)) return json({ error: 'That is not a Chess.com username.' }, 400);
    const cc = await fetch(`https://api.chess.com/pub/player/${typed.toLowerCase()}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!cc) return json({ error: `Chess.com has no player called ${typed}.` }, 400);
    const player = `cc:${typed.toLowerCase()}`, name = `cc:${typed}`;
    const { data: taken } = await db.from('site_accounts').select('uid').eq('player', player).maybeSingle();
    if (taken) return json({ error: `${typed} is already linked to a Chess Labs account. If it is yours, message the admins.` }, 409);
    // shortcut: no limit on sign-ups per visitor; add one (or a captcha) if fake accounts show up
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) return json({ error: /already/i.test(error?.message || '') ? 'There is already an account with that email. Log in instead.' : 'Could not make the account. Try again in a minute.' }, 400);
    const { error: e2 } = await db.from('site_accounts').insert({ uid: data.user.id, player, name });
    if (e2) { await db.auth.admin.deleteUser(data.user.id); return json({ error: `${typed} is already linked to a Chess Labs account.` }, 409); }
    return session(player, name);
  }
  return json({ error: 'bad' }, 400);
});
