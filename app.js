import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { OPENINGS } from './openings.js';

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';
const STORE = 'schack-oppningar-v1';

const $ = (s) => document.querySelector(s);
const boardEl = $('#board');
const listEl = $('#openings');
const msgEl = $('#message');
const movesEl = $('#moves');

let stats = load();
let cur = null;      // aktuell öppning
let line = [];       // SAN-drag
let game = null;
let ply = 0;
let sel = null;
let hintSq = null;
let wrongSq = null;
let lastMove = null;
let misses = 0;      // fel totalt i denna genomgång
let missesHere = 0;  // fel på aktuellt drag
let busy = false;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(stats)); } catch {}
}
const clean = (san) => san.replace(/[+#]/g, '');

// ---------- Öppningslista ----------
function renderList() {
  const groups = [['w', 'Du spelar vit'], ['b', 'Du spelar svart']];
  listEl.innerHTML = groups.map(([side, label]) => `
    <h3 class="group">${label}</h3>
    <ul>${OPENINGS.filter((o) => o.side === side).map((o) => {
      const s = stats[o.id] || { runs: 0, clean: 0 };
      const level = s.clean >= 3 ? 'sitter' : s.runs ? 'pagar' : 'ny';
      const levelTxt = { sitter: 'Sitter', pagar: `${s.clean}/3 felfria`, ny: 'Ny' }[level];
      return `<li><button class="op ${cur && cur.id === o.id ? 'active' : ''}" data-id="${o.id}">
        <span class="eco">${o.eco}</span>
        <span class="op-name">${o.name}</span>
        <span class="chip ${level}">${levelTxt}</span>
      </button></li>`;
    }).join('')}</ul>`).join('');
  listEl.querySelectorAll('.op').forEach((b) =>
    b.addEventListener('click', () => start(OPENINGS.find((o) => o.id === b.dataset.id))));
}

// ---------- Bräde ----------
function squares() {
  const out = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const rank = cur.side === 'w' ? 8 - r : r + 1;
    const file = cur.side === 'w' ? f : 7 - f;
    out.push(FILES[file] + rank);
  }
  return out;
}

function renderBoard() {
  const targets = sel ? game.moves({ square: sel, verbose: true }).map((m) => m.to) : [];
  const sqs = squares();
  boardEl.innerHTML = sqs.map((sq, i) => {
    const p = game.get(sq);
    const dark = (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 0;
    const cls = ['sq', dark ? 'dark' : 'light'];
    if (sq === sel) cls.push('sel');
    if (lastMove && (sq === lastMove.from || sq === lastMove.to)) cls.push('last');
    if (sq === hintSq) cls.push('hint');
    if (sq === wrongSq) cls.push('wrong');
    if (targets.includes(sq)) cls.push(p ? 'cap' : 'dot');
    const col = i % 8, row = Math.floor(i / 8);
    const fileLbl = row === 7 ? `<span class="lbl f">${sq[0]}</span>` : '';
    const rankLbl = col === 0 ? `<span class="lbl r">${sq[1]}</span>` : '';
    const piece = p ? `<span class="pc ${p.color}">${GLYPH[p.type]}</span>` : '';
    return `<button class="${cls.join(' ')}" data-sq="${sq}" aria-label="${sq}${p ? ' ' + p.color + p.type : ''}">${piece}${fileLbl}${rankLbl}</button>`;
  }).join('');
}

function renderMoves() {
  const hist = game.history();
  let html = '';
  for (let i = 0; i < line.length; i += 2) {
    const n = i / 2 + 1;
    const cell = (j) => j < hist.length
      ? `<span class="mv ${j === hist.length - 1 ? 'now' : ''}">${hist[j]}</span>`
      : `<span class="mv todo">${j < line.length ? '…' : ''}</span>`;
    html += `<li><span class="num">${n}.</span>${cell(i)}${cell(i + 1)}</li>`;
  }
  movesEl.innerHTML = html;
  $('#progress').textContent = `${Math.min(ply, line.length)} av ${line.length} drag`;
  $('#bar').style.width = `${(ply / line.length) * 100}%`;
}

function say(text, tone = '') {
  msgEl.textContent = text;
  msgEl.className = 'message ' + tone;
}

function render() { renderBoard(); renderMoves(); }

// ---------- Spel ----------
function start(op) {
  cur = op;
  line = op.moves.split(/\s+/);
  game = new Chess();
  ply = 0; sel = null; hintSq = null; wrongSq = null; lastMove = null;
  misses = 0; missesHere = 0; busy = false;
  $('#op-title').textContent = op.name;
  $('#op-eco').textContent = op.eco;
  $('#op-info').textContent = op.info;
  $('#op-side').textContent = op.side === 'w' ? 'Du spelar vit' : 'Du spelar svart';
  try { localStorage.setItem(STORE + '-last', op.id); } catch {}
  renderList();
  render();
  if (userTurn()) say('Din tur. Spela första draget.');
  else { say('Motståndaren börjar…'); reply(); }
}

const userTurn = () => ply < line.length && game.turn() === cur.side;

function reply() {
  busy = true;
  setTimeout(() => {
    const m = game.move(line[ply]);
    lastMove = m; ply++; busy = false; hintSq = null;
    render();
    if (ply >= line.length) return finish();
    say('Din tur.');
  }, 450);
}

function tryMove(from, to) {
  let m;
  try { m = game.move({ from, to, promotion: 'q' }); } catch { return false; }
  if (!m) return false;
  if (clean(m.san) !== clean(line[ply])) {
    game.undo();
    misses++; missesHere++;
    wrongSq = to; sel = null;
    renderBoard();
    boardEl.classList.remove('shake'); void boardEl.offsetWidth; boardEl.classList.add('shake');
    if (missesHere >= 2) { showHint(); say(`${m.san} hör inte till linjen. Pjäsen som ska flyttas är markerad.`, 'bad'); }
    else say(`${m.san} hör inte till linjen. Försök igen.`, 'bad');
    setTimeout(() => { wrongSq = null; renderBoard(); }, 700);
    return true;
  }
  lastMove = m; ply++; sel = null; hintSq = null; missesHere = 0;
  say(`Rätt: ${m.san}`, 'good');
  render();
  if (ply >= line.length) finish(); else reply();
  return true;
}

function expectedMove() {
  const probe = new Chess(game.fen());
  return probe.move(line[ply]);
}

function showHint() {
  if (!userTurn()) return;
  hintSq = expectedMove().from;
  renderBoard();
}

function finish() {
  const s = stats[cur.id] || { runs: 0, clean: 0 };
  s.runs++;
  if (misses === 0) s.clean++;
  stats[cur.id] = s; save();
  renderList();
  if (misses === 0) say(s.clean >= 3 ? 'Felfritt! Den här öppningen sitter nu.' : `Felfritt! ${s.clean} av 3 felfria genomgångar.`, 'good');
  else say(`Klar med ${misses} fel. Kör en gång till för att nöta in den.`, '');
}

boardEl.addEventListener('click', (e) => {
  const b = e.target.closest('.sq');
  if (!b || busy || !userTurn()) return;
  const sq = b.dataset.sq;
  const p = game.get(sq);
  if (sel && sel !== sq && tryMove(sel, sq)) return;
  if (p && p.color === cur.side) sel = sel === sq ? null : sq;
  else sel = null;
  renderBoard();
});

$('#restart').addEventListener('click', () => start(cur));
$('#hint').addEventListener('click', () => { if (userTurn()) { showHint(); say('Pjäsen som ska flyttas är markerad.'); } });
$('#show').addEventListener('click', () => {
  if (!userTurn()) return;
  const m = expectedMove();
  misses++;
  say(`Rätt drag är ${m.san}.`);
  hintSq = m.from; renderBoard();
});
$('#weakest').addEventListener('click', () => {
  const score = (o) => { const s = stats[o.id] || { runs: 0, clean: 0 }; return s.clean * 10 - (s.runs - s.clean); };
  const pick = [...OPENINGS].sort((a, b) => score(a) - score(b))[0];
  start(pick);
});

let first = OPENINGS[0];
try { first = OPENINGS.find((o) => o.id === localStorage.getItem(STORE + '-last')) || first; } catch {}
start(first);
