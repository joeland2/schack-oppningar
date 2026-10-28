import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard, enableDrag, clearShapes, shake, moveWords, instruction, GLYPH } from './board.js?v=20261028145207';
import { findMistakes, byTheme, pickPuzzles, THEMES } from './mistakes.js?v=20261028145207';
import { ideaAt, asMover, CENTRE, hanging } from './ideas.js?v=20261028145207';
import { STYLES, STYLE_OF, ABOUT, PLAN, VS_PLAN } from './styles.js?v=20261028145207';

const STORE = 'opening-book-v2';
const MIN_SHARE = 0.05;   // an opponent reply must be played in at least 5% of games from that position
const MAX_LINES = 20;
const MIN_LINE = 0.03;   // a side line needs 3% of the opening's games to become a line of its own
const THEORY = 0.15;     // a reply strong players choose this often is a main line, rare at your level or not
const THEORY_GROUPS = [6, 7, 8]; // 2000+
// A trap: a reply players at your level make in at least TRAP_SHARE of games (and MIN_GAMES), after which
// they score TRAP_SCORE or less (in TRAP_GAMES games or more). It gets a line of its own, so you learn how to punish it.
const TRAP_SHARE = 0.02, TRAP_SCORE = 0.35, TRAP_GAMES = 40;
const MIN_GAMES = 20;     // below this, real-game data is too thin to trust
const MAX_PLY = 20;       // data/explorer-*.json goes this deep
const DATA = '2026-10-28-k8'; // version of data/explorer-*.json
const BUCKETS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]; // Lichess explorer rating groups
// The strong players your own Lichess games are judged against: 2200+ in blitz; 2000+ in classical, where 2200+ games are scarce.
const STRONG = { blitz: [7, 8], classical: [6, 7, 8] };
const WANT = { w: 30 };   // White openings listed; Black's list is the same openings from the other side
const POOL = 80;          // White openings collected, so a style filter still has enough to show
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
let sort = load(STORE + '-sort', 'score'); // score: best results for your side first; played: most played first
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
if (mode === 'explore') mode = 'learn'; // Explore is for the moment; an opening always opens in Learn or Practice
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

// Indexes of the rating groups overlapping 300 below to 500 above your rating: "your level" everywhere
// on the site. Reaching higher keeps more games deep into the lines, and they are better games.
const LEVEL = { below: 300, above: 500 };
const levelText = (r) => `${r - LEVEL.below}–${r + LEVEL.above}`;
function ratingsAround(r) {
  return BUCKETS.flatMap((b, i) => (b <= r + LEVEL.above && (BUCKETS[i + 1] ?? Infinity) > r - LEVEL.below ? [i] : []));
}
console.assert(ratingsAround(1500).join() === '2,3,4,5,6' && ratingsAround(2400).join() === '6,7,8', 'ratingsAround');

// ---------- Data (all local, nothing is fetched from Lichess) ----------
let TREE, BOOK, NAMES, IN_BOOK;
const TREES = {};
const POPULAR = {};   // popularOpenings() per time control and rating; it takes a moment to compute

// data/explorer-<speed>.json: move counts per rating group from Lichess games of that time control,
// built by tools/make_explorer.py. Loaded once per time control.
async function loadTree() {
  // DATA is bumped whenever the data is rebuilt, so no browser keeps an old file
  TREES[speed] ??= (await fetch(`data/explorer-${speed}.json?v=${DATA}`).then((r) => r.json())).tree;
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

// White systems that Lichess names by move order, so one opening is split over several names:
// 1.d4 d5 2.Bf4 "Queen's Pawn Game: Accelerated London System", 1.d4 Nf6 2.Bf4 "Indian Defense:
// Accelerated London System", and so on. Every such move order counts as the system and becomes a
// starting point for its lines. 2.Bf4 after 1.d4 is the London whatever Black played first.
const SYSTEMS = [
  { family: 'London System', eco: 'D02', book: /London System/, test: (moves, name) => /London System/.test(name || '') || /^d4 \S+ Bf4$/.test(lineKey(moves)) },
];
console.assert(SYSTEMS[0].test(['d4', 'e6', 'Bf4']) && !SYSTEMS[0].test(['e4', 'e5', 'Nf3'], 'Scotch Game: Scotch Gambit, London Defense'), 'SYSTEMS');

// Every book position in the opening's family, as move-sequence keys.
function familyBook(op) {
  const set = new Set();
  const sys = SYSTEMS.find((s) => s.family === op.family);
  for (const l of BOOK) {
    if (sys ? !sys.book.test(l.name) : !l.name.startsWith(op.family) && !l.name.includes(': ' + op.family)) continue;
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

// Real games at a position: your level first; where too few of them reach it, players higher up as
// well (there are many more games at the top, and they are better ones).
function gamesAt(moves) {
  const mine = ratingsAround(rating);
  const x = explore(moves, mine);
  return x.total >= MIN_GAMES ? x : explore(moves, BUCKETS.map((_, i) => i).filter((i) => i >= mine[0]));
}

// Whose moves you learn: players a step above you, 200 to 1000 points higher (at 1200: 1400–2200).
// Good moves that still make sense at your level, and far more games than at the very top. Where too
// few of them reach a position, one rating group lower at a time, but never below your own level.
const ABOVE = { from: 200, to: 1000 };
function strongGroups(moves) {
  let groups = BUCKETS.map((_, i) => i).filter((i) => BUCKETS[i] >= rating + ABOVE.from && BUCKETS[i] <= rating + ABOVE.to);
  if (!groups.length) groups = [BUCKETS.length - 1]; // above 2300: the top group
  for (;;) {
    const x = explore(moves, groups);
    const next = groups[0] - 1;
    if (x.moves.some((m) => m.n >= MIN_GAMES) || next < 0 || BUCKETS[next] < rating) return { groups, x };
    groups = [next, ...groups];
  }
}

// Your move in a line: among the moves strong players really play here (at least STRONG_SHARE of
// their games), the one that scores best for you in games at your level. Sound moves that also win:
// a trap that only works on weak players never makes the list. A move of the opening's own book wins a
// near tie, so the line stays in its opening.
const STRONG_SHARE = 0.1;
function userMove(moves, book) {
  const { x } = strongGroups(moves);
  const sound = x.moves.filter((m) => m.n >= MIN_GAMES && m.n / x.total >= STRONG_SHARE);
  if (!sound.length) return x.moves.find((m) => m.n >= MIN_GAMES)?.san;
  const me = moves.length % 2 ? 'b' : 'w';
  const here = gamesAt(moves).moves;
  const score = (m) => {
    const mine = here.find((h) => h.san === m.san && h.n >= MIN_GAMES);
    return scoreFor(mine || m, me) + (book.has(lineKey([...moves, m.san])) ? 0.01 : 0);
  };
  return sound.reduce((best, m) => (score(m) > score(best) ? m : best)).san;
}

// Grow lines from the root, most common first. Each opponent reply played in ≥ MIN_SHARE of games
// at your rating becomes its own branch, until MAX_LINES lines exist; after that each line goes on
// with the most common reply only, so every line runs until real games run out (or MAX_PLY).
function buildLines(op) {
  const book = familyBook(op);
  const mine = ratingsAround(rating);
  const nameOf = (moves, fallback) => {
    const n = NAMES.get(lineKey(moves));
    return n ? `${n.eco} · ${n.name}` : fallback;
  };
  const done = [];
  // A system's move orders count like opponent replies: each one played in ≥ MIN_SHARE of its games.
  const open = (op.roots || [{ moves: op.root.split(' '), share: op.share }]).filter((r) => r.share / op.share >= MIN_SHARE)
    .map((r, i) => ({ moves: r.moves, share: r.share / op.share, name: op.roots ? op.name : '', branch: i ? r.share / op.share : 1 }));
  while (open.length) {
    open.sort((a, b) => b.share - a.share);
    const l = open.shift();
    let moves = l.moves;
    if (moves.length >= MAX_PLY) { done.push(l); continue; }
    if (moves.length % 2 === (op.side === 'w' ? 0 : 1)) {
      const san = userMove(moves, book);
      if (!san) { done.push(l); continue; }
      moves = [...moves, san];
    }
    const x = gamesAt(moves);
    const name = nameOf(moves, l.name);
    // The replies you meet (MIN_SHARE of games at your level), plus theory: the main replies of strong
    // players (THEORY of games at 2000+), where players at your level reach them at all.
    const strong = explore(moves, THEORY_GROUPS);
    const theory = new Set(strong.moves.filter((m) => m.n >= MIN_GAMES && m.n / strong.total >= THEORY).map((m) => m.san));
    const opp = op.side === 'w' ? 'b' : 'w';
    const trap = (m) => m.n >= TRAP_GAMES && m.n / x.total >= TRAP_SHARE && scoreFor(m, opp) <= TRAP_SCORE;
    const replies = x.total < MIN_GAMES ? [] : x.moves.filter((m) => (m.n >= MIN_GAMES && m.n / x.total >= MIN_SHARE) || (theory.has(m.san) && m.n >= 3) || trap(m));
    if (!replies.length) { done.push({ moves, share: l.share, name, branch: l.branch, trap: l.trap }); continue; }
    const room = Math.max(1, MAX_LINES - done.length - open.length);
    // The most common reply always carries the line on; others branch off only if they come up in at
    // least MIN_LINE of games in this opening, so the line budget goes to depth, not to rarities.
    // branch: how many of the opening's games reach the point where this line leaves its parent; the
    // main line (always the most common reply) keeps 1, so it is learned first.
    for (const [i, m] of replies.filter((m, i) => i === 0 || theory.has(m.san) || trap(m) || l.share * m.n / x.total >= MIN_LINE).slice(0, room).entries()) {
      const share = l.share * m.n / x.total;
      open.push({ moves: [...moves, m.san], share, name: nameOf([...moves, m.san], name), branch: i ? share : l.branch,
        // a trap is the line where the mistake is made (never the main reply); the line keeps it as it
        // goes on, but lines branching off it later are lines of their own
        trap: i === 0 ? l.trap : trap(m) ? { ply: moves.length, san: m.san, score: scoreFor(m, opp) } : null });
    }
  }
  // Every line ends on the opponent's move: you see their answer, then play on from there. A line that
  // ends on your move gets their most common reply, or loses that last move where no game goes further.
  const seen = new Set();
  return done.map((l) => {
    if ((l.moves.length % 2 === 1) !== (op.side === 'w')) return l;
    const reply = gamesAt(l.moves).moves[0];
    return { ...l, moves: reply ? [...l.moves, reply.san] : l.moves.slice(0, -1) };
  }).filter((l) => l.moves.length && !seen.has(lineKey(l.moves)) && seen.add(lineKey(l.moves)))
    // As a course does it: the main line first, then the traps to punish, then the lines that leave the
    // main line, the most common first.
    .sort((a, b) => (b.branch === 1) - (a.branch === 1) || !!b.trap - !!a.trap || b.branch - a.branch || b.share - a.share);
}

// The most played White openings at your level, found by walking real games from the start position,
// most common positions first. An opening is White's when White's move first gives it its name.
// The share of games in the given rating groups that reach a move sequence.
function reachOf(moves, groups) {
  let node = TREE;
  for (const m of moves) node = node?.[3]?.[m];
  const sum = (n) => groups.reduce((s, i) => s + n[0][i], 0);
  return node ? sum(node) / sum(TREE) : 0;
}

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
      if (share < 0.0002 || m.n < MIN_GAMES) continue;
      const moves = [...p.moves, m.san];
      const sys = moves.length % 2 && SYSTEMS.find((s) => s.test(moves, m.name));
      if (sys) {
        const o = found.get(sys.family);
        if (!o) {
          named.add(sys.family);
          found.set(sys.family, { id: sys.family, name: sys.family, family: sys.family, eco: sys.eco, side: 'w', root: moves.join(' '),
            roots: [{ moves, share }], share, win: m.win, draw: m.draw, score: m.score });
        } else if (!o.roots.some((r) => lineKey(moves).startsWith(lineKey(r.moves) + ' '))) {
          // another move order: the system's results are the games-weighted mix of all of them
          const t = o.share + share;
          for (const k of ['win', 'draw', 'score']) o[k] = (o[k] * o.share + m[k] * share) / t;
          o.share = t;
          o.roots.push({ moves, share });
        }
        open.push({ moves, share });
        continue;
      }
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
  // The listed White openings: the WANT.w most played at your level. rank orders every White opening
  // found; a style filter takes the first WANT.w of its own style.
  white.forEach((o, i) => { o.rank = i; o.listed = i < WANT.w; });
  // As Black you face White's openings: the same ones, practised from the other side.
  const meet = white.filter((o) => o.listed).map((o) => ({ ...o, id: `vs:${o.family}`, side: 'b' }));
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
  const head = name.split(':')[0].split(',')[0]; // "Rapport-Jobava System, with e6" is still the Jobava
  if (!GENERIC.has(head)) return head;
  const sub = name.split(',')[0];
  return sub === head ? null : sub;
}
console.assert(familyOf("Queen's Pawn Game: London System, with e6") === "Queen's Pawn Game: London System" && familyOf("Queen's Pawn Game") === null
  && familyOf('Rapport-Jobava System, with e6') === 'Rapport-Jobava System', 'familyOf');

// Style tags are keyed by the opening's name, with or without its "Queen's Pawn Game:" style prefix.
const stylesOf = (o) => STYLE_OF[o.family] || STYLE_OF[shortName(o.family)] || [];
const fitsStyle = (o) => style === 'any' || stylesOf(o).includes(style);

// The openings shown. White: the best-scoring common ones that fit your style.
// Black: the White openings you meet most often, whatever your style.
const yourScore = (o) => (o.side === 'w' ? o.score : 1 - o.score);
const byChoice = (a, b) => (sort === 'played' ? b.share - a.share : yourScore(b) - yourScore(a));
function shown() {
  const white = OPENINGS.filter((o) => o.side === 'w' && o.rank !== undefined && fitsStyle(o))
    .sort((a, b) => a.rank - b.rank).slice(0, WANT.w).sort(byChoice);
  return [...white, ...OPENINGS.filter(isVs).sort(byChoice)];
}

// ---------- Opening list ----------
// One opening per row: a board that plays the moves, the name, a sentence on what the opening is about,
// how often it comes up and how your side does, and your progress.
function card(o) {
  const s = stats[statKey(o.id)] || { done: [], total: 0 };
  const due = dueCount(s);
  const level = due ? 'pagar' : s.total && s.done.length >= s.total ? 'sitter' : s.done.length ? 'pagar' : 'ny';
  const levelTxt = due ? `${due} due` : { sitter: 'Cleared', pagar: `${s.done.length}/${s.total} lines`, ny: 'New' }[level];
  const moves = numbered(o.root).split(' ');
  const tags = stylesOf(o).map((t) => `<span class="tag">${STYLES[t].label}</span>`).join('');
  const about = ABOUT[o.family] || ABOUT[shortName(o.family)] || '';
  const win = o.side === 'w' ? o.win : 1 - o.win - o.draw;
  return `<article class="ocard side-${o.side}" role="button" tabindex="0" data-id="${o.id}" aria-label="${isVs(o) ? 'vs ' : ''}${o.name}">
    <div class="board mini" data-mini="${o.id}" inert></div>
    <div class="ocard-body">
      <div class="ocard-top"><h3>${isVs(o) ? 'vs ' : ''}${o.name}</h3><span class="ocard-tags">${tags}<span class="chip ${level}">${levelTxt}</span></span></div>
      <p class="omoves"><span class="eco">${o.eco}</span> ${moves.slice(0, -1).join(' ')} <b>${moves.at(-1)}</b></p>
      <p class="odesc">${about || `Starts ${numbered(o.root)}.`}</p>
      <div class="ostats">
        <span>${isVs(o) ? 'You meet it in' : 'Played in'} <b>${pctOf(o.share)}</b> of games</span>
        <span>${sideName(o.side)} wins <b>${pct(win)}</b></span>
        ${wdl(o, o.side)}
      </div>
    </div>
  </article>`;
}

let query = '';
let listSide = load(STORE + '-side', 'w'); // which list shows: openings you play as White, or as Black
const FIRST = 8; // the first few openings show, with a button for the rest
const showAll = { w: false, b: false };
// Kept for the phone's filter box, which starts folded.
const PHONE = matchMedia('(max-width: 560px)');
// Wide screens have the line list and moves in their own column, open.
if (matchMedia('(min-width: 1400px)').matches) document.querySelectorAll('.side details').forEach((d) => { d.open = true; });

function renderList() {
  const about = {
    w: (n) => `${sort === 'played' ? 'Most played first' : 'Best results first'}. ${style === 'any'
      ? `The ${n} most played openings at your level.`
      : `The ${n} most played ${STYLES[style].label.toLowerCase()} openings at your level.`}`,
    b: (n) => `The same ${n} White openings, from Black's side: how to meet them, ${sort === 'played' ? 'most often met first' : 'the ones Black does best against first'}. Search for your own defences, like the Sicilian.`,
  };
  const q = query.trim().toLowerCase();
  const list = q ? OPENINGS.filter((o) => o.family.toLowerCase().includes(q)).sort((a, b) => b.share - a.share) : shown();
  const count = (side) => list.filter((o) => o.side === side).length;
  let body;
  if (q) {
    body = `<p class="og-about">${list.length
      ? `${list.length} openings at your level match. "vs" means a White opening you answer as Black.`
      : `No opening at your level matches "${q.replace(/[<&"]/g, '')}".`}</p>
      <div class="olist">${list.map((o) => card(o).replace('</h3>', `<small class="as">you play ${sideName(o.side)}</small></h3>`)).join('')}</div>`;
  } else {
    const ops = list.filter((o) => o.side === listSide);
    const cut = !showAll[listSide] && ops.length > FIRST + 2;
    const empty = `<p class="info">No common ${style === 'any' ? '' : STYLES[style].label.toLowerCase() + ' '}openings for White at your level. Try another style.</p>`;
    body = `<p class="og-about">${about[listSide](ops.length)}</p>${ops.length ? '' : empty}
      <div class="olist">${(cut ? ops.slice(0, FIRST) : ops).map(card).join('')}</div>
      ${cut ? `<button type="button" class="ghost more" data-more="${listSide}">Show all ${ops.length}</button>` : ''}`;
  }
  listEl.innerHTML = `${q ? '<h2 class="og-h">Search results</h2>' : `<div class="seg side-seg" role="group" aria-label="Your side">
      ${['w', 'b'].map((side) => `<button type="button" data-side="${side}" aria-pressed="${side === listSide}">You play ${sideName(side)} <span class="og-n">${count(side)}</span></button>`).join('')}
    </div>`}${body}`;
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

listEl.addEventListener('click', (e) => {
  const more = e.target.closest('[data-more]');
  if (more) { showAll[more.dataset.more] = true; renderList(); }
  const side = e.target.closest('[data-side]');
  if (side) { listSide = side.dataset.side; store(STORE + '-side', listSide); renderList(); }
});
PHONE.addEventListener('change', (e) => { if (!e.matches) $('#filters').open = true; }); // desktop always shows the filters

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
    max: 100, rated: 'true', perfType: speed, moves: 'true', opening: 'true', clocks: 'false', evals: 'true',
  }), { headers: { Accept: 'application/x-ndjson' } });
  if (res.status === 404) throw new Error(`Lichess has no player called ${name}.`);
  if (res.status === 429) throw new Error('Lichess is busy right now. Try again in a minute.');
  if (!res.ok) throw new Error(`Lichess answered with an error (${res.status}).`);
  return (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// The opening you played in a game: the last opening name your own colour's moves gave the position
// (a White opening when you are White, a defence when you are Black), or, if your moves never named
// one, the opponent's opening as "vs". root: the moves up to where that name first appears.
function openingOf(moves, side) {
  const roots = new Map();
  let mine = null, theirs = null;
  for (let i = 0; i < Math.min(moves.length, 24); i++) {
    const seq = moves.slice(0, i + 1);
    const name = NAMES.get(lineKey(seq))?.name;
    const family = SYSTEMS.find((s) => s.test(seq, name))?.family ?? (name && familyOf(name));
    if (!family) continue;
    if (!roots.has(family)) roots.set(family, seq);
    if ((BLACKS.test(family) ? 'b' : 'w') === side) mine = family; else theirs = family;
  }
  const family = mine ?? theirs;
  return family && { family, vs: !mine, root: roots.get(family) };
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
    const moves = g.moves.split(' ').map(clean).slice(0, MAX_PLY);
    const mine = openingOf(moves, side);
    const family = mine?.family;
    if (mine) {
      const key = `${side}:${mine.vs ? 'vs:' : ''}${family}`;
      const o = openings.get(key) ?? { ...mine, side, games: 0, points: 0, won: 0, drawn: 0 };
      o.games++; o.points += points; o.won += points === 1; o.drawn += points === 0.5;
      openings.set(key, o);
    }
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
    openings: [...openings.values()].filter((o) => o.games >= 2).sort((a, b) => b.games - a.games),
  };
}
console.assert(analyse([], 'x').counted === 0, 'analyse');


// Your Lichess games in one compact box: what you play most as White and as Black (with how you score
// against players at your level), and what to train: the opening moves you keep getting wrong, then the
// mistakes you repeat in whole games.
function renderMine({ counted, slips, openings }, name) {
  $('#mine-out').innerHTML = '';
  const el = $('#my-openings');
  el.hidden = !counted;
  if (!counted) return ($('#mine-msg').textContent = `No rated ${speed} games found for ${name}.`);
  $('#mine-msg').textContent = `Checked ${name}'s last ${counted} rated ${speed} games.`;
  // The opening to practise: the listed one when there is one, otherwise one made from the game's moves.
  const find = (o) => OPENINGS.find((x) => x.family === o.family && x.side === o.side && isVs(x) === o.vs) ?? practiceOpening(o);
  const row = (o) => {
    const op = find(o), you = o.points / o.games;
    const avg = op.share ? (o.side === 'w' ? op.score : 1 - op.score) : null;
    const mark = avg === null ? '' : you - avg >= 0.05 ? 'up' : avg - you >= 0.05 ? 'down' : '';
    return `<li><button type="button" class="ml-row" data-my="${openings.indexOf(o)}">
      <span class="ml-name">${o.vs ? `${o.side === 'w' ? `1.${o.root[0]} ` : ''}vs ` : ''}${shortName(o.family)}</span>
      <span class="ml-meta">${plural(o.games, 'game')} · <b class="${mark}">${pct(you)}</b>${avg === null ? '' : ` <small>vs ${pct(avg)} at your level</small>`}</span>
    </button></li>`;
  };
  const side = (c) => openings.filter((o) => o.side === c).slice(0, 3);
  // A slip's opening, as you met it: "vs" when the name belongs to your opponent's colour.
  const slipOpening = (s) => ({ family: s.family, side: s.side, vs: BLACKS.test(s.family || '') !== (s.side === 'b'), root: s.before });
  const slipName = (s) => `${slipOpening(s).vs ? 'vs ' : ''}${shortName(s.family || 'Opening')}, move ${Math.floor(s.before.length / 2) + 1}`;
  el.innerHTML = `<div class="ml-col">
      <h2>What you play most</h2>
      ${['w', 'b'].map((c) => `<h3>As ${sideName(c)}</h3><ul class="ml-list">${side(c).map(row).join('') || '<li class="info">Too few games.</li>'}</ul>`).join('')}
    </div>
    <div class="ml-col">
      <h2>What to train</h2>
      <h3>Opening moves you get wrong</h3>
      <ul class="ml-list">${slips.slice(0, 3).map((s, n) => `<li><button type="button" class="ml-row" data-practise="${n}">
        <span class="ml-name">${slipName(s)}</span>
        <span class="ml-meta">you play <b class="down">${s.played}</b>, strong players <b>${s.best}</b> · ${plural(s.games, 'game')}</span>
      </button></li>`).join('') || '<li class="info">No repeated slips in the openings.</li>'}</ul>
      <h3>Mistakes in whole games</h3>
      <div id="my-mistakes"></div>
    </div>`;
  el.querySelectorAll('[data-my]').forEach((b) => b.addEventListener('click', () => start(find(openings[Number(b.dataset.my)]))));
  el.querySelectorAll('[data-practise]').forEach((b) => b.addEventListener('click', () => {
    const s = slips[Number(b.dataset.practise)];
    start(s.family ? find(slipOpening(s)) : practiceOpening(slipOpening(s)));
    const want = lineKey([...s.before, s.best]);
    const i = lines.findIndex((l) => lineKey(l.moves).startsWith(want));
    if (i >= 0) play(i);
  }));
}

// An opening made from your own games' moves, for ones the list does not hold (a defence you face as
// White, a rare line). Its figures come from games at your level that reached the same position.
function practiceOpening(o) {
  const mine = ratingsAround(rating);
  let node = TREE;
  for (const m of o.root) node = node?.[3]?.[m];
  const sum = (c) => mine.reduce((s, i) => s + c[i], 0);
  const n = node ? sum(node[0]) : 0;
  const win = n ? sum(node[1]) / n : 0, draw = n ? sum(node[2]) / n : 0;
  return { id: `${o.vs ? 'vs:' : ''}${o.side}~${o.family}`, name: shortName(o.family), family: o.family, side: o.side,
    eco: NAMES.get(lineKey(o.root))?.eco || '', root: o.root.join(' '), share: reachOf(o.root, mine), win, draw, score: win + draw / 2 };
}

// ---------- Mistakes from whole games ----------
let lastGames = null;   // the games fetched for "your games", kept for the whole-game check
let mistakeRun = 0;     // bumped to stop a check that is still running
const MISTAKES_KEY = STORE + '-mistakes';

function renderMistakes(state = 'ready', found = [], checked = 0, total = 0) {
  const el = $('#my-mistakes');
  if (!el || !lastGames) return;
  if (state === 'ready') {
    el.innerHTML = `<p class="info">All ${lastGames.games.length} of your recent games, not just the opening.</p>
      <button type="button" class="ghost" id="find-mistakes">Find my mistakes</button>`;
    return $('#find-mistakes').addEventListener('click', runMistakes);
  }
  const groups = byTheme(found).slice(0, 4);
  el.innerHTML = `${state === 'running' ? `<p class="info">Checking game ${checked} of ${total}…</p>` : ''}<ul class="ml-list">${groups.map(([theme, list]) => `<li class="ml-row ml-static">
      <span class="ml-name">${THEMES[theme].title}</span><span class="ml-meta"><b>${list.length}</b> in ${plural(checked, 'game')}</span></li>`).join('')
    || (state === 'running' ? '' : '<li class="info">No clear mistakes found.</li>')}</ul>
    ${found.length && state !== 'running' ? `<a class="cta" href="mistakes.html">Train your ${pickPuzzles(found).length} biggest mistakes</a>` : ''}`;
}

async function runMistakes() {
  const run = ++mistakeRun;
  const { games, name } = lastGames;
  renderMistakes('running', [], 0, 1);
  let done = 0;
  const found = await findMistakes(games, name, {
    evaluate: (fen) => evaluate(fen, { keep: true, ms: 60 }), // enough to confirm a tactical slip
    // Stop when you open the board (the engine is needed there) or start another check.
    stop: () => run !== mistakeRun || !$('#trainer').hidden,
    onProgress: (checked, total, sofar) => { done = checked; if (run === mistakeRun) renderMistakes('running', sofar, checked, total); },
  });
  if (run !== mistakeRun) return;
  store(MISTAKES_KEY, pickPuzzles(found));
  renderMistakes('done', found, done);
}

async function checkMyGames(name) {
  store(STORE + '-lichess-name', name);
  $('#mine-name').value = name;
  $('details.mine').open = true;
  $('#mine-msg').textContent = `Fetching ${name}'s last 100 rated ${speed} games from Lichess…`;
  $('#mine-out').innerHTML = '';
  try {
    await loadTree();
    lastGames = { games: await fetchGames(name), name };
    renderMine(analyse(lastGames.games, name), name);
    renderMistakes();
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
  const n = game.history().length - 1, note = notes[n];
  // At the line's end every offered move gets an arrow (green: real games, blue: Stockfish), unless
  // one is pointed at.
  const offered = ply >= line.length && game.history().length === line.length && userTurn() && !(tipHint !== null) ? tipArrows : [];
  drawBoard(boardEl, game, { side: cur.side, sel, last: lastMove, hint: hintSq, wrong: wrongSq,
    arrow: hintSq.length === 2 && !offered.length ? hintSq : null, arrows: offered,
    mark: (wrongSq && { sq: wrongSq, ok: false }) || (note && lastMove && { sq: lastMove.to, kind: note }),
    dests: sel && canPremove() ? premoveDests(sel).map((m) => m.to) : null, pre: premove ? [premove.from, premove.to] : [] });
}

function renderMoves() {
  const hist = game.history();
  let html = '';
  for (let i = 0; i < Math.max(line.length, hist.length); i += 2) {
    const cell = (j) => j < hist.length
      ? `<button type="button" class="mv ${j === hist.length - 1 ? 'now' : ''}" data-n="${j + 1}">${hist[j]}${notes[j] && notes[j] !== 'book' ? `<sup class="nag k-${notes[j]}">${GLYPH[notes[j]]}</sup>` : ''}</button>`
      : `<span class="mv todo">${j < line.length ? '…' : ''}</span>`;
    html += `<li><span class="num">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}</li>`;
  }
  movesEl.innerHTML = html;
  if (mode === 'time') return; // the trial's clock owns the progress bar
  $('#progress').textContent = mode === 'explore' ? 'Exploring' : playing ? 'Line done · playing it out' : line.length ? `${Math.min(ply, line.length)} of ${line.length} moves` : '';
  $('#bar').style.width = line.length ? `${Math.min(ply / line.length, 1) * 100}%` : '0';
}

function say(text, tone = '') {
  if ($('#trainer').hidden) return ($('#pick-msg').textContent = text);
  msgEl.textContent = text;
  msgEl.className = 'message ' + tone;
}

function render() { renderBoard(); renderMoves(); renderWhy(); renderControls(); renderMaterial(); renderEval(); }

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
  $('#hint').hidden = $('#show').hidden = mode === 'explore' || mode === 'time';
}

// ---------- Move explanations ----------
const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// What a move does, read off the board: development, centre, captures, checks, attacks.
function idea(before, san) {
  const g = new Chess();
  before.forEach((x) => g.move(x));
  return ideaAt(g, san);
}

console.assert(idea(['e4', 'e5'], 'Nf3').startsWith('Develops the knight. Attacks the pawn on e5.'), 'idea');

// The idea plus what real games say: how often the move is chosen here, and how you do after it.
function why(before, san) {
  return idea(before, san) || 'A sound move that scores well at your level.';
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
  return `<span class="reps">${top.map(part).join(' ')}${rest >= 0.01 ? ` <span class="rep">others ${pct(rest)}</span>` : ''}</span>`;
}

// A tip is a button: clicking it plays that move, and the game goes on from there.
$('#line-done').addEventListener('click', (e) => {
  const b = e.target.closest('.tip');
  if (b && userTurn() && !busy) { tipHint = null; tryMove(b.dataset.from, b.dataset.to); }
});
// Pointing at a tip shows its move as an arrow on the board; leaving puts the board back.
let tipHint = null;
$('#line-done').addEventListener('mouseover', (e) => {
  const b = e.target.closest('.tip');
  if (!b || !userTurn()) return;
  tipHint ??= hintSq;
  hintSq = [b.dataset.from, b.dataset.to];
  renderBoard();
});
$('#line-done').addEventListener('mouseout', (e) => {
  const b = e.target.closest('.tip');
  if (!b || b.contains(e.relatedTarget) || tipHint === null) return;
  hintSq = tipHint; tipHint = null;
  renderBoard();
});
$('#line-done').addEventListener('click', (e) => { if (e.target.closest('.done-next')) $('#restart').click(); });
let lineDone = '', tipArrows = []; // the summary shown at the end of the line, and the current tips
function renderWhy() {
  const el = $('#why');
  if (!cur || !line.length || mode === 'explore' || mode === 'time') { $('#line-done').hidden = true; return (el.innerHTML = ''); } // Explore explains in the message
  const hist = game.history();
  const label = (n, san) => `${Math.floor(n / 2) + 1}.${n % 2 ? '..' : ''}${san}`;
  const lower = (t) => t.replace(/^./, (c) => c.toLowerCase());
  const parts = [];
  // Before the first move, an introduction: what the opening is about and which line this is.
  if (!hist.length && lines[lineIdx]) {
    const l = lines[lineIdx], about = ABOUT[cur.family] || ABOUT[shortName(cur.family)] || '';
    const plan = planOf(cur);
    parts.push(`<p class="intro"><b>${isVs(cur) ? 'vs ' : ''}${cur.name}.</b> ${about} This is line ${lineIdx + 1} of ${lines.length}: <b>${lineName(l)}</b>, ${lineIdx ? 'the next most common way' : 'the most common way'} games in this opening go at your level (${pctOf(l.share)}). It runs to move ${Math.ceil(l.moves.length / 2)}.${l.trap
      ? ` <b>A trap:</b> at your level your opponent often plays ${Math.floor(l.trap.ply / 2) + 1}${l.trap.ply % 2 ? '...' : '.'}${l.trap.san} and scores only ${pct(l.trap.score)} after it. Learn how to punish it.` : ''}</p>${plan ? `<p class="intro plan"><b>Your plan:</b> ${plan}</p>` : ''}`);
  }
  // First what to play and why (Learn), then a quiet line on the last move, then the other replies
  // folded away: the board and the move to make come first.
  if (mode === 'learn' && userTurn() && ply < line.length) parts.push(`<p class="why-now"><b>Why</b> ${why(line.slice(0, ply), line[ply])}</p>`);
  if (hist.length) {
    const n = hist.length - 1;
    const before = hist.slice(0, n).map(clean), san = clean(hist[n]);
    const yours = (n % 2 === 0) === (cur.side === 'w');
    const text = yours ? why(before, san) : idea(before, san);
    parts.push(`<p class="prev">${yours ? 'You' : sideName(n % 2 ? 'b' : 'w')} played <b>${label(n, hist[n])}</b>${text ? `: ${lower(text)}` : ''}</p>`);
    const t = lines[lineIdx]?.trap;
    if (t && n === t.ply && mode !== 'explore') parts.push(`<p class="trap-now"><b>That is the mistake.</b> Players at your level score only ${pct(t.score)} after ${san}. Now punish it.</p>`);
    const reps = !yours && repliesText(before, san);
    if (reps) parts.push(`<details class="reps-box"><summary>What players at your level answer here</summary>${reps}</details>`);
  }
  if (game.isGameOver()) parts.unshift(gameStats());
  // Your last own move, when it was a slip: what it was and what was better (play-out only).
  const mine = hist.length - ((hist.length - 1) % 2 === (cur.side === 'w' ? 0 : 1) ? 1 : 2);
  if (playing && mine >= line.length && betters[mine]) {
    parts.push(`<p class="verdict k-${notes[mine]}"><b>${label(mine, hist[mine])} was ${NOTE_WORD[notes[mine]]}.</b> Better was ${moveWords(betters[mine])}.</p>`);
  }
  // The line-done summary is made at the line's end and stays while you play on from there. The tips
  // are about the move to play at the line's end, so they go once you have played on.
  if (ply >= line.length && hist.length === line.length) {
    const plan = planOf(cur);
    lineDone = `<p class="done-head"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>${lineName(lines[lineIdx])} done</p><p><b>What this line gave you</b> ${lineSummary()}</p>${lineFacts()}${plan ? `<p class="plan"><b>Your plan from here:</b> ${plan}</p>` : ''}`;
  }
  // "How to go on" is for the moment you start playing on: shown at the line's end, gone once you move.
  let tips = '';
  if (ply >= line.length && hist.length === line.length && userTurn()) {
    const t = lineTips();
    const arrows = t.map((x) => [x.move.from, x.move.to, x.engine ? '#1d5fbf' : '#15781b']);
    if (JSON.stringify(arrows) !== JSON.stringify(tipArrows)) { tipArrows = arrows; renderBoard(); }
    tips = t.length ? `<p><b>How to go on</b></p><ul class="tips">${t.map((x) => `<li><button type="button" class="tip" data-from="${x.move.from}" data-to="${x.move.to}">${x.html}</button></li>`).join('')}</ul>` : '';
  }
  el.innerHTML = parts.join('');
  $('#line-done').innerHTML = ply >= line.length && lineDone
    ? `<div class="summary">${lineDone}${tips}<button type="button" class="cta done-next">${$('#restart').textContent}</button></div>` : '';
  $('#line-done').hidden = !$('#line-done').innerHTML;
}

// Your side's wins, draws and losses (as shares) in games at your level that reached a position, or null.
function resultsAt(moves) {
  let node = TREE;
  for (const m of moves) node = node?.[3]?.[m];
  if (!node) return null;
  const sum = (c) => ratingsAround(rating).reduce((s, i) => s + c[i], 0);
  const n = sum(node[0]);
  if (n < MIN_GAMES) return null;
  const whiteWin = sum(node[1]) / n, draw = sum(node[2]) / n;
  const win = cur.side === 'w' ? whiteWin : 1 - whiteWin - draw;
  return { n, win, draw, loss: 1 - win - draw };
}
// The facts box at the end of a line: how games at your level went from the last position with enough games.
function lineFacts() {
  let k = line.length, r = null;
  while (k > 0 && !(r = resultsAt(line.slice(0, k)))) k--;
  if (!r) return '';
  const cell = (v, label) => `<div><b>${v}</b><span>${label}</span></div>`;
  return `<div class="facts" aria-label="From here at your level">${cell(pct(r.win), 'you win')}${cell(pct(r.draw), 'draws')}${cell(pct(r.loss), 'you lose')}${cell(r.n.toLocaleString('en'), 'games at your level')}</div>`;
}

// The end of the line, in a few plain sentences: whether players at your level do well from here
// (in words, not numbers), what the position offers you, and the material.
function endPosition() {
  const me = cur.side, them = me === 'w' ? 'b' : 'w', home = me === 'w' ? '1' : '8';
  const pieces = game.board().flat().filter(Boolean);
  const kingOf = (c) => pieces.find((p) => p.type === 'k' && p.color === c).square;
  const castled = game.history({ verbose: true }).some((m) => m.color === me && /[kq]/.test(m.flags));
  const minors = pieces.filter((p) => p.color === me && 'nb'.includes(p.type));
  const undeveloped = minors.filter((p) => ['b', 'c', 'f', 'g'].map((f) => f + home).includes(p.square));
  const centre = pieces.filter((p) => p.color === me && p.type === 'p' && CENTRE.includes(p.square)).map((p) => p.square);
  const points = (c) => pieces.filter((p) => p.color === c && p.type !== 'k').reduce((s, p) => s + VALUE[p.type], 0);
  const theirKing = kingOf(them);
  return { me, them, castled, kingHome: kingOf(me)[0] === 'e' && kingOf(me)[1] === home, minors, undeveloped, centre,
    lead: points(me) - points(them), theirKingInCentre: theirKing[0] === 'e' && theirKing[1] === (them === 'w' ? '1' : '8') };
}
const andList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);

function lineSummary() {
  const out = [];
  const p = endPosition();
  const facts = [];
  if (p.castled) facts.push('your king is castled');
  if (p.minors.length) facts.push(p.undeveloped.length ? `${p.minors.length - p.undeveloped.length} of your ${p.minors.length} knights and bishops are out` : 'all your knights and bishops are out');
  if (p.centre.length) facts.push(`you have ${p.centre.length === 1 ? 'a pawn' : 'pawns'} on ${p.centre.join(' and ')}`);
  if (facts.length) out.push(andList(facts).replace(/^./, (c) => c.toUpperCase()) + '.');
  if (p.lead > 0) out.push('You are ahead in material.');
  if (p.lead < 0) out.push('You have given material for activity.');
  return out.join(' ');
}

// How to go on, for your move now: the move that scores best in games at your level, the next best,
// and Stockfish's choice, each with what the move does. Game moves need MIN_GAMES games to count.
// The plan for an opening, from the side you play it: your own opening's plan, or Black's against it.
const planOf = (o) => (isVs(o) ? VS_PLAN : PLAN)[o.family] || (isVs(o) ? VS_PLAN : PLAN)[shortName(o.family)] || '';

// The rating group that played a move here most often, e.g. "1600–1800" (the data has no names).
function whoPlayed(moves, san) {
  let node = TREE;
  for (const m of [...moves, san]) node = node?.[3]?.[m];
  if (!node) return 'unknown';
  const i = node[0].indexOf(Math.max(...node[0]));
  return BUCKETS[i + 1] ? `${BUCKETS[i]}–${BUCKETS[i + 1]}` : `${BUCKETS[i]}+`;
}

// Two moves from real games and one from Stockfish: the best-scoring moves among those played in
// enough games, topped up with the most played ones (with their game count, since a score from a few
// games says little), then Stockfish's best move not already listed. Where no game reaches the
// position, Stockfish fills all three.
function lineTips() {
  const at = game.fen(), me = cur.side;
  const say = (m) => { const idea = ideaAt(new Chess(at), m.san); return `${moveWords(m)}${idea ? `. ${idea}` : '.'}`; };
  const played = gamesAt(game.history().map(clean)).moves; // most played first
  const solid = played.filter((m) => m.n >= MIN_GAMES).sort((a, b) => scoreFor(b, me) - scoreFor(a, me));
  const games = [...solid, ...played.filter((m) => m.n < MIN_GAMES)].slice(0, 2);
  const engine = topMoves(at).map((m) => new Chess(at).move(m));
  const tips = games.map((m, i) => {
    const move = new Chess(at).move(m.san);
    const agrees = move.san === engine[0]?.san ? ' Stockfish agrees.' : '';
    const label = m.n < MIN_GAMES ? 'Also played' : i ? 'Next best in games' : 'Best results in games';
    const how = m.n < MIN_GAMES
      ? `Played in ${plural(m.n, 'game')}, mostly by players rated ${whoPlayed(game.history().map(clean), m.san)}; they scored ${pct(scoreFor(m, me))}.`
      : `You score ${pct(scoreFor(m, me))} after it in ${plural(m.n, 'game')}.`;
    return { move, html: `<b>${label}:</b> ${say(move)} ${how}${agrees}` };
  });
  const RANK = ["Stockfish's choice", "Stockfish's second choice", "Stockfish's third choice"];
  engine.forEach((move, i) => {
    if (tips.length < 3 && !tips.some((t) => t.move.san === move.san)) tips.push({ move, engine: true, html: `<b>${RANK[i]}:</b> ${say(move)}` });
  });
  return tips;
}

// ---------- Game ----------
function start(op) {
  if (mode === 'explore') setMode('learn', false);
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
  if (mode === 'time') startTrial(); else play(nextLine());
}

function play(i) {
  lineIdx = i;
  const l = lines[i];
  line = l.moves;
  game = new Chess();
  ply = 0; sel = null; hintSq = []; wrongSq = null; lastMove = null;
  misses = 0; missesHere = 0; busy = false;
  gameGen++; // ignore an opponent reply still on its way from the previous game
  playing = false;
  premove = null; notes = []; betters = []; lineDone = '';
  clearShapes(boardEl);
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
// What comes next, in words: the usual move here (or Stockfish's where games run out) as an arrow, and
// what it aims to do.
function exploreSay(prefix = '') {
  const at = game.fen(), side = game.turn();
  const top = explore(game.history().map(clean), ratingsAround(rating)).moves.find((m) => m.n >= MIN_GAMES);
  const next = (m, who) => {
    hintSq = [m.from, m.to];
    renderBoard();
    const aim = ideaAt(new Chess(at), m.san);
    say(`${prefix}Next for ${sideName(side)}: ${moveWords(m)}${who}.${aim ? ' ' + aim : ''}`);
  };
  if (top) return next(new Chess(at).move(top.san), '');
  hintSq = [];
  renderBoard();
  say(prefix + 'Real games at your level run out here.');
  evaluate(at).then((r) => { if (r?.move && game.fen() === at && mode === 'explore') next(new Chess(at).move(r.move), ', Stockfish\'s choice'); });
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
  notes.length = betters.length = hist.length;
  rate(hist.length, m.before, m);
  render();
  if (game.isCheckmate()) { say(`${prefix}${m.san} is checkmate. ${sideName(m.color)} wins.`, 'good'); if (m.color === cur.side) celebrate(); return true; }
  if (game.isGameOver()) { say(`${prefix}${m.san}: the game is drawn.`); return true; }
  // Why the move: what it does on the board.
  const idea = ideaAt(new Chess(m.before), m.san);
  const verdict = `${m.color === cur.side ? '' : `${sideName(m.color)} answers `}${m.san}${idea ? `: ${idea.replace(/^./, (c) => c.toLowerCase())}` : '.'} `;
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
let playing = false; // the line is done and you play the game on: real players' moves, then Stockfish
const userTurn = () => (ply < line.length || playing) && !game.isGameOver() && game.turn() === cur.side;

// ---------- Play it out ----------
// Stockfish 18 lite (WebAssembly, single-threaded, GPLv3) from github.com/nmrugg/stockfish.js, in engine/.
// Only used once you play a game out past the line: as the opponent where real games run out, and for hints.
const ENGINE_SRC = 'engine/stockfish-18-lite-single.js';
let engine = null, engineDone = null, engineQueue = Promise.resolve();
// The opponent plays at your rating; Stockfish's lowest setting is 1320, so below that it is a little stronger.
const opponentElo = () => Math.max(1320, Math.min(3190, rating));
// One search at a time: changing options while the WebAssembly engine searches crashes it.
// Resolves { move, cp, mate } with the score from the side to move, or null. skip() is asked when the
// search's turn comes: a search for a position you have already left is dropped.
// multi: how many best moves to rank (MultiPV); their first moves come back as lines, best first.
function search(fen, { elo = null, ms = 500, skip = null, multi = 1 } = {}) {
  const run = () => new Promise((resolve) => {
    if (skip?.()) return resolve(null);
    if (!engine) {
      engine = new Worker(ENGINE_SRC);
      engine.addEventListener('error', () => { engine = null; engineDone?.(null); });
    }
    engineDone = resolve;
    let cp = 0, mate = null, pv = [];
    const lines = [];
    const toMove = (uci) => (uci && uci !== '(none)' ? { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] } : null);
    engine.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      const sc = e.data.match(/ score (cp|mate) (-?\d+)/);
      if (sc && !/ (lower|upper)bound/.test(e.data)) {
        const k = Number(e.data.match(/ multipv (\d+)/)?.[1] || 1);
        if (k === 1) { if (sc[1] === 'cp') { cp = Number(sc[2]); mate = null; } else mate = Number(sc[2]); pv = (e.data.match(/ pv (.+)$/)?.[1] || '').split(' '); }
        lines[k - 1] = toMove(e.data.match(/ pv (\S+)/)?.[1]);
      }
      if (!e.data.startsWith('bestmove')) return;
      resolve({ move: toMove(e.data.split(' ')[1]), cp, mate, pv, lines: lines.filter(Boolean) });
    };
    engine.postMessage(`setoption name MultiPV value ${multi}`);
    engine.postMessage(`setoption name UCI_LimitStrength value ${!!elo}`);
    if (elo) engine.postMessage(`setoption name UCI_Elo value ${elo}`);
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(`go movetime ${ms}`);
  });
  return (engineQueue = engineQueue.then(run, run));
}
const bestMove = (fen, opts) => search(fen, opts).then((r) => r?.move ?? null);
// Stockfish's three best moves in a position, for How to go on; cached, and the tips redraw when ready.
const TOPS = new Map();
function topMoves(fen) {
  const k = evalKey(fen);
  if (!TOPS.has(k)) {
    TOPS.set(k, null);
    search(fen, { ms: 500, multi: 3 }).then((r) => { TOPS.set(k, r?.lines || []); if (cur && game.fen() === fen) renderWhy(); });
  }
  return TOPS.get(k) || [];
}

// ---------- Evaluation: the bar and the move badges ----------
// Stockfish's full-strength verdict on a position, cached by position. keep: search it even if you
// have moved on (a move being rated needs the position before it).
const EVALS = new Map(), EVALS_PENDING = new Map();
const evalKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
function evaluate(fen, { keep = false, ms = 350 } = {}) {
  const k = evalKey(fen);
  if (EVALS.has(k)) return Promise.resolve(EVALS.get(k));
  if (EVALS_PENDING.has(k)) return EVALS_PENDING.get(k);
  const p = search(fen, { ms, skip: () => !keep && (!cur || game.fen() !== fen) }).then((r) => {
    EVALS_PENDING.delete(k);
    if (r) { EVALS.set(k, r); renderEval(); if (playing && cur && game.fen() === fen) renderWhy(); } // the tips can use it
    return r;
  });
  EVALS_PENDING.set(k, p);
  return p;
}
// A score in centipawns from the side to move; a mate counts as 100 pawns ("mate 0": you are mated).
const toCp = (r) => (r.mate === null ? r.cp : r.mate > 0 ? 10000 : -10000);
// Lichess's winning chances, 0-100, from centipawns.
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);

function renderEval() {
  if (!cur) return;
  const el = $('#evalbar');
  const fen = game.fen();
  let r = EVALS.get(evalKey(fen));
  if (game.isCheckmate()) r = { cp: 0, mate: 0 };
  else if (game.isDraw()) r = { cp: 0, mate: null };
  el.classList.toggle('stale', !r);
  el.classList.toggle('flip', cur.side === 'b');
  if (!r) { if (!$('#trainer').hidden) evaluate(fen); return; }
  const white = (game.turn() === 'w' ? 1 : -1) * toCp(r);
  const share = r.mate !== null ? (white > 0 ? 100 : 0) : winPct(white);
  el.querySelector('.evalbar-white').style.height = `${share}%`;
  el.querySelector('.evalbar-num').textContent = r.mate !== null ? (r.mate === 0 ? '#' : `M${Math.abs(r.mate)}`) : (Math.min(Math.abs(white), 2000) / 100).toFixed(1);
  el.classList.toggle('behind', share < 12);
  el.setAttribute('aria-label', `Stockfish: ${r.mate !== null ? `mate for ${white > 0 ? 'White' : 'Black'}` : Math.abs(white) < 30 ? 'equal' : `${white > 0 ? 'White' : 'Black'} is better by ${(Math.abs(white) / 100).toFixed(1)} pawns`}`);
}

// Move badges, as in an analysis on Lichess or chess.com. notes[i] rates the move at ply i: book
// (the line's own moves), brilliant, best, good, inaccuracy, mistake or blunder. Thresholds are Lichess's:
// a move that drops the mover's winning chances by 5, 10 or 15 points (of 100) is an inaccuracy, a mistake
// or a blunder. A brilliant move is the engine's best that leaves a piece hanging.
let notes = [], betters = [];
const NOTE_WORD = { brilliant: 'brilliant', best: 'the best move', good: 'good', inaccuracy: 'an inaccuracy', mistake: 'a mistake', blunder: 'a blunder' };
const VALUE_OF = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function leavesPieceHanging(g, m) {
  if ('pk'.includes(m.piece)) return false;
  const them = m.color === 'w' ? 'b' : 'w';
  const attackers = g.attackers ? g.attackers(m.to, them) : [];
  if (!attackers.length) return false;
  const cheapest = Math.min(...attackers.map((sq) => VALUE_OF[g.get(sq).type]));
  return cheapest < VALUE_OF[m.piece] || !g.isAttacked(m.to, m.color);
}
async function rate(i, before, m) {
  const gen = gameGen;
  const g = new Chess(before);
  g.move(m.san);
  if (g.isCheckmate()) { notes[i] = 'best'; return renderNotes(gen); }
  const [b, a] = await Promise.all([evaluate(before, { keep: true }), evaluate(g.fen(), { keep: true })]);
  if (!b || !a || gen !== gameGen) return;
  const loss = winPct(toCp(b)) - winPct(-toCp(a));
  const isBest = b.move && b.move.from === m.from && b.move.to === m.to;
  notes[i] = loss >= 15 ? 'blunder' : loss >= 10 ? 'mistake' : loss >= 5 ? 'inaccuracy'
    : isBest ? (leavesPieceHanging(g, m) && winPct(-toCp(a)) >= 45 ? 'brilliant' : 'best') : 'good';
  if (loss >= 5 && b.move) betters[i] = new Chess(before).move(b.move);
  renderNotes(gen);
}
function renderNotes(gen) { if (gen === gameGen && cur) { renderBoard(); renderMoves(); renderWhy(); } }

// The best move for you here, by Stockfish at full strength (the same search the evaluation bar uses,
// so it is usually ready already); what strong players play most if the engine has no answer.
async function goodMove() {
  const at = game.fen();
  const r = await evaluate(at, { keep: true, ms: 600 });
  if (game.fen() !== at) return null;
  if (r?.move) return new Chess(at).move(r.move);
  const strong = strongGroups(game.history().map(clean)).x.moves.find((m) => m.n >= MIN_GAMES);
  return strong ? new Chess(at).move(strong.san) : null;
}
// What kind of move the best one is, without giving it away.
function hintFor(m) {
  const g = new Chess(game.fen());
  g.move(m.san);
  if (g.isCheckmate()) return 'There is a checkmate.';
  if (g.inCheck()) return 'Look for a check.';
  if (m.captured) return `Look for a capture: the best move takes a ${PIECE[m.captured]}.`;
  const danger = hanging(game, game.turn())[0];
  if (danger) return `Your ${PIECE[danger.type]} on ${danger.square} is in danger.`;
  return 'Look for the move that improves your worst piece.';
}

let engineSaid = false; // the switch to Stockfish is mentioned once per game
async function opponentPlays() {
  busy = true;
  const gen = gameGen, at = game.fen();
  // Follow the real games as long as any reach this position: the reply played most there.
  const real = gamesAt(game.history().map(clean)).moves[0];
  const m = real ? { san: real.san } : await bestMove(at, { elo: opponentElo() });
  await new Promise((x) => setTimeout(x, 450));
  if (gen !== gameGen || game.fen() !== at || !m) { if (gen === gameGen) busy = false; return; }
  lastMove = game.move(m.san ?? m); ply++; busy = false; hintSq = [];
  rate(ply - 1, at, lastMove);
  render();
  if (ended()) return;
  if (playPremove()) return;
  const note = !real && !engineSaid ? ' Real games at your level run out here, so Stockfish plays the opponent now, at your rating.' : '';
  if (!real) engineSaid = true;
  say(`Your move.${note}`);
}

function ended() {
  if (!game.isGameOver()) return false;
  if (!game.isCheckmate()) say('Draw. Press Next line to go on.');
  else if (game.turn() === cur.side) say('Checkmate: you lost this one. Press Restart to play the line again.', 'bad');
  else { say('Checkmate! You won.', 'good'); celebrate(); }
  return true;
}

// When the game is over: how your moves were rated, kind by kind (badges arrive as Stockfish rates them).
const KINDS = ['brilliant', 'best', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];
const KIND_NAME = { brilliant: 'Brilliant', best: 'Best', good: 'Good', book: 'Book', inaccuracy: 'Inaccuracies', mistake: 'Mistakes', blunder: 'Blunders' };
function gameStats() {
  const mine = notes.filter((k, i) => k && (i % 2 === 0) === (cur.side === 'w'));
  const count = (k) => mine.filter((x) => x === k).length;
  const badge = (k) => `<span class="mark k-${k} legend-badge">${k === 'book' ? BOOK_ICON : GLYPH[k]}</span>`;
  const result = game.isCheckmate() ? (game.turn() === cur.side ? 'You were checkmated' : 'You won by checkmate') : 'Draw';
  return `<div class="game-stats"><p class="gs-head">${result} · your ${plural(mine.length, 'move')}</p>
    <ul>${KINDS.map((k) => `<li class="${count(k) ? '' : 'none'}">${badge(k)}<b>${count(k)}</b> ${KIND_NAME[k]}</li>`).join('')}</ul></div>`;
}
const BOOK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6c3-1.5 5.5-1.5 8 0 2.5-1.5 5-1.5 8 0v12c-3-1.5-5.5-1.5-8 0-2.5-1.5-5-1.5-8 0zM12 6v12"/></svg>';

// A short banner over the board, for the end of a line.
function flash(text) {
  const frame = $('.board-frame');
  frame.querySelector('.mate-banner')?.remove();
  frame.insertAdjacentHTML('beforeend', `<div class="mate-banner line-banner" role="status">${text}</div>`);
  setTimeout(() => frame.querySelector('.line-banner')?.remove(), 1800);
}

// Checkmate by you: a banner over the board and a short burst of confetti (no confetti with reduced motion).
function celebrate() {
  const frame = $('.board-frame');
  frame.querySelector('.mate-banner')?.remove();
  frame.insertAdjacentHTML('beforeend', '<div class="mate-banner" role="status">Checkmate!</div>');
  setTimeout(() => frame.querySelector('.mate-banner')?.remove(), 3500);
  if (REDUCE_MOTION) return;
  const box = frame.getBoundingClientRect();
  const colours = ['#2e7d32', '#1d5fbf', '#e0b23a', '#c4242a', '#f0d9b5', '#b58863'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.cssText = `left:${box.left + Math.random() * box.width}px;top:${box.top - 10}px;background:${colours[i % colours.length]};`
      + `--dx:${(Math.random() - 0.5) * 240}px;--rot:${Math.random() * 720}deg;animation-delay:${Math.random() * 0.4}s;animation-duration:${1.6 + Math.random()}s`;
    document.body.append(c);
    setTimeout(() => c.remove(), 3200);
  }
}



// A move that is not the line's: whether strong players choose it too, and whether it does worse
// in games at your level than the line's move. In words, not numbers.
function explainWrong(san) {
  const before = line.slice(0, ply);
  const strong = strongGroups(before);
  const want = expectedMove();
  const share = (s) => strong.x.moves.find((x) => x.san === s)?.n / strong.x.total || 0;
  const mine = explore(before, ratingsAround(rating)).moves;
  const score = (s) => { const m = mine.find((x) => x.san === s); return m && m.n >= MIN_GAMES ? scoreFor(m, cur.side) : null; };
  const lineMove = mode === 'learn' ? want.san : "the line's move";
  const parts = [share(clean(san)) >= RARE ? 'It is playable, but this line practises another move.' : 'Strong players rarely play it here.'];
  const a = score(clean(san)), b = score(want.san);
  if (a !== null && b !== null && b - a >= 0.03) parts.push(`Players at your level do better after ${lineMove}.`);
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
  // The working set: the first COHORT lines not yet cleared, in course order. A new line joins only
  // when one of them is cleared; within the set, the line you missed last comes first, then the others
  // in turn, never the one you just played if another is waiting.
  const open = practiceSet();
  if (!open.length) return lineIdx;
  const missed = open.filter((i) => s.rep?.[key(lines[i])] && i !== lineIdx);
  const next = open.find((i) => i > lineIdx) ?? open[0];
  return missed[0] ?? (open.length > 1 && next === lineIdx ? open.find((i) => i !== lineIdx) : next);
}
const COHORT = 3;
const practiceSet = () => {
  const s = stats[statKey(cur.id)] || {};
  return lines.map((l, i) => i).filter((i) => !s.done?.includes(lineKey(lines[i].moves))).slice(0, COHORT);
};

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
    ${s.done?.includes(lineKey(l.moves)) ? '<p class="lb-status cleared"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>You have cleared this line</p>'
      : s.played?.includes(lineKey(l.moves)) ? '<p class="lb-status"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>You have learned this line</p>' : ''}
    <div class="lb-stats">
      <div><b>${pctOf(l.share)}</b><span>of games in this opening go this way</span></div>
      <div><b>1 in ${oneIn.toLocaleString('en')}</b><span>of all your ${speed} games reach it</span></div>
      <div><b>${played}/${n}</b><span>lines learned</span></div>
      <div><b>${done}/${n}</b><span>lines cleared${due ? `, ${due} due for review` : ''}</span></div>
    </div>
    <div class="lb-bar" aria-hidden="true"><span class="lb-done" style="width:${(done / n) * 100}%"></span><span class="lb-played" style="width:${(Math.max(0, played - done) / n) * 100}%"></span></div>
    ${mode === 'try' && practiceSet().length ? `<p class="lb-note">Practising lines ${practiceSet().map((i) => i + 1).join(', ')}.</p>` : ''}
    <p class="lb-note">${nextReview ? nextReview + ' ' : ''}Progress is saved in this browser.</p>`;
}

function renderLines() {
  const s = stats[statKey(cur.id)] || {}, done = s.done || [], learned = s.played || [];
  $('#lines-sum').textContent = `All ${lines.length} lines`; // the line box above already counts the cleared ones
  // Green once you have played a line through (Learn), stronger with a tick once cleared (Practice).
  const state = (l) => (done.includes(lineKey(l.moves)) ? ' cleared' : learned.includes(lineKey(l.moves)) ? ' learned' : '');
  $('#lines-list').innerHTML = lines.map((l, i) => `<li><button type="button" class="line-btn${i === lineIdx ? ' now' : ''}${state(l)}" data-i="${i}">
      <span class="line-n">${i + 1}.</span><span class="line-name">${l.trap ? '<span class="trap-tag">Trap</span> ' : ''}${lineName(l)}<small>${lineEnd(l)}</small></span>
      <span class="line-share">${pctOf(l.share)}</span><span class="line-ok">${state(l) ? `<span class="done-tag"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>${state(l) === ' cleared' ? 'Cleared' : 'Learned'}</span>` : ''}</span>
    </button></li>`).join('');
}
$('#lines-list').addEventListener('click', (e) => {
  const b = e.target.closest('.line-btn');
  if (b) play(Number(b.dataset.i));
});

function showComplete() {
  $('#complete-title').textContent = `${isVs(cur) ? 'vs ' : ''}${cur.name}: complete`;
  $('#complete-text').textContent = `You cleared all ${lines.length} lines: every common reply at ${levelText(rating)} in ${speed}, each played from memory without a mistake.`;
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
    notes[ply - 1] = 'book';
    render();
    if (ply >= line.length) return finish();
    if (playPremove()) return;
    if (mode !== 'time') prompt('Your move.'); // in a trial the last right/wrong note stays up
  }, mode === 'time' ? 150 : 450);
}

// ---------- Time trial ----------
// The lines from memory against the clock: a right move adds time, a wrong one takes some and the
// right move is played for you; a finished line goes straight on to another. The best score is kept.
const TRIAL_S = 60, TRIAL_RIGHT = 2, TRIAL_WRONG = 5;
let trial = null; // { end, score, done, timer }
function startTrial() {
  stopTrial();
  trial = { end: Date.now() + TRIAL_S * 1000, score: 0, done: 0, timer: setInterval(tickTrial, 100) };
  $('#restart').textContent = 'Restart';
  play(Math.floor(Math.random() * lines.length));
  say('Go! Play the lines from memory.');
}
function stopTrial() { if (trial) clearInterval(trial.timer); trial = trial && { ...trial, timer: null }; }
function tickTrial() {
  const left = trial.end - Date.now();
  $('#progress').textContent = `${Math.max(0, Math.ceil(left / 1000))} s · ${plural(trial.score, 'move')} right`;
  $('#bar').style.width = `${Math.max(0, Math.min(1, left / (TRIAL_S * 1000))) * 100}%`;
  if (left > 0) return;
  clearInterval(trial.timer);
  gameGen++; busy = true; // the trial is over: no more moves
  const s = stats[statKey(cur.id)];
  const best = Math.max(s.timeBest || 0, trial.score);
  const record = trial.score > (s.timeBest || 0);
  s.timeBest = best; store(STORE, stats);
  say(`Time! ${plural(trial.score, 'move')} right, ${plural(trial.done, 'line')} finished. ${record ? 'A new best!' : `Your best: ${best}.`} Press Restart to go again.`, 'good');
}

function tryMove(from, to) {
  let m;
  try { m = game.move({ from, to, promotion: 'q' }); } catch { return false; }
  if (!m) return false;
  if (playing) {
    lastMove = m; ply++; sel = null; hintSq = [];
    rate(ply - 1, game.history({ verbose: true }).at(-1).before, m);
    render();
    if (!ended()) opponentPlays();
    return true;
  }
  if (mode === 'time' && clean(m.san) !== line[ply]) {
    game.undo();
    trial.end -= TRIAL_WRONG * 1000;
    wrongSq = to; sel = null; shake(boardEl);
    setTimeout(() => { wrongSq = null; renderBoard(); }, 500);
    lastMove = game.move(line[ply]); ply++;
    say(`Not ${m.san}: it was ${lastMove.san}. −${TRIAL_WRONG} s`, 'bad');
    render();
    if (ply >= line.length) finish(); else reply();
    return true;
  }
  if (mode === 'time') { trial.end += TRIAL_RIGHT * 1000; trial.score++; }
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
  say(mode === 'time' ? `Right: ${m.san}. +${TRIAL_RIGHT} s` : `Right: ${moveWords(m)}.`, 'good');
  notes[ply - 1] = 'book';
  render();
  if (ply >= line.length) finish(); else reply();
  return true;
}

function expectedMove() {
  return new Chess(game.fen()).move(line[ply]);
}

// In Learn mode the move to play is always shown.
function prompt(text) {
  if (mode !== 'learn' || !userTurn() || ply >= line.length) return say(text);
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
  if (mode === 'time') { trial.done++; return setTimeout(() => { if (mode === 'time' && trial.end > Date.now()) play((lineIdx + 1 + Math.floor(Math.random() * (lines.length - 1))) % lines.length); }, 300); }
  const s = stats[statKey(cur.id)];
  if (!s.played.includes(lineKey(line))) s.played.push(lineKey(line));
  store(STORE, stats);
  const wasComplete = cleared() === lines.length;
  const r = mode === 'try' ? review(misses === 0) : null;
  renderLines();
  renderLineBox();
  $('#restart').textContent = mode === 'try' && misses ? 'Try again' : 'Next line';
  const on = 'Play on if you like: the arrow shows a good next move.';
  if (mode === 'learn') say(`Line learned. ${on} Or press Next line, or switch to Practice to play it from memory.`, 'good');
  else if (misses) say(`Line done with ${plural(misses, 'mistake')}, so it is not cleared. ${on} Or press Try again.`, 'bad');
  else {
    if (!wasComplete && cleared() === lines.length) showComplete();
    const back = `It comes back for review in ${plural(INTERVALS[r.box], 'day')}.`;
    say(`${cleared() === lines.length ? 'Line cleared. Every common line at your level is cleared.' : `Line cleared, ${cleared()} of ${lines.length}.`} ${back} ${on}`, 'good');
  }
  flash(mode === 'try' && misses ? 'Line done' : mode === 'try' ? 'Line cleared' : 'Line learned');
  // From here the game simply goes on: any move you make plays it out.
  playing = true; engineSaid = false;
  renderWhy(); // How to go on needs playing set
  if (game.turn() !== cur.side) return opponentPlays();
  const at = game.fen();
  goodMove().then((m) => { if (m && playing && game.fen() === at) { hintSq = [m.from, m.to]; renderBoard(); } });
}

// In Explore you move whichever side is to move; otherwise only your own side, on your turn.
const canMove = () => !busy && (mode === 'explore' ? cur && !game.isGameOver() : userTurn());
const mover = () => (mode === 'explore' ? game.turn() : cur.side);
const move = (from, to) => (mode === 'explore' ? exploreMove(from, to) : tryMove(from, to));

// Premove, as on Lichess: during the opponent's turn you may queue your next move (its squares are
// marked blue); it is played the moment it is your turn, if it is still legal. A right-click cancels it.
let premove = null;
const canPremove = () => !!cur && mode !== 'explore' && line.length > 0 && (ply < line.length || playing)
  && game.turn() !== cur.side && !game.isGameOver();
const premoveDests = (sq) => asMover(game, cur.side)?.moves({ square: sq, verbose: true }) || [];
function setPremove(from, to) {
  if (!premoveDests(from).some((m) => m.to === to)) return false;
  premove = { from, to };
  sel = null;
  renderBoard();
  return true;
}
function playPremove() {
  const p = premove;
  premove = null;
  if (!p || !userTurn()) return false;
  return tryMove(p.from, p.to);
}
boardEl._destsFor = (sq) => (canPremove() ? premoveDests(sq) : game.moves({ square: sq, verbose: true }));
boardEl.addEventListener('contextmenu', () => { if (premove) { premove = null; renderBoard(); } });

enableDrag(boardEl, {
  canDrag: (sq) => (canMove() || canPremove()) && game.get(sq)?.color === mover(),
  onDrop: (from, to) => {
    sel = null;
    if (canPremove()) { if (!setPremove(from, to)) renderBoard(); return; }
    if (!move(from, to)) renderBoard();
  },
});
boardEl.addEventListener('click', (e) => {
  const b = e.target.closest('.sq');
  if (!b) return;
  if (!canMove() && canPremove()) {
    const sq = b.dataset.sq, p = game.get(sq);
    if (sel && sel !== sq && setPremove(sel, sq)) return;
    premove = null;
    sel = p && p.color === cur.side && sel !== sq ? sq : null;
    return renderBoard();
  }
  if (!canMove()) return;
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

// While you play on after a line, back is a take-back, as on Lichess: your last move (and the reply to
// it) is undone and you play on against the same opponent. It never goes back into the line itself.
function takeBack() {
  gameGen++; // a reply still on its way no longer applies
  game.undo();
  while (game.turn() !== cur.side && game.history().length > line.length) game.undo();
  ply = game.history().length;
  notes.length = betters.length = ply;
  lastMove = game.history({ verbose: true }).at(-1) || null;
  premove = null; busy = false; sel = null; hintSq = [];
  render();
  if (game.turn() !== cur.side) return opponentPlays(); // back at the line's end on their move
  say('Move taken back. Your move.');
}

// Clicking a move in the list goes back to the position after it: a take-back while you play on,
// otherwise Explore from there (as stepping back does), with Forward replaying the moves.
function goTo(n) {
  if (!cur || n >= game.history().length || (mode === 'explore' && busy)) return;
  gameGen++; // a reply still on its way no longer applies
  premove = null; busy = false; sel = null; hintSq = [];
  if (mode !== 'explore' && playing && n >= line.length) {
    while (game.history().length > n) game.undo();
    ply = n; notes.length = betters.length = n;
    lastMove = game.history({ verbose: true }).at(-1) || null;
    render();
    return game.turn() !== cur.side ? opponentPlays() : say('Back to that move. Your move.');
  }
  if (mode !== 'explore') setMode('explore', false, false);
  while (game.history().length > n) redo.push(game.undo());
  ply = n;
  lastMove = game.history({ verbose: true }).at(-1) || null;
  render();
  exploreSay('Back to that move. Move any piece, for either side. ');
}
movesEl.addEventListener('click', (e) => { const b = e.target.closest('.mv[data-n]'); if (b) goTo(Number(b.dataset.n)); });

function stepBack() {
  if (!cur || !lines.length || !game.history().length) return;
  if (mode !== 'explore' && playing && game.history().length > line.length) return takeBack();
  if (mode !== 'explore') { setMode('explore', false, false); gameGen++; } // the line's pending reply no longer applies
  else if (busy) return;
  redo.push(game.undo());
  lastMove = game.history({ verbose: true }).at(-1) || null;
  ply = game.history().length;
  premove = null;
  busy = false; sel = null;
  render();
  exploreSay('Stepped back. Move any piece, for either side. ');
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
  if (mode === 'time') return startTrial();
  if (mode === 'learn') return play(ply >= line.length ? nextLine() : lineIdx);
  play(ply >= line.length && misses === 0 ? nextLine() : lineIdx);
});
$('#hint').addEventListener('click', async () => {
  if (!userTurn() || busy) return;
  if (playing) {
    const m = await goodMove();
    if (!m || !userTurn()) return;
    hintSq = [m.from]; renderBoard();
    return say(`The piece to move is highlighted. ${hintFor(m)}`);
  }
  showHint(); say('The piece to move is highlighted.');
});
$('#show').addEventListener('click', async () => {
  if (!userTurn() || busy) return;
  if (playing) {
    const at = game.fen(), m = await goodMove();
    if (!m || game.fen() !== at) return;
    const why = ideaAt(new Chess(at), m.san);
    hintSq = [m.from, m.to]; renderBoard();
    return say(`Best move: ${instruction(m)}.${why ? ' ' + why : ''}`);
  }
  const m = expectedMove();
  misses++;
  say(`The move: ${instruction(m)}.`);
  hintSq = [m.from, m.to]; renderBoard();
});
// Opening picker, shown before the board.
async function showPicker() {
  cur = null; gameGen++; stopTrial(); // stops an opponent reply (or a time trial) still on its way
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
  $('#pick-msg').textContent = `Real ${speed} games by players rated ${levelText(rating)}${style === 'any' ? '' : `, ${STYLES[style].label.toLowerCase()} White openings only`}. Pick one to practise.`;
  renderList();
}

// Time control and style switches, plus the rating labels that depend on the time control.
function renderChoices() {
  document.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.speed === speed));
  document.querySelectorAll('[data-sort]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.sort === sort));
  document.querySelectorAll('[data-style]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.style === style));
  $('#style-about').textContent = style === 'any' ? 'All common openings, whatever their character.' : STYLES[style].about;
  document.querySelectorAll('.speed-name').forEach((el) => (el.textContent = speed));
  $('#rating').value = rating || '';
  $('#filters-sum').innerHTML = `Filters <span>${speed[0].toUpperCase() + speed.slice(1)} · ${style === 'any' ? 'any style' : STYLES[style].label} · ${sort === 'played' ? 'most played' : 'best results'}</span>`;
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
document.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
  sort = b.dataset.sort;
  store(STORE + '-sort', sort);
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
  if (m !== 'time') stopTrial();
  if (remember && m !== 'explore' && m !== 'time') store(STORE + '-mode', m);
  for (const k of ['learn', 'try', 'explore', 'time']) $(`#mode-${k}`).setAttribute('aria-pressed', m === k);
  $('#mode-about').textContent = {
    learn: 'Every move is shown, with the replies you can expect at your level. Nothing is scored.',
    try: `Practice: play lines from memory, ${COHORT} at a time in course order; a new line joins when you clear one. A cleared line comes back for review after 1, 3, 7, 14 and 30 days.`,
    time: `Time trial: ${TRIAL_S} seconds to play as many moves of this opening's lines as you can from memory. Right +${TRIAL_RIGHT} s, wrong −${TRIAL_WRONG} s.`,
    explore: 'Play any move: the opponent answers as players at your level most often do, and you see how often each move is played and how it scores. To try another answer, step back and move their piece.',
  }[m];
  if (!lines.length) return;
  if (!restart) return;
  if (m === 'explore') enterExplore(); // carry on from the current position
  else if (m === 'time') startTrial();
  else play(lineIdx);
}
$('#mode-learn').addEventListener('click', () => setMode('learn'));
$('#mode-try').addEventListener('click', () => setMode('try'));
$('#mode-explore').addEventListener('click', () => setMode('explore'));
$('#mode-time').addEventListener('click', () => setMode('time'));
// ---------- Progress to a file and back ----------
// Everything the site keeps in this browser except the engine cache (it rebuilds itself), as JSON.
const KEEP_KEY = (k) => (k.startsWith(STORE) && k !== STORE + '-sf') || k.endsWith('-solved-v1') || k === 'chess-theme';
$('#export').addEventListener('click', () => {
  const data = {};
  for (const k of Object.keys(localStorage)) if (KEEP_KEY(k)) data[k] = localStorage.getItem(k);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'chess-trainer', saved: new Date().toISOString(), data }, null, 1)], { type: 'application/json' }));
  a.download = `chess-trainer-progress-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  $('#backup-msg').textContent = 'Saved.';
});
$('#import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const { app, data } = JSON.parse(await file.text());
    if (app !== 'chess-trainer' || typeof data !== 'object') throw new Error('not a Chess Trainer progress file');
    const keys = Object.keys(data).filter(KEEP_KEY); // only our own keys, whatever the file holds
    for (const k of keys) localStorage.setItem(k, String(data[k]));
    $('#backup-msg').textContent = `Loaded ${keys.length} saved items. Reloading…`;
    setTimeout(() => location.reload(), 600);
  } catch (err) {
    $('#backup-msg').textContent = `Could not load that file: ${err.message}.`;
  }
});

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
if (PHONE.matches) $('#filters').open = false;
