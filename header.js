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
  const own = () => { try { return user()?.toLowerCase() === 'joelandersson' || localStorage.getItem('chess-trainer-no-track') === '1'; } catch { return false; } };
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
    if (!user() && prof) { prof.textContent = 'Log in'; prof.href = 'profile.html?login'; prof.title = 'Log in with Lichess to see your profile'; }
    if (!user()) document.querySelector('.top-nav a[href="practice.html"]:not([aria-current])')?.remove(); // your practice plan needs your games
    prof?.insertAdjacentHTML('beforebegin', `<a href="leaderboard.html"${page === 'leaderboard.html' ? ' aria-current="page"' : ''}>Leaderboard</a>`);
    if (user()?.toLowerCase() === 'joelandersson') document.querySelector('.top-nav')?.insertAdjacentHTML('beforeend', `<a href="admin.html"${page === 'admin.html' ? ' aria-current="page"' : ''}>Admin</a>`);
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
