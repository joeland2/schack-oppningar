// Your profile: your last 500 rated Lichess games read move by move, then what kind of player they
// show, what you are good at, what to work on, and the numbers behind it. Lichess's own computer
// analysis is used where a game has it (accuracy, blunders, who was winning when). The result is kept
// in this browser, and so are the games themselves: later visits fetch only the games played since.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { account, login, finishLogin } from './lichess.js?v=20261028230135';
import { STYLE_OF } from './styles.js?v=20261028230135';

const MAX = 500;
const PV = 12;
const ENOUGH = 20;
const WHY_ANALYSE = 'Lichess only analyses games you ask it to. Analysed games give your blunders, accuracy and four of the skills, and become puzzles in My practice. Stockfish runs in your browser; no game is done twice.'; // analysed games needed before the numbers that come from analysis are shown // bumped when the profile gains something new: older saved profiles are read again
const KEY = 'opening-book-v2-profiles';  // { [lower-case name]: { name, at, p } }, the 10 last looked up
const $ = (s) => document.querySelector(s);
const pct = (x) => `${Math.round(x * 100)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const score = (gs) => (gs.length ? sum(gs, (g) => g.result) / gs.length : null);

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
    family: (g.opening?.name || 'Unknown').split(':')[0], rating: mine.rating, diff: mine.ratingDiff || 0, them: theirs.rating,
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
  [p.good, p.work] = verdicts(p);
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
  'King walker': 'Often leaves the king in the centre. Bold, and sometimes it pays off, but it gives the opponent targets.',
  'All-rounder': 'No style stands out: plays a bit of everything and adapts to the position.',
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
console.assert(pieceOf([{ played: { n: [40, 8], b: [40, 1], r: [10, 0], q: [40, 6] } }], 20).piece === 'b', 'pieceOf');

// What kind of player the games show: every trait that clearly holds, the strongest first.
// The two traits that weigh most. Each gets a strength: how far the games go past the point where the
// trait clearly holds (1 = just there); the two strongest name the player, always two (max two).
function typeOf(p) {
  const traits = [
    { name: 'Attacker', w: p.attacking / 0.35, why: `${pct(p.attacking)} of your games are in attacking openings or gambits: you like the initiative early.` },
    { name: 'Solid builder', w: (p.solid / 0.5) * (p.attacking < 0.25 ? 1 : 0.6), why: `${pct(p.solid)} of your games are in solid or positional openings: you build first and attack later.` },
    { name: 'Endgame player', w: p.queensOff / 0.35, why: `The queens come off before move 25 in ${pct(p.queensOff)} of your games: you are happy to trade and play it out.` },
    { name: 'Fighter', w: (0.06 / Math.max(p.draws, 0.01)) * 0.5 * (35 / Math.max(p.moves, 15)), why: `Few draws (${pct(p.draws)}) and games of ${p.moves} moves on average: your games are decided, one way or the other.` },
    { name: 'Comeback player', w: p.analysed >= ENOUGH && p.downs >= 5 ? p.saved / 0.35 : 0, why: `In ${pct(p.saved ?? 0)} of the games where you were clearly losing, you still won or drew.` },
    { name: 'Time scrambler', w: p.lowTime / 0.3, why: `You end ${pct(p.lowTime)} of your games with under a tenth of your time left.` },
    { name: 'King walker', w: p.noCastle / 0.25, why: `Your king stays in the centre in ${pct(p.noCastle)} of your longer games.` },
  ].sort((x, y) => y.w - x.w);
  return traits[0].w < 0.5 ? [{ name: 'All-rounder', why: 'No style stands out: you play a bit of everything.' }, traits[0]] : traits.slice(0, 2);
}
console.assert(typeOf({ attacking: 0.54, solid: 0.2, queensOff: 0.1, draws: 0.05, moves: 30, analysed: 50, downs: 30, saved: 0.47, lowTime: 0.16, noCastle: 0.1 }).map((t) => t.name).join() === 'Attacker,Comeback player', 'typeOf');

// Good at / work on: each check with its evidence, kept only when it says something clear.
function verdicts(p) {
  const good = [], work = [];
  const add = (ok, bad, item) => { if (ok) good.push(item); else if (bad) work.push(item); };
  const diff = (p.white ?? 0) - (p.black ?? 0);
  if (Math.abs(diff) >= 0.08) {
    const [hi, lo] = diff > 0 ? ['White', 'Black'] : ['Black', 'White'];
    const [sHi, sLo] = diff > 0 ? [p.winW ?? p.white, p.winB ?? p.black] : [p.winB ?? p.black, p.winW ?? p.white]; // shown as wins, the one measure the page uses
    good.push({ title: `Playing ${hi}`, why: `You win ${pct(sHi)} of your games as ${hi}.` });
    work.push({ title: `Playing ${lo}`, why: `As ${lo} you win ${pct(sLo)} of your games, against ${pct(sHi)} as ${hi}. Train your openings for that side.`, href: './' });
  }
  if (p.analysed >= ENOUGH && p.ups >= 5) add(p.converted >= 0.8, p.converted < 0.65,
    { title: 'Winning when ahead', why: `When you were clearly better (3 pawns or more), you won ${pct(p.converted)} of ${p.ups} games.`, href: './mistakes.html' });
  if (p.analysed >= ENOUGH && p.downs >= 5) add(p.saved >= 0.35, false, { title: 'Fighting back', why: `When you were clearly worse, you still saved ${pct(p.saved)} of ${p.downs} games.` });
  if (p.blunders !== null && p.analysed >= ENOUGH) add(p.blunders <= 0.4, p.blunders >= 1,
    { title: 'Avoiding blunders', why: `${p.blunders.toFixed(1)} blunders a game in your ${p.analysed} games with computer analysis${p.blunders >= 1 ? `, most in the ${worstPhase(p)}` : ''}.`, href: './mistakes.html' });
  if (p.analysed >= ENOUGH) add(p.badStarts <= 0.1, p.badStarts >= 0.25,
    { title: 'Getting out of the opening', why: `After move 12 you were worse by 1.5 pawns or more in ${pct(p.badStarts)} of your analysed games.`, href: './' });
  if (p.endgames >= 10) add(p.endgameScore >= p.score + 0.07, p.endgameScore <= p.score - 0.07,
    { title: 'Endgames', why: `You score ${pct(p.endgameScore)} in games that reach an endgame, against ${pct(p.score)} overall.`, href: './basics.html' });
  if (p.timeLosses >= 0.2) work.push({ title: 'The clock', why: `${pct(p.timeLosses)} of your losses are on time. Move faster in the opening, which you know.` });
  else if (p.lowTime <= 0.1 && p.n >= 30) good.push({ title: 'Using your time', why: `You are rarely short of time: ${pct(p.lowTime)} of games end with under a tenth left.` });
  if (p.quickLosses >= 0.3) work.push({ title: 'Early collapses', why: `${pct(p.quickLosses)} of your losses are over within 25 moves. Look at every check and capture your opponent has before you move.`, href: './mistakes.html' });
  const ops = [...p.openings.w.map((o) => ({ ...o, side: 'White' })), ...p.openings.b.map((o) => ({ ...o, side: 'Black' }))].filter((o) => o.n >= 8);
  const weight = (o) => (o.score - 0.5) * Math.sqrt(o.n); // a clear result over many games beats an extreme over few
  const top = [...ops].sort((a, b) => weight(b) - weight(a))[0], low = [...ops].sort((a, b) => weight(a) - weight(b))[0];
  if (top && top.score >= 0.6) good.push({ title: top.fam, why: `You win ${pct(top.win)} of ${top.n} games with it as ${top.side}.` });
  if (low && low !== top && low.score <= 0.4) work.push({ title: low.fam, why: `You win only ${pct(low.win)} of ${low.n} games with it as ${low.side}. Practise its lines.`, href: './' });
  return [good.slice(0, 4), work.slice(0, 4)];
}
// Skill bars, 0-100, each read from one thing in the games; null when there are too few games to say.
// The raw scales are rules of thumb (50 is a so-so result for the player); skillsOf puts them on the card's scale.
const clamp = (x) => Math.round(Math.max(0, Math.min(100, x)));
// Each skill is on one scale for every player, like a sports card. The base is the player's percentile
// among all Lichess players of their main time control this week (Lichess's own rating distribution):
// the middle player is 50, Magnus Carlsen about 99. How the player does in each area, judged against
// themselves (raw, 50 = about their usual), moves it up to 25 either way.
const DISTS = 'opening-book-v2-rating-dist'; // { [speed]: { at, freq } }: players per 25 points from 400
const DIST = (() => { try { return JSON.parse(localStorage.getItem(DISTS)) || {}; } catch { return {}; } })();
// Lichess's weekly rating distributions, kept a week; without them a bell curve around 1470 stands in.
async function loadDists() {
  const stale = ['bullet', 'blitz', 'rapid', 'classical'].filter((k) => !DIST[k] || Date.now() - DIST[k].at > 7 * 864e5);
  await Promise.all(stale.map(async (k) => {
    try {
      const t = await (await fetch(`https://lichess.org/stat/rating/distribution/${k}`)).text();
      const m = t.match(/"freq":\[([0-9,]+)\]/);
      if (m) DIST[k] = { at: Date.now(), freq: m[1].split(',').map(Number) };
    } catch {}
  }));
  try { localStorage.setItem(DISTS, JSON.stringify(DIST)); } catch {}
}
function percentile(rating, speed) {
  const f = DIST[speed]?.freq;
  if (!f) return 100 / (1 + Math.exp(-(rating - 1470) / 230)); // shortcut: a logistic stand-in until Lichess answers
  const total = f.reduce((a, b) => a + b, 0), i = (rating - 400) / 25;
  let below = 0;
  for (let k = 0; k < f.length; k++) below += k + 1 <= i ? f[k] : k < i ? f[k] * (i - k) : 0;
  return (below / total) * 100;
}
const levelOf = (rating, speed = 'blitz') => clamp(percentile(rating, speed));
function skillsOf(p) {
  return rawSkills(p).map((x) => ({ ...x, raw: x.v }));
}
function rawSkills(p) {
  const q = p.peer || {}, an = (q.analysed ?? 0) >= ENOUGH, pawns = (cp) => `${cp >= 0 ? '+' : '−'}${(Math.abs(cp) / 100).toFixed(1)}`;
  return [
    { label: 'Openings', needs: true, v: an && q.after12 !== null ? clamp(50 + q.after12 / 4) : null,
      means: 'How you come out of the first 12 moves, against your opponents at your level.',
      why: `After move 12 you stand ${pawns(q.after12 ?? 0)} pawns on average against them.`,
      train: 'Practise the lines of the openings you play, and learn the plan behind them, not just the moves.', href: './' },
    { label: 'Tactics', needs: true, v: an && q.myBl !== null && q.oppBl !== null ? clamp(50 + (50 * (q.oppBl - q.myBl)) / Math.max(0.5, q.oppBl + q.myBl)) : null,
      means: 'How often you blunder (throw away a piece or the game) compared with players at your level.',
      why: `${(q.myBl ?? 0).toFixed(1)} blunders a game; your opponents ${(q.oppBl ?? 0).toFixed(1)}.`,
      train: 'Before every move, check every check, capture and threat your opponent has after it. Then solve the positions where you blundered.', href: './mistakes.html' },
    { label: 'Winning when ahead', needs: true, v: an && q.meUp != null && q.oppUp != null ? clamp(50 + (50 * (q.oppUp - q.meUp)) / Math.max(0.2, q.oppUp + q.meUp)) : null,
      means: 'Keeping it clean when you are clearly ahead (1.5 pawns or more): how often you make a mistake then, against your opponents when they are ahead.',
      why: `When ahead: ${(q.meUp ?? 0).toFixed(1)} mistakes per 10 moves; your opponents ${(q.oppUp ?? 0).toFixed(1)}.`,
      train: 'When ahead: trade pieces, not pawns, take away their counterplay first, and do not rush.', href: './basics.html' },
    { label: 'Defending', needs: true, v: an && q.meDown != null && q.oppDown != null ? clamp(50 + (50 * (q.oppDown - q.meDown)) / Math.max(0.2, q.oppDown + q.meDown)) : null,
      means: 'Holding on when you are clearly behind (1.5 pawns or more): how often you make another mistake then, against your opponents when they are behind.',
      why: `When behind: ${(q.meDown ?? 0).toFixed(1)} mistakes per 10 moves; your opponents ${(q.oppDown ?? 0).toFixed(1)}.`,
      train: 'When behind: keep pieces on, make threats, and set traps rather than waiting.' },
    { label: 'Endgames', v: q.endgames >= 10 ? clamp(50 + (q.endScore - 0.5) * 150) : null,
      means: 'How you do against players at your level once most pieces are gone (6 or fewer besides kings and pawns).',
      why: `You score ${pct(q.endScore ?? 0)} in ${q.endgames} endgames against them (50% is even).`,
      train: 'Learn the basic endgames: king activity, passed pawns, and the key king-and-pawn positions.', href: './basics.html' },
    { label: 'Clock', v: q.n >= 30 ? clamp(50 + (q.oppLow - q.myLow) * 100 + (q.timeWins - q.timeLosses) * 200) : null,
      means: 'Using your time well compared with your opponents: who ends up short of time, and who loses on it.',
      why: `Short of time in ${pct(q.myLow ?? 0)} of games (they ${pct(q.oppLow ?? 0)}); you win ${pct(q.timeWins ?? 0)} and lose ${pct(q.timeLosses ?? 0)} of games on time.`,
      train: 'Play the opening fast (you know it), and save your thinking time for the critical moments.' },
  ];
}
console.assert(Math.abs(percentile(1470, 'none') - 50) < 1 && percentile(2900, 'none') > 99, 'percentile');
console.assert(rawSkills({ peer: { analysed: 30, after12: 100, myBl: 1, oppBl: 1, meUp: 1, oppUp: 3, endgames: 0, n: 10 } }).map((x) => x.v).slice(0, 3).join() === '75,50,75', 'rawSkills');
const worstPhase = (p) => Object.entries(p.slips).sort((a, b) => b[1] - a[1])[0][0];
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
  if (i >= 0) { games[i] = g; saveGames(name, games); }
}
// A player's games as kept here, in Lichess's shape, or null.
function storedGames(name) {
  const t = gamesStore()[name.toLowerCase()];
  return t ? t.games.map(unpack) : null;
}

let RAW = null, RAW_NAME = ''; // the games in use, kept for analysing them here
async function build(name) {
  const msg = $('#profile-msg'), have = storedGames(name) || [];
  msg.textContent = have.length ? `Fetching ${name}'s new games from Lichess…` : `Fetching ${name}'s last ${MAX} rated games from Lichess…`;
  const fresh = await fetchGames(name, (k) => { msg.textContent = `Fetching ${name}'s games from Lichess… ${k}`; }, have.length ? have[0].createdAt + 1 : null);
  const ids = new Set(fresh.map((g) => g.id));
  const raw = [...fresh, ...have.filter((g) => !ids.has(g.id))].slice(0, MAX);
  if (!raw.length) throw new Error(`${name} has no rated games on Lichess yet.`);
  saveGames(name, raw);
  RAW = raw; RAW_NAME = name;
  return readAll(name, raw);
}
async function readAll(name, raw) {
  const msg = $('#profile-msg');
  const me = name.toLowerCase(), games = [];
  for (let i = 0; i < raw.length; i++) {
    games.push(readGame(raw[i], me));
    if (i % 25 === 24) { msg.textContent = `Reading the games… ${i + 1} of ${raw.length}`; await new Promise((r) => setTimeout(r)); }
  }
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
// What analysing the newest n games here would take: the games without analysis, and the time.
function costOf(p, n) {
  const todo = (p.todo || []).slice(0, n).filter(Boolean);
  return { games: todo.length, sec: sum(todo, (x) => x) * PER_POS };
}
let analysing = null; // { stop } while a run is going
async function analyse(name, n) {
  const el = $('#pf-analyse');
  await build(name); // the games played since are fetched first, so they are analysed too
  const todo = RAW.slice(0, n).filter((g) => !g.analysis && g.moves);
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
function analysePanel(name, p) {
  if (analysing) return `<div id="pf-analyse" class="pf-analyse running"><span class="pf-an-progress">Analysing…</span><div class="pf-an-bar"><i></i></div><button type="button" class="link" data-stop>Stop</button></div>`;
  if (!p.todo) return '';
  const opts = [100, 250, 500].filter((n) => n <= Math.max(100, p.n)).map((n) => ({ n, ...costOf(p, n) }));
  const few = p.analysed < ENOUGH, first = opts[0];
  return `<div id="pf-analyse" class="pf-analyse${few ? ' few' : ''}">
    <div class="pf-an-row"><span><b>${p.analysed}/${p.n}</b> games analysed${p.ours ? ` (${p.ours} here)` : ''}
      <details class="pf-help"><summary title="${WHY_ANALYSE}" aria-label="Why analyse?">?</summary><p>${WHY_ANALYSE}</p></details>. Analyse the newest:</span>
    ${opts.map((o) => `<button type="button" class="pf-an-opt" data-analyse="${o.n}" ${o.games ? '' : 'disabled'} title="${o.games ? `${o.games} games without analysis, ${minutes(o.sec)}, with Stockfish in your browser` : 'All analysed'}">${o.n} <small>${o.games ? `${o.games} new · ${minutes(o.sec).replace('about ', '~')}` : 'done'}</small></button>`).join('')}</div>
    ${few ? `<p class="pf-an-few">Analyse at least ${ENOUGH} games to unlock Openings, Tactics, Winning when ahead, Defending, accuracy and blunders.</p>` : ''}
  </div>`;
}
function bindAnalyse(name) {
  const el = $('#pf-analyse');
  if (!el) return;
  el.querySelectorAll('[data-analyse]').forEach((b) => b.addEventListener('click', async () => {
    const n = Number(b.dataset.analyse);
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
const bar = (s) => `<div class="wdl" role="img" aria-label="Score ${pct(s)}"><span class="w" style="width:${s * 100}%"></span><span class="l" style="width:${(1 - s) * 100}%"></span></div>`;
const ago = (t) => { const h = (Date.now() - t) / 3.6e6; return h < 1 ? 'less than an hour ago' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`; };
function verdictList(items, empty) {
  return items.length ? `<ul class="pf-list">${items.map((i) => `<li><b>${esc(i.title)}</b><span>${esc(i.why)}${i.href ? ` <a href="${i.href}">Train it</a>` : ''}</span></li>`).join('')}</ul>` : `<p class="info">${empty}</p>`;
}
function openingRows(list) {
  return list.length ? `<ul class="pf-rows">${list.slice(0, 6).map((o) => `<li><span>${esc(o.fam)}</span><small>${o.n} games · ${pct(o.win ?? o.score)} wins</small>${bar(o.win ?? o.score)}</li>`).join('')}</ul>` : '<p class="info">Fewer than 5 games with any one opening.</p>';
}
// Each bar: what it measures, what the games show, and below 50 how to train it; the words show on request.
let showSkillText = false;
function skillBars(skills, say, me) {
  return `<ul class="pf-skills">${skills.map((x) => `<li${x.v === null ? ' class="pf-skill-none"' : ''}>
      <span class="pf-skill-name">${x.label}</span><span class="pf-skill-val">${x.v ?? '–'}</span>
      <div class="pf-meter" role="img" aria-label="${x.label}: ${x.v === null ? 'not enough games' : `${x.v} of 100`}"><i style="width:${x.v ?? 0}%"></i></div>
      ${x.v === null && x.needs ? '<small class="pf-skill-lock">Needs more analysed games</small>' : ''}
      <div class="pf-skill-more"><p class="pf-means">${esc(x.means)}</p>
      <small>${x.v === null ? 'Not enough games to say.' : esc(say(x.why))}</small>
      ${x.raw !== null && x.raw < 50 ? `<p class="pf-train"><b>How to train:</b> ${esc(x.train)}${me && x.href ? ` <a href="${x.href}">Start</a>` : ''}</p>` : ''}</div></li>`).join('')}</ul>`;
}
// Which kind of opening each side mostly picks: the top style when it is a quarter or more of them.
const taste = (m) => (m && m.n >= 10 ? m.parts.find((x) => x.k !== 'other' && x.share >= 0.25) || null : null);
function tasteLine(mix, me) {
  const w = taste(mix?.w), b = taste(mix?.b);
  if (!w && !b) return '';
  return `<p class="pf-taste">Opening taste: ${[w && `<b>${w.label}</b> as White`, b && `<b>${b.label}</b> as Black`].filter(Boolean).join(' · ')}</p>`;
}
function tastePanel(mix, me) {
  if (!mix) return '';
  const side = (m, name) => {
    if (m.n < 10) return `<div><h3>As ${name}</h3><p class="info">Too few games in openings ${me ? 'you' : 'they'} choose as ${name}.</p></div>`;
    const t = taste(m);
    return `<div><h3>As ${name}</h3><p class="pf-taste-say">${t ? `Mostly <b>${t.words}</b> (${pct(t.share)} of the openings ${me ? 'you' : 'they'} choose).` : 'A mix of openings, no style stands out.'}</p>
      <ul class="pf-rows">${m.parts.map((x) => `<li><span>${x.label}</span><small>${pct(x.share)}</small><div class="pf-meter"><i style="width:${x.share * 100}%"></i></div></li>`).join('')}</ul></div>`;
  };
  return `<section class="pf-card"><h2>Opening style</h2>
    <p class="info pf-note">Gambits give material for attack, attacking openings go for the initiative, positional and solid ones build first. Counted from the openings ${me ? 'you pick yourself' : 'they pick themselves'}: the defence as Black, the opening as White.</p>
    <div class="pf-two pf-taste-grid">${side(mix.w, 'White')}${side(mix.b, 'Black')}</div></section>`;
}
// How games end: wins and losses split by mate, resignation and time, as numbers with a small bar each.
function endsGrid(ends) {
  const kinds = [['mate', 'By mate'], ['resign', 'Resigned'], ['time', 'On time']];
  const row = (label, cls, x) => `<div class="pf-ends-row ${cls}"><span class="pf-ends-label">${label}</span>${kinds.map(([k, name]) => `
    <div class="pf-ends-cell"><b>${pct(x[k])}</b><small>${name}</small><span class="pf-ends-bar"><i style="width:${x[k] * 100}%"></i></span></div>`).join('')}</div>`;
  return `<div class="pf-ends">${row('Wins', 'won', ends.won)}${row('Losses', 'lost', ends.lost)}</div>`;
}
// A portrait in words, from this player's own games: the openings they actually choose, how their
// games end, their best piece, and the area that lifts or holds them back. No two read the same.
function portrait(name, p, skills, me) {
  const you = me ? 'You' : esc(name), your = me ? 'your' : 'their', are = me ? 'are' : 'is';
  // The openings chosen, by family: the King's Gambit Accepted and Declined are one King's Gambit.
  const own = (list) => [...new Set(list.filter((o) => !o.fam.startsWith('vs ')).map((o) => o.fam.replace(/ (Accepted|Declined)$/, '')))].slice(0, 2).map(esc);
  const w = own(p.openings.w), b = own(p.openings.b);
  const and = (xs) => xs.join(' and ');
  const out = [];
  const t = p.type.map((x) => x.name.toLowerCase());
  out.push(`${you} ${are} ${article(t[0])} ${t[0]}${t[1] ? ` with a ${t[1]}'s streak` : ''}${w.length || b.length ? `, reaching for ${[w.length && `the ${and(w)} as White`, b.length && `the ${and(b)} as Black`].filter(Boolean).join(' and ')}` : ''}.`);
  const known = skills.filter((x) => x.v !== null).sort((a, b) => b.v - a.v);
  if (known.length >= 2) out.push(`${me ? 'Your' : 'Their'} game is carried by ${known[0].label.toLowerCase()} and held back most by ${known[known.length - 1].label.toLowerCase()}.`);
  if (p.piece) out.push(`${me ? 'Your' : 'Their'} most important piece is the ${PIECE_NAME[p.piece]}.`);
  const e = p.ends.won, l = p.ends.lost;
  const winsBy = e.mate >= e.resign && e.mate >= e.time ? `${pct(e.mate)} of wins by mate` : e.time >= e.resign ? `${pct(e.time)} of wins on the clock` : `${pct(e.resign)} of wins by resignation`;
  out.push(`Games last ${p.moves} moves on average, with ${winsBy}${l.time >= 0.2 ? ` and ${pct(l.time)} of losses on time` : ''}.`);
  const dw = (p.winW ?? 0) - (p.winB ?? 0);
  if (Math.abs(dw) >= 0.06) out.push(`${you} win${me ? '' : 's'} clearly more often with ${dw > 0 ? 'White' : 'Black'} (${pct(Math.max(p.winW, p.winB))} against ${pct(Math.min(p.winW, p.winB))}).`);
  return out.join(' ');
}
// The player card: the overall (the mean of the known skills), a short code for the type, the six skills.
// The piece is drawn white for the black card; in dark mode, where the card is cream, CSS inverts it.
const CARD_INK = 'w';
const PIECE_NAME = { n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };
const ABBR = { Openings: 'OPN', Tactics: 'TAC', 'Winning when ahead': 'WIN', Defending: 'DEF', Endgames: 'END', Clock: 'CLK' };
function playerCard(name, p, t, skills) {
  const known = skills.filter((x) => x.v !== null);
  const ovr = known.length ? Math.round(sum(known, (x) => x.v) / known.length) : '–';
  const main = p.speeds[0];
  return `<div class="pf-pcard" role="img" aria-label="Player card: overall ${ovr}, ${t[0].name}, ${known.map((x) => `${x.label} ${x.v}`).join(', ')}">
    <div class="pf-pcard-top"><div><b class="pf-ovr">${ovr}</b><span class="pf-pos">${esc(t[0].name)}</span></div>
      <div class="pf-pcard-side"><img class="pf-pcard-piece" src="pieces/${CARD_INK}${(p.piece || 'n').toUpperCase()}.svg" alt="" title="${esc(name)}'s most important piece: the ${PIECE_NAME[p.piece || 'n']}, ${p.pieceWhy === 'best' ? `the piece played best, with the fewest mistakes and blunders per move in the analysed games` : 'the piece that does the most in these games (analyse 20 games to see the one played best)'}">
        ${main ? `<span class="pf-pcard-rating">${main.rating} <small>${main.speed}</small></span><span class="pf-pcard-rank">${rankText(main)}</span>` : ''}</div></div>
    <p class="pf-pcard-name">${esc(name)}</p>
    <div class="pf-pcard-stats">${skills.map((x) => `<span><b>${x.v ?? '–'}</b>${ABBR[x.label]}</span>`).join('')}</div>
    <p class="pf-pcard-foot">${main ? `VS ${main.rating - PEER}–${main.rating + PEER} · ` : ''}${p.n} ${main && p.speeds.length === 1 ? `${main.speed.toUpperCase()} ` : ''}GAMES</p>
  </div>`;
}
// Where a rating ranks among all Lichess players of that time control this week: "Top 27%".
const pctOf = (main) => Math.round(percentile(main.rating, main.speed));
const rankText = (main) => (pctOf(main) >= 50 ? `Top ${Math.max(1, 100 - pctOf(main))}%` : `Better than ${pctOf(main)}%`);
// The card explained in one go, under it.
function cardNote(name, p, me) {
  const main = p.speeds[0];
  if (!main) return '';
  return `<p class="pf-card-note">The six skills compare ${me ? 'you' : esc(name)} with ${me ? 'your' : 'their'} own opponents rated ${main.rating - PEER}–${main.rating + PEER}, in the same games: <b>50 means as good as them</b>, higher is better. The big number is the average of the six. <b>${rankText(main)}</b>: where ${main.rating} ranks among all Lichess ${main.speed} players this week.</p>`;
}
function render(name, at, p) {
  const t = p.type, me = isMe(name), say = me ? (x) => x : they, skills = skillsOf(p);
  document.title = me ? 'Your Profile' : `${name} · Profile`;
  const list = (items, empty) => verdictList(items.map((i) => ({ ...i, why: say(i.why), href: me ? i.href : null })), empty);
  const known = skills.filter((x) => x.v !== null).sort((a, b) => b.v - a.v);
  const kpis = [['Win rate', pct(p.winRate ?? p.score)], p.acc !== null && p.analysed >= ENOUGH && ['Accuracy', `${p.acc}%`], p.blunders !== null && p.analysed >= ENOUGH && ['Blunders / game', p.blunders.toFixed(1)], ['Draws', pct(p.draws)]].filter(Boolean);
  $('#profile').innerHTML = `
    ${playerBar(name)}
    <section class="pf-hero">
      <div class="pf-card-col">${playerCard(name, p, t, skills)}${cardNote(name, p, me)}</div>
      <div class="pf-hero-text">
        <h1 class="pf-h1">${esc(t[0].name)}</h1>
        ${t.length > 1 ? `<p class="pf-sub">+ ${t.slice(1).map((x) => esc(x.name)).join(' + ')}</p>` : ''}
        <p class="pf-portrait">${portrait(name, p, skills, me)}</p>
        <div class="pf-about">${t.map((x) => `<p title="${esc(TYPE_ABOUT[x.name] || '')}"><b>${esc(x.name)}:</b> ${esc(say(x.why))}</p>`).join('')}</div>
        ${tasteLine(p.styleMix, me)}
        ${known.length >= 2 ? `<p class="pf-best">Strongest: <b>${known[0].label}</b> · To train: <b>${known[known.length - 1].label}</b></p>` : ''}
      </div>
    </section>
    <section class="pf-card pf-chart" id="pf-chart"></section>
    <dl class="pf-kpis">${kpis.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${analysePanel(name, p)}
    <section class="pf-card pf-skills-card${showSkillText ? ' open' : ''}">
      <div class="pf-skills-head"><h2>${me ? 'Skills' : `${esc(name)}'s skills`}</h2>
        <button type="button" class="link" data-skill-text aria-expanded="${showSkillText}">${showSkillText ? 'Hide explanations' : 'What each one means'}</button></div>
      ${skillBars(skills, say, me)}
      <p class="info pf-note pf-skill-more">Every player is on the same scale, like a sports card: the base is where the rating ranks among all Lichess players in that time control (the middle player is 50, the very top 99), and each bar moves up to 25 above or below it by how the games go in that area compared with the player's own average.</p>
    </section>
    <div class="pf-two">
      <section class="pf-card"><h2 class="pf-good">Strengths</h2>${list(p.good, 'Nothing stands out yet. More games give a clearer picture.')}</section>
      <section class="pf-card"><h2 class="pf-bad">Train next</h2>${list(p.work, 'Nothing stands out as a weakness in these games.')}</section>
    </div>
    <section class="pf-card">
      <h2>Results</h2>
      <dl class="pf-stats">
        <div><dt>Wins as White</dt><dd>${p.winW == null ? '–' : pct(p.winW)}</dd></div>
        <div><dt>Wins as Black</dt><dd>${p.winB == null ? '–' : pct(p.winB)}</dd></div>
        <div><dt>Moves a game</dt><dd>${p.moves}</dd></div>
      </dl>
      <h3>By time control</h3>
      <ul class="pf-rows">${p.speeds.map((x) => `<li><span>${x.speed[0].toUpperCase() + x.speed.slice(1)}</span><small>${x.n} games · ${pct(x.win ?? x.score)} wins · now ${x.rating} (${x.change >= 0 ? '+' : ''}${x.change})</small>${bar(x.win ?? x.score)}</li>`).join('')}</ul>
      <h3>How ${me ? 'your' : 'their'} games end</h3>
      ${endsGrid(p.ends)}
    </section>
    ${tastePanel(p.styleMix, me)}
    <div class="pf-two">
      <section class="pf-card"><h2>Openings as White</h2>${openingRows(p.openings.w)}</section>
      <section class="pf-card"><h2>Openings as Black</h2>${openingRows(p.openings.b)}</section>
    </div>
    <section class="pf-card" id="pf-games"></section>
    <section class="pf-about-data">
      <h2>About these numbers</h2>
      <p class="info">Read from ${me ? 'your' : `${esc(name)}'s`} last ${p.n} rated Lichess games, ${ago(at)}. <button id="refresh" class="link" type="button">Read them again</button></p>
      <p class="info">Results, openings, opening style, the clock, endgames and the rating graph use all ${p.n} games.
        Accuracy, blunders and the Openings, Tactics, Winning when ahead and Defending skills need a computer's verdict on every move, so they use only the
        ${p.analysed} analysed game${p.analysed === 1 ? '' : 's'}${p.ours ? ` (${p.ours} analysed here with Stockfish, the rest by Lichess)` : ''}. Analyse more from the bar at the top.</p>
      <p class="info">Player types, skills and thresholds are rules of thumb read from the games, not a rating. Score counts a win as 1 and a draw as a half.</p>
    </section>`;
  $('#refresh').addEventListener('click', () => run(name));
  bindSearch();
  bindAnalyse(name);
  bindPlayerBar(name);
  gamesList(name, 15);
  $('[data-skill-text]').addEventListener('click', (e) => {
    showSkillText = !showSkillText;
    $('.pf-skills-card').classList.toggle('open', showSkillText);
    e.currentTarget.setAttribute('aria-expanded', showSkillText);
    e.currentTarget.textContent = showSkillText ? 'Hide explanations' : 'What each one means';
  });
  ratingChart(name, p);
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
  const draw = () => {
    const all = h[chartState.speed], days = RANGES.find(([k]) => k === chartState.range)[1];
    const end = Date.now(), from = days === Infinity ? all[0][0] : end - days * DAY;
    // The rating going into the range, then every change inside it.
    const before = all.filter(([t]) => t < from).pop();
    const pts = [...(before ? [[from, before[1]]] : []), ...all.filter(([t]) => t >= from)];
    const first = all[0][0];
    const covers = full || from >= first;
    el.innerHTML = `<div class="pf-chart-head"><h2>Rating</h2>
      <div class="pf-seg" role="group" aria-label="Time control">${speeds.map((k) => `<button type="button" data-speed="${k}" aria-pressed="${k === chartState.speed}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
      <div class="pf-seg" role="group" aria-label="Period">${RANGES.map(([k]) => `<button type="button" data-range="${k}" aria-pressed="${k === chartState.range}">${k}</button>`).join('')}</div></div>
      ${pts.length < 2 ? '<p class="info">No rated games in this period.</p>' : lineChart(pts, from, end)}
      ${covers ? '' : `<p class="info pf-note">The graph starts at ${new Date(first).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, the oldest of the games read here. Log in with Lichess for the full history.</p>`}`;
    el.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => { chartState.speed = b.dataset.speed; draw(); }));
    el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { chartState.range = b.dataset.range; draw(); }));
    hover(el);
  };
  draw();
}
const fmtDay = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
// One line, one axis: rating against time, with the change over the period in the corner.
function lineChart(pts, from, end) {
  const W = 760, H = 240, L = 44, R = 12, T = 14, B = 26;
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
    const near = pts.reduce((a, q) => (Math.abs(q[0] - px) < Math.abs(a[0] - px) ? q : a));
    g.setAttribute('visibility', 'visible');
    g.querySelector('line').setAttribute('x1', near[0]); g.querySelector('line').setAttribute('x2', near[0]);
    g.querySelector('circle').setAttribute('cx', near[0]); g.querySelector('circle').setAttribute('cy', near[1]);
    tip.textContent = `${near[2]} on ${fmtDay(near[3])}`;
    tip.style.left = `${b.left - el.getBoundingClientRect().left + (near[0] / 760) * b.width}px`; // an SVG has no offsetLeft
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
  const mine = ++runs;
  $('#profile').innerHTML = '';
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

export { build, cache, myName, skillsOf, loadDists, storedGames, keepGame, engineEval, applyEvals, winPct, PV };
if ($('#profile')) { // the practice page imports this module for the above; only the profile page draws itself
  try { await finishLogin(); } catch (err) { $('#profile-msg').textContent = err.message; } // back from logging in on this page
  await loadDists();
  start();
}
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
  const c = cache()[name.toLowerCase()];
  return c && c.v === PV ? { name: c.name, p: c.p } : { name, p: await build(name) };
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
  const rows = [
    ['Rating', num(main(A.p)?.rating) + (main(A.p) ? ` <small>${main(A.p).speed}</small>` : ''), num(main(B.p)?.rating) + (main(B.p) ? ` <small>${main(B.p).speed}</small>` : '')],
    ['Win rate', pct(A.p.winRate), pct(B.p.winRate)],
    ['Wins as White', num(A.p.winW, pct), num(B.p.winW, pct)],
    ['Wins as Black', num(A.p.winB, pct), num(B.p.winB, pct)],
    ['Accuracy', num(A.p.acc, (x) => `${x}%`), num(B.p.acc, (x) => `${x}%`)],
    ['Blunders / game', num(A.p.blunders, (x) => x.toFixed(1)), num(B.p.blunders, (x) => x.toFixed(1))],
    ['Draws', pct(A.p.draws), pct(B.p.draws)],
    ['Moves a game', A.p.moves, B.p.moves],
    ['Opening taste', tasteShort(A.p.styleMix), tasteShort(B.p.styleMix)],
  ];
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
        <tbody>${rows.map(([k, x, y]) => `<tr><th scope="row">${k}</th><td>${x}</td><td>${y}</td></tr>`).join('')}</tbody></table>
    </section>
    <p class="info">Both read from each player's last ${MAX} rated Lichess games${speed === 'all' ? '' : `, ${speed} only`}. Skills are rules of thumb; ones that need analysed games are only as good as the number analysed.</p>`;  document.querySelectorAll('.cmp-speeds [data-speed]').forEach((btn) => btn.addEventListener('click', () => {
    const q = new URLSearchParams(location.search);
    q.set('speed', btn.dataset.speed);
    history.replaceState(null, '', `?${q}`);
    compare(A.name, B.name, btn.dataset.speed);
  }));

}
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
// The comparison in words: who is stronger overall and by how much, where each one is better, how
// they play, and how they score.
function compareStory(A, B, sa, sb) {
  const a = esc(A.name), b = esc(B.name);
  const ovr = (sk) => { const k = sk.filter((x) => x.v !== null); return k.length ? Math.round(sum(k, (x) => x.v) / k.length) : null; };
  const oa = ovr(sa), ob = ovr(sb), out = [];
  if (oa !== null && ob !== null) {
    const d = oa - ob;
    out.push(Math.abs(d) <= 3 ? `<b>Very even overall</b> (${oa} against ${ob}): the difference is in the details.`
      : `<b>${d > 0 ? a : b} is the stronger player overall</b> (${Math.max(oa, ob)} against ${Math.min(oa, ob)})${Math.abs(d) >= 15 ? ', a clear gap' : ''}.`);
  }
  const gaps = sa.map((x, i) => ({ label: x.label.toLowerCase(), d: x.v !== null && sb[i].v !== null ? x.v - sb[i].v : null })).filter((x) => x.d !== null);
  const forA = gaps.filter((x) => x.d >= 5).sort((x, y) => y.d - x.d), forB = gaps.filter((x) => x.d <= -5).sort((x, y) => x.d - y.d);
  const list = (xs) => xs.slice(0, 2).map((x) => `${x.label} (+${Math.abs(x.d)})`).join(' and ');
  if (forA.length || forB.length) out.push([forA.length && `${a} is better at ${list(forA)}`, forB.length && `${b} at ${list(forB)}`].filter(Boolean).join(', while ') + '.');
  const ta = A.p.type[0].name, tb = B.p.type[0].name;
  out.push(ta === tb ? `Both play as ${article(ta)} ${ta.toLowerCase()}${tasteShort(A.p.styleMix) === tasteShort(B.p.styleMix) ? ', with the same taste in openings' : ''}.`
    : `${a} plays as ${article(ta)} ${ta.toLowerCase()} (${tasteShort(A.p.styleMix).toLowerCase()}), ${b} as ${article(tb)} ${tb.toLowerCase()} (${tasteShort(B.p.styleMix).toLowerCase()}).`);
  const ds = Math.round((A.p.winRate - B.p.winRate) * 100);
  out.push(Math.abs(ds) < 3 ? `They win about as often against their own opponents (${pct(A.p.winRate)} and ${pct(B.p.winRate)} of games).`
    : `${ds > 0 ? a : b} wins more often against their own opponents (${pct(Math.max(A.p.winRate, B.p.winRate))} of games against ${pct(Math.min(A.p.winRate, B.p.winRate))}).`);
  if (A.p.blunders !== null && B.p.blunders !== null && A.p.analysed >= ENOUGH && B.p.analysed >= ENOUGH && Math.abs(A.p.blunders - B.p.blunders) >= 0.3) {
    const fewer = A.p.blunders < B.p.blunders ? a : b;
    out.push(`${fewer} blunders less (${Math.min(A.p.blunders, B.p.blunders).toFixed(1)} a game against ${Math.max(A.p.blunders, B.p.blunders).toFixed(1)}).`);
  }
  return out;
}
const tasteShort = (mix) => [taste(mix?.w) && `${taste(mix.w).label} as White`, taste(mix?.b) && `${taste(mix.b).label} as Black`].filter(Boolean).join(', ') || 'Mixed';

// A player's profile: from this browser when it was read before, else from their games. The address
// keeps the name (?u=), so a profile can be shared or bookmarked.
function show(name, push) {
  if (push) history.pushState(null, '', isMe(name) ? location.pathname : `?u=${encodeURIComponent(name)}`);
  const c = cache()[name.toLowerCase()];
  if (!(c && c.v === PV)) return run(name);
  try { render(c.name, c.at, c.p); } catch (err) { console.warn('saved profile could not be shown, reading it again', err); run(name); }
}
function start() {
  const q = new URLSearchParams(location.search), name = q.get('u') || myName();
  if (name && q.get('vs')) return compare(name, q.get('vs'));
  if (name) show(name, false); else ask();
}
if ($('#profile')) addEventListener('popstate', () => start());
