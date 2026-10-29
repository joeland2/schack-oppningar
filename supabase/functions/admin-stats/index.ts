// admin-stats: the numbers behind Chess Trainer's admin page, for the admin only.
// The page sends its Lichess login token; this asks Lichess whose it is and answers only for ADMIN.
// Reads the events table with the service key Supabase gives every Edge Function (never in the page).
import { createClient } from 'npm:@supabase/supabase-js@2';

const ADMIN = 'joelandersson';
const DAYS = 30;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-lichess-token, content-type, apikey, authorization',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const token = req.headers.get('x-lichess-token');
  if (!token) return json({ error: 'Log in with Lichess first.' }, 401);
  const me = await fetch('https://lichess.org/api/account', { headers: { Authorization: `Bearer ${token}` } });
  if (!me.ok) return json({ error: 'Lichess did not accept the login. Log in again.' }, 401);
  const { id } = await me.json();
  if (id !== ADMIN) return json({ error: 'This page is for the admin only.' }, 403);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const since = new Date(Date.now() - DAYS * 864e5).toISOString();
  let rows: { at: string; kind: string; page: string | null; target: string | null; visitor: string; user_name: string | null }[] = [];
  for (let from = 0; ; from += 1000) { // shortcut: reads every event of the last 30 days; move the counting into SQL past ~100k events
    const { data, error } = await db.from('events').select('at, kind, page, target, visitor, user_name').gte('at', since).order('at').range(from, from + 999);
    if (error) return json({ error: error.message }, 500);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  // The admin's own visits stay out: every browser that was ever logged in as the admin, and the setup test.
  const own = new Set(rows.filter((r) => r.user_name?.toLowerCase() === ADMIN).map((r) => r.visitor).concat('claude-setup-test'));
  rows = rows.filter((r) => !own.has(r.visitor));

  const count = (xs: (string | null)[]) => Object.entries(xs.reduce((m, x) => (x ? { ...m, [x]: (m[x] || 0) + 1 } : m), {} as Record<string, number>))
    .sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, n]) => ({ name, n }));
  const views = rows.filter((r) => r.kind === 'view');
  const days: Record<string, { views: number; visitors: Set<string> }> = {};
  for (let d = DAYS - 1; d >= 0; d--) days[new Date(Date.now() - d * 864e5).toISOString().slice(0, 10)] = { views: 0, visitors: new Set() };
  for (const r of views) { const d = days[r.at.slice(0, 10)]; if (d) { d.views++; d.visitors.add(r.visitor); } }
  const logins: Record<string, { n: number; last: string }> = {};
  for (const r of rows) if (r.user_name) logins[r.user_name] = { n: (logins[r.user_name]?.n || 0) + 1, last: r.at };

  return json({
    days: DAYS,
    totals: {
      visitors: new Set(views.map((r) => r.visitor)).size,
      views: views.length,
      loggedIn: Object.keys(logins).length,
      today: days[new Date().toISOString().slice(0, 10)]?.visitors.size ?? 0,
    },
    perDay: Object.entries(days).map(([day, d]) => ({ day, views: d.views, visitors: d.visitors.size })),
    pages: count(views.map((r) => r.page)),
    profiles: count(rows.filter((r) => r.kind === 'profile').map((r) => r.target)),
    compares: count(rows.filter((r) => r.kind === 'compare').map((r) => r.target)),
    usage: count(rows.filter((r) => r.kind !== 'view' && r.kind !== 'profile').map((r) => r.kind)),
    practised: count(rows.filter((r) => r.kind === 'practise').map((r) => r.target)),
    users: Object.entries(logins).sort((a, b) => b[1].last.localeCompare(a[1].last)).map(([name, x]) => ({ name, n: x.n, last: x.last })),
  });
});
