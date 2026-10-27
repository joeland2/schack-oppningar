import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard, enableDrag, shake, moveWords, instruction } from './board.js?v=20261027232256';
import { STYLES, STYLE_OF } from './styles.js?v=20261027232256';

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
let markSq = null;   // { sq, ok }: a tick on the square of a right move, for a moment
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
  const defences = new Map(); // Black's own openings (Sicilian, French…); only shown when searched for
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
        const o = { id: family, name: shortName(family), family, eco: m.eco, side: 'w', root: moves.join(' '), share, win: m.win, draw: m.draw, score: m.score };
        if (moves.length % 2 && !BLACKS.test(family)) found.set(family, o);
        else defences.set(family, { ...o, id: `b:${family}`, side: 'b' });
      }
      open.push({ moves, share });
    }
  }
  const white = [...found.values()].sort((a, b) => b.share - a.share);
  // As Black you face White's openings: the same ones, practised from the other side.
  const meet = white.slice(0, WANT.b).map((o) => ({ ...o, id: `vs:${o.family}`, side: 'b' }));
  return [...white, ...meet, ...defences.values()];
}

const isVs = (o) => o.id.startsWith('vs:'); // a White opening practised from Black's side
// Black's openings by name, whichever move first gave them their name ("King's Indian Defense" can first
// appear after a White move, but it is still Black's choice).
const BLACKS = /(Defen[cs]e|Countergambit|Gambit Accepted|Gambit Declined)$/;
console.assert(BLACKS.test("King's Indian Defense") && !BLACKS.test("King's Gambit") && !BLACKS.test('Italian Game'), 'BLACKS');

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
  return [...white, ...OPENINGS.filter(isVs)];
}

// ---------- Opening list ----------
function card(o) {
  const s = stats[statKey(o.id)] || { done: [], total: 0 };
  const due = dueCount(s);
  const level = due ? 'pagar' : s.total && s.done.length >= s.total ? 'sitter' : s.done.length ? 'pagar' : 'ny';
  const levelTxt = due ? `${due} due` : { sitter: 'Cleared', pagar: `${s.done.length}/${s.total} lines`, ny: 'New' }[level];
  const moves = numbered(o.root).split(' ');
  const tags = (STYLE_OF[o.family] || []).map((t) => `<span class="tag">${STYLES[t].label}</span>`).join('');
  return `<article class="ocard" role="button" tabindex="0" data-id="${o.id}" aria-label="${o.name}">
    <div class="board mini" data-mini="${o.id}" inert></div>
    <div class="ocard-body">
      <div class="ocard-top"><span class="eco">${o.eco}</span><span class="chip ${level}">${levelTxt}</span></div>
      <h3>${isVs(o) ? 'vs ' : ''}${o.name}</h3>
      <p class="omoves">${moves.slice(0, -1).join(' ')} <b>${moves.at(-1)}</b></p>
      ${tags ? `<p class="tags">${tags}</p>` : ''}
      <p class="played">${isVs(o) ? 'You meet it' : 'Played'} in <b>${pctOf(o.share)}</b> of games</p>
      ${wdl(o, o.side)}
    </div>
  </article>`;
}

let query = '';

function renderList() {
  const whiteAll = OPENINGS.filter((o) => o.side === 'w' && o.share >= MIN_REACH).length;
  const groups = [
    ['w', 'You play White', (n) => `Your openings, best results first (a draw counts as half a win). ${style === 'any'
      ? `All ${n} played in at least 1% of games at your level.`
      : `${n} of ${whiteAll} are ${STYLES[style].label.toLowerCase()}; change style to see the rest.`}`],
    ['b', 'You play Black', (n) => `The ${n} White openings you meet most often at your level, and how Black does against them. Your style does not filter these: White picks them. Search for your own defences, like the Sicilian.`],
  ];
  const q = query.trim().toLowerCase();
  const list = q ? OPENINGS.filter((o) => o.family.toLowerCase().includes(q)).sort((a, b) => b.share - a.share) : shown();
  const empty = `<p class="info">No common ${style === 'any' ? '' : STYLES[style].label.toLowerCase() + ' '}openings for White at your level. Try another style.</p>`;
  listEl.innerHTML = q
    ? `<section class="og"><h2>Search results</h2><p class="og-about">${list.length
      ? 'Openings played at your level whose name matches. "as Black" means your own defence; "vs" means a White opening you answer.'
      : `No opening at your level matches "${q.replace(/[<&"]/g, '')}".`}</p>
      <div class="ocards">${list.map((o) => card(o).replace('</h3>', `<small class="as">${isVs(o) ? 'you play Black' : `you play ${sideName(o.side)}`}</small></h3>`)).join('')}</div></section>`
    : `<div class="cols">${groups.map(([side, label, about]) => {
      const ops = list.filter((o) => o.side === side);
      return `<section class="og og-${side}"><h2>${label} <span class="og-n">${ops.length}</span></h2><p class="og-about">${about(ops.length)}</p>${ops.length ? '' : empty}<div class="ocards">${ops.map(card).join('')}</div></section>`;
    }).join('')}</div>`;
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

async function checkMyGames(name) {
  store(STORE + '-lichess-name', name);
  $('#mine-name').value = name;
  $('details.mine').open = true;
  $('#mine-msg').textContent = `Fetching ${name}'s last 100 rated ${speed} games from Lichess…`;
  $('#mine-out').innerHTML = '';
  try {
    await loadTree();
    renderMine(analyse(await fetchGames(name), name), name);
  } catch (err) {
    $('#mine-msg').textContent = err.message;
  }
}
$('#mine-form').addEventListener('submit', (e) => { e.preventDefault(); checkMyGames($('#mine-name').value.trim()); });

// Your Lichess username instead of typing a rating: your public profile gives your blitz and classical
// ratings, then your own games are checked for slips. Public data only, so no login is needed.
async function useLichess(name) {
  const res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(name)}`);
  if (res.status === 404) throw new Error(`Lichess has no player called ${name}.`);
  if (!res.ok) throw new Error(`Lichess answered with an error (${res.status}).`);
  const perfs = (await res.json()).perfs || {};
  for (const sp of ['blitz', 'classical']) if (perfs[sp]?.rating) store(`${STORE}-${sp}-rating`, perfs[sp].rating);
  rating = load(ratingKey(), null);
  if (!rating) throw new Error(`${name} has no ${speed} rating on Lichess yet. Enter a rating instead.`);
  await showPicker();
  checkMyGames(name);
}
$('#rating-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#rating-user').value.trim();
  $('#rating-user-msg').textContent = `Looking up ${name} on Lichess…`;
  try { await useLichess(name); } catch (err) { $('#rating-user-msg').textContent = err.message; }
});
$('#mine-name').value = $('#rating-user').value = load(STORE + '-lichess-name', '');
$('#search').addEventListener('input', (e) => { query = e.target.value; if (OPENINGS.length) renderList(); });

// ---------- Board ----------
function renderBoard() {
  drawBoard(boardEl, game, { side: cur.side, sel, last: lastMove, hint: hintSq, wrong: wrongSq, arrow: hintSq.length === 2 ? hintSq : null,
    mark: markSq || (wrongSq && { sq: wrongSq, ok: false }) });
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
  $('#progress').textContent = mode === 'explore' ? 'Exploring' : line.length ? `${Math.min(ply, line.length)} of ${line.length} moves` : '';
  $('#bar').style.width = line.length ? `${Math.min(ply / line.length, 1) * 100}%` : '0';
}

function say(text, tone = '') {
  if ($('#trainer').hidden) return ($('#pick-msg').textContent = text);
  msgEl.textContent = text;
  msgEl.className = 'message ' + tone;
}

function render() { renderBoard(); renderMoves(); renderWhy(); renderControls(); renderMaterial(); }

// ---------- Material and evaluation ----------
const START = { q: 1, r: 2, b: 2, n: 2, p: 8 };
const VALUE = { q: 9, r: 5, b: 3, n: 3, p: 1 };

// Taken pieces on each side of the board, with the material lead next to the side that is ahead.
function renderMaterial() {
  if (!cur) return;
  const count = { w: { q: 0, r: 0, b: 0, n: 0, p: 0 }, b: { q: 0, r: 0, b: 0, n: 0, p: 0 } };
  for (const row of game.board()) for (const p of row) if (p && p.type !== 'k') count[p.color][p.type]++;
  const points = (c) => Object.entries(count[c]).reduce((sum, [t, n]) => sum + VALUE[t] * n, 0);
  const lost = (c) => Object.entries(START).flatMap(([t, n]) => Array(Math.max(0, n - count[c][t])).fill(t));
  const opp = cur.side === 'w' ? 'b' : 'w';
  const lead = points(cur.side) - points(opp);
  const row = (taken, ahead, who) => {
    const pieces = lost(taken);
    const el = $(who === 'you' ? '#cap-bottom' : '#cap-top');
    el.innerHTML = pieces.map((t) => `<img src="pieces/${taken}${t.toUpperCase()}.svg" alt="">`).join('') + (ahead > 0 ? `<b>+${ahead}</b>` : '');
    el.setAttribute('aria-label', `${who === 'you' ? 'You have' : 'Your opponent has'} taken ${pieces.length ? pieces.map((t) => PIECE[t]).join(', ') : 'nothing'}${ahead > 0 ? `, ${ahead} ahead in material` : ''}`);
  };
  row(opp, lead, 'you');
  row(cur.side, -lead, 'them');
}

// Buttons that cannot do anything right now say so, instead of silently ignoring a press.
function renderControls() {
  if (!cur) return;
  $('#step-back').disabled = !game.history().length;
  $('#step-fwd').disabled = mode !== 'explore' || !redo.length;
  $('#hint').disabled = !userTurn();
  $('#show').disabled = !userTurn();
}

// ---------- Move explanations ----------
const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// What a move does, read off the board: development, centre, captures, checks, attacks.
function idea(before, san) {
  const g = new Chess();
  before.forEach((x) => g.move(x));
  return ideaAt(g, san);
}

// Same, from a position (a Chess game) rather than a move list. Plays the move on g.
// A position with the given side to move, so we can ask what that side's pieces reach.
function asMover(g, color) {
  const fen = g.fen().split(' ');
  fen[1] = color; fen[3] = '-';
  try { return new Chess(fen.join(' ')); } catch { return null; }
}
const CENTRE = ['d4', 'd5', 'e4', 'e5'];
// How many squares a side's bishops and queen reach: rises when a pawn move opens their lines.
function lineMobility(g, color) {
  const h = asMover(g, color);
  if (!h) return 0;
  return h.moves({ verbose: true }).filter((x) => 'bq'.includes(x.piece)).length;
}

function ideaAt(g, san) {
  const prev = g.history({ verbose: true }).at(-1);
  const mobBefore = lineMobility(g, g.turn());
  const castleBefore = ['f', 'g'].map((f) => g.get(f + (g.turn() === 'w' ? '1' : '8')));
  const m = g.move(san);
  const out = [];
  if (m.flags.includes('k') || m.flags.includes('q')) out.push('Castles: the king gets to safety and the rook comes into play');
  else {
    if (m.captured) out.push(`${prev && prev.to === m.to ? 'Takes back' : 'Takes'} the ${PIECE[m.captured]} on ${m.to}`);
    if ('nb'.includes(m.piece) && m.from[1] === (m.color === 'w' ? '1' : '8')) out.push(`Develops the ${PIECE[m.piece]}`);
    if (m.piece === 'p' && !m.captured && 'de'.includes(m.to[0])) out.push('Claims the centre');
    else if (m.piece === 'p' && !m.captured && 'cf'.includes(m.to[0])) out.push('Fights for the centre from the side');
    if (m.piece === 'q' && g.moveNumber() <= 7) out.push('Brings the queen out early');
  }
  if (g.inCheck()) out.push('Gives check');
  // What the moved piece now reaches: look at its moves as if it could move again.
  const h = asMover(g, m.color);
  const reach = h ? h.moves({ square: m.to, verbose: true }) : [];
  // pawns only count in the centre, where hitting them matters early on
  const hits = reach.filter((x) => x.captured && x.captured !== 'k' && (x.captured !== 'p' || CENTRE.includes(x.to)))
    .map((x) => `${PIECE[x.captured]} on ${x.to}`);
  if (hits.length) out.push(`Attacks the ${hits.join(' and the ')}`);
  // Centre squares it now covers (a pawn covers the squares diagonally ahead of it).
  const fwd = m.color === 'w' ? 1 : -1;
  const covers = m.piece === 'p'
    ? [-1, 1].map((d) => String.fromCharCode(m.to.charCodeAt(0) + d) + (Number(m.to[1]) + fwd))
    : reach.filter((x) => !x.captured).map((x) => x.to);
  const centre = CENTRE.filter((sq) => covers.includes(sq) && !g.get(sq));
  if (centre.length && m.piece !== 'k') out.push(`Controls ${centre.join(' and ')} in the centre`);
  if (m.piece === 'p' && lineMobility(g, m.color) - mobBefore >= 3) out.push('Opens lines for the bishop and queen');
  const rank = m.color === 'w' ? '1' : '8';
  const castleNow = ['f', 'g'].map((f) => g.get(f + rank));
  if (g.getCastlingRights?.(m.color)?.k && castleBefore.some(Boolean) && !castleNow.some(Boolean)) out.push('Clears the way to castle');
  return out.length ? out.join('. ') + '.' : '';
}
console.assert(idea(['e4', 'e5'], 'Nf3').startsWith('Develops the knight. Attacks the pawn on e5.'), 'idea');

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
    : '') : '';
  const res = after ? ` You score ${pct(scoreFor(after, cur.side))} after it.` : '';
  return (idea(before, san) + stat + res).trim();
}

// A side's share of the points after a move (a draw is half a point); explore() gives White's.
const scoreFor = (m, color) => (color === 'w' ? m.score : 1 - m.score);
const sideName = (c) => (c === 'w' ? 'White' : 'Black');

// What the opponent plays here at your level, most common first, and which of your lines covers each
// reply: the replies you can expect to meet, compared with the one this line practises.
function repliesText(before, played) {
  const x = explore(before, ratingsAround(rating));
  if (x.total < MIN_GAMES) return '';
  const covers = (san) => lines.findIndex((l) => lineKey(l.moves.slice(0, before.length + 1)) === lineKey([...before, san]));
  const top = x.moves.filter((m) => m.n / x.total >= 0.02).slice(0, 5);
  const rest = 1 - top.reduce((s, m) => s + m.n / x.total, 0);
  const part = (m) => {
    const i = covers(m.san);
    const tag = m.san === played ? ' (this line)' : i >= 0 ? ` (line ${i + 1})` : '';
    return `<span class="rep${m.san === played ? ' now' : ''}"><b>${m.san}</b> ${pct(m.n / x.total)}${tag}</span>`;
  };
  return `<span class="reps">At your level: ${top.map(part).join(' ')}${rest >= 0.01 ? ` <span class="rep">others ${pct(rest)}</span>` : ''}</span>`;
}

function renderWhy() {
  const el = $('#why');
  if (!cur || !line.length || mode === 'explore') return (el.innerHTML = ''); // Explore explains in the message
  const hist = game.history();
  const label = (n, san) => `${Math.floor(n / 2) + 1}.${n % 2 ? '..' : ''}${san}`;
  const parts = [];
  if (hist.length) {
    const n = hist.length - 1;
    const before = hist.slice(0, n).map(clean), san = clean(hist[n]);
    const yours = (n % 2 === 0) === (cur.side === 'w');
    parts.push(yours
      ? `<p><b>You played ${label(n, hist[n])}</b> ${why(before, san)}</p>`
      : `<p><b>${sideName(n % 2 ? 'b' : 'w')} played ${label(n, hist[n])}</b> ${idea(before, san)} ${repliesText(before, san)}</p>`);
  }
  if (mode === 'learn' && userTurn()) {
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
  $('#op-title').textContent = (isVs(op) ? 'vs ' : '') + op.name;
  $('#op-eco').textContent = op.eco;
  $('#op-info').textContent = `Starts ${numbered(op.root)}. ${isVs(op) ? 'You meet it' : 'Played'} in ${pctOf(op.share)} of ${speed} games at your level; ${sideName(op.side)} wins ${pct(op.side === 'w' ? op.win : 1 - op.win - op.draw)}.`;
  $('#op-side').textContent = op.side === 'w' ? 'You play White' : 'You play Black';
  $('#restart').textContent = 'Restart';
  $('#picker').hidden = true;
  $('#trainer').hidden = false;
  render();
  if (!rating) return say(`Enter your Lichess ${speed} rating at the top.`);
  lines = buildLines(op);
  if (!lines.length) return say('Not enough games at your rating for this opening.', 'bad');
  const s = stats[statKey(op.id)] = { done: [], played: [], ...stats[statKey(op.id)], total: lines.length };
  s.played ??= [];
  store(STORE, stats);
  play(nextLine());
}

function play(i) {
  lineIdx = i;
  const l = lines[i];
  line = l.moves;
  game = new Chess();
  ply = 0; sel = null; hintSq = []; wrongSq = null; lastMove = null;
  misses = 0; missesHere = 0; busy = false;
  gameGen++; // ignore an opponent reply still on its way from the previous game
  redo = [];
  $('#restart').textContent = 'Restart';
  render();
  renderLines();
  renderLineBox();
  if (mode === 'explore') return enterExplore();
  if (userTurn()) prompt('Your move. Play the first move.');
  else { say('Your opponent starts…'); reply(); }
}

// ---------- Explore: any move for either side, rated by what real players do ----------
// What the side to move plays here at your level, with the most common move as an arrow.
function exploreSay(prefix = '') {
  const x = explore(game.history().map(clean), ratingsAround(rating));
  const top = x.moves.filter((m) => m.n >= MIN_GAMES).slice(0, 4);
  const side = game.turn();
  const first = top[0] && new Chess(game.fen()).move(top[0].san);
  hintSq = first ? [first.from, first.to] : [];
  renderBoard();
  const best = [...top].sort((a, b) => scoreFor(b, side) - scoreFor(a, side))[0];
  say(prefix + (top.length
    ? `${sideName(side)} at your level plays ${top.map((m) => `${m.san} ${pct(m.n / x.total)}`).join(', ')}. Best results: ${best.san} (${sideName(side)} scores ${pct(scoreFor(best, side))}).`
    : 'Too few games at your level reach this position to say what players do next.'));
}

function enterExplore() {
  busy = false; sel = null; hintSq = [];
  exploreSay('Explore: ');
  if (game.turn() !== cur.side && !game.isGameOver()) opponentAnswers('');
}

// prefix: the verdict on your own move, kept in front when the opponent's automatic answer is described.
function exploreMove(from, to, promotion = 'q', keepRedo = false, prefix = '') {
  const hist = game.history().map(clean);
  let m;
  try { m = game.move({ from, to, promotion }); } catch { return false; }
  if (!m) return false;
  if (!keepRedo) redo = []; // a new move starts a new branch
  lastMove = m; ply = hist.length + 1; sel = null; hintSq = []; busy = false;
  render();
  if (game.isCheckmate()) { say(`${prefix}${m.san} is checkmate. ${sideName(m.color)} wins.`, 'good'); return true; }
  if (game.isGameOver()) { say(`${prefix}${m.san}: the game is drawn.`); return true; }
  const x = explore(hist, ratingsAround(rating));
  const seen = x.moves.find((s) => s.san === clean(m.san));
  const verdict = seen
    ? `${m.san}: ${pct(seen.n / x.total)} of players at your level play it here, and ${sideName(m.color)} scores ${pct(scoreFor(seen, m.color))} after it. `
    : `${m.san}: ${x.total ? 'no one at your level played it here' : 'no games at your level reach this far'}. `;
  // Your move: the opponent answers by itself, as players at your level most often do.
  // To try another answer for them, step back and move their piece yourself.
  if (m.color === cur.side && !keepRedo && !prefix) opponentAnswers(verdict);
  else exploreSay(prefix + verdict);
  return true;
}

function opponentAnswers(prefix) {
  const at = game.fen();
  const real = explore(game.history().map(clean), ratingsAround(rating)).moves.filter((x) => x.n >= MIN_GAMES);
  if (!real.length) return exploreSay(prefix + 'Real games run out here, so the opponent no longer answers by itself. ');
  busy = true;
  const gen = gameGen;
  setTimeout(() => {
    if (gen !== gameGen || game.fen() !== at || mode !== 'explore') return;
    busy = false;
    const m = new Chess(at).move(real[0].san);
    exploreMove(m.from, m.to, m.promotion || 'q', false, prefix);
  }, 450);
}

let gameGen = 0; // bumped when the game is reset or left; a pending opponent reply checks it
const userTurn = () => ply < line.length && game.turn() === cur.side;

// A move that is not the line's: how often strong players choose it, and how you score after it
// compared with the line's move, at your level.
function explainWrong(san) {
  const before = line.slice(0, ply);
  const strong = strongGroups(before);
  const want = expectedMove();
  const share = (s) => strong.x.moves.find((x) => x.san === s)?.n / strong.x.total || 0;
  const mine = explore(before, ratingsAround(rating)).moves;
  const score = (s) => { const m = mine.find((x) => x.san === s); return m && m.n >= MIN_GAMES ? pct(scoreFor(m, cur.side)) : null; };
  const theirs = share(clean(san)), lineMove = mode === 'learn' ? want.san : "the line's move";
  const parts = [theirs >= RARE
    ? `It is a real option: players rated ${BUCKETS[strong.groups[0]]}+ choose it in ${pct(theirs)} of games, ${lineMove} in ${pct(share(want.san))}.`
    : `Players rated ${BUCKETS[strong.groups[0]]}+ ${theirs ? `choose it in only ${pct(theirs)} of games` : 'never choose it here'}; ${lineMove} in ${pct(share(want.san))}.`];
  if (score(clean(san)) && score(want.san)) parts.push(`At your level you score ${score(clean(san))} after ${san} and ${score(want.san)} after ${lineMove}.`);
  if (mode === 'learn') parts.push(`The line plays ${moveWords(want)}.`);
  else if (missesHere >= 2) parts.push('The piece to move is highlighted.');
  else parts.push('Try again.');
  say(`${san} is not the move here. ${parts.join(' ')}`, 'bad');
}

// ---------- Practice: lines come back for review ----------
// A line cleared in Practice moves up a box and comes back after the box's interval; a mistake sends it
// back to the start, to be practised again today.
const DAY = 864e5;
const INTERVALS = [0, 1, 3, 7, 14, 30]; // days, per box
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function review(ok) {
  const s = stats[statKey(cur.id)];
  s.rep ??= {};
  const key = lineKey(line);
  const r = s.rep[key] ?? { box: 0, due: 0 };
  r.box = ok ? Math.min(r.box + 1, INTERVALS.length - 1) : 0;
  r.due = Date.now() + INTERVALS[r.box] * DAY;
  s.rep[key] = r;
  s.done = s.done.filter((k) => k !== key);
  if (r.box > 0) s.done.push(key);
  store(STORE, stats);
  return r;
}

// Cleared lines whose review date has come, across all of an opening's saved lines.
const dueCount = (s) => Object.values(s?.rep || {}).filter((r) => r.box > 0 && r.due <= Date.now()).length;

// Learn: the first line not yet played through. Practice: lines due for review first, then lines you
// have learned but not cleared, then any line not cleared.
function nextLine() {
  const s = stats[statKey(cur.id)];
  const key = (l) => lineKey(l.moves);
  if (mode === 'learn') {
    const i = lines.findIndex((l) => !s.played.includes(key(l)));
    return i === -1 ? (lineIdx + 1) % lines.length : i;
  }
  const due = lines.map((l, i) => [i, s.rep?.[key(l)]]).filter(([, r]) => r && r.box > 0 && r.due <= Date.now())
    .sort((a, b) => a[1].due - b[1].due);
  if (due.length) return due[0][0];
  const learned = lines.findIndex((l) => s.played.includes(key(l)) && !s.done.includes(key(l)));
  if (learned !== -1) return learned;
  const fresh = lines.findIndex((l) => !s.done.includes(key(l)));
  return fresh !== -1 ? fresh : lineIdx;
}

// ---------- Lines overview and the "opening complete" approval ----------
// Lines of the current list that are cleared (progress saved for other ratings may hold other lines).
const cleared = () => lines.filter((l) => stats[statKey(cur.id)]?.done.includes(lineKey(l.moves))).length;
const lineName = (l) => (l.name ? l.name.split(' · ').at(-1).split(': ').at(-1) : 'Unnamed line');
// The line's last two moves with their real move numbers, e.g. "5.O-O d6", so same-named lines can be told apart.
const lineEnd = (l) => numbered(lineKey(l.moves)).split(' ').slice(l.moves.length % 2 ? -1 : -2).join(' ');

// Which line this is, how far through the opening you are, and how likely the line is to come up.
function renderLineBox() {
  const l = lines[lineIdx];
  if (!l) return ($('#line-box').innerHTML = '');
  const s = stats[statKey(cur.id)] || {};
  const n = lines.length;
  const played = lines.filter((x) => s.played?.includes(lineKey(x.moves))).length;
  const done = cleared();
  const due = dueCount(s);
  const r = s.rep?.[lineKey(l.moves)];
  const nextReview = r?.box > 0 ? (r.due <= Date.now() ? 'This line is due for review today.' : `Next review of this line in ${plural(Math.ceil((r.due - Date.now()) / DAY), 'day')}.`) : '';
  const oneIn = Math.max(1, Math.round(1 / (cur.share * l.share)));
  $('#line-box').innerHTML = `
    <h2 class="lb-name">Line ${lineIdx + 1} of ${n}: ${lineName(l)} <small>${lineEnd(l)}</small></h2>
    <div class="lb-stats">
      <div><b>${pctOf(l.share)}</b><span>of games in this opening go this way</span></div>
      <div><b>1 in ${oneIn.toLocaleString('en')}</b><span>of all your ${speed} games reach it</span></div>
      <div><b>${played}/${n}</b><span>lines learned</span></div>
      <div><b>${done}/${n}</b><span>lines cleared${due ? `, ${due} due for review` : ''}</span></div>
    </div>
    <div class="lb-bar" aria-hidden="true"><span class="lb-done" style="width:${(done / n) * 100}%"></span><span class="lb-played" style="width:${(Math.max(0, played - done) / n) * 100}%"></span></div>
    <p class="lb-note">${nextReview ? nextReview + ' ' : ''}Progress is saved in this browser.</p>`;
}

function renderLines() {
  const done = stats[statKey(cur.id)]?.done || [];
  $('#lines-sum').textContent = `Lines · ${cleared()} of ${lines.length} cleared`;
  $('#lines-list').innerHTML = lines.map((l, i) => `<li><button type="button" class="line-btn${i === lineIdx ? ' now' : ''}" data-i="${i}">
      <span class="line-n">${i + 1}.</span><span class="line-name">${lineName(l)}<small>${lineEnd(l)}</small></span>
      <span class="line-share">${pctOf(l.share)}</span><span class="line-ok">${done.includes(lineKey(l.moves)) ? '<svg class="ico" viewBox="0 0 24 24" role="img" aria-label="Cleared"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}</span>
    </button></li>`).join('');
}
$('#lines-list').addEventListener('click', (e) => {
  const b = e.target.closest('.line-btn');
  if (b) play(Number(b.dataset.i));
});

function showComplete() {
  $('#complete-title').textContent = `${isVs(cur) ? 'vs ' : ''}${cur.name}: complete`;
  $('#complete-text').textContent = `You cleared all ${lines.length} lines: every common reply at ${rating} ± 200 in ${speed}, each played from memory without a mistake.`;
  $('#complete').showModal();
}
$('#complete-more').addEventListener('click', () => { $('#complete').close(); play((lineIdx + 1) % lines.length); });
$('#complete-back').addEventListener('click', () => { $('#complete').close(); showPicker(); });

function reply() {
  busy = true;
  // A newer game or a switch to Explore cancels this, through the game counter.
  const gen = gameGen;
  setTimeout(() => {
    if (gen !== gameGen) return;
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
  if (clean(m.san) !== line[ply]) {
    game.undo();
    misses++; missesHere++;
    wrongSq = to; sel = null;
    renderBoard();
    shake(boardEl);
    if (missesHere >= 2) showHint();
    explainWrong(m.san);
    setTimeout(() => { wrongSq = null; renderBoard(); }, 700);
    return true;
  }
  lastMove = m; ply++; sel = null; hintSq = []; missesHere = 0;
  say(`Right: ${moveWords(m)}.`, 'good');
  markSq = { sq: m.to, ok: true };
  setTimeout(() => { if (markSq?.sq === m.to) { markSq = null; renderBoard(); } }, 900);
  render();
  if (ply >= line.length) finish(); else reply();
  return true;
}

function expectedMove() {
  return new Chess(game.fen()).move(line[ply]);
}

// In Learn mode the move to play is always shown.
function prompt(text) {
  if (mode !== 'learn' || !userTurn()) return say(text);
  const m = expectedMove();
  hintSq = [m.from, m.to];
  renderBoard();
  say(`${instruction(m)}.`);
}

function showHint() {
  if (!userTurn()) return;
  hintSq = [expectedMove().from];
  renderBoard();
}

// The end of the line. Learn: the line counts as learned. Practice: without a mistake it is cleared
// and comes back for review later; with one it stays to be practised again today.
function finish() {
  const s = stats[statKey(cur.id)];
  if (!s.played.includes(lineKey(line))) s.played.push(lineKey(line));
  store(STORE, stats);
  const wasComplete = cleared() === lines.length;
  const r = mode === 'try' ? review(misses === 0) : null;
  renderLines();
  renderLineBox();
  $('#restart').textContent = mode === 'try' && misses ? 'Try again' : 'Next line';
  if (mode === 'learn') return say('Line learned. Press Next line, or switch to Practice to play it from memory.', 'good');
  if (misses) return say(`Line done with ${plural(misses, 'mistake')}, so it is not cleared. Press Try again.`, 'bad');
  if (!wasComplete && cleared() === lines.length) showComplete();
  const back = `It comes back for review in ${plural(INTERVALS[r.box], 'day')}.`;
  say(cleared() === lines.length ? `Line cleared. Every common line at your level is cleared. ${back}`
    : `Line cleared, ${cleared()} of ${lines.length}. ${back} Press Next line.`, 'good');
}

// In Explore you move whichever side is to move; otherwise only your own side, on your turn.
const canMove = () => !busy && (mode === 'explore' ? cur && !game.isGameOver() : userTurn());
const mover = () => (mode === 'explore' ? game.turn() : cur.side);
const move = (from, to) => (mode === 'explore' ? exploreMove(from, to) : tryMove(from, to));
enableDrag(boardEl, {
  canDrag: (sq) => canMove() && game.get(sq)?.color === mover(),
  onDrop: (from, to) => { sel = null; if (!move(from, to)) renderBoard(); },
});
boardEl.addEventListener('click', (e) => {
  const b = e.target.closest('.sq');
  if (!b || !canMove()) return;
  const sq = b.dataset.sq;
  const p = game.get(sq);
  if (sel && sel !== sq && move(sel, sq)) return;
  if (p && p.color === mover()) sel = sel === sq ? null : sq;
  else sel = null;
  renderBoard();
});
// ---------- Stepping back and forward ----------
// Back always works: in Learn or Try it switches to Explore at that position, so you can try the
// opponent's other moves and see how to answer them. Forward replays the moves you stepped back over.
let redo = [];

function stepBack() {
  if (!cur || !lines.length || !game.history().length) return;
  if (mode !== 'explore') { setMode('explore', false, false); gameGen++; } // the line's pending reply no longer applies
  else if (busy) return;
  redo.push(game.undo());
  lastMove = game.history({ verbose: true }).at(-1) || null;
  ply = game.history().length;
  busy = false; sel = null;
  render();
  exploreSay('Stepped back. Move any piece, for either side, to see how often players at your level choose it. ');
}

function stepForward() {
  if (mode !== 'explore' || busy || !redo.length) return;
  const m = redo.pop();
  exploreMove(m.from, m.to, m.promotion, true);
}

$('#step-back').addEventListener('click', stepBack);
$('#step-fwd').addEventListener('click', stepForward);
document.addEventListener('keydown', (e) => {
  if ($('#trainer').hidden || e.target.closest?.('input, textarea, select') || e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); stepBack(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); stepForward(); }
});

$('#restart').addEventListener('click', () => {
  if (!lines.length) return start(cur);
  if (mode === 'learn') return play(ply >= line.length ? nextLine() : lineIdx);
  play(ply >= line.length && misses === 0 ? nextLine() : lineIdx);
});
$('#hint').addEventListener('click', () => { if (userTurn()) { showHint(); say('The piece to move is highlighted.'); } });
$('#show').addEventListener('click', () => {
  if (!userTurn()) return;
  const m = expectedMove();
  misses++;
  say(`The move: ${instruction(m)}.`);
  hintSq = [m.from, m.to]; renderBoard();
});
// Opening picker, shown before the board.
async function showPicker() {
  cur = null; gameGen++; // stops an opponent reply that is still on its way
  $('#trainer').hidden = true;
  $('#picker').hidden = false;
  listEl.innerHTML = '';
  renderChoices();
  $('#rating-step').hidden = !!rating;
  $('.choice-search').hidden = !rating;
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
function setMode(m, restart = true, remember = true) {
  mode = m;
  if (remember) store(STORE + '-mode', m);
  for (const k of ['learn', 'try', 'explore']) $(`#mode-${k}`).setAttribute('aria-pressed', m === k);
  $('#mode-about').textContent = {
    learn: 'Every move is shown, with the replies you can expect at your level. Nothing is scored.',
    try: 'Practice: play the line from memory. A line played without mistakes is cleared and comes back for review after 1, 3, 7, 14 and 30 days.',
    explore: 'Play any move: the opponent answers as players at your level most often do, and you see how often each move is played and how it scores. To try another answer, step back and move their piece.',
  }[m];
  $('#hint').hidden = $('#show').hidden = m === 'explore';
  if (!lines.length) return;
  if (!restart) return;
  if (m === 'explore') enterExplore(); // carry on from the current position
  else play(lineIdx);
}
$('#mode-learn').addEventListener('click', () => setMode('learn'));
$('#mode-try').addEventListener('click', () => setMode('try'));
$('#mode-explore').addEventListener('click', () => setMode('explore'));
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
