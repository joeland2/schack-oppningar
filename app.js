import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { OPENINGS } from './openings.js';

const FILES = 'abcdefgh';
const STORE = 'opening-book-v2';
const MIN_SHARE = 0.05;   // an opponent reply must be played in at least 5% of games from that position
const MAX_LINES = 20;
const MIN_GAMES = 20;     // below this, real-game data is too thin to trust
const MAX_PLY = 24;
const BUCKETS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]; // Lichess explorer rating groups
const STRONG = '2200,2500';
const CLIENT_ID = 'opening-book';
const REDIRECT = location.origin + location.pathname;

const $ = (s) => document.querySelector(s);
const boardEl = $('#board');
const listEl = $('#openings');
const msgEl = $('#message');
const movesEl = $('#moves');

let stats = load(STORE, {});    // { [openingId]: { done: [lineKey], total } }
let token = load(STORE + '-token', null);
let rating = load(STORE + '-blitz-rating', null);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Explorer rating groups overlapping rating ± 200.
function ratingsAround(r) {
  return BUCKETS.filter((b, i) => b <= r + 200 && (BUCKETS[i + 1] ?? Infinity) > r - 200).join(',');
}
console.assert(ratingsAround(1500) === '1200,1400,1600' && ratingsAround(2400) === '2200,2500', 'ratingsAround');

// ---------- Lichess login (OAuth PKCE, no server needed) ----------
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function login() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem('pkce', JSON.stringify({ verifier, state }));
  location.href = 'https://lichess.org/oauth?' + new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT,
    code_challenge_method: 'S256', code_challenge: challenge, state,
  });
}

async function finishLogin() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return;
  history.replaceState(null, '', REDIRECT);
  const saved = JSON.parse(sessionStorage.getItem('pkce') || 'null');
  sessionStorage.removeItem('pkce');
  if (!q.has('code') || !saved || q.get('state') !== saved.state) return;
  const res = await fetch('https://lichess.org/api/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: q.get('code'), code_verifier: saved.verifier,
      redirect_uri: REDIRECT, client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) return;
  token = (await res.json()).access_token;
  store(STORE + '-token', token);
}

async function fetchBlitzRating() {
  const acc = await fetch('https://lichess.org/api/account', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => ({}));
  rating = acc.perfs?.blitz?.rating || null;
  store(STORE + '-blitz-rating', rating);
}

function logout() {
  fetch('https://lichess.org/api/token', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  token = null;
  try { localStorage.removeItem(STORE + '-token'); } catch {}
  renderAccount();
  start(cur);
}

function renderAccount() {
  $('#login').textContent = token ? 'Log out' : 'Log in with Lichess';
  $('#rating').value = rating || '';
}

// ---------- Lichess data ----------
// Book lines: data/*.tsv from github.com/lichess-org/chess-openings (CC0): eco, name, pgn
async function loadBook() {
  const texts = await Promise.all([...'abcde'].map((f) => fetch(`data/${f}.tsv`).then((r) => r.text())));
  return texts.flatMap((t) => t.trim().split('\n').slice(1)).map((row) => {
    const [, name, pgn] = row.split('\t');
    return { name, moves: pgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/).map(clean) };
  });
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

const REQUEST_GAP = 1000;
let lastRequest = 0;

// Real games from the Lichess opening explorer. Cached, since lines are rebuilt from the same positions.
async function explore(fen, ratings) {
  const key = `${STORE}-x:blitz:${ratings}:${fen}`;
  const hit = load(key, null);
  if (hit) return hit;
  for (;;) {
    await sleep(lastRequest + REQUEST_GAP - Date.now()); // stay under the explorer's rate limit
    lastRequest = Date.now();
    const res = await fetch('https://explorer.lichess.ovh/lichess?' + new URLSearchParams({
      variant: 'standard', fen, ratings, speeds: 'blitz', moves: 12, topGames: 0, recentGames: 0,
    }), { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) { say('Lichess asked us to slow down. Waiting a minute…'); await sleep(61000); continue; }
    if (res.status === 401) { logout(); throw new Error('Lichess login expired'); }
    if (!res.ok) throw new Error(`Lichess explorer ${res.status}`);
    const j = await res.json();
    const out = {
      total: j.white + j.draws + j.black,
      moves: j.moves.map((m) => ({ san: clean(m.san), n: m.white + m.draws + m.black })),
      opening: j.opening && `${j.opening.eco} · ${j.opening.name}`,
    };
    store(key, out);
    return out;
  }
}

// Your move: what 2200+ players play most here, preferring moves from this opening's book.
async function userMove(moves, book) {
  const g = new Chess();
  moves.forEach((m) => g.move(m));
  const strong = (await explore(g.fen(), STRONG)).moves.filter((m) => m.n >= MIN_GAMES);
  return (strong.find((m) => book.has(lineKey([...moves, m.san]))) || strong[0])?.san;
}

// Grow lines from the root, most common first. Each opponent reply played in ≥ MIN_SHARE of games
// at your rating becomes its own branch; stop branching once MAX_LINES lines exist.
async function buildLines(op) {
  const book = familyBook(op);
  const mine = ratingsAround(rating);
  const done = [];
  const open = [{ moves: op.root.split(' '), share: 1, name: '' }];
  let positions = 0;
  while (open.length && done.length + open.length < MAX_LINES) {
    if (cur !== op) throw new Error('cancelled'); // another opening was picked
    open.sort((a, b) => b.share - a.share);
    const l = open.shift();
    say(`Loading real games from Lichess… ${++positions} positions`);
    let moves = l.moves;
    if (moves.length >= MAX_PLY) { done.push(l); continue; }
    if (moves.length % 2 === (op.side === 'w' ? 0 : 1)) {
      const san = await userMove(moves, book);
      if (!san) { done.push(l); continue; }
      moves = [...moves, san];
    }
    const g = new Chess();
    moves.forEach((m) => g.move(m));
    const x = await explore(g.fen(), mine);
    const name = x.opening || l.name;
    const replies = x.total < MIN_GAMES ? [] : x.moves.filter((m) => m.n >= MIN_GAMES && m.n / x.total >= MIN_SHARE);
    if (!replies.length) { done.push({ moves, share: l.share, name }); continue; }
    for (const m of replies) open.push({ moves: [...moves, m.san], share: l.share * m.n / x.total, name });
  }
  // Lines cut off by the cap end on the opponent's move; finish them with your answer.
  for (const l of open) {
    const san = await userMove(l.moves, book);
    if (san) l.moves = [...l.moves, san];
  }
  return [...done, ...open].sort((a, b) => b.share - a.share);
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
    if (hintSq.includes(sq)) cls.push('hint');
    if (sq === wrongSq) cls.push('wrong');
    if (targets.includes(sq)) cls.push(p ? 'cap' : 'dot');
    const col = i % 8, row = Math.floor(i / 8);
    const fileLbl = row === 7 ? `<span class="lbl f">${sq[0]}</span>` : '';
    const rankLbl = col === 0 ? `<span class="lbl r">${sq[1]}</span>` : '';
    const piece = p ? `<img class="pc" src="pieces/${p.color}${p.type.toUpperCase()}.svg" alt="">` : '';
    return `<button class="${cls.join(' ')}" data-sq="${sq}" aria-label="${sq}${p ? ' ' + p.color + p.type : ''}">${piece}${fileLbl}${rankLbl}</button>`;
  }).join('');
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
  msgEl.textContent = text;
  msgEl.className = 'message ' + tone;
}

function render() { renderBoard(); renderMoves(); }

// ---------- Game ----------
async function start(op) {
  cur = op;
  line = []; lines = []; game = new Chess();
  ply = 0; sel = null; hintSq = []; wrongSq = null; lastMove = null;
  misses = 0; missesHere = 0; busy = true;
  $('#op-title').textContent = op.name;
  $('#op-eco').textContent = op.eco;
  $('#op-info').textContent = op.info;
  $('#op-var').textContent = '';
  $('#op-side').textContent = op.side === 'w' ? 'You play White' : 'You play Black';
  $('#restart').textContent = 'Restart';
  store(STORE + '-last', op.id);
  renderList();
  render();
  if (!token) return say('Log in with Lichess to train against real games.');
  if (!rating) return say('Enter your Lichess blitz rating at the top.');
  let built;
  try { built = await buildLines(op); } catch (e) {
    return cur === op && say(`Could not load games from Lichess: ${e.message}`, 'bad');
  }
  lines = built;
  const s = stats[op.id] = { done: [], ...stats[op.id], total: lines.length };
  store(STORE, stats);
  renderList();
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
    boardEl.classList.remove('shake'); void boardEl.offsetWidth; boardEl.classList.add('shake');
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
$('#weakest').addEventListener('click', () => {
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
$('#login').addEventListener('click', () => (token ? logout() : login()));
$('#rating').addEventListener('change', (e) => {
  rating = Number(e.target.value) || null;
  store(STORE + '-blitz-rating', rating);
  start(cur);
});

let BOOK;
try { BOOK = await loadBook(); } catch {
  say('Could not load the opening data. Serve the folder over HTTP, e.g. npx serve .', 'bad');
  throw new Error('opening data failed to load');
}
await finishLogin().catch(() => {});
if (token && !rating) await fetchBlitzRating();
renderAccount();
setMode(mode);
start(OPENINGS.find((o) => o.id === load(STORE + '-last', null)) || OPENINGS[0]);
