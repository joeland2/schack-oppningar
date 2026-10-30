// Usage counting (supabase/schema.sql), on every page: a page view, and window.track(kind, target) for
// what people do. The visitor is a random id kept in this browser; the Lichess name only when logged
// in. The track Edge Function adds the country and the IP address with its last part zeroed. Not
// counted on this computer's own server.
(() => {
  const API = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/track';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  let visitor = 'anon';
  try { visitor = localStorage.getItem('chess-trainer-visitor') || crypto.randomUUID(); localStorage.setItem('chess-trainer-visitor', visitor); } catch {}
  const user = () => { try { return JSON.parse(localStorage.getItem('chess-trainer-lichess-login'))?.name || null; } catch { return null; } };
  const page = location.pathname.split('/').pop() || 'index.html';
  // Where this visit came from: the other site's name on the first page of a visit, else Direct; later pages send none.
  const source = (() => { try {
    if (sessionStorage.getItem('chess-trainer-source')) return null;
    sessionStorage.setItem('chess-trainer-source', '1');
    const host = document.referrer && new URL(document.referrer).hostname;
    return host && host !== location.hostname ? host.replace(/^www\./, '') : 'Direct';
  } catch { return null; } })();
  // The admin's own visits are not counted: on any device where they are logged in, or where they have
  // opened the admin page once (it marks the browser, so it stays out even when logged out).
  const ADMINS = ['joelandersson', 'sicko88'];
  const own = () => { try { return ADMINS.includes(user()?.toLowerCase()) || localStorage.getItem('chess-trainer-no-track') === '1'; } catch { return false; } };
  window.track = (kind, target = null) => {
    if (local || own()) return;
    fetch(API, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' }, // plain text: no preflight, so it still goes as the page closes
      body: JSON.stringify({ kind, page, target: target && String(target).slice(0, 80), visitor, user_name: user(), source: kind === 'view' ? source : null }) }).catch(() => {});
  };
  window.track('view');
  // The admin's own menu has an Admin link (the page itself checks the login with Lichess).
  addEventListener('DOMContentLoaded', () => {
    // The scorebug: your rating on every page (Openings has its own, editable one), to your profile.
    let speed = 'blitz', rating = null;
    try { speed = JSON.parse(localStorage.getItem('opening-book-v2-speed')) || speed; rating = JSON.parse(localStorage.getItem(`opening-book-v2-${speed}-rating`)); } catch {}
    const at = document.querySelector('.top-players');
    if (rating && at && !document.querySelector('.account')) {
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`), who = user();
      at.insertAdjacentHTML('beforebegin', `<a class="top-bug" href="${who ? `profile.html?u=${encodeURIComponent(who)}` : './'}" title="Your ${speed} rating"><small>${esc(speed)}<br>${esc(who || 'you')}</small><strong>${esc(rating)}</strong></a>`);
    }
    // Logged out, the Profile section reads Log in: the profile page logs in and comes back to your profile.
    const prof = document.querySelector('.top-nav a[href="profile.html"]');
    // Logged out, Log in sits in the top row (Openings has its own button there) instead of the sections.
    if (!user() && prof) {
      if (!document.querySelector('#lichess-login')) document.querySelector('.top-players')?.insertAdjacentHTML('beforebegin', '<a class="top-login" href="profile.html?login" title="Log in with Lichess to see your profile">Log in</a>');
      prof.remove();
    }
    if (!user()) document.querySelector('.top-nav a[href="practice.html"]:not([aria-current])')?.remove(); // your practice plan needs your games
    const practice = document.querySelector('.top-nav a[href="practice.html"]');
    if (practice) practice.innerHTML = '<span class="wide-only">My&nbsp;</span>practice'; // phones: the sections fit one row
    const board = `<a href="leaderboard.html"${page === 'leaderboard.html' ? ' aria-current="page"' : ''}>Leaderboard</a>`;
    if (prof?.isConnected) prof.insertAdjacentHTML('beforebegin', board); else document.querySelector('.top-nav')?.insertAdjacentHTML('beforeend', board);
    if (ADMINS.includes(user()?.toLowerCase())) document.querySelector('.top-nav')?.insertAdjacentHTML('beforeend', `<a href="admin.html"${page === 'admin.html' ? ' aria-current="page"' : ''}>Admin</a>`);
  });
})();

// The header's ★ menu: your starred players (starred on their profile), one click to each profile.
// A plain script on every page; the menu is a <details>, so it opens without this script and this
// only fills it and closes it on an outside click.
addEventListener('DOMContentLoaded', () => {
  const menu = document.querySelector('.top-players');
  if (!menu) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const fill = () => {
    let names = [];
    try { names = JSON.parse(localStorage.getItem('opening-book-v2-players')) || []; } catch {}
    menu.querySelector('.top-players-menu').innerHTML = names.length
      ? names.map((n) => `<a href="profile.html?u=${encodeURIComponent(n)}">${esc(n)}</a>`).join('')
      : '<p>No starred players yet. Open a player\'s profile and press ☆ Star player.</p>';
  };
  menu.addEventListener('toggle', () => { if (menu.open) fill(); });
  addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); } });
});

// Sync (supabase/functions/userdata): when logged in with Lichess, what the site keeps for you (stars and
// progress in every opening, favourites, starred players, settings) lives on your account, so every
// device shows the same. The browser keeps a working copy: each key's last change time is noted, the
// newer of two copies wins, and the first time a device meets the account its progress is added to the
// account's rather than replaced. Caches that rebuild themselves (engine, games, profiles) stay local.
(() => {
  const API = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/userdata', META = 'chess-trainer-sync';
  const CACHE = ['-sf', '-games', '-profiles', '-mistakes'];
  const synced = (k) => (k.startsWith('opening-book-v2') && !CACHE.some((c) => k.endsWith(c))) || k.endsWith('-solved-v1') || k === 'chess-theme' || k === 'chess-trainer-card-look';
  // Lists and progress are added together on a device's first sync; everything else simply takes the newer.
  const MERGE = (k) => k === 'opening-book-v2' || k === 'opening-book-v2-rep' || k === 'opening-book-v2-players' || k.endsWith('-solved-v1');
  const ls = window.localStorage, set = Storage.prototype.setItem, del = Storage.prototype.removeItem;
  const token = () => { try { return JSON.parse(ls.getItem('chess-trainer-lichess-login'))?.token || null; } catch { return null; } };
  const readMeta = () => { try { return JSON.parse(ls.getItem(META)) || {}; } catch { return {}; } };
  let meta = readMeta(); meta.t ??= {}; meta.dirty ??= {};
  const saveMeta = () => { try { set.call(ls, META, JSON.stringify(meta)); } catch {} };
  let applying = false, timer = 0;
  // Every change to a synced key is noted, and sent a moment later.
  const note = (k) => { if (applying || !synced(k)) return; meta.t[k] = Date.now(); meta.dirty[k] = 1; saveMeta(); clearTimeout(timer); timer = setTimeout(push, 1500); };
  Storage.prototype.setItem = function (k, v) { set.call(this, k, v); if (this === ls) note(k); };
  Storage.prototype.removeItem = function (k) { del.call(this, k); if (this === ls) note(k); };
  const union = (a, b) => {
    if (Array.isArray(a) && Array.isArray(b)) { const seen = new Set(a.map((x) => JSON.stringify(x))); return [...a, ...b.filter((x) => !seen.has(JSON.stringify(x)))]; }
    if (a && b && typeof a === 'object' && typeof b === 'object') { const o = { ...a }; for (const k of Object.keys(b)) o[k] = k in a ? union(a[k], b[k]) : b[k]; return o; }
    if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b);
    return b ?? a;
  };
  console.assert(JSON.stringify(union({ x: { done: ['a'], total: 3 } }, { x: { done: ['b', 'a'], total: 4 }, y: 1 })) === '{"x":{"done":["a","b"],"total":4},"y":1}', 'sync union');
  async function push(keepalive = false) {
    const tk = token(), keys = Object.keys(meta.dirty);
    if (!tk || !keys.length) return;
    const data = Object.fromEntries(keys.map((k) => [k, { v: ls.getItem(k), t: meta.t[k] || Date.now() }]));
    try {
      const r = await fetch(API, { method: 'POST', keepalive, headers: { 'content-type': 'application/json', 'x-lichess-token': tk }, body: JSON.stringify({ data }) });
      if (r.ok) { meta = readMeta(); meta.t ??= {}; meta.dirty ??= {}; for (const k of keys) if (meta.t[k] === data[k].t) delete meta.dirty[k]; saveMeta(); }
    } catch {}
  }
  addEventListener('pagehide', () => { if (Object.keys(meta.dirty).length) push(true); });
  async function pull() {
    const tk = token();
    if (!tk) return;
    let server = {};
    try { const r = await fetch(API, { headers: { 'x-lichess-token': tk } }); if (!r.ok) return; server = (await r.json()).data || {}; } catch { return; }
    const first = meta.user !== tk.slice(-12); // this device's first sync with this login
    let changed = false;
    applying = true;
    const keys = new Set([...Object.keys(server), ...Object.keys(ls).filter(synced)]);
    for (const k of keys) {
      const s = server[k], local = ls.getItem(k), lt = meta.t[k] || 0;
      if (!s) { if (local !== null) { meta.t[k] ||= Date.now(); meta.dirty[k] = 1; } continue; }
      if (first && local !== null && s.v !== null && MERGE(k) && local !== s.v) {
        try { const v = JSON.stringify(union(JSON.parse(s.v), JSON.parse(local))); set.call(ls, k, v); meta.t[k] = Date.now(); meta.dirty[k] = 1; changed = v !== local; continue; } catch {}
      }
      if (s.t > lt || (first && lt === 0)) {
        if (s.v !== local) { if (s.v === null) del.call(ls, k); else set.call(ls, k, s.v); changed = true; }
        meta.t[k] = s.t; delete meta.dirty[k];
      } else if (lt > s.t) meta.dirty[k] = 1;
    }
    applying = false;
    meta.user = tk.slice(-12);
    saveMeta();
    push();
    // The page was drawn from the old copy: draw it again from the account's, once.
    if (changed && !sessionStorage.getItem('chess-trainer-synced')) { sessionStorage.setItem('chess-trainer-synced', '1'); location.reload(); }
    else sessionStorage.removeItem('chess-trainer-synced');
  }
  pull();
})();

// Player search in the top row: while you type, up to three players you opened before (kept with your
// account), then real Lichess names that start with what you typed.
(() => {
  const form = document.querySelector('.top-search'), input = form?.querySelector('input[name=u]');
  const KEY = 'opening-book-v2-recent-players';
  const recent = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const q = new URLSearchParams(location.search);
  if (/profile\.html$/.test(location.pathname) && q.get('u') && !q.has('vs')) {
    const u = q.get('u');
    try { localStorage.setItem(KEY, JSON.stringify([u, ...recent().filter((x) => x.toLowerCase() !== u.toLowerCase())].slice(0, 20))); } catch {}
  }
  if (!input) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const list = document.createElement('ul');
  list.className = 'top-suggest'; list.id = 'top-suggest'; list.role = 'listbox'; list.hidden = true;
  form.append(list);
  input.setAttribute('aria-controls', 'top-suggest'); input.setAttribute('aria-autocomplete', 'list');
  let items = [], at = -1, seq = 0;
  const go = (name) => { location.href = `profile.html?u=${encodeURIComponent(name)}`; };
  const draw = () => {
    list.hidden = !items.length;
    list.innerHTML = items.map((x, i) => `${!i || x.kind !== items[i - 1].kind ? `<li class="top-suggest-k" role="presentation">${x.kind === 'recent' ? 'Opened before' : 'On Lichess'}</li>` : ''}
      <li role="option" id="ts-${i}" data-i="${i}" aria-selected="${i === at}">${x.title ? `<b class="ts-title">${esc(x.title)}</b> ` : ''}${esc(x.name)}${x.online ? '<i class="ts-on" title="Online"></i>' : ''}</li>`).join('');
    input.setAttribute('aria-expanded', String(!list.hidden));
    if (at >= 0) input.setAttribute('aria-activedescendant', `ts-${at}`); else input.removeAttribute('aria-activedescendant');
  };
  let timer = 0;
  const update = () => {
    const t = input.value.trim().toLowerCase(), mine = ++seq;
    const old = recent().filter((x) => !t || x.toLowerCase().includes(t)).slice(0, 3).map((name) => ({ name, kind: 'recent' }));
    items = old; at = -1; draw();
    clearTimeout(timer);
    if (t.length < 3) return;
    timer = setTimeout(async () => {
      try {
        const r = await fetch(`https://lichess.org/api/player/autocomplete?term=${encodeURIComponent(t)}&object=true`);
        const found = r.ok ? (await r.json()).result || [] : [];
        if (mine !== seq) return;
        const seen = new Set(old.map((x) => x.name.toLowerCase()));
        items = [...old, ...found.filter((p) => !seen.has(p.name.toLowerCase())).slice(0, 7).map((p) => ({ name: p.name, title: p.title, online: p.online, kind: 'lichess' }))];
        draw();
      } catch {}
    }, 200);
  };
  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }, 150));
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = items.length + 1; at = (at + 1 + (e.key === 'ArrowDown' ? 1 : -1) + n) % n - 1; draw(); }
    else if (e.key === 'Enter' && at >= 0) { e.preventDefault(); go(items[at].name); }
    else if (e.key === 'Escape') { list.hidden = true; at = -1; }
  });
  list.addEventListener('mousedown', (e) => { const li = e.target.closest('[data-i]'); if (li) { e.preventDefault(); go(items[+li.dataset.i].name); } });
})();
