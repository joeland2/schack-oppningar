// Whole-game mistakes: every move of yours that throws away a good part of your winning chances,
// sorted by what kind of slip it was, so the ones you keep repeating stand out. Lichess's own computer
// analysis is used where a game has one; the rest are checked here with Stockfish (evaluate).
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';

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

// A piece of yours (knight or bigger) that the opponent can now take for free or with a cheaper piece.
function hangs(g, me) {
  const them = me === 'w' ? 'b' : 'w';
  return g.board().flat().some((p) => {
    if (!p || p.color !== me || VALUE[p.type] < 3) return false;
    const attackers = g.attackers(p.square, them);
    if (!attackers.length) return false;
    return !g.isAttacked(p.square, me) || Math.min(...attackers.map((sq) => VALUE[g.get(sq).type])) < VALUE[p.type];
  });
}

function themeOf(before, played, best, scoreBefore, scoreAfter, ply) {
  const me = before.turn();
  if (scoreAfter.mate > 0) return 'allowed-mate';           // scoreAfter is from the opponent's side
  if (scoreBefore.mate > 0) return 'missed-mate';
  const after = new Chess(before.fen());
  after.move(played);
  const bm = best && before.moves({ verbose: true }).find((m) => m.from === best.from && m.to === best.to);
  if (hangs(after, me) && !hangs(before, me)) return 'hung';
  if (bm?.captured && VALUE[bm.captured] >= 3) return 'missed-win';
  if (bm?.san.includes('+')) return 'missed-check';
  const pieces = before.board().flat().filter((p) => p && !'pk'.includes(p.type)).length;
  return ply < 20 ? 'opening' : pieces <= 6 ? 'endgame' : 'middlegame';
}

// games: Lichess games (with moves, and analysis when Lichess has analysed them). evaluate(fen) gives
// { move, cp, mate } from the side to move. stop() ends the search early. Stockfish checks at most
// maxEngineGames games without Lichess analysis, since each takes a while.
export async function findMistakes(games, name, { evaluate, onProgress = () => {}, stop = () => false, maxEngineGames = 15 }) {
  const me = name.toLowerCase();
  const found = [];
  const mine = games.filter((g) => g.moves && (g.players.white.user?.id === me || g.players.black.user?.id === me));
  const todo = [...mine.filter((g) => g.analysis), ...mine.filter((g) => !g.analysis).slice(0, maxEngineGames)];
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
      let sb, sa, best;
      if (game.analysis) {
        const a = game.analysis[i];
        if (!a?.judgment || !/Mistake|Blunder/.test(a.judgment.name)) continue;
        // Lichess gives White's view: before is the evaluation after the previous move.
        const view = (e, s) => (e ? { cp: s * (e.eval ?? 0), mate: e.mate === undefined ? null : s * e.mate } : { cp: 0, mate: null });
        sb = view(game.analysis[i - 1], sign);
        sa = view(a, -sign);
        best = a.best ? { from: a.best.slice(0, 2), to: a.best.slice(2, 4), promotion: a.best[4] } : null;
      } else {
        [sb, sa] = await Promise.all([evaluate(before.fen()), evaluate(g.fen())]);
        if (!sb || !sa) continue;
        if (winPct(toCp(sb)) - winPct(-toCp(sa)) < MISTAKE) continue;
        best = sb.move;
      }
      const bestMove = best && new Chess(before.fen()).move(best);
      if (!bestMove || bestMove.san === m.san) continue;
      found.push({
        theme: themeOf(before, m.san, best, sb, sa, i), fen: before.fen(), side, ply: i,
        played: m.san, best: bestMove.san, url: `https://lichess.org/${game.id}${side === 'b' ? '/black' : ''}#${i + 1}`,
        opening: game.opening?.name || '',
      });
    }
    onProgress(++checked, todo.length, found);
  }
  return found;
}

// Mistakes grouped by theme, the most frequent first.
export function byTheme(found) {
  const groups = new Map();
  for (const f of found) groups.set(f.theme, [...(groups.get(f.theme) || []), f]);
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}
console.assert(byTheme([{ theme: 'hung' }, { theme: 'opening' }, { theme: 'hung' }])[0][0] === 'hung', 'byTheme');
