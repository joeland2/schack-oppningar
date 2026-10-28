// Light or dark: follows the system until you pick one with the header button; the choice is kept.
// A plain script in <head>, so the saved theme is set before the page is drawn.
(() => {
  const root = document.documentElement;
  try { const saved = localStorage.getItem('chess-theme'); if (saved) root.dataset.theme = saved; } catch {}
  const dark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  const SUN = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
  addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('theme');
    if (!b) return;
    const show = () => {
      const label = dark() ? 'Switch to light mode' : 'Switch to dark mode';
      b.setAttribute('aria-label', label); b.title = label;
      b.innerHTML = dark() ? SUN : MOON;
    };
    b.addEventListener('click', () => {
      root.dataset.theme = dark() ? 'light' : 'dark';
      try { localStorage.setItem('chess-theme', root.dataset.theme); } catch {}
      show();
    });
    show();
  });
})();
