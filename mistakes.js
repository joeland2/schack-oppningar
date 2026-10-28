// Whole-game mistakes: every move of yours that throws away a good part of your winning chances,
// sorted by what kind of slip it was, so the ones you keep repeating stand out. Lichess's own computer
// analysis is used where a game has one; the rest are checked here with Stockfish (evaluate).
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { hanging, mateInOne } from './ideas.js?v=20261028202738';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
// Lichess's winning chances, 0-100; a move that costs 10 points or more is a mistake, 15 a blunder.
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
const toCp = (s) => (s.mate === null || s.mate === undefined ? s.cp : s.mate > 0 ? 10000 : -10000);
const MISTAKE = 10;

export const THEMES = {
  'allowed-mate': { title: 'Walked into a mate', tip: 'Before every move, look at each check your opponent would have after it.' },
  'missed-mate': { title: 'Missed a mate', tip: 'When their king is exposed, go through all your checks first.' },
  hung: { title: 'Left a piece hanging', tip: 'Before you let go of a piece, ask what attacks it and what defends it.' },
  'missed-win': { title: 'Missed winning material', tip: 'Every move, check what your opponent has left unprotected.' },
  'missed-check': { title: 'Missed a strong check', tip: 'Checks come first: they leave your opponent no time for their plans.' },
  opening: { title: 'Slips in the opening', tip: 'Develop your pieces, castle and fight for the centre before you attack.' },
  middlegame: { title: 'Plan slips in the middlegame', tip: 'Find your worst-placed piece and improve it; avoid pawn moves that leave holes.' },
  endgame: { title: 'Slips in the endgame', tip: 'Bring your king into play and push your passed pawns.' },
};

// A move worth a look by the engine: read straight off the board, so all games can be checked in
// seconds. It allows a mate in one, misses a mate in one, leaves a piece hanging, or passes up a piece
// that could be taken for free. Quieter slips need the engine on every move, which only Lichess's own
// analysis has (games analysed there are read in full).
function suspicious(before, after, played) {
  const me = before.turn(), them = me === 'w' ? 'b' : 'w';
  if (mateInOne(after) || (!after.isCheckmate() && mateInOne(before))) return true;
  const was = hanging(before, me).map((h) => h.square);
  if (hanging(after, me).some((h) => !was.includes(h.square) || h.square === played.to)) return true;
  const gain = (m) => (m.captured ? VALUE[m.captured] - (before.isAttacked(m.to, them) ? VALUE[m.piece] : 0) : 0);
  const free = Math.max(0, ...before.moves({ verbose: true }).map(gain));
  return free >= 3 && gain(played) < free;
}

function themeOf(before, played, best, scoreBefore, scoreAfter, ply) {
  const me = before.turn();
  if (scoreAfter.mate > 0) return 'allowed-mate';           // scoreAfter is from the opponent's side
  if (scoreBefore.mate > 0) return 'missed-mate';
  const after = new Chess(before.fen());
  after.move(played);
  const bm = best && before.moves({ verbose: true }).find((m) => m.from === best.from && m.to === best.to);
  if (hanging(after, me).length && !hanging(before, me).length) return 'hung';
  if (bm?.captured && VALUE[bm.captured] >= 3) return 'missed-win';
  if (bm?.san.includes('+')) return 'missed-check';
  const pieces = before.board().flat().filter((p) => p && !'pk'.includes(p.type)).length;
  return ply < 20 ? 'opening' : pieces <= 6 ? 'endgame' : 'middlegame';
}

// games: Lichess games (with moves, and analysis when Lichess has analysed them). evaluate(fen) gives
// { move, cp, mate } from the side to move. stop() ends the search early. Analysed games come first
// since they are read at once; the rest are scanned (see suspicious) and only flagged moves are checked.
export async function findMistakes(games, name, { evaluate, onProgress = () => {}, stop = () => false }) {
  const me = name.toLowerCase();
  const found = [];
  const mine = games.filter((g) => g.moves && (g.players.white.user?.id === me || g.players.black.user?.id === me));
  const todo = [...mine.filter((g) => g.analysis), ...mine.filter((g) => !g.analysis)];
  let checked = 0;
  for (const game of todo) {
    if (stop()) break;
    const side = game.players.white.user?.id === me ? 'w' : 'b';
    const sign = side === 'w' ? 1 : -1;
    const moves = game.moves.split(' ');
    const g = new Chess();
    for (let i = 0; i < moves.length; i++) {
      if (stop()) break;
      const ours = (i % 2 === 0) === (side === 'w');
      const before = new Chess(g.fen());
      let m;
      try { m = g.move(moves[i]); } catch { break; }
      if (!ours || i < 6) continue; // the first moves belong to the opening trainer
      let sb, sa, best, line = [];
      if (game.analysis) {
        const a = game.analysis[i];
        if (!a?.judgment || !/Mistake|Blunder/.test(a.judgment.name)) continue;
        // Lichess gives White's view: before is the evaluation after the previous move.
        const view = (e, s) => (e ? { cp: s * (e.eval ?? 0), mate: e.mate === undefined ? null : s * e.mate } : { cp: 0, mate: null });
        sb = view(game.analysis[i - 1], sign);
        sa = view(a, -sign);
        best = a.best ? { from: a.best.slice(0, 2), to: a.best.slice(2, 4), promotion: a.best[4] } : null;
        line = (a.variation || '').split(' ').filter(Boolean); // SAN, starting with the better move
      } else {
        if (!suspicious(before, g, m)) continue;
        [sb, sa] = await Promise.all([evaluate(before.fen()), evaluate(g.fen())]);
        if (!sb || !sa) continue;
        if (winPct(toCp(sb)) - winPct(-toCp(sa)) < MISTAKE) continue;
        best = sb.move;
        line = sb.pv || [];
      }
      const bestMove = best && new Chess(before.fen()).move(best);
      if (!bestMove || bestMove.san === m.san) continue;
      found.push({
        theme: themeOf(before, m.san, best, sb, sa, i), fen: before.fen(), side, ply: i,
        loss: Math.round(winPct(toCp(sb)) - winPct(-toCp(sa))), solution: solutionOf(before.fen(), bestMove.san, line),
        played: m.san, best: bestMove.san, url: `https://lichess.org/${game.id}${side === 'b' ? '/black' : ''}#${i + 1}`,
        opening: game.opening?.name || '',
      });
    }
    onProgress(++checked, todo.length, found);
    await new Promise((r) => setTimeout(r)); // let the page show the progress
  }
  return found;
}

// The puzzle's answer: the better move, the opponent's best reply and your next move (from the engine
// line, as SAN or UCI), so you play the idea through. Just the better move when the line is missing.
function solutionOf(fen, bestSan, line) {
  const g = new Chess(fen), out = [];
  for (const mv of line.slice(0, 3)) {
    let m;
    try { m = g.move(/^[a-h][1-8][a-h][1-8]/.test(mv) ? { from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] } : mv); } catch { break; }
    out.push(m.san);
  }
  if (out[0] !== bestSan) return [bestSan];
  return out.length === 2 ? out.slice(0, 1) : out; // end on your move
}
console.assert(solutionOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e4', ['e2e4', 'e7e5', 'g1f3']).join() === 'e4,e5,Nf3', 'solutionOf');

// The puzzles worth training: the biggest slips first, tactics before general ones, opening slips only
// when they cost a lot (the opening trainer covers the rest), at most three per game.
const TACTIC = new Set(['allowed-mate', 'missed-mate', 'hung', 'missed-win', 'missed-check']);
export function pickPuzzles(found, max = 40) {
  const perGame = new Map();
  return found
    .filter((f) => f.theme !== 'opening' || f.loss >= 15)
    .sort((a, b) => TACTIC.has(b.theme) - TACTIC.has(a.theme) || (b.loss ?? 0) - (a.loss ?? 0))
    .filter((f) => { const g = f.url.split('#')[0]; perGame.set(g, (perGame.get(g) || 0) + 1); return perGame.get(g) <= 3; })
    .slice(0, max);
}

// Mistakes grouped by theme, the most frequent first.
export function byTheme(found) {
  const groups = new Map();
  for (const f of found) groups.set(f.theme, [...(groups.get(f.theme) || []), f]);
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}
console.assert(byTheme([{ theme: 'hung' }, { theme: 'opening' }, { theme: 'hung' }])[0][0] === 'hung', 'byTheme');
