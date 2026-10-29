// admin-stats: the numbers behind Chess Trainer's admin page, for the admins only.
// The page sends its Lichess login token; this asks Lichess whose it is and answers only for ADMINS.
// Reads the events table with the service key Supabase gives every Edge Function (never in the page).
import { createClient } from 'npm:@supabase/supabase-js@2';

const ADMINS = ['joelandersson', 'sicko88'];
const DAYS = 30; // the lists (pages, countries, …) cover the last 30 days; visitors and the graph all time
const TZ = 'Europe/Stockholm'; // hours and weekdays are the admin's
// Not people: the setup test, the assistant's test browser, and automated browsers in Amazon's cloud
// (Santa Clara, a fresh id every time) seen before the track function started dropping cloud visits.
const HIDDEN_VISITORS = ['claude-setup-test', 'dee060a2-46e4-4e44-b494-db238f21c17a'];
const BOT_IPS = ['13.57.148.0', '54.183.149.0'];
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
  if (!ADMINS.includes(id)) return json({ error: 'This page is for the admins only.' }, 403);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let rows: Row[] = [];
  for (let from = 0; ; from += 1000) { // shortcut: reads every event ever; move the counting into SQL past ~100k events
    const { data, error } = await db.from('events').select('at, kind, page, target, visitor, user_name, ip, country, city, device, source').order('at').range(from, from + 999);
    if (error) return json({ error: error.message }, 500);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  // Everyone who has ever logged in here with Lichess (the admins too): the profiles created.
  const registered = [...new Set(rows.map((r) => r.user_name).filter(Boolean))] as string[];
  // The admins' own visits stay out (every browser that was ever logged in as one), and so do the hidden ones.
  const own = new Set(rows.filter((r) => ADMINS.includes(r.user_name?.toLowerCase() ?? '')).map((r) => r.visitor).concat(HIDDEN_VISITORS));
  rows = rows.filter((r) => !own.has(r.visitor) && !BOT_IPS.includes(r.ip ?? ''));

  const day = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(iso)); // YYYY-MM-DD, Swedish days
  const views = rows.filter((r) => r.kind === 'view');

  // Each visitor (a browser), all time: where from, the device, the Lichess name, the first and last
  // visit, and what they did, newest first.
  const who: Record<string, { id: string; ip: string | null; country: string | null; city: string | null; device: string | null; source: string | null; name: string | null; views: number; first: string; last: string; events: { at: string; kind: string; page: string | null; target: string | null }[] }> = {};
  for (const r of rows) {
    const w = (who[r.visitor] ??= { id: r.visitor, ip: null, country: null, city: null, device: null, source: null, name: null, views: 0, first: r.at, last: r.at, events: [] });
    w.last = r.at; w.ip = r.ip ?? w.ip; w.country = r.country ?? w.country; w.city = r.city ?? w.city;
    w.device = r.device ?? w.device; w.source ??= r.source; w.name = r.user_name ?? w.name;
    if (r.kind === 'view') w.views++;
    w.events.push({ at: r.at, kind: r.kind, page: r.page, target: r.target });
  }
  const visitors = Object.values(who).filter((w) => w.views);

  // Per day from the first event: new visitors (seen that day for the first time ever), all visitors
  // that day, and page views.
  const days: Record<string, { fresh: number; visitors: Set<string>; views: number }> = {};
  const first = rows.length ? Date.parse(rows[0].at) : Date.now();
  for (let t = first; t <= Date.now(); t += 864e5) days[day(new Date(t).toISOString())] ??= { fresh: 0, visitors: new Set(), views: 0 };
  for (const r of views) { const d = days[day(r.at)]; if (d) { d.views++; d.visitors.add(r.visitor); } }
  for (const w of visitors) { const d = days[day(w.first)]; if (d) d.fresh++; }
  const today = day(new Date().toISOString());
  // Visitors in the last n days: each counted once (seen at all), and unique ones (their very first visit).
  const seenIn = (n: number) => new Set(views.filter((r) => Date.now() - Date.parse(r.at) < n * 864e5).map((r) => r.visitor)).size;
  const newIn = (n: number) => visitors.filter((w) => Date.now() - Date.parse(w.first) < n * 864e5).length;

  // The lists cover the last DAYS days. [name, count], most first; `unique` counts each visitor once per value.
  const recent = rows.filter((r) => Date.now() - Date.parse(r.at) < DAYS * 864e5), recentViews = recent.filter((r) => r.kind === 'view');
  const recentVisitors = visitors.filter((w) => Date.now() - Date.parse(w.last) < DAYS * 864e5);
  const count = (xs: (string | null)[]) => Object.entries(xs.reduce((m, x) => (x ? { ...m, [x]: (m[x] || 0) + 1 } : m), {} as Record<string, number>))
    .sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, n]) => ({ name, n }));
  const unique = (rs: Row[], key: (r: Row) => string | null) => count([...new Map(rs.map((r) => [`${r.visitor}|${key(r)}`, key(r)])).values()]);
  const visitorsIn = (rs: Row[]) => new Set(rs.map((r) => r.visitor)).size;
  const local = (iso: string, opt: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opt }).format(new Date(iso));
  const hours = Array(24).fill(0), weekdays = Array(7).fill(0), WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (const r of recentViews) { hours[Number(local(r.at, { hour: '2-digit', hourCycle: 'h23' }))]++; weekdays[WD.indexOf(local(r.at, { weekday: 'short' }))]++; }
  const mobile = recentVisitors.filter((w) => /iPhone|Android/.test(w.device || '')).length;
  const logins: Record<string, { n: number; last: string }> = {};
  for (const r of recent) if (r.user_name) logins[r.user_name] = { n: (logins[r.user_name]?.n || 0) + 1, last: r.at };

  return json({
    days: DAYS,
    totals: {
      today: visitors.filter((w) => day(w.last) === today).length, newToday: visitors.filter((w) => day(w.first) === today).length,
      week: seenIn(7), new7: newIn(7), month: seenIn(DAYS), new30: newIn(DAYS), all: visitors.length, views: views.length, registered: registered.length,
      mobile: recentVisitors.length ? mobile / recentVisitors.length : 0, loggedIn: Object.keys(logins).length,
    },
    perDay: Object.entries(days).map(([d, x]) => ({ day: d, fresh: x.fresh, visitors: x.visitors.size, views: x.views })),
    pages: count(recentViews.map((r) => r.page)).map((x) => ({ ...x, unique: visitorsIn(recentViews.filter((r) => r.page === x.name)) })),
    sources: unique(recent.filter((r) => r.source), (r) => r.source),
    countries: count(recentVisitors.map((w) => w.country ?? '–')),
    cities: count(recentVisitors.filter((w) => w.city).map((w) => `${w.city}, ${w.country ?? ''}`)),
    devices: count(recentVisitors.map((w) => w.device ?? 'Unknown')),
    hours, weekdays,
    profiles: count(rows.filter((r) => r.kind === 'profile').map((r) => r.target)), // all time
    // The latest profiles looked up, newest first, with where the visitor was.
    recentProfiles: rows.filter((r) => r.kind === 'profile').slice(-40).reverse().map((r) => ({ at: r.at, target: r.target, name: r.user_name, country: r.country, city: r.city, device: r.device })),
    registered: registered.sort((a, b) => a.localeCompare(b)),
    compares: count(recent.filter((r) => r.kind === 'compare').map((r) => r.target)),
    usage: count(recent.filter((r) => r.kind !== 'view' && r.kind !== 'profile').map((r) => r.kind)),
    practised: count(recent.filter((r) => r.kind === 'practise').map((r) => r.target)),
    visitors: visitors.sort((a, b) => b.last.localeCompare(a.last)).slice(0, 300).map((w) => ({ ...w, events: w.events.slice(-150).reverse() })),
    users: Object.entries(logins).sort((a, b) => b[1].last.localeCompare(a[1].last)).map(([name, x]) => ({ name, n: x.n, last: x.last })),
  });
});
