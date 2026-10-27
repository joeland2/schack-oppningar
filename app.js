import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard, enableDrag, shake } from './board.js';
import { STYLES, STYLE_OF } from './styles.js';

const STORE = 'opening-book-v2';
const MIN_SHARE = 0.05;   // an opponent reply must be played in at least 5% of games from that position
const MAX_LINES = 20;
const MIN_GAMES = 20;     // below this, real-game data is too thin to trust
const MAX_PLY = 20;       // data/explorer-*.json goes this deep
const BUCKETS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]; // Lichess explorer rating groups
// Rating groups whose moves count as yours: 2200+ in blitz; 2000+ in classical, where 2200+ games are scarce.
const STRONG = { blitz: [7, 8], classical: [6, 7, 8] };
const WANT = { w: 30, b: 15 };   // openings listed per colour
const POOL = 80;          // White openings collected, so a style filter still has enough to show
// White openings listed must occur in at least 1% of games at your level: rarer ones are often hard to reach
// or played mostly by specialists, so their score says little about what you would get.
const MIN_REACH = 0.01;
// First-move names that are not an opening plan of their own.
const GENERIC = new Set(["King's Pawn Game", "Queen's Pawn Game", "King's Knight Opening"]);

const $ = (s) => document.querySelector(s);
const boardEl = $('#board');
const listEl = $('#openings');
const msgEl = $('#message');
const movesEl = $('#moves');

let stats = load(STORE, {});    // { 'blitz:Italian Game': { done: [lineKey], total } }
// Progress saved before time controls existed was all blitz.
for (const k of Object.keys(stats)) if (!k.includes(':')) { stats[`blitz:${k}`] = stats[k]; delete stats[k]; }
let speed = load(STORE + '-speed', 'blitz');
const ratingKey = () => `${STORE}-${speed}-rating`;
const statKey = (id) => `${speed}:${id}`;
let rating = load(ratingKey(), null);
let style = load(STORE + '-style', 'any');
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
const pct = (x) => `${Math.round(x * 100)}%`;
const pctOf = (x) => (x < 0.01 ? '<1%' : pct(x));
// Win / draw / loss bar from the player's side.
function wdl(o, side) {
  const win = side === 'w' ? o.win : 1 - o.win - o.draw, loss = 1 - win - o.draw;
  return `<div class="wdl" role="img" aria-label="You win ${pct(win)}, draw ${pct(o.draw)}, lose ${pct(loss)}">
      <span class="w" style="width:${win * 100}%"></span><span class="d" style="width:${o.draw * 100}%"></span><span class="l" style="width:${loss * 100}%"></span>
    </div>
    <p class="wdl-key"><span>Win <b>${pct(win)}</b></span><span>Draw ${pct(o.draw)}</span><span>Loss ${pct(loss)}</span></p>`;
}

const numbered = (moves) => moves.split(' ').map((m, i) => (i % 2 ? m : `${i / 2 + 1}.${m}`)).join(' ');

// Indexes of the rating groups overlapping rating ± 200.
function ratingsAround(r) {
  return BUCKETS.flatMap((b, i) => (b <= r + 200 && (BUCKETS[i + 1] ?? Infinity) > r - 200 ? [i] : []));
}
console.assert(ratingsAround(1500).join() === '2,3,4' && ratingsAround(2400).join() === '7,8', 'ratingsAround');

// ---------- Data (all local, nothing is fetched from Lichess) ----------
let TREE, BOOK, NAMES, IN_BOOK;
const TREES = {};
const POPULAR = {};   // popularOpenings() per time control and rating; it takes a moment to compute

// data/explorer-<speed>.json: move counts per rating group from Lichess games of that time control,
// built by tools/make_explorer.py. Loaded once per time control.
async function loadTree() {
  TREES[speed] ??= (await fetch(`data/explorer-${speed}.json`).then((r) => r.json())).tree;
  TREE = TREES[speed];
  console.assert(explore(['e4'], [3]).moves.some((m) => m.san === 'c5'), `data/explorer-${speed}.json is not in the expected format`);
}

// data/*.tsv: named opening lines from github.com/lichess-org/chess-openings (CC0): eco, name, pgn.
async function loadBook() {
  const texts = await Promise.all([...'abcde'].map((f) => fetch(`data/${f}.tsv`).then((r) => r.text())));
  BOOK = texts.flatMap((t) => t.trim().split('\n').slice(1)).map((row) => {
    const [eco, name, pgn] = row.split('\t');
    return { eco, name, moves: pgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/).map(clean) };
  });
  NAMES = new Map(BOOK.map((l) => [lineKey(l.moves), l]));
  IN_BOOK = new Set(BOOK.flatMap((l) => l.moves.map((_, i) => lineKey(l.moves.slice(0, i + 1)))));
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
// A tree node is [games, White wins, draws (each per rating group), {san: child}].
// win and draw are White's shares; score is White's share of the points (a draw is half a point).
function explore(moves, groups) {
  let node = TREE;
  for (const m of moves) {
    node = node[3]?.[m];
    if (!node) return { total: 0, moves: [] };
  }
  const sum = (c) => groups.reduce((s, i) => s + c[i], 0);
  const replies = Object.entries(node[3] || {}).map(([san, child]) => {
    const named = NAMES.get(lineKey([...moves, san]));
    const n = sum(child[0]), win = sum(child[1]) / n, draw = sum(child[2]) / n;
    return { san, n, win, draw, score: win + draw / 2, eco: named?.eco, name: named?.name };
  });
  return { total: sum(node[0]), moves: replies.filter((m) => m.n > 0).sort((a, b) => b.n - a.n) };
}

// Your move: what strong players play most here, preferring moves from this opening's book.
// The strongest players with enough games here: 2200+ in blitz (2000+ in classical), stepping down
// one rating group at a time where they are too few, but never below your own level.
function strongGroups(moves) {
  let groups = STRONG[speed];
  for (;;) {
    const x = explore(moves, groups);
    const next = groups[0] - 1;
    if (x.moves.some((m) => m.n >= MIN_GAMES) || next < 0 || BUCKETS[next] < rating) return { groups, x };
    groups = [next, ...groups];
  }
}

function userMove(moves, book) {
  const strong = strongGroups(moves).x.moves.filter((m) => m.n >= MIN_GAMES);
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

// The most played White openings at your level, found by walking real games from the start position,
// most common positions first. An opening is White's when White's move first gives it its name.
function popularOpenings() {
  const mine = ratingsAround(rating);
  const found = new Map();
  const named = new Set(); // every family seen so far; the first sighting decides whose opening it is
  const open = [{ moves: [], share: 1 }];
  while (open.length && found.size < POOL) {
    open.sort((a, b) => b.share - a.share);
    const p = open.shift();
    const x = explore(p.moves, mine);
    for (const m of x.moves) {
      const share = p.share * m.n / x.total;
      if (share < 0.0005 || m.n < MIN_GAMES) continue;
      const moves = [...p.moves, m.san];
      const family = m.name && familyOf(m.name);
      if (family && !named.has(family)) {
        named.add(family);
        if (moves.length % 2) found.set(family, { id: family, name: shortName(family), family, eco: m.eco, side: 'w', root: moves.join(' '), share, win: m.win, draw: m.draw, score: m.score });
      }
      open.push({ moves, share });
    }
  }
  const white = [...found.values()].sort((a, b) => b.share - a.share);
  // As Black you face White's openings: the same ones, practised from the other side.
  const meet = white.slice(0, WANT.b).map((o) => ({ ...o, id: `vs:${o.family}`, side: 'b' }));
  return [...white, ...meet];
}

// "Queen's Pawn Game: London System" → "London System", but "Queen's Pawn Game: Chigorin Variation" stays whole.
const shortName = (family) => (/Variation$/.test(family) ? family : family.split(': ').at(-1));

// "Sicilian Defense: Najdorf Variation" → "Sicilian Defense". Generic first-move names keep their
// variation instead ("Queen's Pawn Game: London System"), or are skipped when they have none.
function familyOf(name) {
  const head = name.split(':')[0];
  if (!GENERIC.has(head)) return head;
  const sub = name.split(',')[0];
  return sub === head ? null : sub;
}
console.assert(familyOf("Queen's Pawn Game: London System, with e6") === "Queen's Pawn Game: London System" && familyOf("Queen's Pawn Game") === null, 'familyOf');

const fitsStyle = (o) => style === 'any' || (STYLE_OF[o.family] || []).includes(style);

// The openings shown. White: the best-scoring common ones that fit your style.
// Black: the White openings you meet most often, whatever your style.
function shown() {
  const white = OPENINGS.filter((o) => o.side === 'w' && o.share >= MIN_REACH && fitsStyle(o))
    .sort((a, b) => b.score - a.score).slice(0, WANT.w);
  return [...white, ...OPENINGS.filter((o) => o.side === 'b')];
}

// ---------- Opening list ----------
function renderList() {
  const groups = [
    ['w', 'You play White', 'Best results first (a draw counts as half a win), from real games at your level. Openings reached in under 1% of games are left out.'],
    ['b', 'You play Black', 'The White openings you meet most often at your level, with how Black does against them.'],
  ];
  const list = shown();
  listEl.innerHTML = groups.map(([side, label, about]) => {
    const ops = list.filter((o) => o.side === side);
    const empty = `<p class="info">No common ${style === 'any' ? '' : STYLES[style].label.toLowerCase() + ' '}openings for White at your level. Try another style.</p>`;
    return `<section class="og"><h2>${label}</h2><p class="og-about">${about}</p>${ops.length ? '' : empty}<div class="ocards">${ops.map((o) => {
      const s = stats[statKey(o.id)] || { done: [], total: 0 };
      const level = s.total && s.done.length >= s.total ? 'sitter' : s.done.length ? 'pagar' : 'ny';
      const levelTxt = { sitter: 'Learned', pagar: `${s.done.length}/${s.total} lines`, ny: 'New' }[level];
      const moves = numbered(o.root).split(' ');
      const tags = (STYLE_OF[o.family] || []).map((t) => `<span class="tag">${STYLES[t].label}</span>`).join('');
      return `<article class="ocard" role="button" tabindex="0" data-id="${o.id}" aria-label="${o.name}">
        <div class="board mini" data-mini="${o.id}" inert></div>
        <div class="ocard-body">
          <div class="ocard-top"><span class="eco">${o.eco}</span><span class="chip ${level}">${levelTxt}</span></div>
          <h3>${side === 'b' ? 'vs ' : ''}${o.name}</h3>
          <p class="omoves">${moves.slice(0, -1).join(' ')} <b>${moves.at(-1)}</b></p>
          ${tags ? `<p class="tags">${tags}</p>` : ''}
          <p class="played">${side === 'w' ? 'Played' : 'You meet it'} in <b>${pctOf(o.share)}</b> of games</p>
          ${wdl(o, side)}
        </div>
      </article>`;
    }).join('')}</div></section>`;
  }).join('');
  seen.disconnect();
  listEl.querySelectorAll('.ocard').forEach((c) => {
    const op = list.find((o) => o.id === c.dataset.id);
    const go = () => start(op);
    previewAt(c, op.root.split(' ').length);
    if (!REDUCE_MOTION) {
      seen.observe(c);
      c.addEventListener('mouseenter', () => playPreview(c));
      c.addEventListener('focus', () => playPreview(c));
    }
    c.addEventListener('click', go);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

// ---------- Animated previews ----------
const REDUCE_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Plays each card's preview the first time it is mostly on screen.
const seen = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (!e.isIntersecting) return;
  seen.unobserve(e.target);
  playPreview(e.target);
}), { threshold: 0.6 });

// Draws a card's mini board after its first n moves.
function previewAt(card, n) {
  const op = OPENINGS.find((o) => o.id === card.dataset.id);
  const g = new Chess();
  op.root.split(' ').slice(0, n).forEach((m) => g.move(m));
  drawBoard(card.querySelector('.mini'), g, { side: op.side, last: g.history({ verbose: true }).at(-1) });
}

// Plays the opening move by move from the start position; a newer run on the same card cancels the old one.
function playPreview(card) {
  const total = OPENINGS.find((o) => o.id === card.dataset.id).root.split(' ').length;
  const run = String(Number(card.dataset.run || 0) + 1);
  card.dataset.run = run;
  let n = 0;
  const step = () => {
    if (card.dataset.run !== run || !card.isConnected) return;
    previewAt(card, n);
    if (n++ < total) setTimeout(step, n === 1 ? 350 : 600);
  };
  step();
}

// ---------- Your own games ----------
// The one live call: your public games from Lichess, fetched only when you ask. No login needed.
// A slip: a move outside every named opening line that strong players choose in under 5% of their games.
// Rare but named moves (2.f4, the King's Gambit) are a choice of opening, not a slip.
const RARE = 0.05;
const JUDGE_GAMES = 100;  // strong-player games a position needs before we judge a move there

async function fetchGames(name) {
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(name)}?` + new URLSearchParams({
    max: 100, rated: 'true', perfType: speed, moves: 'true', opening: 'true', clocks: 'false', evals: 'false',
  }), { headers: { Accept: 'application/x-ndjson' } });
  if (res.status === 404) throw new Error(`Lichess has no player called ${name}.`);
  if (res.status === 429) throw new Error('Lichess is busy right now. Try again in a minute.');
  if (!res.ok) throw new Error(`Lichess answered with an error (${res.status}).`);
  return (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// For each game: the first of your moves that strong players rarely play, plus your score per opening.
function analyse(games, name) {
  const me = name.toLowerCase();
  const slips = new Map();
  const openings = new Map();
  let counted = 0;
  for (const g of games) {
    const side = g.players.white.user?.id === me ? 'w' : g.players.black.user?.id === me ? 'b' : null;
    if (!side || !g.moves) continue;
    counted++;
    const points = !g.winner ? 0.5 : g.winner === (side === 'w' ? 'white' : 'black') ? 1 : 0;
    const family = g.opening?.name && familyOf(g.opening.name);
    if (family) {
      const o = openings.get(`${side}:${family}`) ?? { family, side, games: 0, points: 0 };
      o.games++; o.points += points;
      openings.set(`${side}:${family}`, o);
    }
    const moves = g.moves.split(' ').map(clean).slice(0, MAX_PLY);
    for (let i = side === 'w' ? 0 : 1; i < moves.length; i += 2) {
      const before = moves.slice(0, i);
      const strong = explore(before, STRONG[speed]);
      if (strong.total < JUDGE_GAMES) break; // past what the data can judge
      const mine = strong.moves.find((m) => m.san === moves[i]);
      const key = lineKey([...before, moves[i]]);
      if ((mine && mine.n / strong.total >= RARE) || IN_BOOK.has(key)) continue;
      const slip = slips.get(key) ?? { before, side, family, played: moves[i], playedShare: (mine?.n ?? 0) / strong.total,
        best: strong.moves[0].san, bestShare: strong.moves[0].n / strong.total, games: 0, points: 0 };
      slip.games++; slip.points += points;
      slips.set(key, slip);
      break;
    }
  }
  return {
    counted,
    slips: [...slips.values()].sort((a, b) => b.games - a.games || a.points - b.points).slice(0, 6),
    openings: [...openings.values()].sort((a, b) => b.games - a.games).slice(0, 8),
  };
}
console.assert(analyse([], 'x').counted === 0, 'analyse');


function renderMine({ counted, slips, openings }, name) {
  const out = $('#mine-out');
  if (!counted) {
    out.innerHTML = '';
    return ($('#mine-msg').textContent = `No rated ${speed} games found for ${name}.`);
  }
  $('#mine-msg').textContent = `Checked your last ${counted} rated ${speed} games against what players rated ${speed === 'blitz' ? '2200' : '2000'}+ play.`;
  out.innerHTML = `
    <h3 class="mine-h">Where you go off track</h3>
    ${slips.length ? '' : '<p class="info">No repeated slips: in every position we could judge, you played a move strong players also choose.</p>'}
    <div class="slips">${slips.map((s, n) => {
      const moves = numbered(lineKey([...s.before, s.played])).split(' ');
      const bestMoves = numbered(lineKey([...s.before, s.best])).split(' ');
      return `<article class="slip">
        <div class="board mini" data-slip="${n}" inert></div>
        <div class="slip-body">
          <p class="slip-count">${s.games} game${s.games === 1 ? '' : 's'} · you scored ${pct(s.points / s.games)}</p>
          <p class="omoves">${moves.slice(0, -1).join(' ')} <b class="bad">${moves.at(-1)}</b></p>
          <p>Players rated ${speed === 'blitz' ? '2200' : '2000'}+ play <b>${bestMoves.at(-1)}</b> here (${pct(s.bestShare)} of their games) and ${s.played} in ${s.playedShare ? pct(s.playedShare) : 'none'}.</p>
          ${OPENINGS.some((o) => o.family === s.family && o.side === s.side) ? `<button type="button" class="cta" data-practise="${n}">Practise ${shortName(s.family)}</button>` : ''}
        </div>
      </article>`;
    }).join('')}</div>
    <h3 class="mine-h">Your openings</h3>
    <ul class="mine-ops">${openings.map((o) => `<li><span>${shortName(o.family)} <small>as ${o.side === 'w' ? 'White' : 'Black'}</small></span><span>${o.games} games · ${pct(o.points / o.games)}</span></li>`).join('')}</ul>`;
  slips.forEach((s, n) => {
    const g = new Chess();
    s.before.forEach((m) => g.move(m));
    const best = new Chess(g.fen()).move(s.best);
    drawBoard(out.querySelector(`[data-slip="${n}"]`), g, { side: s.side, last: g.history({ verbose: true }).at(-1), arrow: [best.from, best.to] });
  });
  out.querySelectorAll('[data-practise]').forEach((b) => b.addEventListener('click', () => {
    const s = slips[Number(b.dataset.practise)];
    start(OPENINGS.find((o) => o.family === s.family && o.side === s.side));
    const want = lineKey([...s.before, s.best]);
    const i = lines.findIndex((l) => lineKey(l.moves).startsWith(want));
    if (i >= 0) play(i);
  }));
}

$('#mine-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#mine-name').value.trim();
  store(STORE + '-lichess-name', name);
  $('#mine-msg').textContent = `Fetching ${name}'s last 100 rated ${speed} games from Lichess…`;
  $('#mine-out').innerHTML = '';
  try {
    await loadTree();
    renderMine(analyse(await fetchGames(name), name), name);
  } catch (err) {
    $('#mine-msg').textContent = err.message;
  }
});
$('#mine-name').value = load(STORE + '-lichess-name', '');

// ---------- Board ----------
function renderBoard() {
  drawBoard(boardEl, game, { side: cur.side, sel, last: lastMove, hint: hintSq, wrong: wrongSq, arrow: hintSq.length === 2 ? hintSq : null });
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

function render() { renderBoard(); renderMoves(); renderWhy(); }

// ---------- Move explanations ----------
const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// What a move does, read off the board: development, centre, captures, checks, attacks.
function idea(before, san) {
  const g = new Chess();
  before.forEach((x) => g.move(x));
  return ideaAt(g, san);
}

// Same, from a position (a Chess game) rather than a move list. Plays the move on g.
function ideaAt(g, san) {
  const prev = g.history({ verbose: true }).at(-1);
  const m = g.move(san);
  const out = [];
  if (m.flags.includes('k') || m.flags.includes('q')) out.push('Castles: the king gets to safety and the rook comes into play');
  else {
    if (m.captured) out.push(`${prev && prev.to === m.to ? 'Takes back' : 'Takes'} the ${PIECE[m.captured]} on ${m.to}`);
    if ('nb'.includes(m.piece) && m.from[1] === (m.color === 'w' ? '1' : '8')) out.push(`Develops the ${PIECE[m.piece]}`);
    if (m.piece === 'p' && !m.captured && 'de'.includes(m.to[0])) out.push('Claims the centre');
    else if (m.piece === 'p' && !m.captured && 'cf'.includes(m.to[0])) out.push('Fights for the centre from the side');
    if (m.piece === 'q' && g.history().length < 12) out.push('Brings the queen out early');
  }
  if (g.inCheck()) out.push('Gives check');
  // Pieces the moved piece now hits: look at its moves as if it could move again.
  const fen = g.fen().split(' ');
  fen[1] = m.color; fen[3] = '-';
  try {
    const hits = new Chess(fen.join(' ')).moves({ square: m.to, verbose: true })
      // pawns only count in the centre, where hitting them matters early on
      .filter((x) => x.captured && x.captured !== 'k' && (x.captured !== 'p' || /^[de][45]$/.test(x.to)))
      .map((x) => `${PIECE[x.captured]} on ${x.to}`);
    if (hits.length) out.push(`Attacks the ${hits.join(' and the ')}`);
  } catch {}
  return out.length ? out.join('. ') + '.' : '';
}
console.assert(idea(['e4', 'e5'], 'Nf3') === 'Develops the knight. Attacks the pawn on e5.', 'idea');

// The idea plus what real games say: how often the move is chosen here, and how you do after it.
function why(before, san) {
  const yours = (before.length % 2 === 0) === (cur.side === 'w');
  const mine = ratingsAround(rating);
  const strong = yours && strongGroups(before);
  const pick = yours ? strong.x : explore(before, mine);
  const chosen = pick.moves.find((x) => x.san === san);
  const after = explore(before, mine).moves.find((x) => x.san === san);
  const stat = chosen ? (yours
    ? ` Players rated ${BUCKETS[strong.groups[0]]}+ choose it here in ${pct(chosen.n / pick.total)} of games.`
    : ` At your level, ${pct(chosen.n / pick.total)} of players choose it here.`) : '';
  const res = after ? ` You win ${pct(cur.side === 'w' ? after.win : 1 - after.win - after.draw)} of games after it.` : '';
  return (idea(before, san) + stat + res).trim();
}

function renderWhy() {
  const el = $('#why');
  if (!cur || !line.length) return (el.innerHTML = '');
  const hist = game.history();
  const label = (n, san) => `${Math.floor(n / 2) + 1}.${n % 2 ? '..' : ''}${san}`;
  const parts = [];
  if (hist.length) {
    const n = hist.length - 1;
    const who = (n % 2 === 0) === (cur.side === 'w') ? 'You played' : `${n % 2 ? 'Black' : 'White'} played`;
    parts.push(`<p><b>${who} ${label(n, hist[n])}</b> ${why(hist.slice(0, n).map(clean), clean(hist[n]))}</p>`);
  }
  if (mode === 'learn' && userTurn() && inLine()) {
    parts.push(`<p><b>Your move: ${label(ply, line[ply])}</b> ${why(line.slice(0, ply), line[ply])}</p>`);
  }
  el.innerHTML = parts.join('');
}

// ---------- Game ----------
function start(op) {
  cur = op;
  line = []; lines = []; game = new Chess();
  ply = 0; sel = null; hintSq = []; wrongSq = null; lastMove = null;
  misses = 0; missesHere = 0; busy = true;
  $('#op-title').textContent = (op.side === 'b' ? 'vs ' : '') + op.name;
  $('#op-eco').textContent = op.eco;
  $('#op-info').textContent = `Starts ${numbered(op.root)}. ${op.side === 'b' ? `You meet it in ${pctOf(op.share)} of ${speed} games at your level; Black wins ${pct(1 - op.win - op.draw)}.` : `Played in ${pctOf(op.share)} of ${speed} games at your level; White wins ${pct(op.win)}.`}`;
  $('#op-var').textContent = '';
  $('#op-side').textContent = op.side === 'w' ? 'You play White' : 'You play Black';
  $('#restart').textContent = 'Restart';
  $('#picker').hidden = true;
  $('#trainer').hidden = false;
  render();
  if (!rating) return say(`Enter your Lichess ${speed} rating at the top.`);
  lines = buildLines(op);
  if (!lines.length) return say('Not enough games at your rating for this opening.', 'bad');
  const s = stats[statKey(op.id)] = { done: [], ...stats[statKey(op.id)], total: lines.length };
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
  failedNow = false;
  won = false;
  lastEval = null;
  $('#op-var').textContent = `Line ${i + 1} of ${lines.length} · ${l.share < 0.01 ? '<1' : Math.round(l.share * 100)}% of games at ${rating} ± 200${l.name ? ' · ' + l.name : ''}`;
  $('#restart').textContent = 'Restart';
  render();
  if (userTurn()) prompt('Your move. Play the first move.');
  else { say('Your opponent starts…'); reply(); }
}

let failedNow = false; // Try: this play-on game already fell clearly behind and failed the line
let won = false;       // you checkmated Stockfish in this game
let lastEval = null;    // Stockfish's evaluation after its last move, from its side, in centipawns
const userTurn = () => line.length > 0 && !game.isGameOver() && game.turn() === cur.side;
const inLine = () => ply < line.length;

// ---------- Stockfish ----------
// Same-origin rule for workers: load the CDN script through a blob worker.
const ENGINE_SRC = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';
let engine = null;
let engineGen = 0;
let searching = false;
let skipBest = 0;      // bestmoves still owed by searches that were stopped early
// shortcut: Skill Level 0–20 mapped linearly from rating, rough at best; upgrade to UCI_Elo with Stockfish 11+.
const skill = () => Math.max(0, Math.min(20, Math.round((rating - 800) / 85)));
// When Stockfish is this far ahead (in centipawns, 100 = a pawn), a Try line fails; you still play on to mate.
const LOST = 300;
// A move of yours that gives away this much is taken back, and you get help to find a better one.
const BLUNDER = 150;
const toCp = (s) => ('mate' in s ? Math.sign(s.mate || 1) * 10000 : s.cp);
const uciMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
const pawns = (cp) => (Math.min(cp, 2000) / 100).toFixed(1);
const sideName = (c) => (c === 'w' ? 'White' : 'Black');

// One Stockfish search. Resolves { uci, score } (score from the side to move), or null if something newer
// (another search, a restart, leaving the board) came first.
function think(fen, { ms = 600, level = 20 } = {}) {
  engine ??= new Worker(URL.createObjectURL(new Blob([`importScripts('${ENGINE_SRC}')`], { type: 'text/javascript' })));
  const gen = ++engineGen;
  if (searching) { engine.postMessage('stop'); skipBest++; }
  searching = true;
  return new Promise((resolve) => {
    let score = null;
    engine.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      if (e.data.startsWith('bestmove') && skipBest) { skipBest--; return; }
      const sc = e.data.match(/ score (cp|mate) (-?\d+)/);
      if (sc) score = { [sc[1]]: Number(sc[2]) };
      if (!e.data.startsWith('bestmove')) return;
      searching = false;
      resolve(gen === engineGen ? { uci: e.data.split(' ')[1], score } : null);
    };
    engine.postMessage(`setoption name Skill Level value ${level}`);
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(`go movetime ${ms}`);
  });
}

// ---------- Play on vs Stockfish after the line ----------
async function engineMove() {
  busy = true;
  const r = await think(game.fen(), { level: skill() });
  if (!r) return;
  const now = r.score && toCp(r.score);
  if (r.score && lastEval !== null && now - lastEval >= BLUNDER) return takeBack(now - lastEval, r.uci);
  if (r.score) lastEval = now;
  lastMove = game.move(uciMove(r.uci));
  ply++; busy = false; hintSq = [];
  render();
  if (gameOver()) return;
  if (mode === 'try' && !failedNow && r.score && (r.score.mate > 0 || r.score.cp >= LOST)) return failLine(r.score);
  say('Your move.');
  suggest();
}

// Learn, after the line: show Stockfish's best move for you, all the way to checkmate.
// Show move does the same in Try (and counts as a mistake).
async function suggest(asked = false) {
  if ((mode !== 'learn' && !asked) || !userTurn() || inLine()) return;
  const at = game.fen();
  const r = await think(at, { ms: 500 });
  if (!r || game.fen() !== at) return;
  const best = new Chess(at).move(uciMove(r.uci));
  const bestIdea = ideaAt(new Chess(at), best.san);
  hintSq = [best.from, best.to];
  renderBoard();
  say(`Play ${best.san}.${bestIdea ? ' ' + bestIdea : ''}${r.score?.mate > 0 ? ` Mate in ${r.score.mate}.` : ''}`);
}

// Your last move gave away a lot: explain Stockfish's answer to it, take it back, and help.
async function takeBack(loss, refutation) {
  const bad = game.history().at(-1);
  const after = new Chess(game.fen());
  const reply = after.move(uciMove(refutation)).san;
  const replyIdea = ideaAt(new Chess(game.fen()), reply);
  game.undo();
  ply--;
  lastMove = game.history({ verbose: true }).at(-1) || null;
  render();
  const opp = sideName(cur.side === 'w' ? 'b' : 'w');
  const why = `${bad} gives away about ${pawns(loss)} pawns: ${opp} answers ${reply}.${replyIdea ? ' ' + replyIdea : ''} The move was taken back.`;
  say(`${why} Looking for a better move…`, 'bad');
  const r = await think(game.fen(), { ms: 500 });
  if (!r) return;
  const best = new Chess(game.fen()).move(uciMove(r.uci));
  busy = false;
  if (mode === 'learn') {
    hintSq = [best.from, best.to];
    const bestIdea = ideaAt(new Chess(game.fen()), best.san);
    say(`${why} Stockfish suggests ${best.san}.${bestIdea ? ' ' + bestIdea : ''}`, 'bad');
  } else {
    misses++;
    hintSq = [best.from];
    say(`${why} Find a better move: the piece to move is highlighted.`, 'bad');
  }
  renderBoard();
}

// Try: Stockfish is clearly winning, so the line fails. The game goes on to checkmate.
function failLine(score) {
  failedNow = true;
  misses++; // so Restart replays this line instead of moving on
  const s = stats[statKey(cur.id)];
  s.done = s.done.filter((k) => k !== lineKey(line));
  store(STORE, stats);
  $('#restart').textContent = 'Restart';
  const how = 'mate' in score ? `has mate in ${score.mate}` : `is ${pawns(score.cp)} pawns ahead`;
  say(`Stockfish ${how}, so this line counts as failed. Play on to checkmate, or press Restart to try the line again.`, 'bad');
}

// A move that is not the line's: say whether strong players play it too, and what Stockfish answers.
async function explainWrong(san) {
  const before = line.slice(0, ply);
  const at = game.fen();
  const strong = strongGroups(before);
  const alt = strong.x.moves.find((x) => x.san === clean(san));
  const parts = [];
  if (alt && alt.n / strong.x.total >= RARE) {
    parts.push(`${san} is a real option: players rated ${BUCKETS[strong.groups[0]]}+ choose it here in ${pct(alt.n / strong.x.total)} of games, but this line practises another move.`);
  }
  const g = new Chess(at);
  g.move(san);
  const r = await think(g.fen(), { ms: 400 });
  if (!r || game.fen() !== at) return; // you have moved on meanwhile
  const opp = sideName(cur.side === 'w' ? 'b' : 'w');
  const cp = r.score ? toCp(r.score) : 0;
  if (cp >= 100) {
    const reply = new Chess(g.fen()).move(uciMove(r.uci)).san;
    const replyIdea = ideaAt(new Chess(g.fen()), reply);
    parts.push(`After ${san}, ${opp} answers ${reply}.${replyIdea ? ' ' + replyIdea : ''} Stockfish puts you about ${pawns(cp)} pawns behind.`);
  } else if (!parts.length) {
    parts.push(`Stockfish finds ${san} playable, but strong players rarely choose it here.`);
  }
  const want = expectedMove();
  if (mode === 'learn') {
    const wantIdea = idea(before, want.san);
    parts.push(`The line plays ${want.san}.${wantIdea ? ' ' + wantIdea : ''}`);
  } else if (missesHere >= 2) parts.push('The piece to move is highlighted.');
  else parts.push('Try again.');
  say(`${san} is not the move here. ${parts.join(' ')}`, 'bad');
}

function gameOver() {
  if (!game.isGameOver()) return false;
  if (!game.isCheckmate()) say('Draw. Press Restart to try the line again.');
  else if (game.turn() === cur.side) say('Checkmate: Stockfish wins this one. Press Restart to try the line again.', 'bad');
  else wonLine();
  return true;
}

// You checkmated Stockfish. In Try the line is cleared if you made no mistakes on the way.
function wonLine() {
  won = true;
  const s = stats[statKey(cur.id)];
  if (mode === 'try' && misses === 0 && !s.done.includes(lineKey(line))) s.done.push(lineKey(line));
  store(STORE, stats);
  const left = lines.findIndex((l) => !s.done.includes(lineKey(l.moves)));
  $('#restart').textContent = mode === 'try' && misses ? 'Restart' : 'Next line';
  if (mode === 'learn') return say('Checkmate! Press Next line for the next most common line, or switch to Try.', 'good');
  if (misses) return say(`Checkmate! But with ${misses} mistake${misses === 1 ? '' : 's'} the line is not cleared yet. Press Restart to try again.`, 'good');
  say(left === -1 ? 'Checkmate! Every common line at your level is cleared.'
    : `Checkmate! Line cleared: ${s.done.length} of ${lines.length}. Press Next line for the next most common one.`, 'good');
}

function reply() {
  busy = true;
  const gen = engineGen; // play() bumps it, so a reply meant for an earlier game is dropped
  setTimeout(() => {
    if (gen !== engineGen) return;
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
    if (missesHere >= 2) showHint();
    say(`${m.san} is not the move here. Looking at why…`, 'bad');
    explainWrong(m.san);
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
  if (gameOver()) return;
  if (mode === 'learn') {
    $('#restart').textContent = 'Next line';
    say('Opening done. Keep following the moves to checkmate.', 'good');
  }
  else if (misses) say(`Opening done with ${misses} mistake${misses === 1 ? '' : 's'}. Play on to checkmate, or press Restart to try again.`);
  else say('Opening played without mistakes. Now checkmate Stockfish to clear the line. Fall 3 pawns behind and it fails.', 'good');
  if (game.turn() !== cur.side) engineMove(); else suggest();
}

enableDrag(boardEl, {
  canDrag: (sq) => !busy && userTurn() && game.get(sq)?.color === cur.side,
  onDrop: (from, to) => { sel = null; if (!tryMove(from, to)) renderBoard(); },
});
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
  const next = lines.findIndex((l) => !stats[statKey(cur.id)].done.includes(lineKey(l.moves)));
  play(won && misses === 0 && next !== -1 ? next : lineIdx);
});
$('#hint').addEventListener('click', () => { if (userTurn() && inLine()) { showHint(); say('The piece to move is highlighted.'); } });
$('#show').addEventListener('click', () => {
  if (userTurn() && !inLine() && !busy) { if (mode === 'try') misses++; return suggest(true); }
  if (!userTurn() || !inLine()) return;
  const m = expectedMove();
  misses++;
  say(`The move is ${m.san}.`);
  hintSq = [m.from, m.to]; renderBoard();
});
// Opening picker, shown before the board.
async function showPicker() {
  cur = null; engineGen++; // stops a Stockfish reply that is still on its way
  $('#trainer').hidden = true;
  $('#picker').hidden = false;
  listEl.innerHTML = '';
  renderChoices();
  $('#rating-form').hidden = !!rating;
  if (!rating) return ($('#pick-msg').textContent = 'The openings you see depend on what players at your level actually play.');
  $('#pick-msg').textContent = `Loading ${speed} games…`;
  try { await loadTree(); } catch { return say('Could not load the opening data. Serve the folder over HTTP, e.g. npx serve .'); }
  OPENINGS = POPULAR[`${speed}:${rating}`] ??= popularOpenings();
  $('#pick-msg').textContent = `Real ${speed} games at ${rating} ± 200${style === 'any' ? '' : `, ${STYLES[style].label.toLowerCase()} White openings only`}. Pick one to practise.`;
  renderList();
}

// Time control and style switches, plus the rating labels that depend on the time control.
function renderChoices() {
  document.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.speed === speed));
  document.querySelectorAll('[data-style]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.style === style));
  $('#style-about').textContent = style === 'any' ? 'All common openings, whatever their character.' : STYLES[style].about;
  document.querySelectorAll('.speed-name').forEach((el) => (el.textContent = speed));
  $('#rating').value = rating || '';
}
document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
  speed = b.dataset.speed;
  store(STORE + '-speed', speed);
  rating = load(ratingKey(), null);
  showPicker();
}));
document.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => {
  style = b.dataset.style;
  store(STORE + '-style', style);
  renderChoices();
  if (OPENINGS.length) renderList();
}));
$('#back').addEventListener('click', showPicker);
$('#weakest').addEventListener('click', () => {
  const list = shown();
  if (!list.length) return;
  const score = (o) => { const s = stats[statKey(o.id)]; return s && s.total ? s.done.length / s.total : 0; };
  start([...list].sort((a, b) => score(a) - score(b))[0]);
});
function setMode(m) {
  mode = m;
  store(STORE + '-mode', m);
  $('#mode-learn').setAttribute('aria-pressed', m === 'learn');
  $('#mode-try').setAttribute('aria-pressed', m === 'try');
  $('#mode-about').textContent = m === 'learn'
    ? 'Every move is shown and explained. Nothing is scored.'
    : 'Find the moves yourself. A line clears when you play it without mistakes.';
  if (lines.length) play(lineIdx);
}
$('#mode-learn').addEventListener('click', () => setMode('learn'));
$('#mode-try').addEventListener('click', () => setMode('try'));
function setRating(r) {
  rating = r >= 400 && r <= 3200 ? Math.round(r) : null;
  store(ratingKey(), rating);
  showPicker();
}
$('#rating').addEventListener('change', (e) => setRating(Number(e.target.value)));
$('#rating-form').addEventListener('submit', (e) => { e.preventDefault(); setRating(Number($('#rating-big').value)); });
document.querySelectorAll('#rating-form .pill').forEach((b) => b.addEventListener('click', () => setRating(Number(b.dataset.r))));

try { await loadBook(); } catch {
  say('Could not load the opening data. Serve the folder over HTTP, e.g. npx serve .', 'bad');
  throw new Error('opening data failed to load');
}
// Left over from when the page logged in to Lichess and cached its API answers.
try { for (const k of Object.keys(localStorage)) if (k === STORE + '-token' || k.startsWith(STORE + '-x')) localStorage.removeItem(k); } catch {}
setMode(mode);
showPicker();
