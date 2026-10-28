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
