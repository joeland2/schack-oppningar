// Your profile: your last 500 rated Lichess games read move by move, then what kind of player they
// show, what you are good at, what to work on, and the numbers behind it. Lichess's own computer
// analysis is used where a game has it (accuracy, blunders, who was winning when). The result is kept
// in this browser, and so are the games themselves: later visits fetch only the games played since.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { account, login, logout, finishLogin } from './lichess.js?v=20261030113307';
import { STYLE_OF } from './styles.js?v=20261030113307';

const MAX = 500;
const EARLY = 60, REDRAW = 150; // a first look-up draws the profile after EARLY games, then again every REDRAW, while the rest still come in
const PV = 37;
const ENOUGH = 100; // analysed games before the skills that need analysis are shown
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
    expect: expectOf((g.opening?.name || 'Unknown').split(':')[0], side, mine.rating, g.speed), diff: mine.ratingDiff || 0, them: theirs.rating,
    castled, queensOff, endgame: endgameAt !== null, pieces, played,
    analysed: v.length > 0, ours: !!g.ours, acc: mine.analysis?.accuracy ?? null, blunders: mine.analysis?.blunder ?? null, mistakes: mine.analysis?.mistake ?? null,
    best: v.length ? Math.max(...v) : null, worst: v.length ? Math.min(...v) : null, after12: v.length > 23 ? v[23] : g.at12 != null ? g.at12 * pov : null, slips,
    lowTime: left !== null && g.clock ? left < Math.max(10, g.clock.initial * 0.1) : false,
    // The opponent's side of the same game: the players at your level that the skills compare you with.
    oppBlunders: theirs.analysis?.blunder ?? null,
    states: statesOf(g, pov, myPly),
    oppLowTime: end && end[1 - myPly] != null && g.clock ? end[1 - myPly] / 100 < Math.max(10, g.clock.initial * 0.1) : false,
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
const kindOf = (fam) => (/Gambit/.test(fam) ? 'gambit' : (STYLE_OF[fam] || ['other'])[0]);
function styleMix(games, side) {
  const gs = games.filter((g) => g.side === side && blacksName(g.family) === (side === 'b'));
  return { n: gs.length, parts: KINDS.map(([k, label, words]) => ({ k, label, words, share: gs.length ? gs.filter((g) => kindOf(g.family) === k).length / gs.length : 0 })).filter((x) => x.share > 0).sort((a, b) => b.share - a.share) };
}
console.assert(styleMix([{ side: 'w', family: 'Danish Gambit' }, { side: 'w', family: 'London System' }, { side: 'b', family: 'Italian Game' }], 'w').parts[0].share === 0.5, 'styleMix');
const styleOf = (fam) => [...(STYLE_OF[fam] || []), ...(/Gambit/.test(fam) ? ['attacking'] : [])];
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
    ends: {
      won: { mate: share(wins, (g) => g.status === 'mate'), resign: share(wins, (g) => g.status === 'resign'), time: share(wins, (g) => g.status === 'outoftime' || g.status === 'timeout') },
      lost: { mate: share(losses, (g) => g.status === 'mate'), resign: share(losses, (g) => g.status === 'resign'), time: share(losses, (g) => g.status === 'outoftime' || g.status === 'timeout') },
    },
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
    attacking: share(games, (g) => styleOf(g.family).includes('attacking')),
    solid: share(games, (g) => styleOf(g.family).some((s) => s === 'solid' || s === 'positional')),
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
    ...pieceOf(games, an.length),
    peer: peerOf(games),
    // Rating after each game, oldest first, per time control: the graph's fallback when Lichess's
    // own rating history is not available.
    history: games.reduce((h, g) => (g.at ? { ...h, [g.speed]: [[g.at, g.rating + g.diff], ...(h[g.speed] || [])] } : h), {}),
  };
  p.type = typeOf(p);
  return p;
}

// What each type means, shown above the evidence from the games.
const TYPE_ABOUT = {
  Striker: 'Goes after the king early, wants open lines and the initiative, and takes some risk for it. Dangerous when the attack lands, shaky when it does not.',
  'Solid builder': 'Builds a safe position first and strikes when the moment is right. Hard to beat quickly, but can let wins slip by being too careful.',
  'Endgame artist': 'Happy to trade pieces and win slowly with technique. Trusts long-term edges more than tactics.',
  Fighter: 'Plays every game for a result and rarely settles for a draw. Wins and losses both come quickly.',
  Houdini: 'Keeps finding chances in bad positions and turns lost games around. Stubborn defence is a real strength.',
  'Time scrambler': 'Spends a lot of time early and plays the end on the clock. Strong in scrambles, but some games are lost on time.',
  'Killer instinct': 'Gets attacks going and finishes them: quick wins, clear advantages, and few slips once ahead.',
  Guardian: 'Hard to break down: solid openings, holds against attacks, saves bad positions and rarely lets the opponent get ahead.',
  'Well prepared': 'Comes out of the opening better than players at the same level: knows the lines and the plans behind them.',
  Grinder: 'Scores more in endgames than players at the same level: the long games are theirs.',
  'Sure hand': 'Blunders less than players at the same level: rarely throws a piece or a game away.',
  Trickster: 'Sets traps and wins fast. Many games are over before move 25.',
  Specialist: 'Plays a narrow repertoire and knows it deeply. Rarely surprised in the opening.',
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
const STRENGTH = { Attack: 'Killer instinct', 'Early game': 'Well prepared', 'Late game': 'Grinder', Accuracy: 'Sure hand', Speed: 'Speed demon' };
// A strength on the same theme as the style says the same thing twice; then the next best skill is named.
const SAME = { 'Endgame artist': 'Late game', 'Time scrambler': 'Speed', Trickster: 'Attack', Guardian: 'Defense', Marathoner: 'Late game' };
// Every style with its weight (1 = clearly holds), most first, and every strength with its value (62 = clearly holds).
// Where each style's weight lies for an ordinary player: the median and the top tenth among 42 players
// checked (their main time control). A style counts by how far above the median a player is, against
// that spread, so a style the player is below the usual on (29 moves where 36 is usual) never wins.
const PAR = { Striker: [0.74, 1.3], 'Solid builder': [0.66, 1.4], 'Endgame artist': [0.76, 0.92], 'Time scrambler': [0.63, 1.07],
  Trickster: [0.53, 1.15], Specialist: [0.72, 0.98], Explorer: [0.22, 0.39], Marathoner: [0.75, 0.87], Guardian: [0.11, 1.33] };
function traitsOf(p) {
  const q = p.peer || {}, rating = p.speeds?.[0]?.rating, raw = rawSkills(p), def = raw.find((x) => x.label === 'Defense');
  const styles = [
    { name: 'Striker', w: p.attacking / 0.4, why: `${pct(p.attacking)} of your games are in attacking openings or gambits: you like the initiative early.` },
    { name: 'Solid builder', w: (p.solid / 0.55) * (p.attacking < 0.25 ? 1 : 0.6), why: `${pct(p.solid)} of your games are in solid or positional openings: you build first and attack later.` },
    { name: 'Endgame artist', w: p.queensOff / 0.4, why: `The queens come off before move 25 in ${pct(p.queensOff)} of your games: you are happy to trade and play it out.` },
    // Ending short of time is common in fast games for everyone, so it counts only when the player does
    // it clearly more than their own opponents at their level.
    { name: 'Time scrambler', w: Math.min(p.lowTime / 0.3, q.n >= 30 && q.myLow != null ? q.myLow / Math.max(q.oppLow, 0.05) / 1.4 : 0),
      why: `You end ${pct(p.lowTime)} of your games with under a tenth of your time left${q.oppLow != null ? `; your opponents at your level ${pct(q.oppLow)}` : ''}.` },
    { name: 'Trickster', w: q.n >= 30 && (q.quickW ?? 0) >= 0.1 ? (q.quickW / Math.max(q.quickL, 0.03)) / 1.6 : 0,
      why: `You win ${pct(q.quickW ?? 0)} of your games within 25 moves, your opponents at your level ${pct(q.quickL ?? 0)}: your traps and tricks land.` },
    // most club players lean on two openings (about 0.75 in 25 checked), so Specialist needs nearly all
    { name: 'Specialist', w: (p.top2 ?? 0) / 0.9, why: `Your two main openings are ${pct(p.top2 ?? 0)} of the openings you choose: you know your lines deeply.` },
    { name: 'Explorer', w: (p.families ?? 0) / 18 * ((p.top2 ?? 1) < 0.3 ? 1 : 0.5), why: `You play ${p.families ?? 0} different openings at least three times each: you like variety.` },
    { name: 'Marathoner', w: (p.moves / usualMoves(rating)) / 1.2, why: `Your games last ${p.moves} moves on average, where about ${usualMoves(rating)} is usual at your level.` },
    // The counterpart of Striker: a player whose Defense (solid openings, holding against attacks, saving
    // bad positions, rarely letting opponents get ahead) is clearly above their own opponents'.
    { name: 'Guardian', w: def.v !== null ? (def.v - 50) / 9 : 0, why: `You defend clearly better than your opponents at your level. ${def.why}` },
  ].map((x) => ({ ...x, lean: (x.w - PAR[x.name][0]) / (PAR[x.name][1] - PAR[x.name][0]) })).sort((x, y) => y.lean - x.lean);
  // Giant killer needs a clear surplus: upsets are common in fast games. Speed counts winning on time half,
  // since much of it is the opponent's doing.
  const extra = [
    { label: 'Giant killer', v: p.giantN >= 30 ? clamp(50 + p.giantGain * 100) : null, why: `Against players 100 or more above you, you score ${pct(p.giantGain ?? 0)} more per game than the rating gap predicts (${p.giantN} games).` },
    { label: p.winW >= p.winB ? 'White specialist' : 'Black specialist', v: p.nWhite >= 30 && p.n - p.nWhite >= 30 ? clamp(50 + Math.abs(p.winW - p.winB) * 100) : null,
      why: `You win ${pct(p.winW)} as White and ${pct(p.winB)} as Black.` },
    // Decided games or many draws say how a player's games go, not how they play, so they are
    // strengths (on the same scale: 64 or more stands out) rather than styles.
    { label: 'Fighter', v: clamp(50 + ((usualDraws(rating) / Math.max(p.draws, 0.005)) / 2 * Math.sqrt(35 / Math.max(p.moves, 15)) - 0.6) * 35),
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
  const ranked = strengths.filter((x) => x.label !== 'Defense' && x.v !== null && x.v > 50 && x.label !== SAME[style.name]).sort((x, y) => y.v - x.v);
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
console.assert(unlockAt({ analysed: 100, peer: { analysed: 95 } }).at === 250 && unlockAt({ analysed: 40, peer: { analysed: 30 } }).at === 250, 'unlockAt');
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
  const g = (o) => ({ side: 'w', speed: 'blitz', status: 'resign', plies: 60, result: 1, family: 'Italian Game', rating: 1500, diff: 5, castled: 8, queensOff: null, endgame: false, analysed: false, acc: null, blunders: null, best: null, worst: null, after12: null, slips: { opening: 0, middlegame: 0, endgame: 0 }, lowTime: false, ...o });
  const p = profileOf([g({}), g({ result: 0 }), g({ side: 'b', result: 0 }), g({ side: 'b', result: 0.5 })]);
  console.assert(p.score === 0.375 && p.white === 0.5 && p.type[0].name === 'Striker', 'profileOf');
}

// ---------- Fetching ----------
async function fetchGames(name, onGame, since = null, perf = 'bullet,blitz,rapid,classical') {
  const a = account();
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(name)}?` + new URLSearchParams({
    max: MAX, ...(since ? { since } : {}), rated: 'true', perfType: perf, moves: 'true', opening: 'true', clocks: 'true', evals: 'true', accuracy: 'true',
  }), { headers: { Accept: 'application/x-ndjson', ...(a ? { Authorization: `Bearer ${a.token}` } : {}) } });
  if (res.status === 404) throw new Error(`Lichess has no player called ${name}.`);
  if (res.status === 429) throw new Error('Lichess is busy right now. Try again in a minute.');
  if (!res.ok) throw new Error(`Lichess answered with an error (${res.status}).`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader(), games = [];
  let rest = '';
  // Lichess does not always stop at max, so reading stops by itself once there are enough games.
  while (games.length < MAX) {
    const { value, done } = await reader.read();
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
const endClocks = (cl) => (cl?.length ? [cl.filter((_, i) => i % 2 === 0).at(-1) ?? null, cl.filter((_, i) => i % 2 === 1).at(-1) ?? null] : null);
const player = (x) => ({ user: x.user ? { id: x.user.id } : undefined, rating: x.rating, ratingDiff: x.ratingDiff, analysis: x.analysis });
const J = { B: 'Blunder', M: 'Mistake', I: 'Inaccuracy' };
function pack(g) {
  const an = g.analysis;
  return { id: g.id, variant: 'standard', speed: g.speed, createdAt: g.createdAt, status: g.status, winner: g.winner, moves: g.moves,
    opening: g.opening ? { name: g.opening.name } : undefined, clock: g.clock ? { initial: g.clock.initial } : undefined,
    end: g.end || endClocks(g.clocks), ours: g.ours || undefined, at12: g.at12 ?? undefined, players: { white: player(g.players.white), black: player(g.players.black) },
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
async function build(name) {
  const msg = msgEl(), have = storedGames(name) || [];
  msg.textContent = have.length ? `Fetching ${name}'s new games from Lichess…` : `Fetching ${name}'s last ${MAX} rated games from Lichess…`;
  // Lichess sends about 20-30 games a second, so a first look-up takes a while: the profile is drawn
  // from the first EARLY games as soon as they are in, then drawn again from all of them.
  const mine = runs, bar = $('#pf-load');
  let early = false;
  if (bar && !quiet && !have.length) { bar.hidden = false; bar.firstElementChild.style.width = '0%'; }
  const fresh = await fetchGames(name, (k, gs) => {
    msg.textContent = early ? '' : `Fetching ${name}'s games from Lichess… ${k}`;
    if (bar && !bar.hidden) { bar.firstElementChild.style.width = `${(k / MAX) * 100}%`; bar.title = `${k} of ${MAX} games`; }
    if (!have.length && !quiet && (k === EARLY || (early && k % REDRAW === 0))) {
      early = true;
      loadScores().then(() => { if (mine === runs) { const y = scrollY; drawingEarly = true; try { render(name, Date.now(), profileOf(gs.slice().map((g) => readGame(g, name.toLowerCase())))); } finally { drawingEarly = false; } scrollTo(0, y); } }).catch(() => {});
    }
  }, have.length ? have[0].createdAt + 1 : null);
  if (bar) bar.hidden = true;
  const ids = new Set(fresh.map((g) => g.id));
  const raw = [...fresh, ...have.filter((g) => !ids.has(g.id))].slice(0, MAX);
  if (!raw.length) throw new Error(`${name} has no rated games on Lichess yet.`);
  merged = await mergeRemote(name, raw);
  saveGames(name, raw);
  RAW = raw; RAW_NAME = name;
  return readAll(name, raw);
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
    if (i % 25 === 24) { msg.textContent = `Reading the games… ${i + 1} of ${raw.length}`; await new Promise((r) => setTimeout(r)); }
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
function engineEval(fen) {
  const next = engineQueue.then(() => evalNow(fen));
  engineQueue = next.catch(() => {});
  return next;
}
function evalNow(fen) {
  engine ??= new Worker(ENGINE_SRC);
  const white = fen.split(' ')[1] === 'w';
  return new Promise((resolve) => {
    let cp = 0;
    engine.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      const m = e.data.match(/ score (cp|mate) (-?\d+)/);
      if (m && !/ (lower|upper)bound/.test(e.data)) {
        const n = Number(m[2]);
        cp = m[1] === 'cp' ? Math.max(-1000, Math.min(1000, n)) : n > 0 ? 1000 : -1000; // mate 0: the side to move is mated
      }
      if (e.data.startsWith('bestmove')) { const b = e.data.split(' ')[1]; resolve({ cp: white ? cp : -cp, best: b && b !== '(none)' ? b : null }); }
    };
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(`go movetime ${MS}`);
  });
}
const minutes = (sec) => (sec < 90 ? `about ${Math.max(1, Math.round(sec / 60))} min` : `about ${Math.round(sec / 60)} min`);
// What reaching `target` analysed games would take: just enough of the newest games without analysis
// (those analysed on Lichess already count), and the time.
function costOf(p, target) {
  const todo = (p.todo || []).filter(Boolean).slice(0, Math.max(0, target - p.analysed));
  return { games: todo.length, sec: sum(todo, (x) => x) * PER_POS };
}
let analysing = null; // { stop } while a run is going
// Early game needs only the position after move 12: Stockfish looks at that one position in every game
// without a full analysis, in the background, the first time a profile is shown. Kept with the games.
let quick = null; // the player whose games are being looked at
async function quickLook(name) {
  const raw = storedGames(name);
  if (quick || analysing || !raw) return;
  const todo = raw.filter((g) => !g.analysis && g.at12 == null && g.moves && g.moves.split(' ').length > 24);
  if (!todo.length) return;
  quick = name;
  const msg = () => $('#pf-early-msg');
  for (let k = 0; k < todo.length; k++) {
    if (analysing || shown?.[0] !== name) break; // a full analysis or another player takes over
    const c = new Chess();
    try { for (const m of todo[k].moves.split(' ').slice(0, 24)) c.move(m); } catch { continue; }
    todo[k].at12 = (await engineEval(c.fen())).cp;
    if (msg()) msg().textContent = `Looking at the position after move 12 in each game… ${k + 1} of ${todo.length}`;
    if (k % 50 === 49) saveGames(name, raw);
  }
  saveGames(name, raw);
  quick = null;
  if (shown?.[0] !== name || analysing) return;
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
  let done = 0;
  analysing = { stop: false };
  for (let k = 0; k < todo.length && !analysing.stop; k++) {
    const g = todo[k], c = new Chess(), cps = [], best = [];
    for (const mv of g.moves.split(' ')) {
      if (analysing.stop) break;
      try { c.move(mv); } catch { break; }
      const r = await engineEval(c.fen());
      cps.push(r.cp);
      best[cps.length] = r.best; // the best move here is the best instead of the next move
      done++;
      if (done % 10 === 0 && el) {
        const left = ((Date.now() - t0) / done) * (total - done) / 1000;
        el.querySelector('.pf-an-progress').textContent = `Analysing game ${k + 1} of ${todo.length} · ${minutes(left)} left`;
        el.querySelector('.pf-an-bar i').style.width = `${(done / total) * 100}%`;
      }
    }
    if (analysing.stop) break;
    applyEvals(g, cps, best);
    const m = own && RAW.find((x) => x.id === g.id);
    if (m) Object.assign(m, { analysis: g.analysis, ours: g.ours, players: g.players });
    saveGames(name, RAW); // a finished game is kept even if the run stops
    if (own) saveGames(speedKey(name, sp), own);
  }
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
  const btn = (o, cls) => `<button type="button" class="${cls}" data-analyse="${o.n}" title="The newest ${games(o.games)} without analysis, until ${o.n} are analysed: ${minutes(o.sec)}, with Stockfish in your browser">Analyse until ${o.n} <small>${o.games} games${next ? ` · ${tiers.find(([n]) => n === o.n)?.[1] || ''}` : ''} · ~${minutes(o.sec).replace('about ', '')}</small></button>`;
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
    <p class="pf-acc-src">Counts the games analysed on lichess.org (${p.analysed - (p.ours || 0)}) and here (${p.ours || 0}). The buttons analyse more of the Lichess games with Stockfish in your browser; each game is done once and kept.</p>
    <div class="pf-acc-foot"><p class="pf-acc-say">${say}</p>
    ${main ? `<div class="pf-an-row">${btn(main, 'cta pf-an-go')}${rest.map((o) => btn(o, 'pf-an-opt')).join('')}</div>` : ''}</div>
  </div>`;
}
function bindAnalyse(name) {
  const el = $('#pf-analyse');
  if (!el) return;
  el.querySelectorAll('[data-analyse]').forEach((b) => b.addEventListener('click', async () => {
    const n = Number(b.dataset.analyse);
    window.track?.('analyse', `${name}: until ${n}${pfSpeed && pfSpeed !== 'all' ? ` ${pfSpeed}` : ''}`);
    analysing = { stop: false };
    el.outerHTML = analysePanel(name, {});
    $('#pf-analyse').querySelector('[data-stop]').addEventListener('click', () => { if (analysing) analysing.stop = true; });
    try { await analyse(name, n, pfSpeed && pfSpeed !== 'all' ? pfSpeed : null); } catch (err) { analysing = null; $('#profile-msg').textContent = err.message; }
  }));
}

// ---------- The page ----------
function cache() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
const myName = () => account()?.name || (() => { try { return JSON.parse(localStorage.getItem('opening-book-v2-lichess-name')); } catch { return null; } })();
const isMe = (name) => !!myName() && name.toLowerCase() === myName().toLowerCase();
// Someone else's profile reads in the third person: "you score" becomes "they score".
const they = (t) => t.replace(/\b(Y|y)our\b/g, (_, y) => (y === 'Y' ? 'Their' : 'their')).replace(/\b(Y|y)ou\b/g, (_, y) => (y === 'Y' ? 'They' : 'they'));
console.assert(they('You score 50%; your games, you were') === 'They score 50%; their games, they were', 'they');
const search = (label) => `<form id="pf-form" class="rating-row pf-search" role="search"><input id="pf-name" type="text" required maxlength="30" pattern="[A-Za-z0-9_\\-]{2,30}" placeholder="Lichess username" aria-label="Lichess username" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="ghost" type="submit">${label}</button></form>`;
function bindSearch() {
  $('#pf-form')?.addEventListener('submit', (e) => { e.preventDefault(); show($('#pf-name').value.trim(), true); });
}
const games = (n) => `${n} game${n === 1 ? '' : 's'}`;
// Wins, draws, losses; a row with only a score (no win count) draws as wins and losses.
const bar = (o) => { const w = o.win ?? o.score, d = o.win == null ? 0 : Math.max(0, 2 * (o.score - o.win)), l = Math.max(0, 1 - w - d);
  return `<div class="wdl" role="img" aria-label="${pct(w)} wins, ${pct(d)} draws, ${pct(l)} losses"><span class="w" style="width:${w * 100}%"></span><span class="d" style="width:${d * 100}%"></span><span class="l" style="width:${l * 100}%"></span></div>`; };
const ago = (t) => { const h = (Date.now() - t) / 3.6e6; return h < 1 ? 'less than an hour ago' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`; };
// Each opening links to its lines in the trainer (?practise=, as on My practice).
const practiseLink = (side, fam) => `./?practise=${side}~${encodeURIComponent(fam.replace(/^vs /, ''))}`;
const opLink = (side, fam) => `<a class="pf-op-link" href="${practiseLink(side, fam)}" title="Practise the ${esc(fam.replace(/^vs /, ''))} lines">${esc(fam)}</a>`;
function openingRows(list, side) {
  return list.length ? `<ul class="pf-rows">${list.slice(0, 6).map((o) => `<li><a class="pf-op-link" href="${practiseLink(side, o.fam)}" title="Practise the ${esc(o.fam.replace(/^vs /, ''))} lines">${esc(o.fam)}</a><small>${games(o.n)} · ${pct(o.win ?? o.score)} wins</small>${bar(o)}</li>`).join('')}</ul>` : '<p class="info">Fewer than 5 games with any one opening.</p>';
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
function tasteLine(mix, me) {
  const w = taste(mix?.w), b = taste(mix?.b);
  if (!w && !b) return '';
  const tile = (x, c, side) => x ? `<div class="pf-taste-tile"><img src="pieces/${c}K.svg" alt=""><span><small>Openings as ${side}</small><b>${x.label}</b><small>${pct(x.share)} of ${me ? 'your' : 'their'} choices</small></span></div>` : '';
  return `<div class="pf-taste-tiles" aria-label="Opening taste">${tile(w, 'w', 'White')}${tile(b, 'b', 'Black')}</div>`;
}
// How games end: wins and losses split by mate, resignation and time, as numbers with a small bar each.
function endsGrid(ends) {
  const kinds = [['mate', 'By mate'], ['resign', 'Resigned'], ['time', 'On time']];
  const row = (label, cls, x) => `<div class="pf-ends-row ${cls}"><span class="pf-ends-label">${label}</span>${kinds.map(([k, name]) => `
    <div class="pf-ends-cell"><b>${pct(x[k])}</b><small>${name}</small><span class="pf-ends-bar"><i style="width:${x[k] * 100}%"></i></span></div>`).join('')}</div>`;
  return `<div class="pf-ends">${row('Wins', 'won', ends.won)}${row('Losses', 'lost', ends.lost)}</div>`;
}
// The leak: the worst skill clearly below the player's opponents (45 or less); 46–55 is noise.
const leakOf = (skills) => skills.filter((x) => x.raw !== null && x.raw <= 45).sort((a, b) => a.raw - b.raw)[0] || null;

// A portrait in words, from this player's own games: the openings they actually choose, how their
// games end, their best piece, and the area that lifts or holds them back. No two read the same.
function portrait(name, p, skills, me, part = 'lead') {
  const you = me ? 'You' : esc(name), your = me ? 'your' : 'their', are = me ? 'are' : 'is';
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
  out.push(`${you} ${are} ${article(t[0])} ${t[0]}${t[1] ? ` with a ${t[1]}'s streak` : ''}${w.length || b.length ? `, reaching for ${[w.length && `the ${and(w)} as White`, b.length && `the ${and(b)} as Black`].filter(Boolean).join(' and ')}` : ''}.`);
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
console.assert(bandColor(1226) === '#1aa3a8' && bandColor(3263) === '#d4a017' && bandColor(500) === '#858a91' && tierOf(1400) === 3, 'bandColor');
const darker = (hex) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.78).toString(16).padStart(2, '0')).join('')}`; // as CSS's 78% mix with black
// The six skills as bars, so a player's shape reads before the numbers; [label, value] pairs.
const cardBars = (xs, on = null) => `<div class="pf-pcard-bars">${xs.map(([k, v]) => `<div${k === on ? ' class="on"' : ''}><span>${k}</span><i style="--v:${v ?? 0}%"></i><b>${v ?? '–'}</b></div>`).join('')}</div>`;
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
// Known professional players' Lichess accounts (checked: the name on the account, or widely known, as
// Magnus Carlsen's DrNykterstein): their cards wear a gold PRO frame wherever they show.
const PROS = new Map(Object.entries({ drnykterstein: 'GM Magnus Carlsen', alireza2003: 'GM Alireza Firouzja', nihalsarin2004: 'GM Nihal Sarin', penguingim1: 'GM Andrew Tang',
  zhigalko_sergei: 'GM Sergei Zhigalko', vladimirovich9000: 'GM Dmitry Andreikin', may6enexttime: 'GM Aleksei Sarana', 'night-king96': 'GM Oleksandr Bortnyk',
  konevlad: 'GM Vladislav Artemiev', ericrosen: 'IM Eric Rosen', fins: 'IM John Bartholomew' }));
// On a pro's profile, under the name: who the account belongs to.
const proLine = (name) => {
  const who = proOf(name), title = /^(GM|IM) /.test(who || '') ? who.split(' ')[0] : '';
  return who ? `<p class="pf-pro-line ${proKind(name)}"><span class="pf-pro-tag">${proKind(name).toUpperCase()}</span><b>${esc(who.replace(/^(GM|IM) /, ''))}</b>${title ? `<span class="pf-pro-title">${title}</span>` : ''}</p>` : '';
};
// Known streamers and chess creators (checked the same way): a VIP frame instead.
const VIPS = new Map(Object.entries({ agadmator: 'Antonio Radić', tigerlilov: 'IM Valeri Lilov' }));
const proOf = (name) => PROS.get(String(name).toLowerCase()) || VIPS.get(String(name).toLowerCase()) || null;
const proKind = (name) => (PROS.has(String(name).toLowerCase()) ? 'pro' : VIPS.has(String(name).toLowerCase()) ? 'vip' : '');
const proClass = (name) => (proKind(name) ? ` ${proKind(name)}` : '');
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
  const todo = [...new Set(names.map((n) => String(n).toLowerCase()))].filter((n) => !FLAGS.has(n));
  for (let i = 0; i < todo.length; i += 300) {
    const part = todo.slice(i, i + 300);
    const users = await fetch('https://lichess.org/api/users', { method: 'POST', body: part.join(',') }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    part.forEach((n) => FLAGS.set(n, null));
    for (const u of users) FLAGS.set(u.id, flagCode(u.profile?.flag));
  }
}
// The flag as an image for the downloaded cards (null without one).
const flagImage = (name) => { const c = FLAGS.get(String(name).toLowerCase()); return c ? new Promise((ok) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = flagSrc(c); }) : Promise.resolve(null); };
function playerCard(name, p, t, skills) {
  const known = skills.filter((x) => x.v !== null);
  const ovr = known.length ? Math.round(sum(known, (x) => x.v) / known.length) : '–';
  const main = p.speeds[0];
  return `<div class="pf-pcard${proClass(name)}" style="--band:${bandColor(main?.rating)}" role="img" aria-label="Player card: overall ${ovr}, ${t[0].name}${t[1] ? ` + ${t[1].name}` : ''}, ${known.map((x) => `${x.label} ${x.v}`).join(', ')}">${flagHtml(name)}
    <div class="pf-pcard-top"><div><b class="pf-ovr">${ovr}</b><span class="pf-pos">${esc(t[0].name)}</span>${t[1] ? `<span class="pf-str">+ ${esc(t[1].name)}</span>` : ''}</div>
      <div class="pf-pcard-side"><img class="pf-pcard-piece ink-on-light" src="pieces/b${(p.piece || 'n').toUpperCase()}.svg" alt="" aria-hidden="true"><img class="pf-pcard-piece ink-on-dark" src="pieces/${CARD_INK}${(p.piece || 'n').toUpperCase()}.svg" alt="" title=""${esc(name)}'s most important piece: the ${PIECE_NAME[p.piece || 'n']}, ${p.pieceWhy === 'chosen' ? `chosen by ${esc(name)}` : p.pieceWhy === 'best' ? `the piece played best, with the fewest mistakes and blunders per move in the analysed games` : 'the piece that does the most in these games (analyse 20 games to see the one played best)'}">
        ${main ? `<span class="pf-pcard-rating">${main.rating} <small>${main.speed}</small></span>` : ''}</div></div>
    <p class="pf-pcard-name">${esc(name)}</p>
    ${cardBars(skills.map((x) => [ABBR[x.label], x.v]))}
    <p class="pf-pcard-foot">${main ? `VS ${main.rating - PEER}–${main.rating + PEER} · ` : ''}${p.n} ${main && p.speeds.length === 1 ? `${main.speed.toUpperCase()} ` : ''}GAMES</p>
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
// One card, 600 x 780 units, top left at (x, y).
function drawCard(ctx, x, y, name, p, t, skills, piece, flag = null) {
  const known = skills.filter((k) => k.v !== null), ovr = known.length ? String(Math.round(sum(known, (k) => k.v) / known.length)) : '–', main = p.speeds[0];
  const band = CARD.band(main?.rating);
  ctx.save(); ctx.translate(x, y);
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
    const w = ctx.measureText(sp).width; ctx.font = '400 52px Anton'; ctx.fillStyle = CARD.ink; ctx.fillText(String(main.rating), 560 - w - 10, 232); ctx.textAlign = 'left';
  }
  ctx.fillStyle = CARD.line; ctx.fillRect(40, 292, 520, 2); ctx.fillRect(40, 392, 520, 2);
  ctx.fillStyle = CARD.ink; ctx.textAlign = 'center'; fit(ctx, name.toUpperCase(), '400 #px Anton', 60, 520); ctx.fillText(name.toUpperCase(), 300, 366); ctx.textAlign = 'left';
  // The six skills as bars, in the card's colour.
  skills.forEach((k, i) => {
    const cy = 452 + i * 50;
    ctx.fillStyle = CARD.muted; ctx.font = '400 28px Anton'; ctx.fillText(ABBR[k.label], 44, cy);
    ctx.fillStyle = CARD.line; ctx.beginPath(); ctx.roundRect(150, cy - 20, 330, 14, 3); ctx.fill();
    if (k.v) { ctx.fillStyle = band; ctx.beginPath(); ctx.roundRect(150, cy - 20, 330 * k.v / 100, 14, 3); ctx.fill(); }
    ctx.fillStyle = CARD.ink; ctx.font = '400 38px Anton'; ctx.textAlign = 'right'; ctx.fillText(String(k.v ?? '–'), 558, cy + 2); ctx.textAlign = 'left';
  });
  ctx.fillStyle = CARD.muted; ctx.textAlign = 'center'; ctx.font = '600 20px Geist'; ctx.letterSpacing = '4px';
  ctx.fillText(`${main ? `VS ${main.rating - PEER}–${main.rating + PEER} · ` : ''}${p.n} GAMES`, 300, 752);
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
      ctx.fillStyle = CARD.paperInk; ctx.font = '700 20px Geist'; fit(ctx, A.name, '700 #px Geist', 20, 240); ctx.fillText(A.name, ca, y); fit(ctx, B.name, '700 #px Geist', 20, 240); ctx.fillText(B.name, cb, y);
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
    ctx.fillStyle = CARD.paperInk; ctx.font = '400 28px Anton'; ctx.fillText('CHESS TRAINER', 70, H - 34);
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
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png')), file = new File([blob], `${name}-chess-${detail ? 'profile' : 'card'}-${cardLook()}.png`, { type: 'image/png' });
    await saveImage(blob, file, `${name}'s chess card`);
  } catch (err) { $('#profile-msg').textContent = `The image could not be made: ${err.message}`; }
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
        const tt = taste(m); if (!tt) continue;
        ctx.fillStyle = CARD.hot; ctx.fillRect(x, y, max, 4);
        ctx.fillStyle = CARD.paperMuted; ctx.font = '700 15px Geist'; ctx.letterSpacing = '2px'; ctx.fillText(`OPENINGS AS ${side.toUpperCase()}`, x, y += 34); ctx.letterSpacing = '0px';
        ctx.fillStyle = CARD.paperInk; ctx.font = '400 40px Anton'; ctx.fillText(tt.label.toUpperCase(), x, y += 46);
        ctx.fillStyle = CARD.paperMuted; ctx.font = '400 18px Geist'; ctx.fillText(`${pct(tt.share)} of their choices`, x, y += 28); y += 30;
      }
        let ty = 760;
      ctx.fillStyle = CARD.paperInk; ctx.font = '400 32px Geist';
      ty = wrap(ctx, lead, 60, ty, W - 120, 46, 5) + 24;
      ctx.fillStyle = CARD.paperMuted; ctx.font = '400 24px Geist';
      for (const k of t) { ctx.font = '700 24px Geist'; ctx.fillStyle = CARD.paperInk; ctx.fillText(`${k.name}.`, 60, ty); const w = ctx.measureText(`${k.name}. `).width; ctx.font = '400 24px Geist'; ctx.fillStyle = CARD.paperMuted; ty = wrap(ctx, TYPE_ABOUT[k.name] || '', 60, ty, W - 120, 34, 3, w) + 12; }
      ctx.fillStyle = CARD.hot; ctx.fillRect(60, H - 96, W - 120, 3);
      ctx.fillStyle = CARD.paperInk; ctx.font = '400 30px Anton'; ctx.fillText('CHESS TRAINER', 60, H - 50);
      ctx.fillStyle = CARD.paperMuted; ctx.font = '400 20px Geist'; ctx.textAlign = 'right'; ctx.fillText(`From ${name}'s last ${p.n} rated Lichess games`, W - 60, H - 52); ctx.textAlign = 'left';
    }
    return canvas;
  }
}
function cardNote(name, p, me) {
  const main = p.speeds[0];
  if (!main) return '';
  return `<details class="pf-card-help"><summary>How the stats work</summary><p class="pf-card-note"><b>Every stat compares ${me ? 'you' : esc(name)} with ${me ? 'your' : 'their'} own opponents</b>, rated ${main.rating - PEER}–${main.rating + PEER}, in the same games. A higher rating starts the card higher; the big number is the average of the six skills. <a href="#pf-skills">What each skill measures</a></p></details>`;
}
// Logged in: a small log-out button in the top bar, on the profile only.
if (account()) {
  document.querySelector('#theme')?.insertAdjacentHTML('beforebegin', `<button id="pf-logout" class="ghost theme" type="button" title="Log out of Lichess (${account().name})" aria-label="Log out"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/></svg></button>`);
  document.querySelector('#pf-logout')?.addEventListener('click', () => { if (confirm(`Log out of Lichess (${account().name})?`)) { logout(); location.href = './'; } });
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
  const gambits = [...p.openings.w.map((o) => ({ ...o, side: 'w' })), ...p.openings.b.map((o) => ({ ...o, side: 'b' }))].filter((o) => !/^vs /.test(o.fam) && /Gambit/.test(o.fam) && !/Accepted|Declined/.test(o.fam));
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
function perfsOf(name) {
  const k = name.toLowerCase();
  if (!PERFS.has(k)) PERFS.set(k, fetch(`https://lichess.org/api/user/${encodeURIComponent(name)}`).then((r) => (r.ok ? r.json() : null))
    .then((u) => { if (u) FLAGS.set(k, flagCode(u.profile?.flag)); return u && Object.fromEntries(SPEEDS.map((sp) => [sp, u.perfs?.[sp]?.games || 0])); }).catch(() => null)
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
  if (sp === 'all') { full.type = stableType(name, 'all', full); return full; }
  const own = storedGames(speedKey(name, sp)), mixed = storedGames(name);
  const done = new Map(mixed.filter((g) => g.analysis).map((g) => [g.id, g])); // analysed among all the player's games
  // Games played since the time control's own were fetched come in with the player's newest (Refresh and
  // every visit fetch those), so the card always ends on the latest game and rating.
  const newer = own ? mixed.filter((g) => g.speed === sp && g.createdAt > (own[0]?.createdAt || 0)) : [];
  const games = own ? [...newer, ...own].slice(0, MAX).map((g) => (!g.analysis && done.get(g.id)) || g) : mixed;
  const p = profileOf(recordsOf(name, games).filter((g) => g.speed === sp));
  p.type = stableType(name, sp, p);
  return p;
}
// A time control's own last 500 games, fetched when it is picked and the last 500 of all hold fewer
// than Lichess has; later picks fetch only the games played since.
async function fetchSpeed(name, sp) {
  const have = storedGames(speedKey(name, sp)) || [], mixed = (storedGames(name) || []).filter((g) => g.speed === sp);
  const perfs = await perfsOf(name);
  if (!have.length && (!perfs || mixed.length >= Math.min(MAX, perfs[sp]))) return false; // the last 500 of all already hold them
  const msg = $('#profile-msg');
  if (!have.length) msg.textContent = `Fetching ${name}'s last ${Math.min(MAX, perfs[sp])} ${sp} games from Lichess…`;
  const fresh = await fetchGames(name, (k) => { if (!have.length) msg.textContent = `Fetching ${name}'s ${sp} games from Lichess… ${k} of ${Math.min(MAX, perfs[sp])}`; },
    have.length ? have[0].createdAt + 1 : null, sp);
  msg.textContent = '';
  const ids = new Set(fresh.map((g) => g.id)), raw = [...fresh, ...have.filter((g) => !ids.has(g.id))].slice(0, MAX);
  await mergeRemote(name, raw);
  saveGames(speedKey(name, sp), raw);
  return true;
}
function speedBar(name, full, sp, avail) {
  if (avail.length < 2 && sp !== 'all') return '';
  // A time control with more games on Lichess than the card reads says so: picking it fetches them.
  return `<div class="pf-seg pf-speeds" role="group" aria-label="Time control">${[['all', full.n], ...avail].map(([k, n, all = 0]) =>
    `<button type="button" data-pf-speed="${k}" aria-pressed="${k === sp}"${all > n && n < MAX ? ` title="${n} of ${all} ${k} games read: pick it to fetch the last ${Math.min(MAX, all)}"` : k === full.speeds[0]?.speed ? ' title="Played most"' : ''}>${k === full.speeds[0]?.speed ? '<i class="pf-speed-star" aria-label="played most">★</i>' : ''}<span>${k === 'all' ? 'All' : k[0].toUpperCase() + k.slice(1)}</span><small>${n}</small></button>`).join('')}</div>`;
}
let shownCode = ''; // render: the card on screen as a short code (cardCode)
let shownP = null;
function render(name, at, full) {
  shown = [name, at, full];
  const avail = speedsOf(name, full), main = full.speeds[0]?.speed;
  const sp = pfSpeed && (pfSpeed === 'all' || avail.some(([k]) => k === pfSpeed)) ? pfSpeed : avail.some(([k]) => k === main) ? main : 'all';
  const p = forSpeed(name, full, sp);
  if (sp !== 'all') chartState.speed = sp;
  const t = p.type, me = isMe(name), say = me ? (x) => x : they, skills = skillsOf(p);
  shownCode = cardCode(p, t, skills); // the card as drawn, for the lookup's event
  shownP = p; // the card's profile, for the piece menu
  document.title = me ? 'Your Profile' : `${name} · Profile`;
  const kpis = [['Win rate', pct(p.winRate ?? p.score)], ['Accuracy', p.acc !== null && p.analysed >= KPI_MIN ? `${p.acc}%` : '–'], ['Blunders / game', p.blunders !== null && p.analysed >= KPI_MIN ? p.blunders.toFixed(1) : '–'], ['Draws', pct(p.draws)]].filter(Boolean);
  $('#profile').innerHTML = `
    ${nameRow(name)}${proLine(name)}
    <section class="pf-hero">
      <div class="pf-card-col">${playerCard(name, p, t, skills)}${speedBar(name, full, sp, avail)}${me ? starsStrip() : ''}<details class="pf-dl"><summary title="Download the card" aria-label="Download the card"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 19h14"/></svg></summary>
        <div class="pf-dl-menu" role="group" aria-label="Download"><div class="pf-dl-look" role="group" aria-label="Look">${['dark', 'light'].map((k) => `<button type="button" data-card-look="${k}" aria-pressed="${cardLook() === k}">${k === 'dark' ? 'Dark' : 'Light'}</button>`).join('')}</div><button type="button" data-card-png="card">Card</button><button type="button" data-card-png="style">Card + style</button><button type="button" data-card-png="both">Both</button></div></details>${cardNote(name, p, me)}</div>
      <div class="pf-hero-text">
        <div class="pf-type-row"><div><h2 class="pf-h1">${esc(t[0].name)}</h2>
        ${t.length > 1 ? `<p class="pf-sub">+ ${t.slice(1).map((x) => esc(x.name)).join(' + ')}</p>` : ''}</div>${tasteLine(p.styleMix, me)}</div>
        <p class="pf-portrait">${portrait(name, p, skills, me)}</p>
        <div class="pf-why-type">
          <div class="pf-about">${t.map((x) => `<p><b>${esc(x.name)}.</b> ${esc(TYPE_ABOUT[x.name] || '')} <span>${esc(say(x.why))}</span></p>`).join('')}</div>
          <p class="pf-more-portrait">${portrait(name, p, skills, me, 'more')}</p>
        </div>
      </div>
    </section>
    <section class="pf-card pf-chart" id="pf-chart"></section>
    <dl class="pf-kpis">${kpis.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${leadStory(name, p, skills, me)}
    <section class="pf-card pf-skills-card${showSkillText ? ' open' : ''}" id="pf-skills">
      ${p.n < MIN_GAMES ? `<p class="pf-an-few">Only ${p.n} rated games: skills need at least ${MIN_GAMES}.</p>` : ''}
      <div class="pf-skills-head"><h2>${me ? 'Skills' : `${esc(name)}'s skills`}</h2>
        <button type="button" class="link" data-skill-text aria-expanded="${showSkillText}">${showSkillText ? 'Hide explanations' : 'What each one means'}</button></div>
      ${skillBars(skills, say, me)}
      <p class="pf-skill-scale">All against opponents within ${PEER} of ${me ? 'your' : 'their'} rating; the mark on each bar is as good as them.</p>
    </section>
    ${sp === 'all' ? analysePanel(name, full, p) : analysePanel(name, p, p, sp)}
    <section class="pf-card pf-more"><div class="pf-more-head"><h2>Results and openings</h2><span>From ${sp === 'all' ? `all ${p.n} games` : `${p.n} ${sp} games`}</span></div>
      <div class="pf-two pf-more-body">
        <section><h3>By colour and time control</h3>
          <dl class="pf-stats">
            <div><dt>Wins as White</dt><dd>${p.winW == null ? '–' : pct(p.winW)}</dd></div>
            <div><dt>Wins as Black</dt><dd>${p.winB == null ? '–' : pct(p.winB)}</dd></div>
            <div><dt>Moves a game</dt><dd>${p.moves}</dd></div>
          </dl>
          <ul class="pf-rows">${p.speeds.map((x) => `<li><span>${x.speed[0].toUpperCase() + x.speed.slice(1)}</span><small>${games(x.n)} · ${pct(x.win ?? x.score)} wins · now ${x.rating} (${x.change >= 0 ? '+' : ''}${x.change} over these games)</small>${bar(x)}</li>`).join('')}</ul>
          <h3>How ${me ? 'your' : 'their'} games end</h3>
          ${endsGrid(p.ends)}
        </section>
        <section><h3>Openings as White</h3>${openingRows(p.openings.w, 'w')}
          <h3>Openings as Black</h3>${openingRows(p.openings.b, 'b')}</section>
      </div>
    </section>
    <section class="pf-card" id="pf-games"></section>
    <section class="pf-about-data">
      <h2>About these numbers</h2>
      <p class="info">Read from ${me ? 'your' : `${esc(name)}'s`} last ${p.n} rated Lichess games, ${ago(at)}. <button id="refresh" class="link" type="button">Read them again</button></p>
      <p class="info">Results, openings, opening style, the clock, endgames and the rating graph use all ${p.n} games.
        Early game uses Stockfish's verdict on the position after move 12 in every game (looked at here once). Accuracy, blunders and the Defense and Accuracy skills (and part of Attack) need a computer's verdict on every move, so they use only the
        ${p.analysed} analysed game${p.analysed === 1 ? '' : 's'} among the ${p.n} shown${p.ours ? ` (${p.ours} analysed here with Stockfish, the rest by Lichess)` : ''}. ${p.todo ? 'Analyse more with the Analyse button under Skills.' : ''}</p>
      <p class="info">Player types, skills and thresholds are rules of thumb read from the games, not a rating. Win rate counts wins out of all games; an endgame score counts a draw as half.</p>
    </section>
    ${me ? starsCard() : ''}
    ${nextActions(name, me)}`;
  $('#refresh').addEventListener('click', () => run(name));
  if (me) {
    sendCard(name, full, sp);
  }
  // Dark or light: remembered, and the menu stays open to pick what to download.
  document.querySelectorAll('[data-card-look]').forEach((b) => b.addEventListener('click', () => {
    try { localStorage.setItem('chess-trainer-card-look', b.dataset.cardLook); } catch {}
    document.querySelectorAll('[data-card-look]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));
  document.querySelectorAll('[data-card-png]').forEach((b) => b.addEventListener('click', async () => {
    b.closest('details').open = false;
    const k = b.dataset.cardPng;
    if (k !== 'style') await cardPng(name, p, t, skills, false, b);
    if (k !== 'card') await cardPng(name, p, t, skills, true, b);
  }));
  bindSearch();
  bindAnalyse(name);
  quickLook(name);
  $('.pf-card-help a[href="#pf-skills"]')?.addEventListener('click', (e) => { e.preventDefault(); $('#pf-skills').scrollIntoView({ behavior: 'smooth' }); });
  document.querySelectorAll('[data-pf-speed]').forEach((b) => b.addEventListener('click', async () => {
    const sp = b.dataset.pfSpeed, redraw = () => { const y = scrollY; render(...shown); scrollTo(0, y); };
    pfSpeed = sp; redraw();
    if (sp === 'all') return;
    try { if (await fetchSpeed(name, sp) && pfSpeed === sp) redraw(); } catch (err) { $('#profile-msg').textContent = err.message; }
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
}

addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('details.pf-help[open]').forEach((d) => { d.open = false; d.querySelector('summary').focus(); }); });
// The lead story under the card: recent form (the last ten results) and the one thing to train now.
// The same last 10 games as the form row above: openings, colours, how they ended, accuracy.
function recentFacts(rs, p) {
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`, wins = (xs) => xs.filter((r) => r.result === 1).length;
  const fams = Object.entries(rs.reduce((m, r) => ({ ...m, [r.family]: [...(m[r.family] || []), r] }), {})).sort((a, b) => b[1].length - a[1].length);
  const how = { mate: 'by mate', resign: 'by resignation', outoftime: 'on time', timeout: 'on time' };
  const ends = (xs) => { const c = xs.reduce((m, r) => ({ ...m, [how[r.status] || 'other ways']: (m[how[r.status] || 'other ways'] || 0) + 1 }), {}); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]; };
  const won = rs.filter((r) => r.result === 1), lost = rs.filter((r) => r.result === 0), w = rs.filter((r) => r.side === 'w'), b = rs.filter((r) => r.side === 'b');
  const acc = rs.filter((r) => r.acc !== null);
  return [
    fams.length && ['Openings', fams[0][1].length > 1 ? `${opLink(fams[0][1][0].side, fams[0][0])} ${fams[0][1].length} times, ${n(wins(fams[0][1]), 'win')}${fams[1] ? `; also ${opLink(fams[1][1][0].side, fams[1][0])}` : ''}` : `${fams.length} different openings, none twice`],
    ['Colours', `${n(wins(w), 'win')} in ${w.length} as White, ${wins(b)} in ${b.length} as Black`],
    (won.length || lost.length) && ['Endings', [won.length && `${ends(won)[1]} of ${n(won.length, 'win')} ${ends(won)[0]}`, lost.length && `${ends(lost)[1]} of ${n(lost.length, 'loss').replace('losss', 'losses')} ${ends(lost)[0]}`].filter(Boolean).join(', ')],
    acc.length >= 3 && p.acc !== null && ['Accuracy', `${Math.round(sum(acc, (r) => r.acc) / acc.length)}% in the ${acc.length} analysed, against ${p.acc}% usually`],
  ].filter(Boolean);
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
  const last = (mine.length ? mine : games).slice(0, 10), form = last.map(res), wins = form.filter((x) => x === 'W').length, latest = last[0];
  return `<section class="pf-lead solo">
    <div class="pf-news"><h2>Latest</h2>
      ${form.length ? `<p class="pf-form-row" aria-label="Last ${form.length} games, newest first: ${form.join(' ')}">${last.map((g, i) => `<a class="pf-res r-${form[i]}" href="game.html?u=${encodeURIComponent(name)}&id=${g.id}" title="${{ W: 'Won', L: 'Lost', D: 'Drew' }[form[i]]} against ${esc(g.players[sideOf(g) === 'white' ? 'black' : 'white'].user?.id || 'anonymous')}, ${day(g.createdAt)}: open the game">${form[i]}</a>`).join('')}</p>
        <p class="info">${wins} win${wins === 1 ? '' : 's'} in the last ${form.length}${main ? ` ${main}` : ''} games, newest first · last played ${day(latest.createdAt)}${change !== null ? ` · <b class="${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : '−'}${Math.abs(change)}</b> this week in ${recent.length} game${recent.length === 1 ? '' : 's'}` : ''}</p>` : ''}
      <div class="pf-fetch-row">
      <button type="button" class="ghost pf-fetch" data-fetch title="Fetch the games played on Lichess since this profile was read"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg> New games</button>
      ${shown?.[1] ? `<small class="pf-fetched" id="pf-fetched">Updated ${ago(shown[1])}</small>` : ''}</div>
      ${last.length ? `<dl class="pf-facts">${recentFacts(last.map((g) => readGame(g, name.toLowerCase())), p).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
    </div>
  </section>`;
}
// The page ends on what to do next, not on the fine print.
// Your stars from the Openings trainer, across every opening and time control (on your Lichess account
// when logged in, header.js syncs them; else in this browser):
// green for a line played through in Learn, gold for one cleared in Practice, diamond for one played
// without a slip in the time trial; and the openings with the most, each linking to its lines.
const STAR_PATH = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z';
const starIcon = (kind) => `<svg class="line-star ${kind}" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`;
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
function nextActions(name, me) {
  const friend = favs()[0];
  return `<section class="pf-next"><h2>What next</h2><div>
    ${me ? '<a class="cta" href="practice.html">Open your training plan</a>' : ''}
    <a class="${me ? 'ghost' : 'cta'}" href="${pickLink(name)}">${me ? 'Compare with someone' : `Compare ${esc(name)}`}</a>
  </div></section>`;
}

// ---------- Rating over time ----------
// Lichess's own rating history (all time, every time control) when it answers, else the ratings after
// the games read here, which reach back as far as those 500 games do.
const RANGES = [['1W', 7], ['1M', 30], ['6M', 182], ['1Y', 365], ['All', Infinity]];
const DAY = 864e5;
async function historyOf(name, p) {
  try {
    const a = account();
    const res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(name)}/rating-history`, a ? { headers: { Authorization: `Bearer ${a.token}` } } : {});
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
      ${covers ? '' : `<p class="info pf-note">The graph starts at ${new Date(first).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, the oldest of the games read here. ${account() ? '' : 'Lichess gives the full history only to someone logged in. <button type="button" class="link" data-chart-login>Log in with Lichess</button>'}</p>`}`;
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
    <p class="info">Log in with Lichess and this page reads your last ${MAX} rated games: what kind of player you are, what you are good at, what to work on, and your stats.</p>
    <p><button id="pf-login" class="cta" type="button">Log in with Lichess</button></p>
    <p class="info">Or look up any player:</p>${search('Look up')}</section>`;
  $('#pf-login').addEventListener('click', login);
  bindSearch();
}

let runs = 0; // a newer look-up wins over one still reading games
async function run(name) {
  await gamesReady;
  const mine = ++runs, c = cache()[name.toLowerCase()];
  await loadScores(); // a saved profile is drawn without reading the games, but its time controls are read again
  if (shown && shown[0].toLowerCase() !== name.toLowerCase()) pfSpeed = null; // another player starts on their own main time control
  // Seen before: show the saved profile at once, then fetch new games quietly and redraw only if there were any.
  if (c && c.v === PV) {
    try { render(c.name || name, c.at, c.p); } catch (err) { console.warn('saved profile could not be shown, reading it again', err); }
    window.track?.('profile', `${c.name || name} #${shownCode}`); // counted only for a player that was found, with their card for the admin page
    const before = storedGames(name) || [], top = before[0]?.id; // no games kept here yet: redraw once they are, with their time controls
    quiet = true;
    try {
      const p = await build(name), after = storedGames(name);
      if (mine === runs && (merged || after[0]?.id !== top || after.length !== before.length || !before.length)) { const y = scrollY; render(name, Date.now(), p); scrollTo(0, y); }
    } catch {} finally { quiet = false; }
    return;
  }
  // A skeleton of the page while the games are read, so it is never blank.
  $('#profile').innerHTML = `<section class="pf-hero pf-skeleton" aria-hidden="true"><div class="pf-card-col"><div class="pf-pcard"><b class="pf-ovr">–</b><p class="pf-pcard-name">${esc(name)}</p></div></div>
    <div class="pf-hero-text"><span class="pf-sk-line w60"></span><span class="pf-sk-line"></span><span class="pf-sk-line"></span><span class="pf-sk-line w80"></span></div></section>`;
  $('#profile-msg').textContent = `Looking up ${name} on Lichess…`;
  // Lichess can be slow to start sending games; say so instead of leaving the page blank.
  const slow = setTimeout(() => { if (mine === runs && /Looking up|Fetching/.test($('#profile-msg').textContent)) $('#profile-msg').textContent += ' Lichess is slow right now; still waiting.'; }, 12000);
  try {
    const p = await build(name);
    if (mine === runs) render(name, Date.now(), p);
    window.track?.('profile', `${cache()[name.toLowerCase()]?.name || name} #${shownCode}`);
  } catch (err) {
    if (mine === runs) failed(name, err);
  } finally { clearTimeout(slow); }
}
// Something went wrong: say what, and offer to try again (reading the games afresh).
function failed(name, err) {
  console.error(err);
  $('#profile-msg').innerHTML = `${esc(err.message || String(err))} <button type="button" class="link" data-retry>Try again</button>`;
  $('[data-retry]').addEventListener('click', () => run(name));
}

// A profile from games already fetched (Lichess's shape), without fetching: for checking the types on many players.
const profileFromRaw = async (name, raw) => (await loadScores(), profileOf(raw.map((g) => readGame(g, name.toLowerCase()))));
export { keptTypes, cardImage, playerCard, flagHtml, loadFlags, bandColor, tierOf, TIERS_AT, proClass, proOf, PROS, boardCard, fineSkillsOf, gamesReady, build, current, cache, myName, skillsOf, storedGames, keepGame, engineEval, applyEvals, winPct, PV, traitsOf, profileFromRaw };
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
      <span class="pf-game-main"><b>vs ${esc(opp.user?.id || 'anonymous')}</b> <small>${opp.rating || ''}</small><br><small>${esc((g.opening?.name || '').split(':')[0])}</small></span>
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
const pickLink = (a) => `profile.html?u=${encodeURIComponent(a)}&vs=`; // compare a with someone to pick (comparePick)
// The name, with small icons in the corner: star this player, compare with them, them on Lichess.
function nameRow(name) {
  const me = isMe(name), mine = myName(), fav = isFav(name);
  const icon = (d, solid = false) => `<svg class="ico${solid ? ' ico-solid' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  return `<div class="pf-name-row"><h1 class="pf-name" style="--n:${name.length}">${esc(name)}</h1>${me ? '' : `<div class="pf-acts">
    <button type="button" class="ghost pf-act pf-star" data-fav aria-pressed="${fav}" aria-label="${fav ? 'Starred: unstar' : 'Star this player'}" title="${fav ? 'Starred (press to unstar)' : 'Star this player: one tap to them from the ★ menu'}">${icon(STAR_PATH, fav)}</button>
    <a class="ghost pf-act" href="${pickLink(name)}" aria-label="Compare" title="Compare ${esc(name)} with you or anyone">${icon('M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4')}</a>
    <a class="ghost pf-act" href="https://lichess.org/@/${encodeURIComponent(name)}" target="_blank" rel="noopener" aria-label="${esc(name)} on Lichess" title="${esc(name)} on Lichess">${icon('M14 4h6v6M20 4l-9 9M18 14v6H4V6h6')}</a></div>`}</div>`;
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
    side.querySelector('.ink-on-dark').title = pc ? `Chosen by ${name}` : `${name}'s most important piece: the ${PIECE_NAME[shownPiece]}`;
    $('.pf-piece-menu')?.remove();
  };
  const open = (e) => {
    e.preventDefault(); e.stopPropagation();
    $('.pf-piece-menu')?.remove();
    const menu = Object.assign(document.createElement('div'), { className: 'pf-piece-menu' });
    // The one the games give, and why: as the card's own explanation.
    const auto = shownP?.pieceAuto || 'n', why = shownP?.pieceWhyAuto === 'best' ? 'the piece you play best: the fewest mistakes and blunders per move in your analysed games'
      : 'the piece that does the most in your games (analyse 20 games and it becomes the piece you play best)';
    menu.innerHTML = `<p>Your piece</p><div>${['k', 'q', 'r', 'b', 'n', 'p'].map((k) => `<button type="button" data-piece="${k}" aria-label="The ${PIECE_NAME[k]}"${k === auto ? ' class="auto"' : ''}><img src="pieces/w${k.toUpperCase()}.svg" alt=""></button>`).join('')}</div>
      <button type="button" class="link" data-piece="">From your games: the ${PIECE_NAME[auto]}</button><small class="pf-piece-why">${why}.</small>`;
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
    b.disabled = true; b.lastChild.textContent = ' Fetching…';
    try {
      const p = await build(name), after = storedGames(name) || [], i = after.findIndex((g) => g.id === top), added = top ? (i < 0 ? after.length : i) : after.length;
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
// On a phone the star, compare and Lichess buttons go beside the card, under the opening taste, so the
// name and the card get the width.
function placeActs() {
  const a = $('.pf-name-row .pf-acts');
  if (a && matchMedia('(max-width: 640px)').matches) $('.pf-hero .pf-type-row')?.append(a);
}
// A profile ready to show: kept here, else read from the player's games.
// Compare: the player you came from on the left, and on the right the other to pick: you, one of your
// starred players, or anyone by name.
async function comparePick(name) {
  document.title = `Compare ${name}`;
  const mine = myName(), others = favs().filter((x) => x.toLowerCase() !== name.toLowerCase() && x.toLowerCase() !== (mine || '').toLowerCase());
  $('#profile').innerHTML = `<header class="cmp-head"><h1 class="pf-h1">Compare <a href="${profileLink(name)}">${esc(name)}</a></h1></header>
    <section class="cmp-pick"><div class="cmp-pick-a" id="cmp-pick-a"><p class="info">Reading ${esc(name)}'s games…</p></div><span class="cmp-pick-vs">VS</span>
      <div class="cmp-pick-b"><h2>With who?</h2>
        ${mine && mine.toLowerCase() !== name.toLowerCase() ? `<a class="cta cmp-pick-me" href="${compareLink(name, mine)}">With me <small>${esc(mine)}</small></a>` : ''}
        <form class="cmp-pick-form" action="profile.html"><input type="hidden" name="u" value="${esc(name)}"><input name="vs" required maxlength="30" pattern="[A-Za-z0-9_\-]{2,30}" placeholder="Any Lichess name" aria-label="Any Lichess name" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="submit" class="cta">Compare</button></form>
        ${others.length ? `<p class="cmp-pick-k">Your starred players</p><p class="cmp-pick-favs">${others.map((x) => `<a class="pf-chip" href="${compareLink(name, x)}">${esc(x)}</a>`).join('')}</p>` : ''}
      </div></section>`;
  $('.cmp-pick-form input[name=vs]').focus();
  try {
    const A = await profileFor(name);
    await loadFlags([name]);
    $('#cmp-pick-a').innerHTML = playerCard(A.name, A.p, A.p.type, skillsOf(A.p));
  } catch (err) { $('#cmp-pick-a').innerHTML = `<p class="info">${esc(err.message)}</p>`; }
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
  document.title = `${A.name} vs ${B.name}`;
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
    <div class="pf-players"><a class="ghost" href="${profileLink(A.name)}">← ${esc(A.name)}</a><a class="ghost" href="${profileLink(B.name)}">${esc(B.name)} →</a></div>
    <header class="cmp-head"><h1 class="pf-h1"><a href="${profileLink(A.name)}">${esc(A.name)}</a> <span>vs</span> <a href="${profileLink(B.name)}">${esc(B.name)}</a></h1>
      <div class="pf-seg cmp-speeds" role="group" aria-label="Time control">${['all', ...SPEEDS].map((sp) => `<button type="button" data-speed="${sp}" aria-pressed="${sp === speed}" ${sp === 'all' || avail.includes(sp) ? '' : `disabled title="Fewer than ${MIN_SPEED} ${sp} games for one of you"`}>${sp === 'all' ? 'All games' : sp[0].toUpperCase() + sp.slice(1)}</button>`).join('')}</div>
      <p class="info cmp-scope">${speed === 'all' ? 'Every number below is from all rated games.' : `Every number below is from ${speed} games only, the same games as each profile's ${speed} card.`}</p></header>
    <section class="cmp-cards">
      <div><a class="cmp-card" href="${profileLink(A.name)}" title="Open ${esc(A.name)}'s profile">${playerCard(A.name, A.p, A.p.type, sa)}</a><p class="cmp-type"><b>${A.p.type.map((x) => esc(x.name)).join(' + ')}</b></p></div>
      <div><a class="cmp-card" href="${profileLink(B.name)}" title="Open ${esc(B.name)}'s profile">${playerCard(B.name, B.p, B.p.type, sb)}</a><p class="cmp-type"><b>${B.p.type.map((x) => esc(x.name)).join(' + ')}</b></p></div>
      <details class="pf-dl cmp-dl"><summary title="Download the comparison" aria-label="Download the comparison"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 19h14"/></svg></summary>
        <div class="pf-dl-menu" role="group" aria-label="Download"><div class="pf-dl-look" role="group" aria-label="Look">${['dark', 'light'].map((k) => `<button type="button" data-card-look="${k}" aria-pressed="${cardLook() === k}">${k === 'dark' ? 'Dark' : 'Light'}</button>`).join('')}</div><button type="button" data-cmp-png="cards">Cards</button><button type="button" data-cmp-png="text">Cards + text</button><button type="button" data-cmp-png="both">Both</button></div></details>
    </section>
    <section class="pf-card cmp-story"><h2>In short</h2>${compareStory(A, B, sa, sb).map((x) => `<p>${x}</p>`).join('')}</section>
    <section class="pf-card">
      <h2>Skills</h2>
      <p class="cmp-key"><span class="cmp-a"></span>${esc(A.name)} <span class="cmp-b"></span>${esc(B.name)}</p>
      <ul class="cmp-skills">${sa.map((x, i) => {
        const y = sb[i], d = x.v !== null && y.v !== null ? x.v - y.v : null;
        return `<li><span class="cmp-label">${x.label}</span>
          <div class="cmp-bars" role="img" aria-label="${x.label}: ${esc(A.name)} ${x.v ?? 'no data'}, ${esc(B.name)} ${y.v ?? 'no data'}">
            <div class="cmp-bar a"><i style="width:calc((100% - 3em) * ${(x.v ?? 0) / 100})"></i><b>${x.v ?? '–'}</b></div>
            <div class="cmp-bar b"><i style="width:calc((100% - 3em) * ${(y.v ?? 0) / 100})"></i><b>${y.v ?? '–'}</b></div></div>
          <small>${d === null ? 'Not enough games for both.' : d === 0 ? 'Even.' : `${esc(d > 0 ? A.name : B.name)} +${Math.abs(d)}`}</small></li>`;
      }).join('')}</ul>
    </section>
    <section class="pf-card">
      <h2>Numbers</h2>
      <table class="cmp-table"><thead><tr><th></th><th>${esc(A.name)}</th><th>${esc(B.name)}</th></tr></thead>
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
    : '<a class="cta" href="practice.html">Open your training plan</a>'}<a class="ghost" href="${profileLink(B.name)}">${esc(B.name)}'s profile</a></div></section>`;
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
  if (name && q.has('vs') && !q.get('vs')) return comparePick(name); // compare with someone still to pick
  if (name && q.get('vs') && q.get('vs').toLowerCase() !== name.toLowerCase()) return compare(name, q.get('vs')); // the same name twice: just the profile
  if (name) show(name, false); else ask();
}
if ($('#profile')) addEventListener('popstate', () => start());

// Last in the file, so every constant above is defined before the page draws.
if ($('#profile')) { // the practice page imports this module for the above; only the profile page draws itself
  // The header's Log in (on every page) comes here, so the player lands on their own profile after it.
  if (new URLSearchParams(location.search).has('login') && !account()) await login();
  else {
    try { await finishLogin(); } catch (err) { $('#profile-msg').textContent = err.message; } // back from logging in on this page
    start();
  }
}
