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
      body: JSON.stringify({ kind, page, target: target && String(target).slice(0, kind === 'line' ? 400 : kind === 'error' ? 160 : 80), visitor, user_name: user(), source: kind === 'view' ? source : null }) }).catch(() => {});
  };
  window.track('view');
  // Errors the page meets, so the admin page shows what breaks: each message once, at most five a page.
  // Errors from other sites' scripts come as a bare "Script error." and say nothing, so they are left out.
  const said = new Set();
  window.trackError = (msg) => {
    msg = String(msg || '').trim().slice(0, 160);
    if (!msg || /^Script error\.?$/.test(msg) || said.has(msg) || said.size >= 5) return;
    said.add(msg); window.track('error', msg);
  };
  addEventListener('error', (e) => window.trackError(e.message));
  addEventListener('unhandledrejection', (e) => window.trackError(e.reason?.message || e.reason));
  // The admin's own menu has an Admin link (the page itself checks the login with Lichess).
  addEventListener('DOMContentLoaded', () => {
    // The scorebug: your rating on every page (Openings has its own, editable one), to your profile.
    let speed = 'blitz', rating = null;
    try { speed = JSON.parse(localStorage.getItem('opening-book-v2-speed')) || speed; rating = JSON.parse(localStorage.getItem(`opening-book-v2-${speed}-rating`)); } catch {}
    const at = document.querySelector('.top-players');
    if (rating && at && !document.querySelector('.account') && !user()) { // logged in, it heads your menu (below)
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`), who = user();
      at.insertAdjacentHTML('beforebegin', `<a class="top-bug" href="${who ? `profile.html?u=${encodeURIComponent(who)}` : './'}" title="Your ${speed} rating"><small>${esc(speed)}<br>${esc(who || 'you')}</small><strong>${esc(rating)}</strong></a>`);
    }
    at?.insertAdjacentHTML('beforebegin', '<button type="button" class="top-support" data-support title="Support Chess Labs"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C1 8.6 3 5 6.5 5c2 0 3.6 1.1 4.5 2.6l1 1.4 1-1.4C13.9 6.1 15.5 5 17.5 5 21 5 23 8.6 21.6 11.8 19.5 16.4 12 21 12 21z"/></svg><span>Support</span></button>');
    const nav = document.querySelector('.top-nav');
    nav?.querySelector('a[href="./#openings"]')?.insertAdjacentHTML('afterend', `<a href="endgames.html"${page === 'endgames.html' ? ' aria-current="page"' : ''}>Endgames</a>`);
    // Profile and My practice are in the menu under your name, so the sections fit one row on phones.
    // Logged out, Log in sits in the top row instead (Openings has its own button there).
    nav?.querySelector('a[href="profile.html"]')?.remove();
    nav?.querySelector('a[href="practice.html"]')?.remove();
    if (!user() && !document.querySelector('#lichess-login')) at?.insertAdjacentHTML('beforebegin', '<a class="top-login" href="profile.html?login" title="Log in to see your profile">Log in</a>');
    nav?.insertAdjacentHTML('beforeend', `<a href="leaderboard.html"${page === 'leaderboard.html' ? ' aria-current="page"' : ''}>Leaderboard</a><a href="stars.html"${page === 'stars.html' ? ' aria-current="page"' : ''}>PRO/VIP</a><a href="playstyles.html"${page === 'playstyles.html' ? ' aria-current="page"' : ''}>Styles</a>`);
    const who = user();
    if (who) {
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`), btn = document.querySelector('#lichess-login');
      const cur = (p) => (page === p ? ' aria-current="page"' : '');
      const shownName = who.replace(/^cc:/i, ''); // a Chess Labs account is its Chess.com name
      const head = btn ? `<span class="top-me-name">${esc(shownName)}</span>` : rating ? `<span class="top-me-who"><b>${esc(shownName)}</b><small>Your profile</small></span><strong title="${esc(speed)} rating">${esc(rating)}</strong><i class="top-me-chev" aria-hidden="true">▾</i>` : `<span class="top-me-name">${esc(shownName)}</span>`;
      const menu = `<details class="top-me"><summary class="${rating && !btn ? 'top-bug' : ''}" title="Your profile">${head}</summary><div class="top-me-menu">
        <a href="profile.html?u=${encodeURIComponent(who)}"${cur('profile.html')}>Profile</a><a href="practice.html"${cur('practice.html')}>My practice</a><button type="button" class="top-me-out">Log out</button></div></details>`;
      if (btn) { btn.insertAdjacentHTML('beforebegin', menu); btn.style.display = 'none'; } // Openings: in place of its name button
      else at?.insertAdjacentHTML('beforebegin', menu);
      const me = document.querySelector('.top-me');
      // Hover opens it where there is a mouse; a tap or click opens it anywhere.
      if (matchMedia('(hover: hover)').matches) {
        me.addEventListener('mouseenter', () => { me.open = true; }); me.addEventListener('mouseleave', () => { me.open = false; });
        // With a mouse the menu is already open on hover, so a click on your name goes straight to your profile.
        me.querySelector('summary').addEventListener('click', (e) => { e.preventDefault(); location.href = `profile.html?u=${encodeURIComponent(who)}`; });
      }
      addEventListener('click', (e) => { if (me.open && !me.contains(e.target)) me.open = false; });
      // Log out (as lichess.js logout(), which this plain script cannot import): forget the login, and end it on Lichess or here.
      me.querySelector('.top-me-out').addEventListener('click', () => {
        let tk = null, site = false;
        try { ({ token: tk, site } = JSON.parse(localStorage.getItem('chess-trainer-lichess-login')) || {}); localStorage.removeItem('chess-trainer-lichess-login'); } catch {}
        if (tk && site) fetch('https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/account?logout', { method: 'POST', keepalive: true, headers: { 'x-lichess-token': tk } }).catch(() => {}); // a Chess Labs account
        else if (tk) fetch('https://lichess.org/api/token', { method: 'DELETE', keepalive: true, headers: { Authorization: `Bearer ${tk}` } }).catch(() => {});
        location.href = './';
      });
    }
    if (ADMINS.includes(user()?.toLowerCase())) document.querySelector('.top-nav')?.insertAdjacentHTML('beforeend', `<a class="nav-admin" href="admin.html"${page === 'admin.html' ? ' aria-current="page"' : ''} aria-label="Admin"><span class="wide-only">Admin</span><svg class="ico narrow-only" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></a>`);
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
      ? names.map((n) => `<a href="profile.html?u=${encodeURIComponent(n)}">${esc(n.replace(/^cc:/i, ''))}${/^cc:/i.test(n) ? ' <small>Chess.com</small>' : ''}</a>`).join('')
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
  const synced = (k) => (k.startsWith('opening-book-v2') && !CACHE.some((c) => k.endsWith(c))) || k.endsWith('-solved-v1') || k === 'chess-theme' || k === 'chess-trainer-card-look' || k === 'chess-trainer-admin-notes';
  // Lists and progress are added together on a device's first sync; everything else simply takes the newer.
  const MERGE = (k) => k === 'chess-trainer-admin-notes' || k === 'opening-book-v2' || k === 'opening-book-v2-rep' || k === 'opening-book-v2-players' || k === 'opening-book-v2-endgames' || k.endsWith('-solved-v1');
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
// account), then real Lichess names that start with what you typed. The compare page's name field too.
(() => {
  const form = document.querySelector('.top-search'), input = form?.querySelector('input[name=u]');
  const KEY = 'opening-book-v2-recent-players';
  const recent = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  // The profile page calls this once a player's games could be read, so a mistyped name is never kept.
  window.rememberPlayer = (u) => {
    try { localStorage.setItem(KEY, JSON.stringify([u, ...recent().filter((x) => x.toLowerCase() !== u.toLowerCase())].slice(0, 20))); } catch {}
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  let lists = 0;
  // Any name field can have the list: go(name) is what picking a name does.
  window.playerSuggest = (input, go) => {
    const list = document.createElement('ul'), id = `suggest-${++lists}`;
    list.className = 'top-suggest'; list.id = id; list.role = 'listbox'; list.hidden = true;
    input.parentElement.append(list);
    input.setAttribute('aria-controls', id); input.setAttribute('aria-autocomplete', 'list');
    let items = [], at = -1, seq = 0;
    const found = (x) => x.kind === 'lichess' || x.kind === 'chesscom';
    const draw = () => {
      list.hidden = !items.length;
      list.innerHTML = items.map((x, i) => `${!i || (x.kind !== items[i - 1].kind && !(found(x) && found(items[i - 1]))) ? `<li class="top-suggest-k" role="presentation">${{ recent: 'Opened before', known: 'Pros and streamers' }[x.kind] || 'Players'}</li>` : ''}
        <li role="option" id="${id}-${i}" data-i="${i}" aria-selected="${i === at}">${x.title ? `<b class="ts-title">${esc(x.title)}</b> ` : ''}${esc(x.name.replace(/^cc:/i, ''))}<small class="ts-site${/^cc:/i.test(x.name) ? ' cc' : ''}">${/^cc:/i.test(x.name) ? 'Chess.com' : 'Lichess'}</small>${x.who ? `<small class="ts-who">${esc(x.who)}</small><span class="ts-tag ${x.tag.toLowerCase()}">${x.tag}</span>` : ''}${x.online ? '<i class="ts-on" title="Online"></i>' : ''}</li>`).join('');
      input.setAttribute('aria-expanded', String(!list.hidden));
      if (at >= 0) input.setAttribute('aria-activedescendant', `${id}-${at}`); else input.removeAttribute('aria-activedescendant');
    };
    let timer = 0;
    const update = () => {
      const t = input.value.trim().toLowerCase(), mine = ++seq;
      // Known pros and streamers whose account or own name matches, word by word: "magnus" finds DrNykterstein.
      const known = t.length < 2 ? [] : (window.knownPlayers || []).filter((k) => k.id.includes(t) || k.who.toLowerCase().split(/\s+/).some((w) => w.startsWith(t)) || k.who.toLowerCase().startsWith(t))
        .slice(0, 6).map((k) => ({ name: k.name, who: k.who, title: k.title, kind: 'known', tag: k.kind.toUpperCase() }));
      const old = [...recent().filter((x) => !t || x.toLowerCase().includes(t)).slice(0, 3).map((name) => ({ name, kind: 'recent' })),
        ...known].filter((x, i, a) => a.findIndex((y) => y.name.toLowerCase() === x.name.toLowerCase()) === i);
      items = old; at = -1; draw();
      clearTimeout(timer);
      if (t.length < 3) return;
      timer = setTimeout(async () => {
        try {
          // Chess.com has no name search: the name as typed, shown when that player exists there.
          const [r, ccp] = await Promise.all([fetch(`https://lichess.org/api/player/autocomplete?term=${encodeURIComponent(t)}&object=true`),
            /^[a-z0-9_-]{3,30}$/.test(t) && !old.some((x) => x.name.toLowerCase() === `cc:${t}`) ? fetch(`https://api.chess.com/pub/player/${t}`).then((x) => (x.ok ? x.json() : null)).catch(() => null) : null]);
          const found = r.ok ? (await r.json()).result || [] : [];
          const cc = ccp ? [{ name: `cc:${ccp.username || t}`, title: ccp.title, kind: 'chesscom' }] : [];
          if (mine !== seq) return;
          const seen = new Set(old.map((x) => x.name.toLowerCase()));
          items = [...old, ...cc, ...found.filter((p) => !seen.has(p.name.toLowerCase())).slice(0, 7).map((p) => ({ name: p.name, title: p.title, online: p.online, kind: 'lichess' }))];
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
  };
  if (input) playerSuggest(input, (name) => { location.href = `profile.html?u=${encodeURIComponent(name)}`; });
  // Enter on a name typed as is: the account played on most lately, when it is on both Lichess and Chess.com.
  form?.addEventListener('submit', async (e) => {
    const t = input.value.trim();
    if (/^cc:/i.test(t) || !form.checkValidity()) return;
    e.preventDefault();
    const [li, cc] = await Promise.all([fetch(`https://lichess.org/api/user/${encodeURIComponent(t)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`https://api.chess.com/pub/player/${encodeURIComponent(t.toLowerCase())}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
    const onCC = cc && (!li || li.disabled || (cc.last_online || 0) * 1000 > (li.seenAt || 0));
    location.href = `profile.html?u=${encodeURIComponent(onCC ? `cc:${cc.username || t}` : t)}`;
  });
})();

// Message the admins: a button at the bottom of every page (in the footer where there is one) that
// opens your thread with the admins (chat.js, loaded on the first click).
(() => {
  const add = () => {
    const b = '<div class="foot-acts"><button type="button" class="msg-admins sup-foot" data-support><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C1 8.6 3 5 6.5 5c2 0 3.6 1.1 4.5 2.6l1 1.4 1-1.4C13.9 6.1 15.5 5 17.5 5 21 5 23 8.6 21.6 11.8 19.5 16.4 12 21 12 21z"/></svg>Support Chess Labs</button>'
      + '<button type="button" class="msg-admins" data-msg-admins><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>Message the admins</button></div>';
    const row = document.querySelector('.foot-row');
    if (row) row.insertAdjacentHTML('beforeend', b);
    else document.body.insertAdjacentHTML('beforeend', `<footer class="wrap msg-foot">${b}</footer>`);
    document.querySelector('[data-msg-admins]').addEventListener('click', async () => (await import('./chat.js?v=20261102114609')).openChat());
    // Supporters: the hearts and card frames on every page, and Support (header and bottom) opens its dialog.
    const sup = import('./supporter.js?v=20261102114609');
    document.addEventListener('click', async (e) => { if (e.target.closest('[data-support]')) (await sup).openSupport(); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();

// Preloaded pages: a page whose content comes from the network (Pro & VIP, the leaderboard) shows what it
// showed last time at once, from this browser, and its own script then draws it fresh over it. The
// elements named in <main data-snap="id id"> are kept; not under opening-book-v2, as nothing to sync.
// Links in the menu are fetched ahead on hover or touch, so the next page opens from the cache.
(() => {
  const main = document.querySelector('main[data-snap]');
  if (main) {
    const key = `chesslabs-snap-${location.pathname.replace(/\.html$/, '').replace(/\W/g, '') || 'index'}`;
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(key)); } catch {}
    const els = main.dataset.snap.split(' ').map((id) => document.getElementById(id)).filter(Boolean);
    if (kept) for (const el of els) if (kept[el.id] != null) { el.innerHTML = kept[el.id]; el.removeAttribute('aria-hidden'); }
    // Kept once the page's script has drawn it (no loading skeleton left), a second after the last change.
    let t = 0;
    new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (els.some((el) => el.querySelector('.sk') || el.getAttribute('aria-hidden') === 'true')) return;
        try { localStorage.setItem(key, JSON.stringify(Object.fromEntries(els.map((el) => [el.id, el.innerHTML])))); } catch {}
      }, 1000);
    }).observe(main, { childList: true, subtree: true, characterData: true });
  }
  const ahead = new Set();
  const prefetch = (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || a.origin !== location.origin || ahead.has(a.pathname) || a.pathname === location.pathname) return;
    ahead.add(a.pathname);
    document.head.append(Object.assign(document.createElement('link'), { rel: 'prefetch', href: a.href }));
  };
  addEventListener('pointerover', prefetch, { passive: true });
  addEventListener('touchstart', prefetch, { passive: true });
})();
