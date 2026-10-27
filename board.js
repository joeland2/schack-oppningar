// Board drawing shared by every page. Squares are buttons with data-sq; pages handle clicks.
const FILES = 'abcdefgh';

// arrow: [from, to] draws a move arrow over the board, like the arrows on Lichess.
// mark: { sq, ok } puts a green tick (right move) or red cross (wrong move) on a square.
export function drawBoard(el, game, { side = 'w', sel = null, last = null, hint = [], wrong = null, arrow = null, mark = null } = {}) {
  const targets = sel ? game.moves({ square: sel, verbose: true }).map((m) => m.to) : [];
  let html = '';
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const sq = FILES[side === 'w' ? f : 7 - f] + (side === 'w' ? 8 - r : r + 1);
    const p = game.get(sq);
    const dark = (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 0;
    const cls = ['sq', dark ? 'dark' : 'light'];
    if (sq === sel) cls.push('sel');
    if (last && (sq === last.from || sq === last.to)) cls.push('last');
    if (hint.includes(sq)) cls.push('hint');
    if (sq === wrong) cls.push('wrong');
    if (targets.includes(sq)) cls.push(p ? 'cap' : 'dot');
    const fileLbl = r === 7 ? `<span class="lbl f">${sq[0]}</span>` : '';
    const rankLbl = f === 0 ? `<span class="lbl r">${sq[1]}</span>` : '';
    const piece = p ? `<img class="pc" src="pieces/${p.color}${p.type.toUpperCase()}.svg" alt="">` : '';
    const badge = mark && mark.sq === sq
      ? `<span class="mark ${mark.ok ? 'ok' : 'bad'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${mark.ok ? 'M5 12.5l4.5 4.5L19 7.5' : 'M7 7l10 10M17 7L7 17'}"/></svg></span>` : '';
    html += `<button class="${cls.join(' ')}" data-sq="${sq}" aria-label="${sq}${p ? ' ' + p.color + p.type : ''}">${piece}${badge}${fileLbl}${rankLbl}</button>`;
  }
  el.innerHTML = html + (arrow ? arrowSvg(arrow, side) : '');
}

// Board coordinates run 0–8 across and down, so a square's centre is at (file + 0.5, row + 0.5).
function arrowSvg([from, to], side) {
  const xy = (sq) => {
    const f = FILES.indexOf(sq[0]), r = 8 - Number(sq[1]);
    return side === 'w' ? [f + 0.5, r + 0.5] : [7.5 - f, 7.5 - r];
  };
  const [x1, y1] = xy(from), [x2, y2] = xy(to);
  const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const tip = [x2 - ux * 0.08, y2 - uy * 0.08], base = [tip[0] - ux * 0.42, tip[1] - uy * 0.42];
  const wing = (k) => `${base[0] - uy * k},${base[1] + ux * k}`;
  return `<svg class="arrow" viewBox="0 0 8 8" aria-hidden="true">
    <line x1="${x1}" y1="${y1}" x2="${base[0]}" y2="${base[1]}" />
    <polygon points="${tip[0]},${tip[1]} ${wing(0.24)} ${wing(-0.24)}" />
  </svg>`;
}

// Drag and drop on top of click-click moves. canDrag(square) says whether a piece may be picked up;
// onDrop(from, to) makes the move. The board may be redrawn at any time, so listeners sit on the board element.
export function enableDrag(el, { canDrag, onDrop }) {
  let from = null, ghost = null, start = null, moved = false, skipClick = false;
  const place = (e) => {
    const size = ghost.offsetWidth;
    ghost.style.left = `${e.clientX - size / 2}px`;
    ghost.style.top = `${e.clientY - size / 2}px`;
  };
  el.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.sq');
    const img = b?.querySelector('img.pc');
    if (e.button > 0 || !img || !canDrag(b.dataset.sq)) return;
    from = b.dataset.sq; start = [e.clientX, e.clientY]; moved = false;
    ghost = img.cloneNode();
    ghost.className = 'drag-ghost';
    ghost.style.width = ghost.style.height = `${b.getBoundingClientRect().width}px`;
  });
  el.addEventListener('pointermove', (e) => {
    if (!from) return;
    if (!moved && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) {
      moved = true;
      el.setPointerCapture(e.pointerId); // only once dragging: capturing earlier would steal plain clicks
      document.body.append(ghost);
      el.querySelector(`[data-sq="${from}"] img.pc`)?.classList.add('dragging');
    }
    if (moved) place(e);
  });
  const end = (e) => {
    if (!from) return;
    const was = from;
    from = null;
    ghost.remove();
    el.querySelector('.dragging')?.classList.remove('dragging');
    if (!moved || e.type === 'pointercancel') return;
    skipClick = true; // a drag ends with a click on the board; it must not also select a square
    const to = document.elementFromPoint(e.clientX, e.clientY)?.closest('.sq')?.dataset.sq;
    if (to && to !== was) onDrop(was, to);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('click', (e) => { if (skipClick) { skipClick = false; e.stopImmediatePropagation(); } }, true);
}

// A move in plain words, e.g. "knight to f3 (Nf3)", from a chess.js move object.
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export function moveWords(m) {
  if (m.flags.includes('k')) return `castling kingside (${m.san})`;
  if (m.flags.includes('q')) return `castling queenside (${m.san})`;
  const promo = m.promotion ? `, making a ${NAME[m.promotion]}` : '';
  if (m.captured) return `the ${NAME[m.piece]} taking the ${NAME[m.captured]} on ${m.to}${promo} (${m.san})`;
  return `${NAME[m.piece]} to ${m.to}${promo} (${m.san})`;
}
// The same as an instruction: "Play knight to f3 (Nf3)", "Take the bishop on c4 with the knight (Nxc4)".
export function instruction(m) {
  if (m.flags.includes('k') || m.flags.includes('q')) return `Castle ${m.flags.includes('k') ? 'kingside' : 'queenside'} (${m.san})`;
  const promo = m.promotion ? ` and make a ${NAME[m.promotion]}` : '';
  if (m.captured) return `Take the ${NAME[m.captured]} on ${m.to} with the ${NAME[m.piece]}${promo} (${m.san})`;
  return `Play ${NAME[m.piece]} to ${m.to}${promo} (${m.san})`;
}

export function shake(el) {
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
}
