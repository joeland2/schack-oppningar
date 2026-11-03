// Supporters: everyone who supports Chess Labs and chose to be listed (longest first, or newest first), each in the frame they
// picked, linking to their profile.
import { supportersReady, PRICE } from './supporter.js?v=20261103152739';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const HEART = '<svg class="sups-heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C1 8.6 3 5 6.5 5c2 0 3.6 1.1 4.5 2.6l1 1.4 1-1.4C13.9 6.1 15.5 5 17.5 5 21 5 23 8.6 21.6 11.8 19.5 16.4 12 21 12 21z"/></svg>';
const nick = (n) => n.replace(/^cc:/, '');
document.getElementById('sups-price').textContent = `Support for ${PRICE} a month`;
// Longest supporting first; Newest first turns it round.
let all = [], newest = false;
const render = () => {
  const shown = all.filter((x) => x.w !== 0);
  document.querySelector('.sups-sort').hidden = shown.length < 2;
  shown.sort((a, b) => String(a.since || '').localeCompare(String(b.since || '')) * (newest ? -1 : 1));
  document.getElementById('sups-list').innerHTML = shown.length
    ? shown.map((x) => `<li><a class="sup-fx fx-${esc(x.f === 'none' ? 'holo' : x.f)}" href="profile.html?u=${encodeURIComponent(x.p)}"><span class="sups-name">${HEART}${esc(nick(x.p))}</span></a></li>`).join('')
    : '<li class="info">No one is listed yet. Be the first.</li>';
};
document.querySelectorAll('[data-sups-sort]').forEach((b) => b.addEventListener('click', () => {
  newest = b.dataset.supsSort === 'new';
  document.querySelectorAll('[data-sups-sort]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  render();
}));
supportersReady().then((xs) => { all = xs; document.getElementById('sups-n').textContent = xs.length; render(); });

// The Play screenshots: a click shows one large; the arrow keys go to the next and back, Esc or a click outside closes it.
const lb = document.querySelector('.sups-lb'), shots = [...document.querySelectorAll('.sups-zoom')];
let at = 0;
const show = (i) => {
  at = (i + shots.length) % shots.length;
  const img = shots[at].querySelector('img');
  lb.querySelector('img').src = img.src; lb.querySelector('img').alt = img.alt;
  lb.querySelector('p').textContent = shots[at].nextElementSibling.textContent;
  if (!lb.open) lb.showModal();
};
shots.forEach((b, i) => b.addEventListener('click', () => show(i)));
lb.addEventListener('click', (e) => { if (e.target === lb || e.target.closest('.sups-lb-x')) lb.close(); });
lb.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') show(at + 1); if (e.key === 'ArrowLeft') show(at - 1); });
