// Your profile: your last 500 rated Lichess games read move by move, then what kind of player they
// show, what you are good at, what to work on, and the numbers behind it. Lichess's own computer
// analysis is used where a game has it (accuracy, blunders, who was winning when). The result is kept
// in this browser, and so are the games themselves: later visits fetch only the games played since.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { account, login, finishLogin, lichessAuth } from './lichess.js?v=20261110093255';
import { openLogin } from './login.js?v=20261110093255';
import { STYLE_OF } from './styles.js?v=20261110093255';
import { isCC, nick, siteOf, ccUrl, fetchCC, ccUser, asLichess, fromCC } from './chesscom.js?v=20261110093255';
import { PEOPLE } from './pros.js?v=20261110093255';

const MAX = 500;
const EARLY = 60, REDRAW = 150; // a first look-up draws the profile after EARLY games, then again every REDRAW, while the rest still come in
const PV = 41;
const ENOUGH = 60; // analysed games against opponents near your rating before the skills that need analysis are shown: about what 100 analysed games hold
// How far the stats can be trusted, by analysed games: the analyse box shows the step reached and the next.
const TIERS = [[100, 'Fair'], [250, 'Good'], [500, 'Best']];
const MIN_GAMES = 50;
const EARLY_MIN = 30; // games with a verdict after move 12 before Early game is shown // rated games before a player gets any skills at all
const KPI_MIN = 20; // analysed games before the plain accuracy and blunder averages are shown
const WHY_ANALYSE = 'Lichess only analyses games you ask it to. Analysed games give your blunders, accuracy and four of the skills, and become puzzles in My practice. Stockfish runs in your browser; no game is done twice.'; // analysed games needed before the numbers that come from analysis are shown // bumped when the profile gains something new: older saved profiles are read again
const KEY = 'opening-book-v2-profiles';  // { [lower-case name]: { name, at, p } }, the 10 last looked up
const $ = (s) => document.querySelector(s);
const pct = (x) => `${Math.round(x * 100)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const score = (gs) => (gs.length ? sum(gs, (g) => g.result) / gs.length : null);


// What players at a rating usually score in an opening family (data/opening-scores.json, built by
// tools/make_opening_scores.py from the Lichess games behind the Openings page). Loaded before games are read.
let SCORES = null;
const loadScores = async () => (SCORES ??= await fetch('data/opening-scores.json?v=2026-10-29').then((r) => r.json()).catch(() => ({})));
function expectOf(family, side, rating, speed) {
  const row = SCORES?.[speed === 'classical' ? 'classical' : 'blitz']?.[family], b = SCORES?.buckets;
  if (!row || !b) return null;
  const i = b.findLastIndex((x) => x <= rating);
  const j = [i, i - 1, i + 1].find((k) => row[0][k] >= 200 && row[1][k] != null);
  return j === undefined ? null : side === 'w' ? row[1][j] : 1 - row[1][j];
}

// ---------- One game, from your side ----------
const cpOf = (a) => (!a ? null : a.mate !== undefined ? Math.sign(a.mate) * 1000 : Math.max(-1000, Math.min(1000, a.eval)));
// Whose choice an opening is, by its name (before any ", with …"): a Defense or Countergambit is Black's,
// and so is accepting or declining White's gambit or opening (King's Gambit Accepted, Center Game Accepted);
// Black's own gambits (1.d4 e5 is the Englund) are Black's, and accepting or declining them White's, as is
// accepting a countergambit; and a few Black openings without such a word (Slav Indian, Marienbad System).
const BLACK_GAMBIT = /^(Englund|Elephant|Latvian|Benko|Duras) Gambit/;
const BLACK_NAMED = /^(Queen's Indian Accelerated|Slav Indian|Marienbad System|Lasker Simul Special)$/;
const blacksName = (fam) => { const f = String(fam).split(',')[0];
  return BLACK_GAMBIT.test(f) ? !/(Accepted|Declined)$/.test(f) : /Countergambit (Accepted|Declined)$/.test(f) ? false : BLACK_NAMED.test(f) || /(Defen[cs]e|Countergambit|Accepted|Declined)$/.test(f); };
console.assert(blacksName('Englund Gambit') && !blacksName('Englund Gambit Declined') && !blacksName('Latvian Gambit Accepted') && blacksName('Sicilian Defense')
  && blacksName("Queen's Gambit Declined") && !blacksName("King's Gambit") && !blacksName('Italian Game') && blacksName('Center Game Accepted') && blacksName('Semi-Slav Defense Accepted')
  && blacksName("Queen's Indian Defense, with e3") && !blacksName("King's Indian Attack, with e6") && !blacksName('Blumenfeld Countergambit Accepted') && blacksName('Slav Indian'), 'blacksName');
// A player's own choice when the other side's moves name the game: Black's 1...e5 (the Open Game) or 1...d5
// (the Closed Game) against White's opening; White's 1.e4 or 1.d4 against Black's defence.
const ANSWERS = ['Open Game', 'Closed Game', "King's Pawn Opening", "Queen's Pawn Opening"];
const answerOf = (moves, fam, side) => (side === 'b'
  ? (blacksName(fam) ? null : moves[0] === 'e4' && moves[1] === 'e5' ? 'Open Game' : moves[0] === 'd4' && moves[1] === 'd5' ? 'Closed Game' : null)
  : (!blacksName(fam) ? null : moves[0] === 'e4' ? "King's Pawn Opening" : moves[0] === 'd4' ? "Queen's Pawn Opening" : null));
function readGame(g, me) {
  const side = g.players.white.user?.id === me ? 'w' : 'b';
  const mine = g.players[side === 'w' ? 'white' : 'black'], theirs = g.players[side === 'w' ? 'black' : 'white'];
  const pov = side === 'w' ? 1 : -1, myPly = side === 'w' ? 0 : 1;
  const moves = g.moves ? g.moves.split(' ') : [];
  const c = new Chess();
  let castled = null, queensOff = null, endgameAt = null;
  const pieces = { n: 0, b: 0, r: 0, q: 0 }; // how much each piece of yours does: moves, plus captures and checks
  const played = { n: [0, 0], b: [0, 0], r: [0, 0], q: [0, 0] }; // per piece, in analysed games: [moves, mistakes (a blunder counts 2)]
  for (let i = 0; i < moves.length; i++) {
    let m;
    try { m = c.move(moves[i]); } catch { break; }
    if (m.color === side && /[kq]/.test(m.flags) && castled === null) castled = i;
    if (m.color === side && m.piece in pieces) {
      pieces[m.piece] += 1 + (m.captured ? 1 : 0) + (m.san.includes('+') ? 1 : 0);
      const j = g.analysis?.[i]?.judgment?.name;
      if (g.analysis) { played[m.piece][0]++; played[m.piece][1] += j === 'Blunder' ? 2 : j === 'Mistake' ? 1 : 0; }
    }
    const onBoard = c.board().flat().filter(Boolean);
    if (queensOff === null && !onBoard.some((p) => p.type === 'q')) queensOff = i;
    if (endgameAt === null && onBoard.filter((p) => p.type !== 'p' && p.type !== 'k').length <= 6) endgameAt = i;
  }
  const phase = (i) => (i < 20 ? 'opening' : endgameAt !== null && i >= endgameAt ? 'endgame' : 'middlegame');
  // Lichess's analysis: the evaluation after every move, from White; here from your side.
  const v = (g.analysis || []).map((a) => (cpOf(a) ?? 0) * pov);
  const slips = { opening: 0, middlegame: 0, endgame: 0 };
  (g.analysis || []).forEach((a, i) => { if (i % 2 === myPly && a.judgment?.name === 'Blunder') slips[phase(i)]++; });
  // Your clock after your last move, against the time you started with.
  const end = g.end || endClocks(g.clocks);
  const left = end && end[myPly] != null ? end[myPly] / 100 : null;
  return {
    side, speed: g.speed, at: g.createdAt, status: g.status, plies: moves.length,
    result: !g.winner ? 0.5 : (g.winner === 'white') === (side === 'w') ? 1 : 0,
    family: (g.opening?.name || 'Unknown').split(':')[0], rating: mine.rating,
    // chosen: this player picked the opening (blacksName); answer: Black's 1...e5 or 1...d5 against White's opening.
    chosen: blacksName((g.opening?.name || '').split(':')[0]) === (side === 'b'),
    answer: answerOf(moves, (g.opening?.name || 'Unknown').split(':')[0], side),
    first: side === 'w' ? moves[0] : moves.slice(0, 2).join(' '), // the player's first move (Black: with White's before it)
    expect: expectOf((g.opening?.name || 'Unknown').split(':')[0], side, isCC(me) ? asLichess(mine.rating, g.speed) : mine.rating, g.speed), diff: mine.ratingDiff || 0, them: theirs.rating,
    castled, queensOff, endgame: endgameAt !== null, pieces, played,
    analysed: v.length > 0, ours: !!g.ours, acc: mine.analysis?.accuracy ?? null, blunders: mine.analysis?.blunder ?? null, mistakes: mine.analysis?.mistake ?? null,
    best: v.length ? Math.max(...v) : null, worst: v.length ? Math.min(...v) : null, after12: v.length > 23 ? v[23] : g.at12 != null ? g.at12 * pov : null, slips,
    lowTime: left !== null && g.clock ? left < Math.max(10, g.clock.initial * 0.1) : false,
    // The opponent's side of the same game: the players at your level that the skills compare you with.
    oppBlunders: theirs.analysis?.blunder ?? null,
    states: statesOf(g, pov, myPly),
    oppLowTime: end && end[1 - myPly] != null && g.clock ? end[1 - myPly] / 100 < Math.max(10, g.clock.initial * 0.1) : false,
    // How the opponent played this game, for "who you struggle against": the opening they chose, and
    // whether they had 15% of the start time more than you at move 15 (early, before the result shows on the clock).
    oppOpening: blacksName((g.opening?.name || '').split(':')[0]) !== (side === 'b') ? (g.opening?.name || 'Unknown').split(':')[0] : null,
    oppFaster: !!(at15Of(g) && g.clock && (at15Of(g)[1 - myPly] - at15Of(g)[myPly]) / 100 >= g.clock.initial * 0.15),
  };
}

// Mistakes by state: for you and for your opponent, how many moves each made while clearly ahead
// (1.5 pawns or more) and while clearly behind, and how many of those were mistakes (a blunder counts
// two). From the analysis, so analysed games only.
function statesOf(g, pov, myPly) {
  const t = { me: { up: [0, 0], down: [0, 0] }, opp: { up: [0, 0], down: [0, 0] } };
  if (!g.analysis) return t;
  let before = 20 * pov; // the start, from your side
  g.analysis.forEach((a, i) => {
    const who = i % 2 === myPly ? 'me' : 'opp', mover = who === 'me' ? before : -before;
    const state = mover >= 150 ? 'up' : mover <= -150 ? 'down' : null;
    if (state) { const j = a.judgment?.name; t[who][state][0]++; t[who][state][1] += j === 'Blunder' ? 2 : j === 'Mistake' ? 1 : 0; }
    before = (cpOf(a) ?? 0) * pov;
  });
  return t;
}
console.assert(statesOf({ analysis: [{ eval: 300 }, { eval: -100, judgment: { name: 'Blunder' } }] }, 1, 0).opp.down.join() === '1,2', 'statesOf');

// ---------- All games: the profile ----------
// Opening taste: the openings you choose yourself (a Defense is Black's choice, the rest White's),
// each counted once under its main style; any Gambit counts as a gambit.
const KINDS = [['gambit', 'Gambits', 'gambits'], ['attacking', 'Attacking', 'attacking openings'], ['tricky', 'Tricky', 'offbeat, tricky openings'],
  ['positional', 'Positional', 'positional openings'], ['solid', 'Solid', 'solid set-ups'], ['other', 'Other', 'other openings']];
// The Queen's Gambit and its answers are gambits by name only: no pawn is really given up.
const isGambit = (fam) => /Gambit/.test(fam) && !/^Queen's Gambit/.test(fam);
// 1.d4 with no named system is a quiet set-up, and for many players it is what they mostly play as White.
const kindOf = (fam) => (isGambit(fam) ? 'gambit' : fam === "Queen's Pawn Game" ? 'solid' : (STYLE_OF[fam] || ['other'])[0]);
function styleMix(games, side) {
  const gs = games.filter((g) => g.side === side && blacksName(g.family) === (side === 'b'));
  return { n: gs.length, parts: KINDS.map(([k, label, words]) => ({ k, label, words, share: gs.length ? gs.filter((g) => kindOf(g.family) === k).length / gs.length : 0 })).filter((x) => x.share > 0).sort((a, b) => b.share - a.share) };
}
console.assert(styleMix([{ side: 'w', family: 'Danish Gambit' }, { side: 'w', family: 'London System' }, { side: 'b', family: 'Italian Game' }], 'w').parts[0].share === 0.5, 'styleMix');
const styleOf = (fam) => [...(STYLE_OF[fam] || []), ...(isGambit(fam) ? ['attacking'] : [])];
console.assert(!styleOf("Queen's Gambit Declined").includes('attacking') && kindOf("Queen's Gambit Accepted") === 'positional' && styleOf("King's Gambit").includes('attacking'), 'styleOf: real gambits only');
export function profileOf(games) {
  const n = games.length, an = games.filter((g) => g.analysed);
  const wins = games.filter((g) => g.result === 1), losses = games.filter((g) => g.result === 0);
  const share = (gs, f) => (gs.length ? gs.filter(f).length / gs.length : 0);
  const byOpening = (side) => {
    const m = new Map();
    // Each game under its opening, and a Black game where White's moves name it also under Black's own
    // answer (1...e5, 1...d5), so a player who always meets 1.e4 with e5 is seen to.
    for (const g of games.filter((x) => x.side === side)) for (const k of [g.family, g.answer].filter(Boolean)) m.set(k, [...(m.get(k) || []), g]);
    // "vs" marks the other side's choice.
    const vs = (fam) => (ANSWERS.includes(fam) ? fam : blacksName(fam) === (side === 'w') ? `vs ${fam}` : fam);
    const firstOf = (gs) => Object.entries(gs.reduce((c, g) => ({ ...c, [g.first]: (c[g.first] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0]?.[0];
    return [...m].filter(([, gs]) => gs.length >= 5).map(([fam, gs]) => ({ fam: vs(fam), n: gs.length, score: score(gs), win: gs.filter((g) => g.result === 1).length / gs.length, first: firstOf(gs) })).sort((a, b) => b.n - a.n);
  };
  const ups = an.filter((g) => g.best >= 300), downs = an.filter((g) => g.worst <= -300);
  const slips = { opening: 0, middlegame: 0, endgame: 0 };
  for (const g of an) for (const k in slips) slips[k] += g.slips[k];
  const p = {
    n, score: score(games), white: score(games.filter((g) => g.side === 'w')), black: score(games.filter((g) => g.side === 'b')),
    // How often the player wins: wins out of all games (score counts a draw as half a win, these do not).
    winRate: share(games, (g) => g.result === 1), winW: share(games.filter((g) => g.side === 'w'), (g) => g.result === 1), winB: share(games.filter((g) => g.side === 'b'), (g) => g.result === 1),
    nWhite: games.filter((g) => g.side === 'w').length,
    speeds: Object.entries(games.reduce((m, g) => ({ ...m, [g.speed]: [...(m[g.speed] || []), g] }), {}))
      .map(([speed, gs]) => ({ speed, n: gs.length, score: score(gs), win: gs.filter((g) => g.result === 1).length / gs.length, rating: gs[0].rating + gs[0].diff, change: gs[0].rating + gs[0].diff - gs[gs.length - 1].rating })) // newest game first
      .sort((a, b) => b.n - a.n),
    draws: share(games, (g) => g.result === 0.5),
    moves: Math.round(sum(games, (g) => g.plies) / Math.max(1, n) / 2),
    quickLosses: share(losses, (g) => g.plies <= 50),
    // How narrow the openings this player chose are: the top two families' share, and how many
    // families they play at least three times.
    ...(() => {
      // King's Gambit Accepted and Declined are the King's Gambit: one opening chosen, the answer is the opponent's.
      const own = games.filter((g) => g.chosen), base = (f) => f.replace(/ (Accepted|Declined)$/, '');
      const fams = Object.values(own.reduce((m, g) => ({ ...m, [base(g.family)]: (m[base(g.family)] || 0) + 1 }), {})).sort((a, b) => b - a);
      return { top2: own.length ? ((fams[0] || 0) + (fams[1] || 0)) / own.length : 0, families: fams.filter((k) => k >= 3).length };
    })(),
    // Against stronger players (100 or more above): points per game above what the rating gap predicts.
    ...(() => {
      const up = games.filter((g) => g.them && g.them - g.rating >= 100);
      return { giantN: up.length, giantGain: up.length ? sum(up, (g) => g.result - 1 / (1 + 10 ** ((g.them - g.rating) / 400))) / up.length : null };
    })(),
    // Games where both players ended short of time: the score in those scrambles.
    ...(() => { const sc = games.filter((g) => g.lowTime && g.oppLowTime); return { clutchN: sc.length, clutchScore: score(sc) }; })(),
    // The openings the player chose: a gambit played against them says nothing of their style.
    attacking: share(games.filter((g) => g.chosen), (g) => styleOf(g.family).includes('attacking')),
    attackingBy: Object.fromEntries(['w', 'b'].map((c) => { const m = games.filter((g) => g.chosen && g.side === c); return [c, { n: m.length, v: share(m, (g) => styleOf(g.family).includes('attacking')) }]; })),
    // What players at your level choose: your opponents' own openings with the same colour as yours, in
    // the same games (your openings as White against theirs as White when you had Black), weighted by
    // how often you choose with each colour. Gambits are much more common at some levels than others.
    attackingUsual: (() => {
      const att = (g) => styleOf(g.family).includes('attacking'), parts = ['w', 'b'].map((c) => {
        const mine = games.filter((g) => g.chosen && g.side === c), theirs = games.filter((g) => !g.chosen && g.side !== c);
        return theirs.length >= 10 ? [mine.length, share(theirs, att)] : null;
      }).filter(Boolean), n = sum(parts, ([k]) => k);
      return n ? sum(parts, ([k, x]) => k * x) / n : null;
    })(),
    solid: share(games.filter((g) => g.chosen), (g) => styleOf(g.family).some((s) => s === 'solid' || s === 'positional')),
    castled: share(games, (g) => g.castled !== null && g.castled < 30), noCastle: share(games.filter((g) => g.plies > 40), (g) => g.castled === null),
    queensOff: share(games, (g) => g.queensOff !== null && g.queensOff < 50),
    endgames: games.filter((g) => g.endgame).length, endgameScore: score(games.filter((g) => g.endgame)),
    lowTime: share(games, (g) => g.lowTime), timeLosses: share(losses, (g) => g.status === 'outoftime'),
    analysed: an.length, ours: games.filter((g) => g.ours).length,
    // Moves in each game without any analysis (0 when analysed), newest first: what analysing here would cost.
    todo: games.map((g) => (g.analysed ? 0 : g.plies)),
    acc: an.length ? Math.round(sum(an.filter((g) => g.acc !== null), (g) => g.acc) / Math.max(1, an.filter((g) => g.acc !== null).length)) : null,
    blunders: an.length ? sum(an, (g) => g.blunders || 0) / an.length : null,
    slips, ups: ups.length, converted: score(ups.map((g) => ({ result: g.result === 1 ? 1 : 0 }))),
    downs: downs.length, saved: score(downs.map((g) => ({ result: g.result > 0 ? 1 : 0 }))),
    badStarts: share(an.filter((g) => g.after12 !== null), (g) => g.after12 <= -150),
    openings: { w: byOpening('w'), b: byOpening('b') },
    styleMix: { w: styleMix(games, 'w'), b: styleMix(games, 'b') },
    opponents: opponentsOf(games),
    ...pieceOf(games, an.length),
    peer: peerOf(games),
    // Rating after each game, oldest first, per time control: the graph's fallback when Lichess's
    // own rating history is not available.
    history: games.reduce((h, g) => (g.at ? { ...h, [g.speed]: [[g.at, g.rating + g.diff], ...(h[g.speed] || [])] } : h), {}),
  };
  p.type = typeOf(p);
  return p;
}

// Who you struggle against: your games split by how the opponent played, each group's points per game
// against what the rating gaps predict (Elo), so stronger opponents do not just look hard.
const OPP_KINDS = [
  ['Attackers', 'chose a gambit or an attacking opening', (g) => g.oppOpening && !/^Queen's Gambit/.test(g.oppOpening) && styleOf(g.oppOpening).includes('attacking')],
  ['Solid players', 'chose a solid or positional opening', (g) => styleOf(g.oppOpening || '').some((x) => x === 'solid' || x === 'positional')],
  ['Fast movers', 'had more time left than you at move 15', (g) => g.oppFaster],
  ['Stronger players', 'rated 100+ above you', (g) => g.them && g.them - g.rating >= 100],
  ['Weaker players', 'rated 100+ below you', (g) => g.them && g.rating - g.them >= 100],
];
function opponentsOf(games) {
  const exp = (g) => 1 / (1 + 10 ** (((g.them || g.rating) - g.rating) / 400));
  return OPP_KINDS.map(([name, about, is]) => { const gs = games.filter(is);
    return { name, about, n: gs.length, score: gs.length ? sum(gs, (g) => g.result) / gs.length : 0, gain: gs.length ? sum(gs, (g) => g.result - exp(g)) / gs.length : 0 }; })
    .filter((x) => x.n >= 10);
}
console.assert(opponentsOf(Array(10).fill({ result: 0, rating: 1500, them: 1500, oppOpening: "King's Gambit" }))[0].gain === -0.5, 'opponentsOf');

// What each type means, shown above the evidence from the games.
const TYPE_ABOUT = {
  Striker: 'Goes after the king early, wants open lines and the initiative, and takes some risk for it. Dangerous when the attack lands, shaky when it does not.',
  'Solid builder': 'Builds a safe position first and strikes when the moment is right. Hard to beat quickly, but can let wins slip by being too careful.',
  'Endgame artist': 'Happy to trade pieces and win slowly with technique. Trusts long-term edges more than tactics.',
  Fighter: 'Plays every game for a result and rarely settles for a draw. Wins and losses both come quickly.',
  Houdini: 'Keeps finding chances in bad positions and turns lost games around. Stubborn defence is a real strength.',
  'Time scrambler': 'Spends a lot of time early and plays the end on the clock. Thrives in the chaos, but some games are lost on time.',
  'Killer instinct': 'Gets attacks going and finishes them: quick wins, clear advantages, and few slips once ahead.',
  Guardian: 'Hard to break down: solid openings, holds against attacks, saves bad positions and rarely lets the opponent get ahead.',
  'Well prepared': 'Comes out of the opening better than players at the same level: knows the lines and the plans behind them.',
  Grinder: 'Scores more in endgames than players at the same level: the long games are theirs.',
  'Sure hand': 'Blunders less than players at the same level: rarely throws a piece or a game away.',
  Trickster: 'Sets traps and wins fast. Many games are over before move 25.',
  Specialist: 'Plays a narrow repertoire and knows it inside out. Rarely surprised in the opening.',
  Explorer: 'Tries many different openings. Hard to prepare against, but each line is known less deeply.',
  Marathoner: 'Plays long games and keeps going. Patient, and comfortable deep into the endgame.',
  Finisher: 'Wins the won positions: turns a clear advantage into a win more often than players at the same level.',
  'Giant killer': 'Beats stronger players more often than the rating gap predicts.',
  'White specialist': 'Much stronger with the white pieces.',
  'Black specialist': 'Much stronger with the black pieces.',
  'Clutch player': 'Wins the scrambles: when both players are short of time, comes out on top.',
  'Speed demon': 'Handles the clock better than players at the same level: rarely short of time, and wins on it.',
};
// You against players at your level: your own opponents rated within 200 of you, in the same games.
// Every number is taken for both sides, so 50 on a skill means exactly as good as them.
const PEER = 200;
function peerOf(games) {
  const gs = games.filter((g) => g.them && Math.abs(g.them - g.rating) <= PEER), an = gs.filter((g) => g.analysed);
  const mean = (xs) => (xs.length ? sum(xs, (x) => x) / xs.length : null);
  const rate = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : null);
  const ups = an.filter((g) => g.best >= 300), downs = an.filter((g) => g.worst <= -300), ends = gs.filter((g) => g.endgame);
  return {
    n: gs.length, analysed: an.length, ups: ups.length, downs: downs.length, endgames: ends.length,
    // Every game with a verdict after move 12: a full analysis, or the quick look at that one position.
    n12: gs.filter((g) => g.after12 !== null).length,
    after12: mean(gs.filter((g) => g.after12 !== null).map((g) => Math.max(-300, Math.min(300, g.after12)))),
    myBl: mean(an.filter((g) => g.blunders !== null).map((g) => g.blunders)), oppBl: mean(an.filter((g) => g.oppBlunders !== null).map((g) => g.oppBlunders)),
    // Mistakes per 10 moves while clearly ahead and while clearly behind, for you and your opponents.
    ...Object.fromEntries(['me', 'opp'].flatMap((w) => ['up', 'down'].map((st) => {
      const [moves, errs] = an.reduce((t, g) => [t[0] + (g.states?.[w][st][0] || 0), t[1] + (g.states?.[w][st][1] || 0)], [0, 0]);
      return [`${w}${st === 'up' ? 'Up' : 'Down'}`, moves >= 30 ? (errs / moves) * 10 : null];
    }))),
    endScore: score(ends),
    // Saved when clearly losing (won or drew), for you and for your opponents against you.
    saved: rate(downs, (g) => g.result > 0), oppSaved: rate(ups, (g) => g.result < 1), score: score(gs),
    // Won and lost within 25 moves: attacks and traps that land, yours and theirs.
    quickW: rate(gs, (g) => g.result === 1 && g.plies <= 50), quickL: rate(gs, (g) => g.result === 0 && g.plies <= 50),
    // Openings against what players at this level usually score in them: the attacking openings and
    // gambits the player chose, the solid or positional ones they chose, and the attacking ones played
    // against them. Gain is the points per game above the usual score.
    ...(() => {
      const kind = (g, k) => styleOf(g.family).some((x) => k.includes(x)), known = gs.filter((g) => g.expect != null);
      const group = (key, gx) => ({ [`${key}N`]: gx.length, [`${key}Score`]: score(gx), [`${key}Exp`]: mean(gx.map((g) => g.expect)), [`${key}Gain`]: mean(gx.map((g) => g.result - g.expect)) });
      return { ...group('att', known.filter((g) => g.chosen && kind(g, ['attacking']))), ...group('solid', known.filter((g) => g.chosen && kind(g, ['solid', 'positional']))),
        ...group('vsAtt', known.filter((g) => !g.chosen && kind(g, ['attacking']))) };
    })(),
    myLow: rate(gs, (g) => g.lowTime), oppLow: rate(gs, (g) => g.oppLowTime),
    timeWins: rate(gs, (g) => g.result === 1 && /outoftime|timeout/.test(g.status)), timeLosses: rate(gs, (g) => g.result === 0 && /outoftime|timeout/.test(g.status)),
  };
}

// Your most important piece: with enough analysed games, the one you play best (fewest mistakes per
// move, a blunder counting double, among pieces moved often enough); otherwise the one that does the
// most (moves, captures, checks), against how much each piece does in a normal game.
function pieceOf(games, analysed) {
  const tally = { n: [0, 0], b: [0, 0], r: [0, 0], q: [0, 0] };
  for (const g of games) for (const k in g.played || {}) { tally[k][0] += g.played[k][0]; tally[k][1] += g.played[k][1]; }
  const ok = Object.entries(tally).filter(([, [n]]) => n >= 30);
  if (analysed >= ENOUGH && ok.length) {
    const [k, [n, e]] = ok.sort((a, b) => a[1][1] / a[1][0] - b[1][1] / b[1][0])[0];
    return { piece: k, pieceWhy: 'best', pieceRate: e / n };
  }
  const act = Object.entries(games.reduce((t, g) => { for (const k in g.pieces || {}) t[k] = (t[k] || 0) + g.pieces[k]; return t; }, {}))
    .map(([k, n]) => [k, n / ({ n: 2, b: 2, r: 2, q: 1 }[k] ** 0.5)]).sort((a, b) => b[1] - a[1]);
  return { piece: act[0]?.[0] || 'n', pieceWhy: 'active' };
}
console.assert(pieceOf([{ played: { n: [40, 8], b: [40, 1], r: [10, 0], q: [40, 6] } }], ENOUGH).piece === 'b', 'pieceOf');

// What kind of player the games show, in two parts: how they play (the style that stands out most,
// each measured against what is normal at their level) and what they do best (the skill furthest
// above their own opponents). Two players who play alike can still differ in their strength, and a
// player with no clear style or strength gets only what holds.
// A player who wins most games against their level also saves more of them; odds take that out.
const odds = (x) => (x == null ? 1 : Math.min(9, Math.max(1 / 9, x / (1 - x))));
// Draws grow with the level: about 5% at 1200 and 9% at 2800 in Lichess blitz.
const usualDraws = (rating) => 0.02 + (rating || 1500) / 40000;
// Games get longer with the level: about 36 moves at 1200 and 44 at 2800.
const usualMoves = (rating) => Math.round(30 + (rating || 1500) / 200);
// A Striker with one colour only says so, or the openings shown beside it seem to disagree.
function strikerWhy(p) {
  const by = p.attackingBy, usual = p.attackingUsual != null ? pct(p.attackingUsual) : null;
  const [a, b] = !by || by.w.n < 10 || by.b.n < 10 ? [] : by.b.v >= 0.5 && by.w.v < 0.25 ? ['Black', 'White'] : by.w.v >= 0.5 && by.b.v < 0.25 ? ['White', 'Black'] : [];
  if (a) return `Mostly with ${a}: ${pct(by[a[0].toLowerCase()].v)} of the openings you choose as ${a} are attacking openings or gambits, against ${pct(by[b[0].toLowerCase()].v)} as ${b}.${usual ? ` Players at your level choose ${usual}.` : ''}`;
  return `${pct(p.attacking)} of the openings you choose are attacking openings or gambits${usual ? `, where players at your level choose ${usual}` : ''}.`;
}
console.assert(strikerWhy({ attacking: 0.6, attackingBy: { w: { n: 39, v: 0.08 }, b: { n: 157, v: 0.77 } } }).startsWith('Mostly with Black: 77%') && strikerWhy({ attacking: 0.6, attackingBy: { w: { n: 5, v: 0 }, b: { n: 157, v: 0.77 } } }).startsWith('60%'), 'strikerWhy');
const STRENGTH = { Attack: 'Killer instinct', 'Early game': 'Well prepared', 'Late game': 'Grinder', Accuracy: 'Sure hand', Speed: 'Speed demon' };
// A strength on the same theme as the style says the same thing twice; then the next best skill is named.
const SAME = { 'Endgame artist': 'Late game', 'Time scrambler': 'Speed', Trickster: 'Attack', Guardian: 'Defense', Marathoner: 'Late game' };
// Every style with its weight (1 = clearly holds), most first, and every strength with its value (62 = clearly holds).
// Where each style's weight lies for an ordinary player: the median and the top tenth among 42 players
// checked (their main time control). A style counts by how far above the median a player is, against
// that spread, so a style the player is below the usual on (29 moves where 36 is usual) never wins.
// Explorer's top is set higher than measured (0.39), and a player leaning on two openings (top2 0.3+) counts a
// quarter, so only a really wide repertoire makes one.
const PAR = { Striker: [0.74, 1.3], 'Solid builder': [0.66, 1.4], 'Endgame artist': [0.76, 0.92], 'Time scrambler': [0.63, 1.07],
  Trickster: [0.53, 1.15], Specialist: [0.72, 0.98], Explorer: [0.25, 0.6], Marathoner: [0.75, 0.87], Guardian: [0.11, 1.33] };
function traitsOf(p) {
  const q = p.peer || {}, rating = p.speeds?.[0]?.rating, raw = rawSkills(p), def = raw.find((x) => x.label === 'Defense');
  const styles = [
    // Against what players at your level choose when it is known: 22 points more is the top tenth, as the
    // spread between the median and the top tenth was among the players checked.
    { name: 'Striker', w: p.attacking / 0.4, ...(p.attackingUsual != null && { lean: (p.attacking - p.attackingUsual) / 0.22 }),
      why: strikerWhy(p) },
    { name: 'Solid builder', w: (p.solid / 0.55) * (p.attacking < 0.25 ? 1 : 0.6), why: `${pct(p.solid)} of the openings you choose are solid or positional.` },
    { name: 'Endgame artist', w: p.queensOff / 0.4, why: `The queens come off before move 25 in ${pct(p.queensOff)} of your games: you are happy to trade and play it out.` },
    // Ending short of time is common in fast games for everyone, so it counts only when the player does
    // it clearly more than their own opponents at their level.
    { name: 'Time scrambler', w: !(q.myLow > q.oppLow) ? 0 : Math.min(p.lowTime / 0.3, q.n >= 30 && q.myLow != null ? q.myLow / Math.max(q.oppLow, 0.05) / 1.4 : 0),
      why: `You end ${pct(p.lowTime)} of your games with under a tenth of your time left${q.oppLow != null ? `; your opponents at your level ${pct(q.oppLow)}` : ''}.` },
    { name: 'Trickster', w: q.n >= 30 && (q.quickW ?? 0) >= 0.1 && q.quickW > q.quickL ? (q.quickW / Math.max(q.quickL, 0.03)) / 1.6 : 0,
      why: `You win ${pct(q.quickW ?? 0)} of your games within 25 moves, your opponents at your level ${pct(q.quickL ?? 0)}: your traps and tricks land.` },
    // most club players lean on two openings (about 0.75 in 25 checked), so Specialist needs nearly all
    { name: 'Specialist', w: (p.top2 ?? 0) / 0.9, why: `Your two main openings are ${pct(p.top2 ?? 0)} of the openings you choose: you stick to what you know.` },
    { name: 'Explorer', w: (p.families ?? 0) / 18 * ((p.top2 ?? 1) < 0.3 ? 1 : 0.25), why: `You play ${p.families ?? 0} different openings at least three times each: you like variety.` },
    { name: 'Marathoner', w: p.moves > usualMoves(rating) ? (p.moves / usualMoves(rating)) / 1.2 : 0, why: `Your games last ${p.moves} moves on average, where about ${usualMoves(rating)} is usual at your level.` },
    // The counterpart of Striker: a player whose Defense (solid openings, holding against attacks, saving
    // bad positions, rarely letting opponents get ahead) is clearly above their own opponents'.
    // Only for a Defense clearly above even: at 50 or just over it would lead whenever every other style is below par.
    { name: 'Guardian', w: def.v !== null ? (def.v - 50) / 9 : 0, ...(!(def.v > 55) && { lean: -9 }), why: `You defend clearly better than your opponents at your level. ${def.why}` },
  ].map((x) => ({ ...x, lean: x.lean ?? (x.w - PAR[x.name][0]) / (PAR[x.name][1] - PAR[x.name][0]) })).sort((x, y) => y.lean - x.lean);
  // Giant killer needs a clear surplus: upsets are common in fast games. Speed counts winning on time half,
  // since much of it is the opponent's doing.
  const extra = [
    { label: 'Giant killer', v: p.giantN >= 30 ? clamp(50 + p.giantGain * 100) : null, why: `Against players 100 or more above you, you score ${pct(p.giantGain ?? 0)} more per game than the rating gap predicts (${p.giantN} games).` },
    { label: p.winW >= p.winB ? 'White specialist' : 'Black specialist', v: p.nWhite >= 30 && p.n - p.nWhite >= 30 ? clamp(50 + Math.abs(p.winW - p.winB) * 100) : null,
      why: `You win ${pct(p.winW)} as White and ${pct(p.winB)} as Black.` },
    // Decided games or many draws say how a player's games go, not how they play, so they are
    // strengths (on the same scale: 64 or more stands out) rather than styles.
    // Counted in percentage points below the usual, not as a ratio: below 2000 draws are rare for
    // everyone (about 5%), so 1% is no style there; 64 needs 6 points fewer, which only strong players' games allow.
    { label: 'Fighter', v: clamp(50 + (usualDraws(rating) - p.draws) * 233 * Math.sqrt(35 / Math.max(p.moves, 15))),
      why: `Only ${pct(p.draws)} draws, where about ${pct(usualDraws(rating))} is usual at your level: your games are decided, one way or the other.` },
    // What happens once a game is clearly decided (±3 pawns, analysed games): saving the lost ones and
    // winning the won ones. Among 42 players checked the median saves 33% (top tenth 54%) and wins 70%
    // of won positions (top tenth 84%); the median is 50 here and the top tenth 64, as for every strength.
    { label: 'Houdini', v: q.downs >= 8 && q.saved != null ? clamp(50 + (q.saved - 0.33) * 67) : null,
      why: `In ${pct(q.saved ?? 0)} of the games where you were clearly losing, you still won or drew (about a third is usual).` },
    { label: 'Finisher', v: q.ups >= 8 && q.oppSaved != null ? clamp(50 + (0.3 - q.oppSaved) * 100) : null,
      why: `You won ${pct(1 - (q.oppSaved ?? 0))} of the games where you were clearly winning (about 70% is usual).` },
    { label: 'Clutch player', v: p.clutchN >= 25 ? clamp(50 + (p.clutchScore - p.score) * 120) : null, why: `You score ${pct(p.clutchScore ?? 0)} in the ${p.clutchN} games where both players were short of time, against ${pct(p.score)} overall.` },
  ];
  return { styles, strengths: [...raw, ...extra] };
}
// keep: the type shown so far (stableType): a near tie keeps it, so the card does not flip between two
// styles with a few new games; it changes when another leads clearly.
const KEEP_LEAN = 0.3, KEEP_V = 6;
function typeOf(p, keep = null) {
  const { styles, strengths } = traitsOf(p);
  const kept = keep && styles.find((x) => x.name === keep.style);
  const style = kept && kept.lean >= styles[0].lean - KEEP_LEAN ? kept : styles[0]; // the style that leans furthest, even when none stands out clearly
  // The strength: the one furthest above the player's own opponents (50 is even). One that stands out
  // (64 or more) wins; failing that, everyone still gets the one they are best at, if above their opponents.
  // Defense has no strength of its own: being best at it is the Guardian style.
  // Fighter says how games go, not a skill: it only shows when it clearly stands out, never as the fallback.
  const ranked = strengths.filter((x) => x.label !== 'Defense' && x.v !== null && x.v > 50 && x.label !== SAME[style.name] && (x.label !== 'Fighter' || x.v >= 64)).sort((x, y) => y.v - x.v);
  const keptS = keep && ranked.find((x) => (STRENGTH[x.label] || x.label) === keep.strength);
  const best = keptS && keptS.v >= ranked[0].v - KEEP_V ? keptS : ranked[0];
  const second = best ? { name: STRENGTH[best.label] || best.label, why: STRENGTH[best.label] ? `${best.label} is where you beat your level most: ${best.why}` : best.why } : styles[1].lean >= 1 ? styles[1] : null; // a second style only when it is top-tenth
  return second ? [style, second] : [style];
}

// Skill bars, 0-100, each read from one thing in the games; null when there are too few games to say.
// The raw scales are rules of thumb (50 is a so-so result for the player); skillsOf puts them on the card's scale.
let LIKE = null; // fineSkillsOf: whether the analysis parts count
let FINE = false; // unrounded, for one game's tiny effect (fineSkillsOf)
const clamp = (x) => { const c = Math.max(0, Math.min(100, x)); return FINE ? c : Math.round(c); };
// The card's scale is set by the rating, so stronger players have higher cards (about 60 at 1200, 76 at
// 2000, 88 at 2800). Each skill then moves above or below that by how the player does against
// their own opponents at their level (raw: 50 = as good as them), so strengths and leaks still show.
const LEVEL = [[400, 35], [1200, 60], [2000, 76], [2800, 88], [3300, 92]]; // the top stays below 99, so the best still have peaks
function levelOf(rating) {
  if (!rating) return 50;
  const i = LEVEL.findIndex(([r]) => r >= rating);
  if (i <= 0) return LEVEL[i < 0 ? LEVEL.length - 1 : 0][1];
  const [[r0, v0], [r1, v1]] = [LEVEL[i - 1], LEVEL[i]];
  return v0 + ((rating - r0) / (r1 - r0)) * (v1 - v0);
}
// Against their own level most players are close to even on every skill, so the card would show six
// near-equal numbers. The player's shape is what tells two players apart: how far each skill is from
// their own average is drawn twice as large (SHAPE), and the average itself (how much better or worse
// than their opponents they are overall) at half size. level is where "as good as them" (raw 50) lands.
const SHAPE = 2;
// The skills that need a computer's verdict count only analysed games against opponents near your rating
// (p.peer.analysed), so more than ENOUGH analysed games are needed in all. unlockAt: the analysis tier
// (as on the Analyse buttons) that should bring those games to ENOUGH, at the share they make up now.
function unlockAt(p) {
  const have = p.peer?.analysed ?? 0, all = p.analysed ?? 0;
  const need = have >= ENOUGH ? all : Math.ceil(ENOUGH * (all && have ? all / have : 1));
  return { have, at: (TIERS.find(([n]) => n >= need) || [need])[0] };
}
console.assert(unlockAt({ analysed: 100, peer: { analysed: 95 } }).at === 100 && unlockAt({ analysed: 40, peer: { analysed: 30 } }).at === 100 && unlockAt({ analysed: 100, peer: { analysed: 30 } }).at === 250, 'unlockAt');
function skillsOf(p) {
  const base = levelOf(p.speeds?.[0]?.rating), raw = rawSkills(p).map((x) => (p.n < MIN_GAMES ? { ...x, v: null } : x)), known = raw.filter((x) => x.v !== null);
  const mean = known.length ? sum(known, (x) => x.v) / known.length : 50;
  const card = (r) => base + 0.5 * (mean - 50 + SHAPE * (r - mean));
  const u = unlockAt(p);
  return raw.map((x) => ({ ...x, have: u.have, unlockAt: u.at, raw: x.v, level: clamp(card(50)), v: x.v === null ? null : Math.min(99, clamp(card(x.v))) }));
}
{ // the shape is stretched, the overall (the mean of the card's skills) stays at base + half the mean gap
  const s = skillsOf({ speeds: [{ rating: 1200 }], peer: { analysed: 120, ups: 36, downs: 32, saved: 0.5, quickW: 0.2, quickL: 0.15, after12: 40, n12: 120, myBl: 2.8, oppBl: 3, meUp: 2.7, oppUp: 3.6, meDown: 1.5, oppDown: 1.4, endgames: 300, endScore: 0.57, n: 400, myLow: 0.15, oppLow: 0.22, timeWins: 0.15, timeLosses: 0.04 } });
  const m = sum(s, (x) => x.raw) / 6, o = sum(s, (x) => x.v) / 6;
  console.assert(Math.abs(o - (60 + (m - 50) / 2)) < 1 && Math.abs((s[5].v - s[3].v) - (s[5].raw - s[3].raw)) <= 1, 'skillsOf shape'); // SHAPE 2 at half size: a gap of 10 between two skills stays 10
}
console.assert(typeOf({ attacking: 0.54, solid: 0.2, queensOff: 0.1, draws: 0.05, moves: 30, lowTime: 0.16, noCastle: 0.1, speeds: [{ rating: 1200 }], peer: { n: 100, score: 0.5, downs: 30, ups: 30, saved: 0.47, oppSaved: 0.2, myLow: 0.05, oppLow: 0.25, timeWins: 0.15, timeLosses: 0.04 } }).map((t) => t.name).join() === 'Striker,Speed demon', 'typeOf');
console.assert(typeOf({ attacking: 0.27, solid: 0.56, queensOff: 0.23, draws: 0.03, moves: 29, lowTime: 0.15, noCastle: 0.1, speeds: [{ rating: 1200 }], peer: { n: 100, analysed: 120, after12: 96, n12: 120 } }).map((t) => t.name).join() === 'Solid builder,Well prepared', 'typeOf: the leaning style, and a strength');
console.assert(levelOf(1200) === 60 && levelOf(2400) === 82 && levelOf(5000) === 92 && levelOf(100) === 35, 'levelOf');
// like: read with the same parts as that profile, so one game that brings the analysed games to ENOUGH
// does not switch the analysis parts on in one reading and off in the other.
const fineSkillsOf = (p, like = p) => { FINE = true; LIKE = (like.peer?.analysed ?? 0) >= ENOUGH; try { return skillsOf(p); } finally { FINE = false; LIKE = null; } };
function rawSkills(p) {
  const q = p.peer || {}, an = LIKE ?? (q.analysed ?? 0) >= ENOUGH, pawns = (cp) => { const r = Math.round(cp / 10) / 10; return r === 0 ? '0.0' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}`; };
  // a against b (yours against your opponents'): 50 when equal, 100 when only you; floor keeps rare things from swinging
  const vs = (a, b, floor) => (a == null || b == null ? null : 50 + (50 * (a - b)) / Math.max(floor, a + b));
  // each part is a value or [value, weight]; parts without a value are left out
  const avg = (xs) => { const k = xs.map((x) => (Array.isArray(x) ? x : [x, 1])).filter(([x, w]) => x != null && !Number.isNaN(x) && w > 0); return k.length ? clamp(sum(k, ([x, w]) => x * w) / sum(k, ([, w]) => w)) : null; };
  const up = an ? q.ups / q.analysed : null, down = an ? q.downs / q.analysed : null, f1 = (x) => (x ?? 0).toFixed(1);
  return [
    // The player's own attacking openings weigh double once they have 40 such games; fewer say less.
    { label: 'Attack', v: avg([q.attN >= 15 ? [clamp(50 + q.attGain * 150), 2 * Math.min(1, q.attN / 40)] : null, q.n >= 30 ? vs(q.quickW, q.quickL, 0.05) : null, an ? vs(q.oppUp, q.meUp, 0.2) : null]),
      means: 'Do attacks work? Attacking openings and gambits against how they usually go at this level, quick wins, and few slips when ahead.',
      why: [q.attN >= 15 && `Attacking openings ${pct(q.attScore)} (usual ${pct(q.attExp)})`, `wins in 25 moves ${pct(q.quickW ?? 0)} (opponents ${pct(q.quickL ?? 0)})`, an && q.meUp != null && `slips when ahead ${f1(q.meUp)} per 10 moves (opponents ${f1(q.oppUp)})`].filter(Boolean).join(' · ').replace(/^./, (c) => c.toUpperCase()) + '.',
      train: 'When ahead: trade pieces, not pawns, take away their counterplay first, and do not rush.', href: './mistakes.html' },
    // shortcut: "usual" saves (42%) is the mean of eight checked players, all levels; measure it per level when there is data for it
    { label: 'Defense', needs: true, v: avg([q.solidN >= 15 ? clamp(50 + q.solidGain * 150) : null, q.vsAttN >= 15 ? clamp(50 + q.vsAttGain * 150) : null, an && q.downs >= 5 && q.saved != null ? clamp(50 + (q.saved - 0.42) * 150) : null, an ? vs(q.oppDown, q.meDown, 0.2) : null, vs(up, down, 0.1)]),
      means: 'Hard to beat? Solid openings and defending against attacks, against how they usually go at this level, saving lost positions, and how rarely opponents get ahead.',
      why: [q.solidN >= 15 && `Solid openings ${pct(q.solidScore)} (usual ${pct(q.solidExp)})`, q.vsAttN >= 15 && `against attacks ${pct(q.vsAttScore)} (usual ${pct(q.vsAttExp)})`, an && `lost positions saved ${pct(q.saved ?? 0)} (usual 42%)`, an && `opponents clearly ahead in ${pct(down)} of games (the other way ${pct(up)})`].filter(Boolean).join(' · ').replace(/^./, (c) => c.toUpperCase()) + '.',
      train: 'When behind: keep pieces on, make threats, and set traps rather than waiting.' },
    { label: 'Early game', v: (q.n12 ?? 0) >= EARLY_MIN && q.after12 !== null ? clamp(50 + q.after12 / 4) : null,
      means: 'How the position stands after move 12.',
      why: `After move 12 you stand at ${Math.round(50 + 50 * (2 / (1 + Math.exp(-0.00368208 * (q.after12 ?? 0))) - 1))}% winning chances on average (50% is level), in ${q.n12 ?? 0} games.`,
      train: 'Practise the lines of the openings you play, and learn the plan behind them, not just the moves.', href: './' },
    { label: 'Late game', v: q.endgames >= 10 ? clamp(50 + (q.endScore - 0.5) * 110) : null,
      means: 'Results once most pieces are gone (6 or fewer besides kings and pawns).',
      why: `${pct(q.endScore ?? 0)} in ${q.endgames} endgames (50% is even).`,
      train: 'Learn the basic endgames: king activity, passed pawns, and the key king-and-pawn positions.' },
    { label: 'Accuracy', needs: true, v: an && q.myBl !== null && q.oppBl !== null ? clamp(vs(q.oppBl, q.myBl, 0.5)) : null,
      means: 'How often a piece or the game is thrown away.',
      why: `${(q.myBl ?? 0).toFixed(1)} blunders a game (opponents ${(q.oppBl ?? 0).toFixed(1)}).`,
      train: 'Before every move, check every check, capture and threat your opponent has after it. Then solve the positions where you blundered.', href: './mistakes.html' },
    { label: 'Speed', v: q.n >= 30 ? clamp(50 + (q.oppLow - q.myLow) * 100 + (q.timeWins - q.timeLosses) * 50) : null,
      means: 'Handling the clock: who ends up short of time, and who wins or loses on it.',
      why: `Short of time ${pct(q.myLow ?? 0)} (opponents ${pct(q.oppLow ?? 0)}) · wins on time ${pct(q.timeWins ?? 0)}, losses ${pct(q.timeLosses ?? 0)}.`,
      train: 'Play the opening fast (you know it), and save your thinking time for the critical moments.' },
  ];
}
console.assert(rawSkills({ peer: { analysed: 120, ups: 36, downs: 12, after12: 100, n12: 120, myBl: 1, oppBl: 1, meUp: 1, oppUp: 3, endgames: 0, n: 10 } }).map((x) => x.v).slice(0, 3).join() === '75,75,75', 'rawSkills');
{
  const g = (o) => ({ side: 'w', speed: 'blitz', status: 'resign', plies: 60, result: 1, family: 'Italian Game', chosen: true, rating: 1500, diff: 5, castled: 8, queensOff: null, endgame: false, analysed: false, acc: null, blunders: null, best: null, worst: null, after12: null, slips: { opening: 0, middlegame: 0, endgame: 0 }, lowTime: false, ...o });
  const p = profileOf([g({}), g({ result: 0 }), g({ side: 'b', result: 0 }), g({ side: 'b', result: 0.5 })]);
  console.assert(p.score === 0.375 && p.white === 0.5 && p.type[0].name === 'Striker', 'profileOf');
  // nothing known about defending (no opening chosen, no analysis): not Guardian, which says they defend clearly better
  console.assert(profileOf([g({ chosen: false }), g({ chosen: false, result: 0 })]).type[0].name !== 'Guardian', 'profileOf: Guardian needs evidence');
}

// ---------- Fetching ----------
async function fetchGames(name, onGame, since = null, perf = 'bullet,blitz,rapid,classical', until = null, got = [], tries = 0) {
  if (isCC(name)) return fetchCC(name, onGame, since, perf, MAX, until);
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(name)}?` + new URLSearchParams({
    max: MAX, ...(since ? { since } : {}), ...(until ? { until } : {}), rated: 'true', perfType: perf, moves: 'true', opening: 'true', clocks: 'true', evals: 'true', accuracy: 'true',
  }), { headers: { Accept: 'application/x-ndjson', ...lichessAuth() } });
  if (res.status === 404) throw new Error(`Lichess has no player called ${name}.`);
  if (res.status === 429) throw new Error('Lichess is busy right now. Try again in a minute.');
  if (!res.ok) throw new Error(`Lichess answered with an error (${res.status}).`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader(), games = got;
  let rest = '';
  // Lichess does not always stop at max, so reading stops by itself once there are enough games.
  while (games.length < MAX) {
    let value, done;
    try { ({ value, done } = await reader.read()); } catch (err) {
      // The stream broke off ("Error in input stream" in Firefox): go on from the oldest game in, twice at most.
      if (tries >= 2) { if (games.length) { rest = ''; break; } throw new Error(`The connection to Lichess broke off. Try again.`); }
      const oldest = games.at(-1)?.createdAt;
      return fetchGames(name, onGame, since, perf, oldest ? oldest - 1 : until, games, tries + 1);
    }
    if (done) break;
    const lines = (rest + value).split('\n');
    rest = lines.pop();
    for (const l of lines) {
      const g = l.trim() && JSON.parse(l);
      if (g?.variant === 'standard' && games.length < MAX) { games.push(g); onGame(games.length, games); }
    }
  }
  reader.cancel().catch(() => {});
  if (rest.trim() && games.length < MAX) { const g = JSON.parse(rest); if (g.variant === 'standard') games.push(g); }
  return games;
}

// ---------- Games kept in this browser ----------
// Each player's games are kept (packed small: the analysis as numbers), so a later visit or Refresh
// fetches only the games played since. Kept for the 3 players looked at last.
const GAMES = 'opening-book-v2-games'; // { [lower-case name]: { at, games: [packed game, newest first] } }
// Both clocks at move 15 (White's, Black's), kept with the game; older kept games have none.
const at15Of = (g) => g.at15 || (g.clocks?.length > 31 ? g.clocks.slice(30, 32) : null);
const endClocks = (cl) => (cl?.length ? [cl.filter((_, i) => i % 2 === 0).at(-1) ?? null, cl.filter((_, i) => i % 2 === 1).at(-1) ?? null] : null);
const player = (x) => ({ user: x.user ? { id: x.user.id } : undefined, rating: x.rating, ratingDiff: x.ratingDiff, analysis: x.analysis });
const J = { B: 'Blunder', M: 'Mistake', I: 'Inaccuracy' };
function pack(g) {
  const an = g.analysis;
  return { id: g.id, variant: 'standard', speed: g.speed, createdAt: g.createdAt, status: g.status, winner: g.winner, moves: g.moves,
    opening: g.opening ? { name: g.opening.name } : undefined, clock: g.clock ? { initial: g.clock.initial } : undefined,
    end: g.end || endClocks(g.clocks), at15: at15Of(g) || undefined, ours: g.ours || undefined, at12: g.at12 ?? undefined, players: { white: player(g.players.white), black: player(g.players.black) },
    an: an && { cp: an.map((x) => cpOf(x) ?? 0), j: an.map((x) => x.judgment?.name?.[0] || '.').join(''),
      best: Object.fromEntries(an.flatMap((x, i) => (x.best ? [[i, x.best]] : []))), v: Object.fromEntries(an.flatMap((x, i) => (x.variation ? [[i, x.variation]] : []))) } };
}
function unpack(t) {
  const { an, ...g } = t;
  if (an) g.analysis = an.cp.map((cp, i) => ({ eval: cp, ...(J[an.j[i]] ? { judgment: { name: J[an.j[i]] } } : {}), ...(an.best[i] ? { best: an.best[i] } : {}), ...(an.v[i] ? { variation: an.v[i] } : {}) }));
  return g;
}
console.assert(((g) => unpack(pack(g)).analysis[1].judgment.name === 'Blunder' && unpack(pack(g)).end[1] === 50)({ id: 'x', players: { white: {}, black: {} }, clocks: [100, 90, 80, 50, 70],
  analysis: [{ eval: 20 }, { eval: 400, judgment: { name: 'Blunder' }, best: 'e7e5' }] }), 'pack');
// The games are kept in IndexedDB (localStorage held only about three players and dropped the rest,
// with the games analysed here). In memory once loaded, so reading stays synchronous: every page that
// reads games waits for gamesReady first. Kept: your own games and every player with games analysed
// here, always; the KEEP most recently read other players besides.
const KEEP = 20;
let MEM = new Map();
const openGames = () => new Promise((res, rej) => {
  const q = indexedDB.open('chess-trainer-games', 1);
  q.onupgradeneeded = () => q.result.createObjectStore('players');
  q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
});
function persist(key, value) {
  openGames().then((db) => { const st = db.transaction('players', 'readwrite').objectStore('players'); if (value) st.put(value, key); else st.delete(key); }).catch(() => {});
}
const gamesReady = (async () => {
  try {
    const db = await openGames();
    MEM = await new Promise((res) => { const out = new Map(), q = db.transaction('players').objectStore('players').openCursor();
      q.onsuccess = () => { const c = q.result; if (c) { out.set(c.key, c.value); c.continue(); } else res(out); }; q.onerror = () => res(out); });
  } catch {}
  // Games kept the old way move over once.
  let old = {};
  try { old = JSON.parse(localStorage.getItem(GAMES)) || {}; } catch {}
  for (const [k, v] of Object.entries(old)) if (!MEM.has(k) || MEM.get(k).at < v.at) { MEM.set(k, v); persist(k, v); }
  try { localStorage.removeItem(GAMES); } catch {}
})();
// The engine work done here (a full analysis, the move-12 look) also goes to the analyses function, per
// player, so it is there on every device, logged in or not. Pulled when a player's games are fetched.
const SYNC = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/analyses';
const SENT = new Map(), PULLS = new Map(); // `${player}|${id}` → what the server has; player → its pull
const sig = (g) => `${g.ours ? 1 : 0}|${g.at12 ?? ''}`;
const extra = (g) => { const t = pack(g); return { ours: g.ours || undefined, at12: g.at12 ?? undefined, an: g.ours ? t.an : undefined, pa: g.ours ? [g.players.white.analysis, g.players.black.analysis] : undefined }; };
function pull(name) {
  const me = name.toLowerCase();
  if (!PULLS.has(me)) PULLS.set(me, fetch(`${SYNC}?u=${encodeURIComponent(me)}`).then((r) => (r.ok ? r.json() : [])).catch(() => []).then((rows) => {
    const m = new Map(rows.map((r) => [r.id, r.data]));
    for (const [id, d] of m) SENT.set(`${me}|${id}`, sig(d));
    for (const sp of ['all', ...SPEEDS]) if (m.get(typeId(sp))?.style) STABLE.set(`${me}|${sp}`, m.get(typeId(sp)));
    if (m.get('TYPEpiec')?.piece) PICKED.set(me, m.get('TYPEpiec').piece);
    return m;
  }));
  return PULLS.get(me);
}
// ---------- The stable type ----------
// The style and strength shown for a player in a time control are kept with their analyses (rows
// TYPEbull, TYPEblit… in the analyses function), so everyone, on any device, sees the same type, and a near
// tie between two styles does not flip it; whoever reads the full games first sets it, and a clear lead changes it.
const STABLE = new Map(); // 'name|speed' → { style, strength }
const PICKED = new Map(); // name → the piece the player chose for their card (row TYPEpiec), over the one their games give
const typeId = (sp) => `TYPE${(sp || 'all').slice(0, 4).padEnd(4, 'g')}`; // TYPEbull, TYPEblit, TYPErapi, TYPEclas, TYPEallg
let drawingEarly = false; // build draws from the first games while the rest come in: such a type is not kept
function stableType(name, sp, p) {
  const k = `${name.toLowerCase()}|${sp}`, keep = STABLE.get(k) || null, t = typeOf(p, keep);
  const pc = PICKED.get(name.toLowerCase());
  if (p.pieceAuto === undefined) { p.pieceAuto = p.piece; p.pieceWhyAuto = p.pieceWhy; } // the one the games give, kept to go back to
  if (pc) { p.piece = pc; p.pieceWhy = 'chosen'; } else { p.piece = p.pieceAuto; p.pieceWhy = p.pieceWhyAuto; } // the player's own pick for their card
  const now = { style: t[0]?.name, strength: t[1]?.name || null };
  if (!drawingEarly && p.n >= MIN_GAMES && (!keep || keep.style !== now.style || keep.strength !== now.strength)) {
    STABLE.set(k, now);
    fetch(SYNC, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ player: name.toLowerCase(), rows: [{ id: typeId(sp), data: now }] }) }).catch(() => {});
  }
  return t;
}
// Lists of cards (leaderboard, landing): each card's style and strength as kept, so they match the profile.
// One light call for all of them (the analyses function's ?types=); as they were if it cannot answer.
async function keptTypes(rows) {
  const names = [...new Set(rows.map((r) => r.name.toLowerCase()))];
  const got = await fetch(`${SYNC}?types=${encodeURIComponent(names.join(','))}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  for (const x of Array.isArray(got) ? got : []) {
    for (const sp of ['all', ...SPEEDS]) if (x.id === typeId(sp) && x.data?.style) STABLE.set(`${x.player}|${sp}`, x.data);
    if (x.id === 'TYPEpiec' && x.data?.piece) PICKED.set(x.player, x.data.piece);
  }
  return rows.map((r) => { const k = STABLE.get(`${r.name.toLowerCase()}|${r.speed}`), pc = PICKED.get(r.name.toLowerCase());
    return { ...r, ...(k ? { style: k.style, strength: k.strength } : {}), ...(pc ? { piece: pc } : {}) }; });
}
// Puts what other devices did into these games (in place); true when something was added.
let merged = false; // the last build took in analyses from another device: the shown profile is out of date
async function mergeRemote(name, games) {
  const m = await pull(name);
  let added = false;
  for (const g of games) {
    const d = m.get(g.id);
    if (!d) continue;
    if (d.at12 != null && g.at12 == null) { g.at12 = d.at12; added = true; }
    if (d.ours && !g.ours && d.an) {
      g.analysis = unpack({ an: d.an }).analysis; g.ours = d.ours; added = true;
      if (d.pa) { g.players.white.analysis = d.pa[0]; g.players.black.analysis = d.pa[1]; }
    }
  }
  return added;
}
async function push(name, games) {
  const me = name.toLowerCase();
  await pull(name);
  const rows = games.filter((g) => (g.ours || g.at12 != null) && SENT.get(`${me}|${g.id}`) !== sig(g)).map((g) => ({ id: g.id, data: extra(g) }));
  for (let i = 0; i < rows.length; i += 200) { // shortcut: no retry; what fails goes again with the next save
    const part = rows.slice(i, i + 200);
    const ok = await fetch(SYNC, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ player: me, rows: part }) }).then((r) => r.ok).catch(() => false);
    if (ok) part.forEach((r) => SENT.set(`${me}|${r.id}`, sig(r.data)));
  }
}
let pushing = null;
function saveGames(name, games) {
  const me = name.toLowerCase(), value = { at: Date.now(), games: games.map(pack) };
  MEM.set(me, value); persist(me, value);
  clearTimeout(pushing); pushing = setTimeout(() => push(name.split('~')[0], games), 3000); // a run saves often; a time control's games are the player's
  const own = (myName() || '').toLowerCase(), precious = (k, v) => k === own || v.games.some((g) => g.ours);
  // A time control's own games (name~speed) go with their player: they neither count nor stay on alone.
  const base = me.split('~')[0];
  [...MEM].filter(([k, v]) => !k.includes('~') && k !== base && !precious(k, v)).sort((a, b) => b[1].at - a[1].at).slice(KEEP)
    .forEach(([k]) => [...MEM.keys()].filter((x) => x === k || x.startsWith(`${k}~`)).forEach((x) => { MEM.delete(x); persist(x, null); }));
}
// One game changed here (analysed on its own page) goes back into the kept games.
function keepGame(name, g) {
  for (const k of [name, ...SPEEDS.map((sp) => speedKey(name, sp))]) { // the player's games and each time control's own
    const games = storedGames(k), i = games ? games.findIndex((x) => x.id === g.id) : -1;
    if (i >= 0) { games[i] = g; saveGames(k, games); }
  }
  forget(name);
}
function forget(name) {
  const all = cache(); delete all[name.toLowerCase()];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
}
// A player's games as kept here, in Lichess's shape, or null.
function storedGames(name) {
  const t = MEM.get(name.toLowerCase());
  return t ? t.games.map(unpack) : null;
}

let RAW = null, RAW_NAME = ''; // the games in use, kept for analysing them here
let quiet = false; // checking for new games behind a profile already shown: no progress messages
const msgEl = () => (quiet ? { textContent: '' } : $('#profile-msg'));
// A known pro's or streamer's games, fetched every few hours by the pros function into our own
// storage: read in one go, so only the games since come from Lichess (which sends ~20 a second).
const SNAPSHOT = new URLSearchParams(location.search).has('snapshot');
// Every pro's and VIP's profile with its games, read every 3 hours by tools/snapshot_pros.py into the branch
// pros-data, so their page draws at once and nothing is fetched from Lichess or Chess.com. index.json: when
// each account last played, for the order of their accounts.
// shortcut: served by raw.githubusercontent.com (cached 5 min, no promises on traffic); move behind the site if visits grow large.
const SNAPS = 'https://raw.githubusercontent.com/joeland2/schack-oppningar/pros-data', SNAP_FRESH = 12 * 36e5;
const SNAP = new Map();
const snapOf = (n) => {
  const f = n.toLowerCase().replace(':', '_');
  if (!SNAP.has(f)) SNAP.set(f, fetch(`${SNAPS}/${encodeURIComponent(f)}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return SNAP.get(f);
};
let LAST = {}, lastAsked = null;
const lastPlayed = () => (lastAsked ??= fetch(`${SNAPS}/index.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((x) => (LAST = x)));
const freshSnap = (s) => !!s && s.v === PV && Date.now() - s.at < SNAP_FRESH;
// A snapshot's games kept here as if fetched, unless newer ones are; not sent back as analyses done here.
function useSnap(name, s) {
  const me = name.toLowerCase();
  if (s?.games?.length && !(MEM.get(me)?.at > s.at)) { const v = { at: s.at, games: s.games }; MEM.set(me, v); persist(me, v); }
}
const PRO_STORE = 'https://duhlvhjtxoofgnjegspa.supabase.co/storage/v1/object/public/pros';
const serverGames = (name) => (isCC(name)
  ? fetch(`${PRO_STORE}/cc_${encodeURIComponent(nick(name).toLowerCase())}.json`).then((r) => (r.ok ? r.json() : [])).then(fromCC)
  : fetch(`${PRO_STORE}/${encodeURIComponent(name.toLowerCase())}.ndjson`).then((r) => (r.ok ? r.text() : ''))
    .then((t) => t.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((g) => g.variant === 'standard'))).then((gs) => gs.slice(0, MAX)).catch(() => []);
// The bar over the profile while games come in: one line that never wraps, a percentage, a thick track.
// It fades out when the card is in (done), and a time control still coming shows it again when picked.
let holdBar = false; // run keeps the bar up past build, through the main time control's own games
const loadBar = {
  el: () => $('#pf-load'),
  on() { const b = this.el(); return !!b && !b.hidden && !b.classList.contains('out'); },
  show(say, pct = 0) { const b = this.el(); if (!b) return; b.classList.remove('out'); b.hidden = false; this.step(pct, say); },
  step(pct, say) {
    const b = this.el(); if (!b || b.hidden) return;
    b.querySelector('i').style.width = `${pct}%`; b.querySelector('[role=progressbar]').setAttribute('aria-valuenow', Math.round(pct));
    b.querySelector('.pf-load-n').textContent = `${Math.round(pct)}%`; if (say) b.querySelector('.pf-load-k').textContent = say;
  },
  done() { const b = this.el(); if (!this.on()) return; this.step(100); b.classList.add('out'); setTimeout(() => { if (b.classList.contains('out')) b.hidden = true; }, 200); },
  off() { const b = this.el(); if (b) { b.hidden = true; b.classList.remove('out'); } },
};
async function build(name) {
  const msg = msgEl();
  let have = storedGames(name) || [];
  if (!have.length && proOf(name)) have = await serverGames(name);
  msg.textContent = have.length ? `Fetching ${nick(name)}'s new games from ${siteOf(name)}…` : `Fetching ${nick(name)}'s last ${MAX} rated games from ${siteOf(name)}…`;
  // Lichess sends about 20-30 games a second, so a first look-up takes a while: the profile is drawn
  // from the first EARLY games as soon as they are in, then drawn again from all of them.
  const mine = runs;
  let early = false;
  // The bar over the profile on a first look-up: how far the games are, and what happens meanwhile.
  const step = (pct, say) => loadBar.step(pct, say);
  if (!quiet && !have.length) loadBar.show(`Asking ${siteOf(name)} for ${nick(name)}'s last ${MAX} rated games…`);
  if (loadBar.on()) msg.textContent = ''; // the bar says it
  // tools/snapshot_pros.py reads a pro from the games kept on our server alone: Lichess's stream can stall for a server.
  const fresh = SNAPSHOT && have.length ? [] : await fetchGames(name, (k, gs) => {
    if (!loadBar.on()) msg.textContent = early ? '' : `Fetching ${nick(name)}'s games from ${siteOf(name)}… ${k}`;
    step((k / MAX) * 90, `Fetching ${nick(name)}'s games from ${siteOf(name)}: ${k} of up to ${MAX}`);
    if (!have.length && !quiet && (k === EARLY || (early && k % REDRAW === 0))) {
      early = true;
      loadScores().then(() => { if (mine === runs) { const y = scrollY; drawingEarly = true; try { render(name, Date.now(), profileOf(gs.slice().map((g) => readGame(g, name.toLowerCase())))); } finally { drawingEarly = false; } scrollTo(0, y); } }).catch(() => {});
    }
  }, have.length ? have[0].createdAt + 1 : null).catch((err) => { loadBar.off(); throw err; });
  step(91, `Reading the games for the card…`);
  const ids = new Set(fresh.map((g) => g.id));
  const raw = [...fresh, ...have.filter((g) => !ids.has(g.id))].slice(0, MAX);
  if (!raw.length) { loadBar.off(); throw new Error(`${nick(name)} has no rated games on ${siteOf(name)} yet.`); }
  merged = await mergeRemote(name, raw);
  saveGames(name, raw);
  RAW = raw; RAW_NAME = name;
  try { return await readAll(name, raw); } catch (err) { loadBar.off(); throw err; } finally { if (!holdBar) loadBar.done(); }
}
// The profile every page shows: read just now (within FRESH), else new games fetched and all read again,
// so the profile, compare and the practice plan always agree and follow new games and analyses.
const FRESH = 5 * 60e3;
async function current(name) {
  await gamesReady;
  const c = cache()[name.toLowerCase()];
  await pull(name); // the kept type (stableType) is known before any card is drawn
  return c && c.v === PV && Date.now() - c.at < FRESH && storedGames(name) ? c.p : build(name);
}
async function readAll(name, raw) {
  const msg = msgEl();
  await loadScores();
  const me = name.toLowerCase(), games = [];
  for (let i = 0; i < raw.length; i++) {
    games.push(readGame(raw[i], me));
    if (i % 25 === 24) { if (loadBar.on()) loadBar.step(91 + (i / raw.length) * 6, `Reading the games: ${i + 1} of ${raw.length}`); else msg.textContent = `Reading the games… ${i + 1} of ${raw.length}`; await new Promise((r) => setTimeout(r)); }
  }
  RECORDS.set(`${me}:${raw.length}:${raw[0]?.id}:${raw.at(-1)?.id}:${raw.filter((g) => g.analysis).length}`, games); // compare's per-time-control reading reuses these
  const p = profileOf(games);
  const keep = Object.entries(cache()).sort((a, b) => b[1].at - a[1].at).slice(0, 9);
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([[me, { name, at: Date.now(), p, v: PV }], ...keep.filter(([k]) => k !== me)]))); } catch {}
  msg.textContent = '';
  return p;
}

// ---------- Analysing games here ----------
// Games Lichess has not analysed can be analysed in this browser with Stockfish: the evaluation after
// every move, then blunders, mistakes and accuracy by Lichess's own formulas, so the profile reads
// them like Lichess's analysis. Results are kept per game, so a game is only ever analysed once.
const MS = 40;                          // per position: plenty to see blunders
const PER_POS = 0.035;                  // seconds per position, measured on a laptop (search plus overhead); phones are slower
const ENGINE_SRC = 'engine/stockfish-18-lite-single.js';
// Engines side by side when analysing: all cores but one, fewer on a phone (memory and heat).
const ENGINES = Math.max(1, Math.min(matchMedia('(pointer: coarse)').matches ? 2 : 6, (navigator.hardwareConcurrency || 2) - 1));
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
function applyEvals(g, cps, best = []) {
  g.analysis = cps.map((cp, i) => ({ eval: cp, ...(best[i] ? { best: best[i] } : {}) }));
  const tally = { white: { blunder: 0, mistake: 0, inaccuracy: 0, acc: [] }, black: { blunder: 0, mistake: 0, inaccuracy: 0, acc: [] } };
  let prev = 20; // the start position
  cps.forEach((cp, i) => {
    const who = i % 2 ? 'black' : 'white', sign = who === 'white' ? 1 : -1, t = tally[who];
    const drop = Math.max(0, winPct(sign * prev) - winPct(sign * cp)); // winning chances the move gave away
    const kind = drop >= 15 ? 'Blunder' : drop >= 10 ? 'Mistake' : drop >= 5 ? 'Inaccuracy' : null;
    if (kind) { t[kind.toLowerCase()]++; g.analysis[i].judgment = { name: kind }; }
    t.acc.push(Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669)));
    prev = cp;
  });
  for (const who of ['white', 'black']) {
    const t = tally[who];
    g.players[who].analysis = { blunder: t.blunder, mistake: t.mistake, inaccuracy: t.inaccuracy, accuracy: t.acc.length ? Math.round(sum(t.acc, (x) => x) / t.acc.length) : null };
  }
  g.ours = true;
}
console.assert(((g) => (applyEvals(g, [30, 25, -600]), g.players.white.analysis.blunder === 1 && g.analysis[2].judgment.name === 'Blunder'))({ players: { white: {}, black: {} } }), 'applyEvals');

let engine = null;
// Stockfish's verdict on one position: centipawns from White (a mate counts as 1000) and its best move.
let engineQueue = Promise.resolve();
function engineEval(fen, go) {
  const next = engineQueue.then(() => evalNow(fen, undefined, go));
  engineQueue = next.catch(() => {});
  return next;
}
function evalNow(fen, w = (engine ??= new Worker(ENGINE_SRC)), go = `movetime ${MS}`) {
  const white = fen.split(' ')[1] === 'w';
  return new Promise((resolve, reject) => {
    let cp = 0;
    w.onerror = reject;
    w.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      const m = e.data.match(/ score (cp|mate) (-?\d+)/);
      if (m && !/ (lower|upper)bound/.test(e.data)) {
        const n = Number(m[2]);
        cp = m[1] === 'cp' ? Math.max(-1000, Math.min(1000, n)) : n > 0 ? 1000 : -1000; // mate 0: the side to move is mated
      }
      if (e.data.startsWith('bestmove')) { const b = e.data.split(' ')[1]; resolve({ cp: white ? cp : -cp, best: b && b !== '(none)' ? b : null }); }
    };
    w.postMessage(`position fen ${fen}`);
    w.postMessage(`go ${go}`);
  });
}
const minutes = (sec) => (sec < 60 ? 'under a minute' : `about ${Math.round(sec / 60)} min`);
// What reaching `target` analysed games would take: just enough of the newest games without analysis
// (those analysed on Lichess already count), and the time.
function costOf(p, target) {
  const todo = (p.todo || []).filter(Boolean).slice(0, Math.max(0, target - p.analysed));
  return { games: todo.length, sec: (sum(todo, (x) => x) * PER_POS) / ENGINES };
}
let analysing = null; // { stop } while a run is going
// Early game needs only the position after move 12: Stockfish looks at that one position in every game
// without a full analysis, in the background, the first time a profile is shown. Kept with the games.
let quick = null; // the player whose games are being looked at
// Each game is tried once a visit: one that cannot be read (or a render after the pass) would otherwise
// start the pass again and again, reading all the games each time.
const TRIED = new Set();
async function quickLook(name) {
  const raw = storedGames(name);
  if (quick || analysing || !raw) return;
  const todo = raw.filter((g) => !g.analysis && g.at12 == null && g.moves && g.moves.split(' ').length > 24 && !TRIED.has(g.id));
  if (!todo.length) return;
  quick = name;
  const msg = () => $('#pf-early-msg');
  for (let k = 0; k < todo.length; k++) {
    if (analysing || shown?.[0] !== name) break; // a full analysis or another player takes over
    const c = new Chess();
    TRIED.add(todo[k].id);
    try { for (const m of todo[k].moves.split(' ').slice(0, 24)) c.move(m); } catch { continue; }
    todo[k].at12 = (await engineEval(c.fen())).cp;
    if (msg()) msg().textContent = `Looking at the position after move 12 in each game… ${k + 1} of ${todo.length}`;
    if (k % 50 === 49) saveGames(name, raw);
  }
  saveGames(name, raw);
  quick = null;
  if (shown?.[0] !== name || analysing || !todo.some((g) => g.at12 != null)) return;
  const p = await readAll(name, raw);
  render(name, Date.now(), p);
}
// sp: analyse the games the card of that time control reads (its own last 500 when fetched), so the
// panel's counts and the card agree; an analysis is kept in both the player's games and the time control's.
async function analyse(name, target, sp = null) {
  const el = $('#pf-analyse');
  await build(name); // the games played since are fetched first, so they are analysed too
  if (sp) await fetchSpeed(name, sp).catch(() => {});
  const own = sp && storedGames(speedKey(name, sp)), list = own || (sp ? RAW.filter((g) => g.speed === sp) : RAW);
  const have = list.filter((g) => g.analysis).length;
  const todo = list.filter((g) => !g.analysis && g.moves).slice(0, Math.max(0, target - have)); // the newest first, up to the target
  const total = sum(todo, (g) => g.moves.split(' ').length), t0 = Date.now();
  const run = analysing = { stop: false }, queue = [...todo], pool = Array.from({ length: Math.min(ENGINES, todo.length) }, () => new Worker(ENGINE_SRC));
  let done = 0, finished = 0, saved = Date.now();
  const save = () => { saveGames(name, RAW); if (own) saveGames(speedKey(name, sp), own); saved = Date.now(); };
  // One engine a core, each taking the next game. An engine that fails hands its game back to the others.
  await Promise.all(pool.map(async (w) => {
    for (let g; !run.stop && (g = queue.shift());) {
      const c = new Chess(), cps = [], best = [];
      try {
        for (const mv of g.moves.split(' ')) {
          if (run.stop) break;
          try { c.move(mv); } catch { break; }
          const r = await evalNow(c.fen(), w);
          cps.push(r.cp);
          best[cps.length] = r.best; // the best move here is the best instead of the next move
          done++;
          if (done % 10 === 0 && el) {
            const left = ((Date.now() - t0) / done) * (total - done) / 1000;
            el.querySelector('.pf-an-progress').textContent = `Analysing game ${Math.min(todo.length, finished + 1)} of ${todo.length} · ${minutes(left)} left`;
            el.querySelector('.pf-an-bar i').style.width = `${(done / total) * 100}%`;
          }
        }
      } catch (err) { console.warn(err); queue.unshift(g); return; }
      if (run.stop) break;
      applyEvals(g, cps, best);
      const m = own && RAW.find((x) => x.id === g.id);
      if (m) Object.assign(m, { analysis: g.analysis, ours: g.ours, players: g.players });
      finished++;
      if (Date.now() - saved > 5000) save(); // finished games are kept even if the run stops; saving after each would hold up the page
    }
  }));
  pool.forEach((w) => w.terminate());
  save();
  analysing = null;
  const mine = runs;
  const p = await readAll(name, RAW);
  if (mine === runs) render(name, Date.now(), p); // unless another player was looked up meanwhile
}
// A slim bar at the top: how many games are analysed, and analysing the newest 100, 250 or 500
// in all. New games are fetched first; games already analysed are always skipped.
// Stat accuracy: how many games are analysed, as three steps (Fair, Good, Best), with the button that
// reaches the next step first. A player with fewer games than a step reaches it by analysing them all.
function analysePanel(name, p, shown = p, sp = null) {
  if (analysing) return `<div id="pf-analyse" class="pf-analyse running"><span class="pf-an-progress">Analysing…</span><div class="pf-an-bar"><i></i></div><button type="button" class="link" data-stop>Stop</button></div>`;
  if (!p.todo || p.n < MIN_GAMES) return '';
  const tiers = TIERS.map(([n, label]) => [Math.min(n, p.n), label]).filter(([n], i, a) => i === a.findIndex(([m]) => m === n));
  const reached = tiers.filter(([n]) => p.analysed >= n).pop(), next = tiers.find(([n]) => p.analysed < n);
  const opts = tiers.map(([n]) => ({ n, ...costOf(p, n) })).filter((o) => o.games);
  // the steps not reached yet, nearest first; at Best, the newest games played since
  const ahead = opts.filter((o) => !next || o.n >= next[0]), main = ahead[0] || opts[0], rest = ahead.slice(1);
  const btn = (o, cls) => `<button type="button" class="${cls}" data-analyse="${o.n}" data-sp="${sp || ''}" title="The newest ${games(o.games)} without analysis, until ${o.n} are analysed: ${minutes(o.sec)}, with Stockfish in your browser">Analyse until ${o.n} <small>${o.games} games${next ? ` · ${tiers.find(([n]) => n === o.n)?.[1] || ''}` : ''} · ${minutes(o.sec).replace('about ', '~')}</small></button>`;
  let prev = 0;
  const steps = tiers.map(([n, label]) => { const fill = Math.max(0, Math.min(1, (p.analysed - prev) / (n - prev))); prev = n;
    return `<li class="${p.analysed >= n ? 'done' : fill > 0 ? 'now' : ''}"><span class="pf-acc-bar"><i style="width:${fill * 100}%"></i></span><span class="pf-acc-label"><b>${label}</b> ${n}</span></li>`; }).join('');
  // The skills count only analysed games against opponents near your rating, in the time control shown,
  // so they can stay locked after the panel's total (all games) has reached a tier.
  const locked = rawSkills(shown).filter((x) => x.v === null && x.needs).map((x) => x.label), have = shown.peer?.analysed ?? 0;
  const tooFew = unlockAt(shown).at > shown.n; // more analysed games needed than there are games to analyse
  const lockedNote = reached && locked.length && tooFew ? ` ${locked.join(' and ')} need${locked.length > 1 ? '' : 's'} ${ENOUGH} analysed games against opponents within ${PEER} of your rating${sp ? ` in ${sp}` : ''}, and there are only ${shown.n} games: ${locked.length > 1 ? 'they stay' : 'it stays'} locked until more are played.`
    : reached && locked.length ? ` ${locked.join(' and ')} unlock${locked.length > 1 ? '' : 's'} at ${unlockAt(shown).at} analysed games: ${ENOUGH} of them must be against opponents within ${PEER} of your rating${shown.speeds?.[0] && shown !== p ? ` in ${shown.speeds[0].speed}` : ''}, and ${have} are so far.` : '';
  const say = !reached ? `Analyse ${next[0]} games to unlock ${locked.length ? `${locked.join(' and ')}, and ` : ''}the parts of Attack and Defense that need analysis (mistakes and advantages).`
    : next ? `Skills can still move a few points. ${next[1]} at ${next[0]} analysed games.${lockedNote}`
    : `Every skill rests on all the games there are.${lockedNote}`;
  return `<div id="pf-analyse" class="pf-analyse pf-acc${reached ? '' : ' few'}">
    <div class="pf-acc-head"><span class="pf-acc-k">Stat accuracy</span><b class="pf-acc-v">${reached ? reached[1] : 'Locked'}</b>
      <span class="pf-acc-n">${p.analysed} of ${shown !== p ? 'all ' : ''}${p.n}${sp ? ` ${sp}` : ''} games analysed${shown !== p && shown.speeds?.[0] ? ` (${shown.analysed} in ${shown.speeds[0].speed})` : ''}</span>
      <details class="pf-help"><summary title="${WHY_ANALYSE}" aria-label="Why analyse?">?</summary><p>${WHY_ANALYSE}</p></details></div>
    <ol class="pf-acc-steps" aria-label="Stat accuracy: ${reached ? reached[1] : 'locked'}">${steps}</ol>
    <p class="pf-acc-src">${isCC(name) ? `Counts the games analysed here (${p.ours || 0}). The buttons analyse more of the games` : `Counts the games analysed on lichess.org (${p.analysed - (p.ours || 0)}) and here (${p.ours || 0}). The buttons analyse more of the Lichess games`} with Stockfish in your browser; each game is done once and kept.</p>
    <div class="pf-acc-foot"><p class="pf-acc-say">${say}</p>
    ${main ? `<div class="pf-an-row">${btn(main, 'cta pf-an-go')}${rest.map((o) => btn(o, 'pf-an-opt')).join('')}</div>` : ''}</div>
  </div>`;
}
function bindAnalyse(name) {
  const el = $('#pf-analyse');
  if (!el) return;
  el.querySelectorAll('[data-analyse]').forEach((b) => b.addEventListener('click', async () => {
    const n = Number(b.dataset.analyse), sp = b.dataset.sp || null; // the time control the panel counts, also the main one nobody picked
    window.track?.('analyse', `${name}: until ${n}${sp ? ` ${sp}` : ''}`);
    analysing = { stop: false };
    el.outerHTML = analysePanel(name, {});
    $('#pf-analyse').querySelector('[data-stop]').addEventListener('click', () => { if (analysing) analysing.stop = true; });
    try { await analyse(name, n, sp); } catch (err) { analysing = null; $('#profile-msg').textContent = err.message; }
  }));
}

// ---------- The page ----------
function cache() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
const myName = () => account()?.name || (() => { try { return JSON.parse(localStorage.getItem('opening-book-v2-lichess-name')); } catch { return null; } })();
// Your other accounts (Lichess or Chess.com), linked on your own profile: all read as you, the byline over
// the name jumps between them, and Combined reads them together, leaving out any you switch off. Kept under
// opening-book-v2 keys, so header.js syncs them to your Lichess login and every device shows the same.
const LINK_KEY = 'opening-book-v2-linked', OFF_KEY = 'opening-book-v2-off';
const readKept = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const groupOf = (name) => { const g = readKept(LINK_KEY, {})[String(name).toLowerCase()]; return Array.isArray(g) && g.length > 1 ? g : null; };
function setGroup(names) {
  const m = readKept(LINK_KEY, {});
  for (const n of names) if (names.length > 1) m[n.toLowerCase()] = names; else delete m[n.toLowerCase()];
  keep(LINK_KEY, m);
}
const linkAccount = (a, b) => setGroup([...(groupOf(a) || [a]), ...(groupOf(b) || [b])].filter((n, i, xs) => xs.findIndex((x) => same(x, n)) === i));
function unlinkAccount(n) {
  const rest = (groupOf(n) || []).filter((x) => !same(x, n));
  setGroup([n]); setGroup(rest); // one left is no group
}
const isOff = (n) => readKept(OFF_KEY, []).includes(n.toLowerCase());
const setOff = (n, off) => keep(OFF_KEY, [...readKept(OFF_KEY, []).filter((x) => x !== n.toLowerCase()), ...(off ? [n.toLowerCase()] : [])]);
const isMe = (name) => !!myName() && (groupOf(myName()) || [myName()]).some((x) => same(x, name));
// Someone else's profile reads in the third person: "you score" becomes "they score".
const they = (t) => t.replace(/\b(Y|y)our\b/g, (_, y) => (y === 'Y' ? 'Their' : 'their')).replace(/\b(Y|y)ou\b/g, (_, y) => (y === 'Y' ? 'They' : 'they'));
console.assert(they('You score 50%; your games, you were') === 'They score 50%; their games, they were', 'they');
// Look up a player on Lichess or Chess.com: the site picked last is kept.
const SITE = 'opening-book-v2-site';
const pickedCC = () => { try { return localStorage.getItem(SITE) === 'cc'; } catch { return false; } };
const search = (label) => `<div class="pf-seg pf-site" role="group" aria-label="Site">${[['li', 'Lichess'], ['cc', 'Chess.com']].map(([k, t]) => `<button type="button" data-site="${k}" aria-pressed="${(k === 'cc') === pickedCC()}">${t}</button>`).join('')}</div>
  <form id="pf-form" class="rating-row pf-search" role="search"><input id="pf-name" type="text" required maxlength="30" pattern="[A-Za-z0-9_\\-]{2,30}" placeholder="${pickedCC() ? 'Chess.com' : 'Lichess'} username" aria-label="${pickedCC() ? 'Chess.com' : 'Lichess'} username" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="ghost" type="submit">${label}</button></form>`;
function bindSearch() {
  document.querySelectorAll('[data-site]').forEach((b) => b.addEventListener('click', () => {
    try { localStorage.setItem(SITE, b.dataset.site); } catch {}
    document.querySelectorAll('[data-site]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#pf-name').placeholder = $('#pf-name').ariaLabel = `${b.textContent} username`; $('#pf-name').focus();
  }));
  $('#pf-form')?.addEventListener('submit', (e) => { e.preventDefault(); show(`${pickedCC() ? 'cc:' : ''}${$('#pf-name').value.trim()}`, true); });
}
const games = (n) => `${n} game${n === 1 ? '' : 's'}`;
// Wins, draws, losses; a row with only a score (no win count) draws as wins and losses.
const bar = (o) => { const w = o.win ?? o.score, d = o.win == null ? 0 : Math.max(0, 2 * (o.score - o.win)), l = Math.max(0, 1 - w - d);
  return `<div class="wdl" role="img" aria-label="${pct(w)} wins, ${pct(d)} draws, ${pct(l)} losses"><span class="w" style="width:${w * 100}%"></span><span class="d" style="width:${d * 100}%"></span><span class="l" style="width:${l * 100}%"></span></div>`; };
const ago = (t) => { const h = (Date.now() - t) / 3.6e6; return h < 1 ? 'less than an hour ago' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`; };
// Each opening links to its lines in the trainer (?practise=, as on My practice).
const practiseLink = (side, fam) => `./?practise=${side}~${encodeURIComponent(fam.replace(/^vs /, ''))}`;
const opLink = (side, fam) => `<a class="pf-op-link" href="${practiseLink(side, fam)}" title="Practise the ${esc(fam.replace(/^vs /, ''))} lines">${esc(fam)}</a>`;
const usualAt = (p, name) => { const m = p.speeds[0], r = m && (isCC(name) ? asLichess(m.rating, m.speed) : m.rating); return (fam, side) => (m ? expectOf(fam, side, r, m.speed) : null); };
const CATCH_ALL = /Pawn (Game|Opening)$|^(Open|Closed) Game$|Unknown/; // names for a first move, not an opening
// One row per opening: King's Gambit, its Accepted and its Declined add up, with the parts a click away.
// `usualOf` is what players at this rating score with a family. Catch-all rows are never merged, and they are
// the only ones holding a Black game twice (by byOpening), so the sums below count each game once.
// shortcut: a part under 5 games is not in p.openings, so a merged total can miss a few; count in byOpening if it shows.
function openingRows(list, side, usualOf) {
  if (!list.length) return '<p class="info">Fewer than 5 games with any one opening.</p>';
  const plain = (fam) => fam.replace(/^vs /, ''), groups = new Map();
  for (const o of list) {
    const k = CATCH_ALL.test(plain(o.fam)) ? o.fam : plain(o.fam).replace(/,.*$/, '').replace(/ (Accepted|Declined)$/, '');
    groups.set(k, [...(groups.get(k) || []), o]);
  }
  const rows = [...groups].map(([k, parts]) => {
    const n = sum(parts, (x) => x.n), known = parts.filter((x) => usualOf(plain(x.fam)) != null), kn = sum(known, (x) => x.n);
    return { k, parts, n, fam: parts.length === 1 ? parts[0].fam : blacksName(k) === (side === 'w') ? `vs ${k}` : k,
      win: sum(parts, (x) => x.win * x.n) / n, score: sum(parts, (x) => x.score * x.n) / n,
      usual: kn ? sum(known, (x) => usualOf(plain(x.fam)) * x.n) / kn : null, dim: CATCH_ALL.test(plain(parts[0].fam)) };
  }).sort((a, b) => b.n - a.n);
  if (rows.every((o) => o.dim)) rows.forEach((o) => { o.dim = false; }); // nothing to step back from
  const partName = (o, k) => (o.fam.startsWith('vs ') ? 'vs ' : '') + (plain(o.fam).slice(k.length).replace(/^[ ,:]+/, '') || 'Other replies');
  const row = (o) => `<li${o.dim ? ' class="dim"' : ''}><a class="pf-op-link" href="${practiseLink(side, o.fam)}" title="Practise the ${esc(plain(o.fam))} lines">${esc(o.fam)}</a><small>${games(o.n)} · ${pct(o.win)} wins</small>
    <div class="pf-op-bar">${bar(o)}${o.usual == null ? '' : `<em style="left:${o.usual * 100}%" title="Players at this rating usually score ${pct(o.usual)}"></em>`}</div>
    ${o.parts.length > 1 ? `<details class="pf-op-parts"><summary>By reply</summary><ul>${[...o.parts].sort((a, b) => b.n - a.n).map((x) => `<li><span>${esc(partName(x, o.k))}</span><small>${games(x.n)} · ${pct(x.win)} wins</small></li>`).join('')}</ul></details>` : ''}</li>`;
  return `<ul class="pf-rows">${[...rows.filter((o) => !o.dim).slice(0, 6), ...rows.filter((o) => o.dim).slice(0, 2)].map(row).join('')}</ul>`;
}
function fitCard(p, name) {
  const main = p.speeds[0], b = SCORES?.buckets, tab = SCORES?.[main?.speed === 'classical' ? 'classical' : 'blitz'];
  if (!main || !b || !tab) return '';
  const r = isCC(name) ? asLichess(main.rating, main.speed) : main.rating, i = b.findLastIndex((x) => x <= r);
  const at = (fam, side) => { const row = tab[fam]; return row && row[0][i] >= 500 && row[1][i] != null ? { n: row[0][i], s: side === 'w' ? row[1][i] : 1 - row[1][i] } : null; };
  const played = (side) => new Set(p.openings[side].map((o) => o.fam.replace(/^vs /, '')));
  const best = (side) => p.openings[side].filter((o) => !o.fam.startsWith('vs ') && o.n >= 8)
    .map((o) => ({ ...o, exp: expectOf(o.fam, side, r, main.speed) ?? 0.5 })).sort((x, y) => (y.score - y.exp) - (x.score - x.exp))[0];
  const tryOne = (side) => {
    const k = taste(p.styleMix?.[side])?.k, mine = played(side);
    const all = Object.keys(tab).filter((f) => blacksName(f) === (side === 'b') && !mine.has(f) && !/Unknown|Accepted|Declined|,/.test(f) && at(f, side)).map((f) => ({ fam: f, ...at(f, side), fits: kindOf(f) === k }));
    return all.sort((x, y) => (y.fits && y.s >= 0.5) - (x.fits && x.s >= 0.5) || y.s - x.s)[0]; // your taste, if it scores at least even
  };
  const pool = Object.keys(tab).filter((f) => !blacksName(f) && !/Pawn Game|Pawn Opening|Knight Opening|Unknown/.test(f) && at(f, 'w')).map((f) => ({ fam: f, n: at(f, 'w').n })).sort((x, y) => y.n - x.n);
  const total = sum(Object.values(tab), (row) => row[0][i] || 0);
  const vsMe = (f) => p.openings.b.find((o) => o.fam === `vs ${f}`);
  // The third pick: as White the best scorer at your rating you have not played; as Black the White opening
  // to prepare for, the common one (top 5) where you fall furthest under Black's usual score.
  const top = (c, skip) => Object.keys(tab).filter((f) => blacksName(f) === (c === 'b') && !played(c).has(f) && !skip.includes(f) && !/Unknown|Accepted|Declined|,/.test(f) && at(f, c))
    .map((f) => ({ fam: f, ...at(f, c) })).sort((x, y) => y.s - x.s)[0];
  const prep = () => pool.slice(0, 5).map((o) => ({ ...o, m: vsMe(o.fam), usual: 1 - at(o.fam, 'w').s }))
    .sort((x, y) => (y.m && y.m.n >= 5 ? y.usual - y.m.score : -1) - (x.m && x.m.n >= 5 ? x.usual - x.m.score : -1))[0];
  const side = (c) => { const x = best(c), t = tryOne(c);
    const third = c === 'w' ? top('w', [t?.fam]) : prep();
    return `${x ? `<li><span>Your best: ${opLink(c, x.fam)}</span><small>You score ${pct(x.score)} in ${games(x.n)}, players at your rating ${pct(x.exp)}</small></li>` : ''}
      ${t ? `<li><span>Worth a try: ${opLink(c, t.fam)}</span><small>Scores ${pct(t.s)} at your rating${t.fits ? `, and fits your taste (${KINDS.find((k) => k[0] === kindOf(t.fam))[2]})` : ''}</small></li>` : ''}
      ${!third ? '' : c === 'w' ? `<li><span>Best at your rating: ${opLink('w', third.fam)}</span><small>Scores ${pct(third.s)} for White among players rated about ${r}</small></li>`
        : `<li><span>Prepare for: ${opLink('b', `vs ${third.fam}`)}</span><small>${pct(third.n / total)} of games${third.m ? ` · you score ${pct(third.m.score)} in ${games(third.m.n)}, Black usually ${pct(third.usual)}` : ' · not in your games yet'}</small></li>`}`; };
  return `<section class="pf-card pf-fit"><div class="pf-more-head"><h2>Openings for you</h2><span>Against players rated about ${r} on Lichess</span></div>
    <div class="pf-two"><section><h3>As White</h3><ul class="pf-rows">${side('w')}</ul></section>
    <section><h3>As Black</h3><ul class="pf-rows">${side('b')}</ul></section></div></section>`;
}
// Each bar: what it measures, what the games show, and below 50 how to train it; the words show on request.
let showSkillText = !matchMedia('(max-width: 640px)').matches; // what each skill measures: open from the start, folded on phones (a wall of text there)
function skillBars(skills, say, me) {
  return `<ul class="pf-skills">${skills.map((x) => `<li${x.v === null ? ' class="pf-skill-none"' : ''}>
      <span class="pf-skill-name">${x.label}</span><span class="pf-skill-val">${x.v ?? '–'}</span>
      <div class="pf-meter" style="--even:${x.level ?? 50}%" title="The mark: ${x.level ?? 50}, as good as ${me ? 'your' : 'their'} opponents" role="img" aria-label="${x.label}: ${x.v === null ? 'not enough games' : `${x.v} of 100, ${x.level ?? 50} is as good as the opponents`}"><i style="width:${x.v ?? 0}%"></i></div>
      ${x.v === null && x.needs ? `<small class="pf-skill-lock">Unlocks at ${x.unlockAt} analysed games</small>` : ''}
      ${x.v === null && x.label === 'Early game' ? `<small class="pf-skill-lock" id="pf-early-msg">Needs ${EARLY_MIN} games against opponents near ${me ? 'your' : 'their'} rating that reach move 12</small>` : ''}
      <div class="pf-skill-more"><p class="pf-means">${esc(x.means)}</p>
      <small>${x.v === null ? 'Not enough games to say.' : esc(say(x.why))}</small>
      ${x.raw !== null && x.raw <= 45 ? `<p class="pf-train"><b>How to train:</b> ${esc(x.train)}${me && x.href ? ` <a href="${x.href}">Start</a>` : ''}</p>` : ''}</div></li>`).join('')}</ul>`;
}
// Which kind of opening each side mostly picks: the top style when it is a quarter or more of them.
const taste = (m) => (m && m.n >= 10 ? m.parts.find((x) => x.k !== 'other' && x.share >= 0.25) || null : null);
// Enough games on that side but no kind stands out: say so, rather than leave the side out.
const tasteOrMixed = (m) => taste(m) || (m?.n >= 10 ? { label: 'Mixed', share: null } : null);
function tasteLine(mix, me) {
  // Both sides always: under 10 games the side chose itself (1.e4 players' games are mostly named after Black's reply), say that.
  const of = (m) => tasteOrMixed(m) || { label: 'Too few', few: m?.n || 0 };
  const w = of(mix?.w), b = of(mix?.b);
  const tile = (x, c, side) => `<div class="pf-taste-tile"><img src="pieces/${c}K.svg" alt=""><span><small>Openings as ${side}</small><b>${x.label}</b><small>${x.few !== undefined ? `${x.few} of 10 games needed` : x.share === null ? 'no one kind stands out' : `${pct(x.share)} of ${me ? 'your' : 'their'} choices`}</small></span></div>`;
  return `<div class="pf-taste-tiles" aria-label="Opening taste">${tile(w, 'w', 'White')}${tile(b, 'b', 'Black')}</div>`;
}
// How games end: wins and losses split by mate, resignation and time, as numbers with a small bar each.
// The leak: the worst skill clearly below the player's opponents (45 or less); 46–55 is noise.
const leakOf = (skills) => skills.filter((x) => x.raw !== null && x.raw <= 45).sort((a, b) => a.raw - b.raw)[0] || null;

// A portrait in words, from this player's own games: the openings they actually choose, how their
// games end, their best piece, and the area that lifts or holds them back. No two read the same.
function portrait(name, p, skills, me, part = 'lead') {
  const you = me ? 'You' : esc(nick(name)), your = me ? 'your' : 'their', are = me ? 'are' : 'is';
  // The openings chosen, by family: the King's Gambit Accepted and Declined are one King's Gambit.
  // The openings a player chooses, as a reader would name them, by their first move: each first move
  // (as Black, each answer to White's first move) played in at least 15% of the games with that colour,
  // most played first, named by their own opening that starts so (6% of the games or more: the Italian
  // for 1.e4), else broadly (the King's Pawn Opening, the Open Game). A move played now and then (1.e3 in
  // 7% of games) is not their choice, however it compares with a named opening that needs 1...e5 first.
  const sideN = { w: p.nWhite ?? p.n / 2, b: p.n - (p.nWhite ?? p.n / 2) };
  const own = (list, side) => {
    const key = (o) => (side === 'w' ? o.first : o.first?.split(' ')[0]) || '?';
    const total = {};
    for (const o of list) if (!ANSWERS.includes(o.fam)) total[key(o)] = (total[key(o)] || 0) + o.n;
    return Object.entries(total).filter(([, n]) => n >= sideN[side] * 0.15).sort((a, b) => b[1] - a[1]).map(([k]) => {
      const mine = list.filter((o) => key(o) === k && !o.fam.startsWith('vs '));
      const named = mine.filter((o) => !ANSWERS.includes(o.fam) && o.n >= sideN[side] * 0.06).sort((a, b) => b.n - a.n)[0];
      return named || mine.find((o) => ANSWERS.includes(o.fam));
    // White's King's Gambit, accepted or not, is one; Black's Queen's Gambit Declined keeps its name.
    }).filter(Boolean).map((o) => (side === 'w' ? o.fam.replace(/ (Accepted|Declined)$/, '') : o.fam)).filter((f, i, a) => a.indexOf(f) === i).slice(0, 2).map((f) => opLink(side, f));
  };
  const w = own(p.openings.w, 'w'), b = own(p.openings.b, 'b');
  const and = (xs) => xs.join(' and ');
  const out = [];
  const t = p.type.map((x) => x.name.toLowerCase());
  out.push(`${you} ${are} ${article(t[0])} ${t[0]}${t[1] ? ` ${{ 'well prepared': 'who comes well prepared', 'killer instinct': 'with a killer instinct', 'sure hand': 'with a sure hand' }[t[1]] || `with a ${t[1]}'s streak`}` : ''}${w.length || b.length ? `, reaching for ${[w.length && `the ${and(w)} as White`, b.length && `the ${and(b)} as Black`].filter(Boolean).join(' and ')}` : ''}.`);
  const known = skills.filter((x) => x.v !== null).sort((a, b) => b.v - a.v);
  const leak = leakOf(skills);
  const named = (x) => ({ 'Early game': 'the early game', 'Late game': 'the late game' }[x.label || x.title] || (x.label || x.title).toLowerCase());
  if (known.length >= 2) out.push(`${me ? 'Your' : 'Their'} game is carried by ${named(known[0])}${leak ? ` and held back most by ${named(leak)}` : `, and ${me ? 'you match your' : 'they match their'} opponents everywhere else`}.`);
  if (part === 'lead') return out.join(' ');
  out.length = 0;
  const games = p.pieceAuto ?? p.piece; // what the games say, whatever piece the card shows
  if (games) out.push(`${me ? 'Your' : 'Their'} most important piece is the ${PIECE_NAME[games]}.`);
  return out.join(' ');
}
// The player card: the overall (the mean of the known skills), a short code for the type, the six skills.
// The piece is drawn white for the black card; in dark mode, where the card is cream, CSS inverts it.
const CARD_INK = 'w';
const PIECE_NAME = { n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king', p: 'pawn' };
// The card's picture is coloured by rating (bandColor, below), on the page and in the downloaded image.
// The card's colour goes from cold to warm as the rating rises, as rating colours usually do (grey,
// green, teal, blue, violet, orange, red, deep red), every 300 points from 800, with gold for the elite.
const TIERS_AT = [[0, 'Grey', '#858a91'], [800, 'Green', '#3f9a4e'], [1100, 'Teal', '#1aa3a8'], [1400, 'Blue', '#3a74d0'], [1700, 'Violet', '#8a4fd0'],
  [2000, 'Orange', '#e2711c'], [2300, 'Red', '#d63a3a'], [2600, 'Deep red', '#a8122a'], [2900, 'Elite', '#d4a017']];
const tierOf = (r) => TIERS_AT.findLastIndex(([at]) => (r || 1500) >= at);
const bandColor = (r) => TIERS_AT[tierOf(r)][2];
// The rating the band is coloured by: a chess.com rating as the Lichess one of the same strength.
const level = (name, main) => (isCC(name) ? asLichess(main?.rating, main?.speed) : main?.rating);
console.assert(bandColor(1226) === '#1aa3a8' && bandColor(3263) === '#d4a017' && bandColor(500) === '#858a91' && tierOf(1400) === 3, 'bandColor');
const darker = (hex) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.78).toString(16).padStart(2, '0')).join('')}`; // as CSS's 78% mix with black
// The six skills as bars, so a player's shape reads before the numbers; [label, value] pairs.
const LOCK = '<svg class="pf-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const cardBars = (xs, on = null) => `<div class="pf-pcard-bars">${xs.map(([k, v]) => `<div class="${[k === on && 'on', v == null && 'locked'].filter(Boolean).join(' ')}"><span>${k}</span><i style="--v:${v ?? 0}%"></i><b${v == null ? ' title="Locked: not enough games for this yet"' : ''}>${v ?? LOCK}</b></div>`).join('')}</div>`;
const ABBR = { Attack: 'ATK', Defense: 'DEF', 'Early game': 'EARLY', 'Late game': 'LATE', Accuracy: 'ACC', Speed: 'SPD' };
// The card in a few characters, so the admin page can draw it from a download event (80 characters at
// most): overall/style/strength/the six skills/rating and time control/piece, the types by their place in
// these lists. Only add to the ends of the lists: older events point into them.
const TYPE_CODES = ['Striker', 'Guardian', 'Solid builder', 'Endgame artist', 'Time scrambler', 'Trickster', 'Specialist', 'Explorer', 'Marathoner', 'Houdini',
  'Killer instinct', 'Well prepared', 'Grinder', 'Sure hand', 'Speed demon', 'Clutch player', 'Giant killer', 'White specialist', 'Black specialist', 'Fighter', 'Finisher'];
function cardCode(p, t, skills) {
  const known = skills.filter((x) => x.v !== null), main = p.speeds[0];
  const ovr = known.length ? Math.round(sum(known, (x) => x.v) / known.length) : '-';
  return [ovr, TYPE_CODES.indexOf(t[0]?.name), t[1] ? TYPE_CODES.indexOf(t[1].name) : '', skills.map((x) => x.v ?? '-').join('.'), main ? `${main.rating}${main.speed.slice(0, 2)}` : '', p.piece || 'n'].join('/');
}
// ---------- Pros ----------
// Known professional players' accounts, from pros.js (checked: the name on the account, or widely known, as
// Magnus Carlsen's DrNykterstein): their cards wear a gold PRO frame wherever they show. Looked up in lower case.
const PRO_NAMES = Object.fromEntries(PEOPLE.filter(([, , k]) => k === 'pro').map(([a, w]) => [a, w]));
const PROS = new Map(Object.entries(PRO_NAMES).map(([k, v]) => [k.toLowerCase(), v]));
// On a pro's profile, under the name: who the account belongs to.
const proLine = (name) => {
  const who = proOf(name), title = /^(GM|IM) /.test(who || '') ? who.split(' ')[0] : '';
  return who ? `<p class="pf-pro-line ${proKind(name)}"><span class="pf-pro-tag">${proKind(name).toUpperCase()}</span><b>${esc(who.replace(/^(GM|IM) /, ''))}</b>${title ? `<span class="pf-pro-title">${title}</span>` : ''}</p>` : '';
};
// Known streamers and chess creators (checked the same way): a VIP frame instead.
const VIP_NAMES = Object.fromEntries(PEOPLE.filter(([, , k]) => k === 'vip').map(([a, w]) => [a, w]));
// A few words on each person, shown on their profiles with what their games show: where from, and what
// they are known for. Keyed by the name in PRO_NAMES / VIP_NAMES without the title.
const BIOS = {
  'Magnus Carlsen': ['Norway', 'World Champion from 2013 to 2023, with the highest classical rating ever reached (2882).'],
  'Hikaru Nakamura': ['the United States', 'Five-time US champion, one of the strongest blitz and bullet players ever, and the most-watched chess streamer.'],
  'Alireza Firouzja': ['France (born in Iran)', 'In 2021, at 18, the youngest player ever to pass a 2800 rating.'],
  'Nihal Sarin': ['India', 'Grandmaster at 14, and among the fastest blitz and bullet players online.'],
  'Andrew Tang': ['the United States', 'A grandmaster known above all for bullet, where he is among the very best.'],
  'Sergei Zhigalko': ['Belarus', 'A grandmaster and one of the most active top blitz players on Lichess.'],
  'Dmitry Andreikin': ['Russia', 'A grandmaster who reached the final of the 2013 World Cup.'],
  'Aleksei Sarana': ['Russia', 'A grandmaster and one of the strongest blitz players on Lichess.'],
  'Oleksandr Bortnyk': ['Ukraine', 'A grandmaster and streamer, known for blitz and bullet.'],
  'Vladislav Artemiev': ['Russia', 'A grandmaster and one of the strongest rapid and blitz players in the world.'],
  'Anish Giri': ['the Netherlands', 'The Dutch number one for more than a decade; won Tata Steel Masters in 2023.'],
  'Daniel Naroditsky': ['the United States', 'A grandmaster, coach and commentator, loved for his speedrun videos. He died in October 2025, aged 29.'],
  'Eric Rosen': ['the United States', 'An International Master and streamer, famous for his traps.'],
  'John Bartholomew': ['the United States', 'An International Master who teaches the game on YouTube with Chess Fundamentals.'],
  'Fabiano Caruana': ['the United States', 'World Championship challenger in 2018 and several times US champion.'],
  'Ian Nepomniachtchi': ['Russia', 'Played two World Championship matches, in 2021 and 2023.'],
  'Levon Aronian': ['the United States (long for Armenia)', 'Long a world top-five player; led Armenia to three Olympiad gold medals.'],
  'Daniil Dubov': ['Russia', 'World Rapid Champion in 2018, known for wild opening ideas.'],
  'Benjamin Bok': ['the Netherlands', 'A grandmaster and streamer.'],
  'Jose Martinez': ['Peru', 'A grandmaster and one of the best bullet players online.'],
  'Robert Hess': ['the United States', 'A grandmaster and one of Chess.com’s best-known commentators.'],
  'Antonio Radić': ['Croatia', 'Runs agadmator’s Chess Channel, for years the biggest chess channel on YouTube.'],
  'Valeri Lilov': ['Bulgaria', 'An International Master who teaches chess on YouTube.'],
  'Levy Rozman': ['the United States', 'An International Master behind GothamChess, the most-subscribed chess channel on YouTube.'],
  'Anna Cramling': ['Sweden', 'A streamer and Woman FIDE Master, daughter of grandmasters Pia Cramling and Juan Manuel Bellón.'],
  'Alexandra Botez': ['Canada and the United States', 'A Woman FIDE Master and streamer, who started BotezLive with her sister Andrea.'],
  'Andrea Botez': ['Canada and the United States', 'A streamer, who started BotezLive with her sister Alexandra.'],
  'Nemo Zhou': ['Canada', 'A Woman Grandmaster and streamer.'],
  'Eric Hansen': ['Canada', 'A grandmaster and one of the founders of Chessbrah.'],
  'Jerry (ChessNetwork)': ['the United States', 'A National Master who has taught chess on YouTube as ChessNetwork since 2007.'],
  'Zachary Saine': [null, 'A commentator and YouTuber behind The Chess Nerd.'],
};
// Under the pro line: the bio, then what the games on this card show (the style and the main openings).
const proBio = (name, p) => {
  const who = proOf(name)?.replace(/^(GM|IM) /, ''), b = who && BIOS[who];
  if (!b) return '';
  const top = (l) => l?.[0]?.fam.replace(/^vs /, ''), w = top(p.openings?.w), bl = top(p.openings?.b), t = p.type || [];
  const plays = [w && `the ${w} as White`, bl && `the ${bl} as Black`].filter(Boolean).join(' and ');
  return `<p class="pf-bio">${b[0] ? `From ${esc(b[0])}. ` : ''}${esc(b[1])}${t[0] ? ` Style in these games: <b>${esc(t[0].name)}</b>${t[1] ? ` with ${esc(t[1].name.toLowerCase())}` : ''}.` : ''}${plays ? ` Plays mostly ${esc(plays)}.` : ''}</p>`;
};
const VIPS = new Map(Object.entries(VIP_NAMES).map(([k, v]) => [k.toLowerCase(), v]));
const proOf = (name) => PROS.get(String(name).toLowerCase()) || VIPS.get(String(name).toLowerCase()) || null;
const proKind = (name) => (PROS.has(String(name).toLowerCase()) ? 'pro' : VIPS.has(String(name).toLowerCase()) ? 'vip' : '');
// Under it, the account's site and the same person's other accounts as buttons, the one shown pressed;
// each account keeps its own card. Anyone else gets the site alone, so it is always clear which one this is.
const accountsRow = (name) => {
  const who = proOf(name), all = Object.entries({ ...PRO_NAMES, ...VIP_NAMES }), group = !who && isMe(name) && groupOf(myName());
  const others = who ? all.filter(([n, w]) => w === who && (combo || !same(n, name))).map(([n]) => n) : group ? group.filter((n) => combo || !same(n, name)) : [];
  if (!others.length) return linkForm(name); // only there to jump between one player's accounts
  const pill = (n, on) => `<a class="pf-acct" data-name="${esc(n)}" href="${profileLink(n)}"${on ? ' aria-current="page"' : ''}><small>${siteOf(n)}</small>${esc(nick(n))}</a>`;
  // A pro's accounts in one order wherever you are among them: the one played on last first (index.json).
  const pills = who ? [...new Set([name, ...others].map((n) => all.find(([x]) => same(x, n))?.[0] || n))].sort((a, b) => (LAST[b.toLowerCase()] || 0) - (LAST[a.toLowerCase()] || 0))
    .filter((n) => !combo || others.some((x) => same(x, n))).map((n) => pill(n, !combo && same(n, name))) : [...(combo ? [] : [pill(name, true)]), ...others.map((n) => pill(n, false))];
  // A pro's accounts on both sites can be seen together too, like your own.
  const both = group || (who && others.some((n) => isCC(n) !== isCC(name)) || combo) ? `<a class="pf-acct pf-acct-all" href="${profileLink(group ? myName() : name)}&all=1"${combo ? ' aria-current="page"' : ''}><small>All</small>Combined</a>` : '';
  return `<nav class="pf-accts" aria-label="${group ? 'Your accounts' : 'Their accounts'}">${pills.join('')}<details class="pf-accts-more" hidden><summary></summary><div class="pf-accts-menu"></div></details>${both}</nav>`;
};
// On your own profile: add an account on either site, by name (no password).
const linkForm = (name, open = false) => (isMe(name) && !proOf(name) ? `<form class="pf-link" data-link><label for="pf-link-in">${open ? 'Add an account:' : 'Play on another account too?'}</label>
  <select name="site" aria-label="Site"><option value="cc"${isCC(name) ? '' : ' selected'}>Chess.com</option><option value="li"${isCC(name) ? ' selected' : ''}>Lichess</option></select>
  <input id="pf-link-in" name="u" autocomplete="off" spellcheck="false" placeholder="Username" required><button type="submit" class="ghost">Link</button><span class="pf-link-msg" role="status"></span>${account() ? '' : '<small class="pf-link-note">Kept in this browser only: <button type="button" class="link" data-link-login>log in</button> to have it on every device.</small>'}</form>` : '');
document.addEventListener('click', (e) => { if (e.target.closest('[data-link-login]')) openLogin(); });
// On Combined: which accounts count, each switched on or off (a game account you play badly on stays out), or unlinked.
const comboRow = () => `<div class="pf-combo"><p class="pf-combo-k">Counts the games of</p><div class="pf-combo-list">${combo.map((n) => `<span class="pf-combo-acct">
  <button type="button" data-off="${esc(n)}" aria-pressed="${!isOff(n)}"><i aria-hidden="true"></i><small>${siteOf(n)}</small>${esc(nick(n))}</button>${same(n, myName()) ? '' : `<button type="button" class="link" data-unlink="${esc(n)}" aria-label="Unlink ${esc(nick(n))}" title="Unlink">×</button>`}</span>`).join('')}</div>${linkForm(myName(), true)}</div>`;
document.addEventListener('submit', async (e) => {
  if (!e.target.matches('[data-link]')) return;
  e.preventDefault();
  const typed = e.target.u.value.trim().replace(/^cc:/i, ''), msg = e.target.querySelector('.pf-link-msg'), cc = e.target.site.value === 'cc';
  if (!shown || !typed) return;
  msg.textContent = 'Checking…';
  const other = cc ? `cc:${typed}` : typed;
  const ok = cc ? !!(await ccUser(other)) : await fetch(`https://lichess.org/api/user/${encodeURIComponent(typed)}`).then((r) => r.ok).catch(() => false);
  if (!ok) { msg.textContent = `No ${siteOf(other)} player called ${typed}.`; return; }
  if ((groupOf(myName()) || [myName()]).some((n) => same(n, other))) { msg.textContent = 'Already linked.'; return; }
  linkAccount(myName(), other);
  combo ? combined(myName()) : render(...shown);
});
document.addEventListener('click', (e) => {
  const off = e.target.closest('[data-off]'), un = e.target.closest('[data-unlink]');
  if (off) { setOff(off.dataset.off, !isOff(off.dataset.off)); return void combined(myName()); }
  if (!un || !confirm(`Unlink ${siteOf(un.dataset.unlink)} · ${nick(un.dataset.unlink)}?`)) return;
  unlinkAccount(un.dataset.unlink);
  groupOf(myName()) ? combined(myName()) : (location.href = profileLink(myName()));
});
// One row, never scrolling: the accounts that do not fit (from the end, never the one shown) move to a +N menu.
function fitAccounts() {
  const nav = $('.pf-accts'), more = nav?.querySelector('.pf-accts-more');
  if (!more) return;
  const pills = [...nav.querySelectorAll(':scope > .pf-acct[data-name]')];
  pills.forEach((x) => { x.hidden = false; });
  more.hidden = true;
  if (nav.scrollWidth <= nav.clientWidth) return;
  more.hidden = false;
  more.querySelector('summary').textContent = `+${pills.length}`; // widest it gets, while measuring
  for (let i = pills.length - 1; i > 0 && nav.scrollWidth > nav.clientWidth; i--) if (!pills[i].hasAttribute('aria-current')) pills[i].hidden = true;
  const hid = pills.filter((x) => x.hidden);
  more.querySelector('summary').textContent = `+${hid.length}`;
  more.querySelector('summary').setAttribute('aria-label', `${hid.length} more accounts`);
  more.querySelector('.pf-accts-menu').innerHTML = hid.map((x) => x.outerHTML.replace(' hidden=""', '')).join('');
}
addEventListener('resize', fitAccounts);
let trendResize = 0;
addEventListener('resize', () => { clearTimeout(trendResize); trendResize = setTimeout(() => { if (shown && $('#pf-trend')) trendCard(shown[2]); }, 200); });
// When each account was last on its site (Lichess's seenAt, chess.com's last_online), for the order.
const SEEN = new Map();
async function seenOf(names) {
  await loadFlags(names);
  await Promise.all(names.filter((n) => isCC(n) && !SEEN.has(n.toLowerCase())).map((n) => fetch(`https://api.chess.com/pub/player/${encodeURIComponent(nick(n).toLowerCase())}`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null).then((u) => SEEN.set(n.toLowerCase(), (u?.last_online || 0) * 1000))));
}
// The other accounts, the one played on most recently first; then fitted to the row.
async function arrangeAccounts() {
  fitAccounts();
  if (shown && proOf(shown[0])) return; // a pro's come in order already
  const nav = $('.pf-accts'), pills = nav ? [...nav.querySelectorAll(':scope > .pf-acct[data-name]')].slice(combo ? 0 : 1) : [];
  if (!pills.length) return;
  await seenOf(pills.map((x) => x.dataset.name));
  if (!nav.isConnected) return;
  const at = (x) => SEEN.get(x.dataset.name.toLowerCase()) || 0;
  pills.sort((a, b) => at(b) - at(a)).forEach((x) => nav.insertBefore(x, nav.querySelector('.pf-accts-more')));
  fitAccounts();
}
const proClass = (name) => (proKind(name) ? ` ${proKind(name)}` : '');
// For the player search's suggestions (header.js): the known accounts, found by the person's name too.
window.knownPlayers = Object.entries({ ...PRO_NAMES, ...VIP_NAMES }).map(([name, who]) => ({ id: name.toLowerCase(), name, who: who.replace(/^(GM|IM) /, ''), title: /^(GM|IM) /.exec(who)?.[1] || null, kind: proKind(name) }));
// ---------- Flags ----------
// A player's country flag from their Lichess profile, as a sticker on the card's corner; none without
// one. Lichess's other flags (_earth, _rainbow…) get no sticker. Images from flag-icons (MIT).
const FLAGS = new Map(); // lower-case name → 'se', 'gb-eng'… or null
const flagCode = (f) => (/^[A-Z]{2}(-[A-Z]{3})?$/i.test(f || '') ? f.toLowerCase() : null);
const flagSrc = (c) => `https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/${c}.svg`;
const flagHtml = (name) => { const c = FLAGS.get(String(name).toLowerCase()); return c ? `<span class="pf-flag" style="background-image:url(${flagSrc(c)})" aria-hidden="true"></span>` : ''; };
console.assert(flagCode('SE') === 'se' && flagCode('GB-ENG') === 'gb-eng' && flagCode('_earth') === null && flagCode(undefined) === null, 'flagCode');
// Many players at once (Lichess answers up to 300 a call), for lists of cards.
async function loadFlags(names) {
  const todo = [...new Set(names.map((n) => String(n).toLowerCase()))].filter((n) => !FLAGS.has(n) && !isCC(n)); // a chess.com player's comes with perfsOf
  for (let i = 0; i < todo.length; i += 300) {
    const part = todo.slice(i, i + 300);
    const users = await fetch('https://lichess.org/api/users', { method: 'POST', body: part.join(',') }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    part.forEach((n) => FLAGS.set(n, null));
    for (const u of users) { FLAGS.set(u.id, flagCode(u.profile?.flag)); SEEN.set(u.id, u.seenAt || 0); }
  }
}
// The flag as an image for the downloaded cards (null without one).
const flagImage = (name) => { const c = FLAGS.get(String(name).toLowerCase()); return c ? new Promise((ok) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = flagSrc(c); }) : Promise.resolve(null); };
// The site the rating is from, under it in small text, so 1221 on Lichess is not read as Chess.com.
// A Combined card with games from both sites has no single site, so no line.
const bothSites = () => !!combo && combo.some(isCC) && combo.some((n) => !isCC(n));
const siteName = (name) => bothSites() ? '' : isCC(name) ? 'chess.com' : 'lichess';
// A pro's Combined card is the person, not one of their accounts.
const cardName = (name) => (combo && !comboOwn && proOf(name)?.replace(/^(GM|IM) /, '')) || nick(name);
// Sharing your own card (supporters and admins while it is tried out): X and Reddit with the text written,
// a link for Discord (which shows the card), the phone's own share sheet, and a link that dares a friend
// to compare: it opens the compare page with you on one side and their name to type on the other.
const cardUrl = (name) => `https://chesslabs.gg/profile?u=${encodeURIComponent(nick(name))}`;
const shareText = (t) => `I'm a ${t[0].name}${t[1] ? ` + ${t[1].name}` : ''} on Chess Labs. What's your chess style?`;
function shareHtml(name, t) {
  const url = encodeURIComponent(cardUrl(name)), text = encodeURIComponent(shareText(t));
  return `<details class="pf-dl pf-share"><summary title="Share your card" aria-label="Share your card"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5M5 14v5h14v-5"/></svg>Share</summary>
    <div class="pf-dl-menu" role="group" aria-label="Share">
      <button type="button" data-share="friend">Compare with a friend</button>
      <a data-share="x" href="https://twitter.com/intent/tweet?text=${text}&url=${url}" target="_blank" rel="noopener">Share on X</a>
      <a data-share="reddit" href="https://www.reddit.com/submit?url=${url}&title=${text}" target="_blank" rel="noopener">Share on Reddit</a>
      <button type="button" data-share="discord" title="Copies the link; pasted in Discord it shows your card">Copy link for Discord</button>
      ${navigator.share ? '<button type="button" data-share="more">More…</button>' : ''}
      ${window.earlyAccess?.() ? '<button type="button" data-share="wanted">Wanted poster: your nemesis</button>' : ''}
      <p class="pf-share-note" aria-live="polite"></p>
    </div></details>`;
}
function bindShare(name, t) {
  const box = document.querySelector('.pf-share'); if (!box) return;
  const note = box.querySelector('.pf-share-note');
  const copy = async (url, say) => { try { await navigator.clipboard.writeText(url); note.textContent = say; } catch { prompt('Copy the link', url); } };
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-share]'); if (!b) return;
    const k = b.dataset.share; window.track?.('card', `${nick(name)} · share ${k}`);
    if (['x', 'reddit', 'more'].includes(k)) box.open = false;
    if (k === 'wanted') { const r = RIVALS.get(name)?.find((x) => x.n >= NEMESIS_MIN && x.score < 0.5); return r ? wantedPng(name, r, b) : (note.textContent = 'No nemesis yet: nobody you met 5 times or more does better than you.'); }
    if (k === 'discord') copy(cardUrl(name), 'Link copied. Paste it in Discord and it shows your card.');
    if (k === 'more') navigator.share({ title: 'Chess Labs', text: shareText(t), url: cardUrl(name) }).catch(() => {});
    if (k === 'friend') {
      const url = `https://chesslabs.gg/${pickLink(nick(name))}`;
      if (navigator.share) navigator.share({ title: 'Chess Labs', text: `Compare your chess style with mine on Chess Labs`, url }).catch(() => copy(url, 'Link copied. Send it to a friend.'));
      else copy(url, 'Link copied. Send it to a friend.');
    }
  });
}
function playerCard(name, p, t, skills) {
  const known = skills.filter((x) => x.v !== null);
  const ovr = known.length ? Math.round(sum(known, (x) => x.v) / known.length) : '–';
  const main = p.speeds[0];
  return `<div class="pf-pcard${proClass(name)}" data-player="${esc(name.toLowerCase())}" style="--band:${bandColor(level(name, main))}" role="img" aria-label="Player card: overall ${ovr}, ${t[0].name}${t[1] ? ` + ${t[1].name}` : ''}, ${known.map((x) => `${x.label} ${x.v}`).join(', ')}">${flagHtml(name)}
    <div class="pf-pcard-top"><div><b class="pf-ovr">${ovr}</b><span class="pf-pos">${esc(t[0].name)}</span>${t[1] ? `<span class="pf-str">+ ${esc(t[1].name)}</span>` : ''}</div>
      <div class="pf-pcard-side"><img class="pf-pcard-piece ink-on-light" src="pieces/b${(p.piece || 'n').toUpperCase()}.svg" alt="" aria-hidden="true"><img class="pf-pcard-piece ink-on-dark" src="pieces/${CARD_INK}${(p.piece || 'n').toUpperCase()}.svg" alt="" title="${esc(nick(name))}'s most important piece: the ${PIECE_NAME[p.piece || 'n']}, ${p.pieceWhy === 'chosen' ? `chosen by ${esc(nick(name))}` : p.pieceWhy === 'best' ? `the piece played best, with the fewest mistakes and blunders per move in the analysed games` : 'the piece that does the most in these games (analyse 20 games to see the one played best)'}">
        ${main ? `<span class="pf-pcard-rating">${main.rating} <small>${main.speed}</small></span>${siteName(name) ? `<span class="pf-pcard-site">${siteName(name)}</span>` : ''}` : ''}${p.also ? `<span class="pf-pcard-rating2">${p.also.rating} <small>${p.also.site}</small></span>` : ''}</div></div>
    <p class="pf-pcard-name">${esc(cardName(name))}</p>
    ${cardBars(skills.map((x) => [ABBR[x.label], x.v]))}
    <p class="pf-pcard-foot">${main ? `VS ${main.rating - PEER}–${main.rating + PEER} · ` : ''}${p.n} ${main && p.speeds.length === 1 ? `${main.speed.toUpperCase()} ` : ''}GAMES</p>
    <p class="pf-pcard-brand">chesslabs.gg</p>
  </div>`;
}
// Where a rating ranks among all Lichess players of that time control this week: "Top 27%".
// The card explained in one go, under it.
// The player card as an image to save or share, drawn from the numbers at a fixed size so it looks
// the same from a phone or a computer. "Card + style" adds the player type, the openings and the portrait.
// Two looks to download, picked in the menu: dark (black card on cream) and light (cream card on black).
// On the cream card the rating colours are a shade darker, as on the page (BAND).
const CARDS = {
  dark: { bg: '#141414', ink: '#f4efe6', muted: '#a8a093', line: '#3d3730', hot: '#ff5a1f', paper: '#e6dfd1', paperInk: '#141414', paperMuted: '#62594c', piece: 'w', band: (r) => bandColor(r) },
  light: { bg: '#f4efe6', ink: '#141414', muted: '#62594c', line: '#d3c8b3', hot: '#c2410c', paper: '#1b1815', paperInk: '#f4efe6', paperMuted: '#a8a093', piece: 'b', band: (r) => darker(bandColor(r)) },
};
let CARD = CARDS.dark;
const cardLook = () => { try { return localStorage.getItem('chess-trainer-card-look') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };
const fit = (ctx, text, font, size, max) => { let z = size; do { ctx.font = font.replace('#', z); } while (ctx.measureText(text).width > max && --z > 10); return z; };
// Text in lines of at most max wide; the first line can start indented (after a bold lead-in).
function wrap(ctx, text, x, y, max, lh, lines = 99, indent = 0) {
  const words = text.split(' '); let line = '', n = 0;
  const put = (t) => { ctx.fillText(t, n ? x : x + indent, y); y += lh; n++; };
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width > max - (n ? 0 : indent) && line) {
      if (n + 1 === lines) { put(`${line}…`); return y; }
      put(line); line = words[i];
    } else line = next;
  }
  if (line) put(line);
  return y;
}
// A supporter's frame (supporter.js puts it around the card on the page as .sup-fx.fx-<name>), still, for
// the image: [kind, colours, glow]. 14 units out from the card, as the page's 7px around a 300px card.
const RAINBOW = ['#ff4d6d', '#ffb84d', '#f9f871', '#5cf2a6', '#4dc9ff', '#a96bff', '#ff4d6d'];
const FX = {
  holo: ['conic', RAINBOW], prism: ['linear', RAINBOW], tilt: ['conic', RAINBOW],
  chrome: ['conic', ['#5b5f66', '#f4f6f8', '#8a8f97', '#2f3236', '#e9ecef', '#5b5f66']],
  gold: ['conic', ['#7a5410', '#f7d774', '#b8871f', '#fff3c4', '#9c6b12', '#f7d774', '#7a5410'], '#e0b23a'],
  ice: ['linear', ['#e8fbff', '#7fd4f5', '#bdf0ff', '#4fb8e0', '#e8fbff'], '#7fd4f5'],
  lava: ['linear', ['#ff2d00', '#ff8a00', '#ffd000', '#ff4500', '#ff2d00'], '#ff4500'],
  galaxy: ['linear', ['#8b5cf6', '#1e1b4b', '#ec4899', '#1e1b4b', '#22d3ee'], '#8b5cf6'],
  oil: ['linear', ['#ffd1dc', '#c1f0ff', '#e2ffd1', '#f0d1ff', '#ffd1dc'], '#c1f0ff'],
  neon: ['line', ['#ff6a2f'], '#ff6a2f'], glitch: ['line', ['#ff6a2f']],
};
const fxOf = (name) => FX[document.querySelector(`.sup-fx > .pf-pcard[data-player="${CSS.escape(name.toLowerCase())}"]`)?.parentElement.className.match(/fx-(\w+)/)?.[1]];
function drawFrame(ctx, [kind, cs, glow]) {
  ctx.save();
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 60; }
  if (kind === 'line') { // neon and glitch: a line, glitch's with a pink and a cyan copy beside it
    ctx.lineWidth = 6;
    if (!glow) [['#ff00ea', -6], ['#00f0ff', 6]].forEach(([c, dx]) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.roundRect(-12 + dx, -12, 624, 804, 18); ctx.stroke(); });
    ctx.strokeStyle = cs[0]; ctx.beginPath(); ctx.roundRect(-12, -12, 624, 804, 18); ctx.stroke();
  } else {
    const g = kind === 'conic' ? ctx.createConicGradient(0, 300, 390) : ctx.createLinearGradient(-14, -14, 614, 794);
    cs.forEach((c, i) => g.addColorStop(i / (cs.length - 1), c));
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(-14, -14, 628, 808, 20); ctx.fill();
  }
  ctx.restore();
}
// One card, 600 x 780 units, top left at (x, y).
// k (0 to 1): how far the numbers and bars have counted up, for the video (cardVideo); 1 is the card as it is.
function drawCard(ctx, x, y, name, p, t, skills, piece, flag = null, k = 1) {
  const known = skills.filter((s) => s.v !== null), ovr = known.length ? String(Math.round(k * sum(known, (s) => s.v) / known.length)) : '–', main = p.speeds[0];
  const band = CARD.band(level(name, main));
  ctx.save(); ctx.translate(x, y);
  if (fxOf(name)) drawFrame(ctx, fxOf(name));
  ctx.fillStyle = CARD.bg; ctx.beginPath(); ctx.roundRect(0, 0, 600, 780, 10); ctx.fill();
  ctx.fillStyle = band; ctx.beginPath(); ctx.roundRect(0, 0, 600, 14, [10, 10, 0, 0]); ctx.fill();
  ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = '0px';
  ctx.fillStyle = band; ctx.font = '400 150px Anton'; ctx.fillText(ovr, 40, 185);
  ctx.fillStyle = CARD.ink; fit(ctx, t[0].name.toUpperCase(), '400 #px Anton', 40, 300); ctx.fillText(t[0].name.toUpperCase(), 42, 232);
  if (t[1]) { ctx.fillStyle = CARD.muted; ctx.font = '600 24px Geist'; ctx.fillText(`+ ${t[1].name}`, 42, 266); }
  if (piece) ctx.drawImage(piece, 450, 48, 110, 110);
  if (proKind(name)) { // a known pro (gold) or streamer (VIP, pink): the frame and the tag, as .pf-pcard.pro / .vip
    const c = proKind(name) === 'pro' ? '#d4a017' : '#e0459b';
    ctx.strokeStyle = c; ctx.lineWidth = 8; ctx.beginPath(); ctx.roundRect(-4, -4, 608, 788, 13); ctx.stroke();
    ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect(32, -20, 84, 34, 5); ctx.fill();
    ctx.fillStyle = proKind(name) === 'pro' ? '#141414' : '#fff'; ctx.font = '400 26px Anton'; ctx.letterSpacing = '3px'; ctx.fillText(proKind(name).toUpperCase(), 46, 8); ctx.letterSpacing = '0px';
  }
  if (flag) { // the sticker on the corner: white edge, tilted, a soft shadow (as .pf-flag)
    ctx.save(); ctx.translate(560, 18); ctx.rotate(8 * Math.PI / 180);
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 7;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(-52, -38, 104, 76, 10); ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.beginPath(); ctx.roundRect(-46, -32, 92, 64, 5); ctx.clip(); ctx.drawImage(flag, -46, -32, 92, 64); ctx.restore();
  }
  if (main) {
    ctx.textAlign = 'right'; ctx.font = '400 26px Anton'; ctx.fillStyle = CARD.muted; const sp = main.speed.toUpperCase(); ctx.fillText(sp, 560, 232);
    const w = ctx.measureText(sp).width; ctx.font = '400 52px Anton'; ctx.fillStyle = CARD.ink; ctx.fillText(String(main.rating), 560 - w - 10, 232);
    if (siteName(name)) { ctx.font = '500 20px Geist'; ctx.fillStyle = CARD.muted; ctx.fillText(siteName(name), 560, 262); } // as .pf-pcard-site
    if (p.also) { ctx.font = '400 22px Anton'; ctx.fillStyle = CARD.muted; const s2 = p.also.site.toUpperCase(); ctx.fillText(s2, 560, 268); const w2 = ctx.measureText(s2).width; ctx.font = '400 32px Anton'; ctx.fillStyle = CARD.ink; ctx.fillText(String(p.also.rating), 560 - w2 - 8, 268); }
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = CARD.line; ctx.fillRect(40, 292, 520, 2); ctx.fillRect(40, 392, 520, 2);
  ctx.fillStyle = CARD.ink; ctx.textAlign = 'center'; fit(ctx, nick(name).toUpperCase(), '400 #px Anton', 60, 520); ctx.fillText(nick(name).toUpperCase(), 300, 366); ctx.textAlign = 'left';
  // The six skills as bars, in the card's colour.
  skills.forEach((s, i) => {
    const cy = 452 + i * 50;
    ctx.fillStyle = CARD.muted; ctx.font = '400 28px Anton'; ctx.fillText(ABBR[s.label], 44, cy);
    ctx.fillStyle = CARD.line; ctx.beginPath(); ctx.roundRect(150, cy - 20, 330, 14, 3); ctx.fill();
    if (s.v) { ctx.fillStyle = band; ctx.beginPath(); ctx.roundRect(150, cy - 20, Math.max(1, 330 * k * s.v / 100), 14, 3); ctx.fill(); }
    ctx.fillStyle = CARD.ink; ctx.font = '400 38px Anton'; ctx.textAlign = 'right'; ctx.fillText(s.v == null ? '–' : String(Math.round(s.v * k)), 558, cy + 2); ctx.textAlign = 'left';
  });
  ctx.fillStyle = CARD.muted; ctx.textAlign = 'center'; ctx.font = '600 20px Geist'; ctx.letterSpacing = '4px';
  ctx.fillText(`${main ? `VS ${main.rating - PEER}–${main.rating + PEER} · ` : ''}${p.n} GAMES`, 300, 738);
  // Where the card is from, so a shared image leads back here.
  ctx.fillStyle = band; ctx.font = '700 15px Geist'; ctx.letterSpacing = '3px'; ctx.fillText('CHESSLABS.GG', 300, 766);
  ctx.restore();
}
// A comparison as an image, in the look picked in the menu (dark or light): the two cards side by side
// with VS between them, and with detail, each player's style and strength explained under their card and
// the comparison in short below.
async function comparePng(A, B, sa, sb, detail, btn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Making the image…';
  CARD = CARDS[cardLook()];
  window.track?.('card', `${A.name} vs ${B.name}`.slice(0, 50) + ` · ${detail ? 'compare + text' : 'compare'} · ${cardLook()}`);
  try {
    await Promise.all(['400 40px Anton', '400 20px Geist', '600 20px Geist', '700 20px Geist'].map((f) => document.fonts.load(f)));
    const img = (p) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = `pieces/${CARD.piece}${(p.piece || 'n').toUpperCase()}.svg`; });
    const [pa, pb] = await Promise.all([img(A.p), img(B.p)]);
    const S = 2, W = 1280, k = 0.85, cw = 600 * k, ch = 780 * k, top = 70, gap = W - 2 * 70 - 2 * cw;
    const text = (html) => Object.assign(document.createElement('div'), { innerHTML: html }).textContent;
    const story = detail ? compareStory(A, B, sa, sb).map(text) : [];
    // Measure the text first, so the image is just tall enough for it.
    const probe = document.createElement('canvas').getContext('2d');
    const lines = (t, font, max) => { probe.font = font; return wrap(probe, t, 0, 0, max, 1, 99) / 1; };
    const colH = (X) => 70 + X.p.type.reduce((h, t) => h + 40 + lines(TYPE_ABOUT[t.name] || '', '400 22px Geist', cw) * 31 + 14, 0);
    const storyH = story.length ? 70 + story.reduce((h, t) => h + lines(t, '400 24px Geist', W - 140) * 34 + 14, 0) : 0;
    // The numbers, as on the page: [label, A, B, A value, B value, 1 higher is better / -1 lower / 0 neither]
    const n = (v, f = (x) => x) => (v === null || v === undefined ? '–' : f(v)), ra = A.p.speeds[0], rb = B.p.speeds[0];
    const nums = detail ? [
      ['Rating', n(ra?.rating), n(rb?.rating), ra?.rating, rb?.rating, 1], ['Win rate', pct(A.p.winRate), pct(B.p.winRate), A.p.winRate, B.p.winRate, 1],
      ['Wins as White', n(A.p.winW, pct), n(B.p.winW, pct), A.p.winW, B.p.winW, 1], ['Wins as Black', n(A.p.winB, pct), n(B.p.winB, pct), A.p.winB, B.p.winB, 1],
      ['Accuracy', n(A.p.acc, (x) => `${x}%`), n(B.p.acc, (x) => `${x}%`), A.p.acc, B.p.acc, 1], ['Blunders / game', n(A.p.blunders, (x) => x.toFixed(1)), n(B.p.blunders, (x) => x.toFixed(1)), A.p.blunders, B.p.blunders, -1],
      ['Draws', pct(A.p.draws), pct(B.p.draws), 0, 0, 0], ['Moves a game', A.p.moves, B.p.moves, 0, 0, 0],
    ] : [];
    const numsH = nums.length ? 110 + nums.length * 44 : 0;
    const H = top + ch + (detail ? 50 + Math.max(colH(A), colH(B)) + numsH + storyH : 60) + 100;
    const canvas = Object.assign(document.createElement('canvas'), { width: W * S, height: H * S }), ctx = canvas.getContext('2d');
    ctx.scale(S, S);
    ctx.fillStyle = CARD.paper; ctx.fillRect(0, 0, W, H);
    const xs = [70, W - 70 - cw];
    const [fa, fb] = await Promise.all([flagImage(A.name), flagImage(B.name)]);
    [[A, sa, pa, fa], [B, sb, pb, fb]].forEach(([X, sk, pc, fl], i) => { ctx.save(); ctx.translate(xs[i], top); ctx.scale(k, k); drawCard(ctx, 0, 0, X.name, X.p, X.p.type, sk, pc, fl); ctx.restore(); });
    ctx.fillStyle = CARD.hot; ctx.font = '400 84px Anton'; ctx.textAlign = 'center'; ctx.fillText('VS', W / 2, top + ch / 2 + 30); ctx.textAlign = 'left';
    let y = top + ch + 60;
    if (detail) {
      // Under each card: its style and strength, each with what it means.
      const ys = [A, B].map((X, i) => {
        let yy = y; const x = xs[i];
        ctx.fillStyle = CARD.paperInk; fit(ctx, X.p.type[0].name.toUpperCase(), '400 #px Anton', 52, cw); ctx.fillText(X.p.type[0].name.toUpperCase(), x, yy += 40);
        if (X.p.type[1]) { ctx.fillStyle = CARD.paperMuted; fit(ctx, `+ ${X.p.type[1].name}`, '400 #px Anton', 30, cw); ctx.fillText(`+ ${X.p.type[1].name}`, x, yy += 40); }
        yy += 24;
        for (const t of X.p.type) {
          ctx.fillStyle = CARD.paperInk; ctx.font = '700 22px Geist'; ctx.fillText(`${t.name}.`, x, yy += 6);
          const w = ctx.measureText(`${t.name}. `).width; ctx.font = '400 22px Geist'; ctx.fillStyle = CARD.paperMuted;
          yy = wrap(ctx, TYPE_ABOUT[t.name] || '', x, yy, cw, 31, 99, w) + 14;
        }
        return yy;
      });
      y = Math.max(...ys) + 20;
      if (story.length) {
        ctx.fillStyle = CARD.hot; ctx.fillRect(70, y, W - 140, 3);
        ctx.fillStyle = CARD.paperMuted; ctx.font = '700 16px Geist'; ctx.letterSpacing = '3px'; ctx.fillText('IN SHORT', 70, y += 40); ctx.letterSpacing = '0px';
        ctx.fillStyle = CARD.paperInk; ctx.font = '400 24px Geist'; y += 20;
        for (const t of story) y = wrap(ctx, t, 70, y + 12, W - 140, 34) + 2;
        y += 30;
      }
      // The numbers as on the page: the label on the left, one column per player under their name, a line
      // under each row, the better one in the hot colour.
      const ca = W - 70 - 2 * 260, cb = W - 70 - 260; // the two columns' left edges
      ctx.fillStyle = CARD.hot; ctx.fillRect(70, y, W - 140, 3);
      ctx.fillStyle = CARD.paperMuted; ctx.font = '700 16px Geist'; ctx.letterSpacing = '3px'; ctx.fillText('NUMBERS', 70, y += 40); ctx.letterSpacing = '0px';
      ctx.fillStyle = CARD.paperInk; ctx.font = '700 20px Geist'; fit(ctx, nick(A.name), '700 #px Geist', 20, 240); ctx.fillText(nick(A.name), ca, y); fit(ctx, nick(B.name), '700 #px Geist', 20, 240); ctx.fillText(nick(B.name), cb, y);
      y += 14;
      for (const [label, a, b, va, vb, dir] of nums) {
        ctx.fillStyle = CARD.paperMuted; ctx.globalAlpha = 0.35; ctx.fillRect(70, y, W - 140, 1); ctx.globalAlpha = 1;
        y += 44;
        const lead = dir && va != null && vb != null && va !== vb ? ((va > vb) === (dir > 0) ? 'a' : 'b') : '';
        ctx.fillStyle = CARD.paperInk; ctx.font = '600 22px Geist'; ctx.fillText(label, 70, y - 6);
        ctx.font = '400 30px Anton'; ctx.fillStyle = lead === 'a' ? CARD.hot : CARD.paperInk; ctx.fillText(String(a), ca, y - 4);
        ctx.fillStyle = lead === 'b' ? CARD.hot : CARD.paperInk; ctx.fillText(String(b), cb, y - 4);
      }
    }
    ctx.fillStyle = CARD.hot; ctx.fillRect(70, H - 76, W - 140, 3);
    ctx.fillStyle = CARD.paperInk; ctx.font = '400 28px Anton'; ctx.fillText('CHESSLABS.GG', 70, H - 34);
    ctx.fillStyle = CARD.paperMuted; ctx.font = '400 19px Geist'; ctx.textAlign = 'right'; ctx.fillText(`${A.name} vs ${B.name}, from their last ${MAX} rated Lichess games`, W - 70, H - 36); ctx.textAlign = 'left';
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png')), file = new File([blob], `${A.name}-vs-${B.name}${detail ? '-text' : ''}-${cardLook()}.png`, { type: 'image/png' });
    await saveImage(blob, file, `${A.name} vs ${B.name}`);
  } catch (err) { $('#profile-msg').textContent = `The image could not be made: ${err.message}`; }
  btn.disabled = false; btn.textContent = label;
}
// What the downloaded image needs beyond the card's code, so admin can draw the very same image: the
// number of games, the opening taste as White and Black, and for the style image its lead text.
const plain = (html) => Object.assign(document.createElement('div'), { innerHTML: html }).textContent;
function cardExtra(name, p, skills, detail) {
  const tt = (m) => { const x = taste(m); return x ? `${x.label}:${x.share.toFixed(2)}` : ''; };
  return [p.n, tt(p.styleMix?.w), tt(p.styleMix?.b), detail ? plain(portrait(name, p, skills, false)).replace(/~/g, '-') : ''].join('~');
}
// An image to keep: downloaded (on Android it lands in Downloads and the gallery), except on an iPhone or
// iPad, where the share sheet is the way to Save Image.
async function saveImage(blob, file, title) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], title }).catch(() => {});
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function cardPng(name, p, t, skills, detail, btn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Making the image…';
  window.track?.('card', `${name} · ${detail ? 'style' : 'card'} · ${cardLook()} #${cardCode(p, t, skills)} ~${cardExtra(name, p, skills, detail)}`);
  try {
    const canvas = await cardImage(cardLook(), name, p, t, skills, detail, plain(portrait(name, p, skills, false)));
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png')), file = new File([blob], `${nick(name)}-chess-${detail ? 'profile' : 'card'}-${cardLook()}.png`, { type: 'image/png' });
    await saveImage(blob, file, `${nick(name)}'s chess card`);
  } catch (err) { $('#profile-msg').textContent = `The image could not be made: ${err.message}`; }
  btn.disabled = false; btn.textContent = label;
}
// The card as a short video, for supporters: it slides in, the overall and the skills count up, then it holds.
// Recorded from the canvas as it plays (MP4 where the browser can, else WebM), about four seconds.
async function cardVideo(name, p, t, skills, btn) {
  const type = window.MediaRecorder && ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((x) => MediaRecorder.isTypeSupported?.(x));
  if (!type) { $('#profile-msg').textContent = 'This browser cannot make videos. Try Chrome, Edge, Firefox or Safari 14.1+.'; return; }
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Making the video…';
  window.track?.('card', `${name} · video · ${cardLook()} #${cardCode(p, t, skills)}`);
  try {
    CARD = CARDS[cardLook()];
    await Promise.all(['400 40px Anton', '400 20px Geist', '600 20px Geist'].map((f) => document.fonts.load(f)));
    const piece = await new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = `pieces/${CARD.piece}${(p.piece || 'n').toUpperCase()}.svg`; });
    const flag = await flagImage(name), S = 2, W = 680, H = 860;
    const canvas = Object.assign(document.createElement('canvas'), { width: W * S, height: H * S }), ctx = canvas.getContext('2d');
    const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
    const frame = (s) => { // s: seconds in
      ctx.setTransform(S, 0, 0, S, 0, 0); ctx.fillStyle = CARD.paper; ctx.fillRect(0, 0, W, H);
      const a = ease(s / 0.5), z = 0.9 + 0.1 * a;
      ctx.globalAlpha = a; ctx.translate(W / 2, H / 2 + (1 - a) * 40); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
      drawCard(ctx, 40, 40, name, p, t, skills, piece, flag, ease((s - 0.4) / 1.6)); ctx.globalAlpha = 1;
    };
    frame(0);
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 6e6 }), parts = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    const done = new Promise((ok) => { rec.onstop = ok; });
    rec.start();
    const t0 = performance.now();
    await new Promise((ok) => { const step = () => { const s = (performance.now() - t0) / 1000; frame(s); if (s < 4.2) requestAnimationFrame(step); else ok(); }; requestAnimationFrame(step); });
    rec.stop(); await done;
    const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm', blob = new Blob(parts, { type: type.split(';')[0] });
    await saveImage(blob, new File([blob], `${nick(name)}-chess-card-${cardLook()}.${ext}`, { type: blob.type }), `${nick(name)}'s chess card`);
  } catch (err) { $('#profile-msg').textContent = `The video could not be made: ${err.message}`; }
  btn.disabled = false; btn.textContent = label;
}
// The downloaded image as a canvas, in the given look: the card alone, or with detail the style image
// (card, style, opening taste, the lead text and what each type means). Admin draws it the same way.
async function cardImage(look, name, p, t, skills, detail, lead) {
  CARD = CARDS[look];
  {
    await Promise.all(['400 40px Anton', '400 20px Geist', '600 20px Geist'].map((f) => document.fonts.load(f)));
    const piece = await new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = `pieces/${CARD.piece}${(p.piece || 'n').toUpperCase()}.svg`; });
    const S = 2, W = detail ? 1080 : 680, H = detail ? 1350 : 860;
    const canvas = Object.assign(document.createElement('canvas'), { width: W * S, height: H * S }), ctx = canvas.getContext('2d');
    ctx.scale(S, S);
    const flag = await flagImage(name);
    if (!detail) drawCard(ctx, 40, 40, name, p, t, skills, piece, flag);
    else {
      ctx.fillStyle = CARD.paper; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.translate(60, 60); ctx.scale(0.78, 0.78); drawCard(ctx, 0, 0, name, p, t, skills, piece, flag); ctx.restore();
      const x = 560, max = W - x - 60; let y = 140;
      ctx.fillStyle = CARD.paperInk; const z = fit(ctx, t[0].name.toUpperCase(), '400 #px Anton', 120, max); ctx.fillText(t[0].name.toUpperCase(), x, y += z * 0.2);
      if (t[1]) { ctx.fillStyle = CARD.paperMuted; fit(ctx, `+ ${t[1].name}`, '400 #px Anton', 48, max); ctx.fillText(`+ ${t[1].name}`, x, y += 70); }
      y += 40;
      for (const [m, side] of [[p.styleMix?.w, 'White'], [p.styleMix?.b, 'Black']]) {
        const tt = tasteOrMixed(m); if (!tt) continue;
        ctx.fillStyle = CARD.hot; ctx.fillRect(x, y, max, 4);
        ctx.fillStyle = CARD.paperMuted; ctx.font = '700 15px Geist'; ctx.letterSpacing = '2px'; ctx.fillText(`OPENINGS AS ${side.toUpperCase()}`, x, y += 34); ctx.letterSpacing = '0px';
        ctx.fillStyle = CARD.paperInk; ctx.font = '400 40px Anton'; ctx.fillText(tt.label.toUpperCase(), x, y += 46);
        ctx.fillStyle = CARD.paperMuted; ctx.font = '400 18px Geist'; ctx.fillText(tt.share === null ? 'no one kind stands out' : `${pct(tt.share)} of their choices`, x, y += 28); y += 30;
      }
        let ty = 760;
      ctx.fillStyle = CARD.paperInk; ctx.font = '400 32px Geist';
      ty = wrap(ctx, lead, 60, ty, W - 120, 46, 5) + 24;
      ctx.fillStyle = CARD.paperMuted; ctx.font = '400 24px Geist';
      for (const k of t) { ctx.font = '700 24px Geist'; ctx.fillStyle = CARD.paperInk; ctx.fillText(`${k.name}.`, 60, ty); const w = ctx.measureText(`${k.name}. `).width; ctx.font = '400 24px Geist'; ctx.fillStyle = CARD.paperMuted; ty = wrap(ctx, TYPE_ABOUT[k.name] || '', 60, ty, W - 120, 34, 3, w) + 12; }
      ctx.fillStyle = CARD.hot; ctx.fillRect(60, H - 96, W - 120, 3);
      ctx.fillStyle = CARD.paperInk; ctx.font = '400 30px Anton'; ctx.fillText('CHESSLABS.GG', 60, H - 50);
      ctx.fillStyle = CARD.paperMuted; ctx.font = '400 20px Geist'; ctx.textAlign = 'right'; ctx.fillText(`From ${nick(name)}'s last ${p.n} rated ${siteOf(name)} games`, W - 60, H - 52); ctx.textAlign = 'left';
    }
    return canvas;
  }
}
// With Share (supporters for now) the card bar is one wide Share button and a ⋯ menu holding the rest
const more = (share, rest) => share ? `${share}<details class="pf-dl pf-etc"><summary title="More" aria-label="More">⋯</summary><div class="pf-etc-menu">${rest}</div></details>` : rest;
// Under the card: which skills are still locked and what unlocks them, so a missing EARLY or ACC is not a mystery.
function lockNote(skills, p, me, panel) {
  const early = skills.find((x) => x.label === 'Early game' && x.v === null), an = skills.filter((x) => x.needs && x.v === null);
  if (p.n < MIN_GAMES || (!early && !an.length)) return '';
  const near = `near ${me ? 'your' : 'their'} rating`;
  const row = (label, have, need, what, link = '') => `<div class="pf-lock-row">${LOCK}<b>${label}</b><span>${Math.min(have, need)} of ${need} ${what}${link}</span><i class="pf-lock-bar"><i style="width:${(Math.min(have, need) / need) * 100}%"></i></i></div>`;
  const rows = [], go = (say) => (panel ? ` <a href="#pf-analyse">${say} →</a>` : '');
  if (an.length) {
    const label = an.map((x) => ABBR[x.label]).join(' · ');
    rows.push(p.analysed < an[0].unlockAt ? row(label, p.analysed, an[0].unlockAt, 'analysed games', go('Analyse')) : row(label, an[0].have, ENOUGH, `analysed games ${near}`, go('Analyse more')));
  }
  if (early) rows.push(row('EARLY', p.peer?.n12 ?? 0, EARLY_MIN, `games ${near} that reach move 12`, quick ? ' · Stockfish is reading them' : ''));
  return `<div class="pf-lock-note">${rows.join('')}</div>`;
}
function cardNote(name, p, me) {
  const main = p.speeds[0];
  if (!main) return '';
  return `<details class="pf-dl pf-card-help"><summary title="How the stats work" aria-label="How the stats work"><b>?</b><span>How it works</span></summary><p class="pf-card-note"><b>Every stat compares ${me ? 'you' : esc(nick(name))} with ${me ? 'your' : 'their'} own opponents</b>, rated ${main.rating - PEER}–${main.rating + PEER}, in the same games. A higher rating starts the card higher; the big number is the average of the six skills. <a href="#pf-skills">What each skill measures</a></p></details>`;
}

// ---------- The leaderboard ----------
// Everyone who has logged in here with Lichess is on the leaderboard: your card is sent whenever your
// profile shows it. The leaderboard function checks your Lichess login and stores the card under the
// name Lichess gives back.
const BOARD = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/leaderboard';
const sentCards = new Set();
function boardCard(name, full, sp) {
  const speed = sp === 'all' ? full.speeds[0]?.speed : sp, p = speed && forSpeed(name, full, speed);
  if (!p || p.n < MIN_GAMES) return null;
  const skills = skillsOf(p), known = skills.filter((x) => x.v !== null), t = p.type;
  // Gambits you chose: your own openings with Gambit in the name (not the other side's answer to one).
  const gambits = [...p.openings.w.map((o) => ({ ...o, side: 'w' })), ...p.openings.b.map((o) => ({ ...o, side: 'b' }))].filter((o) => !/^vs /.test(o.fam) && isGambit(o.fam) && !/Accepted|Declined/.test(o.fam));
  const gn = gambits.reduce((s, o) => s + o.n, 0);
  return { speed, rating: p.speeds[0].rating, games: p.n, analysed: p.analysed || 0, overall: known.length ? Math.round(sum(known, (x) => x.v) / known.length) : null,
    stars: (({ sum }) => ({ green: sum('green'), gold: sum('gold'), diamond: sum('diamond') }))(starCounts()),
    style: t[0]?.name, strength: t[1]?.name, piece: p.piece || 'n', skills: Object.fromEntries(skills.map((x) => [x.label, x.v])),
    gambit_games: gn, gambit_score: gn ? gambits.reduce((s, o) => s + o.score * o.n, 0) / gn : null,
    openings: [...p.openings.w.map((o) => ({ ...o, side: 'w' })), ...p.openings.b.map((o) => ({ ...o, side: 'b' }))].sort((a, b) => b.n - a.n).slice(0, 12).map((o) => ({ fam: o.fam, side: o.side, n: o.n, score: o.score })) };
}
async function sendCard(name, full, sp) {
  const card = boardCard(name, full, sp), token = account()?.token;
  if (!card || !token || sentCards.has(card.speed)) return;
  sentCards.add(card.speed);
  await fetch(BOARD, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ token, card }) }).catch(() => sentCards.delete(card.speed));
}

// One time control at a time: bullet and blitz games say different things about speed, endgames and
// the level, so the profile reads the player's main time control unless another (or All) is picked.
let pfSpeed = null, shown = null; // the picked time control ('all' or a speed); the last render's arguments
// Every time control the player has rated games in on Lichess, with how many games the card reads now: a
// time control's own last 500 games once fetched (fetchSpeed), else its share of the last 500 of all.
// Only when the games themselves are kept here (the last few players looked up).
const PERFS = new Map(); // lower-case name → promise of { bullet: games, … } from Lichess
const LIVE = new Map(); // lower-case name → { blitz: rating, … } as Lichess has it now, ahead of the games read so far
function noteLive(name, perfs) {
  LIVE.set(name.toLowerCase(), Object.fromEntries(SPEEDS.filter((sp) => perfs?.[sp]?.rating).map((sp) => [sp, perfs[sp].rating])));
  if (!isMe(name)) return;
  for (const sp of ['blitz', 'classical']) if (perfs?.[sp]?.rating) keep(`opening-book-v2-${sp}-rating`, perfs[sp].rating); // the level Openings plays at
}
function perfsOf(name) {
  const k = name.toLowerCase();
  if (!PERFS.has(k) && isCC(name)) PERFS.set(k, ccUser(name).then((u) => { if (u) FLAGS.set(k, flagCode(u.flag)); PERFS.set(k, u?.games || null); return u?.games || null; }));
  if (!PERFS.has(k)) PERFS.set(k, fetch(`https://lichess.org/api/user/${encodeURIComponent(name)}`).then((r) => (r.ok ? r.json() : null))
    .then((u) => { if (u) { FLAGS.set(k, flagCode(u.profile?.flag)); noteLive(name, u.perfs); } return u && Object.fromEntries(SPEEDS.map((sp) => [sp, u.perfs?.[sp]?.games || 0])); }).catch(() => null)
    .then((x) => { PERFS.set(k, x); return x; }));
  return PERFS.get(k);
}
const speedKey = (name, sp) => `${name}~${sp}`; // a time control's own games, kept beside the player's
function speedsOf(name, full) {
  if (!storedGames(name)) return [];
  const perfs = PERFS.get(name.toLowerCase());
  const known = perfs && !(perfs instanceof Promise) ? perfs : null;
  return SPEEDS.map((sp) => {
    const own = storedGames(speedKey(name, sp)), mixed = full.speeds.find((x) => x.speed === sp)?.n || 0;
    return [sp, own ? own.length : mixed, known?.[sp] || 0];
  }).filter(([, n, all]) => n > 0 || all > 0);
}
function forSpeed(name, full, sp) {
  if (sp === 'all') { shownGames = storedGames(name) ? recordsOf(name, storedGames(name)) : []; full.type = stableType(name, 'all', full); return full; }
  const own = storedGames(speedKey(name, sp)), mixed = storedGames(name);
  if (!mixed) return full; // drawn early, while the games still come in: none kept yet
  const done = new Map(mixed.filter((g) => g.analysis).map((g) => [g.id, g])); // analysed among all the player's games
  // Games played since the time control's own were fetched come in with the player's newest (Refresh and
  // every visit fetch those), so the card always ends on the latest game and rating.
  const newer = own ? mixed.filter((g) => g.speed === sp && g.createdAt > (own[0]?.createdAt || 0)) : [];
  const games = own ? [...newer, ...own].slice(0, MAX).map((g) => (!g.analysis && done.get(g.id)) || g) : mixed;
  shownGames = recordsOf(name, games).filter((g) => g.speed === sp);
  const p = profileOf(shownGames);
  p.type = stableType(name, sp, p);
  return p;
}
// A time control's own last 500 games, fetched when it is picked and the last 500 of all hold fewer
// than Lichess has; later picks fetch only the games played since.
async function fetchSpeed(name, sp, onStep = () => {}) {
  const have = storedGames(speedKey(name, sp)) || [], mixed = (storedGames(name) || []).filter((g) => g.speed === sp);
  const perfs = await perfsOf(name);
  if (!have.length && (!perfs || mixed.length >= Math.min(MAX, perfs[sp]))) return false; // the last 500 of all already hold them
  const of = Math.min(MAX, perfs?.[sp] || MAX);
  onStep(0, of);
  const fresh = await fetchGames(name, (k) => onStep(k, of), have.length ? have[0].createdAt + 1 : null, sp);
  const ids = new Set(fresh.map((g) => g.id)), raw = [...fresh, ...have.filter((g) => !ids.has(g.id))].slice(0, MAX);
  await mergeRemote(name, raw);
  saveGames(speedKey(name, sp), raw);
  return true;
}
// Each time control with the games played in it in all (from Lichess's or Chess.com's own count, when
// known); how many the card reads is in its title and on the card.
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
function speedBar(name, full, sp, avail) {
  if (avail.length < 2 && sp !== 'all') return '';
  const total = sum(avail, ([, , all = 0]) => all);
  return `<div class="pf-seg pf-speeds" role="group" aria-label="Time control">${[['all', full.n, total], ...avail].map(([k, n, all = 0]) => {
    const read = k === sp ? n : Math.max(n, Math.min(MAX, all)), played = Math.max(all, read);
    return `<button type="button" data-pf-speed="${k}" aria-pressed="${k === sp}" title="${played.toLocaleString('en')} ${k === 'all' ? '' : `${k} `}games played${played > read ? `; the card reads the last ${read}` : ''}${k === full.speeds[0]?.speed ? ' · played most' : ''}">${k === full.speeds[0]?.speed ? '<i class="pf-speed-star" aria-label="played most">★</i>' : ''}<span>${k === 'all' ? 'All' : k[0].toUpperCase() + k.slice(1)}</span><small>${compact.format(played)}</small></button>`;
  }).join('')}</div>`;
}
let shownCode = ''; // render: the card on screen as a short code (cardCode)
let shownGames = [], trendGames = []; // the games behind the card on screen, newest first
// How the skills moved: each point reads 100 games in a row, as the card would, moving 25 games at a
// time from the oldest of the games read to the latest 100. One row per skill in the card's order, all on
// one scale, so a big swing looks big and a flat skill looks flat.
const TREND = { win: 100, step: 25 };
function trendOf(games, full) {
  const pts = [];
  for (let i = games.length - TREND.win; i > -TREND.step; i -= TREND.step) {
    const from = Math.max(0, i), sk = fineSkillsOf(profileOf(games.slice(from, from + TREND.win)), full), known = sk.filter((x) => x.v !== null);
    pts.push({ from, at: games[from].at, v: { Overall: known.length ? Math.round(sum(known, (x) => x.v) / known.length) : null, ...Object.fromEntries(sk.map((x) => [x.label, x.v === null ? null : Math.round(x.v)])) } });
    if (!from) break;
  }
  return pts;
}
function trendCard(full) {
  const el = $('#pf-trend'), games = trendGames;
  if (!el) return;
  const me = isMe(shown[0]), head = `<h2>How ${me ? 'your' : 'their'} skills changed</h2>`;
  if (games.length < TREND.win + TREND.step) { el.innerHTML = `${head}<p class="info">Needs at least ${TREND.win + TREND.step} games: each point reads ${TREND.win} in a row.</p>`; return; }
  const pts = trendOf(games, full), names = Object.keys(pts[0].v).filter((k) => pts.filter((q) => q.v[k] !== null).length >= 2);
  const all = names.flatMap((k) => pts.map((q) => q.v[k]).filter((v) => v !== null));
  const lo = Math.floor((Math.min(...all) - 3) / 10) * 10, hi = Math.ceil((Math.max(...all) + 3) / 10) * 10, ticks = [lo, (lo + hi) / 2, hi];
  // Drawn at the width it shows at, so the numbers stay small and sharp on a phone and a wide screen alike.
  const phone = matchMedia('(max-width: 560px)').matches, W = Math.max(140, el.clientWidth - (phone ? parseFloat(getComputedStyle(el).paddingLeft) * 2 : 310)), H = 104, L = 28, R = 8, T = 16, B = 16, x = (i) => L + (i / (pts.length - 1)) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const row = (k) => {
    const ps = pts.map((q, i) => [i, q.v[k]]).filter(([, v]) => v !== null), vs = ps.map(([, v]) => v);
    const low = ps[vs.indexOf(Math.min(...vs))], high = ps[vs.indexOf(Math.max(...vs))], last = ps.at(-1), d = last[1] - ps[0][1];
    const mark = ([i, v], c, below) => `<circle class="${c}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3"/><text class="pf-tr-v" x="${(x(i) + (i ? 0 : 5)).toFixed(1)}" y="${(y(v) + (below ? 13 : -6)).toFixed(1)}" text-anchor="${i ? 'middle' : 'start'}">${v}</text>`;
    return `<div class="pf-tr-row"><span>${k}<small>low ${Math.min(...vs)} · high ${Math.max(...vs)}</small></span>
      <svg class="pf-line" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${k}: from ${ps[0][1]} to ${last[1]}, low ${low[1]}, high ${high[1]}">
        ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join('')}
        <path class="ln" d="${ps.map(([i, v], j) => `${j ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}"/>
        ${low[0] !== last[0] ? mark(low, 'lo', true) : ''}${high[0] !== last[0] && high[1] !== low[1] ? mark(high, 'hi', false) : ''}<circle cx="${x(last[0]).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="3.5"/>
      </svg><b>${last[1]}</b><span class="pf-tr-d ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}</span></div>`;
  };
  const n = pts[0].from + TREND.win, day = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const short = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  el.innerHTML = `<div class="pf-chart-head">${head}<p class="pf-tr-span"><b>Last ${n} games</b> · ${day(games[n - 1].at)} – ${day(games[0].at)}</p></div>
    <p class="pf-tr-how">Each line is one skill's number, worked out the way the card does from ${TREND.win} games in a row. The first point is the oldest ${TREND.win} games, each next point moves ${TREND.step} games on, and the last point is ${me ? 'your' : 'their'} latest ${TREND.win}. Up is better. <span class="pf-tr-key"><i class="lo"></i>lowest <i class="hi"></i>highest <i class="now"></i>latest</span></p>
    <div class="pf-tr-rows"><div class="pf-tr-row pf-tr-hdr"><span>Skill</span><span class="pf-tr-axis"><span>${short(games[n - 1].at)}</span><span>${short(games[0].at)}</span></span><span title="The latest ${TREND.win} games (the card reads all ${shownGames.length || n}, so it can differ)">Latest</span><span title="The latest point against the first">Change</span></div>${names.map(row).join('')}</div>`;
}
let shownP = null;
let rise = false; // the next draw comes up into place (a first look-up's first card)
function render(name, at, full) {
  shown = [name, at, full];
  if (full.n > 0) window.rememberPlayer?.(name);
  const avail = combo ? [] : speedsOf(name, full), main = full.speeds[0]?.speed;
  // A time control with no games read yet has no card of its own: the main one shows until its games come.
  const sp = pfSpeed && (pfSpeed === 'all' || avail.some(([k, n]) => k === pfSpeed && n > 0)) ? pfSpeed : avail.some(([k]) => k === main) ? main : 'all';
  const p = combo ? full : forSpeed(name, full, sp);
  if (!combo) for (const x of p.speeds) { const now = LIVE.get(name.toLowerCase())?.[x.speed]; if (now) { x.change += now - x.rating; x.rating = now; } } // games read can be a game or two behind
  trendGames = combo ? comboGames : shownGames;
  if (sp !== 'all') chartState.speed = sp;
  const t = p.type, me = isMe(name), say = me ? (x) => x : they, skills = skillsOf(p);
  if (me && p.speeds[0]) { // the rating at the top right is the one on your card, on every page (header.js reads this)
    const { speed, rating } = p.speeds[0], el = document.querySelector('.top-me summary strong');
    keep('opening-book-v2-card-rating', { me: myName(), speed, rating, at: Date.now(), live: combo || isCC(name) ? null : name });
    if (el) { el.textContent = rating; el.title = `${speed} rating`; }
  }
  shownCode = cardCode(p, t, skills); // the card as drawn, for the lookup's event
  shownP = p; // the card's profile, for the piece menu
  document.title = `${me ? 'Your Profile' : nick(name)} · Chess Labs`;
  const kpis = [['Win rate', pct(p.winRate ?? p.score)], ['Accuracy', p.acc !== null && p.analysed >= KPI_MIN ? `${p.acc}%` : '–'], ['Blunders / game', p.blunders !== null && p.analysed >= KPI_MIN ? p.blunders.toFixed(1) : '–'], ['Draws', pct(p.draws)]].filter(Boolean);
  $('#profile').innerHTML = `
    ${accountsRow(name)}${combo && comboOwn ? comboRow() : ''}${nameRow(name)}${proLine(name)}${proBio(name, p)}
    <section class="pf-hero">
      <div class="pf-card-col">${playerCard(name, p, t, skills)}<div class="pf-cardbar">${combo ? '' : speedBar(name, full, sp, avail)}<div class="pf-tools">${more(me && window.earlyAccess?.() && shareHtml(name, t), `<details class="pf-dl"><summary title="Download the card" aria-label="Download the card"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 19h14"/></svg><span>Download</span></summary>
        <div class="pf-dl-menu" role="group" aria-label="Download"><div class="pf-dl-look" role="group" aria-label="Look">${['dark', 'light'].map((k) => `<button type="button" data-card-look="${k}" aria-pressed="${cardLook() === k}">${k === 'dark' ? 'Dark' : 'Light'}</button>`).join('')}</div><button type="button" data-card-png="card">Card</button><button type="button" data-card-png="style">Card + style</button><button type="button" data-card-png="both">Both</button><button type="button" data-card-link title="A link that shows this card when it is shared">Copy link</button>${me && window.supporterOf?.(name) ? '<button type="button" data-card-video title="The card counting up, about four seconds">Video</button>' : ''}</div></details>${cardNote(name, p, me)}`)}</div></div>${combo ? '' : lockNote(skills, p, me, !!(p.todo || full.todo))}</div>
      <div class="pf-hero-text">
        <div class="pf-type-row"><div><h2 class="pf-h1">${esc(t[0].name)}</h2>
        ${t.length > 1 ? `<p class="pf-sub">+ ${t.slice(1).map((x) => esc(x.name)).join(' + ')}</p>` : ''}<a class="pf-all-styles" href="playstyles.html?s=${encodeURIComponent(t[0].name)}${t[1] ? `&t=${encodeURIComponent(t[1].name)}` : ''}">See all styles →</a></div>${tasteLine(p.styleMix, me)}</div>
        <p class="pf-portrait">${portrait(name, p, skills, me)}</p>
        <div class="pf-why-type">
          <div class="pf-about">${t.map((x) => `<p><b>${esc(x.name)}.</b> ${esc(TYPE_ABOUT[x.name] || '')} <span>${esc(say(x.why))}</span></p>`).join('')}</div>
          <p class="pf-more-portrait">${portrait(name, p, skills, me, 'more')}</p>
        </div>
        <div class="pf-side-bits">${me ? starsStrip() : ''}${combo ? '' : `<p class="pf-ago">${me ? 'Your' : 'The'} card from ${AGO.map(([m, t]) => `<a href="${agoLink(name, m)}">${t.replace(' ago', '')}</a>`).join(' · ')} ago</p>`}</div>
        <nav class="pf-jump" aria-label="Parts of the profile"></nav>
      </div>
    </section>
    <section class="pf-card pf-chart" id="pf-chart"></section>
    <dl class="pf-kpis">${kpis.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${leadStory(name, p, skills, me)}
    <section class="pf-card pf-skills-card${showSkillText ? ' open' : ''}" id="pf-skills">
      ${p.n < MIN_GAMES ? `<p class="pf-an-few">Only ${p.n} rated games: skills need at least ${MIN_GAMES}.</p>` : ''}
      <div class="pf-skills-head"><h2>${me ? 'Skills' : `${esc(nick(name))}'s skills`}</h2>
        <button type="button" class="link" data-skill-text aria-expanded="${showSkillText}">${showSkillText ? 'Hide explanations' : 'What each one means'}</button></div>
      ${skillBars(skills, say, me)}
      <p class="pf-skill-scale">All against opponents within ${PEER} of ${me ? 'your' : 'their'} rating; the mark on each bar is as good as them.</p>
    </section>
    <section class="pf-card pf-trend" id="pf-trend"></section>
    ${combo ? '' : sp === 'all' ? analysePanel(name, full, p) : analysePanel(name, p, p, sp)}
    <section class="pf-card pf-more"><div class="pf-more-head"><h2>Results and openings</h2><span>From ${sp === 'all' ? `all ${p.n} games` : `${p.n} ${sp} games`}</span></div>
      <div class="pf-res-band">
        <dl class="pf-stats">
          <div><dt>Wins as White</dt><dd>${p.winW == null ? '–' : pct(p.winW)}</dd></div>
          <div><dt>Wins as Black</dt><dd>${p.winB == null ? '–' : pct(p.winB)}</dd></div>
          <div><dt>Moves a game</dt><dd>${p.moves}</dd></div>
          ${p.speeds.map((x) => `<div><dt>${x.speed}</dt><dd>${x.rating} <span class="${x.change >= 0 ? 'up' : 'down'}">${x.change >= 0 ? '+' : '−'}${Math.abs(x.change)}</span></dd><small>${games(x.n)} · ${pct(x.win ?? x.score)} wins</small></div>`).join('')}
        </dl>
      </div>
      <div class="pf-two pf-more-body">
        <section><h3>Openings as White</h3>${openingRows(p.openings.w, 'w', (f) => usualAt(p, name)(f, 'w'))}</section>
        <section><h3>Openings as Black</h3>${openingRows(p.openings.b, 'b', (f) => usualAt(p, name)(f, 'b'))}</section>
      </div>
      ${SCORES?.buckets && p.speeds[0] ? '<p class="pf-res-note">The mark on a bar: what players at this rating usually score, counting a draw as half a win.</p>' : ''}
    </section>
    ${me && window.earlyAccess?.() ? fitCard(p, name) : ''}
    ${opponentsCard(p, me, name)}
    ${rivalsCard(name, me)}
    <section class="pf-card" id="pf-games"></section>
    ${me ? starsCard() : ''}
    ${nextActions(name, me, skills)}
    <section class="pf-about-data">
      <h2>About these numbers</h2>
      <p class="info">Read from ${me ? 'your' : `${esc(nick(name))}'s`} last ${p.n} rated Lichess games, ${ago(at)}. <button id="refresh" class="link" type="button">Read them again</button></p>
      <p class="info">Results, openings, opening style, the clock, endgames and the rating graph use all ${p.n} games.
        Early game uses Stockfish's verdict on the position after move 12 in every game (looked at here once). Accuracy, blunders and the Defense and Accuracy skills (and part of Attack) need a computer's verdict on every move, so they use only the
        ${p.analysed} analysed game${p.analysed === 1 ? '' : 's'} among the ${p.n} shown${p.ours ? ` (${p.ours} analysed here with Stockfish, the rest by Lichess)` : ''}. ${p.todo ? 'Analyse more with the Analyse button under Skills.' : ''}</p>
      <p class="info">Player types, skills and thresholds are rules of thumb read from the games, not a rating. Win rate counts wins out of all games; an endgame score counts a draw as half.</p>
    </section>`;
  applyHidden(name, me);
  jumpNav();
  $('#refresh').addEventListener('click', async (e) => { // a seen player is read again quietly: the button says it is working
    Object.assign(e.target, { disabled: true, textContent: 'Reading…' });
    await run(name);
    if (e.target.isConnected) Object.assign(e.target, { disabled: false, textContent: 'Read them again' });
  });
  if (me && !combo) {
    sendCard(name, full, sp);
  }
  // Dark or light: remembered, and the menu stays open to pick what to download.
  document.querySelectorAll('[data-card-look]').forEach((b) => b.addEventListener('click', () => {
    try { localStorage.setItem('chess-trainer-card-look', b.dataset.cardLook); } catch {}
    document.querySelectorAll('[data-card-look]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));
  bindShare(name, t);
  // The link to share: on Discord, Reddit or X it shows the card (functions/_middleware.js), once the player has saved it.
  document.querySelector('[data-card-link]')?.addEventListener('click', async (e) => {
    const url = `https://chesslabs.gg/profile?u=${encodeURIComponent(name)}`, b = e.currentTarget;
    try { await navigator.clipboard.writeText(url); b.textContent = 'Link copied'; } catch { prompt('Copy the link', url); }
  });
  document.querySelectorAll('[data-card-png]').forEach((b) => b.addEventListener('click', async () => {
    b.closest('details').open = false; b.closest('.pf-etc')?.removeAttribute('open');
    const k = b.dataset.cardPng;
    if (k !== 'style') await cardPng(name, p, t, skills, false, b);
    if (k !== 'card') await cardPng(name, p, t, skills, true, b);
  }));
  document.querySelector('[data-card-video]')?.addEventListener('click', (e) => { e.currentTarget.closest('details').open = false; cardVideo(name, p, t, skills, e.currentTarget); });
  bindSearch();
  if (!combo) { bindAnalyse(name); quickLook(name); }
  if (rise && !$('#profile .pf-skeleton')) { rise = false; const el = $('#profile'); el.classList.remove('pf-rise'); void el.offsetWidth; el.classList.add('pf-rise'); }
  setTimeout(() => trendCard(full));
  $('.pf-lock-note a[href="#pf-analyse"]')?.addEventListener('click', (e) => { e.preventDefault(); $('#pf-analyse')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  $('.pf-card-help a[href="#pf-skills"]')?.addEventListener('click', (e) => { e.preventDefault(); $('#pf-skills').scrollIntoView({ behavior: 'smooth' }); });
  document.querySelectorAll('[data-pf-speed]').forEach((b) => b.addEventListener('click', async () => {
    const sp = b.dataset.pfSpeed, redraw = () => { const y = scrollY; render(...shown); scrollTo(0, y); };
    pfSpeed = sp; redraw();
    if (sp === 'all' || storedGames(speedKey(name, sp))) return;
    const st = loadSpeed(name, sp);
    if (!st.over) { barFor = st.key; loadBar.show(st.say(), st.of ? (st.k / st.of) * 100 : 0); }
    const got = await st.done;
    if (pfSpeed !== sp) return;
    loadBar.done();
    if (got) redraw();
    if (pfSpeed === sp && !speedsOf(name, shown[2]).some(([k, n]) => k === sp && n > 0)) $('#profile-msg').textContent = `${siteOf(name)} gave no ${sp} games for ${nick(name)} to read, so the card stays on the others.`;
  }));
  // Time controls missing from the last 500 games show once Lichess says the player has them.
  if (!PERFS.has(name.toLowerCase())) perfsOf(name).then((x) => { if (x && shown?.[0] === name) { const y = scrollY; render(...shown); scrollTo(0, y); } });
  placeActs();
  if (me) bindPiecePick(name);
  bindPlayerBar(name);
  gamesList(name, 8);
  $('[data-skill-text]').addEventListener('click', (e) => {
    showSkillText = !showSkillText;
    $('.pf-skills-card').classList.toggle('open', showSkillText);
    e.currentTarget.setAttribute('aria-expanded', showSkillText);
    e.currentTarget.textContent = showSkillText ? 'Hide explanations' : 'What each one means';
  });
  ratingChart(name, p);
  arrangeAccounts();
}

addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('details.pf-help[open]').forEach((d) => { d.open = false; d.querySelector('summary').focus(); }); });
// The lead story under the card: recent form (the last ten results) and the one thing to train now.
// Under the ten games: a won/drawn/lost bar per colour, then this week's rating, the accuracy and how the decided games ended.
function recentFacts(rs, p, week) {
  const wins = (xs) => xs.filter((r) => r.result === 1).length;
  const acc = rs.filter((r) => r.acc !== null);
  const side = (k, label) => { const xs = rs.filter((r) => r.side === k); return xs.length ? `<span>${label}</span>${bar({ win: wins(xs) / xs.length, score: sum(xs, (r) => r.result) / xs.length })}<span class="num">${wins(xs)} of ${xs.length}</span>` : ''; };
  const stat = (dt, dd, sub = '', cls = '') => `<div><dt>${dt}</dt><dd${cls ? ` class="${cls}"` : ''}>${dd}</dd>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const stats = [
    week && stat('This week', `${week.change >= 0 ? '+' : '−'}${Math.abs(week.change)}`, `in ${week.n} game${week.n === 1 ? '' : 's'}`, week.change >= 0 ? 'up' : 'down'),
    acc.length >= 3 && p.acc !== null && stat('Accuracy', `${Math.round(sum(acc, (r) => r.acc) / acc.length)}%`, `usually ${p.acc}%`),
  ].filter(Boolean).join('');
  return `<div class="pf-facts"><div class="pf-split">${side('w', 'White')}${side('b', 'Black')}</div>
    <p class="pf-split-key"><span><i class="pf-side w"></i>As White</span><span><i class="pf-side b"></i>As Black</span></p></div>
    ${stats ? `<dl class="pf-lead-stats">${stats}</dl>` : ''}`;
}
function leadStory(name, p, skills, me) {
  const games = storedGames(name) || [], low = name.toLowerCase(), say = me ? (x) => x : they;
  const sideOf = (g) => (g.players.white.user?.id === low ? 'white' : 'black');
  const res = (g) => (!g.winner ? 'D' : g.winner === sideOf(g) ? 'W' : 'L');
  const after = (g) => (g ? g.players[sideOf(g)].rating + (g.players[sideOf(g)].ratingDiff || 0) : null);
  const day = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const main = p.speeds[0]?.speed, mine = games.filter((g) => g.speed === main);
  const week = Date.now() - 7 * 864e5, recent = mine.filter((g) => g.createdAt >= week);
  const before = mine.find((g) => g.createdAt < week);
  const change = recent.length ? after(recent[0]) - (before ? after(before) : recent.at(-1).players[sideOf(recent.at(-1))].rating) : null;
  const last = (mine.length ? mine : games).slice(0, 10), form = last.map(res), wins = form.filter((x) => x === 'W').length, rs = last.map((g) => readGame(g, low));
  return `<section class="pf-lead solo">
    <div class="pf-news"><div class="pf-lead-head"><h2>Latest</h2>${form.length ? `<small>${wins} win${wins === 1 ? '' : 's'} in the last ${form.length}${main ? ` ${main}` : ''} games, newest first</small>` : ''}</div>
      ${form.length ? `<div class="pf-form-row" role="group" aria-label="Last ${form.length} games, newest first: ${form.join(' ')}">${last.map((g, i) => `<div class="pf-form-game"><a class="pf-res r-${form[i]}" href="game.html?u=${encodeURIComponent(name)}&id=${g.id}" data-peek="${PEEK.set(g.id, { g, me: name.toLowerCase(), res: form[i] }) && g.id}" aria-label="${{ W: 'Won', L: 'Lost', D: 'Drew' }[form[i]]} against ${esc(nick(g.players[sideOf(g) === 'white' ? 'black' : 'white'].user?.id || 'anonymous'))}, ${day(g.createdAt)}: open the game">${form[i]}</a>
        <small><i class="pf-side ${rs[i].side}" title="As ${rs[i].side === 'w' ? 'White' : 'Black'}"></i>${day(g.createdAt)}</small><span class="pf-form-op">${opLink(rs[i].side, rs[i].family)}</span></div>`).join('')}</div>` : ''}
      <div class="pf-lead-under">${last.length ? recentFacts(rs, p, change !== null ? { change, n: recent.length } : null) : ''}
      <div class="pf-fetch-row">
      <button type="button" class="ghost pf-fetch" data-fetch title="Fetch the games played on Lichess since this profile was read"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg> New games</button>
      ${shown?.[1] ? `<small class="pf-fetched" id="pf-fetched">Updated ${ago(shown[1])}</small>` : ''}</div></div>
    </div>
  </section>`;
}
// Hovering one of the last ten: the final position, seen from this player's side, with the colour and the opening.
const PEEK = new Map();
// How the game ended, as a sticker on the card's edge: [word, icon path]
const KING = 'M12 2v4M10 4h4M7 21h10M8 21l-1-8h10l-1 8M7 13c-2-3 0-6 5-5 5-1 7 2 5 5', CLOCK = 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l3 2M9 2h6';
const ENDING = { mate: ['Checkmate', KING], stalemate: ['Stalemate', KING], resign: ['Resigned', 'M5 21V4M5 4h11l-2 4 2 4H5'], outoftime: ['On time', CLOCK], timeout: ['On time', CLOCK] };
function peekCard(a) {
  const { g, me, res } = PEEK.get(a.dataset.peek), white = g.players.white.user?.id === me, c = new Chess();
  for (const m of (g.moves || '').split(' ').filter(Boolean)) { try { c.move(m); } catch { break; } }
  const rows = c.board(), order = (xs) => (white ? xs : [...xs].reverse());
  const sqs = order(rows).map((row, r) => order(row).map((p, f) => `<i class="${(r + f) % 2 ? 'd' : 'l'}">${p ? `<img src="pieces/${p.color}${p.type.toUpperCase()}.svg" alt="">` : ''}</i>`).join('')).join('');
  const opp = nick(g.players[white ? 'black' : 'white'].user?.id || 'anonymous');
  const [fam, line] = (g.opening?.name || 'Opening unknown').split(/:\s*/), end = ENDING[g.status];
  return `<div class="pf-peek-board">${sqs}</div><b class="pf-peek-op">${esc(fam)}</b><small>${esc(line || '')}&nbsp;</small><p><b class="r-${res}">${{ W: 'Won', L: 'Lost', D: 'Drew' }[res]}</b> vs ${esc(opp)}</p>${end ? `<span class="pf-peek-end"><svg class="ico" viewBox="0 0 24 24"><path d="${end[1]}"/></svg>${end[0]}</span>` : ''}`;
}
function showPeek(e) {
  const a = e.target.closest?.('a[data-peek]');
  let el = document.getElementById('pf-peek');
  if (!a || !PEEK.has(a.dataset.peek)) { if (el) el.hidden = true; return; }
  if (!el) { el = Object.assign(document.createElement('div'), { id: 'pf-peek', className: 'pf-peek' }); el.setAttribute('aria-hidden', 'true'); document.body.append(el); }
  const { g, me } = PEEK.get(a.dataset.peek);
  el.innerHTML = peekCard(a); el.hidden = false;
  el.classList.toggle('as-b', g.players.white.user?.id !== me); // the card is the colour this player had
  const r = a.getBoundingClientRect(), w = el.offsetWidth;
  el.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + scrollX}px`;
  el.style.top = `${a.closest('.pf-form-row').getBoundingClientRect().top - el.offsetHeight - 8 + scrollY}px`; // above the row, so the dates and the row stay in view
}
if (matchMedia('(hover: hover)').matches) {
  document.addEventListener('mouseover', showPeek);
  document.addEventListener('focusin', showPeek);
}
// The page ends on what to do next, not on the fine print.
// Your stars from the Openings trainer, across every opening and time control (on your Lichess account
// when logged in, header.js syncs them; else in this browser):
// green for a line played through in Learn, gold for one cleared in Practice, diamond for one played
// without a slip in the time trial; and the openings with the most, each linking to its lines.
const STAR_PATH = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z';
const starIcon = (kind) => `<svg class="line-star ${kind}" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`;
// Against each kind of opponent, best first; the headline names the worst when it is clearly below par.
// A face for each kind of opponent: a clock, a sword, a shield, an arrow up or down.
const OPP_ICON = { 'Fast movers': 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l3 2M9 2h6', Attackers: 'M14 3h7v7l-9 9-4-4zM3 21l5-5', 'Solid players': 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  'Stronger players': 'M12 19V5M6 11l6-6 6 6', 'Weaker players': 'M12 5v14M6 13l6 6 6-6' };
const SURE_OPP = 20; // games against one kind of opponent before the headline names it
function opponentsCard(p, me, name) {
  const rows = (p.opponents || []).slice().sort((a, b) => a.gain - b.gain);
  if (!rows.length) return '';
  // The headline speaks only of groups with 20 games or more; smaller ones are listed as few games.
  const exp = (x) => pct(x.score - x.gain), you = (t) => (me ? t : t.replace(/\byou\b/g, 'them')), sure = rows.filter((x) => x.n >= SURE_OPP);
  const worst = sure[0], best = sure.at(-1);
  const against = (x) => you(/^rated/.test(x.about) ? `players ${x.about}` : `opponents who ${x.about}`);
  const head = !worst ? `Not enough games against any one kind of opponent to say yet: each needs ${SURE_OPP}.`
    : worst.gain <= -0.04 ? `Against ${against(worst)}, ${me ? 'you' : 'they'} scored ${pct(worst.score)} in ${worst.n} games. With those rating gaps ${me ? 'you' : 'they'}'d expect about ${exp(worst)}, so ${me ? 'you drop' : 'they drop'} more points than ${me ? 'you' : 'they'} should.`
    : `No kind of opponent gives ${me ? 'you' : 'them'} trouble: the results are close to what the ratings predict, or better.`;
  // One row per kind of opponent, best first: a bar from the middle line, right (green) when the score
  // beat what the ratings predict, left (red) when it fell short; the full numbers under the name.
  const pts = (x) => Math.round(x.gain * 100), span = Math.max(10, ...rows.map((x) => Math.abs(pts(x))));
  return `<section class="pf-card pf-opps"><h2>${me ? 'You' : 'They'} against each kind of opponent</h2>
    <p class="info">${head}${best && best !== worst && best.gain >= 0.04 ? ` Best against ${against(best)}: ${pct(best.score)}, where about ${exp(best)} was expected.` : ''}</p>
    <div class="pf-opp-scale" aria-hidden="true"><span>← Worse than expected</span><span>Better than expected →</span></div>
    <ul class="pf-opp-list">${rows.slice().reverse().map((x) => { const d = pts(x), v = x.gain <= -0.04 ? 'bad' : x.gain >= 0.04 ? 'good' : 'even', few = x.n < SURE_OPP;
      return `<li class="${v}${few ? ' few' : ''}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${OPP_ICON[x.name]}"/></svg>
        <span class="pf-opp-name"><b>${x.name}</b><small>${me ? x.about : x.about.replace(/\byou\b/, 'them')}</small></span>
        <span class="pf-opp-bar" role="img" aria-label="${pct(x.score)}, expected ${exp(x)}"><i style="--w:${(Math.abs(d) / span) * 50}%"${d < 0 ? ' class="neg"' : ''}></i></span>
        <span class="pf-opp-d"><b>${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}</b><small>${v === 'good' ? 'Strong' : v === 'bad' ? 'Struggles' : 'As expected'}</small></span>
        <small class="num">Scored ${pct(x.score)} · expected ${exp(x)} · ${games(x.n)}${few ? ' · few games so far' : ''}</small></li>`; }).join('')}</ul>
    <p class="pf-skill-scale">The bar is the score against what the rating gaps predict, in percentage points: +5 means 5 points more than expected. A game can count in more than one group; groups with fewer than 10 games are left out, and under 20 is too few to read much into.</p></section>`;
}
// Rivals: everyone met 3 times or more in the games read, worst for this player first.
// The nemesis is the worst of those met 5 times or more, if under 50%; the most played gets its own story.
const RIVAL_MIN = 3, NEMESIS_MIN = 5;
function rivalsOf(name, games, min = RIVAL_MIN) {
  const me = name.toLowerCase(), by = new Map();
  for (const g of games) { // newest first
    const side = g.players?.white?.user?.id === me ? 'white' : g.players?.black?.user?.id === me ? 'black' : null;
    const opp = side && g.players[side === 'white' ? 'black' : 'white'].user;
    if (!opp?.id) continue;
    const res = !g.winner ? 'D' : g.winner === side ? 'W' : 'L';
    if (!by.has(opp.id)) by.set(opp.id, { id: opp.id, name: opp.name || opp.id, games: [] });
    by.get(opp.id).games.push({ g, side, res });
  }
  const rivals = [...by.values()].filter((r) => r.games.length >= min).map((r) => {
    const n = r.games.length, k = (x) => r.games.filter((y) => y.res === x).length;
    return { ...r, n, w: k('W'), d: k('D'), l: k('L'), score: (k('W') + k('D') / 2) / n };
  }).sort((a, b) => a.score - b.score || b.n - a.n);
  const nemesis = rivals.find((r) => r.n >= NEMESIS_MIN && r.score < 0.5) || null;
  const most = rivals.filter((r) => r.n >= NEMESIS_MIN).sort((a, b) => b.n - a.n)[0] || null;
  return { rivals, nemesis, most };
}
console.assert((() => { const g = (w, b, winner) => ({ players: { white: { user: { id: w } }, black: { user: { id: b } } }, winner });
  const x = rivalsOf('me', [g('me', 'a', 'black'), g('a', 'me', 'white'), g('me', 'a', 'black'), g('me', 'a', 'white'), g('a', 'me', 'white'), g('me', 'b', null), g('b', 'me', 'black'), g('me', 'b', 'white')]);
  return x.nemesis?.id === 'a' && x.nemesis.l === 4 && x.rivals.length === 2 && x.rivals[1].id === 'b' && x.most.id === 'a'; })(), 'rivalsOf');
const runOf = (games, res) => { let best = 0, k = 0; for (const x of games) { k = x.res === res ? k + 1 : 0; best = Math.max(best, k); } return best; };
const sparkOf = (games) => `<span class="pf-rv-spark" aria-hidden="true">${games.slice().reverse().map((x) => `<i class="r-${x.res}"></i>`).join('')}</span>`;
// Against one rival, for each of the two: the opening they play most as White and as Black, and the one
// that works best for them (3 games or more), from the games between them. A draw is half a point.
function duel(games, me, r, name) {
  const fam = (x) => (x.g.opening?.name || '').split(':')[0];
  const pts = (x, mine) => (x.res === 'D' ? 0.5 : (x.res === 'W') === mine ? 1 : 0);
  const of = (mine) => {
    const most = (side) => { const c = {}; for (const x of games) if ((x.side === side) === mine && fam(x)) c[fam(x)] = (c[fam(x)] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]; };
    const t = {}; for (const x of games) if (fam(x)) { const k = fam(x); t[k] ??= { n: 0, p: 0 }; t[k].n++; t[k].p += pts(x, mine); }
    const best = Object.entries(t).filter(([, v]) => v.n >= 3).sort((a, b) => b[1].p / b[1].n - a[1].p / a[1].n || b[1].n - a[1].n)[0];
    return { w: most('white'), b: most('black'), best };
  };
  const a = of(true), b = of(false);
  const cell = (x, f) => (x ? `${esc(x[0])} <small>${f(x[1])}</small>` : '–');
  const row = (label, f, k) => `<tr><th>${label}</th><td>${cell(a[k], f)}</td><td>${cell(b[k], f)}</td></tr>`;
  return `<table class="pf-rv-duel"><thead><tr><th></th><th>${me ? 'You' : esc(nick(name))}</th><th>${esc(nick(r.name))}</th></tr></thead><tbody>
    ${row('Most as White', (n) => `${n}×`, 'w')}${row('Most as Black', (n) => `${n}×`, 'b')}${row('Works best', (v) => `${pct(v.p / v.n)} in ${v.n}`, 'best')}</tbody></table>`;
}
// Games with friends are mostly casual, and the profile reads only rated games: Rivals fetches the last 300
// casual ones once a visit (one call, kept for the session) and draws itself again with them.
const CASUAL = new Map(), CASUAL_KEY = (n) => `chess-trainer-casual:${n.toLowerCase()}`;
function casualOf(name) {
  if (CASUAL.has(name.toLowerCase())) return CASUAL.get(name.toLowerCase());
  try { const v = JSON.parse(sessionStorage.getItem(CASUAL_KEY(name))); if (v) { CASUAL.set(name.toLowerCase(), v); return v; } } catch {}
  return null;
}
async function loadCasual(name, redraw) {
  if (isCC(name) || casualOf(name)) return;
  CASUAL.set(name.toLowerCase(), []); // tried: never twice a visit, whatever happens
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(name)}?` + new URLSearchParams({ max: 300, rated: 'false', moves: 'true', opening: 'true' }),
    { headers: { Accept: 'application/x-ndjson', ...lichessAuth() } }).catch(() => null);
  if (!res?.ok) return; // a 429 or an error: Rivals stays with the rated games
  const games = (await res.text()).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((g) => g.variant === 'standard')
    .map((g) => ({ id: g.id, createdAt: g.createdAt, winner: g.winner, status: g.status, speed: g.speed, moves: g.moves, opening: g.opening && { name: g.opening.name }, players: g.players, casual: true }));
  CASUAL.set(name.toLowerCase(), games);
  try { sessionStorage.setItem(CASUAL_KEY(name), JSON.stringify(games)); } catch {}
  if (games.length) redraw();
}
// Revenge: the opening where you lose most points to a rival, opened in the trainer with a note on why.
// Their own choice first (the games where they had White), else the one you played with White.
function revengeLink(name, r) {
  const t = {};
  for (const x of r.games) {
    const fam = (x.g.opening?.name || '').split(':')[0]; if (!fam) continue;
    const k = `${x.side === 'white' ? 'w' : 'b'}:${fam}`;
    t[k] ??= { n: 0, lost: 0, pts: 0 }; t[k].n++; t[k].pts += x.res === 'W' ? 1 : x.res === 'D' ? 0.5 : 0; t[k].lost += x.res === 'L' ? 1 : x.res === 'D' ? 0.5 : 0;
  }
  const [k, v] = Object.entries(t).filter(([, v]) => v.n >= 2).sort((a, b) => (b[0][0] === 'b') - (a[0][0] === 'b') || b[1].lost - a[1].lost)[0] || [];
  if (!k || !v.lost) return '';
  return `index.html?${new URLSearchParams({ practise: k, rv: nick(r.name), rn: v.n, rs: Math.round((v.pts / v.n) * 100) })}`;
}
// Wanted: a front page about a rival, as a story-sized PNG (1080×1920), saved or shared like the card.
const RIVALS = new Map(); // name → the rivals last drawn, for the Wanted button
async function wantedPng(name, r, btn) {
  const label = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Making the poster…'; }
  window.track?.('card', `${nick(name)} · wanted ${nick(r.name)}`);
  try {
    await Promise.all(['400 100px Anton', '400 30px Geist', '700 30px Geist'].map((f) => document.fonts.load(f)));
    const W = 1080, H = 1920, c = Object.assign(document.createElement('canvas'), { width: W, height: H }), x = c.getContext('2d');
    x.fillStyle = '#efe8db'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#141414'; x.textAlign = 'center';
    x.font = '700 30px Geist'; x.letterSpacing = '10px'; x.fillText('THE CHESS LABS DAILY', W / 2, 190); x.letterSpacing = '0px';
    x.fillRect(90, 225, W - 180, 6); x.fillRect(90, 241, W - 180, 2);
    x.fillStyle = '#9c330a'; x.font = '700 44px Geist'; x.letterSpacing = '24px'; x.fillText('WANTED', W / 2 + 12, 420); x.letterSpacing = '0px';
    const who = nick(r.name).toUpperCase(); let size = 200; x.font = `400 ${size}px Anton`;
    while (x.measureText(who).width > W - 160 && size > 60) x.font = `400 ${size -= 8}px Anton`;
    x.fillStyle = '#141414'; x.fillText(who, W / 2, 470 + size);
    x.fillStyle = '#b42318'; x.font = '400 300px Anton'; x.fillText(`${r.l}–${r.w}`, W / 2, 1000 + size * 0.3);
    x.fillStyle = '#141414'; x.font = '700 40px Geist'; x.fillText(`against ${nick(name)}`, W / 2, 1110 + size * 0.3);
    let k = 0; while (r.games[k]?.res === 'L') k++;
    x.font = '400 34px Geist'; x.fillStyle = '#3a342c';
    [`${r.n} games${r.d ? `, ${r.d} drawn` : ''}.`, k >= 2 ? `${k} wins in a row and counting.` : `Last met ${new Date(r.games[0].g.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`]
      .forEach((t, i) => x.fillText(t, W / 2, 1230 + size * 0.3 + i * 52));
    x.fillStyle = '#141414'; x.fillRect(90, H - 260, W - 180, 2);
    x.font = '700 30px Geist'; x.letterSpacing = '8px'; x.fillText('REVENGE AT CHESSLABS.GG', W / 2 + 4, H - 190); x.letterSpacing = '0px';
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png')), file = new File([blob], `wanted-${nick(r.name)}.png`, { type: 'image/png' });
    await saveImage(blob, file, `Wanted: ${nick(r.name)}`);
  } catch (err) { $('#profile-msg').textContent = `The poster could not be made: ${err.message}`; }
  if (btn) { btn.disabled = false; btn.textContent = label; }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-wanted]'); if (!b) return;
  const [name, id] = b.dataset.wanted.split('|'), r = RIVALS.get(name)?.find((x) => x.id === id);
  if (r) wantedPng(name, r, b);
});
// What a rivalry is drawn with, for one player (name) and whether it is the viewer (me).
function rivalKit(name, me) {
  const you = me ? 'you' : 'they', your = me ? 'your' : 'their', who = me ? 'you' : esc(nick(name));
  const h2h = (r) => `rivals.html?u=${encodeURIComponent(name)}&vs=${encodeURIComponent(r.name)}`;
  const link = (r) => `<a href="${h2h(r)}">${esc(nick(r.name))}</a>`;
  const rec = (r) => `${r.w}–${r.d}–${r.l}`;
  const day = (g) => new Date(g.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(new Date(g.createdAt).getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
  const game = (x, what) => `<li><a href="${x.g.casual ? `https://lichess.org/${x.g.id}" target="_blank" rel="noopener` : `game.html?u=${encodeURIComponent(name)}&id=${x.g.id}`}"><span class="pf-res r-${x.res}">${x.res}</span><span>${what}<small>${esc((x.g.opening?.name || '').split(':')[0])} · ${Math.ceil((x.g.moves || '').split(' ').length / 2)} moves · ${day(x.g)}</small></span></a></li>`;
  const streakOf = (r) => { let k = 0; while (r.games[k]?.res === 'L') k++; return k; };
  // The whole story: the run of games, best runs, colours, both players' openings, three games.
  const story = (r, page) => {
    const g = r.games, asW = g.filter((x) => x.side === 'white'), asB = g.filter((x) => x.side === 'black');
    const sc = (xs) => xs.length ? pct(xs.reduce((t, x) => t + (x.res === 'W' ? 1 : x.res === 'D' ? 0.5 : 0), 0) / xs.length) : '–';
    const len = (x) => (x.g.moves || '').split(' ').length;
    const quick = g.filter((x) => x.res === 'W' && len(x) >= 20).sort((a, b) => len(a) - len(b))[0], long = g.filter((x) => x.res === 'L').sort((a, b) => len(b) - len(a))[0];
    const lead = r.w > r.l ? (me ? 'you lead' : `${esc(nick(name))} leads`) : r.w < r.l ? `${esc(nick(r.name))} leads` : 'level';
    return `<span class="pf-rv-sub">${games(r.n)} since ${day(g.at(-1).g)} · ${lead} <b>${rec(r)}</b> · ${who} ${me ? 'score' : 'scores'} ${pct(r.score)}${streakOf(r) >= 2 ? ` · ${streakOf(r)} losses in a row` : ''}</span>${sparkOf(g)}
      <dl class="pf-rv-facts"><div><dt>${me ? 'Your' : `${esc(nick(name))}'s`} best run</dt><dd>${runOf(g.slice().reverse(), 'W')} wins</dd></div><div><dt>${esc(nick(r.name))}'s best run</dt><dd>${runOf(g.slice().reverse(), 'L')} wins</dd></div>
        <div><dt>${me ? 'You' : esc(nick(name))} with White</dt><dd>${sc(asW)} <small>in ${asW.length}</small></dd></div><div><dt>${me ? 'You' : esc(nick(name))} with Black</dt><dd>${sc(asB)} <small>in ${asB.length}</small></dd></div></dl>
      ${duel(g, me, r, name)}
      ${page ? '' : `<ul class="pf-rv-games">${quick ? game(quick, 'Quickest win') : ''}${long ? game(long, 'Longest loss') : ''}${game(g[0], 'Latest')}</ul>`}`;
  };
  const chip = (t) => `<span class="chip">${t}</span>`;
  const acts = (r, page) => `<div class="pf-rv-acts">${page ? '' : `<a class="pf-rv-btn" href="${h2h(r)}">The whole rivalry →</a>`}${me && !page && revengeLink(name, r) ? `<a class="pf-rv-btn hot" href="${esc(revengeLink(name, r))}">Revenge →</a>` : ''}${me && r.l > r.w ? `<button type="button" class="pf-rv-btn" data-wanted="${esc(name)}|${esc(r.id)}">Wanted poster ↓</button>` : ''}${page ? `<button type="button" class="pf-rv-btn" data-rv-share>${me ? `Send to ${esc(nick(r.name))}` : 'Share this rivalry'}</button>` : ''}</div>`;
  return { you, your, h2h, link, rec, day, game, story, chip, acts };
}
// Two lists: Friends, the casual games (challenges, mostly people you know), and Rated, the games the pairing
// gave you. Each with its own most played and nemesis; the table goes by games played. On the profile and
// on its own page (rivals.html?u=), where each name opens the rivalry.
function rivalsBody(name, me, rated, casual, page) {
  const { you, your, h2h, link, rec, story, chip, acts } = rivalKit(name, me);
  // On its own page: one card per rival, side by side, each opening the rivalry.
  const card = (r, tags) => `<a class="rv-card${r.score < 0.5 ? ' bad' : ''}" href="${h2h(r)}"><span class="pf-rv-chips">${tags.map(chip).join('')}</span><b class="rv-card-name">${esc(nick(r.name))}</b><span class="rv-card-score">${r.w}–${r.l}</span><small>${games(r.n)}${r.d ? ` · ${r.d} drawn` : ''} · ${me ? 'you score' : 'they score'} ${pct(r.score)}</small>${sparkOf(r.games.slice(0, 10))}<span class="rv-card-go">The rivalry →</span></a>`;
  const panel = (gs) => {
    const { rivals, nemesis, most } = rivalsOf(name, gs);
    let html = '';
    if (page && rivals.length) return { rivals, html: `<div class="rv-cards">${rivals.slice().sort((x, y) => y.n - x.n).map((r) => card(r, [r === nemesis && `${me ? 'Your' : 'Their'} nemesis`, r === most && 'Most played'].filter(Boolean))).join('')}</div>` };
    if (most) html += `<div class="pf-rv-lead${most === nemesis ? ' bad' : ''}"><span class="pf-rv-chips">${most === nemesis ? chip(`${me ? 'Your' : 'Their'} nemesis`) : ''}${chip('Most played')}</span><b class="pf-rv-name">${link(most)}</b>${story(most)}${acts(most)}</div>`;
    if (nemesis && nemesis !== most) html += `<div class="pf-rv-lead bad"><span class="pf-rv-chips">${chip(`${me ? 'Your' : 'Their'} nemesis`)}</span><b class="pf-rv-name">${link(nemesis)}</b>${story(nemesis)}${acts(nemesis)}</div>`;
    const victim = rivals.filter((r) => r.n >= NEMESIS_MIN && r.score > 0.5).sort((x, y) => y.score - x.score)[0];
    const rows = rivals.slice().sort((x, y) => y.n - x.n || x.score - y.score).slice(0, 20);
    return { rivals, html: rivals.length ? `${html ? `<div class="pf-rv-top">${html}</div>` : ''}
      <table class="pf-rv-table"><thead><tr><th>Opponent</th><th>Games</th><th>W–D–L</th><th class="wide-only">Last 10</th><th>${me ? 'You' : 'They'}</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${link(r)}${r === nemesis ? ' <span class="chip hot">Nemesis</span>' : r === victim ? ` <span class="chip">${me ? 'Your' : 'Their'} victim</span>` : ''}</td><td>${r.n}</td><td>${rec(r)}</td><td class="wide-only">${sparkOf(r.games.slice(0, 10))}</td><td class="${r.score < 0.45 ? 'bad' : r.score > 0.55 ? 'good' : ''}">${pct(r.score)}</td></tr>`).join('')}</tbody></table>`
      : `<p class="info">Nobody shows up ${RIVAL_MIN} times here yet.</p>` };
  };
  const friends = casual ? panel(casual) : { rivals: [], html: `<p class="info">Looking for ${your} rivals in ${your} casual games…</p>${page ? SKELETON : ''}` }, pool = panel(rated);
  RIVALS.set(name, [...friends.rivals, ...pool.rivals]);
  // Not read yet and not on its way (a visitor's card): Rated first, and pressing Friends reads them.
  const onTap = !casual && !page && !window.earlyAccess?.();
  const first = friends.rivals.length || (!casual && !onTap) ? 'f' : 'r';
  const tab = (k, label, n, more = '') => `<button type="button" data-rv-tab="${k}" aria-pressed="${k === first}"${more}>${label}${n === null ? '' : ` <span class="og-n">${n}</span>`}</button>`;
  return `<div class="seg pf-rv-tabs" role="group" aria-label="Which games">${tab('f', 'Friends', onTap ? null : friends.rivals.length, onTap ? ` data-rv-load="${esc(name)}"` : '')}${tab('r', 'Rated', pool.rivals.length)}</div>
    <p class="pf-rv-about" data-rv="f"${first === 'f' ? '' : ' hidden'}>Casual games: the challenges, mostly with people ${you} know. From ${your} last ${casual?.length || 0} casual games.</p>
    <p class="pf-rv-about" data-rv="r"${first === 'r' ? '' : ' hidden'}>Rated games: the opponents the pairing gave ${me ? 'you' : 'them'}. From ${your} last ${rated.length} rated games.</p>
    <div data-rv="f"${first === 'f' ? '' : ' hidden'}>${friends.html}</div><div data-rv="r"${first === 'r' ? '' : ' hidden'}>${pool.html}</div>`;
}
const redrawRivals = (name, me) => { const el = document.getElementById('rivals'); if (el) { el.outerHTML = rivalsCard(name, me); applyHidden(name, me); } };
function rivalsCard(name, me) {
  const rated = storedGames(name) || (RAW_NAME.toLowerCase() === name.toLowerCase() ? RAW : null);
  if (!rated?.length) return '';
  const casual = casualOf(name);
  // Friendly games read by themselves only for supporters: for everyone it would be a second Lichess call beside the profile's own reading. Others press Friends.
  if (!casual && window.earlyAccess?.()) setTimeout(() => loadCasual(name, () => redrawRivals(name, me)), 2000);
  return `<section class="pf-card pf-rivals" id="rivals"><div class="pf-more-head"><h2>Rivals</h2><span>The players ${me ? 'you' : 'they'} met ${RIVAL_MIN} times or more · <a href="rivals.html?u=${encodeURIComponent(name)}">Open as a page →</a></span></div>
    ${rivalsBody(name, me, rated, casual)}<div class="pf-rv-acts"><a class="pf-rv-btn hot" href="rivals.html?u=${encodeURIComponent(name)}">All ${me ? 'your' : 'their'} rivals on one page →</a></div></section>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-rv-tab]'); if (!b) return;
  const box = b.closest('.pf-rivals');
  box.querySelectorAll('[data-rv-tab]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  box.querySelectorAll('[data-rv]').forEach((x) => { x.hidden = x.dataset.rv !== b.dataset.rvTab; });
  const load = b.dataset.rvLoad;
  if (load) { b.removeAttribute('data-rv-load'); loadCasual(load, () => {}).then(() => redrawRivals(load, isMe(load))); }
});

// ---------- The rivals page (rivals.html) ----------
// rivals.html?u=name: their rivals, Friends and Rated. rivals.html?u=name&vs=other: the two of them, from
// every game between them (rated and casual, one call to Lichess, kept for the session), so the link works
// for anyone it is sent to.
const SKELETON = `<div class="rv-cards" aria-hidden="true">${'<div class="rv-card rv-skel"></div>'.repeat(3)}</div>`;
async function rivalsPage(name, vs) {
  const me = isMe(name), msg = $('#profile-msg'), el = $('#profile');
  // The rival opening a link sent to them (logged in as vs) sees it from their own side, the sender as the opponent.
  if (vs && isMe(vs) && !me) { history.replaceState(null, '', `rivals.html?u=${encodeURIComponent(vs)}&vs=${encodeURIComponent(name)}`); return rivalryPage(vs, name, true); }
  if (vs) return rivalryPage(name, vs, me);
  document.title = `${nick(name)}'s rivals · Chess Labs`;
  // Rivals set to Only you on the profile: not here either. A rivalry link (vs) is sent on purpose and still opens.
  if (!me && (await hiddenOf(name)).includes?.('rivals')) { el.innerHTML = `<section class="rv-head"><span class="kicker-k">Rivals</span><h1>${esc(nick(name))}</h1><p class="info">${esc(nick(name))} keeps their rivals private.</p></section>`; return; }
  el.innerHTML = `<section class="rv-head"><span class="kicker-k">Rivals</span><h1>${me ? 'Your rivals' : esc(nick(name))}</h1><p class="info">The players ${me ? 'you' : 'they'} have met ${RIVAL_MIN} times or more. Open one for the whole rivalry.</p></section><section class="pf-card pf-rivals" id="rivals"><p class="info">Reading ${me ? 'your' : 'their'} games…</p>${SKELETON}</section>`;
  try {
    await gamesReady;
    if (!storedGames(name)) await profileFor(name);
    const draw = () => { $('#rivals').innerHTML = rivalsBody(name, me, storedGames(name) || [], casualOf(name), true); };
    draw();
    if (!casualOf(name)) await loadCasual(name, draw);
    draw();
  } catch (err) { msg.textContent = err.message; }
}
const H2H_KEY = (a, b) => `chess-trainer-h2h:${a.toLowerCase()}:${b.toLowerCase()}`;
async function h2hGames(a, b) {
  try { const v = JSON.parse(sessionStorage.getItem(H2H_KEY(a, b))); if (v) return v; } catch {}
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(a)}?` + new URLSearchParams({ vs: b, max: 500, moves: 'true', opening: 'true' }),
    { headers: { Accept: 'application/x-ndjson', ...lichessAuth() } });
  if (res.status === 404) throw new Error(`Lichess has no player called ${a}.`);
  if (res.status === 429) throw new Error('Lichess is busy right now. Try again in a minute.');
  if (!res.ok) throw new Error(`Lichess answered with an error (${res.status}).`);
  const games = (await res.text()).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((g) => g.variant === 'standard')
    .map((g) => ({ id: g.id, createdAt: g.createdAt, winner: g.winner, status: g.status, speed: g.speed, rated: g.rated, moves: g.moves, opening: g.opening && { name: g.opening.name }, players: g.players, casual: !g.rated }));
  try { sessionStorage.setItem(H2H_KEY(a, b), JSON.stringify(games)); } catch {}
  return games;
}
const ENDS = { mate: 'Mate', resign: 'Resigned', outoftime: 'On time', timeout: 'Left the game', draw: 'Agreed draw', stalemate: 'Stalemate' };
async function rivalryPage(name, vs, me) {
  const msg = $('#profile-msg'), el = $('#profile');
  document.title = `${nick(name)} vs ${nick(vs)} · Chess Labs`;
  el.innerHTML = `<section class="rv-head"><span class="kicker-k">Rivalry</span><h1>${esc(nick(name))} <span>vs</span> ${esc(nick(vs))}</h1></section>`;
  msg.textContent = `Fetching every game between ${nick(name)} and ${nick(vs)} from Lichess…`;
  try {
    if (isCC(name)) throw new Error('Rivalries need two Lichess accounts for now.');
    const all = await h2hGames(name, vs);
    msg.textContent = '';
    const r = rivalsOf(name, all, 1).rivals.find((x) => x.id === vs.toLowerCase());
    if (!r) { el.insertAdjacentHTML('beforeend', `<p class="info">${esc(nick(name))} and ${esc(nick(vs))} have not played each other on Lichess.</p>`); return; }
    RIVALS.set(name, [r]);
    const { story, rec, acts, you, day } = rivalKit(name, me);
    const g = r.games, pts = (xs) => xs.reduce((t, x) => t + (x.res === 'W' ? 1 : x.res === 'D' ? 0.5 : 0), 0);
    const group = (key) => { const m = new Map(); for (const x of g) { const k = key(x); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return [...m]; };
    const wdlRow = (label, xs) => { const w = xs.filter((x) => x.res === 'W').length, d = xs.filter((x) => x.res === 'D').length, l = xs.length - w - d;
      return `<tr><th>${label}</th><td>${xs.length}</td><td>${w}–${d}–${l}</td><td class="wide-only"><div class="wdl"><span class="w" style="width:${(w / xs.length) * 100}%"></span><span class="d" style="width:${(d / xs.length) * 100}%"></span><span class="l" style="width:${(l / xs.length) * 100}%"></span></div></td><td>${pct(pts(xs) / xs.length)}</td></tr>`; };
    const table = (title, rows) => rows.length ? `<section><h3>${title}</h3><table class="pf-rv-table"><thead><tr><th></th><th>Games</th><th>W–D–L</th><th class="wide-only"></th><th>${me ? 'You' : nick(name)}</th></tr></thead><tbody>${rows.join('')}</tbody></table></section>` : '';
    const speeds = group((x) => x.g.speed).sort((a, b) => b[1].length - a[1].length).map(([k, xs]) => wdlRow(k[0].toUpperCase() + k.slice(1), xs));
    const kinds = group((x) => (x.g.rated ? 'Rated' : 'Casual')).map(([k, xs]) => wdlRow(k, xs));
    const ends = (res) => group((x) => (x.res === res ? ENDS[x.g.status] || 'Other' : null)).sort((a, b) => b[1].length - a[1].length).map(([k, xs]) => `${k} ${xs.length}`).join(' · ') || '–';
    const avg = (xs) => (xs.length ? Math.round(xs.reduce((t, x) => t + (x.g.moves || '').split(' ').length, 0) / xs.length / 2) : '–');
    const wins = g.filter((x) => x.res === 'W'), losses = g.filter((x) => x.res === 'L');
    const A = esc(nick(name)), B = esc(nick(r.name)), old = g.slice().reverse();
    // Ratings at the time of each game, in their most played time control, as two lines.
    const rt = (x, mine) => x.g.players?.[(x.side === 'white') === mine ? 'white' : 'black']?.rating;
    const main = group((x) => x.g.speed).sort((a, b) => b[1].length - a[1].length)[0]?.[0];
    const rg = old.filter((x) => x.g.speed === main && rt(x, true) && rt(x, false));
    let chart = '';
    if (rg.length >= 3) {
      const all = rg.flatMap((x) => [rt(x, true), rt(x, false)]), lo = Math.floor((Math.min(...all) - 20) / 10) * 10, hi = Math.ceil((Math.max(...all) + 20) / 10) * 10;
      const line = (mine) => rg.map((x, i) => `${((i / (rg.length - 1)) * 600).toFixed(1)},${(140 - ((rt(x, mine) - lo) / (hi - lo)) * 140).toFixed(1)}`).join(' ');
      const ticks = [hi, Math.round((lo + hi) / 20) * 10, lo], top = (v) => (1 - (v - lo) / (hi - lo)) * 100;
      const low = rg.reduce((a, x) => (Math.min(rt(x, true), rt(x, false)) < Math.min(rt(a, true), rt(a, false)) ? x : a)), lowMine = rt(low, true) <= rt(low, false);
      chart = `<div class="rv-chart-box"><div class="rv-y" aria-hidden="true">${ticks.map((v) => `<span style="top:${top(v)}%">${v}</span>`).join('')}</div>
        <svg class="rv-chart" viewBox="0 0 600 140" preserveAspectRatio="none" role="img" aria-label="Both ratings over their ${rg.length} ${main} games">${ticks.map((v) => `<line x1="0" x2="600" y1="${(top(v) * 1.4).toFixed(1)}" y2="${(top(v) * 1.4).toFixed(1)}"/>`).join('')}<polyline class="a" points="${line(true)}"/><polyline class="b" points="${line(false)}"/></svg></div>
        <p class="rv-x"><span>${day(rg[0].g)}</span><span>${day(rg.at(-1).g)}</span></p>
        <p class="rv-legend"><span class="a">${A} ${rt(rg[0], true)} → ${rt(rg.at(-1), true)}</span><span class="b">${B} ${rt(rg[0], false)} → ${rt(rg.at(-1), false)}</span><span class="rv-low">Lowest: ${lowMine ? A : B} ${rt(low, lowMine)}, ${day(low.g)}</span></p>`;
    }
    const gap = group((x) => { const d = (rt(x, true) || 0) - (rt(x, false) || 0); return !rt(x, true) || !rt(x, false) ? null : d >= 100 ? `${A} 100+ higher` : d <= -100 ? `${B} 100+ higher` : 'Within 100'; }).map(([k, xs]) => wdlRow(k, xs));
    // The season: who won each month, and this month so far.
    const mk = (t) => new Date(t).toISOString().slice(0, 7), now = mk(Date.now());
    const season = group((x) => mk(x.g.createdAt)).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const tally = (xs) => [xs.filter((x) => x.res === 'W').length, xs.filter((x) => x.res === 'L').length];
    const won = season.map(([, xs]) => tally(xs)), mA = won.filter(([w, l]) => w > l).length, mB = won.filter(([w, l]) => l > w).length;
    const [tw, tl] = tally(g.filter((x) => mk(x.g.createdAt) === now));
    const thisMonth = tw + tl ? `${tw} – ${tl}<small>${tw > tl ? `${A} leads ${new Date().toLocaleDateString('en-GB', { month: 'long' })}` : tw < tl ? `${B} leads ${new Date().toLocaleDateString('en-GB', { month: 'long' })}` : 'Level so far'}</small>` : `0 – 0<small>No game yet this month. The first win leads it.</small>`;
    const seasonRows = season.slice(0, 12).map(([k, xs], i) => `<tr><th>${new Date(`${k}-15`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</th><td>${won[i][0]}</td><td>${won[i][1]}</td><td>${won[i][0] > won[i][1] ? A : won[i][0] < won[i][1] ? B : 'Level'}</td></tr>`).join('');
    const hour = (x) => new Date(x.g.createdAt).getHours();
    const brief = (gs) => gs.sort((a, b) => b[1].length - a[1].length).slice(0, 3).map(([k, xs]) => `${k}: ${games(xs.length)}, ${pct(pts(xs) / xs.length)}`).join(' · ');
    const when = brief(group((x) => (hour(x) < 6 ? 'Night (0–6)' : hour(x) < 12 ? 'Morning (6–12)' : hour(x) < 18 ? 'Afternoon (12–18)' : 'Evening (18–24)')));
    const days = brief(group((x) => `${new Date(x.g.createdAt).toLocaleDateString('en-GB', { weekday: 'long' })}s`));
    // Where they meet: the first three moves each, and the line that goes worst.
    // The openings they meet in, for each colour (Accepted and Declined together), and the one that goes worst.
    const famOf = (x) => (x.g.opening?.name || '').split(':')[0].replace(/ (Accepted|Declined)$/, '');
    const lines = group((x) => (famOf(x) ? `${x.side}|${famOf(x)}` : null)).filter(([, xs]) => xs.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
    const worst = lines.filter(([, xs]) => xs.length >= 3 && pts(xs) / xs.length < 0.5).sort((a, b) => pts(a[1]) / a[1].length - pts(b[1]) / b[1].length)[0];
    const colour = (k) => (k.startsWith('white') ? 'White' : 'Black'), fam = (k) => k.split('|')[1];
    // Records, each a game to open, and how far the one behind has to come.
    const len = (x) => (x.g.moves || '').split(' ').length, rated2 = g.filter((x) => rt(x, true) && rt(x, false));
    const quickWin = g.filter((x) => x.res === 'W' && len(x) >= 20).sort((a, b) => len(a) - len(b))[0], longLoss = g.filter((x) => x.res === 'L').sort((a, b) => len(b) - len(a))[0];
    const longest = g.slice().sort((a, b) => len(b) - len(a))[0], mate = g.filter((x) => x.g.status === 'mate').sort((a, b) => len(a) - len(b))[0];
    const upset = rated2.filter((x) => x.res !== 'D' && (x.res === 'W') === (rt(x, true) < rt(x, false))).sort((a, b) => Math.abs(rt(b, true) - rt(b, false)) - Math.abs(rt(a, true) - rt(a, false)))[0];
    const behind = r.w < r.l ? [me ? 'you' : A, runOf(old, 'W'), r.l - r.w, me ? 'Your' : `${A}'s`] : r.l < r.w ? [B, runOf(old, 'L'), r.w - r.l, `${B}'s`] : null;
    const dare = me ? '' : `<p class="rv-dare">${B}, ${r.l > r.w ? `you lead ${r.l}–${r.w}. Prove it again.` : r.l < r.w ? `you trail ${r.l}–${r.w}. Time to pay it back.` : `it is level at ${r.w}–${r.l}. Settle it.`}</p><p class="rv-side"><a href="rivals.html?u=${encodeURIComponent(vs)}&vs=${encodeURIComponent(name)}">Are you ${B}? See it from your side →</a></p>`;
    const challenge = `<a class="pf-rv-btn hot" href="https://lichess.org/?user=${encodeURIComponent(me ? r.name : name)}#friend" target="_blank" rel="noopener">Challenge ${me ? B : A} on Lichess →</a>`;
    const { game } = rivalKit(name, me);
    // The race: the score after every game, above the line when name leads.
    let run = 0; const lead = [0, ...old.map((x) => (run += x.res === 'W' ? 1 : x.res === 'L' ? -1 : 0))];
    const top = Math.max(1, ...lead), bot = Math.min(-1, ...lead), RX = (i) => (i / (lead.length - 1)) * 1000, RY = (v) => ((top - v) / (top - bot)) * 200;
    const rpts = lead.map((v, i) => `${RX(i).toFixed(1)},${RY(v).toFixed(1)}`).join(' ');
    let tick = '';
    old.forEach((x, i) => { const m = mk(x.g.createdAt); if (i && m === mk(old[i - 1].g.createdAt)) return; tick += `<line x1="${RX(i)}" x2="${RX(i)}" y1="0" y2="200" class="rv-tick"/>`; });
    const months2 = [...new Set(old.map((x) => mk(x.g.createdAt)))], mLab = (k) => new Date(`${k}-15`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    const race = `<figure class="rv-race"><div class="rv-race-plot"><span class="rv-race-up">↑ ${me ? 'you lead' : `${A} leads`}</span><span class="rv-race-down">↓ ${B} leads</span>
      <svg viewBox="0 0 1000 200" preserveAspectRatio="none" role="img" aria-label="The score after each of the ${r.n} games: ${lead.at(-1) >= 0 ? '+' : ''}${lead.at(-1)} now, best ${top}, worst ${bot}">${tick}
        <line x1="0" x2="1000" y1="${RY(0)}" y2="${RY(0)}" class="rv-zero"/><polygon points="0,${RY(0)} ${rpts} 1000,${RY(0)}" class="rv-area"/><polyline points="${rpts}" class="rv-run"/></svg></div>
      <figcaption><span>${mLab(months2[0])}</span><b>${lead.at(-1) > 0 ? '+' : ''}${lead.at(-1)} now · ${me ? 'your' : `${A}'s`} best ${Math.max(...lead) > 0 ? `+${Math.max(...lead)}` : Math.max(...lead)} · worst ${Math.min(...lead)}</b><span>${mLab(months2.at(-1))}</span></figcaption></figure>`;
    // The tug of war: the wins as one rope, halfway marked.
    const tug = `<div class="rv-tug" role="img" aria-label="${r.w} wins to ${r.l}, ${r.d} drawn"><div class="wdl"><span class="w" style="width:${(r.w / r.n) * 100}%"></span><span class="d" style="width:${(r.d / r.n) * 100}%"></span><span class="l" style="width:${(r.l / r.n) * 100}%"></span></div><i></i>
      <span class="rv-tug-a">${r.w} ${me ? 'you' : A}</span><span class="rv-tug-b">${B} ${r.l}</span></div>`;
    // Who is better at what: name's share of the points (or of the wins) in each part of the game, as a tug of war each.
    const share = (xs) => (xs.length ? pts(xs) / xs.length : null), endsBy = (res, st) => g.filter((x) => x.res === res && x.g.status === st).length;
    const sp = (k) => k[0].toUpperCase() + k.slice(1), part = (a, b) => (a + b ? a / (a + b) : null);
    const best = [[`${me ? 'You' : A} with White`, share(g.filter((x) => x.side === 'white')), `${g.filter((x) => x.side === 'white').length} games`],
      [`${me ? 'You' : A} with Black`, share(g.filter((x) => x.side === 'black')), `${g.filter((x) => x.side === 'black').length} games`],
      ...group((x) => x.g.speed).filter(([, xs]) => xs.length >= 3).sort((a, b) => b[1].length - a[1].length).map(([k, xs]) => [sp(k), share(xs), `${xs.length} games`]),
      ['Best run', part(runOf(old, 'W'), runOf(old, 'L')), `${runOf(old, 'W')} vs ${runOf(old, 'L')}`],
      ['Wins by mate', part(endsBy('W', 'mate'), endsBy('L', 'mate')), `${endsBy('W', 'mate')} vs ${endsBy('L', 'mate')}`],
      ['Wins on time', part(endsBy('W', 'outoftime'), endsBy('L', 'outoftime')), `${endsBy('W', 'outoftime')} vs ${endsBy('L', 'outoftime')}`]].filter(([, v]) => v != null);
    const better = (v) => (Math.abs(v - 0.5) < 0.03 ? 'Even' : v > 0.5 ? (me ? 'You' : A) : B);
    const bestRows = best.map(([label, v, n]) => `<div class="rv-bw"><span class="rv-bw-k">${label}</span><span class="rv-bw-bar"><i class="${v >= 0.5 ? 'a' : 'b'}" style="${v >= 0.5 ? 'right:50%' : 'left:50%'};width:${Math.abs(v - 0.5) * 100}%"></i></span><small class="rv-bw-n">${pct(v)} · ${n}</small><b>${better(v)}</b></div>`).join('');
    // The same, in words: the colours, the time controls, who finishes games.
    const wS = best[0][1], bS = best[1][1], spd = best.slice(2, -3), hiS = spd.slice().sort((a, b) => b[1] - a[1])[0], loS = spd.slice().sort((a, b) => a[1] - b[1])[0];
    const mateA = endsBy('W', 'mate'), mateB = endsBy('L', 'mate');
    const words = [`${me ? 'You score' : `${A} scores`} ${pct(wS)} with White and ${pct(bS)} with Black${Math.abs(wS - bS) >= 0.1 ? `: ${me ? 'you do' : `${A} does`} better with ${wS > bS ? 'White' : 'Black'}` : ''}.`,
      spd.length >= 2 && hiS !== loS ? `${me ? 'You are' : `${A} is`} closest in ${hiS[0].toLowerCase()} (${pct(hiS[1])}) and furthest off in ${loS[0].toLowerCase()} (${pct(loS[1])}).` : '',
      mateA + mateB >= 4 ? (mateB > mateA ? `${B} finishes games: ${mateB} of ${r.l} wins by mate.` : `${me ? 'You finish' : `${A} finishes`} games: ${mateA} of ${r.w} wins by mate.`) : ''].filter(Boolean).join(' ');
    let ch = 0; // chapters number themselves, in the order the template reads them
    const head = (title, sub) => `<div class="pf-more-head"><h2><span class="rv-ch">${++ch}</span>${title}</h2>${sub ? `<span>${sub}</span>` : ''}</div>`;
    el.classList.toggle('rv-neutral', !me); // a visitor gets one colour per player, not green and red for one side
    const who = (x) => (x.res === 'W' ? A : B);
    el.innerHTML = `<section class="rv-head"><span class="kicker-k">Rivalry · ${games(r.n)} since ${new Date(old[0].g.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span>
        <h1>${me ? 'You' : A} <span>vs</span> <a href="rivals.html?u=${encodeURIComponent(vs)}&vs=${encodeURIComponent(name)}" title="The same rivalry from ${esc(nick(vs))}'s side">${B}</a></h1>
        <div class="rv-score"><b class="${r.w > r.l ? 'good' : r.w < r.l ? 'bad' : ''} p-a">${r.w}</b><span>–</span><b class="${r.l > r.w ? 'good' : r.l < r.w ? 'bad' : ''} p-b">${r.l}</b><small>${r.d ? `${r.d} drawn · ` : ''}${me ? 'you score' : `${A} scores`} ${pct(r.score)}</small></div>
        ${tug}${dare}${behind ? `<p class="rv-level">To draw level, ${behind[0]} ${behind[0] === 'you' ? 'need' : 'needs'} <b>${behind[2]} wins in a row</b>. ${behind[3]} best run so far: ${behind[1]}.</p>` : ''}
        <div class="pf-rv-acts">${challenge}</div>${acts(r, true)}<p class="pf-share-note rv-note" aria-live="polite"></p></section>
      <section class="pf-card">${head('The story')}${race}<div class="pf-rv-lead${r.score < 0.5 ? ' bad' : ''}">${story(r, true)}</div></section>
      <section class="pf-card">${head('Who is better at what')}<p class="rv-words">${words}</p><div class="rv-best"><div class="rv-bw rv-bw-head"><span></span><span class="rv-bw-bar"><small>← ${me ? 'you' : A} better</small><small>${B} better →</small></span><span></span><span></span></div>${bestRows}</div></section>
      ${chart || gap.length ? `<section class="pf-card">${head('Rating and upsets', chart ? `${main[0].toUpperCase() + main.slice(1)}, at the time of each game` : '')}${chart}${gap.length ? `<div class="pf-two">${table('By rating gap', gap)}</div>` : ''}</section>` : ''}
      ${lines.length ? `<section class="pf-card">${head('The openings', `How each opening goes for ${me ? 'you' : A} against ${B}, by colour`)}
        <table class="pf-rv-table"><thead><tr><th>Opening</th><th>Games</th><th>W–D–L</th><th class="wide-only"></th><th>${me ? 'You' : A}</th></tr></thead><tbody>${lines.map(([k, xs]) => wdlRow(`<span class="rv-op">${esc(fam(k))}</span><small class="rv-fam">${me ? 'You' : A} as ${colour(k)}</small>`, xs)).join('')}</tbody></table>
        ${worst ? `<p class="rv-turn"><span><b>Where it goes wrong:</b> as ${colour(worst[0])} in the ${esc(fam(worst[0]))}, ${me ? 'you have' : `${A} has`} won ${worst[1].filter((x) => x.res === 'W').length} of ${worst[1].length} games against ${B}.</span>${me ? ` <a class="pf-rv-btn hot" href="index.html?${esc(new URLSearchParams({ practise: `${worst[0][0] === 'w' ? 'w' : 'b'}:${fam(worst[0])}`, rv: nick(r.name), rn: worst[1].length, rs: Math.round((pts(worst[1]) / worst[1].length) * 100) }).toString())}">Practise the ${esc(fam(worst[0]))} as ${colour(worst[0])} →</a>` : ''}</p>` : ''}</section>` : ''}
      <section class="pf-card">${head('Records')}<ul class="pf-rv-games">${game(longest, `Longest game · ${Math.ceil(len(longest) / 2)} moves`)}${mate ? game(mate, `Quickest mate · ${who(mate)}, in ${Math.ceil(len(mate) / 2)} moves`) : ''}${upset ? game(upset, `Biggest upset · ${who(upset)} won, ${Math.abs(rt(upset, true) - rt(upset, false))} points lower`) : ''}${quickWin ? game(quickWin, `${me ? 'Your' : `${A}'s`} quickest win`) : ''}${longLoss ? game(longLoss, `${me ? 'Your' : `${A}'s`} longest loss`) : ''}${game(g[0], 'Latest')}</ul></section>
      ${tw + tl ? `<div class="rv-now"><span class="kicker-k">${new Date().toLocaleDateString('en-GB', { month: 'long' })} · this month</span><b>${thisMonth}</b></div>` : ''}
      <details class="pf-card rv-details"><summary><b>More numbers</b><span>The season month by month, when you play, time controls, how games end</span></summary>
        <div class="pf-two"><section><h3>Month by month <small>· months won: ${A} ${mA}, ${B} ${mB}</small></h3><table class="pf-rv-table"><thead><tr><th></th><th>${me ? 'You' : A}</th><th>${B}</th><th>Won by</th></tr></thead><tbody>${seasonRows}</tbody></table></section>
        <section>${table('By time control', speeds)}${kinds.length > 1 ? table('Rated and casual', kinds) : ''}</section></div>
        <dl class="pf-rv-facts rv-more"><div><dt>Time of day <small>(${me ? 'your' : `${A}'s`} score)</small></dt><dd class="rv-small">${when}</dd></div><div><dt>Most played days</dt><dd class="rv-small">${days}</dd></div>
          <div><dt>${me ? 'Your' : `${A}'s`} wins end by</dt><dd class="rv-small">${ends('W')}</dd></div><div><dt>${me ? 'Your' : `${A}'s`} losses end by</dt><dd class="rv-small">${ends('L')}</dd></div>
          <div><dt>Moves in a win</dt><dd>${avg(wins)}</dd></div><div><dt>Moves in a loss</dt><dd>${avg(losses)}</dd></div></dl></details>
      <div class="pf-rv-acts rv-end">${challenge}${me ? '' : '<a class="pf-rv-btn" href="rivals.html">See your own rivals →</a>'}</div>
      <p class="info"><a href="rivals.html?u=${encodeURIComponent(name)}">All of ${me ? 'your' : `${A}'s`} rivals</a> · <a href="profile.html?u=${encodeURIComponent(vs)}">${B}'s profile</a> · <a href="profile.html?u=${encodeURIComponent(name)}&vs=${encodeURIComponent(vs)}">Compare their cards</a></p>`;
    el.querySelector('[data-rv-share]')?.addEventListener('click', async () => {
      const url = `https://chesslabs.gg/rivals.html?u=${encodeURIComponent(name)}&vs=${encodeURIComponent(vs)}`, text = `${nick(name)} vs ${nick(vs)}: ${r.w}–${r.l}${r.d ? ` (${r.d} drawn)` : ''} on Chess Labs`;
      if (navigator.share) return navigator.share({ title: 'Chess Labs', text, url }).catch(() => {});
      try { await navigator.clipboard.writeText(url); el.querySelector('.rv-note').textContent = 'Link copied. Send it to your rival.'; } catch { prompt('Copy the link', url); }
    });
    window.track?.('rivalry', `${name} vs ${vs}`);
  } catch (err) { msg.textContent = err.message; }
}
// What others see: logged in, a player can hide parts of their profile from visitors. Kept in
// opening-book-v2-hidden (synced to their account); the userdata function answers ?hidden=<name> to anyone.
// The menu above the rating graph: one link per part the profile shows, each scrolling to it.
const JUMPS = [['Rating', '#pf-chart'], ['Numbers', '.pf-kpis'], ['Skills', '#pf-skills'], ['Trend', '#pf-trend'], ['Results', '.pf-more'],
  ['For you', '.pf-fit'], ['Opponents', '.pf-opps'], ['Rivals', '#rivals'], ['Games', '#pf-games'], ['Stars', '#pf-stars']];
function jumpNav() {
  const nav = $('#profile .pf-jump');
  if (nav) nav.innerHTML = JUMPS.filter(([, sel]) => $(`#profile ${sel}:not([data-off])`)).map(([label, sel]) => `<button type="button" data-jump="${sel}">${label}</button>`).join('');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-jump]'); if (!b) return;
  $(`#profile ${b.dataset.jump}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});
const PANELS = [['chart', 'Rating graph', '#pf-chart'], ['kpis', 'Key numbers', '.pf-kpis'], ['lead', 'Latest games', '.pf-lead'], ['skills', 'Skills', '#pf-skills'], ['trend', 'Trend', '#pf-trend'],
  ['more', 'Results and openings', '.pf-more'], ['opps', 'Against each kind of opponent', '.pf-opps'], ['rivals', 'Rivals', '.pf-rivals'], ['games', 'Recent games', '#pf-games']];
const HIDE = 'opening-book-v2-hidden';
const myHidden = () => { try { return JSON.parse(localStorage.getItem(HIDE)) || []; } catch { return []; } };
const HIDDEN = {};
const hiddenOf = (name) => (HIDDEN[name.toLowerCase()] ??= fetch(`https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/userdata?hidden=${encodeURIComponent(name.toLowerCase())}`).then((r) => (r.ok ? r.json() : [])).catch(() => []));
// Your own profile shows everything, each part with a label (Public or Only you) that switches it; a visitor's
// leaves the hidden parts out.
function applyHidden(name, me) {
  if (me) return labels();
  hiddenOf(name).then((off) => { if (shown?.[0] !== name || !Array.isArray(off)) return; for (const [k, , sel] of PANELS) if (off.includes(k)) $(`#profile ${sel}`)?.setAttribute('data-off', ''); jumpNav(); });
}
function labels() {
  const on = shown && isMe(shown[0]) && account(), off = myHidden();
  for (const [k, label, sel] of PANELS) {
    const el = $(`#profile ${sel}`);
    if (!el) continue;
    let b = el.querySelector(':scope > .pf-vis');
    if (!on) { b?.remove(); continue; }
    const hid = off.includes(k), state = hid ? 'off' : 'on';
    el.toggleAttribute('data-private', hid);
    if (b?.dataset.state === state) continue; // unchanged: no write, so the observer below stays quiet
    if (!b) { el.insertAdjacentHTML('beforeend', `<button type="button" class="pf-vis" data-panel="${k}"></button>`); b = el.lastElementChild; }
    b.dataset.state = state;
    b.innerHTML = `<i aria-hidden="true"></i>${hid ? 'Only you' : 'Public'}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5h10M9 2l3 3-3 3M14 11H4M7 8l-3 3 3 3"/></svg>`;
    b.title = hid ? `${label}: only you see it. Tap to show it to everyone` : `${label}: everyone sees it. Tap so only you do`;
    b.setAttribute('aria-pressed', String(!hid));
  }
}
// Parts drawn later (the graph, the trend, the games) get their label as they appear.
let labelling = false;
new MutationObserver(() => { if (!labelling) { labelling = true; requestAnimationFrame(() => { labelling = false; labels(); }); } }).observe($('#profile') || document.body, { childList: true, subtree: true });
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('#profile .pf-vis');
  if (!b) return;
  const off = new Set(myHidden());
  if (off.has(b.dataset.panel)) off.delete(b.dataset.panel); else off.add(b.dataset.panel);
  try { localStorage.setItem(HIDE, JSON.stringify([...off])); } catch {}
  labels();
});
function starsCard() {
  const { ops, sum } = starCounts();
  if (!ops.length) return `<section class="pf-card pf-stars"><h2>Your stars</h2><p class="info">Learn a line in the <a href="./">Openings trainer</a> for your first green star; clear it in Practice for gold, and play it without a slip in the time trial for a diamond.</p></section>`;
  const nameOf = (id) => id.replace(/^b:/, '').replace(/^vs:/, 'vs ');
  const sideOf = (id) => (/^(b|vs):/.test(id) ? 'b' : 'w');
  return `<section class="pf-card pf-stars" id="pf-stars"><h2>Your stars</h2>
    <div class="pf-star-totals">${[['green', 'learned'], ['gold', 'cleared'], ['diamond', 'perfect in Time']].map(([k, w]) => `<div>${starIcon(k)}<b>${sum(k)}</b><span>${w}</span></div>`).join('')}</div>
    <ul class="pf-star-ops">${ops.slice(0, 6).map((o) => `<li><a class="pf-op-link" href="${practiseLink(sideOf(o.id), nameOf(o.id))}">${esc(nameOf(o.id))}</a>
      <span>${['green', 'gold', 'diamond'].filter((k) => o[k].size).map((k) => `${starIcon(k)}${o[k].size}`).join(' ')}</span></li>`).join('')}</ul>
    <p class="info">${account() ? 'Saved on your Lichess account' : 'Saved in this browser'}. A line counts once, in every time control.</p></section>`;
}
// The same stars in one row under the card; it leads to the full list further down.
function starsStrip() {
  const { ops, sum } = starCounts();
  return `<a class="pf-star-strip" href="#pf-stars" title="Your stars from the Openings trainer">${ops.length
    ? `${starIcon('green')}<b>${sum('green')}</b>${starIcon('gold')}<b>${sum('gold')}</b>${starIcon('diamond')}<b>${sum('diamond')}</b><span>stars</span>`
    : `${starIcon('green')}<span>No stars yet: learn a line in the trainer</span>`}</a>`;
}
// The stars in this browser, per opening and in all (see starsCard).
function starCounts() {
  let all = {};
  try { all = JSON.parse(localStorage.getItem('opening-book-v2')) || {}; } catch {}
  const per = new Map();
  for (const [key, st] of Object.entries(all)) {
    if (!st || typeof st !== 'object') continue;
    const id = key.slice(key.indexOf(':') + 1), lines = new Set([...(st.played || []), ...(st.done || [])]);
    const o = per.get(id) || { id, green: new Set(), gold: new Set(), diamond: new Set() };
    lines.forEach((l) => o.green.add(l)); (st.done || []).forEach((l) => o.gold.add(l)); (st.timed || []).forEach((l) => o.diamond.add(l));
    per.set(id, o);
  }
  const ops = [...per.values()].map((o) => ({ ...o, n: o.green.size + o.gold.size + o.diamond.size })).filter((o) => o.n).sort((a, b) => b.n - a.n);
  const sum = (k) => ops.reduce((t, o) => t + o[k].size, 0);
  return { ops, sum };
}
function nextActions(name, me, skills = []) {
  const weak = skills.filter((x) => x.v !== null && x.href).sort((a, b) => a.v - b.v)[0]; // your weakest skill, trained where its tip points
  return `<section class="pf-next"><h2>What next</h2><div>
    ${me ? weak ? `<a class="cta" href="${weak.href}" title="${esc(weak.train)}">Practise your weakest skill: ${esc(weak.label)}</a><a class="ghost" href="practice.html">Your training plan</a>` : '<a class="cta" href="practice.html">Open your training plan</a>' : ''}
    <a class="${me ? 'ghost' : 'cta'}" href="${pickLink(name)}">${me ? 'Compare with someone' : `Compare ${esc(nick(name))}`}</a>
    <a class="ghost" href="${agoLink(name, 12)}">${me ? 'You now vs a year ago' : 'Now vs a year ago'}</a>
  </div></section>`;
}

// ---------- Rating over time ----------
// Lichess's own rating history (all time, every time control) when it answers, else the ratings after
// the games read here, which reach back as far as those 500 games do.
const RANGES = [['1W', 7], ['1M', 30], ['6M', 182], ['1Y', 365], ['All', Infinity]];
const DAY = 864e5;
async function historyOf(name, p) {
  if (!isCC(name)) try {
    const res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(name)}/rating-history`, { headers: lichessAuth() });
    const perfs = res.ok ? await res.json() : [];
    const h = {};
    for (const x of perfs) if (x.points.length) h[x.name.toLowerCase()] = x.points.map(([y, m, d, r]) => [Date.UTC(y, m, d), r]);
    if (Object.keys(h).length) return { h, full: true };
  } catch {}
  return { h: p.history || {}, full: false };
}
let chartState = { speed: null, range: '1M' };
async function ratingChart(name, p) {
  const el = $('#pf-chart');
  el.innerHTML = '<h2>Rating</h2><p class="info">Loading the rating history…</p>';
  const { h, full } = await historyOf(name, p);
  const speeds = ['bullet', 'blitz', 'rapid', 'classical'].filter((k) => h[k]?.length > 1);
  if (!el.isConnected) return;
  if (!speeds.length) { el.innerHTML = '<h2>Rating</h2><p class="info">No rating history yet. Press Refresh to read the games again.</p>'; return; }
  if (!speeds.includes(chartState.speed)) chartState.speed = speeds.includes(p.speeds[0]?.speed) ? p.speeds[0].speed : speeds[0];
  if (!chartState.picked) { // the first look: the shortest period from a month up with at least two games in it
    const pts = h[chartState.speed];
    chartState.range = (RANGES.find(([, d]) => d >= 30 && pts.filter(([t]) => t >= Date.now() - d * DAY).length >= 2) || RANGES.at(-1))[0];
  }
  const draw = () => {
    const all = h[chartState.speed], days = RANGES.find(([k]) => k === chartState.range)[1];
    const end = Date.now(), from = days === Infinity ? all[0][0] : end - days * DAY;
    // The rating going into the range, every change inside it, and the rating held until today, so a
    // quiet week still has a line and the cursor reaches the right edge.
    const before = all.filter(([t]) => t < from).pop(), inside = all.filter(([t]) => t >= from);
    const pts = [...(before ? [[from, before[1]]] : []), ...inside];
    if (pts.length && pts[pts.length - 1][0] < end) pts.push([end, pts[pts.length - 1][1]]);
    const first = all[0][0];
    const covers = full || from >= first;
    el.innerHTML = `<div class="pf-chart-head"><h2>Rating</h2>
      <div class="pf-seg" role="group" aria-label="Time control">${speeds.map((k) => `<button type="button" data-speed="${k}" aria-pressed="${k === chartState.speed}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
      <div class="pf-seg" role="group" aria-label="Period">${RANGES.map(([k]) => `<button type="button" data-range="${k}" aria-pressed="${k === chartState.range}">${k}</button>`).join('')}</div></div>
      ${pts.length < 2 ? '<p class="info">No rated games in this period.</p>' : lineChart(pts, from, end)}
      ${covers ? '' : `<p class="info pf-note">The graph starts at ${new Date(first).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, the oldest of the games read here. ${lichessAuth().Authorization || isCC(name) ? '' : 'Lichess gives the full history only to someone logged in. <button type="button" class="link" data-chart-login>Log in with Lichess</button>'}</p>`}`;
    el.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => { chartState.speed = b.dataset.speed; draw(); }));
    el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { chartState.range = b.dataset.range; chartState.picked = true; draw(); }));
    el.querySelector('[data-chart-login]')?.addEventListener('click', login);
    hover(el);
  };
  draw();
}
const fmtDay = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
// One line, one axis: rating against time, with the change over the period in the corner.
function lineChart(pts, from, end) {
  const W = 760, H = 240, L = 66, R = 12, T = 14, B = 26;
  const lo = Math.min(...pts.map((x) => x[1])), hi = Math.max(...pts.map((x) => x[1]));
  const pad = Math.max(10, (hi - lo) * 0.12), y0 = Math.floor((lo - pad) / 10) * 10, y1 = Math.ceil((hi + pad) / 10) * 10;
  const x = (t) => L + ((t - from) / Math.max(1, end - from)) * (W - L - R), y = (r) => T + (1 - (r - y0) / (y1 - y0)) * (H - T - B);
  const ticks = [0, 1, 2, 3].map((k) => Math.round(y0 + ((y1 - y0) * k) / 3));
  const line = pts.map(([t, r], k) => `${k ? 'L' : 'M'}${x(t).toFixed(1)},${y(r).toFixed(1)}`).join('') + `L${x(end).toFixed(1)},${y(pts[pts.length - 1][1]).toFixed(1)}`;
  const change = pts[pts.length - 1][1] - pts[0][1];
  // The highest and lowest rating in the period, with the day, also marked on the line.
  const top = pts.reduce((a, q) => (q[1] > a[1] ? q : a)), low = pts.reduce((a, q) => (q[1] < a[1] ? q : a));
  const mark = (q, cls) => `<circle class="${cls}" cx="${x(q[0]).toFixed(1)}" cy="${y(q[1]).toFixed(1)}" r="4"/>`;
  return `<p class="pf-chart-now"><b>${pts[pts.length - 1][1]}</b> <span class="${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : '−'}${Math.abs(change)}</span> <small>since ${fmtDay(pts[0][0])}</small>
      <span class="pf-hilo"><span><small><i class="hi"></i>High</small><b>${top[1]}</b><small>${fmtDay(top[0])}</small></span><span><small><i class="lo"></i>Low</small><b>${low[1]}</b><small>${fmtDay(low[0])}</small></span></span></p>
    <svg class="pf-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rating from ${pts[0][1]} to ${pts[pts.length - 1][1]} between ${fmtDay(from)} and ${fmtDay(end)}"
      data-pts='${JSON.stringify(pts.map(([t, r]) => [Math.round(x(t)), Math.round(y(r)), r, t]))}'>
      ${ticks.map((r) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(r)}" y2="${y(r)}"/><text class="ax" x="${L - 8}" y="${y(r) + 4}" text-anchor="end">${r}</text>`).join('')}
      <text class="ax" x="${L}" y="${H - 6}">${fmtDay(from)}</text><text class="ax" x="${W - R}" y="${H - 6}" text-anchor="end">Today</text>
      <path class="ln" d="${line}"/>${mark(top, 'hi')}${mark(low, 'lo')}
      <g class="hov" visibility="hidden"><line class="cross" y1="${T}" y2="${H - B}"/><circle r="5"/></g>
      <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>
    </svg><p class="pf-tip" aria-live="polite"></p>`;
}
// Crosshair and tooltip: the nearest game to the pointer.
function hover(el) {
  const svg = el.querySelector('.pf-line');
  if (!svg) return;
  const pts = JSON.parse(svg.dataset.pts), g = svg.querySelector('.hov'), tip = el.querySelector('.pf-tip');
  const move = (e) => {
    const b = svg.getBoundingClientRect(), px = ((e.clientX - b.left) / b.width) * 760;
    // Anywhere on the line, not only at games: the rating then is the one after the last game before it,
    // the dot sits on the drawn line, and the date follows the cursor (the x axis is time).
    const x = Math.max(pts[0][0], Math.min(pts[pts.length - 1][0], px));
    const i = Math.max(0, pts.findLastIndex((q) => q[0] <= x)), a = pts[i], z = pts[Math.min(i + 1, pts.length - 1)];
    const f = z[0] > a[0] ? (x - a[0]) / (z[0] - a[0]) : 0;
    g.setAttribute('visibility', 'visible');
    g.querySelector('line').setAttribute('x1', x); g.querySelector('line').setAttribute('x2', x);
    g.querySelector('circle').setAttribute('cx', x); g.querySelector('circle').setAttribute('cy', a[1] + (z[1] - a[1]) * f);
    tip.textContent = `${f > 0.999 ? z[2] : a[2]} on ${fmtDay(a[3] + (z[3] - a[3]) * f)}`;
    tip.style.left = `${b.left - el.getBoundingClientRect().left + (x / 760) * b.width}px`; // an SVG has no offsetLeft
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => { g.setAttribute('visibility', 'hidden'); tip.textContent = ''; });
}

function ask() {
  $('#profile').innerHTML = `<section class="picker"><h1>Your profile</h1>
    <p class="info">Log in (with Lichess, or with a Chess Labs account for your Chess.com name) and this page reads your last ${MAX} rated games: what kind of player you are, what you are good at, what to work on, and your stats.</p>
    <p><button id="pf-login" class="cta" type="button">Log in</button></p>
    <p class="info">Or look up any player:</p>${search('Look up')}</section>`;
  $('#pf-login').addEventListener('click', openLogin);
  bindSearch();
}

let runs = 0; // a newer look-up wins over one still reading games
async function run(name) {
  unbusy();
  hiddenOf(name); // asked at once, so the answer is in before the first draw
  await gamesReady;
  combo = null;
  const mine = ++runs;
  // A known pro or streamer: their profile and games as read by tools/snapshot_pros.py, drawn once with nothing fetched;
  // their other accounts are fetched behind it, so a switch between them is instant too.
  const s = proOf(name) && !SNAPSHOT ? (await Promise.all([snapOf(name), lastPlayed()]))[0] : null;
  if (s) useSnap(name, s);
  if (freshSnap(s)) {
    await loadScores();
    if (mine !== runs) return;
    if (shown && shown[0].toLowerCase() !== name.toLowerCase()) pfSpeed = null; // another account starts on its own main time control
    render(s.name || name, s.at, s.p);
    window.track?.('profile', `${s.name || name} #${shownCode}`);
    PEOPLE.filter(([, w]) => w === proOf(name)).forEach(([n]) => snapOf(n));
    otherSpeeds(name);
    return;
  }
  const c = cache()[name.toLowerCase()] || (s?.v === PV ? s : null);
  await loadScores(); // a saved profile is drawn without reading the games, but its time controls are read again
  if (shown && shown[0].toLowerCase() !== name.toLowerCase()) pfSpeed = null; // another player starts on their own main time control
  // Seen before: show the saved profile at once, then fetch new games quietly and redraw only if there were any.
  if (c && c.v === PV) {
    try { render(c.name || name, c.at, c.p); } catch (err) { console.warn('saved profile could not be shown, reading it again', err); }
    window.track?.('profile', `${c.name || name} #${shownCode}`); // counted only for a player that was found, with their card for the admin page
    const before = storedGames(name) || [], top = before[0]?.id; // no games kept here yet: redraw once they are, with their time controls
    const fresh = async () => {
      quiet = true;
      try {
        const p = await build(name), after = storedGames(name);
        if (mine === runs) unbusy();
        if (mine === runs && (merged || after[0]?.id !== top || after.length !== before.length || !before.length)) { const y = scrollY; render(name, Date.now(), p); scrollTo(0, y); }
      } catch (err) { if (mine === runs) { if (BUSY.test(err.message)) busy(name, c.at, fresh); else unbusy(); } } finally { quiet = false; }
    };
    await fresh();
    if (mine === runs) await ownSpeed(name);
    if (mine === runs) otherSpeeds(name);
    return;
  }
  // A skeleton of the page while the games are read, so it is never blank.
  $('#profile').innerHTML = `<section class="pf-hero pf-skeleton" aria-hidden="true"><div class="pf-card-col"><div class="pf-pcard"><b class="pf-ovr">–</b><p class="pf-pcard-name">${esc(nick(name))}</p></div></div>
    <div class="pf-hero-text"><span class="pf-sk-line w60"></span><span class="pf-sk-line"></span><span class="pf-sk-line"></span><span class="pf-sk-line w80"></span></div></section>`;
  $('#profile-msg').textContent = '';
  loadBar.show(`Looking up ${nick(name)} on ${siteOf(name)}…`);
  rise = true; // the page comes up when its first card is drawn
  // Lichess can be slow to start sending games; say so instead of leaving the page blank.
  const slow = setTimeout(() => { if (mine === runs && loadBar.on() && !$('#pf-load i').style.width.match(/[1-9]/)) loadBar.step(0, `${siteOf(name)} is slow right now; still waiting for ${nick(name)}'s games…`); }, 12000);
  holdBar = true; // up through the main time control's own games too
  try {
    const p = await build(name);
    if (mine === runs) render(name, Date.now(), p);
    if (SNAPSHOT) window.snapOut = { ...cache()[name.toLowerCase()], games: MEM.get(name.toLowerCase())?.games, skills: Object.fromEntries(skillsOf(p).filter((x) => x.v !== null).map((x) => [x.label, Math.round(x.v)])) }; // for tools/snapshot_pros.py
    window.track?.('profile', `${cache()[name.toLowerCase()]?.name || name} #${shownCode}`);
    if (mine === runs) await ownSpeed(name);
    if (mine === runs) { holdBar = false; loadBar.done(); otherSpeeds(name); }
  } catch (err) {
    // A name typed without picking "On Chess.com" is looked up on Lichess first; not there, Chess.com's is shown.
    if (mine === runs && !isCC(name) && /no player/.test(err.message) && await ccUser(name)) { history.replaceState(null, '', `?u=${encodeURIComponent(`cc:${name}`)}`); return run(`cc:${name}`); }
    if (mine === runs) failed(name, err);
  } finally { clearTimeout(slow); if (mine === runs) { holdBar = false; loadBar.done(); } }
}
// Combined: the games of every linked account that is switched on, read together. Ratings are never
// mixed: the card is drawn as the account with the most games in the time control played most, with
// its rating and site, and each time control's rating is that account's (or the one with most games in it).
let combo = null, comboOwn = false; // the accounts on the Combined profile, or null; whether they are yours (switches and links) or a pro's
async function combined(name) {
  const who = !isMe(name) && proOf(name), own = isMe(name);
  const group = own ? groupOf(name) : who ? Object.entries({ ...PRO_NAMES, ...VIP_NAMES }).filter(([, w]) => w === who).map(([n]) => n) : null;
  if (!group || group.length < 2) { combo = null; return show(name, false); }
  const mine = ++runs, on = own ? group.filter((n) => !isOff(n)) : group;
  combo = group; comboOwn = own;
  if (!$('#profile .pf-hero')) $('#profile').innerHTML = `<section class="pf-hero pf-skeleton" aria-hidden="true"><div class="pf-card-col"><div class="pf-pcard"><b class="pf-ovr">–</b><p class="pf-pcard-name">${esc(cardName(name))}</p></div></div>
    <div class="pf-hero-text"><span class="pf-sk-line w60"></span><span class="pf-sk-line"></span><span class="pf-sk-line"></span><span class="pf-sk-line w80"></span></div></section>`;
  await gamesReady; await loadScores();
  // A pro's or VIP's accounts: their snapshots' games, so only a stale one is fetched.
  const snaps = who && !SNAPSHOT ? (await Promise.all([lastPlayed(), ...on.map(snapOf)])).slice(1) : [];
  snaps.forEach((s, i) => useSnap(on[i], s));
  if (mine !== runs) return;
  quiet = true;
  try {
    for (const [i, n] of on.entries()) { if (freshSnap(snaps[i])) continue; $('#profile-msg').textContent = `Fetching ${nick(n)}'s games from ${siteOf(n)}…`; await build(n); }
  } catch (err) { if (mine === runs) failed(name, err); return; } finally { quiet = false; }
  if (mine !== runs) return;
  $('#profile-msg').textContent = on.length ? '' : 'Every account is switched off: switch one on to see the card.';
  const games = on.flatMap((n) => recordsOf(n, storedGames(n) || []).map((g) => ({ ...g, acct: n }))).sort((a, b) => b.at - a.at);
  if (!games.length) { $('#profile').innerHTML = own ? comboRow() : ''; return; }
  const full = profileOf(games), most = (sp) => on.map((n) => [n, games.filter((g) => g.acct === n && g.speed === sp).length]).sort((a, b) => b[1] - a[1])[0][0];
  const owner = most(full.speeds[0].speed);
  for (const x of full.speeds) {
    const who = games.some((g) => g.acct === owner && g.speed === x.speed) ? owner : most(x.speed), gs = games.filter((g) => g.acct === who && g.speed === x.speed);
    Object.assign(x, { rating: gs[0].rating + gs[0].diff, change: gs[0].rating + gs[0].diff - gs.at(-1).rating });
  }
  // The other site's rating too, never mixed in: its switched-on account with the most games in the main time control.
  const sp0 = full.speeds[0].speed, other = on.filter((n) => isCC(n) !== isCC(owner)).map((n) => games.filter((g) => g.acct === n && g.speed === sp0)).filter((gs) => gs.length).sort((a, b) => b.length - a.length)[0];
  full.also = other ? { site: siteOf(other[0].acct), rating: other[0].rating + other[0].diff } : null;
  full.type = typeOf(full);
  comboGames = games;
  render(owner, Date.now(), full);
}
let comboGames = [];
// The time control the card opens on reads its own last 500 games, fetched once after the player's
// games are in, as picking it does: not just its share of the last 500 of all.
async function ownSpeed(name) {
  const sp = document.querySelector('[data-pf-speed][aria-pressed="true"]')?.dataset.pfSpeed;
  if (SNAPSHOT || !sp || sp === 'all' || storedGames(speedKey(name, sp))) return;
  const st = loadSpeed(name, sp);
  if (loadBar.on()) { barFor = st.key; loadBar.step(st.of ? (st.k / st.of) * 100 : 0, st.say()); }
  if (await st.done && shown?.[0].toLowerCase() === name.toLowerCase()) { const y = scrollY; render(...shown); scrollTo(0, y); }
}
// Each time control's own last 500 games, the one shown first and then the others behind the profile,
// one at a time; one picked while still coming shows the bar until it is in.
const SPEEDLOAD = new Map(); // `${name}~${sp}` → { done: promise, k, of }
let barFor = ''; // the time control whose progress the bar shows
function loadSpeed(name, sp) {
  const key = `${name.toLowerCase()}~${sp}`;
  if (!SPEEDLOAD.has(key)) {
    const st = { k: 0, of: 0 };
    const say = () => `Fetching ${nick(name)}'s ${sp} games from ${siteOf(name)}: ${st.k} of ${st.of}`;
    st.done = fetchSpeed(name, sp, (k, of) => { Object.assign(st, { k, of }); if (barFor === key) loadBar.step(of ? (k / of) * 100 : 0, say()); })
      .catch(() => false).finally(() => { st.over = true; });
    st.say = say; st.key = key;
    SPEEDLOAD.set(key, st);
  }
  return SPEEDLOAD.get(key);
}
async function otherSpeeds(name) {
  if (SNAPSHOT) return;
  for (const sp of SPEEDS) {
    if (shown?.[0].toLowerCase() !== name.toLowerCase() || combo) return; // another player or Combined: stop
    if (!storedGames(speedKey(name, sp))) await loadSpeed(name, sp).done;
  }
}
// Lichess or Chess.com said "too many requests". The profile stays as it was saved (or its outline, for a
// player not seen before), and a line over it counts a minute down and reads the games again by itself.
const BUSY = /is busy right now/;
let busyTimer = 0;
function busy(name, at, retry) {
  clearInterval(busyTimer);
  if (!$('#pf-busy')) $('#profile-msg').insertAdjacentHTML('beforebegin', `<div id="pf-busy" class="pf-busy" role="status"><p></p><div class="pf-busy-row"><div class="pf-busy-track"><i></i></div><span class="pf-busy-k"></span><button type="button" class="ghost">Try now</button></div></div>`);
  const el = $('#pf-busy'), bar = el.querySelector('i'), k = el.querySelector('.pf-busy-k'), end = Date.now() + 60e3;
  el.querySelector('p').innerHTML = at ? `<b>From games read ${ago(at)}.</b> ${siteOf(name)} is busy right now; new games load by themselves.`
    : `<b>${siteOf(name)} needs a breather.</b> Lots of people are looking up players right now; ${esc(nick(name))}'s games load by themselves.`;
  const go = () => { clearInterval(busyTimer); bar.style.width = '100%'; k.textContent = 'Trying again…'; el.querySelector('button').disabled = true; retry(); };
  el.querySelector('button').disabled = false;
  el.querySelector('button').onclick = go;
  const tick = () => { const left = end - Date.now(); if (left <= 0) return go(); bar.style.width = `${100 - left / 600}%`; k.textContent = `Trying again in ${Math.ceil(left / 1000)} s`; };
  tick(); busyTimer = setInterval(tick, 250);
}
function unbusy() { clearInterval(busyTimer); $('#pf-busy')?.remove(); }
// Something went wrong: say what, and offer to try again (reading the games afresh).
const retried = new Set(), NET = /Failed to fetch|Load failed|NetworkError/i;
function failed(name, err) {
  console.error(err);
  // A dropped connection (common on phones) is tried again once by itself before it is shown.
  const net = err instanceof TypeError && NET.test(err.message);
  if (net && !retried.has(name.toLowerCase())) { retried.add(name.toLowerCase()); setTimeout(() => run(name), 1500); return; }
  if (net) err = new Error(`Could not reach ${siteOf(name)}: the connection dropped.`);
  if (BUSY.test(err.message)) return busy(name, null, () => run(name)); // the outline stays, the line over it waits
  window.trackError?.(`${name}: ${err.message || err}`);
  $('#profile .pf-skeleton')?.remove(); // the loading outline, never a card already drawn
  $('#profile-msg').innerHTML = `${esc(err.message || String(err))} <button type="button" class="link" data-retry>Try again</button>`;
  $('[data-retry]').addEventListener('click', () => run(name));
}

// A profile from games already fetched (Lichess's shape), without fetching: for checking the types on many players.
const profileFromRaw = async (name, raw) => (await loadScores(), profileOf(raw.map((g) => readGame(g, name.toLowerCase()))));
export { TYPE_ABOUT, BIOS, keptTypes, cardImage, playerCard, flagHtml, loadFlags, bandColor, tierOf, TIERS_AT, proClass, proOf, PROS, boardCard, fineSkillsOf, gamesReady, build, current, cache, myName, skillsOf, storedGames, keepGame, engineEval, applyEvals, winPct, PV, traitsOf, profileFromRaw };
// ---------- The games themselves ----------
// The newest games as a list; each opens on game.html with the board, how it went and the key moves.
const STATUS = { mate: 'mate', resign: 'resignation', outoftime: 'time', timeout: 'time', draw: 'agreement', stalemate: 'stalemate', aborted: 'abort' };
function gamesList(name, n) {
  const el = $('#pf-games'), games = storedGames(name) || (RAW_NAME.toLowerCase() === name.toLowerCase() ? RAW : null);
  if (!el || !games?.length) return;
  const me = name.toLowerCase();
  const row = (g) => {
    const side = g.players.white.user?.id === me ? 'white' : 'black', opp = g.players[side === 'white' ? 'black' : 'white'];
    const res = !g.winner ? 'D' : g.winner === side ? 'W' : 'L';
    const acc = g.players[side].analysis?.accuracy;
    const blunders = g.players[side].analysis?.blunder;
    return `<li><a class="pf-game" href="game.html?u=${encodeURIComponent(name)}&id=${g.id}">
      <span class="pf-res r-${res}" title="${{ W: 'Won', L: 'Lost', D: 'Draw' }[res]}">${res}</span>
      <span class="pf-game-main"><b>vs ${esc(nick(opp.user?.id || 'anonymous'))}</b> <small>${opp.rating || ''}</small><br><small>${esc((g.opening?.name || '').split(':')[0])}</small></span>
      <span class="pf-game-meta">${g.speed} · ${Math.ceil((g.moves || '').split(' ').length / 2)} moves<br><small>${new Date(g.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${acc != null ? ` · ${acc}% acc` : ''}${blunders ? ` · ${blunders} blunder${blunders > 1 ? 's' : ''}` : ''}</small></span>
    </a></li>`;
  };
  el.innerHTML = `<h2>${isMe(name) ? 'Your games' : 'Games'}</h2>
    <p class="info pf-note">Open a game to replay it here: how it went, the moves that decided it, and what to take from it.</p>
    <ul class="pf-games">${games.slice(0, n).map(row).join('')}</ul>
    ${games.length > n ? `<button type="button" class="ghost" data-more-games>Show more</button>` : ''}`;
  el.querySelector('[data-more-games]')?.addEventListener('click', () => gamesList(name, n + 15));
}

// ---------- Starred players and comparing ----------
const FAVS = 'opening-book-v2-players'; // the players you star: friends or favourites, by name
function favs() { try { return JSON.parse(localStorage.getItem(FAVS)) || []; } catch { return []; } }
const isFav = (name) => favs().some((x) => x.toLowerCase() === name.toLowerCase());
function toggleFav(name) {
  const list = isFav(name) ? favs().filter((x) => x.toLowerCase() !== name.toLowerCase()) : [...favs(), name];
  try { localStorage.setItem(FAVS, JSON.stringify(list)); } catch {}
}
const profileLink = (n) => `profile.html?u=${encodeURIComponent(n)}`;
const compareLink = (a, b) => `profile.html?u=${encodeURIComponent(a)}&vs=${encodeURIComponent(b)}`;
const agoLink = (a, m) => `profile.html?u=${encodeURIComponent(a)}&ago=${m}`; // a's card now against a's card m months ago (thenNow)
const AGO = [[6, '6 months ago'], [12, '1 year ago'], [24, '2 years ago']];
const pickLink = (a) => `profile.html?u=${encodeURIComponent(a)}&vs=`; // compare a with someone to pick (comparePick)
// The name, with small icons in the corner: star this player, compare with them, them on Lichess.
function nameRow(name) {
  const me = isMe(name), mine = myName(), fav = isFav(name);
  const icon = (d, solid = false) => `<svg class="ico${solid ? ' ico-solid' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  return `<div class="pf-name-row"><h1 class="pf-name" data-supporter-name="${esc(name.toLowerCase())}" style="--n:${nick(name).length}">${esc(nick(name))}</h1>${me ? '' : `<div class="pf-acts">
    <button type="button" class="ghost pf-act pf-star" data-fav aria-pressed="${fav}" aria-label="${fav ? 'Starred: unstar' : 'Star this player'}" title="${fav ? 'Starred (press to unstar)' : 'Star this player: one tap to them from the ★ menu'}">${icon(STAR_PATH, fav)}</button>
    <a class="ghost pf-act" href="${pickLink(name)}" aria-label="Compare" title="Compare ${esc(nick(name))} with you or anyone">${icon('M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4')}</a>
    <a class="ghost pf-act" href="${isCC(name) ? ccUrl(name) : `https://lichess.org/@/${encodeURIComponent(name)}`}" target="_blank" rel="noopener" aria-label="${esc(nick(name))} on ${siteOf(name)}" title="${esc(nick(name))} on ${siteOf(name)}">${icon('M14 4h6v6M20 4l-9 9M18 14v6H4V6h6')}</a></div>`}</div>`;
}
// Your own card: tap its piece to choose the one shown, or go back to the one your games give. Kept with
// your analyses (row TYPEpiec), so everyone sees it, on the leaderboard too.
function bindPiecePick(name) {
  const side = $('.pf-hero .pf-pcard .pf-pcard-side');
  if (!side) return;
  Object.assign(side, { tabIndex: 0, title: 'Choose your piece' }); side.setAttribute('role', 'button'); side.classList.add('pf-pick-piece');
  const choose = (pc) => {
    if (pc) PICKED.set(name.toLowerCase(), pc); else PICKED.delete(name.toLowerCase());
    fetch(SYNC, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ player: name.toLowerCase(), rows: [{ id: 'TYPEpiec', data: { piece: pc || null } }] }) }).catch(() => {});
    // Only the card's piece changes: no redraw of the page.
    const shownPiece = pc || shownP?.pieceAuto || 'n';
    if (shownP) { shownP.piece = shownPiece; shownP.pieceWhy = pc ? 'chosen' : shownP.pieceWhyAuto; }
    side.querySelector('.ink-on-light').src = `pieces/b${shownPiece.toUpperCase()}.svg`;
    side.querySelector('.ink-on-dark').src = `pieces/${CARD_INK}${shownPiece.toUpperCase()}.svg`;
    side.querySelector('.ink-on-dark').title = pc ? `Chosen by ${nick(name)}` : `${nick(name)}'s most important piece: the ${PIECE_NAME[shownPiece]}`;
    $('.pf-piece-menu')?.remove();
  };
  const open = (e) => {
    e.preventDefault(); e.stopPropagation();
    $('.pf-piece-menu')?.remove();
    const menu = Object.assign(document.createElement('div'), { className: 'pf-piece-menu' });
    // The one the games give, and why: as the card's own explanation.
    const auto = shownP?.pieceAuto || 'n', why = shownP?.pieceWhyAuto === 'best' ? 'You play it best: the fewest mistakes per move.'
      : 'It does the most in your games. With 20 analysed games, it becomes the piece you play best.';
    menu.innerHTML = `<p>Your piece</p><div>${['k', 'q', 'r', 'b', 'n', 'p'].map((k) => `<button type="button" data-piece="${k}" aria-label="The ${PIECE_NAME[k]}"${k === auto ? ' class="auto"' : ''}><img src="pieces/w${k.toUpperCase()}.svg" alt=""></button>`).join('')}</div>
      <button type="button" class="pf-piece-auto" data-piece=""><img src="pieces/w${auto.toUpperCase()}.svg" alt=""><span><small>From your games</small><b>The ${PIECE_NAME[auto]}</b><em>${why}</em></span></button>`;
    side.closest('.pf-pcard').append(menu);
    menu.addEventListener('click', (ev) => { const b = ev.target.closest('[data-piece]'); if (b) { ev.stopPropagation(); choose(b.dataset.piece); } });
    setTimeout(() => addEventListener('click', () => menu.remove(), { once: true }));
    menu.querySelector('button').focus();
  };
  side.addEventListener('click', open);
  side.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
}
function bindPlayerBar(name) {
  // New games: only the games played since the last read are fetched, then the whole profile is read again.
  const fetchBtn = $('[data-fetch]:not([data-bound])'); // wired once (the player bar is redrawn when a player is starred)
  fetchBtn?.setAttribute('data-bound', '1');
  fetchBtn?.addEventListener('click', async (e) => {
    const b = e.currentTarget, top = (storedGames(name) || [])[0]?.id, mine = runs;
    b.disabled = true; b.lastChild.textContent = ' Fetching…'; PERFS.delete(name.toLowerCase()); // the rating has moved on with the games
    try {
      const count = () => { const after = storedGames(name) || [], i = after.findIndex((g) => g.id === top); return top ? (i < 0 ? after.length : i) : after.length; };
      let p = await build(name), added = count();
      // A game that just ended can take a few seconds to reach Lichess's export: look once more before saying none.
      if (!added && mine === runs) { await new Promise((r) => setTimeout(r, 5000)); if (mine === runs) { p = await build(name); added = count(); } }
      if (mine !== runs) return;
      render(name, Date.now(), p);
      $('#pf-fetched').textContent = added > 0 ? `${added} new game${added === 1 ? '' : 's'} added just now` : 'No new games: up to date';
    } catch (err) { b.disabled = false; b.lastChild.textContent = ' New games'; $('#profile-msg').textContent = err.message; }
  });
  $('[data-fav]')?.addEventListener('click', (e) => {
    toggleFav(name);
    $('.pf-hero .pf-acts')?.remove();
    $('.pf-name-row').outerHTML = nameRow(name);
    placeActs();
    bindPlayerBar(name);
  });
}
// On a phone the star, compare and Lichess buttons join the download and help buttons in one row under
// the card, so the name gets the width.
function placeActs() {
  const a = $('.pf-name-row .pf-acts');
  if (a && matchMedia('(max-width: 640px)').matches) $('.pf-hero .pf-cardbar')?.append(a);
}
// A profile ready to show: kept here, else read from the player's games.
// Compare: the player you came from on the left, and on the right the other to pick: you, one of your
// starred players, or anyone by name.
async function comparePick(name) {
  document.title = `Compare ${nick(name)} · Chess Labs`;
  const mine = myName(), others = favs().filter((x) => x.toLowerCase() !== name.toLowerCase() && x.toLowerCase() !== (mine || '').toLowerCase());
  $('#profile').innerHTML = `<header class="cmp-head"><h1 class="pf-h1">Compare <a href="${profileLink(name)}">${esc(nick(name))}</a></h1></header>
    <section class="cmp-pick"><div class="cmp-pick-a" id="cmp-pick-a"><p class="info">Reading ${esc(nick(name))}'s games…</p></div><span class="cmp-pick-vs">VS</span>
      <div class="cmp-pick-b"><h2>With who?</h2>
        <div class="cmp-pick-g"><p class="cmp-pick-k">${isMe(name) ? 'Your own card from' : `${esc(nick(name))}'s own card from`}</p>${AGO.map(([m, t]) => `<a class="cmp-opt" href="${agoLink(name, m)}"><b>${t}</b><span aria-hidden="true">→</span></a>`).join('')}</div>
        ${mine && mine.toLowerCase() !== name.toLowerCase() ? `<div class="cmp-pick-g"><p class="cmp-pick-k">You</p><a class="cmp-opt" href="${compareLink(name, mine)}"><b>${esc(mine)}</b><span aria-hidden="true">→</span></a></div>` : ''}
        <div class="cmp-pick-g"><p class="cmp-pick-k">Any Lichess player</p><form class="cmp-pick-form" action="profile.html"><input type="hidden" name="u" value="${esc(nick(name))}"><input name="vs" required maxlength="30" pattern="[A-Za-z0-9_\\-]{2,30}" placeholder="Lichess name" aria-label="Any Lichess name" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="submit" class="cta">Compare</button></form></div>
        ${others.length ? `<div class="cmp-pick-g"><p class="cmp-pick-k">Your starred players</p>${others.map((x) => `<a class="cmp-opt" href="${compareLink(name, x)}"><b>${esc(x)}</b><span aria-hidden="true">→</span></a>`).join('')}</div>` : ''}
      </div></section>`;
  const vs = $('.cmp-pick-form input[name=vs]');
  window.playerSuggest?.(vs, (x) => { location.href = compareLink(name, x); });
  vs.focus();
  try {
    const A = await profileFor(name);
    await loadFlags([name]);
    $('#cmp-pick-a').innerHTML = playerCard(A.name, A.p, A.p.type, skillsOf(A.p));
  } catch (err) { $('#cmp-pick-a').innerHTML = `<p class="info">${esc(err.message)}</p>`; }
}
// The card now next to the card from m months ago, in the main time control: the last MAX games of
// that time control played before the date, fetched and read like the profile's but not kept.
async function thenNow(name, m) {
  const when = AGO.find((x) => x[0] === m)?.[1] || `${m} months ago`;
  document.title = `${nick(name)} now vs ${when} · Chess Labs`;
  $('#profile').innerHTML = '';
  const msg = msgEl();
  try {
    const A = await profileFor(name), sp = A.p.speeds[0]?.speed;
    if (!sp) throw new Error(`${nick(name)} has no rated games to compare.`);
    window.track?.('then-now', `${name} ${m}`);
    msg.textContent = `Reading ${nick(name)}'s ${sp} games…`;
    await Promise.all([loadSpeed(name, sp).done, loadScores()]); // read as the profile's card reads them: the time control's own last 500, scored
    const now = forSpeed(A.name, A.p, sp), until = new Date();
    until.setMonth(until.getMonth() - m);
    msg.textContent = `Fetching ${nick(name)}'s ${sp} games from before ${until.toLocaleDateString('en', { month: 'long', year: 'numeric' })}…`;
    const raw = await fetchGames(name, (k) => { msg.textContent = `Fetching ${nick(name)}'s ${sp} games from ${when}… ${k}`; }, null, sp, +until);
    if (raw.length < MIN_SPEED) throw new Error(`${nick(name)} played fewer than ${MIN_SPEED} rated ${sp} games before ${until.toLocaleDateString('en', { month: 'long', year: 'numeric' })}, so there is no card from ${when} to compare.`);
    const then = profileOf(raw.map((g) => readGame(g, name.toLowerCase())));
    then.type = typeOf(then);
    msg.textContent = '';
    await loadFlags([name]);
    renderThenNow(A.name, now, then, sp, m, when, raw);
  } catch (err) { msg.textContent = err.message; }
}
function renderThenNow(name, now, then, sp, m, when, raw) {
  const sn = skillsOf(now), st = skillsOf(then), me = isMe(name);
  const day = (t) => new Date(t).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
  const ra = now.speeds[0]?.rating, rb = then.speeds[0]?.rating, dr = ra && rb ? ra - rb : null;
  const moved = sn.map((x, i) => ({ label: x.label, d: x.v !== null && st[i].v !== null ? x.v - st[i].v : null })).filter((x) => x.d !== null).sort((a, b) => b.d - a.d);
  const up = moved[0]?.d > 0 ? moved[0] : null, down = moved.at(-1)?.d < 0 ? moved.at(-1) : null;
  const story = [
    dr === null ? '' : dr === 0 ? `<b>Same ${sp} rating</b> as ${when}: ${ra}.` : `<b>${dr > 0 ? 'Up' : 'Down'} ${Math.abs(dr)} rating points</b> in ${sp} since ${when} (${rb} then, ${ra} now).`,
    up ? `${me ? 'Your' : 'The'} biggest gain is <b>${up.label.toLowerCase()}, +${up.d}</b>.` : '',
    down ? `${me ? 'Your' : 'The'} biggest drop is <b>${down.label.toLowerCase()}, −${-down.d}</b>.` : '',
    then.type[0]?.name !== now.type[0]?.name ? `The card read ${me ? 'you' : nick(name)} as ${article(then.type[0]?.name || 'x')} <b>${esc(then.type[0]?.name || '')}</b> then, and ${article(now.type[0]?.name || 'x')} <b>${esc(now.type[0]?.name || '')}</b> now.` : `${me ? 'You are' : `${esc(nick(name))} is`} still ${article(now.type[0]?.name || 'x')} <b>${esc(now.type[0]?.name || '')}</b>.`,
    'Skills are measured against the opponents of the time, so a rating climb and a flat skill can go together: you beat stronger players by the same margin.',
  ].filter(Boolean);
  $('#profile').innerHTML = `
    <div class="pf-players"><a class="ghost" href="${profileLink(name)}">← ${esc(nick(name))}</a></div>
    <header class="cmp-head"><h1 class="pf-h1"><a href="${profileLink(name)}">${esc(nick(name))}</a> <span>now vs ${when}</span></h1>
      <div class="pf-seg cmp-speeds" role="group" aria-label="How long ago">${AGO.map(([k, t]) => `<a href="${agoLink(name, k)}" aria-current="${k === m}">${t}</a>`).join('')}</div>
      <p class="info cmp-scope">Both cards read ${sp} games only: now the last ${shownGames.length} games, then the ${raw.length} games before ${day(raw[0].createdAt + 1)} (${day(raw.at(-1).createdAt)} – ${day(raw[0].createdAt)}).</p></header>
    <section class="cmp-cards">
      <div>${playerCard(name, then, then.type, st)}<p class="cmp-type"><b>${when[0].toUpperCase() + when.slice(1)}</b> · ${then.type.map((x) => esc(x.name)).join(' + ')}</p></div>
      <div>${playerCard(name, now, now.type, sn)}<p class="cmp-type"><b>Now</b> · ${now.type.map((x) => esc(x.name)).join(' + ')}</p></div>
    </section>
    <section class="pf-card cmp-story"><h2>Since then</h2>${story.map((x) => `<p>${x}</p>`).join('')}</section>
    <section class="pf-card">
      <h2>Skills</h2>
      <p class="cmp-key"><span class="cmp-a"></span>${when[0].toUpperCase() + when.slice(1)} <span class="cmp-b"></span>Now</p>
      <ul class="cmp-skills">${st.map((x, i) => {
        const y = sn[i], d = x.v !== null && y.v !== null ? y.v - x.v : null;
        return `<li><span class="cmp-label">${x.label}</span>
          <div class="cmp-bars" role="img" aria-label="${x.label}: ${when} ${x.v ?? 'no data'}, now ${y.v ?? 'no data'}">
            <div class="cmp-bar a"><i style="width:calc((100% - 3em) * ${(x.v ?? 0) / 100})"></i><b>${x.v ?? '–'}</b></div>
            <div class="cmp-bar b"><i style="width:calc((100% - 3em) * ${(y.v ?? 0) / 100})"></i><b>${y.v ?? '–'}</b></div></div>
          <small>${d === null ? 'Not enough games for both.' : d === 0 ? 'Same.' : `${d > 0 ? '+' : '−'}${Math.abs(d)} since then`}</small></li>`;
      }).join('')}</ul>
    </section>`;
}
async function profileFor(name) {
  return { name: cache()[name.toLowerCase()]?.name || name, p: await current(name) };
}
// Two players side by side: cards, types, skills as paired bars, the key numbers and opening taste.
// Compare in one time control (bullet, blitz, rapid, classical) or all games: the profile is read
// again from just those games of each player, so a blitz player and a bullet player compare like
// for like. The default is the time control the first player plays most, when the other has games in it too.
const SPEEDS = ['bullet', 'blitz', 'rapid', 'classical'];
// Each player's games read once (replaying them is the slow part), so switching time control is quick.
const RECORDS = new Map();
function recordsOf(name, games) {
  const k = `${name.toLowerCase()}:${games.length}:${games[0]?.id}:${games.at(-1)?.id}:${games.filter((g) => g.analysis).length}`; // the first and last game tell a time control's own 500 from the 500 of all; read again once more are analysed
  if (!RECORDS.has(k)) RECORDS.set(k, games.map((g) => readGame(g, name.toLowerCase())));
  return RECORDS.get(k);
}
const MIN_SPEED = 10; // games in a time control needed to compare it
async function compare(a, b, speed = new URLSearchParams(location.search).get('speed')) {
  await loadScores();
  window.track?.('compare', `${a} vs ${b}`);
  $('#profile').innerHTML = '';
  try {
    const A = await profileFor(a), B = await profileFor(b);
    const ga = storedGames(a) || [], gb = storedGames(b) || [];
    // A time control's own last 500 games when fetched on the profile, as the profile's card reads them.
    const count = (x, gs, sp) => storedGames(speedKey(x, sp))?.length || gs.filter((g) => g.speed === sp).length;
    const avail = SPEEDS.filter((sp) => count(a, ga, sp) >= MIN_SPEED && count(b, gb, sp) >= MIN_SPEED);
    if (speed === null) speed = avail.includes(A.p.speeds[0]?.speed) ? A.p.speeds[0].speed : 'all';
    const sub = (X, gs) => (speed === 'all' || !gs.length ? X : { name: X.name, p: forSpeed(X.name, X.p, speed) });
    await loadFlags([a, b]);
    renderCompare(sub(A, ga), sub(B, gb), speed, avail);
  } catch (err) { $('#profile-msg').textContent = err.message; }
}
function renderCompare(A, B, speed = 'all', avail = []) {
  document.title = `${A.name} vs ${B.name} · Chess Labs`;
  const sa = skillsOf(A.p), sb = skillsOf(B.p);
  const num = (v, f = (x) => x) => (v === null || v === undefined ? '–' : f(v));
  const main = (p) => p.speeds[0];
  // [label, A shown, B shown, A value, B value, 1 = higher is better / -1 = lower is better / 0 = neither]
  const rows = [
    ['Rating', num(main(A.p)?.rating) + (main(A.p) ? ` <small>${main(A.p).speed}</small>` : ''), num(main(B.p)?.rating) + (main(B.p) ? ` <small>${main(B.p).speed}</small>` : ''), main(A.p)?.rating, main(B.p)?.rating, 1],
    ['Win rate', pct(A.p.winRate), pct(B.p.winRate), A.p.winRate, B.p.winRate, 1],
    ['Wins as White', num(A.p.winW, pct), num(B.p.winW, pct), A.p.winW, B.p.winW, 1],
    ['Wins as Black', num(A.p.winB, pct), num(B.p.winB, pct), A.p.winB, B.p.winB, 1],
    ['Accuracy', num(A.p.acc, (x) => `${x}%`), num(B.p.acc, (x) => `${x}%`), A.p.acc, B.p.acc, 1],
    ['Blunders / game', num(A.p.blunders, (x) => x.toFixed(1)), num(B.p.blunders, (x) => x.toFixed(1)), A.p.blunders, B.p.blunders, -1],
    ['Draws', pct(A.p.draws), pct(B.p.draws), 0, 0, 0],
    ['Moves a game', A.p.moves, B.p.moves, 0, 0, 0],
    ['Opening taste', tasteShort(A.p.styleMix), tasteShort(B.p.styleMix), 0, 0, 0],
  ];
  const lead = (x, y, dir) => (dir && x != null && y != null && x !== y ? ((x > y) === (dir > 0) ? 'a' : 'b') : '');
  $('#profile').innerHTML = `
    <div class="pf-players"><a class="ghost" href="${profileLink(A.name)}">← ${esc(nick(A.name))}</a><a class="ghost" href="${profileLink(B.name)}">${esc(nick(B.name))} →</a></div>
    <header class="cmp-head"><h1 class="pf-h1"><a href="${profileLink(A.name)}" data-supporter-name="${esc(A.name.toLowerCase())}">${esc(nick(A.name))}</a> <span>vs</span> <a href="${profileLink(B.name)}" data-supporter-name="${esc(B.name.toLowerCase())}">${esc(nick(B.name))}</a></h1>
      <div class="pf-seg cmp-speeds" role="group" aria-label="Time control">${['all', ...SPEEDS].map((sp) => `<button type="button" data-speed="${sp}" aria-pressed="${sp === speed}" ${sp === 'all' || avail.includes(sp) ? '' : `disabled title="Fewer than ${MIN_SPEED} ${sp} games for one of you"`}>${sp === 'all' ? 'All games' : sp[0].toUpperCase() + sp.slice(1)}</button>`).join('')}</div>
      <p class="info cmp-scope">${speed === 'all' ? 'Every number below is from all rated games.' : `Every number below is from ${speed} games only, the same games as each profile's ${speed} card.`}</p></header>
    <section class="cmp-cards">
      <div><a class="cmp-card" href="${profileLink(A.name)}" title="Open ${esc(nick(A.name))}'s profile">${playerCard(A.name, A.p, A.p.type, sa)}</a><p class="cmp-type"><b>${A.p.type.map((x) => esc(x.name)).join(' + ')}</b></p></div>
      <div><a class="cmp-card" href="${profileLink(B.name)}" title="Open ${esc(nick(B.name))}'s profile">${playerCard(B.name, B.p, B.p.type, sb)}</a><p class="cmp-type"><b>${B.p.type.map((x) => esc(x.name)).join(' + ')}</b></p></div>
      <details class="pf-dl cmp-dl"><summary title="Download the comparison" aria-label="Download the comparison"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 19h14"/></svg></summary>
        <div class="pf-dl-menu" role="group" aria-label="Download"><div class="pf-dl-look" role="group" aria-label="Look">${['dark', 'light'].map((k) => `<button type="button" data-card-look="${k}" aria-pressed="${cardLook() === k}">${k === 'dark' ? 'Dark' : 'Light'}</button>`).join('')}</div><button type="button" data-cmp-png="cards">Cards</button><button type="button" data-cmp-png="text">Cards + text</button><button type="button" data-cmp-png="both">Both</button></div></details>
    </section>
    <section class="pf-card cmp-story"><h2>In short</h2>${compareStory(A, B, sa, sb).map((x) => `<p>${x}</p>`).join('')}</section>
    <section class="pf-card">
      <h2>Skills</h2>
      <p class="cmp-key"><span class="cmp-a"></span>${esc(nick(A.name))} <span class="cmp-b"></span>${esc(nick(B.name))}</p>
      <ul class="cmp-skills">${sa.map((x, i) => {
        const y = sb[i], d = x.v !== null && y.v !== null ? x.v - y.v : null;
        return `<li><span class="cmp-label">${x.label}</span>
          <div class="cmp-bars" role="img" aria-label="${x.label}: ${esc(nick(A.name))} ${x.v ?? 'no data'}, ${esc(nick(B.name))} ${y.v ?? 'no data'}">
            <div class="cmp-bar a"><i style="width:calc((100% - 3em) * ${(x.v ?? 0) / 100})"></i><b>${x.v ?? '–'}</b></div>
            <div class="cmp-bar b"><i style="width:calc((100% - 3em) * ${(y.v ?? 0) / 100})"></i><b>${y.v ?? '–'}</b></div></div>
          <small>${d === null ? 'Not enough games for both.' : d === 0 ? 'Even.' : `${esc(d > 0 ? A.name : B.name)} +${Math.abs(d)}`}</small></li>`;
      }).join('')}</ul>
    </section>
    <section class="pf-card">
      <h2>Numbers</h2>
      <table class="cmp-table"><thead><tr><th></th><th>${esc(nick(A.name))}</th><th>${esc(nick(B.name))}</th></tr></thead>
        <tbody>${rows.map(([k, x, y, va, vb, dir]) => { const l = lead(va, vb, dir); return `<tr><th scope="row">${k}</th><td class="${l === 'a' ? 'lead' : ''}">${x}</td><td class="${l === 'b' ? 'lead' : ''}">${y}</td></tr>`; }).join('')}</tbody></table>
    </section>
    <p class="info">Both read from each player's last ${MAX} rated Lichess games${speed === 'all' ? '' : `, ${speed} only`} (${A.p.analysed} and ${B.p.analysed} of them analysed). The rating sets each card's level; each skill then moves above or below it by how the player does against their own opponents, with the gaps between a player's six drawn twice as large.</p>
    ${compareNext(A, B, sa, sb)}`;  document.querySelectorAll('.cmp-speeds [data-speed]').forEach((btn) => btn.addEventListener('click', () => {
    const q = new URLSearchParams(location.search);
    q.set('speed', btn.dataset.speed);
    history.replaceState(null, '', `?${q}`);
    compare(A.name, B.name, btn.dataset.speed);
  }));
  // Download the comparison as an image, dark or light (the same remembered choice as the card's).
  document.querySelectorAll('.cmp-dl [data-card-look]').forEach((btn) => btn.addEventListener('click', () => {
    try { localStorage.setItem('chess-trainer-card-look', btn.dataset.cardLook); } catch {}
    document.querySelectorAll('.cmp-dl [data-card-look]').forEach((x) => x.setAttribute('aria-pressed', x === btn));
  }));
  document.querySelectorAll('[data-cmp-png]').forEach((b) => b.addEventListener('click', async () => {
    b.closest('details').open = false;
    if (b.dataset.cmpPng !== 'text') await comparePng(A, B, sa, sb, false, b);
    if (b.dataset.cmpPng !== 'cards') await comparePng(A, B, sa, sb, true, b);
  }));

}
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
// Compare ends on something to do: your biggest gap against the other player, and how to train it.
function compareNext(A, B, sa, sb) {
  if (!isMe(A.name)) return '';
  const gap = sa.map((x, i) => ({ x, d: x.v !== null && sb[i].v !== null ? x.v - sb[i].v : 0 })).sort((p, q) => p.d - q.d)[0];
  return `<section class="pf-next"><h2>What next</h2><div>${gap && gap.d <= -5
    ? `<a class="cta" href="${gap.x.href || 'practice.html'}">Close your ${gap.x.label.toLowerCase()} gap (−${-gap.d})</a>`
    : '<a class="cta" href="practice.html">Open your training plan</a>'}<a class="ghost" href="${profileLink(B.name)}">${esc(nick(B.name))}'s profile</a></div></section>`;
}
// The comparison in words: who is stronger overall and by how much, where each one is better, how
// they play, and how they score.
function compareStory(A, B, sa, sb) {
  // "You" when one of the two is the logged-in player; v picks the verb form for that player
  const nm = (P) => (isMe(P.name) ? 'You' : esc(P.name)), a = nm(A), b = nm(B);
  const v = (who, s3, s2) => (who === 'You' ? s2 : s3), their = (who) => (who === 'You' ? 'your' : 'their');
  // against their own opponents: the skills before the rating sets the card's level
  const ovr = (sk) => { const k = sk.filter((x) => x.raw !== null); return k.length ? Math.round(sum(k, (x) => x.raw) / k.length) : null; };
  const oa = ovr(sa), ob = ovr(sb), out = [];
  const ra = A.p.speeds[0]?.rating, rb = B.p.speeds[0]?.rating, dr = (ra ?? 0) - (rb ?? 0);
  if (ra && rb) out.push(Math.abs(dr) < 25 ? `<b>Same level on Lichess</b>: ${ra} and ${rb}.` : `<b>${dr > 0 ? a : b} ${v(dr > 0 ? a : b, 'is', 'are')} rated ${Math.abs(dr)} points higher</b> (${Math.max(ra, rb)} against ${Math.min(ra, rb)}).`);
  if (oa !== null && ob !== null) {
    const d = oa - ob;
    out.push(Math.abs(d) <= 3 ? `Against their own opponents they do about equally well (${oa} and ${ob}).`
      : `${d > 0 ? a : b} ${v(d > 0 ? a : b, 'outplays', 'outplay')} ${their(d > 0 ? a : b)} own opponents more (${Math.max(oa, ob)} against ${Math.min(oa, ob)}).`);
  }
  const gaps = sa.map((x, i) => ({ label: x.label.toLowerCase(), d: x.v !== null && sb[i].v !== null ? x.v - sb[i].v : null })).filter((x) => x.d !== null);
  const forA = gaps.filter((x) => x.d >= 5).sort((x, y) => y.d - x.d), forB = gaps.filter((x) => x.d <= -5).sort((x, y) => x.d - y.d);
  const list = (xs) => xs.slice(0, 2).map((x) => `${x.label} (+${Math.abs(x.d)})`).join(' and ');
  if (forA.length || forB.length) out.push([forA.length && `${a} ${v(a, 'is', 'are')} better at ${list(forA)}`, forB.length && `${b} at ${list(forB)}`].filter(Boolean).join(', while ') + '.');
  const ta = A.p.type[0].name, tb = B.p.type[0].name;
  out.push(ta === tb ? `Both play as ${article(ta)} ${ta.toLowerCase()}${tasteShort(A.p.styleMix) === tasteShort(B.p.styleMix) ? ', with the same taste in openings' : ''}.`
    : `${a} ${v(a, 'plays', 'play')} as ${article(ta)} ${ta.toLowerCase()} (${tasteShort(A.p.styleMix)}), ${b} as ${article(tb)} ${tb.toLowerCase()} (${tasteShort(B.p.styleMix)}).`);
  const ds = Math.round((A.p.winRate - B.p.winRate) * 100);
  out.push(Math.abs(ds) < 3 ? `They win about as often against their own opponents (${pct(A.p.winRate)} and ${pct(B.p.winRate)} of games).`
    : `${ds > 0 ? a : b} ${v(ds > 0 ? a : b, 'wins', 'win')} more often against ${their(ds > 0 ? a : b)} own opponents (${pct(Math.max(A.p.winRate, B.p.winRate))} of games against ${pct(Math.min(A.p.winRate, B.p.winRate))}).`);
  if (A.p.blunders !== null && B.p.blunders !== null && A.p.analysed >= KPI_MIN && B.p.analysed >= KPI_MIN && Math.abs(A.p.blunders - B.p.blunders) >= 0.3) {
    const fewer = A.p.blunders < B.p.blunders ? a : b;
    out.push(`${fewer} ${v(fewer, 'blunders', 'blunder')} less (${Math.min(A.p.blunders, B.p.blunders).toFixed(1)} a game against ${Math.max(A.p.blunders, B.p.blunders).toFixed(1)}).`);
  }
  return out;
}
const tasteShort = (mix) => [taste(mix?.w) && `${taste(mix.w).label} as White`, taste(mix?.b) && `${taste(mix.b).label} as Black`].filter(Boolean).join(', ') || 'Mixed';

// A player's profile: shown at once from this browser when it was read before (new games are then
// fetched quietly), else read from their games. The address
// keeps the name (?u=), so a profile can be shared or bookmarked.
function show(name, push) {
  if (push) history.pushState(null, '', isMe(name) ? location.pathname : `?u=${encodeURIComponent(name)}`);
  run(name);
}
function start() {
  const q = new URLSearchParams(location.search), name = q.get('u') || myName();
  if (/\/rivals(\.html)?$/.test(location.pathname)) return name ? rivalsPage(name, q.get('vs')) : ask();
  if (name && q.get('ago')) return thenNow(name, +q.get('ago'));
  if (name && q.has('vs') && !q.get('vs')) return comparePick(name); // compare with someone still to pick
  if (name && q.get('vs') && q.get('vs').toLowerCase() !== name.toLowerCase()) return compare(name, q.get('vs')); // the same name twice: just the profile
  combo = null;
  if (name && q.has('all')) return combined(name);
  if (name) show(name, false); else ask();
}
if ($('#profile')) addEventListener('popstate', () => start());
// Between one player's accounts and Combined: the page stays, only the card is drawn again.
document.addEventListener('click', (e) => {
  const a = e.target.closest('#profile a.pf-acct');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.getAttribute('aria-current')) return;
  e.preventDefault(); a.closest('details')?.removeAttribute('open');
  history.pushState(null, '', a.href); start();
});

// Last in the file, so every constant above is defined before the page draws.
if ($('#profile')) { // the practice page imports this module for the above; only the profile page draws itself
  // The header's Log in (on every page) comes here, so the player lands on their own profile after it.
  try { await finishLogin(); } catch (err) { $('#profile-msg').textContent = err.message; } // back from logging in on this page
  start();
  if (new URLSearchParams(location.search).has('login') && !account()) openLogin();
}
