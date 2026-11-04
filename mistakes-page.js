import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { lichessAuth } from './lichess.js?v=20261104161948';
import { drill } from './drill.js?v=20261104161948';
import { THEMES } from './mistakes.js?v=20261104161948';
import { explainMistake, dangerAfter } from './ideas.js?v=20261104161948';

// Positions from your own games where you went wrong, saved by "Find my mistakes" on the openings page.
// Everything is explained here, on the board: what your move did wrong, nudges while you look for
// the better move, and what that move does once you find it.
let found = [];
try { found = JSON.parse(localStorage.getItem('opening-book-v2-mistakes')) || []; } catch {}
// From My practice: ?theme= keeps one kind of mistake, ?kind= trains that kind on Lichess puzzles instead.
const q = new URLSearchParams(location.search), theme = THEMES[q.get('theme')] && q.get('theme'), kind = THEMES[q.get('kind')] && q.get('kind');
if (theme) found = found.filter((f) => f.theme === theme);

// The Lichess puzzle theme for each kind of mistake.
const ANGLE = { 'allowed-mate': 'defensiveMove', 'missed-mate': 'mate', hung: 'hangingPiece', 'missed-win': 'hangingPiece',
  'missed-check': 'kingsideAttack', opening: 'opening', middlegame: 'middlegame', endgame: 'endgame' };
if (kind) trainKind(kind);
else if (!found.length) {
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

// Lichess puzzles of the same kind as one of your mistakes (its puzzle theme), a fresh set each visit.
async function trainKind(k) {
  const theme = THEMES[k];
  document.querySelector('#title').textContent = `Loading puzzles: ${theme.title.toLowerCase()}…`;
  // Puzzles are kept in this browser per kind, so a visit fetches only what is new to it. Fetched one at a
  // time, with your Lichess login when there is one (its own limit, and puzzles near your puzzle rating);
  // a 429 means Lichess has had enough: stop, and keep away for a minute, as its API asks.
  const KEEP = `chesslabs-puzzles-${k}`, read = (key, d) => { try { return JSON.parse(localStorage.getItem(key)) ?? d; } catch { return d; } };
  const pool = read(KEEP, []), done = new Set(read('mistakes-kind-solved-v1', [])), fresh = pool.filter((x) => !done.has(`lp-${x.puzzle.id}`));
  const got = fresh.slice(0, 8);
  for (let i = got.length; i < 8 && Date.now() > read('chesslabs-lichess-wait', 0); i++) {
    const r = await fetch(`https://lichess.org/api/puzzle/next?angle=${ANGLE[k]}`, { headers: lichessAuth() }).catch(() => null);
    if (r?.status === 429) { try { localStorage.setItem('chesslabs-lichess-wait', Date.now() + 61000); } catch {} break; }
    if (!r?.ok) break;
    got.push(await r.json());
    document.querySelector('#title').textContent = `Loading puzzles: ${theme.title.toLowerCase()} ${i + 1}/8`;
    await new Promise((ok) => setTimeout(ok, 400));
  }
  try { localStorage.setItem(KEEP, JSON.stringify([...new Map([...pool, ...got].map((x) => [x.puzzle.id, x])).values()].slice(-60))); } catch {}
  const seen = new Set(), items = [];
  for (const x of got) {
    if (!x || seen.has(x.puzzle.id)) continue;
    seen.add(x.puzzle.id);
    try {
      const g = new Chess();
      x.game.pgn.split(' ').forEach((m) => g.move(m));
      const fen = g.fen(), side = g.turn(), solution = x.puzzle.solution.map((u) => g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
      items.push({ id: `lp-${x.puzzle.id}`, group: theme.title, tag: String(items.length + 1), title: `${theme.title}: puzzle ${items.length + 1}`, side, fen, solution,
        intro: `From a Lichess game, rated ${x.puzzle.rating}: the same kind of moment as in your games. ${side === 'w' ? 'White' : 'Black'} to play.`,
        explain: `<p><b>The move:</b> ${solution.filter((_, i) => i % 2 === 0).join(', ')}.</p><p><b>What to take with you:</b> ${theme.tip}</p>
          <p><a href="https://lichess.org/training/${x.puzzle.id}" target="_blank" rel="noopener">See it on Lichess</a> · <a href="mistakes.html?kind=${k}">More of these</a></p>`,
        wrong: (san, at) => dangerAfter(at, san) || `${san} is not it. ${theme.tip}` });
    } catch { /* a puzzle whose moves do not replay is skipped */ }
  }
  if (!items.length) {
    document.querySelector('.layout').innerHTML = `<section class="picker"><h1>No puzzles came</h1><p class="info">Lichess did not answer, or wants a short break. <a href="mistakes.html?kind=${k}">Try again</a> in a minute.</p></section>`;
    return;
  }
  drill(items, 'mistakes-kind-solved-v1');
}
