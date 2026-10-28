import { drill } from './drill.js?v=20261028110306';
import { THEMES } from './mistakes.js?v=20261028110306';

// Positions from your own games where you went wrong, saved by "Find my mistakes" on the openings page.
let found = [];
try { found = JSON.parse(localStorage.getItem('opening-book-v2-mistakes')) || []; } catch {}

if (!found.length) {
  document.querySelector('.layout').innerHTML = `<section class="picker"><h1>No mistakes yet</h1>
    <p class="info">Open <a href="openings.html">Practise openings</a>, check your Lichess games and press Find my mistakes.
    The positions where you went wrong show up here to train.</p></section>`;
} else {
  drill(found.map((f, n) => ({
    id: `${f.url}`,
    group: THEMES[f.theme].title,
    tag: String(n + 1),
    title: f.opening ? f.opening.split(':')[0] : `Move ${Math.floor(f.ply / 2) + 1}`,
    side: f.side,
    fen: f.fen,
    solution: [f.best],
    intro: `From one of your games: you played ${f.played} here. There was a better move. Find it.`,
    explain: `<p><b>${f.best}</b> was the move. ${THEMES[f.theme].tip}</p>
      <p class="src"><a href="${f.url}" target="_blank" rel="noopener">See the game on Lichess</a>.</p>`,
    wrong: (san) => (san === f.played ? `That is what you played in the game. ${THEMES[f.theme].title}: look again.` : null),
  })), 'mistakes-solved-v1');
}
