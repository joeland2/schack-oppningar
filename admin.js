// Admin: how the site is used, the last 30 days. The numbers come from the admin-stats Edge Function
// (supabase/functions/admin-stats), which checks your Lichess login and answers only for the admin.
import { account, login, finishLogin } from './lichess.js?v=20261029005012';

const FN = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/admin-stats';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const KIND = { compare: 'Comparisons', analyse: 'Analyses started', practise: 'Openings practised', card: 'Cards downloaded', login: 'Lichess logins' };

// Visitors per day as bars; the day's page views in each bar's tooltip.
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

function render(s) {
  const link = (x) => `<a href="profile.html?u=${encodeURIComponent(x.name)}">${esc(x.name)}</a>`;
  $('#admin').innerHTML = `
    <header class="pr-head"><h1 class="pf-h1">Admin</h1><p class="info">How Chess Trainer is used, the last ${s.days} days. Visits from this computer's own test server are not counted.</p></header>
    <dl class="pf-kpis">
      <div><dt>Visitors</dt><dd>${s.totals.visitors}</dd></div>
      <div><dt>Today</dt><dd>${s.totals.today}</dd></div>
      <div><dt>Page views</dt><dd>${s.totals.views}</dd></div>
      <div><dt>Logged in</dt><dd>${s.totals.loggedIn}</dd></div>
    </dl>
    <section class="pf-card"><h2>Visitors per day</h2>${dayBars(s.perDay)}</section>
    <div class="pf-two">
      <section class="pf-card"><h2>Pages</h2>${rows(s.pages)}</section>
      <section class="pf-card"><h2>What people do</h2>${rows(s.usage, (x) => KIND[x.name] || esc(x.name))}</section>
    </div>
    <div class="pf-two">
      <section class="pf-card"><h2>Profiles looked up</h2>${rows(s.profiles, link)}</section>
      <section class="pf-card"><h2>Comparisons</h2>${rows(s.compares)}</section>
    </div>
    <div class="pf-two">
      <section class="pf-card"><h2>Openings practised</h2>${rows(s.practised)}</section>
      <section class="pf-card"><h2>Logged-in players</h2>${s.users.length
        ? `<ul class="pf-rows ad-rows">${s.users.map((u) => `<li><span>${link(u)}</span><small>${u.n} actions · last ${when(u.last)}</small></li>`).join('')}</ul>`
        : '<p class="info">Nobody yet.</p>'}</section>
    </div>`;
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
    render(body);
  } catch (err) {
    $('#profile-msg').innerHTML = `${esc(err.message)} <button type="button" class="link" data-retry>Try again</button>`;
    $('[data-retry]').addEventListener('click', start);
  }
}
finishLogin().catch((err) => { $('#profile-msg').textContent = err.message; }).finally(start); // back from logging in on this page
