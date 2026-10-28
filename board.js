// Board drawing shared by every page. Squares are buttons with data-sq; pages handle clicks.
const FILES = 'abcdefgh';

// arrow: [from, to] draws a move arrow over the board, like the arrows on Lichess.
// mark: { sq, ok } puts a green tick (right move) or red cross (wrong move) on a square.
export function drawBoard(el, game, { side = 'w', sel = null, last = null, hint = [], wrong = null, arrow = null, mark = null } = {}) {
  planAnim(el, game, side);
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
    const fading = el._anim?.fadings.get(sq);
    const piece = (fading ? `<img class="pc fading" src="pieces/${fading}.svg" alt="">` : '')
      + (p ? `<img class="pc" src="pieces/${p.color}${p.type.toUpperCase()}.svg" alt="">` : '');
    const badge = mark && mark.sq === sq
      ? `<span class="mark ${mark.ok ? 'ok' : 'bad'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${mark.ok ? 'M5 12.5l4.5 4.5L19 7.5' : 'M7 7l10 10M17 7L7 17'}"/></svg></span>` : '';
    html += `<button class="${cls.join(' ')}" data-sq="${sq}" aria-label="${sq}${p ? ' ' + p.color + p.type : ''}">${piece}${badge}${fileLbl}${rankLbl}</button>`;
  }
  el.innerHTML = html + (arrow ? arrowSvg(arrow, side) : '') + (el.classList.contains('mini') ? '' : '<svg class="shapes" viewBox="0 0 8 8" aria-hidden="true"></svg>');
  el._game = game;
  drawShapes(el);
  if (el._anim) stepAnim(el, performance.now());
}

// ---------- Move animation, as on Lichess (chessground's anim.ts) ----------
// Each piece that appears on a square flies in from the nearest square that lost the same piece;
// a piece that disappears (a capture) stays half-faded on its square until the move lands.
const ANIM_MS = 250; // Lichess's "normal" animation speed
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)');
const ease = (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1);
const xyOf = (sq, side) => {
  const f = FILES.indexOf(sq[0]), r = 8 - Number(sq[1]);
  return side === 'w' ? [f, r] : [7 - f, 7 - r];
};

function planAnim(el, game, side) {
  const now = new Map();
  for (const row of game.board()) for (const p of row) if (p) now.set(p.square, p.color + p.type.toUpperCase());
  const before = el._pieces, sameSide = el._side === side, noAnim = el._noAnim;
  el._pieces = now; el._side = side; el._noAnim = false;
  if (!before || !sameSide || noAnim || REDUCE.matches) return;
  const missing = [], fresh = [];
  for (const sq of new Set([...before.keys(), ...now.keys()])) {
    if (before.get(sq) === now.get(sq)) continue;
    if (before.has(sq)) missing.push(sq);
    if (now.has(sq)) fresh.push(sq);
  }
  if (!missing.length && !fresh.length) return;
  const vectors = new Map(), used = new Set();
  for (const sq of fresh) {
    const [x, y] = xyOf(sq, side);
    const from = missing.filter((m) => before.get(m) === now.get(sq))
      .sort((a, b) => dist(xyOf(a, side), [x, y]) - dist(xyOf(b, side), [x, y]))[0];
    if (!from) continue;
    const [fx, fy] = xyOf(from, side);
    vectors.set(sq, [fx - x, fy - y]);
    used.add(from);
  }
  const fadings = new Map(missing.filter((m) => !used.has(m)).map((m) => [m, before.get(m)]));
  const running = !!el._anim;
  el._anim = { start: performance.now(), vectors, fadings };
  if (!running) requestAnimationFrame((t) => stepAnim(el, t, true));
}
const dist = ([a, b], [c, d]) => (a - c) ** 2 + (b - d) ** 2;

function stepAnim(el, t, loop = false) {
  const a = el._anim;
  if (!a) return;
  const rest = 1 - (t - a.start) / ANIM_MS;
  if (rest <= 0) {
    el._anim = null;
    el.querySelectorAll('.pc.fading').forEach((img) => img.remove());
    el.querySelectorAll('.sq.anim').forEach((b) => { b.classList.remove('anim'); b.querySelector('.pc:not(.fading)')?.style.removeProperty('transform'); });
    return;
  }
  const k = ease(rest);
  for (const [sq, [dx, dy]] of a.vectors) {
    const b = el.querySelector(`[data-sq="${sq}"]`);
    const img = b?.querySelector('.pc:not(.fading)');
    if (!img) continue;
    b.classList.add('anim');
    img.style.transform = `translate(${dx * k * 100}%, ${dy * k * 100}%)`;
  }
  if (loop) requestAnimationFrame((n) => stepAnim(el, n, true));
}

// ---------- Drawn arrows and circles, as on Lichess (chessground's draw.ts and svg.ts) ----------
// Right-click and drag draws an arrow, a right-click on one square a circle; drawing the same shape
// again removes it. Shift or Ctrl makes it red, Alt blue, both yellow. A left click clears them.
const BRUSH = { green: '#15781B', red: '#882020', blue: '#003088', yellow: '#e68f00' };
const brushOf = (e) => ['green', 'red', 'blue', 'yellow'][((e.shiftKey || e.ctrlKey) && e.button === 2 ? 1 : 0) + (e.altKey || e.metaKey ? 2 : 0)];

function squareAt(el, x, y) {
  const b = el.getBoundingClientRect();
  const c = Math.floor(((x - b.left) / b.width) * 8), r = Math.floor(((y - b.top) / b.height) * 8);
  if (c < 0 || c > 7 || r < 0 || r > 7) return null;
  return (el._side || 'w') === 'w' ? FILES[c] + (8 - r) : FILES[7 - c] + (r + 1);
}

// Arrows snap to squares a queen or knight could reach from the start, the closest to the pointer.
function snapped(el, orig, x, y) {
  if (!squareAt(el, x, y)) return null;
  const b = el.getBoundingClientRect(), side = el._side || 'w';
  const p = [((x - b.left) / b.width) * 8 - 0.5, ((y - b.top) / b.height) * 8 - 0.5];
  const [of, or] = [FILES.indexOf(orig[0]), Number(orig[1])];
  let best = null, bestD = Infinity;
  for (const f of FILES) for (let r = 1; r <= 8; r++) {
    const df = Math.abs(FILES.indexOf(f) - of), dr = Math.abs(r - or);
    if (!(df === 0 || dr === 0 || df === dr || df * dr === 2)) continue;
    const d = dist(xyOf(f + r, side), p);
    if (d < bestD) { bestD = d; best = f + r; }
  }
  return best;
}

let boards = 0; // arrowhead ids must be unique on the page, or a hidden board's markers get used
function shapeSvg(s, side, current, shapes, id) {
  const color = BRUSH[s.brush];
  const [x1, y1] = xyOf(s.orig, side).map((v) => v + 0.5);
  if (!s.dest) {
    return `<circle cx="${x1}" cy="${y1}" r="${0.5 - 2 / 64}" fill="none" stroke="${color}" stroke-width="${(current ? 3 : 4) / 64}" opacity="${current ? 0.9 : 1}"/>`;
  }
  const [x2, y2] = xyOf(s.dest, side).map((v) => v + 0.5);
  const shorten = !current && shapes.filter((o) => o.dest === s.dest).length > 1;
  const m = (shorten ? 20 : 10) / 64, a = Math.atan2(y2 - y1, x2 - x1);
  return `<line x1="${x1}" y1="${y1}" x2="${x2 - Math.cos(a) * m}" y2="${y2 - Math.sin(a) * m}" stroke="${color}" stroke-width="${(current ? 8.5 : 10) / 64}"
    stroke-linecap="round" marker-end="url(#ah${id}-${s.brush})" opacity="${current ? 0.9 : 1}"/>`;
}

function drawShapes(el) {
  const svg = el.querySelector('svg.shapes');
  if (!svg) return;
  const shapes = el._shapes || [], side = el._side || 'w', id = (el._id ??= ++boards);
  const markers = Object.entries(BRUSH).map(([k, c]) => `<marker id="ah${id}-${k}" orient="auto" overflow="visible" markerWidth="4" markerHeight="4" refX="2.05" refY="2"><path d="M0,0 V4 L3,2 Z" fill="${c}"/></marker>`).join('');
  svg.innerHTML = `<defs>${markers}</defs>` + shapes.map((s) => shapeSvg(s, side, false, shapes, id)).join('')
    + (el._drawing?.to ? shapeSvg({ ...el._drawing, dest: el._drawing.to === el._drawing.orig ? undefined : el._drawing.to }, side, true, shapes, id) : '');
}

export function clearShapes(el) {
  if (!el._shapes?.length) return;
  el._shapes = [];
  drawShapes(el);
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
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
      const orig = squareAt(el, e.clientX, e.clientY);
      if (!orig) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el._drawing = { orig, to: orig, brush: brushOf(e) };
      drawShapes(el);
      return;
    }
    const b = e.target.closest('.sq');
    if (e.button === 0 && !(b?.querySelector('img.pc') && canDrag(b.dataset.sq))) clearShapes(el); // Lichess keeps them when you pick up your own piece
    const img = b?.querySelector('img.pc:not(.fading)');
    if (e.button > 0 || !img || !canDrag(b.dataset.sq)) return;
    from = b.dataset.sq; start = [e.clientX, e.clientY]; moved = false;
    ghost = img.cloneNode();
    ghost.className = 'drag-ghost';
    ghost.style.width = ghost.style.height = `${b.getBoundingClientRect().width}px`;
  });
  el.addEventListener('pointermove', (e) => {
    if (el._drawing) {
      const to = snapped(el, el._drawing.orig, e.clientX, e.clientY);
      if (to !== el._drawing.to) { el._drawing.to = to; drawShapes(el); }
      return;
    }
    if (!from) return;
    if (!moved && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 3) {
      moved = true;
      el.setPointerCapture(e.pointerId); // only once dragging: capturing earlier would steal plain clicks
      document.body.append(ghost);
      const sq = el.querySelector(`[data-sq="${from}"]`);
      sq?.querySelector('img.pc')?.classList.add('dragging');
      // Like Lichess: the picked-up piece's square and its moves are marked while you drag.
      sq?.classList.add('sel');
      for (const m of el._game?.moves({ square: from, verbose: true }) || []) el.querySelector(`[data-sq="${m.to}"]`)?.classList.add(m.captured ? 'cap' : 'dot');
    }
    if (moved) place(e);
  });
  const end = (e) => {
    if (el._drawing) {
      const d = el._drawing;
      el._drawing = null;
      skipClick = e.button === 0; // a shift-click draws; it must not also select a square
      if (d.to && e.type !== 'pointercancel') {
        const shape = { orig: d.orig, dest: d.to === d.orig ? undefined : d.to, brush: d.brush };
        const shapes = el._shapes || [];
        const same = shapes.find((s) => s.orig === shape.orig && s.dest === shape.dest);
        el._shapes = shapes.filter((s) => s !== same);
        if (!same || same.brush !== shape.brush) el._shapes.push(shape);
      }
      drawShapes(el);
      return;
    }
    if (!from) return;
    const was = from;
    from = null;
    ghost.remove();
    el.querySelector('.dragging')?.classList.remove('dragging');
    if (!moved || e.type === 'pointercancel') return;
    skipClick = true; // a drag ends with a click on the board; it must not also select a square
    const to = squareAt(el, e.clientX, e.clientY);
    el._noAnim = true; // a dropped piece is already where it lands, so the move is not animated
    if (to && to !== was) onDrop(was, to);
    if (el._noAnim) { el._noAnim = false; el.querySelectorAll('.sq.sel, .sq.dot, .sq.cap').forEach((s) => s.classList.remove('sel', 'dot', 'cap')); }
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
