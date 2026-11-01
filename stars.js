// Pros & VIPs: the pro and the streamer of the week, each with why and a few words on them, then everyone
// by when they last played. From week.json, which the pros function writes every 6 hours (see supabase/functions/pros).
import { BIOS, keptTypes } from './profile.js?v=20261101210724';
import { nick, isCC } from './chesscom.js?v=20261101210724';
const WEEK = 'https://duhlvhjtxoofgnjegspa.supabase.co/storage/v1/object/public/pros/week.json';
const TAB = 'opening-book-v2-stars-tab'; // the list last shown on a phone
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x) => `${Math.round(x * 100)}%`;
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
const initials = (who) => who.replace(/\(.*\)/, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
const ago = (t) => { const h = (Date.now() - t) / 36e5; return h < 1 ? 'within the hour' : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`; };
const link = (r) => `profile.html?u=${encodeURIComponent(r.account)}${r.accounts.some(isCC) && r.accounts.some((a) => !isCC(a)) ? '&all=1' : ''}`;
const styleOf = (r) => (r.style ? `<p class="st-style"><b>${esc(r.style)}</b>${r.strength ? `<span>+ ${esc(r.strength)}</span>` : ''}</p>` : '');

// Why they are of the week, in the week's own numbers.
function why(r, kind) {
  const op = (o, side) => o && o.games >= 5 ? ` Played the ${esc(o.name)} most as ${side} (${o.games} games, ${pct(o.score)}).` : '';
  return `Gained the most blitz rating of all ${kind === 'pro' ? 'pros' : 'streamers'} this week: <b>${signed(r.change)}</b> in ${r.blitzGames} blitz games, scoring <b>${pct(r.score)}</b> in all ${r.games}.${op(r.white, 'White')}${op(r.black, 'Black')}`;
}
function weekCard(r, kind) {
  if (!r) return `<article class="st-wk ${kind}"><span class="st-k">${kind.toUpperCase()} OF THE WEEK</span><p class="st-why">Nobody played 20 blitz games this week yet.</p></article>`;
  const b = BIOS[r.who];
  return `<a class="st-wk ${kind}" href="${link(r)}"><span class="st-k">${kind.toUpperCase()} OF THE WEEK</span><h2>${esc(r.who)}</h2>${styleOf(r)}
    <p class="st-why">${why(r, kind)}</p>${b ? `<p class="st-bio">${b[0] ? `From ${esc(b[0])}. ` : ''}${esc(b[1])}</p>` : ''}
    <div class="st-stats"><div><b>${r.blitz ?? '–'}</b><small>Blitz</small></div><div><b>${signed(r.change)}</b><small>This week</small></div><div><b>${r.games}</b><small>Games</small></div></div></a>`;
}
const rowOf = (r) => `<li><a class="st-row" href="${link(r)}"><span class="st-av ${r.kind}">${esc(initials(r.who))}</span>
  <span class="st-who"><b>${esc(r.who)}</b><small>${[r.style, r.last ? `played ${ago(r.last)}` : 'no games this week', r.accounts.some(isCC) ? (r.accounts.some((a) => !isCC(a)) ? 'Both sites' : 'Chess.com') : 'Lichess'].filter(Boolean).map(esc).join(' · ')}</small></span>
  <span class="st-num"><b>${r.blitz ?? '–'}</b>${r.blitzGames > 1 ? `<small class="${r.change >= 0 ? 'up' : 'dn'}">${signed(r.change)}</small>` : ''}</span></a></li>`;

(async () => {
  const data = await fetch(WEEK, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!data) { $('#st-split').innerHTML = ''; $('#st-msg').textContent = 'The week is not counted yet. Try again later today.'; return; }
  // The kept style of each person's main account, as their profile shows it.
  const typed = await keptTypes(data.people.map((r) => ({ name: r.account, speed: 'blitz' }))).catch(() => []);
  const people = data.people.map((r, i) => ({ ...r, style: typed[i]?.style, strength: typed[i]?.strength }));
  // The pro and the streamer of the week stay as chosen on Monday, with that day's numbers; their style as now.
  const by = (r) => { const now = r && people.find((x) => x.who === r.who); return r && { ...r, style: now?.style, strength: now?.strength }; };
  $('#st-msg').textContent = `Counted ${ago(data.at)}.`;
  people.sort((a, b) => (b.last || 0) - (a.last || 0));
  const pros = people.filter((r) => r.kind === 'pro'), vips = people.filter((r) => r.kind !== 'pro');
  // Desktop: two columns, each under its card of the week. Phone: both cards, then tabs showing one list.
  let tab = 'pro';
  try { tab = localStorage.getItem(TAB) === 'vip' ? 'vip' : 'pro'; } catch {}
  const col = (kind, list) => `<section class="st-col st-${kind}" role="tabpanel" id="st-${kind}"><h2 class="st-h2">${kind === 'pro' ? 'Pros' : 'VIPs'} <span>· ${list.length}</span></h2><ol class="st-rows">${list.map(rowOf).join('')}</ol></section>`;
  const btn = (kind, n) => `<button type="button" role="tab" class="${kind}" aria-controls="st-${kind}" data-tab="${kind}">${kind === 'pro' ? 'Pros' : 'VIPs'} · ${n}</button>`;
  const split = $('#st-split');
  split.innerHTML = weekCard(by(data.pick?.pro), 'pro') + weekCard(by(data.pick?.vip), 'vip')
    + `<div class="st-tabs" role="tablist" aria-label="Pros or VIPs">${btn('pro', pros.length)}${btn('vip', vips.length)}</div>` + col('pro', pros) + col('vip', vips);
  const show = (t) => { split.dataset.tab = t; for (const b of split.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', b.dataset.tab === t); };
  show(tab);
  split.querySelector('.st-tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (!t) return; show(t); try { localStorage.setItem(TAB, t); } catch {} });
  split.removeAttribute('aria-hidden'); split.classList.add('fade-in');
})();
console.assert(signed(5) === '+5' && signed(-3) === '−3' && initials('Jerry (ChessNetwork)') === 'J' && nick('cc:x') === 'x', 'stars');
