// Pros & VIPs: the pro and the streamer of the week, each with why and a few words on them, then everyone
// by when they last played. From week.json, which the pros function writes every 6 hours (see supabase/functions/pros).
import { BIOS, keptTypes, TYPE_ABOUT } from './profile.js?v=20261102095030';
import { nick, isCC } from './chesscom.js?v=20261102095030';
const WEEK = 'https://duhlvhjtxoofgnjegspa.supabase.co/storage/v1/object/public/pros/week.json';
const TAB = 'opening-book-v2-stars-tab'; // the list last shown on a phone
const SORT = 'opening-book-v2-stars-sort'; // how the lists are ordered
const SKILLS_AT = 'https://raw.githubusercontent.com/joeland2/schack-oppningar/pros-data/skills.json'; // each account's card skills (tools/snapshot_pros.py)
const SKILLS = ['Attack', 'Defense', 'Early game', 'Late game', 'Accuracy', 'Speed'];
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
  const about = r.style && TYPE_ABOUT[r.style]?.split('. ')[0]; // what marks their style, in its first sentence
  return `<a class="st-wk ${kind}" href="${link(r)}"><span class="st-k">${kind.toUpperCase()} OF THE WEEK</span><h2>${esc(r.who)}</h2>
    ${b ? `<p class="st-bio">${b[0] ? `From ${esc(b[0])}. ` : ''}${esc(b[1])}</p>` : ''}${styleOf(r)}${about ? `<p class="st-bio">${esc(about.replace(/\.$/, ''))}.</p>` : ''}
    <p class="st-why">${why(r, kind)}</p>
    <div class="st-stats"><div><b>${r.blitz ?? '–'}</b><small>Blitz</small></div><div><b>${signed(r.change)}</b><small>This week</small></div><div><b>${r.games}</b><small>Games</small></div></div></a>`;
}
const rowOf = (r, sk) => `<li><a class="st-row" href="${link(r)}"><span class="st-av ${r.kind}">${esc(initials(r.who))}</span>
  <span class="st-who"><b>${esc(r.who)}</b><small>${[sk && r.skills?.[sk] != null ? `${sk} ${r.skills[sk]}` : '', r.style, r.last ? `played ${ago(r.last)}` : 'no games this week', r.accounts.some(isCC) ? (r.accounts.some((a) => !isCC(a)) ? 'Both sites' : 'Chess.com') : 'Lichess'].filter(Boolean).map(esc).join(' · ')}</small></span>
  <span class="st-num"><b>${r.blitz ?? '–'}</b>${r.blitzGames > 1 ? `<small class="${r.change >= 0 ? 'up' : 'dn'}">${signed(r.change)}</small>` : ''}</span></a></li>`;

(async () => {
  const data = await fetch(WEEK, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!data) { $('#st-split').innerHTML = ''; $('#st-msg').textContent = 'The week is not counted yet. Try again later today.'; return; }
  // The kept style of each person's main account, as their profile shows it.
  const [typed, skills] = await Promise.all([keptTypes(data.people.map((r) => ({ name: r.account, speed: 'blitz' }))).catch(() => []),
    fetch(SKILLS_AT).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))]);
  const people = data.people.map((r, i) => ({ ...r, style: typed[i]?.style, strength: typed[i]?.strength, skills: skills[r.account.toLowerCase()] }));
  // The pro and the streamer of the week stay as chosen on Monday, with that day's numbers; their style as now.
  const by = (r) => { const now = r && people.find((x) => x.who === r.who); return r && { ...r, style: now?.style, strength: now?.strength }; };
  $('#st-msg').textContent = `Counted ${ago(data.at)}.`;
  // Ordered as chosen: last played, blitz rating, rating gained this week, or one skill, highest first.
  let sort = 'active';
  try { sort = localStorage.getItem(SORT) || 'active'; } catch {}
  const key = (r) => (sort === 'active' ? r.last || 0 : sort === 'rated' ? r.blitz ?? -1 : sort === 'gained' ? (r.blitzGames > 1 ? r.change : -1e4) : r.skills?.[sort] ?? -1);
  const ordered = (kind) => people.filter((r) => (r.kind === 'pro') === (kind === 'pro')).sort((a, b) => key(b) - key(a));
  const pros = ordered('pro'), vips = ordered('vip');
  // Desktop: two columns, each under its card of the week. Phone: both cards, then tabs showing one list.
  let tab = 'pro';
  try { tab = localStorage.getItem(TAB) === 'vip' ? 'vip' : 'pro'; } catch {}
  const col = (kind, list) => `<section class="st-col st-${kind}" role="tabpanel" id="st-${kind}"><h2 class="st-h2">${kind === 'pro' ? 'Pros' : 'VIPs'} <span>· ${list.length}</span></h2><ol class="st-rows">${list.map((r) => rowOf(r, SKILLS.includes(sort) && sort)).join('')}</ol></section>`;
  const pick = `<label class="st-sort">Sort by <select id="st-sort">${[['active', 'Recently active'], ['rated', 'Highest rated'], ['gained', 'Most gained this week']].map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}
    <optgroup label="Style: strongest first">${SKILLS.map((k) => `<option value="${k}">${k}</option>`).join('')}</optgroup></select></label>`;
  const btn = (kind, n) => `<button type="button" role="tab" class="${kind}" aria-controls="st-${kind}" data-tab="${kind}">${kind === 'pro' ? 'Pros' : 'VIPs'} · ${n}</button>`;
  const split = $('#st-split');
  split.innerHTML = weekCard(by(data.pick?.pro), 'pro') + weekCard(by(data.pick?.vip), 'vip')
    + pick + `<div class="st-tabs" role="tablist" aria-label="Pros or VIPs">${btn('pro', pros.length)}${btn('vip', vips.length)}</div>` + col('pro', pros) + col('vip', vips);
  const sel = split.querySelector('#st-sort');
  sel.value = sort;
  sel.addEventListener('change', () => {
    sort = sel.value; try { localStorage.setItem(SORT, sort); } catch {}
    for (const kind of ['pro', 'vip']) split.querySelector(`#st-${kind}`).outerHTML = col(kind, ordered(kind));
  });
  const show = (t) => { split.dataset.tab = t; for (const b of split.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', b.dataset.tab === t); };
  show(tab);
  split.querySelector('.st-tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (!t) return; show(t); try { localStorage.setItem(TAB, t); } catch {} });
  split.removeAttribute('aria-hidden'); split.classList.add('fade-in');
})();
console.assert(signed(5) === '+5' && signed(-3) === '−3' && initials('Jerry (ChessNetwork)') === 'J' && nick('cc:x') === 'x', 'stars');
