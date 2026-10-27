// Board drawing shared by every page. Squares are buttons with data-sq; pages handle clicks.
const FILES = 'abcdefgh';

export function drawBoard(el, game, { side = 'w', sel = null, last = null, hint = [], wrong = null } = {}) {
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
  el.innerHTML = html;
}

export function shake(el) {
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
}
