// Supporters: everyone who supports Chess Labs and chose to be listed, newest first, each in the frame they
// picked, linking to their profile.
import { supportersReady } from './supporter.js?v=20261102141013';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const nick = (n) => n.replace(/^cc:/, '');
supportersReady().then((xs) => {
  const shown = xs.filter((x) => x.w !== 0).sort((a, b) => String(b.since || '').localeCompare(String(a.since || '')));
  document.getElementById('sups-list').innerHTML = shown.length
    ? shown.map((x) => `<li><a class="sup-fx fx-${esc(x.f === 'none' ? 'holo' : x.f)}" href="profile.html?u=${encodeURIComponent(x.p)}"><span class="sups-name" data-supporter-name="${esc(x.p)}">${esc(nick(x.p))}</span></a></li>`).join('')
    : '<li class="info">No one is listed yet. Be the first.</li>';
});
