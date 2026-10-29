// Admin: how the site is used, the last 30 days. The numbers come from the admin-stats Edge Function
// (supabase/functions/admin-stats), which checks your Lichess login and answers only for the admin.
import { account, login, finishLogin } from './lichess.js?v=20261029142022';

const FN = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/admin-stats';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
// A country code as a name: SE is Sweden; – for an unknown country.
const NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const land = (c) => { try { return c && c !== '–' ? `${NAMES.of(c)} (${c})` : 'Unknown'; } catch { return c || 'Unknown'; } };
const KIND = { profile: 'Looked up a profile', compare: 'Comparisons', analyse: 'Analyses started', practise: 'Openings practised', card: 'Cards downloaded', login: 'Lichess logins' };

// New unique visitors per day as a line (a visitor counts once, on the day they first came), over the
// picked span; each day's numbers in a tooltip.
const SPANS = [['1W', 7], ['1M', 30], ['6M', 182], ['1Y', 365], ['All', Infinity]];
let span = 30;
function visitorLine(perDay) {
  const ds = perDay.slice(-Math.min(span, perDay.length)), W = 760, H = 180, top = Math.max(1, ...ds.map((d) => d.fresh));
  const x = (i) => (ds.length > 1 ? (i / (ds.length - 1)) * W : W / 2), y = (v) => H - (v / top) * (H - 8);
  const pts = ds.map((d, i) => `${x(i).toFixed(1)},${y(d.fresh).toFixed(1)}`).join(' '), bw = W / ds.length;
  return `<svg class="ad-line" viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="New unique visitors per day, ${ds.length} days, ${ds.reduce((t, d) => t + d.fresh, 0)} in all">
    <line class="ad-axis" x1="0" y1="${H}" x2="${W}" y2="${H}"></line>
    <polygon class="ad-area" points="0,${H} ${pts} ${W},${H}"></polygon><polyline points="${pts}"></polyline>
    ${ds.map((d, i) => `<g><title>${day(d.day)}: ${d.fresh} new, ${d.visitors} visitors in all, ${d.views} page views</title><rect class="hit" x="${i * bw}" y="0" width="${bw}" height="${H}"></rect>${d.fresh ? `<circle cx="${x(i)}" cy="${y(d.fresh)}" r="3"></circle>` : ''}</g>`).join('')}
    <text x="0" y="${H + 16}">${day(ds[0].day)}</text><text x="${W}" y="${H + 16}" text-anchor="end">Today</text><text x="0" y="12">${top}</text></svg>`;
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
    <header class="pr-head"><h1 class="pf-h1">Admin</h1><p class="info">How Chess Trainer is used. A visitor is a browser, counted once: on the day they first came. The admins' own visits and automated browsers are not counted.</p></header>
    <dl class="pf-kpis">
      <div><dt>New visitors today</dt><dd>${t.newToday}</dd><small>${t.back} came back today</small></div>
      <div><dt>New visitors, 7 days</dt><dd>${t.new7}</dd></div>
      <div><dt>New visitors, ${s.days} days</dt><dd>${t.new30}</dd><small>${Math.round(t.mobile * 100)}% on a phone</small></div>
      <div><dt>Visitors, all time</dt><dd>${t.all}</dd><small>${t.all ? (t.views / t.all).toFixed(1) : 0} pages a visitor · ${t.loggedIn} logged in (${s.days} days)</small></div>
    </dl>
    <section class="pf-card"><div class="ad-head"><h2>New unique visitors</h2><div class="seg" role="group" aria-label="Time span" id="ad-span">${SPANS.map(([l, n]) => `<button type="button" data-span="${n}" aria-pressed="${n === span}">${l}</button>`).join('')}</div></div>
      <div id="ad-line">${visitorLine(s.perDay)}</div></section>
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
    <section class="pf-card"><div class="ad-head"><h2>Visitors · ${s.visitors.length}</h2><small>Newest first. IP addresses without their last part. Click one to see what they did.</small></div>
      ${s.visitors.length ? `<div class="ad-visitors">${s.visitors.map((v) => `<details class="ad-visitor"><summary>
          <span class="ad-v-where">${flag(v.country)}${esc(v.country ? land(v.country).replace(/ \(..\)$/, '') : 'Unknown')}${v.city ? ` · ${esc(v.city)}` : ''}</span>
          <span class="num">${esc((v.ip || '–').replace(/\.0$/, '.x').replace(/::$/, ':x'))}</span>
          <span>${v.name ? link({ name: v.name }) : '<small>–</small>'}</span>
          <span>${esc(v.device || '–')}</span>
          <span class="num">${v.views} views · since ${day(v.first)}</span>
          <span class="num">${when(v.last)}</span></summary>
          <ol class="ad-events">${v.events.map((e) => `<li><span class="num">${when(e.at)}</span><span>${e.kind === 'view' ? `Opened ${esc(pageName(e.page))}` : `${esc(KIND[e.kind] || e.kind)}${e.target ? `: <b>${esc(e.target)}</b>` : ''}`}</span></li>`).join('')}</ol></details>`).join('')}</div>`
      : '<p class="info">Nobody yet.</p>'}</section>
    <div class="pf-two">
      <section class="pf-card"><h2>What people do</h2>${rows(s.usage, (x) => KIND[x.name] || esc(x.name))}</section>
      <section class="pf-card"><h2>Profiles looked up</h2>${rows(s.profiles, link)}</section>
    </div>
    <div class="pf-two">
      <section class="pf-card"><h2>Comparisons</h2>${rows(s.compares)}</section>
      <section class="pf-card"><h2>Openings practised</h2>${rows(s.practised)}</section>
    </div>
    <section class="pf-card"><h2>Logged-in players</h2>${s.users.length
      ? `<ul class="pf-rows ad-rows">${s.users.map((u) => `<li><span>${link(u)}</span><small>${u.n} actions · last ${when(u.last)}</small></li>`).join('')}</ul>`
      : '<p class="info">Nobody yet.</p>'}</section>`;
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
    render(body);
    $('#ad-span').addEventListener('click', (e) => { const b = e.target.closest('[data-span]'); if (!b) return; span = Number(b.dataset.span);
      $('#ad-span').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); $('#ad-line').innerHTML = visitorLine(body.perDay); });
  } catch (err) {
    $('#profile-msg').innerHTML = `${esc(err.message)} <button type="button" class="link" data-retry>Try again</button>`;
    $('[data-retry]').addEventListener('click', start);
  }
}
finishLogin().catch((err) => { $('#profile-msg').textContent = err.message; }).finally(start); // back from logging in on this page
