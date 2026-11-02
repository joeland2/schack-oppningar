// A trap page's board: step through the moves with the buttons, the move list or the arrow keys; Play runs them.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard } from '../board.js';

const el = document.getElementById('board'), moves = el.dataset.moves.split(' '), slip = Number(el.dataset.slip), side = el.dataset.side;
const list = [...document.querySelectorAll('.trap-moves button')];
let ply = 0, timer = null;

function show(n) {
  ply = Math.max(0, Math.min(moves.length, n));
  const g = new Chess();
  let last = null;
  for (const m of moves.slice(0, ply)) last = g.move(m);
  drawBoard(el, g, { side, last, mark: last && ply === slip + 1 ? { sq: last.to, kind: 'blunder' } : null });
  list.forEach((b, i) => b.classList.toggle('now', i === ply - 1));
}
function stop() { clearInterval(timer); timer = null; document.querySelector('[data-go="play"]').textContent = 'Play'; }
function play() {
  if (timer) return stop();
  if (ply >= moves.length) show(0);
  document.querySelector('[data-go="play"]').textContent = 'Pause';
  timer = setInterval(() => (ply >= moves.length ? stop() : show(ply + 1)), 900);
}
document.querySelector('.trap-ctl').addEventListener('click', (e) => {
  const go = e.target.closest('button')?.dataset.go;
  if (!go) return;
  if (go === 'play') return play();
  stop();
  show(go === 'start' ? 0 : go === 'end' ? moves.length : ply + Number(go));
});
list.forEach((b) => b.addEventListener('click', () => { stop(); show(Number(b.dataset.ply)); }));
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { stop(); show(ply - 1); }
  if (e.key === 'ArrowRight') { stop(); show(ply + 1); }
});
show(slip); // the position before the slip: the moment that matters
