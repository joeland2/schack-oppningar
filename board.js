// Board drawing shared by every page. Squares are buttons with data-sq; pages handle clicks.
const FILES = 'abcdefgh';

// arrow: [from, to] draws a move arrow over the board, like the arrows on Lichess.
export function drawBoard(el, game, { side = 'w', sel = null, last = null, hint = [], wrong = null, arrow = null } = {}) {
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
    html += `<button class="${cls.join(' ')}" data-sq="${sq}" aria-label="${sq}${p ? ' ' + p.color + p.type : ''}">${piece}${fileLbl}${rankLbl}</button>`;
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

export function shake(el) {
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
}
