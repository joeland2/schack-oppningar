import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard, enableDrag, clearShapes, shake, moveWords, instruction, GLYPH } from './board.js?v=20261029145336';
import { findMistakes, byTheme, pickPuzzles, THEMES } from './mistakes.js?v=20261029145336';
import { ideaAt, CENTRE, hanging, dangerAfter, asMover } from './ideas.js?v=20261029145336';
import { GUIDE } from './guide.js?v=20261029145336';
import { STYLES, STYLE_OF, ABOUT, PLAN, VS_PLAN } from './styles.js?v=20261029145336';
import { maiaMove, maiaLevel, MAIA_MAX } from './maia.js?v=20261029145336';
import { login, finishLogin, account, liveGames } from './lichess.js?v=20261029145336';
import { storedGames } from './profile.js?v=20261029145336';

const STORE = 'opening-book-v2';
const MIN_SHARE = 0.05;   // an opponent reply must be played in at least 5% of games from that position
const MAX_LINES = 20;
// How deep to learn an opening, as a course does it: lines are in course order, so a depth is the first n.
const DEPTHS = [['Essentials', 6, 'The main line and known theory'], ['Advanced', 12, 'Adds the traps and common sidelines'], ['Everything', MAX_LINES, 'Every line players at your level meet']];
const depthName = (n) => (DEPTHS.find(([, d]) => d >= n) || DEPTHS.at(-1))[0];
let allLines = []; // the opening's lines at every depth (lines is the first n of them)
const MIN_LINE = 0.03;   // a side line needs 3% of the opening's games to become a line of its own
const THEORY = 0.15;     // a reply strong players choose this often is a main line, rare at your level or not
const THEORY_GROUPS = [6, 7, 8]; // 2000+
// A trap: a reply players at your level make in at least TRAP_SHARE of games (and MIN_GAMES), after which
// they score TRAP_SCORE or less (in TRAP_GAMES games or more). It gets a line of its own, so you learn how to punish it.
const TRAP_SHARE = 0.015, TRAP_SCORE = 0.38, TRAP_GAMES = 30;
const MIN_GAMES = 20;     // below this, real-game data is too thin to trust
const MAX_PLY = 20;       // data/explorer-*.json goes this deep
const DATA = '2026-10-28-k8c'; // version of data/explorer-*.json
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

let stats = load(STORE, {});
// Your own moves: where you would rather play another move than the suggested one, per opening,
// { [opening id]: { [moves before, as lineKey]: san } }. The lines are built around them.
const CHOICE_KEY = STORE + '-choice';
let choices = load(CHOICE_KEY, {});    // { 'blitz:Italian Game': { done: [lineKey], total } }
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
// A line's share of the opening, only when it is big enough to say something: a few percent makes a
// line look like it never comes up, when every line together is what you meet.
const BIG_SHARE = 0.1;
const bigShare = (x) => (x >= BIG_SHARE ? pct(x) : '');
// How popular an opening is among those of its kind (White openings, or Black's answers to them): a
// share under 1% says little, a place in the list says more.
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
console.assert(['1st', '2nd', '3rd', '4th', '11th', '22nd'].join() === [1, 2, 3, 4, 11, 22].map(ordinal).join(), 'ordinal');
function popularity(o) {
  const n = 1 + OPENINGS.filter((x) => x.side === o.side && isVs(x) === isVs(o) && x.share > o.share).length;
  return `${n === 1 ? 'The' : `The ${ordinal(n)}`} most ${isVs(o) ? 'common opening you meet' : `played ${sideName(o.side)} opening`}`;
}
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
// A line is known theory when every opponent move in it is a main reply of strong players (THEORY of
// their games at 2000+).
function isTheory(moves, side) {
  for (let i = side === 'w' ? 1 : 0; i < moves.length; i += 2) {
    const strong = explore(moves.slice(0, i), THEORY_GROUPS), m = strong.moves.find((x) => x.san === moves[i]);
    if (!m || m.n / strong.total < THEORY) return false;
  }
  return true;
}
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
      const san = choices[op.id]?.[lineKey(moves)] || userMove(moves, book);
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
    .map((l) => ({ ...l, theory: isTheory(l.moves, op.side) }))
    // As a course does it: the main line first, then the known theory (every reply one strong players
    // make), then the traps to punish, then the other lines, the most common first.
    .sort((a, b) => (b.branch === 1) - (a.branch === 1) || b.theory - a.theory || !!b.trap - !!a.trap || b.branch - a.branch || b.share - a.share);
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
// What the opening is about, from your side: "you" for your own opening, "they" for one you face.
function aboutOf(o) {
  const t = ABOUT[o.family] || ABOUT[shortName(o.family)] || '';
  return isVs(o) ? t.replace(/\b(Y|y)our\b/g, (_, y) => (y === 'Y' ? 'Their' : 'their')).replace(/\b(Y|y)ou\b/g, (_, y) => (y === 'Y' ? 'They' : 'they')).replace(/\bBlack's\b/g, 'your') : t;
}
function card(o) {
  const s = stats[statKey(o.id)] || { done: [], total: 0 };
  const due = dueCount(s);
  const level = due ? 'pagar' : s.total && s.done.length >= s.total ? 'sitter' : s.done.length ? 'pagar' : 'ny';
  const levelTxt = due ? `${due} due` : { sitter: 'Cleared', pagar: `${s.done.length}/${s.total} lines`, ny: 'New' }[level];
  const tags = stylesOf(o).map((t) => `<span class="tag">${STYLES[t].label}</span>`).join('');
  const about = aboutOf(o);
  const win = o.side === 'w' ? o.win : 1 - o.win - o.draw;
  return `<article class="ocard side-${o.side}" data-id="${o.id}">
    <div class="board mini" data-mini="${o.id}" inert></div>
    <div class="ocard-body">
      <div class="ocard-top"><h3><button type="button" class="ocard-open">${isVs(o) ? 'vs ' : ''}${o.name}</button></h3><span class="ocard-tags">${tags}<span class="chip ${level}">${levelTxt}</span>
        <button type="button" class="star" data-star="${o.id}" aria-pressed="${repertoire.has(o.id)}" title="${repertoire.has(o.id) ? 'In your favorites' : 'Add to your favorites'}" aria-label="${repertoire.has(o.id) ? 'Remove from' : 'Add to'} my favorites">★</button></span></div>
      ${about ? `<p class="odesc">${about}</p>` : ''}
      <div class="ostats">
        <span>${popularity(o)}</span>
        <span>${sideName(o.side)} wins <b>${pct(win)}</b></span>
        ${wdl(o, o.side)}
      </div>
    </div>
  </article>`;
}

let query = '';
// My favorites: the openings you star, from either side, in a list of their own.
// The three openings you play most, from your Lichess games kept in this browser (or the ones just
// checked here), as the list's openings; none when no games are known.
function mostPlayed() {
  const name = load(STORE + '-lichess-name', '') || account()?.name;
  const games = lastGames?.games || (name && storedGames(name)) || [];
  if (!name || !games.length || !OPENINGS.length) return [];
  const me = name.toLowerCase(), n = new Map();
  for (const g of games) {
    const side = g.players.white.user?.id === me ? 'w' : g.players.black.user?.id === me ? 'b' : null;
    const o = side && g.moves && openingOf(g.moves.split(' ').map(clean).slice(0, MAX_PLY), side);
    const op = o && OPENINGS.find((x) => x.family === o.family && x.side === side && isVs(x) === o.vs);
    if (op) n.set(op, (n.get(op) || 0) + 1);
  }
  return [...n].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([op]) => op);
}
const repertoire = new Set(load(STORE + '-rep', []));
let listSide = load(STORE + '-side', 'w'); // which list shows: openings you play as White, or as Black
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
  const mineList = OPENINGS.filter((o) => repertoire.has(o.id));
  // Favorites: the starred ones, then the three you play most (from your Lichess games kept here), once each.
  const played = mostPlayed().filter((o) => !repertoire.has(o.id));
  const favs = [...mineList, ...played];
  const count = (side) => (side === 'r' ? favs.length : list.filter((o) => o.side === side).length);
  let body;
  if (q) {
    body = `<p class="og-about">${list.length
      ? `${list.length} openings at your level match. "vs" means a White opening you answer as Black.`
      : `No opening at your level matches "${q.replace(/[<&"]/g, '')}".`}</p>
      <div class="olist">${list.map((o) => card(o).replace('</h3>', `<small class="as">you play ${sideName(o.side)}</small></h3>`)).join('')}</div>`;
  } else if (listSide === 'r') {
    body = `<p class="og-about">${favs.length ? `The openings you have starred${played.length ? ', and the ones you play most in your Lichess games' : ''}, from both sides. <button type="button" class="link" data-traps>Practise their traps</button>` : 'Nothing here yet. Star (★) an opening, or check your Lichess games, and it shows up here.'}</p>
      <div class="olist">${favs.map((o) => (played.includes(o) ? card(o).replace('<span class="chip ', '<span class="tag played">Played most</span><span class="chip ') : card(o))).join('')}</div>`;
  } else {
    // Your starred openings of this side come first, pinned, even ones the style or the cut would hide.
    const pinned = mineList.filter((o) => o.side === listSide);
    const ops = [...pinned, ...list.filter((o) => o.side === listSide && !repertoire.has(o.id))];
    const empty = `<p class="info">No common ${style === 'any' ? '' : STYLES[style].label.toLowerCase() + ' '}openings for White at your level. Try another style.</p>`;
    body = `<p class="og-about">${about[listSide](ops.length)}</p>${ops.length ? '' : empty}
      <div class="olist">${ops.map(card).join('')}</div>`;
  }
  // The side tabs sit beside the search box, outside the list, so typing a search keeps its focus.
  $('#side-tabs').innerHTML = `<div class="seg side-seg" role="group" aria-label="Your side">
      ${['w', 'b', 'r'].map((side) => `<button type="button" data-side="${side}" aria-pressed="${!q && side === listSide}">${side === 'r' ? '<span class="wide-only">My </span>Favorites' : `<span class="wide-only">You play </span>${sideName(side)}`} <span class="og-n">${count(side)}</span></button>`).join('')}
    </div>`;
  listEl.innerHTML = `${q ? '<h2 class="og-h">Search results</h2>' : `<h2 class="visually-hidden">${listSide === 'r' ? 'Your favorites' : `Openings for ${sideName(listSide)}`}</h2>`}${body}`; // the cards' h3 sit under an h2
  seen.disconnect();
  listEl.querySelectorAll('.ocard').forEach((c) => {
    const op = OPENINGS.find((o) => o.id === c.dataset.id);
    const go = (e) => { if (!e?.target.closest?.('.star')) start(op); };
    previewAt(c, op.root.split(' ').length);
    if (!REDUCE_MOTION) {
      seen.observe(c);
      c.addEventListener('mouseenter', () => playPreview(c));
      c.addEventListener('focusin', (e) => { if (e.target.closest('.ocard-open')) playPreview(c); });
    }
    c.addEventListener('click', go);
  });
}

$('#side-tabs').addEventListener('click', (e) => {
  const side = e.target.closest('[data-side]');
  if (!side) return;
  listSide = side.dataset.side; store(STORE + '-side', listSide);
  if (query) { query = $('#search').value = ''; } // a side tab leaves the search
  renderList();
});
listEl.addEventListener('click', (e) => {
  if (e.target.closest('[data-traps]')) return startTraps();
  const star = e.target.closest('[data-star]');
  if (star) {
    const id = star.dataset.star;
    if (repertoire.has(id)) repertoire.delete(id); else repertoire.add(id);
    store(STORE + '-rep', [...repertoire]);
    return renderList();
  }

});

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

// The first of your moves in a game that strong players rarely play and no named line has, or null.
function firstSlip(moves, side) {
  for (let i = side === 'w' ? 0 : 1; i < moves.length; i += 2) {
    const before = moves.slice(0, i);
    const strong = explore(before, STRONG[speed]);
    if (strong.total < JUDGE_GAMES) return null; // past what the data can judge
    const mine = strong.moves.find((m) => m.san === moves[i]);
    const key = lineKey([...before, moves[i]]);
    if ((mine && mine.n / strong.total >= RARE) || IN_BOOK.has(key)) continue;
    return { before, key, played: moves[i], mine, strong };
  }
  return null;
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
    const f = firstSlip(moves, side);
    if (!f) continue;
    const slip = slips.get(f.key) ?? { before: f.before, side, family, played: f.played, playedShare: (f.mine?.n ?? 0) / f.strong.total,
      best: f.strong.moves[0].san, bestShare: f.strong.moves[0].n / f.strong.total, games: 0, points: 0 };
    slip.games++; slip.points += points;
    slips.set(f.key, slip);
  }
  return {
    counted,
    slips: [...slips.values()].sort((a, b) => b.games - a.games || a.points - b.points).slice(0, 6),
    openings: [...openings.values()].filter((o) => o.games >= 2).sort((a, b) => b.games - a.games),
  };
}
console.assert(analyse([], 'x').counted === 0, 'analyse');

// ---------- A player to learn from ----------
// Someone rated a bit above you who plays your most played opening and makes fewer of its slips. The
// candidates come from the Lichess explorer: recent and top games, at the higher ratings, from the
// opening's position and from the positions where you slip. Each candidate's last 100 games are then
// read with the same slip test as yours, so no engine is needed.
const sideIn = (g, me) => (g.players.white.user?.id === me ? 'w' : g.players.black.user?.id === me ? 'b' : null);
// One player's games in an opening: how many, the points, the slips, and what they play where you slip.
function inOpening(games, name, o, mySlips) {
  const me = name.toLowerCase(), out = { games: 0, points: 0, slips: 0, at: mySlips.map(() => new Map()) };
  for (const g of games) {
    if (sideIn(g, me) !== o.side || !g.moves) continue;
    const moves = g.moves.split(' ').map(clean).slice(0, MAX_PLY);
    if (openingOf(moves, o.side)?.family !== o.family) continue;
    out.games++;
    out.points += !g.winner ? 0.5 : g.winner === (o.side === 'w' ? 'white' : 'black') ? 1 : 0;
    if (firstSlip(moves, o.side)) out.slips++;
    mySlips.forEach((sl, k) => {
      const n = sl.before.length;
      if (moves.length > n && lineKey(moves.slice(0, n)) === lineKey(sl.before)) out.at[k].set(moves[n], (out.at[k].get(moves[n]) || 0) + 1);
    });
  }
  return out;
}
async function candidatesFor(o, positions, token) {
  const bands = BUCKETS.filter((b) => b >= rating + 100 && b <= rating + 600);
  const found = new Map();
  for (const moves of positions) {
    const g = new Chess();
    for (const m of moves) g.move(m);
    const res = await fetch('https://explorer.lichess.org/lichess?' + new URLSearchParams({
      variant: 'standard', fen: g.fen(), speeds: speed, ratings: (bands.length ? bands : [BUCKETS.at(-1)]).join(','), moves: 0, topGames: 4, recentGames: 8,
    }), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) continue;
    const x = await res.json();
    for (const game of [...(x.recentGames || []), ...(x.topGames || [])]) {
      const p = game[o.side === 'w' ? 'white' : 'black'];
      if (p?.name && p.rating > rating) found.set(p.name, p.rating);
    }
  }
  return [...found];
}
async function findTeachers(name) {
  const el = $('#learn-from');
  el.hidden = false;
  const msg = (t) => (el.innerHTML = `<h2>A player to learn from</h2><p class="info">${t}</p>`);
  const token = account()?.token;
  if (!token) { msg('Searching needs the Lichess opening explorer, which needs you to log in. <button type="button" class="link" id="lf-login">Log in with Lichess</button>'); return $('#lf-login').addEventListener('click', login); }
  if (!lastGames) return msg('Check your games first.');
  const me = analyse(lastGames.games, name), o = me.openings.find((x) => x.games >= 5);
  if (!o) return msg('Play at least 5 games of one opening first.');
  const mySlips = me.slips.filter((x) => x.family === o.family && x.side === o.side).slice(0, 3);
  const mine = inOpening(lastGames.games, name, o, mySlips);
  const what = `${o.vs ? 'vs ' : ''}${shortName(o.family)} as ${sideName(o.side)}`;
  msg(`Looking for players above ${rating} who play the ${what}…`);
  const cands = (await candidatesFor(o, [o.root, ...mySlips.map((x) => x.before)], token)).filter(([n]) => n.toLowerCase() !== name.toLowerCase()).slice(0, 8);
  if (!cands.length) return msg(`No players above your rating found in the ${what} right now. Try again later.`);
  const read = [];
  for (const [i, [cand, r]] of cands.entries()) {
    msg(`Reading ${cand}'s games (${i + 1} of ${cands.length})…`);
    try { read.push({ name: cand, rating: r, ...inOpening(await fetchGames(cand), cand, o, mySlips) }); } catch (err) { if (/busy/.test(err.message)) break; }
  }
  const rate = (x) => x.slips / x.games;
  const best = read.filter((x) => x.games >= 3).sort((a, b) => rate(a) - rate(b) || b.points / b.games - a.points / a.games).slice(0, 3);
  if (!best.length) return msg(`The players found play the ${what} too rarely to compare. Try again later.`);
  const theirs = (x, k) => [...x.at[k]].sort((a, b) => b[1] - a[1])[0]?.[0];
  el.innerHTML = `<h2>Players to learn from: ${what}</h2>
    <p class="info">You: a slip in ${pct(rate(mine) || 0)} of ${plural(mine.games, 'game')}, scoring ${pct(mine.points / Math.max(1, mine.games))}. Players above your rating who play it, read from their last 100 ${speed} games:</p>
    <ul class="lf-list">${best.map((x) => `<li><a href="https://lichess.org/@/${encodeURIComponent(x.name)}" target="_blank" rel="noopener"><b>${x.name}</b></a> <small>${x.rating}</small>
      <span class="lf-meta">a slip in ${pct(rate(x))} of ${plural(x.games, 'game')} · scores ${pct(x.points / x.games)}</span>
      ${mySlips.map((sl, k) => { const t = theirs(x, k); return t && t !== sl.played ? `<span class="lf-meta">Where you play <b class="down">${sl.played}</b> (move ${Math.floor(sl.before.length / 2) + 1}), they play <b>${t}</b></span>` : ''; }).join('')}
      <a class="lf-link" href="profile.html?u=${encodeURIComponent(x.name)}">See their profile</a></li>`).join('')}</ul>`;
}


// Where your games left your lines: in each game of an opening in the list, the first of your moves
// that is not your line's move while the game was still in one of its lines. Grouped by position and
// move, the most frequent first. The opponent leaving the lines is no fault of yours, so it ends the walk.
function leftLines(games, name) {
  const me = name.toLowerCase(), built = new Map(), found = new Map();
  for (const g of games) {
    const side = g.players.white.user?.id === me ? 'w' : g.players.black.user?.id === me ? 'b' : null;
    if (!side || !g.moves) continue;
    const moves = g.moves.split(' ').map(clean).slice(0, MAX_PLY);
    const o = openingOf(moves, side);
    const op = o && OPENINGS.find((x) => x.family === o.family && x.side === side && isVs(x) === o.vs);
    if (!op) continue;
    if (!built.has(op.id)) built.set(op.id, buildLines(op));
    let ls = built.get(op.id);
    for (let i = 0; i < moves.length && ls.length; i++) {
      const want = ls.find((l) => l.moves[i] !== undefined)?.moves[i]; // lines that share the moves so far share your move
      if (want === undefined) break; // past the end of your lines
      if ((i % 2 === 0) === (side === 'w') && moves[i] !== want) {
        const key = `${op.id}|${lineKey(moves.slice(0, i))}|${moves[i]}`;
        const f = found.get(key) ?? { op, before: moves.slice(0, i), played: moves[i], want, games: 0 };
        f.games++;
        found.set(key, f);
        break;
      }
      ls = ls.filter((l) => l.moves[i] === moves[i]);
    }
  }
  return [...found.values()].sort((a, b) => b.games - a.games);
}

// Your Lichess games in one compact box: what you play most as White and as Black (with how you score
// against players at your level), and what to train: the opening moves you keep getting wrong, then the
// mistakes you repeat in whole games.
function renderMine({ counted, slips, openings }, name) {
  const left = rating ? leftLines(lastGames?.games || [], name) : [];
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
      <span class="ml-meta" title="Score: a win counts 1, a draw a half. Others: players rated like you, in this opening">${plural(o.games, 'game')} · you score <b class="${mark}">${pct(you)}</b>${avg === null ? '' : ` <small>· others at your rating ${pct(avg)}</small>`}</span>
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
      <h3>Where you left your lines</h3>
      <ul class="ml-list">${left.slice(0, 3).map((f, n) => `<li><button type="button" class="ml-row" data-left="${n}">
        <span class="ml-name">${isVs(f.op) ? 'vs ' : ''}${f.op.name}, move ${Math.floor(f.before.length / 2) + 1}</span>
        <span class="ml-meta">you played <b class="down">${f.played}</b>, your line <b>${f.want}</b> · ${plural(f.games, 'game')}</span>
      </button></li>`).join('') || '<li class="info">Your games stayed in your lines.</li>'}</ul>
      <h3>Opening moves strong players avoid</h3>
      <ul class="ml-list">${slips.slice(0, 3).map((s, n) => `<li><button type="button" class="ml-row" data-practise="${n}">
        <span class="ml-name">${slipName(s)}</span>
        <span class="ml-meta">you play <b class="down">${s.played}</b>, strong players <b>${s.best}</b> · ${plural(s.games, 'game')}</span>
      </button></li>`).join('') || '<li class="info">No repeated slips in the openings.</li>'}</ul>
      <h3>Mistakes in whole games</h3>
      <div id="my-mistakes"></div>
      <h3>A player to learn from</h3>
      <p class="info">Someone a bit above you who plays your main opening without your slips. <button type="button" class="link" id="lf-go">Find one</button></p>
    </div>`;
  $('#lf-go')?.addEventListener('click', () => findTeachers(name).catch((err) => { $('#learn-from').innerHTML = `<p class="info">${err.message}</p>`; }));
  el.querySelectorAll('[data-left]').forEach((b) => b.addEventListener('click', () => {
    const f = left[Number(b.dataset.left)];
    start(f.op);
    const want = lineKey([...f.before, f.want]) + ' ';
    const i = lines.findIndex((l) => (lineKey(l.moves) + ' ').startsWith(want));
    if (i >= 0) play(i);
  }));
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
  $('#mine-msg').textContent = `Fetching ${name}'s last 100 rated ${speed} games from Lichess…`;
  try {
    await loadTree();
    lastGames = { games: await fetchGames(name), name };
    renderMine(analyse(lastGames.games, name), name);
    renderMistakes();
  } catch (err) {
    $('#mine-msg').textContent = err.message;
  }
}

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
$('#rating-user').value = load(STORE + '-lichess-name', '');
$('#search').addEventListener('input', (e) => { query = e.target.value; if (OPENINGS.length) renderList(); });

// ---------- Board ----------
function renderBoard() {
  if (boardHeld) { boardDirty = boardEl._noAnim || boardDirty === 'drop' ? 'drop' : true; return; }
  if (view !== null) { // looking back at a move: its badge; after a slip, the position before it, with
    // the move played in red and the better one in green
    const hist = game.history({ verbose: true }), g = new Chess();
    const m = hist[view - 1], better = betters[view - 1];
    // Their slip is played on the board, like any move, with the better move as a green arrow; yours is
    // shown before it, to try again.
    if (better && m.color !== cur.side) {
      hist.slice(0, view).forEach((x) => g.move(x.san));
      return drawBoard(boardEl, g, { side: cur.side, last: m, mark: notes[view - 1] && { sq: m.to, kind: notes[view - 1] }, arrows: [[better.from, better.to, GREEN]] });
    }
    hist.slice(0, better ? view - 1 : view).forEach((x) => g.move(x.san));
    if (better) {
      const after = new Chess(m.before);
      after.move(m.san);
      const r = EVALS.get(evalKey(after.fen())), reply = r?.move && after.move(r.move);
      return drawBoard(boardEl, g, { side: cur.side, last: hist[view - 2] || null,
        arrows: [[m.from, m.to, RED], ...(reply ? [[reply.from, reply.to, ORANGE]] : []), [better.from, better.to, GREEN]] });
    }
    return drawBoard(boardEl, g, { side: cur.side, last: m || null, mark: m && notes[view - 1] && { sq: m.to, kind: notes[view - 1] } });
  }
  if (momentArrows && view === null) return drawBoard(boardEl, game, { side: cur.side, last: lastMove, wrong: momentArrows[0]?.[1], arrows: momentArrows }); // the red arrow's square
  const n = game.history().length - 1, note = notes[n];
  // At the line's end the best offered move gets an arrow (green: real games, blue: Stockfish); pointing
  // at another tip shows its arrow instead.
  const offered = mode === 'learn' && endLen && game.history().length === endLen && userTurn() && !(tipHint !== null) ? tipArrows : []; // only at the line's end
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
      ? `<button type="button" class="mv ${j === (view ?? hist.length) - 1 ? 'now' : ''}" data-n="${j + 1}">${hist[j]}${notes[j] && notes[j] !== 'book' ? `<sup class="nag k-${notes[j]}">${GLYPH[notes[j]]}</sup>` : ''}</button>`
      : `<span class="mv todo">${j < line.length ? '…' : ''}</span>`;
    html += `<li><span class="num">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}</li>`;
  }
  movesEl.innerHTML = html;
  const now = movesEl.querySelector('.mv.now'); // keep the move on the board in sight, inside the list only
  if (now) movesEl.scrollTop = now.offsetTop - movesEl.offsetTop - movesEl.clientHeight / 2;
  if (mode === 'time') return; // the trial's clock owns the progress bar
  $('#progress').textContent = mode === 'explore' ? 'Exploring' : playing ? `Line done · playing it out${opponent ? ` · opponent: ${opponent}` : ''}` : line.length ? `${Math.min(ply, line.length)} of ${line.length} moves` : '';
  $('#bar').style.width = line.length ? `${Math.min(ply / line.length, 1) * 100}%` : '0';
  $('#line-at').textContent = lines[lineIdx] && mode !== 'explore' ? `Line ${lineIdx + 1} of ${lines.length}` : '';
  $('#op-line').textContent = lines[lineIdx] && mode !== 'explore' ? lineName(lines[lineIdx]) : '';
  // The phone's bar above the board: the opening, the line and the mode, which the panel shows lower down.
  $('#m-name').textContent = $('#op-title').textContent;
  $('#m-line').textContent = lines[lineIdx] && mode !== 'explore' ? `Line ${lineIdx + 1} of ${lines.length} · ${lineName(lines[lineIdx])}` : mode === 'explore' ? 'Exploring' : '';
  $('#m-mode').value = mode;
  // The path: how many lines wait for review under Practice, and what a step means until a line is learned.
  const st = cur && stats[statKey(cur.id)], due = dueCount(st);
  $('#path-due').textContent = due ? `${due} due for review` : 'from memory';
  $('#mode-about').hidden = (mode === 'learn' || mode === 'try') && (st?.played?.length ?? 0) > 0;
  $('#depth').textContent = `${depthName(load(STORE + '-depth', {})[cur?.id] || MAX_LINES)} ▾`;
  $('#depth').hidden = allLines.length <= DEPTHS[0][1] || !!trapRun || mode === 'explore';
}

function say(text, tone = '') {
  if ($('#trainer').hidden) return ($('#pick-msg').textContent = text);
  msgEl.textContent = text;
  msgEl.className = 'message ' + tone;
}

function render() { renderBoard(); renderMoves(); renderWhy(); renderControls(); renderMaterial(); renderEval(); leaveMoment(); }

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
    const pieces = lead ? lost(taken) : []; // even trades are noise: only an imbalance is shown
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
  $('#step-back').disabled = !game.history().length || view === 0;
  $('#step-fwd').disabled = view === null && (mode !== 'explore' || !redo.length);
  $('#hint').disabled = !userTurn();
  // The filled button is for going on (Next line, Try again, Next trap); Restart in the middle of a line is quiet.
  $('#restart').classList.toggle('primary', $('#restart').textContent !== 'Restart');
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
// Mouse only: a tap on a phone would leave one arrow stuck in place of all of them.
$('#line-done').addEventListener('pointerover', (e) => {
  const b = e.target.closest('.tip');
  if (!b || e.pointerType !== 'mouse' || !userTurn()) return;
  tipHint ??= hintSq;
  hintSq = [b.dataset.from, b.dataset.to];
  renderBoard();
});
$('#line-done').addEventListener('pointerout', (e) => {
  const b = e.target.closest('.tip');
  if (!b || b.contains(e.relatedTarget) || tipHint === null) return;
  hintSq = tipHint; tipHint = null;
  renderBoard();
});
$('#line-done').addEventListener('click', (e) => {
  if (e.target.closest('.done-next')) return $('#restart').click();
});
// The same choice over the board, the moment a line is done.
let goAsked = false;
$('#go-ask').addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (!b) return;
  $('#go-ask').hidden = true;
  goOn(b.dataset.go);
});
// Four ways on, Learn (arrows) or Practice (from memory), each either playing on from here or starting
// the line again. Playing on keeps the line-done card beside the board, with its own Next line.
const GO = [['learn-on', 'Play on in Learn', 'Carry on from here; the arrows show good moves'], ['learn', 'Learn this line again', 'From the start, with arrows'],
  ['try-on', 'Play on in Practice', 'Carry on from here, without arrows'], ['try', 'Practise this line', 'From the start, from memory']];
function askGo() {
  goAsked = true;
  $('#go-ask').innerHTML = `<div class="depth-card"><p class="depth-k">Line done</p><p class="depth-q">${lineName(lines[lineIdx])}. How do you want to go on?</p>
    ${GO.map(([g, label, about]) => `<button type="button" class="depth-opt" data-go="${g}"><b>${label}</b><span>${about}</span></button>`).join('')}</div>`;
  $('#go-ask').hidden = false;
}
function goOn(go) {
  const [m, on] = go.split('-');
  setMode(m, false);
  if (on) { if (m === 'try') { hintSq = []; tipArrows = []; } render(); if (m === 'learn') guide(); } // play on: the board stays, the arrows follow the mode
  else play(lineIdx);
}
// Beside the board, once a line is done: Next line (the ways on are asked over the board, see GO).
function doneNext() {
  return `<button type="button" class="cta done-next">${$('#restart').textContent}</button>`;
}
let lineDone = '', lineMore = '', tipArrows = []; // the summary shown at the end of the line, and the current tips
// The idea of the whole opening, its main variations and the trap to know (guide.js), folded under the plan.
function guideOf(op) {
  const gd = GUIDE[op.family] || GUIDE[shortName(op.family)];
  return gd ? `<details class="op-guide"><summary>The idea of the ${op.family}</summary><p>${gd.idea}</p>
    <p class="op-guide-k">Main variations</p><ul>${gd.lines.map(([n, t]) => `<li><b>${n}:</b> ${t}</li>`).join('')}</ul>
    <p><b>Watch out:</b> ${gd.watch}</p></details>` : '';
}
// The opening book for the position on the board: Wikibooks' Chess Opening Theory (CC BY-SA 4.0), the
// same text Lichess shows on its opening pages. Fetched once per position, then kept for this visit.
const WIKI = new Map(); // moves key → { html, url } | null (no page) | 'loading'
function wikiTitle(moves) {
  return 'Chess_Opening_Theory/' + moves.map((san, i) => (i % 2 ? `${Math.floor(i / 2) + 1}...${san}` : `${i / 2 + 1}._${san}`)).join('/');
}
function wikiFor(moves) {
  const key = moves.join(' ');
  if (WIKI.has(key)) return WIKI.get(key) === 'loading' ? null : WIKI.get(key);
  WIKI.set(key, 'loading');
  const title = wikiTitle(moves);
  fetch(`https://en.wikibooks.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(title)}`)
    .then((r) => r.json()).then((d) => {
      const page = Object.values(d.query?.pages || {})[0];
      const text = page?.extract;
      if (!text || page.missing !== undefined) return WIKI.set(key, null);
      // The position's own section: from its heading to the next top-level one (theory table, references).
      const body = text.split(/\n== (?!=)/)[1]?.replace(/^[^\n]*==\n/, '') ?? text;
      const esc = (t) => t.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
      const html = body.split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => {
        const h = x.match(/^=+\s*(.*?)\s*=+$/);
        return h ? `<p class="wiki-h">${esc(h[1])}</p>` : `<p>${esc(x.replace(/\[\d+\]/g, ''))}</p>`;
      }).join('');
      WIKI.set(key, { html, url: `https://en.wikibooks.org/wiki/${title}` });
    }).catch(() => WIKI.set(key, null))
    .finally(() => { if (cur && game.history().join(' ') === key) renderWhy(); });
  return null;
}
function renderWhy() {
  const el = $('#why');
  if (!cur || !line.length || mode === 'explore' || mode === 'time') { $('#line-done').hidden = true; return (el.innerHTML = ''); } // Explore explains in the message
  const hist = game.history();
  const label = (n, san) => `${Math.floor(n / 2) + 1}.${n % 2 ? '..' : ''}${san}`;
  const lower = (t) => t.replace(/^./, (c) => c.toLowerCase());
  const parts = [];
  // Before the first move, an introduction: what the opening is about and which line this is.
  if (!hist.length && lines[lineIdx]) {
    const l = lines[lineIdx];
    parts.push(`<p class="intro">This is line ${lineIdx + 1} of ${lines.length}: <b>${lineName(l)}</b>, ${lineIdx ? 'the next most common way' : 'the most common way'} games in this opening go at your level${bigShare(l.share) ? ` (${bigShare(l.share)})` : ''}. It runs to move ${Math.ceil(l.moves.length / 2)}.${l.trap ? ` <b>${l.trap.kind === 'mistake' ? 'A common mistake' : 'A trap'}.</b> ${trapStory(l)}` : ''}</p>`);
  }
  // First what to play and why (Learn), then a quiet line on the last move, then the other replies
  // folded away: the board and the move to make come first.
  if (mode === 'learn' && userTurn() && ply < line.length) {
    parts.push(`<p class="why-now"><b>Why</b> ${why(line.slice(0, ply), line[ply])}</p>`);
    const c = careful(line.slice(0, ply), line[ply]);
    if (c) parts.push(`<p class="careful"><b>Careful:</b> many players at your level play ${c.san} here and score only ${pct(scoreFor(c, cur.side))}. Don't fall for it.</p>`);
  }
  if (hist.length) {
    const n = hist.length - 1;
    const before = hist.slice(0, n).map(clean), san = clean(hist[n]);
    const yours = (n % 2 === 0) === (cur.side === 'w');
    const text = yours ? why(before, san) : idea(before, san);
    const k = notes[n], good = k === 'best' || k === 'brilliant';
    parts.push(`<p class="prev${good ? ` verdict k-${k}` : ''}">${yours ? 'You' : sideName(n % 2 ? 'b' : 'w')} played <b>${label(n, hist[n])}</b>${good ? `, ${NOTE_WORD[k]}` : ''}${text ? `: ${lower(text)}` : '.'}${k === 'brilliant' ? ` ${brilliantWhy(n)}` : ''}</p>`);
    // Their slip: what goes wrong for them and what they should have played (yours is below).
    if (!yours && betters[n] && ['inaccuracy', 'mistake', 'blunder'].includes(k)) parts.push(`<p class="verdict k-${k}"><b>That was ${NOTE_WORD[k]}.</b> ${slipWhy(n, false)}</p>`);
    const t = lines[lineIdx]?.trap;
    if (t && n === t.ply && mode !== 'explore') { const w = t.kind === 'mistake' ? mistakeWhy(t) : null; parts.push(`<p class="trap-now"><b>That is the mistake: ${trapMove(t)}</b> ${w ? `${w.why} ` : ''}You score ${pct(1 - t.score)} after it at your level. ${mode === 'learn' ? punishText(t) : 'Find the move that punishes it.'}${w ? ` ${w.how}` : ''}</p>`); }
    const w = (mode === 'learn' || mode === 'explore') && view === null ? wikiFor(hist) : null;
    if (w?.html) parts.push(`<details class="wiki"><summary>Opening book</summary>${w.html}<p class="wiki-src">From <a href="${w.url}" target="_blank" rel="noopener">Wikibooks, Chess Opening Theory</a>, CC BY-SA 4.0</p></details>`);
    const reps = !yours && repliesText(before, san);
    if (reps) parts.push(`<details class="reps-box"><summary>What players at your level answer here</summary>${reps}</details>`);
  }
  if (game.isGameOver()) parts.unshift(gameStats());
  if (view !== null) { // looking back: what the move was, and what was better
    const n = view - 1, k = notes[n];
    // Back on the line's slip: the mistake and how to punish it, as when it was played.
    const t = lines[lineIdx]?.trap;
    if (t && n === t.ply) { const w = t.kind === 'mistake' ? mistakeWhy(t) : null; parts.unshift(`<p class="trap-now"><b>${trapWord(t)}: ${trapMove(t)}</b> ${t.kind === 'trap' && t.win ? `It loses ${t.win}. ` : w ? `${w.why} ` : ''}You score ${pct(1 - t.score)} after it at your level. ${punishText(t)}${w ? ` ${w.how}` : ''}</p>`); }
    parts.unshift(`<p class="verdict${k ? ` k-${k}` : ''}">${n < 0 ? 'The start position.' : `<b>${label(n, hist[n])}${k && k !== 'book' ? ` was ${NOTE_WORD[k]}` : ''}.</b>${betters[n] ? ` ${slipWhy(n)}` : ''}`} Use → or click the last move to go back to the game.</p>`);
  }
  // Your last own move, when it was a slip: what it was and what was better (play-out only).
  const mine = hist.length - ((hist.length - 1) % 2 === (cur.side === 'w' ? 0 : 1) ? 1 : 2);
  if (view === null && playing && mine >= line.length && betters[mine]) {
    parts.push(`<p class="verdict k-${notes[mine]}"><b>${label(mine, hist[mine])} was ${NOTE_WORD[notes[mine]]}.</b> ${slipWhy(mine, false)}</p>`);
  }
  // The line-done summary is made at the line's end and stays while you play on from there. The tips
  // are about the move to play at the line's end, so they go once you have played on.
  if (ply >= line.length && hist.length === endLen) {
    lineDone = `<p class="done-head"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>${lineName(lines[lineIdx])} done</p>${lineFacts()}`;
    lineMore = `<details class="done-more"><summary>Why this is good for you</summary>${lineWhy()}</details>`;
  }
  // "How to go on" is for the moment you start playing on: shown at the line's end, gone once you move.
  let tips = '';
  if (endLen && hist.length === endLen && userTurn()) {
    const t = lineTips();
    const arrows = t.slice(0, 1).map((x) => [x.move.from, x.move.to, x.engine ? '#1d5fbf' : '#15781b']); // the best only; pointing at a tip shows its own
    if (JSON.stringify(arrows) !== JSON.stringify(tipArrows)) { tipArrows = arrows; renderBoard(); }
    tips = t.length ? `<p class="done-k">How to go on</p><ul class="tips">${t.map((x, i) => `<li><button type="button" class="tip" data-from="${x.move.from}" data-to="${x.move.to}"><span class="tip-n">${i + 1}</span><span>${x.tag ? `<span class="tip-tag">${x.tag}</span> ` : ''}${x.html}</span></button></li>`).join('')}</ul>` : '';
  }
  el.innerHTML = parts.join('');
  $('#line-done').innerHTML = ply >= line.length && lineDone && !momentOpen // the trap's card first
    ? `<div class="summary">${lineDone}${tips}${lineMore}${doneNext()}</div>` : '';
  $('#line-done').hidden = !$('#line-done').innerHTML;
  if (lineDone && !goAsked && !momentOpen && !trapRun && (mode === 'learn' || mode === 'try') && hist.length === endLen) askGo();
}

// Your side's wins, draws and losses (as shares) in games at your level that reached a position, or null.
// White's results in an opening at one rating: the games of its own rating group (the groups around
// it when that has too few), or null.
function oddsAt(op, r) {
  let node = TREE;
  for (const m of op.root.split(' ')) node = node?.[3]?.[m];
  if (!node) return null;
  const own = BUCKETS.findLastIndex((b) => b <= r);
  for (const groups of [[own], ratingsAround(r)]) {
    const sum = (c) => groups.reduce((t, i) => t + c[i], 0), n = sum(node[0]);
    if (n >= MIN_GAMES) return { win: sum(node[1]) / n, draw: sum(node[2]) / n, n };
  }
  return null;
}
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
// Results at your level from the line's end (or the last position of it with enough games).
function endResults() {
  let k = line.length, r = null;
  while (k > 0 && !(r = resultsAt(line.slice(0, k)))) k--;
  return r;
}
const scoresWell = () => { const r = endResults(); return !!r && r.win > r.loss; };
function lineFacts() {
  const r = endResults();
  if (!r) return '';
  const cell = (v, label) => `<div><b>${v}</b><span>${label}</span></div>`;
  return `<div class="facts" aria-label="From here at your level">${cell(pct(r.win), 'you win')}${cell(pct(r.draw), 'draws')}${cell(pct(r.loss), 'you lose')}${cell(r.n.toLocaleString('en'), 'games at your level')}</div>`;
}

// The end of the line, read off the board: development, kings, material and open files, for both sides.
function endPosition() {
  const me = cur.side, them = me === 'w' ? 'b' : 'w';
  const pieces = game.board().flat().filter(Boolean);
  const home = (c) => (c === 'w' ? '1' : '8');
  const kingOf = (c) => pieces.find((p) => p.type === 'k' && p.color === c).square;
  const castled = (c) => game.history({ verbose: true }).some((m) => m.color === c && /[kq]/.test(m.flags));
  const minors = (c) => pieces.filter((p) => p.color === c && 'nb'.includes(p.type));
  const undeveloped = (c) => minors(c).filter((p) => ['b', 'c', 'f', 'g'].map((f) => f + home(c)).includes(p.square));
  const points = (c) => pieces.filter((p) => p.color === c && p.type !== 'k').reduce((s, p) => s + VALUE[p.type], 0);
  const pawnsOn = (c, f) => pieces.some((p) => p.color === c && p.type === 'p' && p.square[0] === f);
  // Files with none of your pawns, nearest the centre first: open (no pawns) or half-open (theirs only).
  const files = ['e', 'd', 'f', 'c'].filter((f) => !pawnsOn(me, f)).map((f) => ({ f, open: !pawnsOn(them, f) }));
  const inCentre = (c) => ['d', 'e', 'f'].includes(kingOf(c)[0]) && kingOf(c)[1] === home(c);
  return { me, them, castled: castled(me), theyCastled: castled(them), kingHome: inCentre(me), theirKingInCentre: inCentre(them),
    out: minors(me).length - undeveloped(me).length, theirOut: minors(them).length - undeveloped(them).length,
    undeveloped: undeveloped(me), lead: points(me) - points(them), files };
}
const andList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);

// Why the line's end is good for you, in a few points: Stockfish's verdict (once it is in), and what
// the board shows about development, kings, material and files. Then where to take the game: the
// goals that follow from those points, and how strong players usually go on from here.
function lineWhy() {
  const p = endPosition(), them = sideName(p.them), why = [], aims = [];
  const e = EVALS.get(evalKey(game.fen()));
  if (e && game.turn() === p.me) {
    const cp = toCp(e);
    why.push(cp >= 80 ? 'Stockfish rates your position as clearly better.' : cp >= 30 ? 'Stockfish rates your position as a little better.'
      : cp > -30 ? 'Stockfish rates it as equal: a full game, where the better plan wins.'
      : `Stockfish gives ${them} ${cp > -100 ? 'a small' : 'an'} edge${scoresWell() ? ', but players at your level win more than they lose from here' : ', so play carefully'}.`);
  }
  const trap = lines[lineIdx]?.trap;
  if (trap) why.push(`${them} ${trap.kind === 'mistake' ? 'made the common mistake' : 'fell for the trap'} ${trapMove(trap)}${trap.win ? `, which loses ${trap.win}` : ''}: players at your level score ${pct(1 - trap.score)} from here.`);
  if (p.out > p.theirOut) why.push(`You are ahead in development: ${p.out} knights and bishops out against ${p.theirOut}, so open the game before ${them} catches up.`);
  else if (p.out < p.theirOut) why.push(`${them} is ahead in development (${p.theirOut} pieces out against your ${p.out}), so catch up before you start anything.`);
  if (p.theirKingInCentre && !p.theyCastled) why.push(`${them}'s king is still in the centre: if the centre opens, it is a target.`);
  if (p.lead > 0) why.push(`You are ${p.lead === 1 ? 'a pawn' : `${p.lead} points`} up: trade pieces, not pawns, and the extra material wins the endgame.`);
  if (p.lead < 0) why.push(`You gave ${p.lead === -1 ? 'a pawn' : 'material'} for quick development and open lines. Keep the pace up: in a slow game the material counts.`);
  const file = p.files[0];
  if (file) why.push(`The ${file.f}-file is ${file.open ? 'open' : 'half-open for you'}: a rook belongs there.`);
  // Goals, in the order to reach them, starting with the first move offered under How to go on, so the
  // plan and the arrows say the same thing.
  const first = game.turn() === p.me ? lineTips()[0] : null;
  if (first) aims.push(`start with ${first.move.san} (the ${first.engine ? 'blue' : 'green'} arrow)`);
  const rest = p.undeveloped.filter((x) => x.square !== first?.move.from);
  if (rest.length) aims.push(`${first ? 'then ' : ''}bring out your ${andList(rest.map((x) => `${PIECE[x.type]} on ${x.square}`))}`);
  if (!p.castled && p.kingHome && !first?.move.san.startsWith('O-O')) aims.push('castle');
  if (file) aims.push(`put a rook on the ${file.f}-file`);
  if (p.theirKingInCentre && !p.theyCastled) aims.push(`open the centre before ${them} castles`);
  else if (p.lead > 0) aims.push('trade pieces');
  // How strong players go on: the most played move, a few moves deep.
  const moves = game.history().map(clean), next = [];
  for (let i = 0; i < 4; i++) {
    const m = strongGroups([...moves, ...next]).x.moves.find((x) => x.n >= MIN_GAMES);
    if (!m) break;
    next.push(m.san);
  }
  const n0 = moves.length;
  const seq = next.map((san, i) => ((n0 + i) % 2 === 0 ? `${(n0 + i) / 2 + 1}.${san}` : i === 0 ? `${Math.floor((n0 + i) / 2) + 1}...${san}` : san)).join(' ');
  return `${why.length ? `<ul class="done-why">${why.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
    ${aims.length || seq ? `<p><b>Where to take the game</b> ${aims.length ? `${andList(aims).replace(/^./, (c) => c.toUpperCase())}.` : ''}${seq ? ` Stronger players usually go on <b>${seq}</b>.` : ''}</p>` : ''}`;
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
    return { move, n: m.n, html: `<b>${label}:</b> ${say(move)} ${how}${agrees}` };
  });
  const RANK = ["Stockfish's choice", "Stockfish's second choice", "Stockfish's third choice"];
  engine.forEach((move, i) => {
    if (tips.length < 3 && !tips.some((t) => t.move.san === move.san)) tips.push({ move, engine: true, html: `<b>${RANK[i]}:</b> ${say(move)}` });
  });
  // Ranked best first: by Stockfish's order where it has looked, the moves it did not list after them.
  const rank = (t) => { const k = engine.findIndex((m) => m.san === t.move.san); return k < 0 ? 3 + tips.indexOf(t) : k; };
  const out = [...tips].sort((a, b) => rank(a) - rank(b));
  // A tag on each that says how it differs: Stockfish's top, the most played, the most forcing
  // (checks, captures, pieces attacked) and the safest (castles, or leaves the opponent the fewest
  // checks and captures). Each tag goes once, each tip gets at most one.
  const after = (t) => { const g = new Chess(at); g.move(t.move.san); return g; };
  const force = (t) => { const g = after(t), h = asMover(g, me); const hits = h ? h.moves({ verbose: true }).filter((x) => x.captured && x.captured !== 'p').length : 0;
    return (g.inCheck() ? 3 : 0) + (t.move.captured ? 2 : 0) + hits; };
  const risk = (t) => (t.move.flags.includes('k') || t.move.flags.includes('q') ? -1 : after(t).moves({ verbose: true }).filter((x) => x.captured || x.san.includes('+')).length);
  const free = () => out.filter((t) => !t.tag);
  const give = (tag, pick) => { const c = free(); const t = c.length > 1 || out.length === 1 ? pick(c) : null; if (t) t.tag = tag; };
  give('Best evaluation', (c) => c.find((t) => engine[0]?.san === t.move.san));
  give('Most played', (c) => c.filter((t) => t.n >= MIN_GAMES).sort((a, b) => b.n - a.n)[0]);
  give('Most aggressive', (c) => c.filter((t) => force(t) >= 2).sort((a, b) => force(b) - force(a))[0]);
  give('Safest', (c) => [...c].sort((a, b) => risk(a) - risk(b))[0]);
  return out;
}

// ---------- Game ----------
function start(op, keepTraps = false) {
  if (!keepTraps) trapRun = null; // choosing an opening ends trap training
  if (mode === 'explore') setMode('learn', false);
  cur = op;
  window.track?.('practise', `${op.side === 'b' ? 'Black' : 'White'}: ${(isVs(op) ? 'vs ' : '') + op.name}`);
  line = []; lines = []; game = new Chess();
  $('#depth-ask').hidden = true;
  $('#go-ask').hidden = true;
  ply = 0; sel = null; hintSq = []; wrongSq = null; lastMove = null;
  misses = 0; missesHere = 0; busy = true;
  $('#op-title').textContent = (isVs(op) ? 'vs ' : '') + op.name;
  $('#op-eco').textContent = op.eco;
  // How the opening goes at a rating, as a win/draw/loss bar, with a slider to try other ratings.
  $('#op-info').innerHTML = `<div class="op-odds"><div id="op-odds-bar"></div>
    <label class="op-odds-r">At rating <output id="op-odds-out">${rating || 1500}</output>
      <input id="op-odds-in" type="range" min="600" max="2600" step="50" value="${rating || 1500}" aria-label="Rating to show the results for"></label></div>`;
  const showOdds = () => { const r = Number($('#op-odds-in').value), x = oddsAt(op, r); $('#op-odds-out').textContent = r;
    $('#op-odds-bar').innerHTML = x ? wdl(x, op.side) : '<p class="info">Too few games at this rating.</p>'; };
  $('#op-odds-in').addEventListener('input', showOdds);
  showOdds();
  // Under the board: what the opening is about, your plan, and its idea and variations; the panel beside
  // the board is for the moves you play now.
  // The guide's idea replaces the short description where there is one, so nothing is said twice.
  { const gd = GUIDE[op.family] || GUIDE[shortName(op.family)], plan = planOf(op), about = gd ? gd.idea : aboutOf(op);
    $('#op-about').innerHTML = `${about ? `<p>${about}</p>` : ''}${plan ? `<p><b>Your plan:</b> ${plan}</p>` : ''}${gd ? `<p class="op-guide-k">Main variations</p>
      <ul class="op-lines">${gd.lines.map(([n, t]) => `<li><b>${n}:</b> ${t}</li>`).join('')}</ul><p><b>Watch out:</b> ${gd.watch}</p>` : ''}`; }
  $('#op-side').textContent = op.side === 'w' ? 'You play White' : 'You play Black';
  $('#restart').textContent = 'Restart';
  $('#picker').hidden = true;
  $('#trainer').hidden = false;
  render();
  if (!rating) return say(`Enter your Lichess ${speed} rating at the top.`);
  const all = buildLines(op), depths = load(STORE + '-depth', {});
  allLines = all;
  // Trap training needs every line; otherwise ask once per opening how deep to go.
  if (!trapRun && all.length > DEPTHS[0][1] && !depths[op.id]) return askDepth(all.length);
  lines = trapRun ? all : all.slice(0, depths[op.id] || MAX_LINES);
  setTimeout(classifyTraps, 1500); // after the board's first evaluation
  if (!lines.length) return say('Not enough games at your rating for this opening.', 'bad');
  const s = stats[statKey(op.id)] = { done: [], played: [], ...stats[statKey(op.id)], total: lines.length };
  s.played ??= [];
  store(STORE, stats);
  // The step to open in: Practice when lines are due for review, Learn while some are unlearned.
  if (!trapRun && (mode === 'learn' || mode === 'try')) {
    const due = dueCount(s), unlearned = lines.some((l) => !s.played.includes(lineKey(l.moves)));
    const want = due ? 'try' : unlearned ? 'learn' : 'try';
    if (want !== mode) setMode(want, false, false);
  }
  if (mode === 'time') startTrial(); else play(nextLine());
}

// The depth chooser over the board: one card per depth, with the lines it holds for this opening.
function askDepth(n) {
  const now = load(STORE + '-depth', {})[cur.id];
  const opts = DEPTHS.filter(([, d], i) => i === 0 || DEPTHS[i - 1][1] < n);
  $('#depth-ask').innerHTML = `<div class="depth-card"><p class="depth-k">How deep?</p><p class="depth-q">How much of the ${cur.name} do you want to learn?</p>
    ${opts.map(([name, d, about]) => `<button type="button" class="depth-opt${now === d ? ' now' : ''}" data-depth="${d}"><b>${name}</b><span>${about}</span><span class="depth-n">${Math.min(d, n)} lines</span></button>`).join('')}
    <p class="info">You can change it any time above the board.</p></div>`;
  $('#depth-ask').hidden = false;
  say('Choose how deep to go.');
}
$('#depth-ask').addEventListener('click', (e) => {
  const b = e.target.closest('[data-depth]');
  if (!b) return;
  store(STORE + '-depth', { ...load(STORE + '-depth', {}), [cur.id]: Number(b.dataset.depth) });
  $('#depth-ask').hidden = true;
  start(cur, true);
});
$('#depth').addEventListener('click', () => askDepth(allLines.length));

// again: the same line once more after a slip in Practice, which keeps it from counting as cleared.
function play(i, again = false) {
  if (drill && lineFor(drill.now ?? '') !== i) drill = null; // another line chosen: the drill ends
  lineIdx = i;
  const l = lines[i];
  line = l.moves;
  game = new Chess();
  ply = 0; sel = null; hintSq = []; wrongSq = null; lastMove = null;
  punish = 0; punishDone = false; endLen = 0; assisted = false;
  closeMoment();
  $('#op-more').open = mode === 'learn' && i === 0; // the opening's story goes with its first line
  misses = again ? misses : 0; missesHere = 0; busy = false;
  gameGen++; // ignore an opponent reply still on its way from the previous game
  playing = false; opponent = saidOpponent = null;
  premove = null; notes = []; betters = []; lineDone = ''; view = null;
  goAsked = false; $('#go-ask').hidden = true;
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
// Above Maia's range Stockfish plays at your rating (its lowest setting is 1320).
const opponentElo = () => Math.max(1320, Math.min(3190, rating));
// One search at a time: changing options while the WebAssembly engine searches crashes it.
// Resolves { move, cp, mate } with the score from the side to move, or null. skip() is asked when the
// search's turn comes: a search for a position you have already left is dropped.
// multi: how many best moves to rank (MultiPV); their first moves come back as lines, best first.
function search(fen, { elo = null, ms = 500, skip = null, multi = 1 } = {}) {
  const run = () => new Promise((resolve) => {
    if (skip?.()) return resolve(null);
    const fresh = !engine; // a new engine first loads its WebAssembly, which is slow on a phone
    if (!engine) {
      engine = new Worker(ENGINE_SRC);
      engine.addEventListener('error', () => { engine = null; engineDone?.(null); });
    }
    // An engine that never answers (crashed or hung, on a phone short of memory) is restarted, so
    // one lost search cannot block every search queued after it.
    const watchdog = setTimeout(() => { engine?.terminate(); engine = null; resolve(null); }, ms + (fresh ? 30000 : 5000));
    engineDone = (x) => { clearTimeout(watchdog); resolve(x); };
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
      clearTimeout(watchdog);
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
  // In the line itself the evaluation is noise; it shows when you explore or play on.
  el.style.visibility = mode === 'explore' || playing ? '' : 'hidden';
  // Looking back, the bar follows the position on the board (your slip is shown before it is played).
  let pos = game;
  if (view !== null) { const n = shownAt(view); pos = new Chess(); game.history().slice(0, n).forEach((m) => pos.move(m)); }
  const fen = pos.fen();
  let r = EVALS.get(evalKey(fen));
  if (pos.isCheckmate()) r = { cp: 0, mate: 0 };
  else if (pos.isDraw()) r = { cp: 0, mate: null };
  el.classList.toggle('stale', !r);
  el.classList.toggle('flip', cur.side === 'b');
  if (!r) { if (!$('#trainer').hidden) evaluate(fen); return; }
  const white = (pos.turn() === 'w' ? 1 : -1) * toCp(r);
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
let chance = null; // after their blunder: { ply of your answer, Stockfish's best answer }
// Why the move at ply n was a slip: what goes wrong on the board (a mate or a piece left hanging),
// or else the opponent's best answer to it and what that answer does; then the better move and its point.
function slipWhy(n, arrows = true) {
  const m = game.history({ verbose: true })[n], better = betters[n];
  const after = new Chess(m.before);
  after.move(m.san);
  const was = EVALS.get(evalKey(m.before)), now = EVALS.get(evalKey(after.fen()));
  const won = was && winPct(toCp(was)) >= 80; // the mover was winning before this move
  const drawn = after.isDraw() ? `It ends the game in a draw by ${drawReason(after)}${won ? ', when it was winning' : ''}.`
    : won && now && Math.abs(winPct(-toCp(now)) - 50) <= 12 ? 'It lets the win slip: the position is now about level, heading for a draw.' : '';
  const danger = drawn || (m.color === cur.side ? dangerAfter(m.before, m.san) : ''); // its wording is for your own moves
  const r = EVALS.get(evalKey(after.fen()));
  const reply = r?.move && new Chess(after.fen()).move(r.move);
  const replyIdea = reply && ideaAt(new Chess(after.fen()), reply.san);
  const wrong = danger || (reply ? `${sideName(after.turn())} answers ${reply.san}${replyIdea ? `: ${replyIdea.replace(/^./, (c) => c.toLowerCase())}` : '.'}` : '');
  const bestIdea = ideaAt(new Chess(m.before), better.san);
  const cost = reply ? tradeAfter(m, reply) : '';
  return `${wrong ? `Why: ${wrong} ` : ''}${cost ? `${cost} ` : ''}Better was <b>${better.san}</b>${bestIdea ? `: ${bestIdea.replace(/^./, (c) => c.toLowerCase())}` : '.'}${arrows ? ' (Green arrow; the move played is red.)' : ''}`;
}
// What the slip costs in material once the dust settles: the slip, the best answer, and the mover's
// best move after that when it takes something back (e.g. ...Bxh3 gxh3 Qxh3: a bishop for two pawns).
const MAT = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PLURAL = { p: 'pawns', n: 'knights', b: 'bishops', r: 'rooks', q: 'queens' };
function tradeAfter(m, reply) {
  const g = new Chess(m.before), seq = [m.san, reply.san];
  g.move(m.san); g.move(reply.san);
  const back = EVALS.get(evalKey(g.fen()))?.move, b = back && new Chess(g.fen()).move(back);
  if (b?.captured) seq.push(b.san);
  const run = new Chess(m.before), lost = [], won = [];
  for (const san of seq) { const x = run.move(san); if (x.captured) (x.color === m.color ? won : lost).push(x.captured); }
  const net = won.reduce((t, k) => t + MAT[k], 0) - lost.reduce((t, k) => t + MAT[k], 0);
  if (net > -2 || !lost.length) return '';
  const list = (ks) => Object.entries(ks.reduce((o, k) => ({ ...o, [k]: (o[k] || 0) + 1 }), {})).map(([k, n]) => (n > 1 ? `${n === 2 ? 'two' : n} ${PLURAL[k]}` : `a ${PIECE[k]}`)).join(' and ');
  return `After ${seq.join(' ')}, ${sideName(m.color)} has given ${list(lost)}${won.length ? ` for ${list(won)}` : ' for nothing'}.`;
}
// What makes a brilliant move work: the piece it leaves to be taken, and why taking it is no good.
function brilliantWhy(n) {
  const m = game.history({ verbose: true })[n], after = new Chess(m.before);
  after.move(m.san);
  const r = EVALS.get(evalKey(after.fen())), reply = r?.move && new Chess(after.fen()).move(r.move);
  const them = sideName(after.turn());
  const takes = reply && reply.to === m.to && reply.captured;
  return `It leaves the ${PIECE[m.piece]} on ${m.to} to be taken${takes ? `, and even after ${reply.san} you come out ahead` : `, but taking it is worse for ${them}${reply ? `: their best is ${reply.san} instead` : ''}`}.`;
}
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
  // Your answer to their blunder: say whether you took the chance.
  if (chance && i === chance.ply && !momentOpen) {
    const c = chance, idea = ideaAt(new Chess(before), m.san), lower = (x) => x.replace(/^./, (y) => y.toLowerCase());
    chance = null;
    if (notes[i] === 'best' || notes[i] === 'brilliant' || (m.from === c.best.from && m.to === c.best.to)) { banner('You found it!');
      moment('good', 'You found it!', `<b>${moveLabel(i, m.san)}</b> punishes the blunder${idea ? `: ${lower(idea)}` : '.'}`, [{ label: 'Play on', run: () => {} }], null, null, null); }
    else if (notes[i] === 'good') moment('good', 'Good move', `<b>${moveLabel(i, m.san)}</b> keeps the edge${idea ? `: ${lower(idea)}` : '.'} The strongest was ${moveWords(c.best)}.`, [{ label: 'Play on', run: () => {} }], null, null, null);
    else moment('chance', 'Chance missed', `The strong move was ${moveWords(c.best)}${(() => { const x = ideaAt(new Chess(before), c.best.san); return x ? `: ${lower(x)}` : '.'; })()}`, [{ label: 'Play on', run: () => {} }], null, [[c.best.from, c.best.to, GREEN]], null);
  }
  if (notes[i] === 'blunder' && playing && mode !== 'explore' && view === null && !momentOpen) bigMoment(i, a);
}
// A blunder while you play on stops the game: yours can be taken back, theirs is a chance to find.
// after: Stockfish on the position after the move (its best move is your answer to their blunder).
function bigMoment(i, after) {
  const m = game.history({ verbose: true })[i], label = moveLabel(i, m.san);
  if (m.color === cur.side) {
    view = i + 1; // the board shows the position before the slip, with its arrows (see renderBoard)
    return moment('blunder', 'Blunder', `<b>${label}</b> throws away a lot. ${slipWhy(i, false)} Red: your move, orange: their answer, green: better.`,
      [{ label: 'Take it back', run: () => takeBackTo(i) }, { label: 'Play on', run: () => showMove(Infinity) }], null, null, null);
  }
  if (i !== game.history().length - 1) return; // you have moved on already
  const best = after?.move && new Chess(game.fen()).move(after.move);
  chance = best ? { ply: i + 1, best } : null;
  moment('chance', 'Chance!', `${sideName(m.color)}'s <b>${label}</b> (red arrow) was a blunder. There is a strong move for you now: look at checks, captures and threats.`,
    [{ label: 'Find it', run: () => {} }, ...(best ? [{ label: 'Show me', run: () => { hintSq = [best.from, best.to]; renderBoard(); say(`${moveWords(best)}.`, 'good'); } }] : [])], null, [[m.from, m.to, RED]], null);
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

let opponent = null, saidOpponent = null; // who plays the opponent now (shown over the board), and who was announced
// Where the saved real games run out: when you are logged in to Lichess, real games from its whole
// database; then Maia, a net trained on Lichess games, which plays the move a player of your rating
// would likely play (its own human mistakes included); above its range, or if it cannot load,
// Stockfish at your rating.
async function engineReply(at) {
  const live = await liveGames(at, ratingsAround(rating).map((i) => BUCKETS[i]), speed);
  const total = live ? live.white + live.draws + live.black : 0;
  if (live?.moves?.length && total >= MIN_GAMES) {
    return { san: live.moves[0].san, label: `Lichess games ${levelText(rating)}`,
      note: `The saved games run out here, so the moves now come from all ${total.toLocaleString('en')} Lichess games at your level in this position.` };
  }
  if (rating < MAIA_MAX + 100) {
    try {
      const h = game.history({ verbose: true });
      const { move } = await maiaMove(rating, h.length ? [h[0].before, ...h.map((x) => x.after)] : [at], game.moves({ verbose: true }));
      return { san: move.san, label: `Maia ${maiaLevel(rating)}`,
        note: `Real games at your level run out here, so Maia plays the opponent now: a computer trained on Lichess games to play like people rated about ${maiaLevel(rating)}.` };
    } catch (e) { console.warn(e); }
  }
  const best = await bestMove(at, { elo: opponentElo() });
  return best && { ...best, label: `Stockfish ${opponentElo()}`, note: `Real games at your level run out here, so Stockfish plays the opponent now, set to about ${opponentElo()}.` };
}
async function opponentPlays() {
  busy = true;
  const gen = gameGen, at = game.fen();
  // Follow the real games as long as any reach this position: the reply played most there.
  const real = gamesAt(game.history().map(clean)).moves[0];
  let m = real ? { san: real.san, label: `Real games ${levelText(rating)}` } : await engineReply(at).catch((e) => (console.warn(e), null));
  if (!m && gen === gameGen && game.fen() === at && !game.isGameOver()) { // no engine answered: the game goes on all the same
    const all = game.moves();
    m = { san: all[Math.floor(Math.random() * all.length)], label: 'Random move', note: 'The engines did not answer here, so the opponent played a random legal move.' };
  }
  await new Promise((x) => setTimeout(x, 450));
  if (gen !== gameGen || game.fen() !== at || !m) { if (gen === gameGen) busy = false; return; }
  lastMove = game.move(m.san ?? m); ply++; busy = false; hintSq = []; opponent = m.label;
  rate(ply - 1, at, lastMove);
  render();
  if (ended()) return;
  if (playPremove()) return;
  const note = m.note && m.label !== saidOpponent ? ` ${m.note}` : '';
  saidOpponent = m.label;
  if (punishDone && !endLen) return punish > 0 ? (say('Your move: keep punishing it.', 'good'), guide()) : finish();
  say(`Your move.${note}`);
  guide();
}

// Why a finished game is a draw, in words.
const drawReason = (g) => (g.isStalemate() ? 'stalemate' : g.isThreefoldRepetition() ? 'threefold repetition' : g.isInsufficientMaterial() ? 'insufficient material' : 'the 50-move rule');
function ended() {
  if (!game.isGameOver()) return false;
  if (punishDone && !endLen) finish(); // the guided moves ended the game: the line is done
  if (!game.isCheckmate()) { say(`Draw by ${drawReason(game)}. Press Next line to go on.`); banner(`Draw · ${drawReason(game)}`, 'draw'); }
  else if (game.turn() === cur.side) { say('Checkmate: you lost this one. Press Restart to play the line again.', 'bad'); banner('Checkmated', 'lost'); }
  else { say('Checkmate! You won.', 'good'); celebrate(); }
  return true;
}
// The banner over the board when a game ends (a win also gets confetti, see celebrate).
function banner(text, kind = '') {
  const frame = $('.board-frame');
  frame.querySelector('.mate-banner')?.remove();
  frame.insertAdjacentHTML('beforeend', `<div class="mate-banner${kind ? ` ${kind}` : ''}" role="status">${text}</div>`);
  setTimeout(() => frame.querySelector('.mate-banner')?.remove(), 3500);
}

// When the game is over: how your moves were rated, kind by kind (badges arrive as Stockfish rates them).
const KINDS = ['brilliant', 'best', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];
const KIND_NAME = { brilliant: 'Brilliant', best: 'Best', good: 'Good', book: 'Book', inaccuracy: 'Inaccuracies', mistake: 'Mistakes', blunder: 'Blunders' };
function gameStats() {
  const mine = notes.filter((k, i) => k && (i % 2 === 0) === (cur.side === 'w'));
  const count = (k) => mine.filter((x) => x === k).length;
  const badge = (k) => `<span class="mark k-${k} legend-badge">${k === 'book' ? BOOK_ICON : GLYPH[k]}</span>`;
  const result = game.isCheckmate() ? (game.turn() === cur.side ? 'You were checkmated' : 'You won by checkmate') : `Draw by ${drawReason(game)}`;
  return `<div class="game-stats"><p class="gs-head">${result} · your ${plural(mine.length, 'move')}</p>
    <ul>${KINDS.map((k) => `<li class="${count(k) ? '' : 'none'}"><button type="button" data-kind="${k}" ${count(k) ? '' : 'disabled'}>${badge(k)}<b>${count(k)}</b> ${KIND_NAME[k]}</button></li>`).join('')}</ul></div>`;
}
$('#why').addEventListener('click', (e) => {
  const kind = e.target.closest('.game-stats button[data-kind]')?.dataset.kind;
  if (!kind) return;
  const mine = notes.map((k, i) => (k === kind && (i % 2 === 0) === (cur.side === 'w') ? i : -1)).filter((i) => i >= 0);
  const at = view === null ? -1 : view - 1;
  goTo((mine.find((i) => i > at) ?? mine[0]) + 1);
});
const BOOK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6c3-1.5 5.5-1.5 8 0 2.5-1.5 5-1.5 8 0v12c-3-1.5-5.5-1.5-8 0-2.5-1.5-5-1.5-8 0zM12 6v12"/></svg>';

// A moment that matters (a trap, a blunder, a chance) stops the game: a card over the board, which
// stays until you choose what to do. kind: trap | blunder | chance. actions: [{ label, run }], the
// first is the main one. swing: [before, after] your score, drawn as a bar.
let momentOpen = false;
// onBoard: what touching the board does while the moment is up (it closes the moment first); a moment
// without one blocks the board until you press its button.
function moment(kind, title, html, actions, swing = null, arrows = null, onBoard = undefined) {
  closeMoment();
  momentOpen = true; momentArrows = arrows; momentOnBoard = onBoard; momentAt = game.history().join(' ');
  const bar = swing ? `<div class="moment-swing"><span>Your chances</span><b>${pct(swing[0])}</b><i aria-hidden="true"><s style="width:${swing[0] * 100}%"></s><s class="to" style="width:${swing[1] * 100}%"></s></i><b>${pct(swing[1])}</b></div>` : '';
  // At the top of the panel beside the board (under it on a phone): the board never moves, and stays
  // in full view with the moment's arrows on it.
  $('.panel').insertAdjacentHTML('afterbegin', `<div class="moment moment-${kind}" role="alertdialog" aria-labelledby="moment-title">
    <p class="moment-title" id="moment-title">${title}</p><p class="moment-text">${html}</p>${bar}
    <div class="moment-actions">${actions.map((a, i) => `<button type="button" class="${i ? 'ghost' : 'cta'}" data-act="${i}">${a.label}</button>`).join('')}</div></div>`);
  const el = $('.moment');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    closeMoment();
    actions[Number(b.dataset.act)].run();
  });
  el.querySelector('[data-act]').focus({ preventScroll: true });
  renderBoard();
  // On a phone the moment sits under the board: scroll just enough that its buttons are in view
  // (the header goes first, so the board stays on screen).
  const r = el.getBoundingClientRect();
  if (PHONE.matches && r.bottom > innerHeight) scrollBy({ top: r.bottom - innerHeight + 12, behavior: 'smooth' });
}
// Arrows for the moment on the board: [from, to, colour]; red for the move it is about.
let momentArrows = null, momentOnBoard, momentAt = '';
// Touching the board while a moment is up runs its board action; the strip itself stays until a move
// has been made and the piece let go, so the board does not jump under your hand.
function settleMoment() {
  if (!momentOpen || !momentOnBoard) return;
  const run = momentOnBoard;
  momentOnBoard = null;
  run();
}
// While a piece is held the board is not redrawn (that would swap the piece under your hand, and the
// dragged piece would stop following the pointer); it is drawn once you let go.
let boardHeld = false, boardDirty = false;
boardEl.addEventListener('pointerdown', () => { boardHeld = true; });
for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => {
  boardHeld = false;
  if (boardDirty) { boardEl._noAnim = boardDirty === 'drop'; boardDirty = false; renderBoard(); } // a dropped piece is already where it lands
  setTimeout(leaveMoment);
});
function leaveMoment() {
  if (!momentOpen || momentOnBoard === undefined || boardHeld) return;
  const now = game.history({ verbose: true }), at = momentAt ? momentAt.split(' ') : [];
  const same = at.every((m, i) => now[i] && clean(now[i].san) === clean(m));
  if (!same || now.slice(at.length).some((m) => m.color === cur.side)) closeMoment(); // taken back, or a move of yours since
}
const boardBlocked = () => momentOpen && momentOnBoard === undefined;
const RED = '#c4242a', ORANGE = '#e07b00', GREEN = '#15781b';
function closeMoment() {
  $('.moment')?.remove();
  if (!momentOpen) return;
  momentOpen = false; momentArrows = null;
  if (cur) renderBoard();
}

// A short banner over the board, for the end of a line.
function flash(text, kind = 'line') {
  const frame = $('.board-frame');
  frame.querySelector('.mate-banner')?.remove();
  frame.insertAdjacentHTML('beforeend', `<div class="mate-banner line-banner ${kind}-banner" role="status">${text}</div>`);
  setTimeout(() => frame.querySelector('.line-banner')?.remove(), 1800);
}

// Checkmate by you: a banner over the board and a short burst of confetti (no confetti with reduced motion).
function celebrate() {
  const frame = $('.board-frame');
  banner('Checkmate!');
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
  // A playable move is not a mistake, so it is said calmly; a move strong players avoid is said in red.
  say(`${san} is not the move here. ${parts.join(' ')}`, share(clean(san)) >= RARE ? '' : 'bad');
  // A sound move with games behind it can become your own move here.
  const rootLen = Math.max(...(cur.roots || [{ moves: cur.root.split(' ') }]).map((r) => r.moves.length)); // the opening's own moves stay
  if (mode === 'learn' && ply >= rootLen && share(clean(san)) >= RARE && score(clean(san)) !== null) {
    msgEl.insertAdjacentHTML('beforeend', ` <button type="button" class="link" data-choose="${clean(san)}">Play ${clean(san)} here in my lines</button>`);
  }
}

// Making a move your own: the lines are built again around it, and you go on from right after it.
function chooseMove(san) {
  const before = line.slice(0, ply), at = [...before, san];
  choices[cur.id] = { ...choices[cur.id], [lineKey(before)]: san };
  rebuildLines();
  const i = lines.findIndex((l) => (lineKey(l.moves) + ' ').startsWith(lineKey(at) + ' '));
  if (i < 0) { // no game goes on from there: keep the old move
    delete choices[cur.id][lineKey(before)];
    rebuildLines();
    return say(`Too few games go on after ${san} to build a line from it.`, 'bad');
  }
  store(CHOICE_KEY, choices);
  play(i);
  gameGen++; busy = false; hintSq = []; // play()'s own first reply no longer applies
  for (const m of at) { lastMove = game.move(m); notes[ply++] = 'book'; }
  render();
  say(`${san} is now your move here. Your lines are built around it.`, 'good');
  if (ply >= line.length) finish(); else reply();
}
function unchoose(key) {
  delete choices[cur.id]?.[key];
  store(CHOICE_KEY, choices);
  rebuildLines();
  play(Math.min(lineIdx, lines.length - 1));
}
function rebuildLines() {
  lines = buildLines(cur);
  classifyTraps();
  stats[statKey(cur.id)].total = lines.length;
  store(STORE, stats);
}
msgEl.addEventListener('click', (e) => { const b = e.target.closest('[data-choose]'); if (b && !busy) chooseMove(b.dataset.choose); });

// A trap against you: a move your side often plays here at your level (a tenth of the games or more,
// TRAP_GAMES at least) that scores TRAP_SCORE or less, other than the line's.
function careful(before, want) {
  const x = explore(before, ratingsAround(rating));
  return x.moves.filter((m) => m.san !== want && m.n >= TRAP_GAMES && m.n / x.total >= 0.1 && scoreFor(m, cur.side) <= TRAP_SCORE).sort((a, b) => b.n - a.n)[0];
}

// ---------- Trap training: the traps of your openings, one after another ----------
// The traps (and common mistakes) of your starred openings, or of the ten most played White openings,
// in a random order. Each starts right before the opponent's slip; you punish it, then Next trap.
// It does not count towards clearing lines (you did not play them from the start).
let trapRun = null; // { queue: [{ op, key, ply }], now, done, total }
function startTraps() {
  const trapsOf = (ops) => ops.flatMap((op) => buildLines(op).filter((l) => l.trap).map((l) => ({ op, key: lineKey(l.moves), ply: l.trap.ply })))
    .sort(() => Math.random() - 0.5).slice(0, 15);
  let queue = trapsOf(OPENINGS.filter((o) => repertoire.has(o.id)));
  if (!queue.length) queue = trapsOf(shown().filter((o) => o.side === 'w').slice(0, 10)); // starred ones without traps: the most played
  if (!queue.length) return say('No traps in these openings at your level.');
  trapRun = { queue, done: 0, total: queue.length };
  nextTrap();
}
function nextTrap() {
  closeMoment();
  const t = trapRun.queue.shift();
  if (!t) {
    const n = trapRun.total;
    trapRun = null;
    renderLineBox();
    return say(`Trap training done: ${plural(n, 'trap')}. Press Next line to go on with this opening.`, 'good');
  }
  trapRun.now = t; trapRun.done++;
  setupTrap(t);
}
function setupTrap(t) {
  if (cur?.id !== t.op.id) start(t.op, true);
  if (mode !== 'try') setMode('try', false, false);
  const i = lines.findIndex((l) => lineKey(l.moves) === t.key);
  if (i < 0) return nextTrap();
  play(i);
  gameGen++; busy = false; hintSq = []; // play()'s own start no longer applies
  for (const x of lines[i].moves.slice(0, t.ply)) { lastMove = game.move(x); notes[ply++] = 'book'; }
  assisted = true;
  render();
  say(`Trap ${trapRun.done} of ${trapRun.total}: watch their next move.`);
  reply(); // their move: the slip
}

// ---------- Idea questions: what your next move should do ----------
// Now and then in Practice, before your move: what should it do? Three answers in words, from the
// line's move and two other moves people play here (or other legal ones), so you think of the idea
// first and then find the move. Answering is optional: just play your move.
const IDEA_EVERY = 3; // about one of your moves in three, after the first two
const short = (t) => t.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.');
function askIdea() {
  if (drill || momentOpen || ply < 4 || !userTurn() || Math.random() * IDEA_EVERY >= 1) return;
  const g = () => new Chess(game.fen());
  const right = ideaAt(g(), line[ply]);
  if (!right) return;
  const seen = new Set([short(right)]);
  const others = [...gamesAt(line.slice(0, ply)).moves.map((m) => m.san), ...g().moves().sort(() => Math.random() - 0.5)]
    .filter((san) => san !== line[ply])
    .map((san) => short(ideaAt(g(), san) || ''))
    .filter((t) => t.length > 1 && !seen.has(t) && seen.add(t))
    .slice(0, 2);
  if (others.length < 2) return;
  const answers = [{ text: short(right), ok: true }, ...others.map((text) => ({ text, ok: false }))].sort(() => Math.random() - 0.5);
  moment('quiz', 'What should your move do?', 'Pick the idea first, then play the move. Or just play it.',
    answers.map((a) => ({ label: a.text, run: () => say(a.ok ? `Yes: ${a.text} Now find the move that does it.` : `Not that one. Your move here: ${short(right).replace(/^./, (c) => c.toLowerCase())} Now find it.`, a.ok ? 'good' : 'bad') })),
    null, null, null);
}

// ---------- Hard moves: the moves you miss, drilled on their own ----------
// A move you get wrong in Practice is kept per opening by the moves before it, in boxes like lines are:
// a miss puts it in box 0 (due now), finding it moves it up a box (due after that box's days). Drill
// sets up the position right before each due one, so you practise just that move, not the whole line.
const HARD_KEY = STORE + '-hard';
let hard = load(HARD_KEY, {}); // { [statKey]: { [moves before]: { box, due } } }
let drill = null; // { queue: [moves before], now, ply, total, done } while drilling
const hardOf = () => (hard[statKey(cur.id)] ??= {});
function hardMiss() {
  hardOf()[lineKey(line.slice(0, ply))] = { box: 0, due: Date.now() };
  store(HARD_KEY, hard);
}
function hardHit() {
  const k = lineKey(line.slice(0, ply)), h = hardOf()[k];
  if (!h || h.due > Date.now()) return;
  h.box++;
  if (h.box >= INTERVALS.length) delete hardOf()[k]; else h.due = Date.now() + INTERVALS[h.box] * DAY;
  store(HARD_KEY, hard);
}
// The due hard moves that one of today's lines still reaches.
const lineFor = (k) => lines.findIndex((l) => (lineKey(l.moves) + ' ').startsWith(k ? k + ' ' : ''));
const hardDue = () => Object.entries(hardOf()).filter(([k, h]) => h.due <= Date.now() && lineFor(k) >= 0).map(([k]) => k);
function startDrill() {
  const queue = hardDue();
  if (!queue.length) return;
  if (mode !== 'try') setMode('try', false, false);
  drill = { queue, total: queue.length, done: 0 };
  nextDrill();
}
function nextDrill() {
  closeMoment();
  const k = drill.queue.shift();
  if (k === undefined) {
    drill = null;
    renderLineBox();
    return say('Hard moves done. Press Restart to go on with your lines.', 'good');
  }
  drill.now = k; drill.done++;
  const before = k ? k.split(' ') : [];
  play(lineFor(k));
  gameGen++; busy = false; hintSq = []; // play()'s own start no longer applies
  for (const x of before) { lastMove = game.move(x); notes[ply++] = 'book'; }
  drill.ply = ply;
  render();
  say(`Hard move ${drill.done} of ${drill.total}: you missed this one before. Find the move.`);
}
$('#line-box').addEventListener('click', (e) => { if (e.target.closest('[data-drill]')) startDrill(); });

// ---------- Practice: lines come back for review ----------
// A line cleared in Practice moves up a box and comes back after the box's interval; a mistake sends it
// back to the start, to be practised again today.
const DAY = 864e5;
const INTERVALS = [0, 1, 3, 7, 14, 30]; // days, per box
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function review(ok) {
  const s = stats[statKey(cur.id)];
  s.rep ??= {};
  const key = lineKey(lines[lineIdx].moves); // the line as listed, whatever move order you took
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
// The main line is called that, as in a course; the other lines by their opening name.
const lineName = (l) => (l.branch === 1 ? 'Main line' : l.name ? l.name.split(' · ').at(-1).split(': ').at(-1) : 'Side line');
const moveLabel = (i, san) => `${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'}${san}`;
// What tells a line apart: the trap it punishes, or the move where it leaves the main line (the main
// line itself: its last moves).
function lineTag(l) {
  if (l.trap) return `if they play ${trapMove(l.trap)}`;
  const main = lines[0]?.moves || [];
  const i = l.moves.findIndex((m, k) => m !== main[k]);
  return l === lines[0] || i < 0 ? lineEnd(l) : `after ${moveLabel(i, l.moves[i])}`;
}
// The line's last two moves with their real move numbers, e.g. "5.O-O d6", so same-named lines can be told apart.
// A line's trap: the opponent's natural-looking slip, how well you do after it, and the move that
// punishes it with what that move does.
const trapMove = (t) => `${Math.floor(t.ply / 2) + 1}${t.ply % 2 ? '...' : '.'}${t.san}?`;
// The punishing move as a green arrow, in Learn only (in Practice you find it yourself).
function punishArrow(t) {
  const san = lines[lineIdx].moves[t.ply + 1];
  if (mode !== 'learn' || !san) return [];
  const m = new Chess(game.fen()).move(san);
  return [[m.from, m.to, GREEN]];
}
// Right after you punish the line's slip: why your move was right, and what it brings.
function punished(m) {
  const t = lines[lineIdx]?.trap, i = game.history().length - 1;
  if (!t || i !== t.ply + 1 || mode === 'time') return;
  const idea = ideaAt(new Chess(m.before), m.san), them = sideName(m.color === 'w' ? 'b' : 'w');
  moment('good', 'Punished!', `<b>${moveLabel(i, m.san)}</b> is the answer to ${trapMove(t)}${idea ? `: ${idea.replace(/^./, (c) => c.toLowerCase())}` : '.'} ${t.kind === 'trap' && t.win
    ? `Now ${them} cannot hold everything: you win ${t.win}.` : `${them} is now behind in time and development: you have the easier game.`}`, [{ label: 'Got it', run: () => {} }], null, null, null);
}
function punishText(t) {
  const l = lines[lineIdx], san = l.moves[t.ply + 1];
  if (!san) return '';
  const g = new Chess();
  l.moves.slice(0, t.ply + 1).forEach((m) => g.move(m));
  const idea = ideaAt(g, san);
  return `The answer is <b>${san}!</b>${idea ? `: ${idea.replace(/^./, (c) => c.toLowerCase())}` : '.'}`;
}
// A trap or a common mistake: a trap loses something concrete (material, or mate) by Stockfish's best
// line after it; a common mistake only gives you the easier game (time, development, a weak king).
// t.kind is 'trap' or 'mistake' once Stockfish has looked (classifyTraps), t.win what you win.
const trapWord = (t) => (t.kind === 'mistake' ? 'Common mistake' : 'Trap');
// Why a common mistake is one, read from the position, and how to use it: the first reason that
// holds of a queen out early, a blocked bishop, a piece moved twice, a flank or f-pawn move, or a
// piece left undefended; else the time it costs.
function mistakeWhy(t) {
  const l = lines[lineIdx], g = new Chess();
  l.moves.slice(0, t.ply).forEach((x) => g.move(x));
  const m = g.move(l.moves[t.ply]);
  if (!m) return null;
  const c = m.color, back = c === 'w' ? '1' : '8', who = sideName(c), early = t.ply < 20;
  const at = (sq) => g.get(sq);
  const loose = g.board().flat().filter((x) => x && x.color === c && x.type !== 'k' && x.type !== 'p'
    && g.isAttacked(x.square, c === 'w' ? 'b' : 'w') && !g.isAttacked(x.square, c));
  if (loose.length) return { why: `It leaves the ${PIECE[loose[0].type]} on ${loose[0].square} undefended.`, how: `Attack it: ${who} must spend another move saving it.` };
  if (m.piece === 'q' && early) return { why: `It brings the queen out early. Your pieces can now develop with gain of time by attacking it.`, how: `Develop with threats against the queen, then castle and open the centre.` };
  const bishop = ['c', 'f'].map((f) => f + back).find((sq) => at(sq)?.type === 'b' && at(sq)?.color === c);
  const blocks = bishop && [`${bishop[0] === 'f' ? 'e' : 'd'}${c === 'w' ? '2' : '7'}`, `${bishop[0] === 'f' ? 'g' : 'b'}${c === 'w' ? '2' : '7'}`].includes(m.to) && m.piece !== 'p';
  if (blocks) return { why: `It blocks the bishop on ${bishop}, so ${who}'s development and castling are slow.`, how: `Castle, bring out your pieces and open the centre before ${who} untangles.` };
  if (m.piece !== 'p' && m.piece !== 'k' && early && m.from[1] !== back) return { why: `It moves the ${PIECE[m.piece]} a second time instead of bringing out a new piece.`, how: `Use the extra move: develop, castle, and start play in the centre.` };
  if (m.piece === 'p' && 'f'.includes(m.from[0]) && early) return { why: `It moves the f-pawn and weakens ${who}'s king.`, how: `Aim at the weakened king: the diagonal to it and the squares around it.` };
  if (m.piece === 'p' && 'abgh'.includes(m.from[0]) && early) return { why: `It spends a move on a flank pawn while ${who}'s pieces wait at home.`, how: `Use the time: develop, castle, and strike in the centre.` };
  return { why: `It costs ${who} time: the move does not help development or the centre.`, how: `Use the time: develop with threats and take the initiative.` };
}
const trapStory = (l) => `At your level your opponent often plays <b>${trapMove(l.trap)}</b>. ${l.trap.kind === 'trap' && l.trap.win
  ? `It looks natural, but it loses ${l.trap.win}` : l.trap.kind === 'mistake' ? `It is no blunder, but it hands you the easier game. ${mistakeWhy(l.trap)?.why.replace(/\.$/, '') || 'It costs time'}` : 'It looks natural, but it lets you win'}: you score ${pct(1 - l.trap.score)} after it. This line shows how to punish it.`;
const TRAPS_KEY = STORE + '-traps'; // { [fen before | move]: { kind, win } }, so Stockfish looks once
// What a run of moves wins for the side to move at its start: the pieces each side loses, as words.
function winOf(fen, pv) {
  const g = new Chess(fen), me = g.turn(), lost = { [me]: [], other: [] };
  for (let i = 0; i < pv.length && (i < 6 || g.history({ verbose: true }).at(-1)?.captured); i++) { // a capture at the end is answered first
    let m;
    try { m = g.move({ from: pv[i].slice(0, 2), to: pv[i].slice(2, 4), promotion: pv[i][4] }); } catch { break; }
    if (m.captured) (m.color === me ? lost.other : lost[me]).push(m.captured);
    if (g.isCheckmate()) return { mate: m.color === me };
  }
  const pts = (xs) => xs.reduce((s, t) => s + VALUE_OF[t], 0);
  const net = pts(lost.other) - pts(lost[me]);
  const top = [...lost.other].sort((a, b) => VALUE_OF[b] - VALUE_OF[a])[0], mine = [...lost[me]].sort((a, b) => VALUE_OF[b] - VALUE_OF[a])[0];
  return { net, text: top ? `${top === 'p' && net >= 2 ? `${net} pawns` : `a ${PIECE[top]}`}${mine && VALUE_OF[mine] >= 3 ? ` for a ${PIECE[mine]}` : ''}` : '' };
}
console.assert(winOf('4k3/8/8/8/8/8/3n4/3QK3 w - - 0 1', ['d1d2']).net === 3, 'winOf: Qxd2 wins a knight');
async function classifyTraps() {
  const known = load(TRAPS_KEY, {}), mine = lines;
  for (const l of mine) {
    const t = l.trap;
    if (!t || t.kind) continue;
    const g = new Chess();
    l.moves.slice(0, t.ply).forEach((m) => g.move(m));
    const key = `${evalKey(g.fen())}|${t.san}`;
    if (!known[key]) {
      const before = await search(g.fen(), { ms: 400 });
      g.move(t.san);
      const after = await search(g.fen(), { ms: 600 });
      if (!before || !after) return;
      const drop = toCp(before) + toCp(after); // what the slip cost its player, in centipawns
      const w = after.mate > 0 ? { mate: true } : winOf(g.fen(), after.pv);
      known[key] = w.mate ? { kind: 'trap', win: 'the game: there is a mate' }
        : w.net >= 1 && drop >= 100 ? { kind: 'trap', win: w.text } : { kind: 'mistake' };
      store(TRAPS_KEY, known);
    }
    for (const x of mine) if (x.trap && x.trap.ply === t.ply && x.trap.san === t.san && lineKey(x.moves.slice(0, t.ply)) === lineKey(l.moves.slice(0, t.ply))) Object.assign(x.trap, known[key]);
    if (lines !== mine) return; // another opening or rebuilt lines: they get their own run
    renderLines(); renderLineBox(); renderWhy();
  }
}
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
  $('#line-box').innerHTML = `
    <h2 class="lb-name">Line ${lineIdx + 1} of ${n}: ${lineName(l)} <small>${lineTag(l)}</small></h2>
    ${Object.entries(choices[cur.id] || {}).filter(([k, san]) => { const i = k ? k.split(' ').length : 0; return lineKey(l.moves.slice(0, i)) === k && l.moves[i] === san; })
      .map(([k, san]) => `<p class="lb-choice">Your own move: <b>${moveLabel(k ? k.split(' ').length : 0, san)}</b> <button type="button" class="link" data-unchoose="${k}">Use the suggested move</button></p>`).join('')}
    ${s.done?.includes(lineKey(l.moves)) ? '<p class="lb-status cleared"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>You have cleared this line</p>'
      : s.played?.includes(lineKey(l.moves)) ? '<p class="lb-status"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>You have learned this line</p>' : ''}
    <div class="lb-stats">
      ${l.trap ? `<div class="lb-trap"><b>${trapMove(l.trap)}</b><span>the ${trapWord(l.trap).toLowerCase()}${l.trap.win ? `: it loses ${l.trap.win}` : `: you score ${pct(1 - l.trap.score)} after it`}</span></div>` : bigShare(l.share) ? `<div><b>${bigShare(l.share)}</b><span>of games in this opening go this way</span></div>` : ''}
      <div><b>${played}/${n}</b><span>lines learned</span></div>
      <div><b>${done}/${n}</b><span>lines cleared${due ? `, ${due} due for review` : ''}</span></div>
    </div>
    <div class="lb-bar" aria-hidden="true"><span class="lb-done" style="width:${(done / n) * 100}%"></span><span class="lb-played" style="width:${(Math.max(0, played - done) / n) * 100}%"></span></div>
    ${trapRun ? `<p class="lb-choice">Trap training: ${trapRun.done} of ${trapRun.total}</p>` : ''}
    ${hardDue().length && !drill ? `<p class="lb-choice">${plural(hardDue().length, 'hard move')} to drill <button type="button" class="link" data-drill>Drill them</button></p>` : ''}
    ${mode === 'try' && practiceSet().length ? `<p class="lb-note">Practising lines ${practiceSet().map((i) => i + 1).join(', ')}.</p>` : ''}
    <p class="lb-note">${nextReview ? nextReview + ' ' : ''}Progress is saved in this browser.</p>`;
}

$('#line-box').addEventListener('click', (e) => { const b = e.target.closest('[data-unchoose]'); if (b) unchoose(b.dataset.unchoose); });

function renderLines() {
  const s = stats[statKey(cur.id)] || {}, done = s.done || [], learned = s.played || [];
  const all = allLines.length >= lines.length ? allLines : lines;
  $('#lines-sum').textContent = `All ${all.length} lines`; // the line box above already counts the cleared ones
  // Green once you have played a line through (Learn), stronger with a tick once cleared (Practice).
  const state = (l) => (done.includes(lineKey(l.moves)) ? ' cleared' : learned.includes(lineKey(l.moves)) ? ' learned' : '');
  // One star per line, its best: green when played through in Learn, gold when cleared in Practice,
  // diamond when played without a slip in Time.
  const timed = s.timed || [];
  const star = (l) => { const k = lineKey(l.moves), t = timed.includes(k) ? ['diamond', 'Played without a slip in Time'] : done.includes(k) ? ['gold', 'Cleared in Practice'] : learned.includes(k) ? ['green', 'Played through in Learn'] : null;
    return t ? `<svg class="line-star ${t[0]}" viewBox="0 0 24 24" role="img" aria-label="${t[1]}"><title>${t[1]}</title><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>` : ''; };
  // Every line, in course order, under the depth it belongs to; those past your depth are paler.
  const group = (i) => (all.length > DEPTHS[0][1] ? DEPTHS.find(([, d], k) => i === (k ? DEPTHS[k - 1][1] : 0)) : null);
  $('#lines-list').innerHTML = all.map((l, i) => `${group(i) ? `<li class="line-group">${group(i)[0]}</li>` : ''}<li><button type="button" class="line-btn${i === lineIdx ? ' now' : ''}${state(l)}${i >= lines.length ? ' beyond' : ''}" data-i="${i}">
      <span class="line-n">${i + 1}.</span><span class="line-name">${l.trap ? `<span class="trap-tag${l.trap.kind === 'mistake' ? ' soft' : ''}">${trapWord(l.trap)}</span> ` : l.theory ? '<span class="trap-tag theory">Theory</span> ' : ''}${lineName(l)}<small>${lineTag(l)}</small></span>
      <span class="line-share">${bigShare(l.share)}</span><span class="line-ok">${star(l)}</span>
    </button></li>`).join('');
  if (linesView === 'tree') renderTree();
}
$('#lines-list').addEventListener('click', (e) => {
  const b = e.target.closest('.line-btn');
  if (!b) return;
  const i = Number(b.dataset.i);
  if (i >= lines.length) { // a line past your depth: go as deep as it is, then play it
    store(STORE + '-depth', { ...load(STORE + '-depth', {}), [cur.id]: DEPTHS.find(([, d]) => i < d)[1] });
    start(cur, true);
  }
  play(i);
});

// The lines as a tree, as a course's overview: the moves they share once, a branch where they part,
// and at each line's end its number and how far you are with it.
let linesView = load(STORE + '-lines-view', 'list');
function renderTree() {
  const s = stats[statKey(cur.id)] || {}, done = s.done || [], learned = s.played || [];
  const root = { kids: new Map(), ends: [] };
  lines.forEach((l, i) => {
    let node = root;
    for (const m of l.moves) { if (!node.kids.has(m)) node.kids.set(m, { kids: new Map(), ends: [] }); node = node.kids.get(m); }
    node.ends.push(i);
  });
  const label = (ply, san, first) => (ply % 2 === 0 ? `${ply / 2 + 1}.${san}` : first ? `${(ply + 1) / 2}...${san}` : san);
  const end = (i) => {
    const k = lineKey(lines[i].moves), st = done.includes(k) ? 'cleared' : learned.includes(k) ? 'learned' : 'new';
    return `<button type="button" class="tree-end ${st}${i === lineIdx ? ' now' : ''}" data-i="${i}">${lines[i].trap ? `<span class="trap-tag${lines[i].trap.kind === 'mistake' ? ' soft' : ''}">${trapWord(lines[i].trap)}</span> ` : ''}Line ${i + 1}<small>${st === 'new' ? 'not played' : st}</small></button>`;
  };
  // One branch: its moves up to the next fork or line end, then what follows.
  const branch = (san, node, ply) => {
    const seq = [label(ply, san, true)];
    while (node.kids.size === 1 && !node.ends.length) { const [m, next] = [...node.kids][0]; ply++; seq.push(label(ply, m, false)); node = next; }
    return `<li><span class="tree-moves">${seq.join(' ')}</span>${node.ends.map(end).join('')}${node.kids.size ? `<ul>${[...node.kids].map(([m, n]) => branch(m, n, ply + 1)).join('')}</ul>` : ''}</li>`;
  };
  $('#lines-tree').innerHTML = `<ul>${[...root.kids].map(([m, n]) => branch(m, n, 0)).join('')}</ul>`;
}
$('#lines-tree').addEventListener('click', (e) => { const b = e.target.closest('.tree-end'); if (b) play(Number(b.dataset.i)); });
function showLinesView() {
  $('#lines-list').hidden = linesView === 'tree';
  $('#lines-tree').hidden = linesView !== 'tree';
  document.querySelectorAll('.lines-view [data-view]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === linesView));
  if (linesView === 'tree' && cur) renderTree();
}
document.querySelector('.lines-view').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  linesView = b.dataset.view;
  store(STORE + '-lines-view', linesView);
  showLinesView();
});
showLinesView();

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
    // The trap's slip: the board stops for a moment with the move in red, so it cannot be missed.
    const t = lines[lineIdx]?.trap;
    if (mode !== 'time' && t?.ply === ply - 1) return showTrap(t, m);
    render();
    if (ply >= line.length) return finish();
    if (playPremove()) return;
    // In Practice the "Right" note stays up with the prompt, since the reply comes before you can read it;
    // in a trial the last right/wrong note stays up.
    if (mode === 'try' && ply >= 2) { prompt(`Right: ${line[ply - 2]}. Your move.`, 'good'); askIdea(); }
    else if (mode !== 'time') prompt('Your move.');
  }, mode === 'time' ? 150 : 450);
}

// The line's slip has just been played (m): the board waits with the strip until you move or press on.
function showTrap(t, m) {
      busy = true;
      const gen = gameGen;
      const before = resultsAt(line.slice(0, t.ply)), was = before ? before.win + before.draw / 2 : null;
      const go = () => {
        if (gen !== gameGen) return;
        busy = false;
        render();
        if (ply >= line.length) return finish();
        if (!playPremove()) prompt('Your move: punish it.');
      };
      // In Learn the button plays the punishing move (the line's next move, else Stockfish's best).
      const punish = () => {
        go();
        if (gen !== gameGen || !userTurn()) return;
        const san = line[t.ply + 1], mv = san && new Chess(game.fen()).move(san);
        if (mv) return tryMove(mv.from, mv.to);
        goodMove().then((x) => { if (x && gen === gameGen && userTurn()) tryMove(x.from, x.to); });
      };
      moment('trap', `${trapWord(t)}!`, `${sideName(m.color)} played <b>${trapMove(t)}</b>, the move this line is about. ${t.kind === 'trap' && t.win ? `It loses ${t.win}.` : t.kind === 'mistake' ? (mistakeWhy(t) ? `${mistakeWhy(t).why} ${mistakeWhy(t).how}` : 'No blunder, but it costs time and hands you the easier game.') : 'It looks natural, but it lets you win.'} Players at your level score ${pct(1 - t.score)} after it. ${mode === 'learn' ? punishText(t) || 'The green arrow shows how to punish it.' : 'This is the moment: find the move that punishes it.'}`,
        [mode === 'learn' ? { label: 'Punish it', run: punish } : { label: 'Find the answer', run: go }], was === null ? null : [was, 1 - t.score], [[m.from, m.to, RED], ...punishArrow(t)], go);
      // Where the line stops at the slip, Stockfish's best move is the punishment to show.
      if (mode === 'learn' && momentArrows.length === 1) {
        const at = game.fen();
        goodMove().then((x) => { if (x && momentOpen && game.fen() === at) { momentArrows = [...momentArrows, [x.from, x.to, GREEN]]; renderBoard(); } });
      }
      render();
}
// Back from your answer to the slip: the position right after it, with its strip, as it was, so
// you can answer again (also from the guided moves after a line that stops at the slip).
function backToTrap() {
  const t = lines[lineIdx]?.trap, n = game.history().length;
  if (!t || mode === 'time' || n <= t.ply + 1 || n > t.ply + 3 || endLen) return false;
  gameGen++;
  while (game.history().length > t.ply + 1) game.undo();
  ply = t.ply + 1; notes.length = betters.length = ply; view = null;
  playing = false; punish = 0; punishDone = false; premove = null; sel = null; hintSq = [];
  lastMove = game.history({ verbose: true }).at(-1);
  showTrap(t, lastMove);
  return true;
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
    const best = EVALS.get(evalKey(m.before))?.move;
    if (punish > 0 && best?.from === m.from && best?.to === m.to) punished(m);
    if (punish > 0) punish--;
    // Playing on from the line's end is practice: the mode says so (without starting the line again).
    if (mode === 'learn' && endLen && ply === endLen) setMode('try', false, false);
    lastMove = m; ply++; sel = null; hintSq = [];
    rate(ply - 1, game.history({ verbose: true }).at(-1).before, m);
    render();
    if (!ended()) opponentPlays();
    return true;
  }
  if (mode === 'time' && clean(m.san) !== line[ply]) {
    game.undo();
    trial.end -= TRIAL_WRONG * 1000; misses++; // a slip costs the line its diamond
    wrongSq = to; sel = null; shake(boardEl);
    setTimeout(() => { wrongSq = null; renderBoard(); }, 500);
    lastMove = game.move(line[ply]); ply++;
    say(`Not ${m.san}: it was ${lastMove.san}. −${TRIAL_WRONG} s`, 'bad');
    render();
    if (ply >= line.length) finish(); else reply();
    return true;
  }
  if (mode === 'time') { trial.end += TRIAL_RIGHT * 1000; trial.score++; }
  const moved = clean(m.san) !== line[ply] && transpose(); // another move order to a line's position counts as that line's move
  if (clean(m.san) !== line[ply] && !moved) {
    game.undo();
    misses++; missesHere++;
    wrongSq = to; sel = null;
    renderBoard();
    shake(boardEl);
    if (mode === 'try') { // a slip in Practice: see the right move, then the line again from the start, when you are ready
      const want = expectedMove();
      wrongSq = null;
      hardMiss();
      if (drill) { // drilling a hard move: see it, then the next one (or this one again later)
        say(`${m.san} is not the move here. The line plays ${moveWords(want)}.`, 'bad');
        moment('wrong', 'Not this one', `You played <b>${m.san}</b> (red). The move is <b>${want.san}</b> (green). It comes back at the end of this drill.`,
          [{ label: 'OK, next', run: () => { drill.queue.push(drill.now); nextDrill(); } }], null, [[m.from, m.to, RED], [want.from, want.to, GREEN]]);
        return true;
      }
      say(`${m.san} is not the move here. The line plays ${moveWords(want)}.`, 'bad');
      moment('wrong', 'Not this one', `You played <b>${m.san}</b> (red). The line plays <b>${want.san}</b> (green)${ideaAt(new Chess(game.fen()), want.san) ? `: ${ideaAt(new Chess(game.fen()), want.san).replace(/^./, (c) => c.toLowerCase())}` : '.'} Take a look, then play the line again from the start.`,
        [{ label: trapRun ? 'OK, try again' : 'OK, start again', run: () => (trapRun ? setupTrap(trapRun.now) : play(lineIdx, true)) }], null, [[m.from, m.to, RED], [want.from, want.to, GREEN]]);
      return true;
    }
    if (missesHere >= 2) showHint();
    explainWrong(m.san);
    setTimeout(() => { wrongSq = null; renderBoard(); }, 700);
    return true;
  }
  if (mode === 'try') hardHit();
  if (drill && ply === drill.ply) { // the hard move, found: on to the next one
    lastMove = m; ply++; sel = null; hintSq = []; notes[ply - 1] = 'book';
    render();
    say(`Right: ${m.san}.`, 'good');
    setTimeout(() => { if (drill) nextDrill(); }, 900);
    return true;
  }
  lastMove = m; ply++; sel = null; hintSq = []; missesHere = 0;
  say(mode === 'time' ? `Right: ${m.san}. +${TRIAL_RIGHT} s` : moved === 'swap' ? `${m.san} first is fine: same moves, another order. The line goes on.` : moved ? `${m.san} reaches the same position by another move order. Fine: the line goes on from here.` : `Right: ${moveWords(m)}.`, 'good');
  notes[ply - 1] = 'book';
  render();
  punished(m);
  if (ply >= line.length) finish(); else reply();
  return true;
}


// A transposition: after a move that is not the line's, the position is the one a line has at this
// point (this line's or another's). Then that line is the one you are in. Not in a time trial, where
// the move order is the drill.
const posAt = (moves) => { const g = new Chess(); moves.forEach((x) => g.move(x)); return evalKey(g.fen()); };
function transpose() {
  if (mode === 'time') return false;
  const n = game.history().length, at = evalKey(game.fen()), san = clean(game.history().at(-1));
  // Your next two moves the other way round: fine when, after their reply, the line's move you skipped
  // reaches the line's position. The line is then played in your order.
  if (line[ply + 2] === san) {
    const g = new Chess(game.fen());
    try { g.move(line[ply + 1]); g.move(line[ply]); } catch { /* not this time */ }
    if (g.history().length === 2 && evalKey(g.fen()) === posAt(line.slice(0, ply + 3))) {
      line = [...line];
      [line[ply], line[ply + 2]] = [line[ply + 2], line[ply]];
      return 'swap';
    }
  }
  const j = lines.findIndex((l) => l.moves.length >= n && posAt(l.moves.slice(0, n)) === at);
  if (j < 0) return false;
  lineIdx = j; line = lines[j].moves;
  renderLines(); renderLineBox();
  return true;
}
console.assert(posAt(['Nf3', 'd5', 'd4', 'Nf6']) === posAt(['d4', 'd5', 'Nf3', 'Nf6']), 'posAt: a transposition is the same position');

function expectedMove() {
  return new Chess(game.fen()).move(line[ply]);
}

// In Learn mode the move to play is always shown.
function prompt(text, tone = '') {
  if (mode !== 'learn' || !userTurn() || ply >= line.length) return say(text, tone);
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
// A trap line whose games stop soon after the slip goes on with help: two of your moves after the trap,
// with the best move as an arrow in Learn (Hint in Practice) and the opponent from real games, then
// Stockfish; only then is the line done. punish: your moves still to make; endLen: where the line ended.
let punish = 0, punishDone = false, endLen = 0;
const MATE_RUN = 10; // a mate this close at the line's end is part of the line
function punishMoves() {
  const t = lines[lineIdx]?.trap;
  return t ? Math.max(0, 2 - Math.floor((line.length - 1 - t.ply) / 2)) : 0;
}
// Learn shows the best move as an arrow whenever it is your turn off the line (punishing a slip, or
// playing on after the line).
function guide() {
  if (mode !== 'learn' || !userTurn()) return;
  const at = game.fen();
  goodMove().then((m) => { if (m && game.fen() === at && userTurn() && !momentOpen) { hintSq = [m.from, m.to]; renderBoard(); } });
}
function finish() {
  if (mode === 'time') {
    trial.done++;
    // A line played without a slip against the clock earns its diamond star in the lines list.
    const st = stats[statKey(cur.id)], k = lineKey(line);
    if (!misses && st && !(st.timed ??= []).includes(k)) { st.timed.push(k); store(STORE, stats); }
    return setTimeout(() => { if (mode === 'time' && trial.end > Date.now()) play((lineIdx + 1 + Math.floor(Math.random() * (lines.length - 1))) % lines.length); }, 300); }
  // A mate in 10 or less for you at the line's end is played out too, before the line is done. That
  // needs Stockfish's verdict, so wait for it (the board waits with you).
  const key = evalKey(game.fen());
  if (!punishDone && !game.isGameOver() && game.turn() === cur.side && !EVALS.has(key)) {
    busy = true;
    const gen = gameGen;
    return evaluate(game.fen(), { keep: true }).then(() => { if (gen === gameGen) { busy = false; finish(); } });
  }
  const e = EVALS.get(key), mateIn = game.turn() === cur.side && e?.mate > 0 && e.mate <= MATE_RUN ? e.mate : 0;
  if (!punishDone && !game.isGameOver() && (mateIn || punishMoves() > 0)) {
    punish = Math.max(mateIn, punishMoves()); punishDone = true; playing = true;
    renderControls(); // Hint works while you play it out
    say(mateIn ? `There is a mate in ${mateIn}! ${mode === 'learn' ? 'Follow the arrow.' : 'Find it. Press Hint if you need help.'}`
      : mode === 'learn' ? 'Now punish it: follow the arrow.' : 'Now punish it. Press Hint if you need help.', 'good');
    if (game.turn() !== cur.side) return opponentPlays();
    return guide();
  }
  endLen = game.history().length;
  const s = stats[statKey(cur.id)];
  const k = lineKey(lines[lineIdx].moves);
  if (!s.played.includes(k)) s.played.push(k);
  store(STORE, stats);
  const wasComplete = cleared() === lines.length;
  const r = mode === 'try' && !assisted ? review(misses === 0) : null;
  renderLines();
  renderLineBox();
  $('#restart').textContent = trapRun ? 'Next trap' : mode === 'try' && (misses || assisted) ? 'Try again' : 'Next line';
  const on = 'Play on if you like: the arrow shows a good next move.';
  if (mode === 'learn') say(`Line learned. ${on} Or press Next line, or switch to Practice to play it from memory.`, 'good');
  else if (assisted) say(`Line done. You switched to Practice on the way, so it does not count as cleared: press Try again to play it from the start. ${on}`, 'good');
  else if (misses) say(`Line done with ${plural(misses, 'mistake')}, so it is not cleared. ${on} Or press Try again.`, 'bad');
  else {
    if (!wasComplete && cleared() === lines.length) showComplete();
    const back = `It comes back for review in ${plural(INTERVALS[r.box], 'day')}.`;
    say(`${cleared() === lines.length ? 'Line cleared. Every common line at your level is cleared.' : `Line cleared, ${cleared()} of ${lines.length}.`} ${back} ${on}`, 'good');
  }
  flash(mode === 'try' && misses ? 'Line done' : mode === 'try' ? 'Line cleared' : 'Line learned');
  // From here the game simply goes on: any move you make plays it out.
  playing = true;
  renderWhy(); // How to go on needs playing set
  if (game.isGameOver()) return;
  if (game.turn() !== cur.side) return opponentPlays();
  const at = game.fen();
  goodMove().then((m) => { if (m && playing && game.fen() === at) { hintSq = [m.from, m.to]; renderBoard(); } });
}

// In Explore you move whichever side is to move; otherwise only your own side, on your turn.
const canMove = () => !busy && !boardBlocked() && (mode === 'explore' ? cur && !game.isGameOver() : userTurn());
const mover = () => (mode === 'explore' ? game.turn() : cur.side);
const move = (from, to) => (mode === 'explore' ? exploreMove(from, to) : tryMove(from, to));

// Premove, as on Lichess: during the opponent's turn you may queue your next move (its squares are
// marked blue); it is played the moment it is your turn, if it is still legal. A right-click cancels it.
let premove = null;
const canPremove = () => !!cur && !boardBlocked() && mode !== 'explore' && line.length > 0 && (ply < line.length || playing)
  && game.turn() !== cur.side && !game.isGameOver();
// Where a piece may be premoved, as on Lichess: every square it could reach on an empty board, own
// pieces included, so a recapture can be queued while your piece still stands there. Whether the move
// is legal is checked when it is played.
function premoveDests(sq, g = game) {
  const p = g.get(sq);
  if (!p) return [];
  const f = sq.charCodeAt(0) - 97, r = Number(sq[1]) - 1, out = [];
  const add = (df, dr) => { const nf = f + df, nr = r + dr; if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(String.fromCharCode(97 + nf) + (nr + 1)); };
  const ray = (df, dr) => { for (let i = 1; i < 8; i++) add(df * i, dr * i); };
  const diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]], line = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (p.type === 'n') [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]].forEach(([a, b]) => add(a, b));
  if ('bq'.includes(p.type)) diag.forEach(([a, b]) => ray(a, b));
  if ('rq'.includes(p.type)) line.forEach(([a, b]) => ray(a, b));
  if (p.type === 'k') {
    [...diag, ...line].forEach(([a, b]) => add(a, b));
    if (sq === (p.color === 'w' ? 'e1' : 'e8')) { add(2, 0); add(-2, 0); }
  }
  if (p.type === 'p') {
    const up = p.color === 'w' ? 1 : -1;
    add(0, up); add(1, up); add(-1, up);
    if (r === (p.color === 'w' ? 1 : 6)) add(0, 2 * up);
  }
  return out.map((to) => ({ to, captured: g.get(to) && g.get(to).color !== p.color }));
}
console.assert(premoveDests('e4', new Chess('4k3/8/8/8/4P3/3P4/8/4K3 w - - 0 1')).map((m) => m.to).sort().join() === 'd5,e5,f5', 'premove pawn');
console.assert(premoveDests('d3', new Chess('4k3/8/8/8/4P3/3N4/8/4K3 w - - 0 1')).some((m) => m.to === 'e1'), 'premove onto own piece');
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
  canDrag: (sq) => (settleMoment(), !boardBlocked()) && leaveView(sq) && (canMove() || canPremove()) && game.get(sq)?.color === mover(),
  onDrop: (from, to) => {
    sel = null;
    if (canPremove()) { if (!setPremove(from, to)) renderBoard(); return; }
    if (!move(from, to)) renderBoard();
  },
});
boardEl.addEventListener('click', (e) => {
  const b = e.target.closest('.sq');
  if (!b) return;
  settleMoment();
  if (boardBlocked()) return;
  if (!leaveView(b.dataset.sq)) return;
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

// While you play on after a line, the move list, ← and → only look back at moves, as on Lichess:
// view is how many moves the board shows (null: the game as it is now). Playing a move from an earlier
// position of yours takes the moves after it back.
let view = null;
// How many moves the board shows while looking back at move v: your slip is shown before it is played.
const shownAt = (v) => (betters[v - 1] && game.history({ verbose: true })[v - 1].color === cur.side ? v - 1 : v);
function showMove(n) {
  closeMoment(); // looking through the moves leaves the moment behind; the board is yours again
  view = n >= game.history().length ? null : Math.max(0, n);
  sel = null;
  render();
  const i = view === null ? -1 : view - 1;
  if (i >= 0 && notes[i] === 'blunder' && game.history({ verbose: true })[i].color !== cur.side) chanceAgain(i);
}
// Back on their blunder: the same Chance card, to try again from there (your answer gets its verdict).
// Stockfish's best answer to the blunder at move i, or null while it is not evaluated yet.
function bestAfter(i) {
  const g = new Chess();
  game.history().slice(0, i + 1).forEach((x) => g.move(x));
  const r = EVALS.get(evalKey(g.fen()));
  return r?.move ? new Chess(g.fen()).move(r.move) : null;
}
function chanceAgain(i) {
  const m = game.history({ verbose: true })[i], best = bestAfter(i);
  const retry = () => { takeBackTo(i + 1); chance = best ? { ply: i + 1, best } : null; say('Find the strong move.', 'good'); };
  moment('chance', 'Chance!', `${sideName(m.color)}'s <b>${moveLabel(i, m.san)}</b> (red arrow) was a blunder.${betters[i] ? ` ${sideName(m.color)} should have played ${betters[i].san}.` : ''} Try it again: look at checks, captures and threats.`,
    [{ label: 'Try it', run: retry }, ...(best ? [{ label: 'Show me', run: () => { retry(); chance = null; hintSq = [best.from, best.to]; renderBoard(); say(`${moveWords(best)}.`, 'good'); } }] : [])],
    null, [[m.from, m.to, RED]], null);
}
// Picking up a piece while looking back: back to the game, or, when it is one of your pieces at your
// own earlier move, the moves after it are taken back and you play on from there.
function leaveView(sq) {
  if (view === null) return true;
  const n = shownAt(view), g = new Chess(); // your slip is shown before it is played (see renderBoard)
  game.history().slice(0, n).forEach((m) => g.move(m));
  if (g.get(sq)?.color !== g.turn()) { showMove(Infinity); return false; }
  if (n < line.length || g.turn() !== cur.side) { exploreFrom(n, 'Explore from here: move any piece, for either side. '); return true; }
  takeBackTo(n);
  // Moving straight away on their blunder is trying the chance again, as Try it does.
  const best = notes[n - 1] === 'blunder' && bestAfter(n - 1);
  if (best) { closeMoment(); chance = { ply: n, best }; say('Find the strong move.', 'good'); }
  return true;
}
// Back to the position after n moves, for you to play on from (the moves after it are gone).
function takeBackTo(n) {
  gameGen++; // a reply still on its way no longer applies
  while (game.history().length > n) game.undo();
  ply = n; notes.length = betters.length = n; view = null;
  lastMove = game.history({ verbose: true }).at(-1) || null;
  premove = null; busy = false; sel = null; hintSq = [];
  if (punishDone && !endLen) { // still punishing the trap: count again the moves you have made after it
    const mine = game.history({ verbose: true }).slice(line.length).filter((x) => x.color === cur.side).length;
    punish = Math.max(0, punishMoves() - mine);
  }
  render();
  say('Moves taken back. Your move.');
  if (game.turn() !== cur.side) opponentPlays();
  else if (punish > 0) guide();
}
const reviewing = () => mode !== 'explore' && playing;

// Clicking a move in the list: while you play on, the board shows that move (see view); otherwise
// Explore from there (as stepping back does), with Forward replaying the moves.
function goTo(n) {
  if (!cur || (mode === 'explore' && busy)) return;
  if (reviewing()) return showMove(n);
  if (n >= game.history().length) return;
  exploreFrom(n, 'Back to that move. Move any piece, for either side. ');
}
// Explore from move n, with Forward replaying the moves after it.
function exploreFrom(n, text) {
  gameGen++; // a reply still on its way no longer applies
  premove = null; busy = false; sel = null; hintSq = []; view = null;
  if (mode !== 'explore') setMode('explore', false, false);
  while (game.history().length > n) redo.push(game.undo());
  ply = n;
  lastMove = game.history({ verbose: true }).at(-1) || null;
  render();
  exploreSay(text);
}
movesEl.addEventListener('click', (e) => { const b = e.target.closest('.mv[data-n]'); if (b) goTo(Number(b.dataset.n)); });

function stepBack() {
  if (!cur || !lines.length || !game.history().length) return;
  if (backToTrap()) return;
  if (reviewing()) return showMove((view ?? game.history().length) - 1);
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
  if (view !== null) return showMove(view + 1);
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
  // Starting over in the middle of a line throws the moves away, so it asks first.
  if ($('#restart').textContent === 'Restart' && ply > 0 && ply < line.length && !confirm('Start this line again from the first move?')) return;
  if (trapRun) return nextTrap();
  if (!lines.length) return start(cur);
  if (mode === 'time') return startTrial();
  if (mode === 'learn') return play(ply >= line.length ? nextLine() : lineIdx);
  play(ply >= line.length && misses === 0 ? nextLine() : lineIdx);
});
// Hint in three steps, one per press: the piece, then what kind of move it is, then the move itself
// (step three is Show move, which in Practice counts as a mistake).
let hintStep = 0, hintFen = '';
$('#hint').addEventListener('click', async () => {
  if (!userTurn() || busy) return;
  const at = game.fen();
  if (hintFen !== at) { hintFen = at; hintStep = 0; }
  const m = playing ? await goodMove() : expectedMove();
  if (!m || game.fen() !== at) return;
  hintStep++;
  if (hintStep >= 3) return $('#show').click();
  hintSq = [m.from]; renderBoard();
  if (hintStep === 1) return say('Hint 1 of 3: the piece to move is highlighted. Press Hint again for more.');
  const kind = hintFor(m);
  const where = m.piece === 'p' ? `the pawn moves ${Math.abs(m.to[1] - m.from[1]) === 2 ? 'two squares' : 'one square'} forward.` : `the ${PIECE[m.piece]} goes to the ${m.to[0]}-file.`;
  say(`Hint 2 of 3: ${kind.startsWith('Look for the move that improves') ? where : kind}`);
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
  cur = null; gameGen++; stopTrial(); trapRun = null; // stops an opponent reply (or a time trial) still on its way
  $('#trainer').hidden = true;
  $('#picker').hidden = false;
  listEl.innerHTML = $('#side-tabs').innerHTML = '';
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
  lockRating();
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
PHONE.addEventListener('change', (e) => { if (!e.matches) $('#filters').open = true; }); // on a computer the filters never fold
$('#m-back').addEventListener('click', showPicker);
// Typing a move: the keyboard's way to play, as if the piece and then its square were clicked.
$('#move-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#move-in').value.trim();
  let m = null;
  try { m = new Chess(game.fen()).move(v); } catch {}
  if (!m) return ($('#move-msg').textContent = v ? `${v} is not a legal move here.` : '');
  $('#move-msg').textContent = ''; $('#move-in').value = '';
  sel = null;
  for (const sq of [m.from, m.to]) boardEl.querySelector(`[data-sq="${sq}"]`)?.click();
  $('#move-in').focus();
});
$('#m-mode').addEventListener('change', (e) => $(`#mode-${e.target.value}`).click());
function setMode(m, restart = true, remember = true) {
  const was = mode;
  mode = m; view = null;
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
  else if (m === 'time' || was === 'time') m === 'time' ? startTrial() : play(lineIdx);
  else carryOn(was);
}
// Learn and Practice go on from where you are: in the line, or in the game after it. From Explore,
// that works while the moves so far are still one of the lines (any of them); otherwise the line
// starts again. Switching to Practice part way through a line means it cannot count as cleared.
function carryOn(was) {
  const hist = game.history().map(clean), n = hist.length;
  if (was === 'explore') {
    const on = (l) => n < l.moves.length && lineKey(l.moves.slice(0, n)) === lineKey(hist);
    const j = on(lines[lineIdx]) ? lineIdx : lines.findIndex(on);
    if (j < 0) return play(lineIdx);
    gameGen++; // an Explore answer still on its way no longer applies
    lineIdx = j; line = lines[j].moves; ply = n; playing = false; redo = []; busy = false;
    renderLines(); renderLineBox();
  }
  if (mode === 'try' && n > 0 && !playing) assisted = true;
  sel = null; hintSq = [];
  render();
  if (playing && !busy) return guide(); // playing on after the line: Learn shows the best move at once
  if (playing || busy) return;
  if (userTurn()) prompt('Your move.');
  else reply();
}
let assisted = false; // this run of the line was not all from memory (see carryOn)
$('#mode-learn').addEventListener('click', () => setMode('learn'));
$('#mode-try').addEventListener('click', () => setMode('try'));
$('#mode-explore').addEventListener('click', () => setMode('explore'));
$('#mode-time').addEventListener('click', () => setMode('time'));
// ---------- Progress to a file and back ----------
// Everything the site keeps in this browser except the engine cache (it rebuilds itself), as JSON.
const KEEP_KEY = (k) => (k.startsWith(STORE) && k !== STORE + '-sf' && k !== STORE + '-games') || k.endsWith('-solved-v1') || k === 'chess-theme';
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
showPicker().then(deepLink);

// Links from My practice: ?practise=<w|b>~<opening> opens that opening's lines (or the list searched
// for it), ?do=traps runs the traps of your openings, ?do=mistakes checks your games for mistakes.
async function deepLink() {
  const q = new URLSearchParams(location.search), want = q.get('practise'), act = q.get('do');
  if ((!want && !act) || !rating || !OPENINGS.length) return;
  history.replaceState(null, '', location.pathname);
  if (want) {
    const [side, family] = [want.slice(0, 1), want.slice(2)];
    const vs = BLACKS.test(family) !== (side === 'b');
    const op = OPENINGS.find((x) => x.family === family && x.side === side && isVs(x) === vs)
      ?? OPENINGS.find((x) => x.side === side && (family.startsWith(x.family) || x.family.startsWith(family)));
    if (op) return start(op);
    $('#search').value = query = family;
    return renderList();
  }
  if (act === 'traps') return startTraps();
  if (act === 'mistakes') {
    const name = load(STORE + '-lichess-name', '') || account()?.name;
    if (!name) return;
    await checkMyGames(name);
    $('#my-openings').scrollIntoView({ behavior: 'smooth' });
    if (lastGames) runMistakes();
  }
  if (act === 'learnfrom') {
    const name = load(STORE + '-lichess-name', '') || account()?.name;
    if (!name) return;
    await checkMyGames(name);
    $('#learn-from').scrollIntoView({ behavior: 'smooth' });
    findTeachers(name).catch((err) => { $('#learn-from').innerHTML = `<p class="info">${err.message}</p>`; });
  }
}

// ---------- Lichess login ----------
// Logged in, the rating is always your own from Lichess; only without a login can it be typed in.
function lockRating() {
  const a = account(), el = $('#rating');
  el.readOnly = !!a;
  el.title = a ? `Your Lichess ${speed} rating, filled in from ${a.name}'s account` : 'Your Lichess rating: change it to see the openings of another level';
}
function renderLogin() {
  lockRating();
  const a = account(), b = $('#lichess-login');
  b.textContent = a ? a.name : 'Log in';
  b.hidden = !a; // logged out, the section bar's Log in is the one way in
  b.title = a ? `Logged in to Lichess as ${a.name}: your profile (log out there)`
    : 'Log in with Lichess: play-outs then follow real games from all of Lichess, and your rating and games are filled in.';
  b.setAttribute('aria-pressed', String(!!a));
}
$('#lichess-login').addEventListener('click', () => {
  const a = account();
  if (!a) return login();
  location.href = `profile.html?u=${encodeURIComponent(a.name)}`;
});
renderLogin();
// Logged in: your Lichess ratings fill in on every visit and stay current, so the openings match your level.
async function ratingsFromLichess() {
  const a = account();
  if (!a) return;
  try {
    const res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(a.name)}`);
    if (!res.ok) return;
    const perfs = (await res.json()).perfs || {};
    for (const sp of ['blitz', 'classical']) if (perfs[sp]?.rating) store(`${STORE}-${sp}-rating`, perfs[sp].rating);
    const r = load(ratingKey(), null);
    if (r && r !== rating && $('#trainer').hidden) { rating = r; showPicker(); } // never under a line you are playing
  } catch {}
}
finishLogin().then((user) => { if (user) { renderLogin(); return useLichess(user.username); } return ratingsFromLichess(); }).catch((err) => alert(err.message));
