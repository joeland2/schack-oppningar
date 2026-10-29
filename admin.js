// Admin: how the site is used, the last 30 days. The numbers come from the admin-stats Edge Function
// (supabase/functions/admin-stats), which checks your Lichess login and answers only for the admin.
import { account, login, finishLogin } from './lichess.js?v=20261029183436';

const FN = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/admin-stats';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
// A country code as a name: SE is Sweden; – for an unknown country.
const NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const land = (c) => { try { return c && c !== '–' ? `${NAMES.of(c)} (${c})` : 'Unknown'; } catch { return c || 'Unknown'; } };
const KIND = { profile: 'Looked up a profile', compare: 'Comparisons', analyse: 'Analyses started', practise: 'Openings practised', card: 'Cards downloaded', login: 'Lichess logins' };

// Visitors per day (each counted once that day) as a line, and unique visitors (their first visit
// ever) as the shaded area under it, over the picked span; days without visits are zero. Moving the
// mouse along the graph shows that day's numbers.
const SPANS = [['1W', 7], ['1M', 30], ['6M', 182], ['1Y', 365], ['All', Infinity]];
let span = 30;
const W = 760, H = 180;
function spanDays(perDay) {
  const by = new Map(perDay.map((d) => [d.day, d])), n = Number.isFinite(span) ? span : Math.max(perDay.length, 2), out = [];
  const iso = (t) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(t));
  for (let i = n - 1; i >= 0; i--) { const k = iso(Date.now() - i * 864e5); out.push(by.get(k) || { day: k, fresh: 0, visitors: 0, views: 0 }); }
  return out;
}
function visitorLine(ds) {
  const top = Math.max(1, ...ds.map((d) => d.visitors)), x = (i) => (i / (ds.length - 1)) * W, y = (v) => H - (v / top) * (H - 10);
  const line = (k) => ds.map((d, i) => `${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  return `<svg class="ad-line" viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="Visitors per day over ${ds.length} days: ${ds.reduce((t, d) => t + d.fresh, 0)} unique">
    <line class="ad-axis" x1="0" y1="${H}" x2="${W}" y2="${H}"></line>
    <polygon class="ad-area" points="0,${H} ${line('fresh')} ${W},${H}"></polygon><polyline points="${line('visitors')}"></polyline>
    <line class="ad-cross" x1="0" y1="0" x2="0" y2="${H}" visibility="hidden"></line><circle class="ad-dot" r="4" visibility="hidden"></circle>
    <text x="0" y="${H + 16}">${day(ds[0].day)}</text><text x="${W}" y="${H + 16}" text-anchor="end">Today</text><text x="4" y="12">${top}</text></svg>
    <div class="ad-tip" hidden></div>
    <p class="ad-key"><span class="ad-k-line"></span>Visitors <span class="ad-k-area"></span>Unique (first visit)</p>`;
}
function bindLine(perDay) {
  const ds = spanDays(perDay), box = $('#ad-line');
  box.innerHTML = visitorLine(ds);
  const svg = box.querySelector('svg'), cross = svg.querySelector('.ad-cross'), dot = svg.querySelector('.ad-dot'), tip = box.querySelector('.ad-tip');
  const top = Math.max(1, ...ds.map((d) => d.visitors));
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(ds.length - 1, Math.round(((e.clientX - r.left) / r.width) * (ds.length - 1)))), d = ds[i];
    const cx = (i / (ds.length - 1)) * W, cy = H - (d.visitors / top) * (H - 10);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<b>${day(d.day)}</b><br>${d.visitors} visitor${d.visitors === 1 ? '' : 's'} · ${d.fresh} unique<br><small>${d.views} page views</small>`;
    const px = (cx / W) * r.width;
    tip.style.left = `${Math.min(Math.max(px, 60), r.width - 60)}px`;
  });
  svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; });
}
const rows = (list, label = (x) => esc(x.name)) => (list.length
  ? `<ul class="pf-rows ad-rows">${list.map((x) => `<li><span>${label(x)}</span><small>${x.n}</small></li>`).join('')}</ul>`
  : '<p class="info">Nothing yet.</p>');
// A list with a bar under each name, as long as its share of the largest.
const bars = (list, label = (x) => esc(x.name), extra = () => '') => (list.length
  ? `<ul class="ad-list">${list.map((x) => `<li><span>${label(x)}</span><b>${x.n}${extra(x)}</b><i style="width:${(x.n / list[0].n) * 100}%"></i></li>`).join('')}</ul>`
  : '<p class="info">Nothing yet.</p>');
// Page views per hour (0–23) or weekday, as columns; each column's count in its tooltip.
function cols(values, labels, every = 1) {
  const W = 360, H = 120, top = Math.max(1, ...values), bw = W / values.length;
  return `<svg class="ad-bars ad-cols" viewBox="0 0 ${W} ${H + 20}" role="img" aria-label="${values.map((v, i) => `${labels[i]}: ${v}`).join(', ')}">
    ${values.map((v, i) => { const h = (v / top) * H; return `<g><title>${labels[i]}: ${v} page views</title>
      <rect x="${i * bw + 1.5}" y="${H - h}" width="${bw - 3}" height="${Math.max(h, v ? 2 : 0)}" rx="1.5"></rect>
      <rect class="hit" x="${i * bw}" y="0" width="${bw}" height="${H}"></rect></g>`; }).join('')}
    ${labels.map((l, i) => (i % every ? '' : `<text x="${i * bw + bw / 2}" y="${H + 15}" text-anchor="middle">${l}</text>`)).join('')}</svg>`;
}
const flag = (c) => (c && /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((x) => 0x1f1a5 + x.charCodeAt(0))) + ' ' : '');
const PAGE = { 'index.html': 'Openings', 'practice.html': 'My practice', 'profile.html': 'Profile', 'game.html': 'Game review', 'mistakes.html': 'Mistakes', 'admin.html': 'Admin', 'basics.html': 'Basics', 'pros.html': 'Puzzles' };
const pageName = (p) => PAGE[p] || p;

function render(s) {
  const link = (x) => `<a href="profile.html?u=${encodeURIComponent(x.name)}">${esc(x.name)}</a>`, t = s.totals;
  $('#admin').innerHTML = `
    <header class="pr-head"><h1 class="pf-h1">Admin</h1><p class="info">How Chess Trainer is used. A visitor is a browser, counted once: on the day they first came. The admins' own visits and automated browsers are not counted.</p>
      <p class="ad-demo-row"><span class="seg" role="group" aria-label="Which numbers"><button type="button" data-real aria-pressed="${!s.demo}">Real</button><button type="button" data-demo aria-pressed="${!!s.demo}">Demo</button></span>
        ${s.demo ? '<b class="ad-demo-tag">Demo data</b> Made up test visitors, to see how the page looks with many.' : ''}</p></header>
    <dl class="pf-kpis ad-kpis">
      <div><dt>Visitors today</dt><dd>${t.today}</dd><small>${t.newToday} unique (first visit)</small></div>
      <div><dt>Visitors, 7 days</dt><dd>${t.week}</dd><small>${t.new7} unique</small></div>
      <div><dt>Visitors, ${s.days} days</dt><dd>${t.month}</dd><small>${t.new30} unique · ${Math.round(t.mobile * 100)}% on a phone</small></div>
      <div><dt>Visitors, all time</dt><dd>${t.all}</dd><small>${t.all ? (t.views / t.all).toFixed(1) : 0} pages a visitor</small></div>
      <div><dt>Profiles created</dt><dd>${t.registered}</dd><small>logged in with Lichess</small></div>
    </dl>
    <section class="pf-card"><div class="ad-head"><h2>Visitors</h2><div class="seg" role="group" aria-label="Time span" id="ad-span">${SPANS.map(([l, n]) => `<button type="button" data-span="${n}" aria-pressed="${n === span}">${l}</button>`).join('')}</div></div>
      <div id="ad-line" class="ad-line-box"></div></section>
    <section class="pf-card"><div class="ad-head"><h2>Unique visitors · ${s.visitors.length}</h2><small>Every visitor once, newest first. IP addresses without their last part. Click one to see what they did.</small></div>
      ${s.visitors.length ? `<div class="ad-visitors"><div class="ad-v-head"><span>Location</span><span>IP</span><span>Lichess</span><span>Device</span><span>Visits</span><span>Last seen</span></div>${s.visitors.map((v) => `<details class="ad-visitor"><summary>
          <span class="ad-v-where">${flag(v.country)}${esc(v.country ? land(v.country).replace(/ \(..\)$/, '') : 'Unknown')}${v.city ? ` · ${esc(v.city)}` : ''}</span>
          <span class="num">${esc((v.ip || '–').replace(/\.0$/, '.x').replace(/::$/, ':x'))}</span>
          <span>${v.name ? link({ name: v.name }) : '<small>–</small>'}</span>
          <span>${esc(v.device || '–')}</span>
          <span class="num">${v.views} views · since ${day(v.first)}</span>
          <span class="num">${when(v.last)}</span></summary>
          <ol class="ad-events">${v.events.map((e) => `<li><span class="num">${when(e.at)}</span><span>${e.kind === 'view' ? `Opened ${esc(pageName(e.page))}` : `${esc(KIND[e.kind] || e.kind)}${e.target ? `: <b>${esc(e.target)}</b>` : ''}`}</span></li>`).join('')}</ol></details>`).join('')}</div>
      ${s.visitors.length > 10 ? `<button type="button" class="ghost ad-more" data-more aria-expanded="false">Show all ${s.visitors.length}</button>` : ''}`
      : '<p class="info">Nobody yet.</p>'}</section>
    <div class="pf-two">
      <section class="pf-card"><h2>Profiles created · ${s.registered.length}</h2>${s.registered.length ? `<p class="ad-names">${s.registered.map((n) => link({ name: n })).join(' · ')}</p>` : '<p class="info">Nobody yet.</p>'}</section>
      <section class="pf-card"><h2>Names looked up <small>found, all time</small></h2>${rows(s.profiles, link)}</section>
    </div>
    <div class="pf-two">
      <section class="pf-card"><h2>Most visited pages</h2>${bars(s.pages, (x) => esc(pageName(x.name)), (x) => ` <small>${x.unique} unique</small>`)}</section>
      <section class="pf-card"><h2>Where visitors come from</h2>${bars(s.sources || [])}</section>
    </div>
    <div class="pf-two">
      <section class="pf-card"><h2>Countries <small>unique visitors</small></h2>${bars(s.countries || [], (x) => flag(x.name) + esc(land(x.name)))}</section>
      <section class="pf-card"><h2>Cities <small>unique visitors</small></h2>${bars(s.cities || [], (x) => flag(x.name.split(', ')[1]) + esc(x.name))}</section>
    </div>
    <div class="ad-three">
      <section class="pf-card"><h2>Time of day <small>Swedish time</small></h2>${cols(s.hours, s.hours.map((_, i) => String(i).padStart(2, '0')), 3)}</section>
      <section class="pf-card"><h2>Weekday</h2>${cols(s.weekdays, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])}</section>
      <section class="pf-card"><h2>Devices <small>unique visitors</small></h2>${bars(s.devices || [])}</section>
    </div>
    <div class="pf-two">
      <section class="pf-card"><h2>What people do</h2>${rows(s.usage, (x) => KIND[x.name] || esc(x.name))}</section>
      <section class="pf-card"><h2>Logged-in players · ${s.days} days</h2>${s.users.length
        ? `<ul class="pf-rows ad-rows">${s.users.map((u) => `<li><span>${link(u)}</span><small>${u.n} actions · last ${when(u.last)}</small></li>`).join('')}</ul>` : '<p class="info">Nobody yet.</p>'}</section>
    </div>
    <div class="pf-two">
      <section class="pf-card"><h2>Comparisons</h2>${rows(s.compares)}</section>
      <section class="pf-card"><h2>Openings practised</h2>${rows(s.practised)}</section>
    </div>
`;
}

// Draw the numbers (real or demo) and wire the graph's spans and the demo switch.
function show(body) {
  render(body);
  bindLine(body.perDay);
  $('#ad-span').addEventListener('click', (e) => { const b = e.target.closest('[data-span]'); if (!b) return; span = Number(b.dataset.span);
    $('#ad-span').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); bindLine(body.perDay); });
  // The visitor list shows the newest 10 until opened.
  $('[data-more]')?.addEventListener('click', (e) => { const b = e.currentTarget, open = $('.ad-visitors').classList.toggle('open');
    b.setAttribute('aria-expanded', open); b.textContent = open ? 'Show the newest 10' : `Show all ${body.visitors.length}`; });
  $('[data-demo]').addEventListener('click', () => { if (!body.demo) { real = body; show(demoData()); } });
  $('[data-real]').addEventListener('click', () => { if (body.demo) show(real); });
}
let real = null;
// Made-up numbers in the real shape: a year of growth, a few hundred visitors from many places with
// what they did, and logged-in players. Nothing is stored; it is drawn only on this page.
function demoData() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const DAYS = 365, now = Date.now(), iso = (t) => new Date(t).toISOString();
  const day = (t) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(t));
  const PLACES = [['SE', 'Stockholm'], ['SE', 'Gothenburg'], ['SE', 'Malmö'], ['SE', 'Uppsala'], ['NO', 'Oslo'], ['DK', 'Copenhagen'], ['FI', 'Helsinki'], ['DE', 'Berlin'], ['GB', 'London'], ['US', 'New York'], ['NL', 'Amsterdam'], ['IN', 'Mumbai'], ['FR', 'Paris'], ['ES', 'Madrid']];
  const DEVICES = ['iPhone · Safari', 'Android · Chrome', 'Mac · Chrome', 'Windows · Chrome', 'Mac · Safari', 'Windows · Edge', 'iPad · Safari', 'Linux · Firefox'];
  const PAGES = ['index.html', 'profile.html', 'leaderboard.html', 'practice.html', 'mistakes.html', 'game.html'];
  const OPS = ['White: Italian Game', 'White: London System', 'White: Danish Gambit', "White: Queen's Gambit", 'Black: Sicilian Defense', 'Black: Caro-Kann Defense', 'Black: vs Italian Game', 'White: Scotch Game'];
  const NAMES = ['knightrider', 'pawnstorm77', 'gambit_greta', 'eriksson_chess', 'blitzbjorn', 'castlequeen', 'fianchetto_fred', 'tactix', 'endgame_eva', 'sicilian_sam', 'rookie2000', 'mateinthree', 'zugzwang_zoe', 'bishoppair', 'olof_plays'];
  const SOURCES = ['Direct', 'Direct', 'Direct', 'google.com', 'lichess.org', 'reddit.com', 'discord.com', 'facebook.com'];
  const perDay = [], visitors = [];
  for (let d = DAYS - 1; d >= 0; d--) {
    const t = now - d * 864e5, growth = 2 + (DAYS - d) * 0.12, weekend = [0, 6].includes(new Date(t).getDay()) ? 1.4 : 1;
    const fresh = Math.max(0, Math.round(growth * weekend * (0.6 + rnd() * 0.8)));
    perDay.push({ day: day(t), fresh, visitors: Math.round(fresh * (1.6 + rnd())), views: Math.round(fresh * (5 + rnd() * 4)) });
    for (let i = 0; i < fresh && visitors.length < 300 && d < 60; i++) {
      const [country, city] = pick(PLACES), first = t + rnd() * 864e5 * 0.9, name = rnd() < 0.25 ? pick(NAMES) : null;
      const events = Array.from({ length: 2 + Math.floor(rnd() * 8) }, (_, k) => {
        const kind = k === 0 ? 'view' : pick(['view', 'view', 'view', 'practise', 'profile', 'analyse', 'compare']);
        return { at: iso(first + k * 90e3), kind, page: kind === 'view' ? pick(PAGES) : 'index.html', target: kind === 'practise' ? pick(OPS) : kind === 'profile' ? pick(NAMES) : kind === 'compare' ? `${pick(NAMES)} vs ${pick(NAMES)}` : null };
      }).reverse();
      visitors.push({ id: `demo-${visitors.length}`, ip: `${Math.floor(rnd() * 200) + 20}.${Math.floor(rnd() * 255)}.${Math.floor(rnd() * 255)}.0`, country, city, device: pick(DEVICES), source: pick(SOURCES), name,
        views: events.filter((e) => e.kind === 'view').length, first: iso(first), last: events[0].at, events });
    }
  }
  visitors.sort((a, b) => b.last.localeCompare(a.last));
  const count = (xs) => Object.entries(xs.reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, n]) => ({ name, n }));
  const sum = (n, k) => perDay.slice(-n).reduce((t, d) => t + d[k], 0), events = visitors.flatMap((v) => v.events);
  const registered = [...new Set(visitors.map((v) => v.name).filter(Boolean))];
  const hours = Array.from({ length: 24 }, (_, h) => Math.round(40 + 120 * Math.max(0, Math.sin(((h - 7) / 16) * Math.PI)) * (0.8 + rnd() * 0.4)));
  return {
    demo: true, days: 30,
    totals: { today: perDay.at(-1).visitors, newToday: perDay.at(-1).fresh, week: Math.round(sum(7, 'visitors') * 0.6), new7: sum(7, 'fresh'), month: Math.round(sum(30, 'visitors') * 0.5), new30: sum(30, 'fresh'),
      all: sum(DAYS, 'fresh'), views: sum(DAYS, 'views'), mobile: visitors.filter((v) => /iPhone|Android/.test(v.device)).length / visitors.length, loggedIn: registered.length, registered: registered.length * 6 },
    perDay,
    pages: count(events.filter((e) => e.kind === 'view').map((e) => e.page)).map((x) => ({ ...x, n: x.n * 9, unique: x.n * 3 })),
    sources: count(visitors.map((v) => v.source)), countries: count(visitors.map((v) => v.country)), cities: count(visitors.map((v) => `${v.city}, ${v.country}`)), devices: count(visitors.map((v) => v.device)),
    hours, weekdays: [520, 480, 470, 500, 560, 760, 720],
    profiles: count(events.filter((e) => e.kind === 'profile').map((e) => e.target)), compares: count(events.filter((e) => e.kind === 'compare').map((e) => e.target)),
    usage: count(events.filter((e) => !['view', 'profile'].includes(e.kind)).map((e) => e.kind)), practised: count(events.filter((e) => e.kind === 'practise').map((e) => e.target)),
    visitors, registered: registered.sort(), users: registered.map((name) => ({ name, n: 5 + Math.floor(rnd() * 40), last: iso(now - rnd() * 6 * 864e5) })),
  };
}
async function start() {
  const a = account();
  if (!a) {
    $('#admin').innerHTML = `<section class="picker"><h1 class="pf-h1">Admin</h1><p class="info">Log in with Lichess to see the site's numbers.</p>
      <p><button id="ad-login" class="cta" type="button">Log in with Lichess</button></p></section>`;
    return $('#ad-login').addEventListener('click', login);
  }
  $('#profile-msg').textContent = 'Loading the numbers…';
  try {
    const res = await fetch(FN, { headers: { 'x-lichess-token': a.token } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `The stats service answered ${res.status}.`);
    $('#profile-msg').textContent = '';
    try { localStorage.setItem('chess-trainer-no-track', '1'); } catch {} // this browser is the admin's: its visits stay out of the numbers
    show(body);
  } catch (err) {
    $('#profile-msg').innerHTML = `${esc(err.message)} <button type="button" class="link" data-retry>Try again</button>`;
    $('[data-retry]').addEventListener('click', start);
  }
}
finishLogin().catch((err) => { $('#profile-msg').textContent = err.message; }).finally(start); // back from logging in on this page
