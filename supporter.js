// Supporters: players who pay $5 a month through Stripe (the supporter Edge Function). Every page loads this
// (header.js): it marks supporters' names with a heart and puts the frame each picked around their card,
// wherever a card (.pf-pcard[data-player]) or a name ([data-supporter-name]) appears. Clicking your own card
// on your profile, or Support in the header or at the bottom, opens the dialog to support or pick a frame.
const API = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/supporter';
const KEY = 'sb_publishable_6jWrlp6aNe4REB4v-uebxA_giKYde2o';
const CACHE = 'chess-trainer-supporters'; // the last list, so badges show at once on the next page
export const FRAMES = [['holo', 'Holo'], ['prism', 'Prism'], ['chrome', 'Chrome'], ['gold', 'Gold foil'], ['neon', 'Neon'], ['ice', 'Ice'],
  ['lava', 'Lava'], ['galaxy', 'Galaxy'], ['tilt', '3D tilt'], ['oil', 'Soap bubble'], ['glitch', 'Glitch'], ['none', 'No frame']];
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C1 8.6 3 5 6.5 5c2 0 3.6 1.1 4.5 2.6l1 1.4 1-1.4C13.9 6.1 15.5 5 17.5 5 21 5 23 8.6 21.6 11.8 19.5 16.4 12 21 12 21z"/></svg>';
// The price as Stripe's Checkout will show it: the one price is in USD, EUR, GBP, SEK, NOK, DKK, INR, CAD and AUD,
// picked by where you are (here guessed from the time zone; Stripe goes by the buyer's location).
const EURO = /^Europe\/(Amsterdam|Andorra|Athens|Berlin|Bratislava|Brussels|Dublin|Helsinki|Lisbon|Ljubljana|Luxembourg|Madrid|Malta|Monaco|Paris|Riga|Rome|San_Marino|Tallinn|Vatican|Vienna|Vilnius|Zagreb)$|^Asia\/(Nicosia|Famagusta)$|^Atlantic\/(Azores|Madeira|Canary)$/;
const PRICE = (() => { let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {} return /^Europe\/(Stockholm|Oslo)$/.test(tz) ? '55 kr' : tz === 'Europe/Copenhagen' ? '35 kr' : tz === 'Europe/London' ? '£4' : EURO.test(tz) ? '€5'
  : /^Asia\/(Kolkata|Calcutta)$/.test(tz) ? '₹400' : /^Australia\//.test(tz) ? 'A$8'
  : /^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Moncton|Whitehorse|Iqaluit|Yellowknife)$/.test(tz) ? 'CA$7' : '$5'; })();
const login = () => { try { return JSON.parse(localStorage.getItem('chess-trainer-lichess-login')) || null; } catch { return null; } };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

let map = new Map(), wall = [];
try { const kept = JSON.parse(localStorage.getItem(CACHE)) || []; map = new Map(kept.map((x) => (Array.isArray(x) ? x : [x.p, x.f]))); wall = kept.filter((x) => !Array.isArray(x)); } catch {}
const frameOf = (name) => map.get(String(name || '').toLowerCase());
// Whether a name supports Chess Labs (and shows it), for other scripts: the animated card, the Supporters page.
export const supporterOf = (name) => map.has(String(name || '').toLowerCase());
export const supportersList = () => wall;
window.supporterOf = supporterOf;
// Ideas supporters vote on: what to build next (the ids are kept with their votes, so keep them).
export const IDEAS = [['more-frames', 'More frames, animated ones too'], ['card-colour', 'Pick the colour of your card'], ['confetti', 'Your own confetti and stamp colours'],
  ['more-games', 'Read your last 1,000 games, not 500'], ['repertoire', 'Save your own repertoire and drill it'], ['own-puzzles', 'Puzzle rush from your own games'],
  ['clubs', 'Club pages: a club’s cards side by side'], ['chesscom-login', 'Log in with Chess.com']];

async function api(query = '', body) {
  const r = await fetch(API + query, { method: body ? 'POST' : 'GET', headers: { apikey: KEY, 'x-lichess-token': login()?.token || '', 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const x = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(x.error || 'Could not reach Chess Labs. Try again in a minute.');
  return x;
}

// The heart by a supporter's name, and their frame around their card.
function decorate() {
  for (const el of document.querySelectorAll('[data-supporter-name]')) {
    const on = map.has(el.dataset.supporterName.toLowerCase()), has = el.querySelector('.sup-heart');
    if (on && !has) el.insertAdjacentHTML('beforeend', `<span class="sup-heart" title="Supports Chess Labs">${HEART}</span>`);
    if (!on && has) has.remove();
  }
  for (const card of document.querySelectorAll('.pf-pcard[data-player]')) {
    const f = frameOf(card.dataset.player), wrap = card.parentElement.classList.contains('sup-fx') ? card.parentElement : null;
    if (!f || f === 'none') { if (wrap) wrap.replaceWith(card); continue; }
    if (wrap) { wrap.className = `sup-fx fx-${f}`; continue; }
    const w = document.createElement('div');
    w.className = `sup-fx fx-${f}`;
    card.before(w); w.append(card);
  }
}
let queued = false;
new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; decorate(); }); } }).observe(document.body, { childList: true, subtree: true });
decorate();
const listed = api().then((xs) => { wall = xs; map = new Map(xs.map((x) => [x.p, x.f])); try { localStorage.setItem(CACHE, JSON.stringify(xs)); } catch {} decorate(); return xs; }).catch(() => wall);
export const supportersReady = () => listed;

// Your own supporter state (kept, so the menu and early features are there at once): Supporter settings in the
// menu under your name, and data-early on the page for features supporters try first.
const ME = 'chess-trainer-supporter-me';
let mine = null;
try { mine = JSON.parse(localStorage.getItem(ME)); } catch {}
function applyMine() {
  const on = !!(login() && mine?.active && mine.name === login().name?.toLowerCase());
  document.documentElement.toggleAttribute('data-early', on && !!mine.prefs?.early);
  const menu = document.querySelector('.top-me-menu');
  if (menu && on && !menu.querySelector('[data-sup-settings]')) menu.querySelector('.top-me-out')?.insertAdjacentHTML('beforebegin', '<button type="button" data-sup-settings>Supporter settings</button>');
  if (menu && !on) menu.querySelector('[data-sup-settings]')?.remove();
}
// At most every 10 minutes: each call asks Lichess who you are, and too many get the server shut out.
const keepMine = (st) => { mine = { ...st, name: login()?.name?.toLowerCase(), at: Date.now() }; try { localStorage.setItem(ME, JSON.stringify(mine)); } catch {} applyMine(); };
if (login() && !(mine?.name === login().name?.toLowerCase() && Date.now() - (mine.at || 0) < 600_000)) api('?me').then(keepMine).catch(() => {});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyMine); else applyMine();
setTimeout(applyMine, 500); // the menu is drawn by header.js once the page is in
document.addEventListener('click', (e) => { if (e.target.closest?.('[data-sup-settings]')) { e.target.closest('details')?.removeAttribute('open'); openSupport(); } });

// 3D tilt: the card leans toward the pointer, and the shine follows it.
document.addEventListener('pointermove', (e) => {
  const w = e.target.closest?.('.fx-tilt');
  if (!w) return;
  const r = w.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  w.style.setProperty('--ry', `${(x - .5) * 18}deg`); w.style.setProperty('--rx', `${(.5 - y) * 18}deg`); w.style.setProperty('--gx', `${x * 100}%`); w.style.setProperty('--gy', `${y * 100}%`);
});
document.addEventListener('pointerout', (e) => { const w = e.target.closest?.('.fx-tilt'); if (w && !w.contains(e.relatedTarget)) { w.style.setProperty('--rx', '0deg'); w.style.setProperty('--ry', '0deg'); } });

// Your own card on your profile opens the dialog.
document.addEventListener('click', (e) => {
  const card = e.target.closest?.('#profile .pf-pcard[data-player]');
  if (card && card.dataset.player === login()?.name?.toLowerCase()) openSupport();
});

// The dialog: support for $5 a month (logged in with Lichess), or, as a supporter, pick your frame and
// manage the subscription.
let dlg = null;
export async function openSupport() {
  dlg?.remove();
  const me = login();
  dlg = document.createElement('dialog');
  dlg.className = 'chat sup-dlg';
  dlg.innerHTML = `<header class="chat-head"><h2>Support Chess Labs</h2><button type="button" class="chat-x" aria-label="Close">×</button></header><div class="sup-body"><p class="chat-note">Loading…</p></div>`;
  document.body.append(dlg);
  dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); dlg = null; };
  dlg.querySelector('.chat-x').addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  const body = dlg.querySelector('.sup-body');
  dlg.addEventListener('click', async (e) => { if (e.target.closest('[data-sup-idea]')) { close(); (await import('./chat.js?v=20261102141013')).openChat(); } });
  const grid = (pick, on) => `<div class="sup-frames${pick ? '' : ' locked'}">${FRAMES.map(([k, t]) => `<button type="button" class="sup-frame${k === on ? ' on' : ''}" data-frame="${k}"${pick ? '' : ' disabled'}><span class="sup-fx fx-${k}"><span class="sup-mini"></span></span><small>${t}</small></button>`).join('')}</div>`;
  const pitch = `<p class="sup-lead"><b>Everything on Chess Labs is free, and always will be.</b> No paywall, no ads, no locked features.</p>
    <p>This isn't a site to make money from. It costs money to run, though: the servers, the database and the analysis. If you want to help keep it going, you can support it for <b>${PRICE} a month</b>, and you get something small back.</p>
    <p class="sup-k">What supporters get</p>
    <ul class="sup-perks"><li>A heart by your name, everywhere on the site: your profile, the leaderboard, comparisons</li><li>A frame of your choice around your player card</li><li>Your name on the Supporters page</li><li>A vote on what gets built next</li><li>New features before everyone else</li><li>Your card as a video, to share</li></ul>
    <p class="sup-k">The frames</p>${grid(false)}
    <div class="sup-idea"><p><b>Chess Labs is made by the community, for the community.</b> What should supporters get? Tell us your ideas.</p><button type="button" class="ghost" data-sup-idea>Suggest a perk</button></div>`;
  if (!me) { body.innerHTML = `${pitch}<p><a class="cta" href="profile.html?login">Log in with Lichess</a></p><p class="info">Supporting is tied to your Lichess name, so log in first.</p>`; return; }
  let st;
  try { st = await api('?me'); } catch (e) { body.innerHTML = `<p class="chat-err">${esc(e.message)}</p>`; return; }
  const err = '<p class="chat-err" role="alert" hidden></p>';
  const fail = (m) => { const p = body.querySelector('.chat-err'); p.textContent = m; p.hidden = false; };
  if (!st.active) {
    body.innerHTML = `${pitch}
      <button type="button" class="cta sup-go">Support for ${PRICE} a month</button><p class="info">Paid through Stripe. Cancel any time.</p>${err}`;
    body.querySelector('.sup-go').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { location.href = (await api('?checkout', {})).url; } catch (x) { console.warn(x.message); fail('Could not open the payment page. Try again in a minute, or message the admins.'); e.target.disabled = false; }
    });
    return;
  }
  keepMine(st);
  dlg.querySelector('.chat-head h2').textContent = 'Supporter settings';
  const prefs = { badge: true, wall: true, early: false, ...st.prefs }, votes = new Set(st.votes || []);
  const toggle = (k, t, s) => `<label class="sup-opt"><input type="checkbox" data-pref="${k}"${prefs[k] ? ' checked' : ''}><span><b>${t}</b><small>${s}</small></span></label>`;
  body.innerHTML = `<p><b>Thank you for supporting Chess Labs, ${esc(me.name)}.</b></p>
    <p class="sup-k">Your frame</p>${grid(true, st.frame)}
    <p class="sup-k">Show and try</p>
    ${toggle('badge', 'Show my heart and frame', 'By your name and around your card, on your profile, the leaderboard and in comparisons.')}
    ${toggle('wall', 'List me on the Supporters page', 'Your name on <a href="supporters.html">the page that thanks supporters</a>.')}
    ${toggle('early', 'Try new features first', 'New things are switched on for you a while before everyone else.')}
    <p class="sup-k">Vote: what should be built next?</p><p class="info">Pick as many as you like. Only supporters vote.</p>
    <ul class="sup-votes">${IDEAS.map(([k, t]) => `<li><label class="sup-vote"><input type="checkbox" data-vote="${k}"${votes.has(k) ? ' checked' : ''}><span>${esc(t)}</span><b data-count="${k}"></b></label></li>`).join('')}</ul>
    <div class="sup-idea"><p>Something else? Chess Labs is made by the community, for the community.</p><button type="button" class="ghost" data-sup-idea>Suggest an idea</button></div>${err}
    ${st.customer ? '<button type="button" class="ghost sup-portal">Cancel the subscription or change card</button>' : ''}`;
  const counts = () => api('?votes').then(({ counts: c }) => body.querySelectorAll('[data-count]').forEach((b) => { const n = c[b.dataset.count] || 0; b.textContent = n ? `${n} vote${n === 1 ? '' : 's'}` : ''; })).catch(() => {});
  counts();
  body.querySelectorAll('[data-pref]').forEach((c) => c.addEventListener('change', async () => {
    try { const r = await api('', { prefs: { [c.dataset.pref]: c.checked } }); keepMine({ ...st, prefs: r.prefs }); if (c.dataset.pref === 'badge') location.reload(); }
    catch (x) { c.checked = !c.checked; fail(x.message); }
  }));
  body.querySelectorAll('[data-vote]').forEach((c) => c.addEventListener('change', async () => {
    c.checked ? votes.add(c.dataset.vote) : votes.delete(c.dataset.vote);
    try { await api('', { votes: [...votes] }); counts(); } catch (x) { c.checked = !c.checked; fail(x.message); }
  }));
  body.querySelectorAll('[data-frame]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const { frame } = await api('', { frame: b.dataset.frame });
      map.set(me.name.toLowerCase(), frame); try { localStorage.setItem(CACHE, JSON.stringify([...map])); } catch {}
      body.querySelectorAll('[data-frame]').forEach((x) => x.classList.toggle('on', x === b)); decorate();
    } catch (x) { fail(x.message); }
  }));
  body.querySelector('.sup-portal')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { location.href = (await api('?portal', {})).url; } catch (x) { fail(x.message); e.target.disabled = false; }
  });
}

// Back from Stripe: Stripe tells the server a moment later, so ask a few times, then open the dialog.
if (new URLSearchParams(location.search).has('supported')) {
  history.replaceState(null, '', location.href.replace(/[?&]supported=1/, ''));
  (async () => {
    for (let i = 0; i < 6; i++) {
      const st = await api('?me').catch(() => null);
      if (st?.active) { map.set(login().name.toLowerCase(), st.frame); decorate(); break; }
      await new Promise((r) => setTimeout(r, 2000));
    }
    openSupport();
  })();
}
