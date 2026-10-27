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
let cur = null;      // current opening
let node = null;     // current position in the variation tree
let game = null;
let ply = 0;
let sel = null;
let hintSq = null;
let wrongSq = null;
let lastMove = null;
let misses = 0;      // mistakes in this run
let missesHere = 0;  // mistakes on the current move
let busy = false;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(stats)); } catch {}
}
const clean = (san) => san.replace(/[+#]/g, '');

// ---------- Lichess data ----------
// data/*.tsv from github.com/lichess-org/chess-openings (CC0): eco, name, pgn
async function loadLines() {
  const texts = await Promise.all([...'abcde'].map((f) => fetch(`data/${f}.tsv`).then((r) => r.text())));
  return texts.flatMap((t) => t.trim().split('\n').slice(1)).map((row) => {
    const [eco, name, pgn] = row.split('\t');
    return { eco, name, moves: pgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/) };
  });
}

// Every Lichess line in the opening's family, merged into one move tree. n = lines through the node.
function buildTree(op) {
  const root = { kids: new Map(), n: 0 };
  for (const l of LINES) {
    if (!l.name.startsWith(op.family) && !l.name.includes(': ' + op.family)) continue;
    let at = root;
    for (const san of l.moves) {
      const k = clean(san);
      if (!at.kids.has(k)) at.kids.set(k, { san, kids: new Map(), n: 0 });
      at = at.kids.get(k);
      at.n++;
    }
    at.name = l.name; at.eco = l.eco;
  }
  return root;
}

const depth = (n) => n.kids.size ? 1 + Math.max(...[...n.kids.values()].map(depth)) : 0;
const mainKid = (n) => [...n.kids.values()].sort((a, b) => b.n - a.n)[0];
function randomKid(n) {
  let r = Math.random() * [...n.kids.values()].reduce((s, k) => s + k.n, 0);
  for (const k of n.kids.values()) if ((r -= k.n) < 0) return k;
  return mainKid(n);
}

// ---------- Opening list ----------
function renderList() {
  const groups = [['w', 'You play White'], ['b', 'You play Black']];
  listEl.innerHTML = groups.map(([side, label]) => `
    <h3 class="group">${label}</h3>
    <ul>${OPENINGS.filter((o) => o.side === side).map((o) => {
      const s = stats[o.id] || { runs: 0, clean: 0 };
      const level = s.clean >= 3 ? 'sitter' : s.runs ? 'pagar' : 'ny';
      const levelTxt = { sitter: 'Learned', pagar: `${s.clean}/3 clean`, ny: 'New' }[level];
      return `<li><button class="op ${cur && cur.id === o.id ? 'active' : ''}" data-id="${o.id}">
        <span class="eco">${o.eco}</span>
        <span class="op-name">${o.name}</span>
        <span class="chip ${level}">${levelTxt}</span>
      </button></li>`;
    }).join('')}</ul>`).join('');
  listEl.querySelectorAll('.op').forEach((b) =>
    b.addEventListener('click', () => start(OPENINGS.find((o) => o.id === b.dataset.id))));
}

// ---------- Board ----------
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
  for (let i = 0; i < hist.length; i += 2) {
    const cell = (j) => `<span class="mv ${j === hist.length - 1 ? 'now' : ''}">${hist[j] || ''}</span>`;
    html += `<li><span class="num">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}</li>`;
  }
  movesEl.innerHTML = html;
  const left = depth(node);
  $('#progress').textContent = left ? `${ply} moves, up to ${left} left` : `${ply} moves, line complete`;
  $('#bar').style.width = `${(ply / (ply + left)) * 100}%`;
}

function say(text, tone = '') {
  msgEl.textContent = text;
  msgEl.className = 'message ' + tone;
}

function render() { renderBoard(); renderMoves(); }

// ---------- Game ----------
function start(op) {
  cur = op;
  node = buildTree(op);
  game = new Chess();
  ply = 0; sel = null; hintSq = null; wrongSq = null; lastMove = null;
  misses = 0; missesHere = 0; busy = false;
  $('#op-title').textContent = op.name;
  $('#op-eco').textContent = op.eco;
  $('#op-info').textContent = op.info;
  $('#op-var').textContent = '';
  $('#op-side').textContent = op.side === 'w' ? 'You play White' : 'You play Black';
  try { localStorage.setItem(STORE + '-last', op.id); } catch {}
  renderList();
  render();
  if (userTurn()) say('Your move. Play the first move.');
  else { say('Your opponent starts…'); reply(); }
}

const userTurn = () => node.kids.size > 0 && game.turn() === cur.side;

function advance(m, next) {
  lastMove = m; ply++; node = next;
  if (next.name) $('#op-var').textContent = `${next.eco} · ${next.name}`;
}

function reply() {
  busy = true;
  setTimeout(() => {
    const next = randomKid(node);
    advance(game.move(next.san), next);
    busy = false; hintSq = null;
    render();
    if (!node.kids.size) return finish();
    say('Your move.');
  }, 450);
}

function tryMove(from, to) {
  let m;
  try { m = game.move({ from, to, promotion: 'q' }); } catch { return false; }
  if (!m) return false;
  const next = node.kids.get(clean(m.san));
  if (!next) {
    game.undo();
    misses++; missesHere++;
    wrongSq = to; sel = null;
    renderBoard();
    boardEl.classList.remove('shake'); void boardEl.offsetWidth; boardEl.classList.add('shake');
    if (missesHere >= 2) { showHint(); say(`${m.san} is not in the book. The piece to move is highlighted.`, 'bad'); }
    else say(`${m.san} is not in the book. Try again.`, 'bad');
    setTimeout(() => { wrongSq = null; renderBoard(); }, 700);
    return true;
  }
  advance(m, next);
  sel = null; hintSq = null; missesHere = 0;
  say(`Correct: ${m.san}`, 'good');
  render();
  if (!node.kids.size) finish(); else reply();
  return true;
}

function expectedMove() {
  return new Chess(game.fen()).move(mainKid(node).san);
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
  if (misses === 0) say(s.clean >= 3 ? 'Flawless! You have learned this opening.' : `Flawless! ${s.clean} of 3 clean runs.`, 'good');
  else say(`Done with ${misses} mistake${misses === 1 ? '' : 's'}. Run it again to drill it in.`, '');
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
$('#hint').addEventListener('click', () => { if (userTurn()) { showHint(); say('The piece to move is highlighted.'); } });
$('#show').addEventListener('click', () => {
  if (!userTurn()) return;
  const m = expectedMove();
  misses++;
  say(`The main move is ${m.san}.`);
  hintSq = m.from; renderBoard();
});
$('#weakest').addEventListener('click', () => {
  const score = (o) => { const s = stats[o.id] || { runs: 0, clean: 0 }; return s.clean * 10 - (s.runs - s.clean); };
  const pick = [...OPENINGS].sort((a, b) => score(a) - score(b))[0];
  start(pick);
});

let LINES;
try { LINES = await loadLines(); } catch {
  say('Could not load the opening data. Serve the folder over HTTP, e.g. npx serve .', 'bad');
  throw new Error('opening data failed to load');
}
let first = OPENINGS[0];
try { first = OPENINGS.find((o) => o.id === localStorage.getItem(STORE + '-last')) || first; } catch {}
start(first);
