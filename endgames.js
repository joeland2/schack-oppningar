// Endgames: the basic wins, played all the way to mate, in the same three steps as an opening:
// Learn (the best move shown), Practice (from memory, cleared with no slip, back for review like a line)
// and Time (mate as fast as you can). There are no fixed lines: every position is new, and the
// Lichess tablebase (tablebase.lichess.ovh, exact for up to 7 pieces) says what every move is worth
// and plays the defence. A slip is a move that lets the win go: a draw, stalemate or a piece given away.
import { banner, confetti } from './celebrate.js?v=20261105105158';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard, enableDrag, shake, instruction, flyStar } from './board.js?v=20261105105158';

const $ = (s) => document.querySelector(s);
// { [id]: { learned: 0|1, box, due, times: [your three best ms] } }, synced with your account (header.js). Numbers
// and lists, so progress made logged out adds to the account's when you log in (the higher number, both lists).
const STORE = 'opening-book-v2-endgames';
const DAY = 864e5, INTERVALS = [0, 1, 3, 7, 14, 30]; // days per box, as for an opening's lines
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const moves = (plies) => Math.ceil(Math.abs(plies) / 2); // the winner's moves to mate
const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

const FILES = 'abcdefgh';
const SQUARES = [...FILES].flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => f + r));
const fi = (sq) => FILES.indexOf(sq[0]), ri = (sq) => Number(sq[1]);
const far = (a, b) => Math.max(Math.abs(fi(a) - fi(b)), Math.abs(ri(a) - ri(b))); // king steps between two squares
const dark = (sq) => (fi(sq) + ri(sq)) % 2 === 0;

// Each endgame: its pieces, extra rules for a fair start, how far from mate it should start (in plies),
// the time for the Time challenge, and what to think about, shown before you start.
const LESSONS = [
  { id: 'kq', tag: 'K+Q', group: 'Basic mates', title: 'Queen and king', pieces: ['wK', 'wQ', 'bK'], min: 14, time: 60,
    intro: 'The queen cannot mate alone, but with your king beside her it takes at most ten moves.',
    plan: ['<b>Make a box.</b> Put your queen a knight\'s move away from their king. It can only step inside the box the queen leaves it.',
      '<b>Shrink the box.</b> Each time their king steps back, follow with the queen, still a knight\'s move away, until the king is stuck on the edge.',
      '<b>Never take the last square.</b> If their king has no move and is not in check, it is stalemate: a draw. Always leave it one square.',
      '<b>Bring your king.</b> With their king on the edge, stop moving the queen and walk your king up until the kings face each other with one square between.',
      '<b>Mate on the edge.</b> Now the queen checks along the edge, guarded by your king or out of reach.'],
    ex: [['8/8/8/4k3/8/8/8/3Q2K1 w - - 0 1', 'd1', 'd3', '#15781B'], ['8/8/5k2/8/8/3Q4/8/6K1 w - - 0 1', 'd3', 'e4', '#15781B'], ['7k/8/5Q2/8/8/8/8/6K1 w - - 0 1', 'f6', 'g6', '#c4242a'], ['8/8/8/7k/8/6Q1/8/4K3 w - - 0 1', 'e1', 'f2', '#15781B'], ['7k/8/6K1/8/8/8/8/1Q6 w - - 0 1', 'b1', 'b8', '#15781B']] },
  { id: 'rr', tag: 'R+R', group: 'Basic mates', title: 'Two rooks', pieces: ['wK', 'wR', 'wR', 'bK'], min: 8, time: 45,
    intro: 'The ladder mate: two rooks mate on their own, without help from your king.',
    plan: ['<b>One rook cuts, the other checks.</b> One rook holds a rank so their king cannot cross it; the other gives check on the next rank, pushing the king back.',
      '<b>Take turns.</b> The rooks swap jobs, one rank at a time, like climbing a ladder, until the king is on the edge.',
      '<b>Stay far away.</b> If their king walks up to a rook, move that rook to the far side of the board along its rank, then go on.',
      '<b>Mate.</b> With the king on the edge, one rook guards the next rank and the other checks on the edge.'],
    ex: [['8/8/8/4k3/R7/8/8/1R4K1 w - - 0 1', 'b1', 'b5', '#15781B'], ['8/8/4k3/1R6/R7/8/8/6K1 w - - 0 1', 'a4', 'a6', '#15781B'], ['8/8/2k5/1R6/R7/8/8/6K1 w - - 0 1', 'b5', 'h5', '#15781B'], ['6k1/R7/8/8/8/8/8/1R4K1 w - - 0 1', 'b1', 'b8', '#15781B']] },
  { id: 'kr', tag: 'K+R', group: 'Basic mates', title: 'Rook and king', pieces: ['wK', 'wR', 'bK'], min: 22, time: 120,
    intro: 'The most useful mate to know: rook endgames are the most common of all. It takes at most sixteen moves.',
    plan: ['<b>Cut the king off.</b> Put your rook on a rank or file between the kings, so their king is shut in on one side.',
      '<b>Bring your king.</b> Walk it toward theirs, on the same side of the rook.',
      '<b>Check when the kings face each other.</b> When the kings stand opposite with one square between, a rook check pushes their king back a row.',
      '<b>Otherwise wait.</b> If the kings do not face each other, make a quiet rook move along its line, so their king has to step into the facing position.',
      '<b>Keep the rook safe.</b> If their king comes near your rook, move it far away along the same line.',
      '<b>Mate on the edge</b> the same way: kings face each other, rook checks along the edge.'],
    ex: [['8/8/3k4/8/8/8/8/R5K1 w - - 0 1', 'a1', 'e1', '#15781B'], ['8/8/8/3k4/R7/8/8/4K3 w - - 0 1', 'e1', 'e2', '#15781B'], ['8/8/3k4/R7/3K4/8/8/8 w - - 0 1', 'a5', 'a6', '#15781B'], ['8/8/4k3/R7/3K4/8/8/8 w - - 0 1', 'a5', 'b5', '#15781B'], ['8/8/1k6/R7/8/3K4/8/8 w - - 0 1', 'a5', 'h5', '#15781B'], ['3k4/8/3K4/8/8/8/8/7R w - - 0 1', 'h1', 'h8', '#15781B']] },
  { id: 'bb', tag: 'B+B', group: 'Basic mates', title: 'Two bishops', pieces: ['wK', 'wB', 'wB', 'bK'], min: 22, time: 150,
    intro: 'Two bishops side by side make a wall the king cannot cross. Mate comes in a corner, in at most nineteen moves.',
    plan: ['<b>Bishops side by side.</b> Next to each other they guard two diagonals together, a wall their king cannot step through.',
      '<b>Push to a corner.</b> Move the wall step by step, with your king close behind, so their king is pushed toward a corner.',
      '<b>Your king does half the work.</b> The bishops cannot cover every square: your king takes the squares they miss.',
      '<b>Mind stalemate.</b> Near the corner their king has few squares. Check that it still has a move after each of yours.',
      '<b>Mate in the corner</b> with one bishop checking and the other guarding the square next to the king.'],
    ex: [['8/8/8/3k4/8/2BB4/8/4K3 w - - 0 1', 'd3', 'e4', '#15781B'], ['6k1/8/8/8/3BB3/8/8/4K3 w - - 0 1', 'e1', 'f2', '#15781B'], ['6k1/8/8/4BB2/8/8/8/6K1 w - - 0 1', 'g1', 'g2', '#15781B'], ['7k/8/6K1/8/8/8/2B5/4B3 w - - 0 1', 'c2', 'b3', '#c4242a'], ['7k/8/6K1/8/8/1B6/8/2B5 w - - 0 1', 'c1', 'b2', '#15781B']] },
  { id: 'kp', tag: 'K+P', group: 'Pawn endings', title: 'King and pawn', pieces: ['wK', 'wP', 'bK'], min: 0, time: 150,
    intro: 'Win with a single pawn: make a queen, then mate. Whether it wins depends on where the kings stand.',
    plan: ['<b>King in front, not behind.</b> Your king goes ahead of the pawn and clears the way. A pawn pushed too early is stopped by their king.',
      '<b>The opposition.</b> When the kings face each other with one square between, the side that has to move must give way. Make them be the one to move.',
      '<b>The key squares.</b> Once your king reaches a square two in front of the pawn, the pawn queens whatever they do.',
      '<b>Push the pawn only when it is safe:</b> when your king guards the square it moves to, or their king cannot reach it.',
      '<b>Then mate with the new queen</b>, as in Queen and king.'],
    ex: [['8/8/4k3/8/8/4K3/4P3/8 w - - 0 1', 'e3', 'e4', '#15781B'], ['8/4k3/8/4K3/8/8/4P3/8 w - - 0 1', 'e5', 'e6', '#c4242a'], ['8/4k3/8/8/8/3K4/4P3/8 w - - 0 1', 'd3', 'd4', '#15781B'], ['8/8/4k3/8/4K3/8/4P3/8 w - - 0 1', 'e2', 'e3', '#15781B'], ['4k3/8/4K3/8/8/8/8/7Q w - - 0 1', 'h1', 'h8', '#15781B']] },
];

// ---------- Positions ----------
// A random legal start with White to move, the pieces placed by each endgame's rules, that the tablebase
// calls a win at least `min` plies from mate.
function randomStart(l) {
  for (;;) {
    const at = {}, used = new Set();
    for (const p of l.pieces) {
      let sq;
      do sq = SQUARES[Math.floor(Math.random() * 64)]; while (used.has(sq) || (p[1] === 'P' && (ri(sq) < 2 || ri(sq) > 5 || 'ah'.includes(sq[0]))));
      used.add(sq);
      (at[p] ??= []).push(sq);
    }
    if (far(at.wK[0], at.bK[0]) < 2) continue;
    if (l.id === 'bb' && dark(at.wB[0]) === dark(at.wB[1])) continue; // one bishop of each colour
    if (l.id === 'kp') { // their king in front of the pawn, yours beside it: won only with the opposition
      const p = at.wP[0], k = at.bK[0];
      if (ri(k) <= ri(p) || Math.abs(fi(k) - fi(p)) > 1 || far(k, p) > 3 || far(at.wK[0], p) > 2) continue; // in the pawn's way
    }
    const c = new Chess(); c.clear();
    for (const [p, sqs] of Object.entries(at)) for (const sq of sqs) c.put({ type: p[1].toLowerCase(), color: p[0] }, sq);
    const fen = c.fen().replace(/ [wb] /, ' b ');
    let g;
    try { g = new Chess(fen); } catch { continue; }
    if (g.inCheck()) continue; // their king may not be in check with White to move
    return fen.replace(' b ', ' w ');
  }
}

const cache = new Map();
async function probe(fen) {
  const key = fen.split(' ').slice(0, 4).join(' ');
  if (!cache.has(key)) cache.set(key, fetch(`https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(key + ' 0 1')}`)
    .then((r) => { if (!r.ok) throw new Error(r.status === 429 ? 'The tablebase is busy. Wait a moment and try again.' : 'The tablebase did not answer.'); return r.json(); })
    .catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
}
const dist = (x) => Math.abs(x.dtm ?? x.dtz ?? 0); // plies to mate (to a zeroing move where no mate count is known)

async function newStart(l) {
  for (let i = 0; i < 25; i++) {
    const fen = randomStart(l), r = await probe(fen);
    if (r.category === 'win' && dist(r) >= l.min) return fen;
  }
  throw new Error('No position found. Try again.');
}

// ---------- Progress ----------
const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
let prog = load();
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(prog)); } catch {} };
const rec = (id) => (prog[id] ??= { learned: 0, box: 0, due: 0, times: [] });
const bestOf = (r) => (r?.times?.length ? Math.min(...r.times) : 0);
const isDue = (r) => r && r.box > 0 && r.due <= Date.now();

// ---------- State ----------
const boardEl = $('#board');
let L = null, mode = 'learn', game = null, startPlies = 0, info = null, sel = null, last = null, hint = [], arrow = null, wrong = null;
let busy = true, over = false, misses = 0, assisted = false, gen = 0;
let elapsed = 0, ticking = 0, tickTimer = 0; // Time: your thinking time only, not the defence's

function say(text, tone = '') { $('#message').innerHTML = text; $('#message').className = 'message ' + tone; }
function draw() {
  drawBoard(boardEl, game, { side: 'w', sel, last, hint, wrong, arrows: arrow ? [arrow] : [], dests: sel ? game.moves({ square: sel, verbose: true }).map((m) => m.to) : null });
}
function showMate(r) {
  const n = r ? dist(r) : 0;
  $('#eg-mate').textContent = over ? '' : r?.dtm != null ? `Mate in ${moves(n)}` : '';
  $('#bar').style.width = `${startPlies ? Math.round(100 * (1 - n / startPlies)) : 0}%`;
}

function renderList() {
  const groups = [...new Set(LESSONS.map((l) => l.group))];
  $('#items').innerHTML = groups.map((g) => `<div>
    <h3 class="group">${g}</h3>
    <ul>${LESSONS.filter((l) => l.group === g).map((l) => {
      // Its stars, as on an opening's lines: green once mated in Learn, gold once cleared in Practice, diamond once mated in Time.
      const r = prog[l.id], stars = [[r?.learned, 'green', 'Mated in Learn'], [r?.box > 0, 'gold', 'Cleared in Practice'], [r?.times?.length, 'diamond', 'Mated in the Time challenge']]
        .filter(([on]) => on).map(([, c, t]) => `<svg class="line-star ${c}" viewBox="0 0 24 24" role="img" aria-label="${t}"><title>${t}</title><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>`).join('');
      return `<li><button class="op ${l === L ? 'active' : ''}" data-id="${l.id}">
        <span class="eco">${l.tag}</span><span class="op-name">${l.title}${bestOf(r) ? ` <small>best ${clock(bestOf(r))}</small>` : ''}</span>
        ${isDue(r) ? '<span class="chip pagar">Review</span>' : ''}<span class="line-ok">${stars}</span></button></li>`;
    }).join('')}</ul></div>`).join('');
}
$('#items').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) open(LESSONS.find((l) => l.id === b.dataset.id), true); });

function renderPath() {
  document.querySelectorAll('.path-step').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  const r = prog[L.id];
  $('#eg-due').textContent = isDue(r) ? 'due for review' : r?.box > 0 ? `next review in ${plural(Math.max(1, Math.ceil((r.due - Date.now()) / DAY)), 'day')}` : 'from memory';
  $('#trial-clock').hidden = mode !== 'time';
  $('#tc-best').textContent = bestOf(r) ? `best ${clock(bestOf(r))}` : '';
  $('#hint').hidden = $('#show').hidden = mode === 'time';
}
document.querySelectorAll('.path-step').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; renderPath(); begin(); }));

// Pointing at a step of the plan shows it on the board: an example position with the move as an arrow
// (red: the move to avoid). Leaving the step puts your game back.
function showExample(li) {
  const ex = li && L?.ex?.[li.dataset.ex];
  boardEl.classList.toggle('eg-example', !!ex);
  if (!ex) return draw();
  const [fen, from, to, colour] = ex;
  drawBoard(boardEl, new Chess(fen), { side: 'w', arrows: [[from, to, colour]] });
}
for (const ev of ['mouseover', 'focusin']) $('#eg-plan').addEventListener(ev, (e) => { const li = e.target.closest('[data-ex]'); if (li) showExample(li); });
for (const ev of ['mouseleave', 'focusout']) $('#eg-plan').addEventListener(ev, () => showExample(null));

// A new endgame: what to think about first, over the board, then Start.
function open(l, intro) {
  L = l; mode = rec(l.id).learned ? 'try' : 'learn';
  history.replaceState(null, '', `#${l.id}`);
  $('#eg-tag').textContent = l.tag;
  $('#eg-title').textContent = l.title;
  $('#eg-plan').innerHTML = `<p>${l.intro}</p><ol class="eg-plan eg-plan-ex">${l.plan.map((p, i) => `<li tabindex="0" data-ex="${i}">${p}</li>`).join('')}</ol>`;
  renderList(); renderPath();
  if (!intro) return begin();
  $('#eg-intro').innerHTML = `<div class="depth-card eg-card"><p class="depth-k">Before you start · ${l.tag}</p><p class="depth-q">${l.title}</p>
    <p>${l.intro}</p><ol class="eg-plan">${l.plan.map((p) => `<li>${p}</li>`).join('')}</ol>
    <div class="eg-go"><button type="button" class="cta" data-start>Start</button></div></div>`;
  $('#eg-intro').hidden = false;
  game = new Chess(randomStart(l)); last = null; arrow = null; hint = []; draw();
  say('Read how to think about it, then press Start.');
  $('#eg-intro [data-start]').focus({ preventScroll: true });
}
$('#eg-intro').addEventListener('click', (e) => { if (e.target.closest('[data-start]')) { $('#eg-intro').hidden = true; begin(); } });

async function begin() {
  const g = ++gen;
  busy = true; over = false; misses = 0; assisted = false; sel = null; last = null; hint = []; arrow = null; wrong = null;
  elapsed = 0; ticking = 0; clearInterval(tickTimer); $('#tc-time').textContent = '0:00'; $('#trial-clock').classList.add('waiting');
  say('Setting up a position…');
  try {
    const fen = await newStart(L);
    if (g !== gen) return;
    game = new Chess(fen);
    info = await probe(fen);
    if (g !== gen) return;
    startPlies = dist(info);
  } catch (e) { if (g === gen) say(`${e.message} <button type="button" class="link" data-again>Try again</button>`, 'bad'); return; }
  busy = false;
  $('#eg-at').textContent = mode === 'learn' ? 'Learn' : mode === 'try' ? 'Practice' : 'Time challenge';
  yourTurn(true);
}
$('#message').addEventListener('click', (e) => { if (e.target.closest('[data-again]')) begin(); });
$('#restart').addEventListener('click', () => { if (!$('#eg-intro').hidden) $('#eg-intro').hidden = true; begin(); });

function yourTurn(first = false) {
  const best = info.moves[0];
  arrow = mode === 'learn' && best ? [best.uci.slice(0, 2), best.uci.slice(2, 4), '#15781B'] : null;
  showMate(info);
  draw();
  if (mode === 'time' && !first) startTick();
  if (first) say(mode === 'learn' ? `Mate in ${moves(dist(info))} with best play. Follow the arrow: it shows the quickest way.${best ? ` <span class="eg-why">${whyGood(new Chess(game.fen()).move(best.san))}</span>` : ''}`
    : mode === 'try' ? `Mate in ${moves(dist(info))} with best play. Win it from memory, without letting the win slip.`
    : `Mate as fast as you can. The clock starts on your first move; a slip ends the run.`);
}
function startTick() {
  if (ticking) return;
  ticking = performance.now();
  $('#trial-clock').classList.remove('waiting');
  clearInterval(tickTimer);
  tickTimer = setInterval(() => { $('#tc-time').textContent = clock(elapsed + performance.now() - ticking); }, 200);
}
function stopTick() {
  if (ticking) elapsed += performance.now() - ticking;
  ticking = 0; clearInterval(tickTimer);
  $('#tc-time').textContent = clock(elapsed);
}

// The squares their king can still reach: from where it stands, step by step over squares no white piece
// guards (the king itself lifted off, so a rook's line through it counts) and none stands on.
function box(fen) {
  const g = new Chess(fen), at = SQUARES.find((q) => { const p = g.get(q); return p && p.type === 'k' && p.color === 'b'; });
  g.remove(at);
  const seen = new Set([at]), todo = [at];
  while (todo.length) {
    const q = todo.pop();
    for (const n of SQUARES) if (!seen.has(n) && far(q, n) === 1 && !g.get(n) && !g.isAttacked(n, 'w')) { seen.add(n); todo.push(n); }
  }
  return seen.size;
}
const kingOf = (g, c) => SQUARES.find((q) => { const p = g.get(q); return p && p.type === 'k' && p.color === c; });
// Why a good move is good, in the words of the endgame's plan: what it does to their king's box,
// your king and your pieces. m is a chess.js move (with .before and .after).
function whyGood(m) {
  const b = new Chess(m.before), a = new Chess(m.after), bk = kingOf(a, 'b'), wk = kingOf(a, 'w');
  const was = box(m.before), now = box(m.after), left = `Their king has ${plural(now, 'square')} left.`;
  if (m.promotion) return 'The pawn becomes a queen. Now mate as in Queen and king: make a box and shrink it.';
  if (m.piece === 'p') return `The pawn steps forward${far(wk, m.to) === 1 ? ', guarded by your king' : ''}, safe from their king.`;
  if (m.piece === 'k') {
    const face = (wk[0] === bk[0] || wk[1] === bk[1]) && far(wk, bk) === 2;
    if (face) return `The kings face each other with one square between: the opposition. Their king must give way. ${left}`;
    if (far(wk, bk) < far(kingOf(b, 'w'), bk)) return `Your king walks up to help: ${plural(far(wk, bk), 'step')} from theirs now. ${now < was ? `It also takes squares: ${plural(now, 'square')} left.` : left}`;
    return `Your king takes the squares your pieces cannot. ${left}`;
  }
  if (far(m.from, kingOf(b, 'b')) === 1 && far(m.to, bk) > 1) return `Their king was next to your ${NAME[m.piece]}, so it steps far away and still holds its line. ${left}`;
  if (a.inCheck()) return `Check: their king is pushed back. ${now < was ? `The box shrinks from ${was} to ${now} squares.` : left}`;
  if (m.piece === 'q' && Math.abs(fi(m.to) - fi(bk)) * Math.abs(ri(m.to) - ri(bk)) === 2) return `The queen sits a knight's move from their king: a box it cannot leave. ${now < was ? `It shrinks from ${was} to ${now} squares.` : left}`;
  if (now < was) return `The box shrinks from ${was} to ${now} squares: their king has less room.`;
  if (m.piece === 'r') return `A waiting move: the rook keeps its line, and their king has to move, toward the facing position. ${left}`;
  return `This keeps their king shut in. ${left}`;
}

// Why a move let the win go, in words.
function whySlip(m) {
  if (game.isStalemate()) return 'That is stalemate: Black has no move and is not in check, so it is a draw. Always leave their king a square.';
  if (game.isInsufficientMaterial()) return 'Black can take your last piece that could mate, and then it is a draw.';
  const take = game.moves({ verbose: true }).find((x) => x.captured);
  if (take) return `That gives away your ${NAME[take.captured]}: Black takes it on ${take.to}, and then it is a draw.`;
  if (m.piece === 'p') return 'The pawn moved too soon: their king now stops it, and it is a draw.';
  return 'That lets the win slip: with best defence it is now a draw.';
}

async function tryMove(from, to) {
  if (busy || over) return false;
  const before = info, g = gen;
  let m;
  try { m = game.move({ from, to, promotion: 'q' }); } catch { return false; }
  if (mode === 'time' && !ticking && !elapsed) startTick();
  const tm = before.moves.find((x) => x.uci === m.from + m.to + (m.promotion || ''));
  const best = before.moves[0], wins = tm && (tm.category === 'loss' || tm.checkmate);
  // Learn wants the arrow's move or one as quick (a move later at most); every mode wants the win kept.
  const slow = wins && !tm.checkmate && dist(tm) > dist(best) + 2;
  if (!wins || (mode === 'learn' && slow)) {
    const why = wins ? `That still wins, but mate is ${plural(moves(dist(tm)) - moves(dist(best)), 'move')} further off. Follow the arrow: ${instruction(new Chess(m.before).move(best.san))}.` : whySlip(m);
    game.undo(); wrong = to; sel = null; draw(); shake(boardEl);
    if (mode === 'time') { stopTick(); over = true; say(`${why} The run is over: press New position to go again.`, 'bad'); return true; }
    if (!wins && mode === 'try') misses++;
    say(`${why}${mode === 'try' && !wins ? ' Try another move.' : ''}`, 'bad');
    setTimeout(() => { wrong = null; if (g === gen) draw(); }, 700);
    return true;
  }
  last = m; sel = null; hint = []; arrow = null;
  if (game.isCheckmate()) return finish(), true;
  busy = true; stopTick(); draw();
  const note = slow ? `Still winning, but mate is now in ${moves(dist(tm))} (it was ${moves(dist(best))}).` : mode === 'time' ? '' : `Good. ${whyGood(m)}`;
  try {
    const [r] = await Promise.all([probe(game.fen()), new Promise((x) => setTimeout(x, 350))]);
    if (g !== gen) return true;
    const reply = r.moves[0]; // the defence that holds out longest
    last = game.move({ from: reply.uci.slice(0, 2), to: reply.uci.slice(2, 4), promotion: reply.uci[4] });
    if (game.isDraw()) { over = true; draw(); banner('Draw · fifty moves', 'draw'); return say('Fifty moves without a capture or a pawn move: that is a draw. Press New position to try again.', 'bad'), true; }
    info = await probe(game.fen());
    if (g !== gen) return true;
  } catch (e) { busy = false; say(e.message, 'bad'); return true; }
  busy = false;
  yourTurn();
  const next = mode === 'learn' && info.moves[0] ? `<span class="eg-why"><b>Next:</b> ${whyGood(new Chess(game.fen()).move(info.moves[0].san))} Follow the arrow.</span>` : `Mate in ${moves(dist(info))}.`;
  if (mode !== 'time') say(`<span class="eg-why">${note}</span> <span class="eg-why">Black plays ${last.san}.</span> ${next}`, slow ? '' : 'good');
  return true;
}

function finish() {
  over = true; busy = false; arrow = null; stopTick(); showMate(null); draw();
  const r = rec(L.id), had = { green: !!r.learned, gold: r.box > 0, diamond: !!r.times?.length };
  window.track?.('endgame', `${L.id} ${mode}`);
  if (mode === 'learn') {
    r.learned = 1;
    say('Checkmate! Lesson learned. Press New position for another one, or go on to <b>Practice</b> to win it from memory.', 'good');
  } else if (mode === 'try') {
    r.learned = 1;
    if (!misses && !assisted) {
      r.box = Math.min(r.box + 1, INTERVALS.length - 1); r.due = Date.now() + INTERVALS[r.box] * DAY;
      say(`Checkmate with no slip: cleared. It comes back for review in ${plural(INTERVALS[r.box], 'day')}. Try the <b>Time challenge</b> next.`, 'good');
    } else {
      r.box = 0; r.due = Date.now();
      say(`Checkmate, but ${assisted ? 'with help' : `with ${plural(misses, 'slip')}`}, so it is not cleared yet. Press New position to try again.`, 'good');
    }
  } else {
    const was = bestOf(r);
    r.times = [...(r.times || []), Math.round(elapsed)].sort((a, b) => a - b).slice(0, 3);
    say(`Checkmate in ${clock(elapsed)}.${!was ? '' : elapsed < was ? ` A new best: it was ${clock(was)}.` : ` Your best is ${clock(was)}.`} Press New position to go again.`, 'good');
  }
  banner('Checkmate!'); confetti(mode === 'try' && (misses || assisted) ? 50 : 110);
  save(); renderList(); renderPath();
  // A star newly earned flies from the middle of the screen to its place in the list.
  const kind = mode === 'learn' ? 'green' : mode === 'try' ? 'gold' : 'diamond';
  if (!had[kind] && (kind !== 'gold' || r.box > 0)) flyStar($(`#items [data-id="${L.id}"] .line-star.${kind}`), kind);
}

// ---------- Input ----------
enableDrag(boardEl, {
  canDrag: (sq) => !busy && !over && game.get(sq)?.color === 'w',
  onDrop: (from, to) => { sel = null; tryMove(from, to).then((ok) => { if (!ok) draw(); }); },
});
boardEl.addEventListener('click', (e) => {
  const b = e.target.closest('.sq');
  if (!b || busy || over) return;
  const sq = b.dataset.sq, p = game.get(sq);
  if (sel && sel !== sq && game.moves({ square: sel, verbose: true }).some((m) => m.to === sq)) return void tryMove(sel, sq);
  sel = p && p.color === 'w' && sel !== sq ? sq : null;
  draw();
});
$('#hint').addEventListener('click', () => {
  if (busy || over || !info?.moves[0]) return;
  if (mode === 'try') assisted = true;
  hint = [info.moves[0].uci.slice(0, 2)]; draw();
  say(`The piece to move is highlighted.${mode === 'try' ? ' With help, this one will not count as cleared.' : ''}`);
});
$('#show').addEventListener('click', () => {
  if (busy || over || !info?.moves[0]) return;
  if (mode === 'try') assisted = true;
  const b = info.moves[0];
  arrow = [b.uci.slice(0, 2), b.uci.slice(2, 4), '#15781B']; draw();
  say(`The quickest move: ${instruction(new Chess(game.fen()).move(b.san))}.`);
});

// Opens the endgame in the address (#kq), else the first one due for review, else the first not cleared.
const firstUp = LESSONS.find((l) => l.id === location.hash.slice(1)) || LESSONS.find((l) => isDue(prog[l.id])) || LESSONS.find((l) => !(prog[l.id]?.box > 0)) || LESSONS[0];
open(firstUp, true);
