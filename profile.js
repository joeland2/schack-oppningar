// Your profile: your last 500 rated Lichess games read move by move, then what kind of player they
// show, what you are good at, what to work on, and the numbers behind it. Lichess's own computer
// analysis is used where a game has it (accuracy, blunders, who was winning when). The result is kept
// in this browser, and so are the games themselves: later visits fetch only the games played since.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { account, login, finishLogin } from './lichess.js?v=20261029122020';
import { STYLE_OF } from './styles.js?v=20261029122020';

const MAX = 500;
const PV = 27;
const ENOUGH = 100; // analysed games before the skills that need analysis are shown
// How far the stats can be trusted, by analysed games: the analyse box shows the step reached and the next.
const TIERS = [[100, 'Fair'], [250, 'Good'], [500, 'Best']];
const MIN_GAMES = 50; // rated games before a player gets any skills at all
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
    // Lichess names Black's choices Defense; the rest are White's. chosen: this player picked the opening.
    chosen: /Defen[cs]e/.test((g.opening?.name || '').split(':')[0]) === (side === 'b'),
    expect: expectOf((g.opening?.name || 'Unknown').split(':')[0], side, mine.rating, g.speed), diff: mine.ratingDiff || 0, them: theirs.rating,
    castled, queensOff, endgame: endgameAt !== null, pieces, played,
    analysed: v.length > 0, ours: !!g.ours, acc: mine.analysis?.accuracy ?? null, blunders: mine.analysis?.blunder ?? null, mistakes: mine.analysis?.mistake ?? null,
    best: v.length ? Math.max(...v) : null, worst: v.length ? Math.min(...v) : null, after12: v.length > 23 ? v[23] : null, slips,
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
  const gs = games.filter((g) => g.side === side && /Defen[cs]e/.test(g.family) === (side === 'b'));
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
    for (const g of games.filter((x) => x.side === side)) m.set(g.family, [...(m.get(g.family) || []), g]);
    // Lichess names the position: a Defense is Black's choice, the rest White's, so "vs" marks the other side's.
    const vs = (fam) => (/Defen[cs]e/.test(fam) === (side === 'w') ? `vs ${fam}` : fam);
    return [...m].filter(([, gs]) => gs.length >= 5).map(([fam, gs]) => ({ fam: vs(fam), n: gs.length, score: score(gs), win: gs.filter((g) => g.result === 1).length / gs.length })).sort((a, b) => b.n - a.n);
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
      const own = games.filter((g) => g.chosen), fams = Object.values(own.reduce((m, g) => ({ ...m, [g.family]: (m[g.family] || 0) + 1 }), {})).sort((a, b) => b - a);
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
  Attacker: 'Goes after the king early, wants open lines and the initiative, and takes some risk for it. Dangerous when the attack lands, shaky when it does not.',
  'Solid builder': 'Builds a safe position first and strikes when the moment is right. Hard to beat quickly, but can let wins slip by being too careful.',
  'Endgame player': 'Happy to trade pieces and win slowly with technique. Trusts long-term edges more than tactics.',
  Fighter: 'Plays every game for a result and rarely settles for a draw. Wins and losses both come quickly.',
  'Comeback player': 'Keeps finding chances in bad positions and turns lost games around. Stubborn defence is a real strength.',
  'Time scrambler': 'Spends a lot of time early and plays the end on the clock. Strong in scrambles, but some games are lost on time.',
  'All-rounder': 'No style stands out: plays a bit of everything and adapts to the position.',
  Finisher: 'Gets attacks going and finishes them: quick wins, clear advantages, and few slips once ahead.',
  Defender: 'Hard to break down: solid openings, holds against attacks, saves bad positions and rarely lets the opponent get ahead.',
  'Fast starter': 'Comes out of the opening better than players at the same level: knows the lines and the plans behind them.',
  Grinder: 'Scores more in endgames than players at the same level: the long games are theirs.',
  'Sure hand': 'Blunders less than players at the same level: rarely throws a piece or a game away.',
  Trickster: 'Sets traps and wins fast. Many games are over before move 25.',
  Specialist: 'Plays a narrow repertoire and knows it deeply. Rarely surprised in the opening.',
  Explorer: 'Tries many different openings. Hard to prepare against, but each line is known less deeply.',
  Marathoner: 'Plays long games and keeps going. Patient, and comfortable deep into the endgame.',
  Peacemaker: 'Draws more than most players at the same level. Solid and hard to beat, but leaves wins on the table.',
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
    after12: mean(an.filter((g) => g.after12 !== null).map((g) => Math.max(-300, Math.min(300, g.after12)))),
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
const STRENGTH = { Attack: 'Finisher', 'Early game': 'Fast starter', 'Late game': 'Grinder', Accuracy: 'Sure hand', Speed: 'Speed demon' };
// A strength on the same theme as the style says the same thing twice; then the next best skill is named.
const SAME = { 'Endgame player': 'Late game', 'Comeback player': 'Defense', 'Time scrambler': 'Speed', Trickster: 'Attack', Defender: 'Defense', Marathoner: 'Late game' };
// Every style with its weight (1 = clearly holds), most first, and every strength with its value (62 = clearly holds).
function traitsOf(p) {
  const q = p.peer || {}, rating = p.speeds?.[0]?.rating, raw = rawSkills(p), def = raw.find((x) => x.label === 'Defense');
  const styles = [
    { name: 'Attacker', w: p.attacking / 0.4, why: `${pct(p.attacking)} of your games are in attacking openings or gambits: you like the initiative early.` },
    { name: 'Solid builder', w: (p.solid / 0.55) * (p.attacking < 0.25 ? 1 : 0.6), why: `${pct(p.solid)} of your games are in solid or positional openings: you build first and attack later.` },
    { name: 'Endgame player', w: p.queensOff / 0.4, why: `The queens come off before move 25 in ${pct(p.queensOff)} of your games: you are happy to trade and play it out.` },
    { name: 'Fighter', w: (usualDraws(rating) / Math.max(p.draws, 0.005)) / 2 * Math.sqrt(35 / Math.max(p.moves, 15)),
      why: `Only ${pct(p.draws)} draws, where about ${pct(usualDraws(rating))} is usual at your level: your games are decided, one way or the other.` },
    // Saving lost games and ending short of time are common in fast games for everyone, so these two
    // count only when the player does it clearly more than their own opponents at their level.
    { name: 'Comeback player', w: q.downs >= 5 && q.ups >= 5 && q.saved != null ? (q.saved / Math.max(q.oppSaved, 0.1)) / Math.sqrt(odds(q.score)) / 2.8 : 0, // about twice your opponents' rate is normal (checked on eight players), so the trait starts near three times
      why: `In ${pct(q.saved ?? 0)} of the games where you were clearly losing, you still won or drew; your opponents at your level, clearly losing against you, only ${pct(q.oppSaved ?? 0)}.` },
    { name: 'Time scrambler', w: Math.min(p.lowTime / 0.3, q.n >= 30 && q.myLow != null ? q.myLow / Math.max(q.oppLow, 0.05) / 1.4 : 0),
      why: `You end ${pct(p.lowTime)} of your games with under a tenth of your time left${q.oppLow != null ? `; your opponents at your level ${pct(q.oppLow)}` : ''}.` },
    { name: 'Trickster', w: q.n >= 30 && (q.quickW ?? 0) >= 0.1 ? (q.quickW / Math.max(q.quickL, 0.03)) / 1.6 : 0,
      why: `You win ${pct(q.quickW ?? 0)} of your games within 25 moves, your opponents at your level ${pct(q.quickL ?? 0)}: your traps and tricks land.` },
    // most club players lean on two openings (about 0.75 in 25 checked), so Specialist needs nearly all
    { name: 'Specialist', w: (p.top2 ?? 0) / 0.9, why: `Your two main openings are ${pct(p.top2 ?? 0)} of the openings you choose: you know your lines deeply.` },
    { name: 'Explorer', w: (p.families ?? 0) / 18 * ((p.top2 ?? 1) < 0.3 ? 1 : 0.5), why: `You play ${p.families ?? 0} different openings at least three times each: you like variety.` },
    { name: 'Marathoner', w: (p.moves / usualMoves(rating)) / 1.2, why: `Your games last ${p.moves} moves on average, where about ${usualMoves(rating)} is usual at your level.` },
    // The counterpart of Attacker: a player whose Defense (solid openings, holding against attacks, saving
    // bad positions, rarely letting opponents get ahead) is clearly above their own opponents'.
    { name: 'Defender', w: def.v !== null ? (def.v - 50) / 9 : 0, why: `You defend clearly better than your opponents at your level. ${def.why}` },
    { name: 'Peacemaker', w: (p.draws / usualDraws(rating)) / 1.8, why: `${pct(p.draws)} of your games are draws, where about ${pct(usualDraws(rating))} is usual at your level.` },
  ].sort((x, y) => y.w - x.w);
  // Giant killer needs a clear surplus: upsets are common in fast games. Speed counts winning on time half,
  // since much of it is the opponent's doing.
  const extra = [
    { label: 'Giant killer', v: p.giantN >= 30 ? clamp(50 + p.giantGain * 100) : null, why: `Against players 100 or more above you, you score ${pct(p.giantGain ?? 0)} more per game than the rating gap predicts (${p.giantN} games).` },
    { label: p.winW >= p.winB ? 'White specialist' : 'Black specialist', v: p.nWhite >= 30 && p.n - p.nWhite >= 30 ? clamp(50 + Math.abs(p.winW - p.winB) * 100) : null,
      why: `You win ${pct(p.winW)} as White and ${pct(p.winB)} as Black.` },
    { label: 'Clutch player', v: p.clutchN >= 25 ? clamp(50 + (p.clutchScore - p.score) * 120) : null, why: `You score ${pct(p.clutchScore ?? 0)} in the ${p.clutchN} games where both players were short of time, against ${pct(p.score)} overall.` },
  ];
  return { styles, strengths: [...raw, ...extra] };
}
function typeOf(p) {
  const { styles, strengths } = traitsOf(p);
  const style = styles[0].w >= 0.8 ? styles[0] : { name: 'All-rounder', why: 'No style stands out: you play a bit of everything.' };
  // The strength: the one furthest above the player's own opponents (64 or more where 50 is even).
  // Defense has no strength of its own: being best at it is the Defender style.
  const best = strengths.filter((x) => x.label !== 'Defense' && x.v !== null && x.v >= 64 && x.label !== SAME[style.name]).sort((x, y) => y.v - x.v)[0];
  const second = best ? { name: STRENGTH[best.label] || best.label, why: STRENGTH[best.label] ? `${best.label} is where you beat your level most: ${best.why}` : best.why } : styles[1].w >= 0.8 && style === styles[0] ? styles[1] : null;
  return second ? [style, second] : [style];
}

// Skill bars, 0-100, each read from one thing in the games; null when there are too few games to say.
// The raw scales are rules of thumb (50 is a so-so result for the player); skillsOf puts them on the card's scale.
const clamp = (x) => Math.round(Math.max(0, Math.min(100, x)));
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
function skillsOf(p) {
  const base = levelOf(p.speeds?.[0]?.rating), raw = rawSkills(p).map((x) => (p.n < MIN_GAMES ? { ...x, v: null } : x)), known = raw.filter((x) => x.v !== null);
  const mean = known.length ? sum(known, (x) => x.v) / known.length : 50;
  const card = (r) => base + 0.5 * (mean - 50 + SHAPE * (r - mean));
  return raw.map((x) => ({ ...x, raw: x.v, level: clamp(card(50)), v: x.v === null ? null : Math.min(99, clamp(card(x.v))) }));
}
{ // the shape is stretched, the overall (the mean of the card's skills) stays at base + half the mean gap
  const s = skillsOf({ speeds: [{ rating: 1200 }], peer: { analysed: 120, ups: 36, downs: 32, saved: 0.5, quickW: 0.2, quickL: 0.15, after12: 40, myBl: 2.8, oppBl: 3, meUp: 2.7, oppUp: 3.6, meDown: 1.5, oppDown: 1.4, endgames: 300, endScore: 0.57, n: 400, myLow: 0.15, oppLow: 0.22, timeWins: 0.15, timeLosses: 0.04 } });
  const m = sum(s, (x) => x.raw) / 6, o = sum(s, (x) => x.v) / 6;
  console.assert(Math.abs(o - (60 + (m - 50) / 2)) < 1 && Math.abs((s[5].v - s[3].v) - (s[5].raw - s[3].raw)) <= 1, 'skillsOf shape'); // SHAPE 2 at half size: a gap of 10 between two skills stays 10
}
console.assert(typeOf({ attacking: 0.54, solid: 0.2, queensOff: 0.1, draws: 0.05, moves: 30, lowTime: 0.16, noCastle: 0.1, speeds: [{ rating: 1200 }], peer: { n: 100, score: 0.5, downs: 30, ups: 30, saved: 0.47, oppSaved: 0.2, myLow: 0.05, oppLow: 0.25, timeWins: 0.15, timeLosses: 0.04 } }).map((t) => t.name).join() === 'Attacker,Speed demon', 'typeOf');
console.assert(typeOf({ attacking: 0.27, solid: 0.56, queensOff: 0.23, draws: 0.03, moves: 29, lowTime: 0.15, noCastle: 0.1, speeds: [{ rating: 1200 }], peer: { n: 100, analysed: 120, after12: 96 } }).map((t) => t.name).join() === 'Fighter,Fast starter', 'typeOf: same level, other strength');
console.assert(levelOf(1200) === 60 && levelOf(2400) === 82 && levelOf(5000) === 92 && levelOf(100) === 35, 'levelOf');
function rawSkills(p) {
  const q = p.peer || {}, an = (q.analysed ?? 0) >= ENOUGH, pawns = (cp) => { const r = Math.round(cp / 10) / 10; return r === 0 ? '0.0' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}`; };
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
    { label: 'Early game', needs: true, v: an && q.after12 !== null ? clamp(50 + q.after12 / 4) : null,
      means: 'How the position stands after move 12.',
      why: `${pawns(q.after12 ?? 0)} pawns on average after move 12.`,
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
console.assert(rawSkills({ peer: { analysed: 120, ups: 36, downs: 12, after12: 100, myBl: 1, oppBl: 1, meUp: 1, oppUp: 3, endgames: 0, n: 10 } }).map((x) => x.v).slice(0, 3).join() === '75,75,75', 'rawSkills');
{
  const g = (o) => ({ side: 'w', speed: 'blitz', status: 'resign', plies: 60, result: 1, family: 'Italian Game', rating: 1500, diff: 5, castled: 8, queensOff: null, endgame: false, analysed: false, acc: null, blunders: null, best: null, worst: null, after12: null, slips: { opening: 0, middlegame: 0, endgame: 0 }, lowTime: false, ...o });
  const p = profileOf([g({}), g({ result: 0 }), g({ side: 'b', result: 0 }), g({ side: 'b', result: 0.5 })]);
  console.assert(p.score === 0.375 && p.white === 0.5 && p.type[0].name === 'Attacker', 'profileOf');
}

// ---------- Fetching ----------
async function fetchGames(name, onGame, since = null) {
  const a = account();
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(name)}?` + new URLSearchParams({
    max: MAX, ...(since ? { since } : {}), rated: 'true', perfType: 'bullet,blitz,rapid,classical', moves: 'true', opening: 'true', clocks: 'true', evals: 'true', accuracy: 'true',
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
      if (g?.variant === 'standard' && games.length < MAX) { games.push(g); onGame(games.length); }
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
    end: g.end || endClocks(g.clocks), ours: g.ours || undefined, players: { white: player(g.players.white), black: player(g.players.black) },
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
function gamesStore() { try { return JSON.parse(localStorage.getItem(GAMES)) || {}; } catch { return {}; } }
function saveGames(name, games) {
  const all = gamesStore(), me = name.toLowerCase();
  const keep = Object.entries(all).filter(([k]) => k !== me).sort((a, b) => b[1].at - a[1].at).slice(0, 2);
  try { localStorage.setItem(GAMES, JSON.stringify(Object.fromEntries([[me, { at: Date.now(), games: games.map(pack) }], ...keep]))); } catch {}
}
// One game changed here (analysed on its own page) goes back into the kept games.
function keepGame(name, g) {
  const games = storedGames(name);
  if (!games) return;
  const i = games.findIndex((x) => x.id === g.id);
  if (i >= 0) { games[i] = g; saveGames(name, games); forget(name); }
}
function forget(name) {
  const all = cache(); delete all[name.toLowerCase()];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
}
// A player's games as kept here, in Lichess's shape, or null.
function storedGames(name) {
  const t = gamesStore()[name.toLowerCase()];
  return t ? t.games.map(unpack) : null;
}

let RAW = null, RAW_NAME = ''; // the games in use, kept for analysing them here
let quiet = false; // checking for new games behind a profile already shown: no progress messages
const msgEl = () => (quiet ? { textContent: '' } : $('#profile-msg'));
async function build(name) {
  const msg = msgEl(), have = storedGames(name) || [];
  msg.textContent = have.length ? `Fetching ${name}'s new games from Lichess…` : `Fetching ${name}'s last ${MAX} rated games from Lichess…`;
  const fresh = await fetchGames(name, (k) => { msg.textContent = `Fetching ${name}'s games from Lichess… ${k}`; }, have.length ? have[0].createdAt + 1 : null);
  const ids = new Set(fresh.map((g) => g.id));
  const raw = [...fresh, ...have.filter((g) => !ids.has(g.id))].slice(0, MAX);
  if (!raw.length) throw new Error(`${name} has no rated games on Lichess yet.`);
  saveGames(name, raw);
  RAW = raw; RAW_NAME = name;
  return readAll(name, raw);
}
// The profile every page shows: read just now (within FRESH), else new games fetched and all read again,
// so the profile, compare and the practice plan always agree and follow new games and analyses.
const FRESH = 5 * 60e3;
async function current(name) {
  const c = cache()[name.toLowerCase()];
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
  RECORDS.set(`${me}:${raw.length}:${raw[0]?.id}`, games); // compare's per-time-control reading reuses these
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
function engineEval(fen) {
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
async function analyse(name, target) {
  const el = $('#pf-analyse');
  await build(name); // the games played since are fetched first, so they are analysed too
  const have = RAW.filter((g) => g.analysis).length;
  const todo = RAW.filter((g) => !g.analysis && g.moves).slice(0, Math.max(0, target - have)); // the newest first, up to the target
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
    saveGames(name, RAW); // a finished game is kept even if the run stops
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
function analysePanel(name, p) {
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
  const locked = rawSkills(p).filter((x) => x.v === null && x.needs).map((x) => x.label);
  const say = !reached ? `Analyse ${next[0]} games to unlock ${locked.length ? `${locked.join(' and ')}, and ` : ''}the parts of Attack and Defense that need analysis (mistakes and advantages).`
    : next ? `Skills can still move a few points. ${next[1]} at ${next[0]} analysed games.`
    : 'Every skill rests on all the games there are.';
  return `<div id="pf-analyse" class="pf-analyse pf-acc${reached ? '' : ' few'}">
    <div class="pf-acc-head"><span class="pf-acc-k">Stat accuracy</span><b class="pf-acc-v">${reached ? reached[1] : 'Locked'}</b>
      <span class="pf-acc-n">${p.analysed} of ${p.n} games analysed</span>
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
    window.track?.('analyse', String(n));
    analysing = { stop: false };
    el.outerHTML = analysePanel(name, {});
    $('#pf-analyse').querySelector('[data-stop]').addEventListener('click', () => { if (analysing) analysing.stop = true; });
    try { await analyse(name, n); } catch (err) { analysing = null; $('#profile-msg').textContent = err.message; }
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
function openingRows(list) {
  return list.length ? `<ul class="pf-rows">${list.slice(0, 6).map((o) => `<li><span>${esc(o.fam)}</span><small>${games(o.n)} · ${pct(o.win ?? o.score)} wins</small>${bar(o)}</li>`).join('')}</ul>` : '<p class="info">Fewer than 5 games with any one opening.</p>';
}
// Each bar: what it measures, what the games show, and below 50 how to train it; the words show on request.
let showSkillText = true; // what each skill measures is open from the start
function skillBars(skills, say, me) {
  return `<ul class="pf-skills">${skills.map((x) => `<li${x.v === null ? ' class="pf-skill-none"' : ''}>
      <span class="pf-skill-name">${x.label}</span><span class="pf-skill-val">${x.v ?? '–'}</span>
      <div class="pf-meter" style="--even:${x.level ?? 50}%" title="The mark: ${x.level ?? 50}, as good as ${me ? 'your' : 'their'} opponents" role="img" aria-label="${x.label}: ${x.v === null ? 'not enough games' : `${x.v} of 100, ${x.level ?? 50} is as good as the opponents`}"><i style="width:${x.v ?? 0}%"></i></div>
      ${x.v === null && x.needs ? '<small class="pf-skill-lock">Needs more analysed games</small>' : ''}
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
  const own = (list) => [...new Set(list.filter((o) => !o.fam.startsWith('vs ')).map((o) => o.fam.replace(/ (Accepted|Declined)$/, '')))].slice(0, 2).map(esc);
  const w = own(p.openings.w), b = own(p.openings.b);
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
  if (p.piece) out.push(`${me ? 'Your' : 'Their'} most important piece is the ${PIECE_NAME[p.piece]}.`);
  return out.join(' ');
}
// The player card: the overall (the mean of the known skills), a short code for the type, the six skills.
// The piece is drawn white for the black card; in dark mode, where the card is cream, CSS inverts it.
const CARD_INK = 'w';
const PIECE_NAME = { n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };
const ABBR = { Attack: 'ATK', Defense: 'DEF', 'Early game': 'EARLY', 'Late game': 'LATE', Accuracy: 'ACC', Speed: 'SPD' };
function playerCard(name, p, t, skills) {
  const known = skills.filter((x) => x.v !== null);
  const ovr = known.length ? Math.round(sum(known, (x) => x.v) / known.length) : '–';
  const main = p.speeds[0];
  return `<div class="pf-pcard" role="img" aria-label="Player card: overall ${ovr}, ${t[0].name}, ${known.map((x) => `${x.label} ${x.v}`).join(', ')}">
    <div class="pf-pcard-top"><div><b class="pf-ovr">${ovr}</b><span class="pf-pos">${esc(t[0].name)}</span></div>
      <div class="pf-pcard-side"><img class="pf-pcard-piece" src="pieces/${CARD_INK}${(p.piece || 'n').toUpperCase()}.svg" alt="" title="${esc(name)}'s most important piece: the ${PIECE_NAME[p.piece || 'n']}, ${p.pieceWhy === 'best' ? `the piece played best, with the fewest mistakes and blunders per move in the analysed games` : 'the piece that does the most in these games (analyse 20 games to see the one played best)'}">
        ${main ? `<span class="pf-pcard-rating">${main.rating} <small>${main.speed}</small></span>` : ''}</div></div>
    <p class="pf-pcard-name">${esc(name)}</p>
    <div class="pf-pcard-stats">${skills.map((x) => `<span><b>${x.v ?? '–'}</b>${ABBR[x.label]}</span>`).join('')}</div>
    <p class="pf-pcard-foot">${main ? `VS ${main.rating - PEER}–${main.rating + PEER} · ` : ''}${p.n} ${main && p.speeds.length === 1 ? `${main.speed.toUpperCase()} ` : ''}GAMES</p>
  </div>`;
}
// Where a rating ranks among all Lichess players of that time control this week: "Top 27%".
// The card explained in one go, under it.
// The player card as an image to save or share, drawn from the numbers at a fixed size so it looks
// the same from a phone or a computer. "Card + style" adds the player type, the openings and the portrait.
const CARD = { bg: '#141414', ink: '#f4efe6', muted: '#a8a093', line: '#3d3730', hot: '#ff5a1f', paper: '#e6dfd1', paperInk: '#141414', paperMuted: '#62594c' };
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
function drawCard(ctx, x, y, name, p, t, skills, piece) {
  const known = skills.filter((k) => k.v !== null), ovr = known.length ? String(Math.round(sum(known, (k) => k.v) / known.length)) : '–', main = p.speeds[0];
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = CARD.bg; ctx.beginPath(); ctx.roundRect(0, 0, 600, 780, 10); ctx.fill();
  ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = '0px';
  ctx.fillStyle = CARD.hot; ctx.font = '400 150px Anton'; ctx.fillText(ovr, 40, 185);
  ctx.fillStyle = CARD.ink; fit(ctx, t[0].name.toUpperCase(), '400 #px Anton', 40, 300); ctx.fillText(t[0].name.toUpperCase(), 42, 235);
  if (piece) ctx.drawImage(piece, 450, 48, 110, 110);
  if (main) {
    ctx.textAlign = 'right'; ctx.font = '400 26px Anton'; ctx.fillStyle = CARD.muted; const sp = main.speed.toUpperCase(); ctx.fillText(sp, 560, 235);
    const w = ctx.measureText(sp).width; ctx.font = '400 52px Anton'; ctx.fillStyle = CARD.ink; ctx.fillText(String(main.rating), 560 - w - 10, 235); ctx.textAlign = 'left';
  }
  ctx.fillStyle = CARD.line; ctx.fillRect(40, 262, 520, 2); ctx.fillRect(40, 372, 520, 2);
  ctx.fillStyle = CARD.ink; ctx.textAlign = 'center'; fit(ctx, name.toUpperCase(), '400 #px Anton', 64, 520); ctx.fillText(name.toUpperCase(), 300, 342); ctx.textAlign = 'left';
  skills.forEach((k, i) => {
    const cx = i % 2 ? 330 : 70, cy = 470 + Math.floor(i / 2) * 95;
    ctx.fillStyle = CARD.ink; ctx.font = '400 72px Anton'; const v = String(k.v ?? '–'); ctx.fillText(v, cx, cy);
    ctx.fillStyle = CARD.muted; ctx.font = '400 34px Anton'; ctx.fillText(ABBR[k.label], cx + ctx.measureText('00').width * 72 / 34 + 18, cy);
  });
  ctx.fillStyle = CARD.muted; ctx.textAlign = 'center'; ctx.font = '600 20px Geist'; ctx.letterSpacing = '4px';
  ctx.fillText(`${main ? `VS ${main.rating - PEER}–${main.rating + PEER} · ` : ''}${p.n} GAMES`, 300, 742);
  ctx.restore();
}
async function cardPng(name, p, t, skills, detail, btn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Making the image…';
  window.track?.('card', detail ? 'card + style' : 'card');
  try {
    await Promise.all(['400 40px Anton', '400 20px Geist', '600 20px Geist'].map((f) => document.fonts.load(f)));
    const piece = await new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = `pieces/w${(p.piece || 'n').toUpperCase()}.svg`; });
    const S = 2, W = detail ? 1080 : 680, H = detail ? 1350 : 860;
    const canvas = Object.assign(document.createElement('canvas'), { width: W * S, height: H * S }), ctx = canvas.getContext('2d');
    ctx.scale(S, S);
    if (!detail) drawCard(ctx, 40, 40, name, p, t, skills, piece);
    else {
      ctx.fillStyle = CARD.paper; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.translate(60, 60); ctx.scale(0.78, 0.78); drawCard(ctx, 0, 0, name, p, t, skills, piece); ctx.restore();
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
      const text = (html) => Object.assign(document.createElement('div'), { innerHTML: html }).textContent;
      let ty = 760;
      ctx.fillStyle = CARD.paperInk; ctx.font = '400 32px Geist';
      ty = wrap(ctx, text(portrait(name, p, skills, false)), 60, ty, W - 120, 46, 5) + 24;
      ctx.fillStyle = CARD.paperMuted; ctx.font = '400 24px Geist';
      for (const k of t) { ctx.font = '700 24px Geist'; ctx.fillStyle = CARD.paperInk; ctx.fillText(`${k.name}.`, 60, ty); const w = ctx.measureText(`${k.name}. `).width; ctx.font = '400 24px Geist'; ctx.fillStyle = CARD.paperMuted; ty = wrap(ctx, TYPE_ABOUT[k.name] || '', 60, ty, W - 120, 34, 3, w) + 12; }
      ctx.fillStyle = CARD.hot; ctx.fillRect(60, H - 96, W - 120, 3);
      ctx.fillStyle = CARD.paperInk; ctx.font = '400 30px Anton'; ctx.fillText('CHESS TRAINER', 60, H - 50);
      ctx.fillStyle = CARD.paperMuted; ctx.font = '400 20px Geist'; ctx.textAlign = 'right'; ctx.fillText(`From ${name}'s last ${p.n} rated Lichess games`, W - 60, H - 52); ctx.textAlign = 'left';
    }
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png')), file = new File([blob], `${name}-chess-${detail ? 'profile' : 'card'}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) await navigator.share({ files: [file], title: `${name}'s chess card` }).catch(() => {});
    else { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  } catch (err) { $('#profile-msg').textContent = `The image could not be made: ${err.message}`; }
  btn.disabled = false; btn.textContent = label;
}
function cardNote(name, p, me) {
  const main = p.speeds[0];
  if (!main) return '';
  return `<details class="pf-card-help"><summary>How the stats work</summary><p class="pf-card-note"><b>Every stat compares ${me ? 'you' : esc(name)} with ${me ? 'your' : 'their'} own opponents</b>, rated ${main.rating - PEER}–${main.rating + PEER}, in the same games. A higher rating starts the card higher; the big number is the average of the six skills. <a href="#pf-skills">What each skill measures</a></p></details>`;
}
// One time control at a time: bullet and blitz games say different things about speed, endgames and
// the level, so the profile reads the player's main time control unless another (or All) is picked.
let pfSpeed = null, shown = null; // the picked time control ('all' or a speed); the last render's arguments
// Time controls with enough games; only when the games themselves are kept here (the last few players looked up).
function speedsOf(name, full) {
  return storedGames(name) ? SPEEDS.map((sp) => [sp, full.speeds.find((x) => x.speed === sp)?.n || 0]).filter(([, n]) => n >= MIN_GAMES) : [];
}
function forSpeed(name, full, sp) {
  return sp === 'all' ? full : profileOf(recordsOf(name, storedGames(name)).filter((g) => g.speed === sp));
}
function speedBar(name, full, sp, avail) {
  if (avail.length < 2 && sp !== 'all') return '';
  return `<div class="pf-seg pf-speeds" role="group" aria-label="Time control">${[['all', full.n], ...avail].map(([k, n]) =>
    `<button type="button" data-pf-speed="${k}" aria-pressed="${k === sp}">${k === 'all' ? 'All games' : k[0].toUpperCase() + k.slice(1)} <small>${n}</small></button>`).join('')}</div>`;
}
function render(name, at, full) {
  shown = [name, at, full];
  const avail = speedsOf(name, full), main = full.speeds[0]?.speed;
  const sp = pfSpeed && (pfSpeed === 'all' || avail.some(([k]) => k === pfSpeed)) ? pfSpeed : avail.some(([k]) => k === main) ? main : 'all';
  const p = forSpeed(name, full, sp);
  if (sp !== 'all') chartState.speed = sp;
  const t = p.type, me = isMe(name), say = me ? (x) => x : they, skills = skillsOf(p);
  document.title = me ? 'Your Profile' : `${name} · Profile`;
  const kpis = [['Win rate', pct(p.winRate ?? p.score)], ['Accuracy', p.acc !== null && p.analysed >= KPI_MIN ? `${p.acc}%` : '–'], ['Blunders / game', p.blunders !== null && p.analysed >= KPI_MIN ? p.blunders.toFixed(1) : '–'], ['Draws', pct(p.draws)]].filter(Boolean);
  $('#profile').innerHTML = `
    ${playerBar(name)}
    ${speedBar(name, full, sp, avail)}
    <section class="pf-hero">
      <div class="pf-card-col">${playerCard(name, p, t, skills)}<div class="pf-card-actions"><span>Download</span><button type="button" class="link" data-card-png="card">Card</button><button type="button" class="link" data-card-png="style">Card + style</button></div>${cardNote(name, p, me)}</div>
      <div class="pf-hero-text">
        <div class="pf-type-row"><div><h1 class="pf-h1">${esc(t[0].name)}</h1>
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
    ${analysePanel(name, full)}
    <section class="pf-card pf-skills-card${showSkillText ? ' open' : ''}" id="pf-skills">
      ${p.n < MIN_GAMES ? `<p class="pf-an-few">Only ${p.n} rated games: skills need at least ${MIN_GAMES}.</p>` : ''}
      <div class="pf-skills-head"><h2>${me ? 'Skills' : `${esc(name)}'s skills`}</h2>
        <button type="button" class="link" data-skill-text aria-expanded="${showSkillText}">${showSkillText ? 'Hide explanations' : 'What each one means'}</button></div>
      ${skillBars(skills, say, me)}
      <p class="pf-skill-more pf-skill-scale">All against opponents rated within ${PEER} of ${me ? 'you' : 'the player'}, in the same games. The mark on each bar is as good as them.</p>
    </section>
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
        <section><h3>Openings as White</h3>${openingRows(p.openings.w)}
          <h3>Openings as Black</h3>${openingRows(p.openings.b)}</section>
      </div>
    </section>
    <section class="pf-card" id="pf-games"></section>
    <section class="pf-about-data">
      <h2>About these numbers</h2>
      <p class="info">Read from ${me ? 'your' : `${esc(name)}'s`} last ${p.n} rated Lichess games, ${ago(at)}. <button id="refresh" class="link" type="button">Read them again</button></p>
      <p class="info">Results, openings, opening style, the clock, endgames and the rating graph use all ${p.n} games.
        Accuracy, blunders and the Defense, Early game and Accuracy skills (and part of Attack) need a computer's verdict on every move, so they use only the
        ${p.analysed} analysed game${p.analysed === 1 ? '' : 's'}${p.ours ? ` (${p.ours} analysed here with Stockfish, the rest by Lichess)` : ''}. ${p.todo ? 'Analyse more with the Analyse button above Skills.' : ''}</p>
      <p class="info">Player types, skills and thresholds are rules of thumb read from the games, not a rating. Win rate counts wins out of all games; an endgame score counts a draw as half.</p>
    </section>
    ${nextActions(name, me)}`;
  $('#refresh').addEventListener('click', () => run(name));
  document.querySelectorAll('[data-card-png]').forEach((b) => b.addEventListener('click', () => cardPng(name, p, t, skills, b.dataset.cardPng === 'style', b)));
  bindSearch();
  bindAnalyse(name);
  $('.pf-card-help a[href="#pf-skills"]')?.addEventListener('click', (e) => { e.preventDefault(); $('#pf-skills').scrollIntoView({ behavior: 'smooth' }); });
  document.querySelectorAll('[data-pf-speed]').forEach((b) => b.addEventListener('click', () => { pfSpeed = b.dataset.pfSpeed; const y = scrollY; render(...shown); scrollTo(0, y); }));
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
    fams.length && ['Openings', fams[0][1].length > 1 ? `${esc(fams[0][0])} ${fams[0][1].length} times, ${n(wins(fams[0][1]), 'win')}${fams[1] ? `; also ${esc(fams[1][0])}` : ''}` : `${fams.length} different openings, none twice`],
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
      ${last.length ? `<dl class="pf-facts">${recentFacts(last.map((g) => readGame(g, name.toLowerCase())), p).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
    </div>
  </section>`;
}
// The page ends on what to do next, not on the fine print.
function nextActions(name, me) {
  const friend = favs()[0];
  return `<section class="pf-next"><h2>What next</h2><div>
    ${me ? '<a class="cta" href="practice.html">Open your training plan</a>' : `<a class="cta" href="${compareLink(myName() || name, name)}">Compare with me</a>`}
    ${me && friend ? `<a class="ghost" href="${compareLink(name, friend)}">Compare with ${esc(friend)}</a>` : me ? '<span class="info">Look up a friend with Find a player and star them to compare.</span>' : ''}
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
  const mine = ++runs, c = cache()[name.toLowerCase()];
  await loadScores(); // a saved profile is drawn without reading the games, but its time controls are read again
  if (shown && shown[0].toLowerCase() !== name.toLowerCase()) pfSpeed = null; // another player starts on their own main time control
  window.track?.('profile', name);
  // Seen before: show the saved profile at once, then fetch new games quietly and redraw only if there were any.
  if (c && c.v === PV) {
    try { render(c.name || name, c.at, c.p); } catch (err) { console.warn('saved profile could not be shown, reading it again', err); }
    const before = storedGames(name) || [], top = before[0]?.id; // no games kept here yet: redraw once they are, with their time controls
    quiet = true;
    try {
      const p = await build(name), after = storedGames(name);
      if (mine === runs && (after[0]?.id !== top || after.length !== before.length || !before.length)) { const y = scrollY; render(name, Date.now(), p); scrollTo(0, y); }
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
export { build, current, cache, myName, skillsOf, storedGames, keepGame, engineEval, applyEvals, winPct, PV, traitsOf, profileFromRaw };
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
// Above a profile: star this player, compare with them, and your starred players to jump to.
function playerBar(name) {
  const me = isMe(name), mine = myName(), list = favs().filter((x) => x.toLowerCase() !== name.toLowerCase());
  return `<div class="pf-players">
    ${me ? '' : `<button type="button" class="ghost pf-star" data-fav aria-pressed="${isFav(name)}">${isFav(name) ? `<svg class="ico ico-solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg> Starred` : `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg> Star player`}</button>`}
    ${!me && mine ? `<a class="ghost" href="${compareLink(mine, name)}">Compare with me</a>` : ''}
    ${me ? '' : `<a class="link-out" href="https://lichess.org/@/${encodeURIComponent(name)}" target="_blank" rel="noopener">${esc(name)} on Lichess</a>`}
    ${list.length ? `<span class="pf-players-list"><small>${me ? 'Your players' : 'Starred'}</small>${list.map((x) => `<a class="pf-chip" href="${profileLink(x)}">${esc(x)}</a>${me ? `<a class="pf-chip pf-vs" href="${compareLink(name, x)}" title="Compare ${esc(name)} with ${esc(x)}">vs</a>` : ''}`).join('')}</span>` : ''}
  </div>`;
}
function bindPlayerBar(name) {
  $('[data-fav]')?.addEventListener('click', (e) => {
    toggleFav(name);
    $('.pf-players').outerHTML = playerBar(name);
    bindPlayerBar(name);
  });
}
// A profile ready to show: kept here, else read from the player's games.
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
  const k = `${name.toLowerCase()}:${games.length}:${games[0]?.id}`;
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
    const count = (gs, sp) => gs.filter((g) => g.speed === sp).length;
    const avail = SPEEDS.filter((sp) => count(ga, sp) >= MIN_SPEED && count(gb, sp) >= MIN_SPEED);
    if (speed === null) speed = avail.includes(A.p.speeds[0]?.speed) ? A.p.speeds[0].speed : 'all';
    const sub = (X, gs) => (speed === 'all' || !gs.length ? X : { name: X.name, p: profileOf(recordsOf(X.name, gs).filter((g) => g.speed === speed)) });
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
      <p class="info cmp-scope">${speed === 'all' ? 'Every number below is from all rated games.' : `Every number below is from ${speed} games only, so it can differ a little from the profiles, which use all games.`}</p></header>
    <section class="cmp-cards">
      <div><a class="cmp-card" href="${profileLink(A.name)}" title="Open ${esc(A.name)}'s profile">${playerCard(A.name, A.p, A.p.type, sa)}</a><p class="cmp-type"><b>${A.p.type.map((x) => esc(x.name)).join(' + ')}</b></p></div>
      <div><a class="cmp-card" href="${profileLink(B.name)}" title="Open ${esc(B.name)}'s profile">${playerCard(B.name, B.p, B.p.type, sb)}</a><p class="cmp-type"><b>${B.p.type.map((x) => esc(x.name)).join(' + ')}</b></p></div>
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
  if (name && q.get('vs')) return compare(name, q.get('vs'));
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
