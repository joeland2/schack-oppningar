import { drill } from './drill.js?v=20261102154101';
import { THEMES } from './mistakes.js?v=20261102154101';
import { explainMistake, dangerAfter } from './ideas.js?v=20261102154101';

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
  // A kept position whose moves no longer fit it (an older save) is skipped, not the whole page.
  const ok = found.flatMap((f, n) => { try { return [[f, n, explainMistake(f)]]; } catch { return []; } });
  if (!ok.length) document.querySelector('.layout').innerHTML = '<section class="picker"><h1>No mistakes to train</h1><p class="info">Open <a href="./">Practise openings</a> and press Find my mistakes again.</p></section>';
  else drill(ok.map(([f, n, e]) => {
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
      played: f.played, // drawn as a red arrow until it is solved
      intro: `In your game you played ${f.played} here (the red arrow). Find a better move.`,
      // Side by side once solved: what was wrong with your move, and what the better one does.
      explain: `<div class="why-pair"><div class="why-box bad"><span>Your move</span><b>${f.played}</b><p>${e.wrong}</p></div>
        <div class="why-box good"><span>Better</span><b>${f.best}</b><p>${e.right}</p></div></div>
        ${(f.solution || []).length > 1 ? `<p><b>The idea:</b> ${f.solution.join(' ')}</p>` : ''}
        <p><b>What to take with you:</b> ${theme.tip}</p>`,
      wrong: (san, fen = f.fen) => {
        tries++;
        if (fen === f.fen && san === f.played) return `That is the move from your game. ${e.wrong} Try something else.`;
        const danger = dangerAfter(fen, san); // the position now, which is past the start once you are into the solution
        if (danger) return `${danger} Try again.`;
        return tries >= 2 ? `${e.nudge} Press Hint if you want the piece to move.` : `${san} is not the best here. ${e.nudge}`;
      },
    };
  }), 'mistakes-solved-v1');
}
