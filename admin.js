// Admin: how the site is used, the last 30 days. The numbers come from the admin-stats Edge Function
// (supabase/functions/admin-stats), which checks your Lichess login and answers only for the admin.
import { account, login, finishLogin } from './lichess.js?v=20261029132009';

const FN = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/admin-stats';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
// A country code as a name: SE is Sweden; – for an unknown country.
const NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const land = (c) => { try { return c && c !== '–' ? `${NAMES.of(c)} (${c})` : 'Unknown'; } catch { return c || 'Unknown'; } };
const KIND = { compare: 'Comparisons', analyse: 'Analyses started', practise: 'Openings practised', card: 'Cards downloaded', login: 'Lichess logins' };

// Unique visitors per day as bars; the day's page views in each bar's tooltip.
function dayBars(perDay) {
  const W = 760, H = 180, top = Math.max(1, ...perDay.map((d) => d.visitors)), bw = W / perDay.length;
  return `<svg class="ad-bars" viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="Visitors per day, the last ${perDay.length} days">
    ${perDay.map((d, i) => { const h = (d.visitors / top) * H; return `<g><title>${day(d.day)}: ${d.visitors} visitors, ${d.views} page views</title>
      <rect x="${i * bw + 2}" y="${H - h}" width="${bw - 4}" height="${Math.max(h, d.visitors ? 2 : 0)}" rx="2"></rect>
      <rect class="hit" x="${i * bw}" y="0" width="${bw}" height="${H}"></rect></g>`; }).join('')}
    <text x="0" y="${H + 16}">${day(perDay[0].day)}</text><text x="${W}" y="${H + 16}" text-anchor="end">Today</text></svg>`;
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
    <header class="pr-head"><h1 class="pf-h1">Admin</h1><p class="info">How Chess Trainer is used, the last ${s.days} days. Your own visits are not counted: not while you are logged in, and never from a browser that has opened this page.</p></header>
    <dl class="pf-kpis">
      <div><dt>Unique visitors today</dt><dd>${t.today}</dd><small>${t.todayViews} page views</small></div>
      <div><dt>Unique visitors, 7 days</dt><dd>${t.week}</dd><small>${t.weekViews} page views</small></div>
      <div><dt>Unique visitors, ${s.days} days</dt><dd>${t.visitors}</dd><small>${t.visitors ? (t.views / t.visitors).toFixed(1) : 0} pages a visitor · ${Math.round(t.mobile * 100)}% on a phone</small></div>
      <div><dt>Logged in with Lichess</dt><dd>${t.loggedIn}</dd><small>players, ${s.days} days</small></div>
    </dl>
    <section class="pf-card"><h2>Unique visitors per day</h2>${dayBars(s.perDay)}</section>
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
    <section class="pf-card"><div class="ad-head"><h2>Visitors · ${s.visitors.length}</h2><small>IP addresses with the last part removed, for privacy</small></div>
      ${s.visitors.length ? `<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>Where</th><th>IP</th><th>Device</th><th>Pages</th><th>Came from</th><th>Last</th></tr></thead><tbody>
        ${s.visitors.map((v) => `<tr><td>${flag(v.country)}${esc(v.country ? land(v.country).replace(/ \(..\)$/, '') : 'Unknown')}${v.city ? ` · ${esc(v.city)}` : ''}${v.name ? `<br><small>${link({ name: v.name })}</small>` : ''}</td>
          <td class="num">${esc((v.ip || '–').replace(/\.0$/, '.x').replace(/::$/, ':x'))}</td><td>${esc(v.device || '–')}</td>
          <td>${esc(Object.keys(v.pages).map(pageName).join(', '))} <small>(${v.views})</small></td><td>${esc(v.source || '–')}</td><td class="num">${when(v.last)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="info">Nobody yet.</p>'}</section>
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
  } catch (err) {
    $('#profile-msg').innerHTML = `${esc(err.message)} <button type="button" class="link" data-retry>Try again</button>`;
    $('[data-retry]').addEventListener('click', start);
  }
}
finishLogin().catch((err) => { $('#profile-msg').textContent = err.message; }).finally(start); // back from logging in on this page
