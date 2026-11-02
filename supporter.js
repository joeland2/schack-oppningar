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
const login = () => { try { return JSON.parse(localStorage.getItem('chess-trainer-lichess-login')) || null; } catch { return null; } };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

let map = new Map();
try { map = new Map(JSON.parse(localStorage.getItem(CACHE)) || []); } catch {}
const frameOf = (name) => map.get(String(name || '').toLowerCase());

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
api().then((xs) => { map = new Map(xs.map((x) => [x.p, x.f])); try { localStorage.setItem(CACHE, JSON.stringify([...map])); } catch {} decorate(); }).catch(() => {});

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
  dlg.addEventListener('click', async (e) => { if (e.target.closest('[data-sup-idea]')) { close(); (await import('./chat.js?v=20261102093629')).openChat(); } });
  const grid = (pick, on) => `<div class="sup-frames${pick ? '' : ' locked'}">${FRAMES.map(([k, t]) => `<button type="button" class="sup-frame${k === on ? ' on' : ''}" data-frame="${k}"${pick ? '' : ' disabled'}><span class="sup-fx fx-${k}"><span class="sup-mini"></span></span><small>${t}</small></button>`).join('')}</div>`;
  const pitch = `<p class="sup-lead"><b>Everything on Chess Labs is free, and always will be.</b> No paywall, no ads, no locked features.</p>
    <p>This isn't a site to make money from. It costs money to run, though: the servers, the database and the analysis. If you want to help keep it going, you can support it for <b>$5 a month</b>, and you get something small back.</p>
    <p class="sup-k">What supporters get</p>
    <ul class="sup-perks"><li>A heart by your name, everywhere on the site</li><li>A frame of your choice around your player card</li></ul>
    <p class="sup-k">The frames</p>${grid(false)}
    <div class="sup-idea"><p><b>Chess Labs is made by the community, for the community.</b> What should supporters get? Tell us your ideas.</p><button type="button" class="ghost" data-sup-idea>Suggest a perk</button></div>`;
  if (!me) { body.innerHTML = `${pitch}<p><a class="cta" href="profile.html?login">Log in with Lichess</a></p><p class="info">Supporting is tied to your Lichess name, so log in first.</p>`; return; }
  let st;
  try { st = await api('?me'); } catch (e) { body.innerHTML = `<p class="chat-err">${esc(e.message)}</p>`; return; }
  const err = '<p class="chat-err" role="alert" hidden></p>';
  const fail = (m) => { const p = body.querySelector('.chat-err'); p.textContent = m; p.hidden = false; };
  if (!st.active) {
    body.innerHTML = `${pitch}
      <button type="button" class="cta sup-go">Support for $5 a month</button><p class="info">Paid through Stripe. Cancel any time.</p>${err}`;
    body.querySelector('.sup-go').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { location.href = (await api('?checkout', {})).url; } catch (x) { console.warn(x.message); fail('Could not open the payment page. Try again in a minute, or message the admins.'); e.target.disabled = false; }
    });
    return;
  }
  body.innerHTML = `<p><b>Thank you for supporting Chess Labs, ${esc(me.name)}.</b> Pick the frame around your card:</p>${grid(true, st.frame)}${err}
    <div class="sup-idea"><p>What else should supporters get? Chess Labs is made by the community, for the community.</p><button type="button" class="ghost" data-sup-idea>Suggest a perk</button></div>
    ${st.customer ? '<button type="button" class="ghost sup-portal">Cancel the subscription or change card</button>' : ''}`;
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
