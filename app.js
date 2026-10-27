import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard, shake } from './board.js';

const STORE = 'opening-book-v2';
const MIN_SHARE = 0.05;   // an opponent reply must be played in at least 5% of games from that position
const MAX_LINES = 20;
const MIN_GAMES = 20;     // below this, real-game data is too thin to trust
const MAX_PLY = 20;       // data/explorer.json goes this deep
const BUCKETS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]; // Lichess explorer rating groups
const STRONG = [7, 8];    // the 2200+ groups
const WANT = { w: 30, b: 15 };   // openings listed per colour
// First-move names that are not an opening plan of their own.
const GENERIC = new Set(["King's Pawn Game", "Queen's Pawn Game", "King's Knight Opening"]);

const $ = (s) => document.querySelector(s);
const boardEl = $('#board');
const listEl = $('#openings');
const msgEl = $('#message');
const movesEl = $('#moves');

let stats = load(STORE, {});    // { [openingId]: { done: [lineKey], total } }
let rating = load(STORE + '-blitz-rating', null);
let OPENINGS = [];   // most played openings at your level
let cur = null;      // current opening
let lines = [];      // real-game lines for cur, most common first
let lineIdx = 0;
let line = [];       // SAN moves of the line being practised
let game = new Chess();
let ply = 0;
let sel = null;
let hintSq = [];     // highlighted squares
let mode = load(STORE + '-mode', 'learn'); // learn: every move is shown; try: test yourself
let wrongSq = null;
let lastMove = null;
let misses = 0;      // mistakes in this run
let missesHere = 0;  // mistakes on the current move
let busy = false;

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
const clean = (san) => san.replace(/[+#]/g, '');
const lineKey = (moves) => moves.join(' ');
const numbered = (moves) => moves.split(' ').map((m, i) => (i % 2 ? m : `${i / 2 + 1}.${m}`)).join(' ');

// Indexes of the rating groups overlapping rating ± 200.
function ratingsAround(r) {
  return BUCKETS.flatMap((b, i) => (b <= r + 200 && (BUCKETS[i + 1] ?? Infinity) > r - 200 ? [i] : []));
}
console.assert(ratingsAround(1500).join() === '2,3,4' && ratingsAround(2400).join() === '7,8', 'ratingsAround');

// ---------- Data (all local, nothing is fetched from Lichess) ----------
let TREE, BOOK, NAMES;

// data/explorer.json: move counts per rating group from Lichess blitz games, built by tools/make_explorer.py.
// data/*.tsv: named opening lines from github.com/lichess-org/chess-openings (CC0): eco, name, pgn.
async function loadData() {
  const [explorer, ...texts] = await Promise.all([
    fetch('data/explorer.json').then((r) => r.json()),
    ...[...'abcde'].map((f) => fetch(`data/${f}.tsv`).then((r) => r.text())),
  ]);
  TREE = explorer.tree;
  BOOK = texts.flatMap((t) => t.trim().split('\n').slice(1)).map((row) => {
    const [eco, name, pgn] = row.split('\t');
    return { eco, name, moves: pgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/).map(clean) };
  });
  NAMES = new Map(BOOK.map((l) => [lineKey(l.moves), l]));
}

// Every book position in the opening's family, as move-sequence keys.
function familyBook(op) {
  const set = new Set();
  for (const l of BOOK) {
    if (!l.name.startsWith(op.family) && !l.name.includes(': ' + op.family)) continue;
    for (let i = 1; i <= l.moves.length; i++) set.add(lineKey(l.moves.slice(0, i)));
  }
  return set;
}

// Games and replies after a move sequence, counted over the given rating groups.
function explore(moves, groups) {
  let node = TREE;
  for (const m of moves) {
    node = node[1]?.[m];
    if (!node) return { total: 0, moves: [] };
  }
  const sum = (c) => groups.reduce((s, i) => s + c[i], 0);
  const replies = Object.entries(node[1] || {}).map(([san, child]) => {
    const named = NAMES.get(lineKey([...moves, san]));
    return { san, n: sum(child[0]), eco: named?.eco, name: named?.name };
  });
  return { total: sum(node[0]), moves: replies.filter((m) => m.n > 0).sort((a, b) => b.n - a.n) };
}

// Your move: what 2200+ players play most here, preferring moves from this opening's book.
function userMove(moves, book) {
  const strong = explore(moves, STRONG).moves.filter((m) => m.n >= MIN_GAMES);
  return (strong.find((m) => book.has(lineKey([...moves, m.san]))) || strong[0])?.san;
}

// Grow lines from the root, most common first. Each opponent reply played in ≥ MIN_SHARE of games
// at your rating becomes its own branch; stop branching once MAX_LINES lines exist.
function buildLines(op) {
  const book = familyBook(op);
  const mine = ratingsAround(rating);
  const nameOf = (moves, fallback) => {
    const n = NAMES.get(lineKey(moves));
    return n ? `${n.eco} · ${n.name}` : fallback;
  };
  const done = [];
  const open = [{ moves: op.root.split(' '), share: 1, name: '' }];
  while (open.length && done.length + open.length < MAX_LINES) {
    open.sort((a, b) => b.share - a.share);
    const l = open.shift();
    let moves = l.moves;
    if (moves.length >= MAX_PLY) { done.push(l); continue; }
    if (moves.length % 2 === (op.side === 'w' ? 0 : 1)) {
      const san = userMove(moves, book);
      if (!san) { done.push(l); continue; }
      moves = [...moves, san];
    }
    const x = explore(moves, mine);
    const name = nameOf(moves, l.name);
    const replies = x.total < MIN_GAMES ? [] : x.moves.filter((m) => m.n >= MIN_GAMES && m.n / x.total >= MIN_SHARE);
    if (!replies.length) { done.push({ moves, share: l.share, name }); continue; }
    for (const m of replies) open.push({ moves: [...moves, m.san], share: l.share * m.n / x.total, name: nameOf([...moves, m.san], name) });
  }
  // Lines cut off by the cap end on the opponent's move; finish them with your answer.
  for (const l of open) {
    const san = userMove(l.moves, book);
    if (san) l.moves = [...l.moves, san];
  }
  return [...done, ...open].sort((a, b) => b.share - a.share);
}

// The most played openings at your level, found by walking real games from the start position,
// most common positions first. An opening belongs to the side whose move first gives it its name.
function popularOpenings() {
  const mine = ratingsAround(rating);
  const found = new Map();
  const open = [{ moves: [], share: 1 }];
  const count = (side) => [...found.values()].filter((o) => o.side === side).length;
  while (open.length && (count('w') < WANT.w || count('b') < WANT.b)) {
    open.sort((a, b) => b.share - a.share);
    const p = open.shift();
    const x = explore(p.moves, mine);
    for (const m of x.moves) {
      const share = p.share * m.n / x.total;
      if (share < 0.0005 || m.n < MIN_GAMES) continue;
      const moves = [...p.moves, m.san];
      const family = m.name && m.name.split(':')[0];
      if (family && !GENERIC.has(family) && !found.has(family)) {
        found.set(family, { id: family, name: family, family, eco: m.eco, side: moves.length % 2 ? 'w' : 'b', root: moves.join(' '), share });
      }
      open.push({ moves, share });
    }
  }
  return top(found);
}

function top(found) {
  const all = [...found.values()].sort((a, b) => b.share - a.share);
  return [...all.filter((o) => o.side === 'w').slice(0, WANT.w), ...all.filter((o) => o.side === 'b').slice(0, WANT.b)];
}

// ---------- Opening list ----------
function renderList() {
  const groups = [['w', 'You play White'], ['b', 'You play Black']];
  listEl.innerHTML = groups.map(([side, label]) => `
    <h3 class="group">${label}</h3>
    <ul>${OPENINGS.filter((o) => o.side === side).map((o) => {
      const s = stats[o.id] || { done: [], total: 0 };
      const level = s.total && s.done.length >= s.total ? 'sitter' : s.done.length ? 'pagar' : 'ny';
      const levelTxt = { sitter: 'Learned', pagar: `${s.done.length}/${s.total} lines`, ny: 'New' }[level];
      return `<li><button class="op" data-id="${o.id}">
        <span class="eco">${o.eco}</span>
        <span class="op-name">${o.name}<small>${o.share < 0.01 ? '<1' : Math.round(o.share * 100)}% of games · ${o.root.split(' ').length} moves in</small></span>
        <span class="chip ${level}">${levelTxt}</span>
      </button></li>`;
    }).join('')}</ul>`).join('');
  listEl.querySelectorAll('.op').forEach((b) =>
    b.addEventListener('click', () => start(OPENINGS.find((o) => o.id === b.dataset.id))));
}

// ---------- Board ----------
function renderBoard() {
  drawBoard(boardEl, game, { side: cur.side, sel, last: lastMove, hint: hintSq, wrong: wrongSq });
}

function renderMoves() {
  const hist = game.history();
  let html = '';
  for (let i = 0; i < Math.max(line.length, hist.length); i += 2) {
    const cell = (j) => j < hist.length
      ? `<span class="mv ${j === hist.length - 1 ? 'now' : ''}">${hist[j]}</span>`
      : `<span class="mv todo">${j < line.length ? '…' : ''}</span>`;
    html += `<li><span class="num">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}</li>`;
  }
  movesEl.innerHTML = html;
  const free = line.length && ply >= line.length;
  $('#progress').textContent = free ? 'Opening done · playing on vs Stockfish' : line.length ? `${ply} of ${line.length} moves` : '';
  $('#bar').style.width = line.length ? `${Math.min(ply / line.length, 1) * 100}%` : '0';
}

function say(text, tone = '') {
  if ($('#trainer').hidden) return ($('#pick-msg').textContent = text);
  msgEl.textContent = text;
  msgEl.className = 'message ' + tone;
}

function render() { renderBoard(); renderMoves(); }

// ---------- Game ----------
function start(op) {
  cur = op;
  line = []; lines = []; game = new Chess();
  ply = 0; sel = null; hintSq = []; wrongSq = null; lastMove = null;
  misses = 0; missesHere = 0; busy = true;
  $('#op-title').textContent = op.name;
  $('#op-eco').textContent = op.eco;
  $('#op-info').textContent = `Starts ${numbered(op.root)}. Played in ${op.share < 0.01 ? 'under 1' : Math.round(op.share * 100)}% of blitz games at your level.`;
  $('#op-var').textContent = '';
  $('#op-side').textContent = op.side === 'w' ? 'You play White' : 'You play Black';
  $('#restart').textContent = 'Restart';
  $('#picker').hidden = true;
  $('#trainer').hidden = false;
  render();
  if (!rating) return say('Enter your Lichess blitz rating at the top.');
  lines = buildLines(op);
  if (!lines.length) return say('Not enough games at your rating for this opening.', 'bad');
  const s = stats[op.id] = { done: [], ...stats[op.id], total: lines.length };
  store(STORE, stats);
  const next = lines.findIndex((l) => !s.done.includes(lineKey(l.moves)));
  play(next === -1 ? 0 : next);
}

function play(i) {
  lineIdx = i;
  const l = lines[i];
  line = l.moves;
  game = new Chess();
  ply = 0; sel = null; hintSq = []; wrongSq = null; lastMove = null;
  misses = 0; missesHere = 0; busy = false;
  engineGen++; // ignore a Stockfish reply still on its way from the previous game
  $('#op-var').textContent = `Line ${i + 1} of ${lines.length} · ${l.share < 0.01 ? '<1' : Math.round(l.share * 100)}% of games at ${rating} ± 200${l.name ? ' · ' + l.name : ''}`;
  $('#restart').textContent = 'Restart';
  render();
  if (userTurn()) prompt('Your move. Play the first move.');
  else { say('Your opponent starts…'); reply(); }
}

const userTurn = () => line.length > 0 && !game.isGameOver() && game.turn() === cur.side;
const inLine = () => ply < line.length;

// ---------- Play on vs Stockfish after the line ----------
// Same-origin rule for workers: load the CDN script through a blob worker.
const ENGINE_SRC = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';
let engine = null;
let engineGen = 0;
// shortcut: Skill Level 0–20 mapped linearly from rating, rough at best; upgrade to UCI_Elo with Stockfish 11+.
const skill = () => Math.max(0, Math.min(20, Math.round((rating - 800) / 85)));

function engineMove() {
  engine ??= new Worker(URL.createObjectURL(new Blob([`importScripts('${ENGINE_SRC}')`], { type: 'text/javascript' })));
  const gen = ++engineGen;
  busy = true;
  engine.onmessage = (e) => {
    if (typeof e.data !== 'string' || !e.data.startsWith('bestmove') || gen !== engineGen) return;
    const uci = e.data.split(' ')[1];
    lastMove = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    ply++; busy = false;
    render();
    if (!gameOver()) say('Your move.');
  };
  engine.postMessage(`setoption name Skill Level value ${skill()}`);
  engine.postMessage(`position fen ${game.fen()}`);
  engine.postMessage('go movetime 600');
}

function gameOver() {
  if (!game.isGameOver()) return false;
  if (game.isCheckmate()) say(game.turn() === cur.side ? 'Checkmate. Stockfish wins this one.' : 'Checkmate! You win.', game.turn() === cur.side ? 'bad' : 'good');
  else say('Draw.');
  return true;
}

function reply() {
  busy = true;
  setTimeout(() => {
    const m = game.move(line[ply]);
    lastMove = m; ply++; busy = false; hintSq = [];
    render();
    if (ply >= line.length) return finish();
    prompt('Your move.');
  }, 450);
}

function tryMove(from, to) {
  let m;
  try { m = game.move({ from, to, promotion: 'q' }); } catch { return false; }
  if (!m) return false;
  if (!inLine()) {
    lastMove = m; ply++; sel = null;
    render();
    if (!gameOver()) engineMove();
    return true;
  }
  if (clean(m.san) !== line[ply]) {
    game.undo();
    misses++; missesHere++;
    wrongSq = to; sel = null;
    renderBoard();
    shake(boardEl);
    if (missesHere >= 2) { showHint(); say(`${m.san} is not the move here. The piece to move is highlighted.`, 'bad'); }
    else say(`${m.san} is not the move here. Try again.`, 'bad');
    setTimeout(() => { wrongSq = null; renderBoard(); }, 700);
    return true;
  }
  lastMove = m; ply++; sel = null; hintSq = []; missesHere = 0;
  say(`Correct: ${m.san}`, 'good');
  render();
  if (ply >= line.length) finish(); else reply();
  return true;
}

function expectedMove() {
  return new Chess(game.fen()).move(line[ply]);
}

// In Learn mode the move to play is always shown.
function prompt(text) {
  if (mode !== 'learn' || !inLine()) return say(text);
  const m = expectedMove();
  hintSq = [m.from, m.to];
  renderBoard();
  say(`Play ${m.san}.`);
}

function showHint() {
  if (!userTurn() || !inLine()) return;
  hintSq = [expectedMove().from];
  renderBoard();
}

function finish() {
  if (mode === 'learn') {
    $('#restart').textContent = 'Next line';
    return say(`Line ${lineIdx + 1} of ${lines.length} learned. Press Next line, or switch to Try to test yourself.`, 'good');
  }
  const s = stats[cur.id];
  const key = lineKey(line);
  if (misses === 0 && !s.done.includes(key)) s.done.push(key);
  store(STORE, stats);
  renderList();
  const left = lines.findIndex((l) => !s.done.includes(lineKey(l.moves)));
  const on = ' Now play on against Stockfish until checkmate.';
  if (misses) say(`Opening done with ${misses} mistake${misses === 1 ? '' : 's'}; Restart tries this line again.${on}`);
  else if (left === -1) say(`Flawless! Every common line at your level is cleared.${on}`, 'good');
  else {
    $('#restart').textContent = 'Next line';
    say(`Flawless! ${s.done.length} of ${lines.length} lines cleared.${on}`, 'good');
  }
  if (!gameOver() && game.turn() !== cur.side) engineMove();
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

$('#restart').addEventListener('click', () => {
  if (!lines.length) return start(cur);
  if (mode === 'learn') return play(ply >= line.length ? (lineIdx + 1) % lines.length : lineIdx);
  const next = lines.findIndex((l) => !stats[cur.id].done.includes(lineKey(l.moves)));
  play(ply >= line.length && misses === 0 && next !== -1 ? next : lineIdx);
});
$('#hint').addEventListener('click', () => { if (userTurn() && inLine()) { showHint(); say('The piece to move is highlighted.'); } });
$('#show').addEventListener('click', () => {
  if (!userTurn() || !inLine()) return;
  const m = expectedMove();
  misses++;
  say(`The move is ${m.san}.`);
  hintSq = [m.from, m.to]; renderBoard();
});
// Opening picker, shown before the board.
function showPicker() {
  cur = null; engineGen++; // stops a Stockfish reply that is still on its way
  $('#trainer').hidden = true;
  $('#picker').hidden = false;
  listEl.innerHTML = '';
  if (!rating) return ($('#pick-msg').textContent = 'Enter your Lichess blitz rating at the top to see the openings played at your level.');
  OPENINGS = popularOpenings();
  $('#pick-msg').textContent = `The most played openings in blitz at ${rating} ± 200. Pick one to practise.`;
  renderList();
}
$('#back').addEventListener('click', showPicker);
$('#weakest').addEventListener('click', () => {
  if (!OPENINGS.length) return;
  const score = (o) => { const s = stats[o.id]; return s && s.total ? s.done.length / s.total : 0; };
  start([...OPENINGS].sort((a, b) => score(a) - score(b))[0]);
});
function setMode(m) {
  mode = m;
  store(STORE + '-mode', m);
  $('#mode-learn').setAttribute('aria-pressed', m === 'learn');
  $('#mode-try').setAttribute('aria-pressed', m === 'try');
  if (lines.length) play(lineIdx);
}
$('#mode-learn').addEventListener('click', () => setMode('learn'));
$('#mode-try').addEventListener('click', () => setMode('try'));
$('#rating').addEventListener('change', (e) => {
  rating = Number(e.target.value) || null;
  store(STORE + '-blitz-rating', rating);
  showPicker();
});

try { await loadData(); } catch {
  say('Could not load the opening data. Serve the folder over HTTP, e.g. npx serve .', 'bad');
  throw new Error('opening data failed to load');
}
$('#rating').value = rating || '';
setMode(mode);
showPicker();
