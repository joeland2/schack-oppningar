// Shared "play the right move" trainer for the Basics and Pros pages.
// item: { id, group, title, tag, side, fen, solution: [san…], intro, explain (html), wrong?(san) }
// Moves at odd positions in solution are the opponent's replies and are played automatically.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard, enableDrag, shake, instruction } from './board.js?v=20261030112748';

const $ = (s) => document.querySelector(s);
const clean = (san) => san.replace(/[+#]/g, '');

export function drill(items, storeKey) {
  const boardEl = $('#board');
  let solved = new Set();
  try { solved = new Set(JSON.parse(localStorage.getItem(storeKey)) || []); } catch {}
  let idx = 0, cur, game, step, sel, last, hint, wrong, busy;

  let mark = null;
  const draw = () => drawBoard(boardEl, game, { side: cur.side, sel, last, hint, wrong, arrow: hint.length === 2 ? hint : null,
    mark: mark || (wrong && { sq: wrong, ok: false }) });
  const expected = () => new Chess(game.fen()).move(cur.solution[step]);
  const finished = () => step >= cur.solution.length;

  function say(text, tone = '') {
    $('#message').textContent = text;
    $('#message').className = 'message ' + tone;
  }

  function renderList() {
    const groups = [...new Set(items.map((it) => it.group))];
    $('#items').innerHTML = groups.map((g) => `<div>
      <h3 class="group">${g}</h3>
      <ul>${items.map((it, n) => it.group !== g ? '' : `<li><button class="op ${n === idx ? 'active' : ''}" data-n="${n}">
        <span class="eco">${it.tag}</span>
        <span class="op-name">${it.title}</span>
        <span class="chip ${solved.has(it.id) ? 'sitter' : 'ny'}">${solved.has(it.id) ? 'Solved' : 'New'}</span>
      </button></li>`).join('')}</ul></div>`).join('');
    $('#items').querySelectorAll('.op').forEach((b) => b.addEventListener('click', () => open(Number(b.dataset.n))));
  }

  function open(n) {
    idx = n; cur = items[n];
    game = new Chess(cur.fen);
    step = 0; sel = null; last = null; hint = []; wrong = null; busy = false;
    $('#title').textContent = cur.title;
    $('#intro').textContent = cur.intro;
    $('#explain').innerHTML = '';
    $('#explain').hidden = true;
    say(`${cur.side === 'w' ? 'White' : 'Black'} to move.`);
    renderList();
    draw();
  }

  function done() {
    solved.add(cur.id);
    try { localStorage.setItem(storeKey, JSON.stringify([...solved])); } catch {}
    renderList();
    say('Solved!', 'good');
    $('#explain').innerHTML = cur.explain;
    $('#explain').hidden = false;
  }

  function tryMove(from, to) {
    let m;
    try { m = game.move({ from, to, promotion: 'q' }); } catch { return false; }
    if (clean(m.san) !== clean(cur.solution[step])) {
      game.undo();
      wrong = to; sel = null;
      draw(); shake(boardEl);
      say((cur.wrong && cur.wrong(m.san)) || `${m.san} isn't it. Try again.`, 'bad');
      setTimeout(() => { wrong = null; draw(); }, 700);
      return true;
    }
    last = m; step++; sel = null; hint = [];
    mark = { sq: m.to, ok: true };
    setTimeout(() => { mark = null; draw(); }, 900);
    draw();
    if (finished()) return done(), true;
    busy = true;
    say(`Good: ${m.san}`, 'good');
    setTimeout(() => {
      last = game.move(cur.solution[step]); step++; busy = false;
      draw();
      if (finished()) done(); else say('Your move.');
    }, 450);
    return true;
  }

  enableDrag(boardEl, {
    canDrag: (sq) => !busy && !finished() && game.get(sq)?.color === cur.side,
    onDrop: (from, to) => { sel = null; if (!tryMove(from, to)) draw(); },
  });
  boardEl.addEventListener('click', (e) => {
    const b = e.target.closest('.sq');
    if (!b || busy || finished()) return;
    const sq = b.dataset.sq;
    const p = game.get(sq);
    if (sel && sel !== sq && tryMove(sel, sq)) return;
    sel = p && p.color === cur.side && sel !== sq ? sq : null;
    draw();
  });
  $('#hint').addEventListener('click', () => {
    if (busy || finished()) return;
    hint = [expected().from]; draw();
    say('The piece to move is highlighted.');
  });
  $('#show').addEventListener('click', () => {
    if (busy || finished()) return;
    const m = expected();
    hint = [m.from, m.to]; draw();
    say(`The move: ${instruction(m)}.`);
  });
  $('#next').addEventListener('click', () => open((idx + 1) % items.length));

  const firstOpen = items.findIndex((it) => !solved.has(it.id));
  open(firstOpen === -1 ? 0 : firstOpen);
}
