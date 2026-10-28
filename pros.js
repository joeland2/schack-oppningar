import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drill } from './drill.js?v=20261028172720';

// data/pros.json is built by tools/make_pros.py from real chess.com games, analysed by Stockfish.
const PUZZLES = await fetch('data/pros.json').then((r) => r.json());

const first = (name) => name.split(' ')[0];
const evalText = (e) => 'mate' in e
  ? (e.mate > 0 ? `mate in ${e.mate}` : `getting mated in ${-e.mate}`)
  : `${e.cp >= 0 ? '+' : '−'}${Math.abs(e.cp / 100).toFixed(1)}`;

// SAN list → "23. Rxe6 fxe6 24. Qxg6+", numbered from the puzzle position.
function numbered(fen, sans) {
  const g = new Chess(fen);
  return sans.map((san, i) => {
    const label = g.turn() === 'w' ? `${g.moveNumber()}. ` : i === 0 ? `${g.moveNumber()}… ` : '';
    g.move(san);
    return label + san;
  }).join(' ');
}

function explain(p) {
  const who = first(p.player);
  const why = [];
  if (p.motifs.includes('mate')) why.push('It forces checkmate.');
  else if (p.motifs.includes('sacrifice')) why.push('It gives up material, yet the engine shows it pays off.');
  else if (p.motifs.includes('check')) why.push('It comes with check, so the opponent has no time for their own plans.');
  return `
    <p>${who} played <b>${p.move}</b>. ${why.join(' ')} After it, Stockfish rates the position <b>${evalText(p.eval)}</b> for ${who}.</p>
    <p class="line"><span>Engine line</span> ${numbered(p.fen, p.pv)}</p>
    <p>Why not <b>${p.alt.move}</b>, the next best try? Stockfish has only <b>${evalText(p.alt.eval)}</b> after it:</p>
    <p class="line"><span>After ${p.alt.move}</span> ${numbered(p.fen, p.alt.pv)}</p>
    <p class="src">${p.player} vs ${p.opponent}${p.opponentRating ? ` (${p.opponentRating})` : ''}, ${p.timeClass} on chess.com, ${p.date}.
      <a href="${p.url}" target="_blank" rel="noopener">See the game</a>. Evaluations are Stockfish's, from ${who}'s side (+1.0 ≈ a pawn up).</p>`;
}

drill(PUZZLES.map((p, n) => ({
  id: `${p.url}:${p.fen}`,
  group: p.player,
  tag: String(n + 1),
  title: `vs ${p.opponent}`,
  side: p.color,
  fen: p.fen,
  solution: [p.move],
  intro: `${p.player} has ${p.color === 'w' ? 'White' : 'Black'} in a ${p.timeClass} game from ${p.date}. One move is clearly best here. What did ${first(p.player)} play?`,
  explain: explain(p),
  wrong: (san) => {
    const o = p.others.find((x) => x.move === san);
    return o ? `${san} is a reasonable try, but Stockfish rates it only ${evalText(o.eval)}. ${first(p.player)} found something stronger.` : null;
  },
})), 'pros-solved-v1');
