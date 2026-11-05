// A small board that plays an opening's idea, from the words about it: first the moves up to where the opening
// gets its name, then sentence by sentence, the moves the words name are played and the squares they name are marked.
// shortcut: reads moves from the text with rules, so an odd sentence only marks squares or shows one option; hand-written animations per opening if that is not enough.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard } from './board.js?v=20261105113229';

const TOKEN = /(?<![A-Za-z0-9])(\d+\.(?:\.\.)?|\.\.\.|…)?(O-O(?:-O)?|[NBRQK]?[a-h]?x?[a-h][1-8]|[Cc]astl\w*)(?![a-z0-9])/g;
export const sentencesOf = (text) => text.trim().split(/(?<=\.)\s+(?=[A-Z])/);
// Your side moves it, whoever is to move: the words describe a set-up, not a game.
function tryMove(fen, san, colors) {
  for (const color of colors) {
    const parts = fen.split(' ');
    parts[1] = color; parts[3] = '-';
    try { const c = new Chess(parts.join(' ')), m = c.move(san); return { fen: c.fen(), last: { from: m.from, to: m.to } }; } catch { /* not a move for this side */ }
  }
  return null;
}
// isPlan: the words are your plan, so a bare pawn move after "with", "push" or a comma is your move. In the words about
// an opening both sides are talked about, so a bare e5 is only a square there.
export function ideaSteps(sans, text, me, isPlan) {
  const steps = [], c = new Chess();
  for (const san of sans) { const m = c.move(san); steps.push({ fen: c.fen(), last: { from: m.from, to: m.to }, marks: [], s: -1, ms: 600 }); }
  let fen = c.fen();
  sentencesOf(text).forEach((sentence, s) => {
    const words = sentence.replace(/[,;]\s*or\b.*/, '').replace(/\s+or\s+(\.\.\.)?[NBRQKa-hO][\w-]*/g, ''), marks = [];
    for (const m of words.matchAll(TOKEN)) {
      const [, mark = '', token] = m, before = words.slice(0, m.index), castle = /^[Cc]astl/.test(token);
      if (castle && !isPlan) continue;
      const colors = mark.endsWith('..') || mark === '…' ? ['b'] : mark ? ['w']
        : castle || /^(?:[NBRQK]|O-O)/.test(token) ? (isPlan ? [me] : ['w', 'b'])
        : isPlan && /(?:with|up|play|push|then|and|,)\s*$/i.test(before) ? [me] : [];
      const done = tryMove(fen, castle ? 'O-O' : token, colors);
      if (done) { fen = done.fen; steps.push({ ...done, marks: [...marks], s, ms: 1100 }); }
      else if (!castle) marks.push(token.slice(-2));
    }
    steps.push({ fen, last: null, marks, s, ms: 2800 });
  });
  return steps;
}
console.assert(ideaSteps(['d4', 'd5'], 'Set up Bf4, e3 and Nf3 to control e5, or c3. Then castle.', 'w', true).filter((x) => x.last && x.s >= 0).length === 3
  && ideaSteps(['e4', 'e5', 'Nf3', 'd6'], 'Black defends e5 with the pawn on d6. After 3.d4 Black takes ...exd4.', 'b', false).filter((x) => x.last && x.s >= 0).length === 2
  && ideaSteps(['e4', 'e5', 'Nf3', 'd6'], 'Black defends e5 with the pawn on d6.', 'b', false).at(-1).marks.join() === 'e5,d6', 'ideaSteps');

// Plays the steps over and over while el is on the page; with reduced motion only the end position, with its marks.
export async function playIdea(el, steps, side) {
  const board = el.querySelector('.board'), parts = el.querySelectorAll('[data-s]');
  const show = (x) => {
    drawBoard(board, new Chess(x.fen), { side, last: x.last, hint: x.marks });
    parts.forEach((p) => p.classList.toggle('on', Number(p.dataset.s) === x.s));
    el.classList.toggle('reading', x.s >= 0);
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { drawBoard(board, new Chess(steps.at(-1).fen), { side, hint: steps.at(-1).marks }); return; }
  while (el.isConnected) {
    for (const x of steps) {
      if (!el.isConnected) return;
      if (!el.closest('[hidden]') && !document.hidden) show(x);
      await new Promise((r) => setTimeout(r, x.ms));
    }
  }
}
