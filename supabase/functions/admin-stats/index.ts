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
// The site went public with a Reddit post at 20:49 Swedish time on 29 Oct 2026. Every browser seen before
// that was a bot, the owner or the assistant testing, so visitors whose first visit is earlier are left out.
const LAUNCH = '2026-10-29T19:45:00Z';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-lichess-token, content-type, apikey, authorization',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
type Row = { at: string; kind: string; page: string | null; target: string | null; visitor: string; user_name: string | null; ip: string | null; country: string | null; city: string | null; device: string | null; source: string | null };

// insights:start (tools/test-insights.mjs runs this part on made-up events)
// The overview, the openings and the errors: from the events left after the filters above.
type Ev = { at: string; kind: string; target: string | null; visitor: string };
type Run = { k: string; m: string; s: string; o: string; l: string; x: number; p: number; f?: string; w?: string; g?: string };
function insights(rows: Ev[], now = Date.now()) {
  const DAY = 864e5, dayNo = (iso: string) => Math.floor(Date.parse(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(iso))) / DAY);
  const today = dayNo(new Date(now).toISOString()), ago = (iso: string) => (now - Date.parse(iso)) / DAY;
  const runOf = (r: Ev): Run | null => { try { return r.kind === 'line' ? JSON.parse(r.target ?? '') : null; } catch { return null; } };
  const done = (r: Ev) => (r.kind === 'line' && runOf(r)?.k === 'done') || (r.kind === 'practise' && !!r.target?.startsWith('done '));
  // Each visitor: the days they were here (Swedish days), their first, and what they did when.
  const who = new Map<string, { first: number; days: Set<number>; ev: Ev[] }>();
  for (const r of rows) { const w = who.get(r.visitor) ?? { first: dayNo(r.at), days: new Set<number>(), ev: [] }; w.days.add(dayNo(r.at)); w.ev.push(r); who.set(r.visitor, w); }
  // The four numbers: the last 7 days against the 7 before.
  const inSpan = (r: Ev, from: number, to: number) => ago(r.at) >= from && ago(r.at) < to;
  const span = (from: number, to: number) => {
    const rs = rows.filter((r) => inSpan(r, from, to));
    // Came back: of the visitors new 7–14 days before the span's end, the share seen again on a later day within 7 days.
    const fresh = [...who.values()].filter((w) => today - w.first >= 7 + from && today - w.first < 14 + from);
    return { visitors: new Set(rs.map((r) => r.visitor)).size, profiles: rs.filter((r) => r.kind === 'profile').length, finished: rs.filter(done).length,
      back: fresh.length ? [...fresh].filter((w) => [...w.days].some((d) => d > w.first && d <= w.first + 7)).length / fresh.length : null };
  };
  // How far the visitors of the last 7 days got, each step a share of all of them.
  const week = [...who.entries()].filter(([, w]) => w.ev.some((r) => ago(r.at) < 7));
  const did = (f: (r: Ev) => boolean) => week.filter(([, w]) => w.ev.some((r) => ago(r.at) < 7 && f(r))).length;
  const funnel = [['Visited', week.length], ['Looked up a profile', did((r) => r.kind === 'profile')], ['Opened an opening', did((r) => r.kind === 'practise' || r.kind === 'line')],
    ['Finished a line', did(done)], ['Came back another day', week.filter(([, w]) => w.days.size > 1).length]].map(([name, n]) => ({ name, n }));
  // Come back: per week of the first visit (Monday first), the share seen again within 1, 7 and 30 days; null while too new to tell.
  const monday = (d: number) => d - ((d + 3) % 7); // day 0 (1 Jan 1970) was a Thursday
  const cohorts = new Map<number, { first: number; days: Set<number> }[]>();
  for (const w of who.values()) cohorts.set(monday(w.first), [...(cohorts.get(monday(w.first)) ?? []), w]);
  const retention = [...cohorts.entries()].sort((a, b) => b[0] - a[0]).slice(0, 6).map(([wk, ws]) => ({
    week: new Date(wk * DAY).toISOString().slice(0, 10), n: ws.length,
    ...Object.fromEntries([1, 7, 30].map((n) => [`d${n}`, today - wk < n + 7 ? null : ws.filter((w) => [...w.days].some((d) => d > w.first && d <= w.first + n)).length / ws.length])),
  }));
  // Openings, the last 30 days: per opening and colour, then per line, the runs, the people, how many
  // were finished, the mistakes a run, and the lines finished in each mode.
  const runs = rows.filter((r) => r.kind === 'line' && ago(r.at) < 30).map((r) => ({ r, x: runOf(r)! })).filter(({ x }) => x?.o);
  const tally = () => ({ runs: 0, done: 0, misses: 0, people: new Set<string>(), learn: 0, try: 0, time: 0 });
  const ops = new Map<string, ReturnType<typeof tally> & { side: string; name: string; lines: Map<string, ReturnType<typeof tally>> }>();
  for (const { r, x } of runs) {
    const o = ops.get(`${x.s}|${x.o}`) ?? { ...tally(), side: x.s, name: x.o, lines: new Map() };
    const l = o.lines.get(x.l) ?? tally();
    for (const t of [o, l]) { t.runs++; t.misses += x.x || 0; t.people.add(r.visitor); if (x.k === 'done') { t.done++; if (x.m in t) (t as any)[x.m]++; } }
    o.lines.set(x.l, l); ops.set(`${x.s}|${x.o}`, o);
  }
  const plain = ({ people, lines, ...t }: any) => ({ ...t, people: people.size });
  const openings2 = [...ops.values()].sort((a, b) => b.runs - a.runs).slice(0, 30)
    .map((o) => ({ ...plain(o), lines: [...o.lines.entries()].sort((a, b) => b[1].runs - a[1].runs).map(([name, t]) => ({ name, ...plain(t) })) }));
  // The hardest moves: where most runs of a line slip first, with the move most played instead.
  const slips = new Map<string, { side: string; opening: string; line: string; fen: string; want: string; n: number; people: Set<string>; got: Record<string, number> }>();
  for (const { r, x } of runs) {
    if (!x.f || !x.w) continue;
    const k = `${x.s}|${x.o}|${x.f}|${x.w}`, h = slips.get(k) ?? { side: x.s, opening: x.o, line: x.l, fen: x.f, want: x.w, n: 0, people: new Set(), got: {} };
    h.n++; h.people.add(r.visitor); if (x.g) h.got[x.g] = (h.got[x.g] || 0) + 1; slips.set(k, h);
  }
  const hardest = [...slips.values()].map((h) => ({ ...h, people: h.people.size, got: Object.entries(h.got).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    share: Math.min(1, h.n / Math.max(1, ops.get(`${h.side}|${h.opening}`)?.lines.get(h.line)?.runs ?? h.n)) }))
    .sort((a, b) => b.n - a.n || b.share - a.share).slice(0, 8);
  // Errors the site met, the last 30 days, most often first.
  const errs = new Map<string, { n: number; last: string; people: Set<string> }>();
  for (const r of rows) if (r.kind === 'error' && r.target && ago(r.at) < 30) { const e = errs.get(r.target) ?? { n: 0, last: r.at, people: new Set() }; e.n++; e.last = r.at; e.people.add(r.visitor); errs.set(r.target, e); }
  const lookups = rows.filter((r) => r.kind === 'profile' && ago(r.at) < 30);
  return {
    overview: { now: span(0, 7), before: span(7, 14) }, funnel, retention,
    sites: { chesscom: lookups.filter((r) => r.target?.startsWith('cc:')).length, lichess: lookups.filter((r) => !r.target?.startsWith('cc:')).length },
    openings2, hardest, errors: [...errs.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20).map(([text, e]) => ({ text, n: e.n, last: e.last, people: e.people.size })),
  };
}
// insights:end

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
  // Only people: a visitor never seen with a country, device or IP is no browser a person used (the
  // first tests, before those were recorded).
  const seen = new Set(rows.filter((r) => r.country || r.device || r.ip).map((r) => r.visitor));
  rows = rows.filter((r) => seen.has(r.visitor));
  const early = new Set(rows.filter((r) => r.at < LAUNCH).map((r) => r.visitor));
  rows = rows.filter((r) => !early.has(r.visitor));

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
  // The 24 h steps skip today when the first event's time of day is later than now.
  days[day(new Date().toISOString())] ??= { fresh: 0, visitors: new Set(), views: 0 };
  for (const r of views) { const d = days[day(r.at)]; if (d) { d.views++; d.visitors.add(r.visitor); } }
  for (const w of visitors) { const d = days[day(w.first)]; if (d) d.fresh++; }
  const today = day(new Date().toISOString());
  // The last DAYS days per hour (Swedish time, keys 'YYYY-MM-DD HH'), for the graph's Today, 1W and 1M.
  const hourOf = (iso: string) => `${day(iso)} ${new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso))}`;
  const hours48: Record<string, { fresh: number; visitors: Set<string>; views: number }> = {};
  const lately = (iso: string) => Date.now() - Date.parse(iso) < DAYS * 864e5;
  for (const r of views) if (lately(r.at)) { const h = hours48[hourOf(r.at)] ??= { fresh: 0, visitors: new Set(), views: 0 }; h.views++; h.visitors.add(r.visitor); }
  for (const w of visitors) if (lately(w.first)) (hours48[hourOf(w.first)] ??= { fresh: 0, visitors: new Set(), views: 0 }).fresh++;
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
    ...insights(rows),
    days: DAYS,
    totals: {
      today: visitors.filter((w) => day(w.last) === today).length, newToday: visitors.filter((w) => day(w.first) === today).length,
      week: seenIn(7), new7: newIn(7), month: seenIn(DAYS), new30: newIn(DAYS), all: visitors.length, views: views.length, registered: registered.length,
      mobile: recentVisitors.length ? mobile / recentVisitors.length : 0, loggedIn: Object.keys(logins).length,
    },
    perDay: Object.entries(days).map(([d, x]) => ({ day: d, fresh: x.fresh, visitors: x.visitors.size, views: x.views })),
    perHour: Object.entries(hours48).map(([h, x]) => ({ hour: h, fresh: x.fresh, visitors: x.visitors.size, views: x.views })),
    pages: count(recentViews.map((r) => r.page)).map((x) => ({ ...x, unique: visitorsIn(recentViews.filter((r) => r.page === x.name)) })),
    sources: unique(recent.filter((r) => r.source), (r) => r.source),
    countries: count(recentVisitors.map((w) => w.country ?? '–')),
    cities: count(recentVisitors.filter((w) => w.city).map((w) => `${w.city}, ${w.country ?? ''}`)),
    devices: count(recentVisitors.map((w) => w.device ?? 'Unknown')),
    hours, weekdays,
    profiles: count(rows.filter((r) => r.kind === 'profile').map((r) => r.target?.split(' #')[0] ?? null)), // all time; ' #…' is the card shown
    // The latest profiles looked up, newest first, with where the visitor was.
    recentProfiles: rows.filter((r) => r.kind === 'profile').slice(-40).reverse().map((r) => ({ at: r.at, target: r.target, name: r.user_name, country: r.country, city: r.city, device: r.device })),
    // The latest cards downloaded and analyses started (a profile's games, or one game), newest first.
    // Older events carry no player name: the profile that visitor looked up last before it stands in.
    recentActions: (() => {
      const last: Record<string, string> = {}, out = [];
      for (const r of rows) {
        if (r.kind === 'profile' && r.target) last[r.visitor] = r.target.split(' #')[0];
        else if (r.kind === 'card' || r.kind === 'analyse') {
          const named = /[:·]/.test(r.target ?? '');
          out.push({ at: r.at, kind: r.kind, target: named ? r.target : `${last[r.visitor] ?? 'unknown profile'} · ${r.target ?? ''}`, name: r.user_name, country: r.country, city: r.city, device: r.device });
        }
      }
      return out.slice(-40).reverse();
    })(),
    registered: registered.sort((a, b) => a.localeCompare(b)),
    compares: count(recent.filter((r) => r.kind === 'compare').map((r) => r.target)),
    usage: count(recent.filter((r) => r.kind !== 'view' && r.kind !== 'profile').map((r) => r.kind)),
    practised: count(recent.filter((r) => r.kind === 'practise' && !r.target?.startsWith('done ')).map((r) => r.target)),
    // Per opening: how many opened it, and how many lines were played through in each mode (learn, try, time).
    openings: (() => {
      const o: Record<string, { name: string; opened: number; people: Set<string>; learn: number; try: number; time: number }> = {};
      for (const r of recent.filter((x) => x.kind === 'practise' && x.target)) {
        const m = r.target!.match(/^done (\w+) · (.+)$/), name = m ? m[2] : r.target!;
        const x = (o[name] ??= { name, opened: 0, people: new Set(), learn: 0, try: 0, time: 0 });
        if (m) { if (m[1] in x) (x as any)[m[1]]++; } else { x.opened++; x.people.add(r.visitor); }
      }
      return Object.values(o).sort((a, b) => b.opened - a.opened).slice(0, 20).map(({ people, ...x }) => ({ ...x, people: people.size }));
    })(),
    visitors: visitors.sort((a, b) => b.last.localeCompare(a.last)).slice(0, 300).map((w) => ({ ...w, events: w.events.slice(-150).reverse() })),
    users: Object.entries(logins).sort((a, b) => b[1].last.localeCompare(a[1].last)).map(([name, x]) => ({ name, n: x.n, last: x.last })),
  });
});
