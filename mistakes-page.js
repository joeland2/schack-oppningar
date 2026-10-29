import { drill } from './drill.js?v=20261029130836';
import { THEMES } from './mistakes.js?v=20261029130836';
import { explainMistake, dangerAfter } from './ideas.js?v=20261029130836';

// Positions from your own games where you went wrong, saved by "Find my mistakes" on the openings page.
// Everything is explained here, on the board: what your move did wrong, nudges while you look for
// the better move, and what that move does once you find it.
let found = [];
try { found = JSON.parse(localStorage.getItem('opening-book-v2-mistakes')) || []; } catch {}

if (!found.length) {
  document.querySelector('.layout').innerHTML = `<section class="picker"><h1>No mistakes yet</h1>
    <p class="info">Open <a href="./">Practise openings</a>, check your Lichess games and press Find my mistakes.
    The positions where you went wrong show up here to train.</p></section>`;
} else {
  drill(found.map((f, n) => {
    const e = explainMistake(f);
    const theme = THEMES[f.theme];
    const moveNo = `move ${Math.floor(f.ply / 2) + 1}`;
    let tries = 0;
    return {
      id: `${f.url}`,
      group: theme.title,
      tag: String(n + 1),
      title: `${theme.title}, ${moveNo}`,
      side: f.side,
      fen: f.fen,
      solution: f.solution || [f.best],
      intro: `From one of your games${f.opening ? ` (${f.opening.split(':')[0]})` : ''}, ${moveNo}. You played ${f.played} here. ${e.wrong} Can you find the better move?`,
      explain: `<p><b>${f.best}</b> was the move. ${e.right}</p>${(f.solution || []).length > 1 ? `<p><b>The idea:</b> ${f.solution.join(' ')}</p>` : ''}
        <p><b>What to take with you:</b> ${theme.tip}</p>`,
      wrong: (san) => {
        tries++;
        if (san === f.played) return `That is the move from your game. ${e.wrong} Try something else.`;
        const danger = dangerAfter(f.fen, san);
        if (danger) return `${danger} Try again.`;
        return tries >= 2 ? `${e.nudge} Press Hint if you want the piece to move.` : `${san} is not the best here. ${e.nudge}`;
      },
    };
  }), 'mistakes-solved-v1');
}
