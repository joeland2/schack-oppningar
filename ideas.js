// What a move does, read off the board, in plain words; shared by the openings trainer and the
// mistakes page. Nothing here uses an engine.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';

const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// A position with the given side to move, so we can ask what that side's pieces reach.
export function asMover(g, color) {
  const fen = g.fen().split(' ');
  fen[1] = color; fen[3] = '-';
  try { return new Chess(fen.join(' ')); } catch { return null; }
}
export const CENTRE = ['d4', 'd5', 'e4', 'e5'];
// How many squares a side's bishops and queen reach: rises when a pawn move opens their lines.
function lineMobility(g, color) {
  const h = asMover(g, color);
  if (!h) return 0;
  return h.moves({ verbose: true }).filter((x) => 'bq'.includes(x.piece)).length;
}

// What a move does, from a position (a Chess game). Plays the move on g.
export function ideaAt(g, san) {
  const prev = g.history({ verbose: true }).at(-1);
  const mobBefore = lineMobility(g, g.turn());
  const castleBefore = ['f', 'g'].map((f) => g.get(f + (g.turn() === 'w' ? '1' : '8')));
  const m = g.move(san);
  const out = [];
  if (m.flags.includes('k') || m.flags.includes('q')) out.push('Castles: the king gets to safety and the rook comes into play');
  else {
    if (m.captured) out.push(`${prev && prev.to === m.to ? 'Takes back' : 'Takes'} the ${PIECE[m.captured]} on ${m.to}`);
    if ('nb'.includes(m.piece) && m.from[1] === (m.color === 'w' ? '1' : '8')) out.push(`Develops the ${PIECE[m.piece]}`);
    if (m.piece === 'p' && !m.captured && 'de'.includes(m.to[0])) out.push('Claims the centre');
    else if (m.piece === 'p' && !m.captured && 'cf'.includes(m.to[0])) out.push('Fights for the centre from the side');
    if (m.piece === 'q' && g.moveNumber() <= 7) out.push('Brings the queen out early');
  }
  if (g.inCheck()) out.push('Gives check');
  // What the moved piece now reaches: look at its moves as if it could move again.
  const h = asMover(g, m.color);
  const reach = h ? h.moves({ square: m.to, verbose: true }) : [];
  // pawns only count in the centre, where hitting them matters early on
  const hits = reach.filter((x) => x.captured && x.captured !== 'k' && (x.captured !== 'p' || CENTRE.includes(x.to)))
    .map((x) => `${PIECE[x.captured]} on ${x.to}`);
  if (hits.length) out.push(`Attacks the ${hits.join(' and the ')}`);
  // Centre squares it now covers (a pawn covers the squares diagonally ahead of it).
  const fwd = m.color === 'w' ? 1 : -1;
  const covers = m.piece === 'p'
    ? [-1, 1].map((d) => String.fromCharCode(m.to.charCodeAt(0) + d) + (Number(m.to[1]) + fwd))
    : reach.filter((x) => !x.captured).map((x) => x.to);
  const centre = CENTRE.filter((sq) => covers.includes(sq) && !g.get(sq));
  if (centre.length && m.piece !== 'k') out.push(`Controls ${centre.join(' and ')} in the centre`);
  if (m.piece === 'p' && lineMobility(g, m.color) - mobBefore >= 3) out.push('Opens lines for the bishop and queen');
  const rank = m.color === 'w' ? '1' : '8';
  const castleNow = ['f', 'g'].map((f) => g.get(f + rank));
  if (g.getCastlingRights?.(m.color)?.k && castleBefore.some(Boolean) && !castleNow.some(Boolean)) out.push('Clears the way to castle');
  return out.length ? out.join('. ') + '.' : '';
}

// ---------- Why a move was a mistake, for the mistakes page ----------
const sideName = (c) => (c === 'w' ? 'White' : 'Black');

// Your pieces (knight or bigger) that the opponent can take for free, or with a cheaper piece.
export function hanging(g, me) {
  const them = me === 'w' ? 'b' : 'w';
  return g.board().flat().filter(Boolean).flatMap((p) => {
    if (p.color !== me || VALUE[p.type] < 3) return [];
    const defended = g.isAttacked(p.square, me);
    // a king can only take what nothing defends
    const attackers = g.attackers(p.square, them).map((sq) => ({ sq, type: g.get(sq).type }))
      .filter((a) => a.type !== 'k' || !defended).sort((a, b) => VALUE[a.type] - VALUE[b.type]);
    if (!attackers.length) return [];
    if (defended && VALUE[attackers[0].type] >= VALUE[p.type]) return [];
    return [{ square: p.square, type: p.type, by: attackers[0], defended }];
  });
}

// A move that mates at once in the position, if there is one.
export function mateInOne(g) {
  return g.moves({ verbose: true }).find((m) => { const h = new Chess(g.fen()); h.move(m.san); return h.isCheckmate(); }) || null;
}

// What goes wrong after a move you consider here: a mate it allows, or a piece it leaves hanging.
// Empty when neither shows on the board straight away.
export function dangerAfter(fen, san) {
  const g = new Chess(fen);
  const me = g.turn();
  const before = hanging(g, me).map((h) => h.square);
  const m = g.move(san);
  const mate = mateInOne(g);
  if (mate) return `After ${m.san}, ${sideName(g.turn())} has ${mate.san}: checkmate.`;
  const h = hanging(g, me).find((x) => !before.includes(x.square) || x.square === m.to);
  if (h) return `After ${m.san}, your ${PIECE[h.type]} on ${h.square} can be taken by the ${PIECE[h.by.type]} on ${h.by.sq}${h.defended ? ', and taking back does not make up for it' : ' for free'}.`;
  return '';
}

// The full story of a mistake: what you played and what went wrong, what the better move does,
// and a nudge for each try. theme is from mistakes.js.
export function explainMistake({ fen, played, best, theme }) {
  const g = new Chess(fen);
  const me = g.turn(), them = me === 'w' ? 'b' : 'w';
  const bestMove = new Chess(fen).move(best);
  // What went wrong, without giving the answer away: what the board shows straight away, or else
  // what kind of chance the move let go.
  const MISSED = {
    'allowed-mate': 'But it lets your opponent force a mate.',
    'missed-mate': 'But you had a mate here.',
    hung: 'But it leaves a piece of yours hanging.',
    'missed-win': 'But you could have won material.',
    'missed-check': 'But you had a strong check.',
  };
  const danger = dangerAfter(fen, played);
  const playedIdea = ideaAt(new Chess(fen), played);
  const wrong = [
    playedIdea ? `It ${playedIdea.replace(/^./, (c) => c.toLowerCase()).replace(/\. (.)/g, (_, c) => `, ${c.toLowerCase()}`)}` : '',
    danger || MISSED[theme] || 'But there was a clearly better move.',
  ].filter(Boolean);
  // What the better move had that yours did not.
  const right = [];
  const after = new Chess(fen);
  after.move(best);
  if (after.isCheckmate()) right.push(`${best} is checkmate.`);
  else {
    if (bestMove.captured) {
      const free = !new Chess(fen).isAttacked(bestMove.to, them) || VALUE[bestMove.captured] > VALUE[bestMove.piece];
      right.push(`${best} wins the ${PIECE[bestMove.captured]} on ${bestMove.to}${free ? ', which was not safely defended' : ''}.`);
    }
    if (after.inCheck()) right.push(`It comes with check, so ${sideName(them)} has to answer it before anything else.`);
    const mineNow = hanging(new Chess(fen), me);
    if (mineNow.length && !hanging(after, me).some((h) => h.square === mineNow[0].square)) {
      right.push(`It also takes care of your ${PIECE[mineNow[0].type]} on ${mineNow[0].square}, which was under attack.`);
    }
    const idea = ideaAt(new Chess(fen), best).replace(/(^|\. )Gives check(\.|$)/, '$1').trim(); // the check is said above
    if (idea) right.push(idea);
  }
  const NUDGE = {
    'allowed-mate': 'Watch your own king: which checks would they have after your move?',
    'missed-mate': 'Their king is in danger. Look at every check you have.',
    hung: 'Make sure every piece of yours is safe after your move.',
    'missed-win': 'Something of theirs is not protected well enough. Look at every capture.',
    'missed-check': 'Start with the checks: one of them is strong.',
    opening: 'Think about development, king safety and the centre.',
    middlegame: 'Look for your worst-placed piece, or a threat against you.',
    endgame: 'Think about your king and the passed pawns.',
  };
  return { wrong: wrong.join(' '), right: right.join(' '), nudge: NUDGE[theme] || 'Look for checks, captures and threats first.' };
}
