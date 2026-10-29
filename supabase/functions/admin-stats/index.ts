// admin-stats: the numbers behind Chess Trainer's admin page, for the admin only.
// The page sends its Lichess login token; this asks Lichess whose it is and answers only for ADMIN.
// Reads the events table with the service key Supabase gives every Edge Function (never in the page).
import { createClient } from 'npm:@supabase/supabase-js@2';

const ADMIN = 'joelandersson';
const DAYS = 30;
const TZ = 'Europe/Stockholm'; // hours and weekdays are the admin's
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-lichess-token, content-type, apikey, authorization',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
type Row = { at: string; kind: string; page: string | null; target: string | null; visitor: string; user_name: string | null; ip: string | null; country: string | null; city: string | null; device: string | null; source: string | null };

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
  let rows: Row[] = [];
  for (let from = 0; ; from += 1000) { // shortcut: reads every event of the last 30 days; move the counting into SQL past ~100k events
    const { data, error } = await db.from('events').select('at, kind, page, target, visitor, user_name, ip, country, city, device, source').gte('at', since).order('at').range(from, from + 999);
    if (error) return json({ error: error.message }, 500);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  // The admin's own visits stay out: every browser that was ever logged in as the admin, and the setup test.
  const own = new Set(rows.filter((r) => r.user_name?.toLowerCase() === ADMIN).map((r) => r.visitor).concat('claude-setup-test'));
  rows = rows.filter((r) => !own.has(r.visitor));

  // [name, count] lists, most first; `unique` counts each visitor once per value.
  const count = (xs: (string | null)[]) => Object.entries(xs.reduce((m, x) => (x ? { ...m, [x]: (m[x] || 0) + 1 } : m), {} as Record<string, number>))
    .sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, n]) => ({ name, n }));
  const unique = (rs: Row[], key: (r: Row) => string | null) => count([...new Map(rs.map((r) => [`${r.visitor}|${key(r)}`, key(r)])).values()]);
  const views = rows.filter((r) => r.kind === 'view');
  const day = (iso: string) => iso.slice(0, 10), today = day(new Date().toISOString());
  const within = (d: number) => views.filter((r) => Date.now() - Date.parse(r.at) < d * 864e5);
  const visitorsIn = (rs: Row[]) => new Set(rs.map((r) => r.visitor)).size;

  const days: Record<string, { views: number; visitors: Set<string> }> = {};
  for (let d = DAYS - 1; d >= 0; d--) days[day(new Date(Date.now() - d * 864e5).toISOString())] = { views: 0, visitors: new Set() };
  for (const r of views) { const d = days[day(r.at)]; if (d) { d.views++; d.visitors.add(r.visitor); } }

  // Each visitor (a browser): where from, the device, the pages seen, where they came from, the last visit.
  const who: Record<string, { ip: string | null; country: string | null; city: string | null; device: string | null; source: string | null; name: string | null; pages: Record<string, number>; views: number; last: string }> = {};
  for (const r of rows) {
    const w = (who[r.visitor] ??= { ip: null, country: null, city: null, device: null, source: null, name: null, pages: {}, views: 0, last: r.at });
    w.last = r.at; w.ip = r.ip ?? w.ip; w.country = r.country ?? w.country; w.city = r.city ?? w.city;
    w.device = r.device ?? w.device; w.source ??= r.source; w.name = r.user_name ?? w.name;
    if (r.kind === 'view' && r.page) { w.views++; w.pages[r.page] = (w.pages[r.page] || 0) + 1; }
  }
  const visitors = Object.values(who).filter((w) => w.views);
  const logins: Record<string, { n: number; last: string }> = {};
  for (const r of rows) if (r.user_name) logins[r.user_name] = { n: (logins[r.user_name]?.n || 0) + 1, last: r.at };

  const local = (iso: string, opt: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opt }).format(new Date(iso));
  const hours = Array(24).fill(0), weekdays = Array(7).fill(0), WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (const r of views) { hours[Number(local(r.at, { hour: '2-digit', hourCycle: 'h23' }))]++; weekdays[WD.indexOf(local(r.at, { weekday: 'short' }))]++; }
  const mobile = visitors.filter((w) => /iPhone|Android/.test(w.device || '')).length;
  const todays = views.filter((r) => day(r.at) === today);

  return json({
    days: DAYS,
    totals: {
      today: visitorsIn(todays), todayViews: todays.length, week: visitorsIn(within(7)), weekViews: within(7).length,
      visitors: visitorsIn(views), views: views.length, mobile: visitors.length ? mobile / visitors.length : 0,
      loggedIn: Object.keys(logins).length,
    },
    perDay: Object.entries(days).map(([d, x]) => ({ day: d, views: x.views, visitors: x.visitors.size })),
    pages: count(views.map((r) => r.page)).map((x) => ({ ...x, unique: visitorsIn(views.filter((r) => r.page === x.name)) })),
    sources: unique(rows.filter((r) => r.source), (r) => r.source),
    countries: count(visitors.map((w) => w.country ?? '–')),
    cities: count(visitors.filter((w) => w.city).map((w) => `${w.city}, ${w.country ?? ''}`)),
    devices: count(visitors.map((w) => w.device ?? 'Unknown')),
    hours, weekdays,
    profiles: count(rows.filter((r) => r.kind === 'profile').map((r) => r.target)),
    compares: count(rows.filter((r) => r.kind === 'compare').map((r) => r.target)),
    usage: count(rows.filter((r) => r.kind !== 'view' && r.kind !== 'profile').map((r) => r.kind)),
    practised: count(rows.filter((r) => r.kind === 'practise').map((r) => r.target)),
    visitors: visitors.sort((a, b) => b.last.localeCompare(a.last)).slice(0, 60),
    users: Object.entries(logins).sort((a, b) => b[1].last.localeCompare(a[1].last)).map(([name, x]) => ({ name, n: x.n, last: x.last })),
  });
});
