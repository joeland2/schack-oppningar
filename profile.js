// Your profile: your last 500 rated Lichess games read move by move, then what kind of player they
// show, what you are good at, what to work on, and the numbers behind it. Lichess's own computer
// analysis is used where a game has it (accuracy, blunders, who was winning when). The result is kept
// in this browser, so the page opens at once next time; Refresh reads the games again.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { account, login, finishLogin } from './lichess.js?v=20261028205235';
import { STYLE_OF } from './styles.js?v=20261028205235';

const MAX = 500;
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
  for (let i = 0; i < moves.length; i++) {
    let m;
    try { m = c.move(moves[i]); } catch { break; }
    if (m.color === side && /[kq]/.test(m.flags) && castled === null) castled = i;
    const pieces = c.board().flat().filter(Boolean);
    if (queensOff === null && !pieces.some((p) => p.type === 'q')) queensOff = i;
    if (endgameAt === null && pieces.filter((p) => p.type !== 'p' && p.type !== 'k').length <= 6) endgameAt = i;
  }
  const phase = (i) => (i < 20 ? 'opening' : endgameAt !== null && i >= endgameAt ? 'endgame' : 'middlegame');
  // Lichess's analysis: the evaluation after every move, from White; here from your side.
  const v = (g.analysis || []).map((a) => (cpOf(a) ?? 0) * pov);
  const slips = { opening: 0, middlegame: 0, endgame: 0 };
  (g.analysis || []).forEach((a, i) => { if (i % 2 === myPly && a.judgment?.name === 'Blunder') slips[phase(i)]++; });
  // Your clock after your last move, against the time you started with.
  const clocks = (g.clocks || []).filter((_, i) => i % 2 === myPly);
  const left = clocks.length ? clocks[clocks.length - 1] / 100 : null;
  return {
    side, speed: g.speed, at: g.createdAt, status: g.status, plies: moves.length,
    result: !g.winner ? 0.5 : (g.winner === 'white') === (side === 'w') ? 1 : 0,
    family: (g.opening?.name || 'Unknown').split(':')[0], rating: mine.rating, diff: mine.ratingDiff || 0, them: theirs.rating,
    castled, queensOff, endgame: endgameAt !== null,
    analysed: v.length > 0, acc: mine.analysis?.accuracy ?? null, blunders: mine.analysis?.blunder ?? null, mistakes: mine.analysis?.mistake ?? null,
    best: v.length ? Math.max(...v) : null, worst: v.length ? Math.min(...v) : null, after12: v.length > 23 ? v[23] : null, slips,
    lowTime: left !== null && g.clock ? left < Math.max(10, g.clock.initial * 0.1) : false,
  };
}

// ---------- All games: the profile ----------
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
    return [...m].filter(([, gs]) => gs.length >= 5).map(([fam, gs]) => ({ fam: vs(fam), n: gs.length, score: score(gs) })).sort((a, b) => b.n - a.n);
  };
  const ups = an.filter((g) => g.best >= 300), downs = an.filter((g) => g.worst <= -300);
  const slips = { opening: 0, middlegame: 0, endgame: 0 };
  for (const g of an) for (const k in slips) slips[k] += g.slips[k];
  const p = {
    n, score: score(games), white: score(games.filter((g) => g.side === 'w')), black: score(games.filter((g) => g.side === 'b')),
    nWhite: games.filter((g) => g.side === 'w').length,
    speeds: Object.entries(games.reduce((m, g) => ({ ...m, [g.speed]: [...(m[g.speed] || []), g] }), {}))
      .map(([speed, gs]) => ({ speed, n: gs.length, score: score(gs), rating: gs[0].rating + gs[0].diff, change: gs[0].rating + gs[0].diff - gs[gs.length - 1].rating })) // newest game first
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
    analysed: an.length,
    acc: an.length ? Math.round(sum(an.filter((g) => g.acc !== null), (g) => g.acc) / Math.max(1, an.filter((g) => g.acc !== null).length)) : null,
    blunders: an.length ? sum(an, (g) => g.blunders || 0) / an.length : null,
    slips, ups: ups.length, converted: score(ups.map((g) => ({ result: g.result === 1 ? 1 : 0 }))),
    downs: downs.length, saved: score(downs.map((g) => ({ result: g.result > 0 ? 1 : 0 }))),
    badStarts: share(an.filter((g) => g.after12 !== null), (g) => g.after12 <= -150),
    openings: { w: byOpening('w'), b: byOpening('b') },
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
// What kind of player the games show: every trait that clearly holds, the strongest first.
function typeOf(p) {
  const traits = [
    p.attacking >= 0.35 && { name: 'Attacker', why: `${pct(p.attacking)} of your games are in attacking openings or gambits: you like the initiative early.` },
    p.solid >= 0.5 && p.attacking < 0.25 && { name: 'Solid builder', why: `${pct(p.solid)} of your games are in solid or positional openings: you build first and attack later.` },
    p.queensOff >= 0.35 && { name: 'Endgame player', why: `The queens come off before move 25 in ${pct(p.queensOff)} of your games: you are happy to trade and play it out.` },
    p.draws < 0.04 && p.moves <= 35 && { name: 'Fighter', why: `Almost no draws (${pct(p.draws)}) and games of ${p.moves} moves on average: your games are decided, one way or the other.` },
    p.downs >= 5 && p.saved >= 0.35 && { name: 'Comeback player', why: `In ${pct(p.saved)} of the games where you were clearly losing, you still won or drew.` },
    p.lowTime >= 0.3 && { name: 'Time scrambler', why: `You end ${pct(p.lowTime)} of your games with under a tenth of your time left.` },
    p.noCastle >= 0.25 && { name: 'King walker', why: `Your king stays in the centre in ${pct(p.noCastle)} of your longer games.` },
  ].filter(Boolean);
  return traits.length ? traits : [{ name: 'All-rounder', why: 'No style stands out: you play a bit of everything.' }];
}

// Good at / work on: each check with its evidence, kept only when it says something clear.
function verdicts(p) {
  const good = [], work = [];
  const add = (ok, bad, item) => { if (ok) good.push(item); else if (bad) work.push(item); };
  const diff = (p.white ?? 0) - (p.black ?? 0);
  if (Math.abs(diff) >= 0.08) {
    const [hi, lo] = diff > 0 ? ['White', 'Black'] : ['Black', 'White'];
    const [sHi, sLo] = diff > 0 ? [p.white, p.black] : [p.black, p.white];
    good.push({ title: `Playing ${hi}`, why: `You score ${pct(sHi)} as ${hi}.` });
    work.push({ title: `Playing ${lo}`, why: `As ${lo} you score ${pct(sLo)}, ${Math.round(Math.abs(diff) * 100)} points less than as ${hi}. Train your openings for that side.`, href: './' });
  }
  if (p.ups >= 5) add(p.converted >= 0.8, p.converted < 0.65,
    { title: 'Winning won games', why: `When you were clearly better (3 pawns or more), you won ${pct(p.converted)} of ${p.ups} games.`, href: './mistakes.html' });
  if (p.downs >= 5) add(p.saved >= 0.35, false, { title: 'Fighting back', why: `When you were clearly worse, you still saved ${pct(p.saved)} of ${p.downs} games.` });
  if (p.blunders !== null && p.analysed >= 10) add(p.blunders <= 0.4, p.blunders >= 1,
    { title: 'Avoiding blunders', why: `${p.blunders.toFixed(1)} blunders a game in your ${p.analysed} games with computer analysis${p.blunders >= 1 ? `, most in the ${worstPhase(p)}` : ''}.`, href: './mistakes.html' });
  if (p.analysed >= 10) add(p.badStarts <= 0.1, p.badStarts >= 0.25,
    { title: 'Getting out of the opening', why: `After move 12 you were worse by 1.5 pawns or more in ${pct(p.badStarts)} of your analysed games.`, href: './' });
  if (p.endgames >= 10) add(p.endgameScore >= p.score + 0.07, p.endgameScore <= p.score - 0.07,
    { title: 'Endgames', why: `You score ${pct(p.endgameScore)} in games that reach an endgame, against ${pct(p.score)} overall.`, href: './basics.html' });
  if (p.timeLosses >= 0.2) work.push({ title: 'The clock', why: `${pct(p.timeLosses)} of your losses are on time. Move faster in the opening, which you know.` });
  else if (p.lowTime <= 0.1 && p.n >= 30) good.push({ title: 'Using your time', why: `You are rarely short of time: ${pct(p.lowTime)} of games end with under a tenth left.` });
  if (p.quickLosses >= 0.3) work.push({ title: 'Early collapses', why: `${pct(p.quickLosses)} of your losses are over within 25 moves. Look at every check and capture your opponent has before you move.`, href: './mistakes.html' });
  const ops = [...p.openings.w.map((o) => ({ ...o, side: 'White' })), ...p.openings.b.map((o) => ({ ...o, side: 'Black' }))].filter((o) => o.n >= 8);
  const weight = (o) => (o.score - 0.5) * Math.sqrt(o.n); // a clear result over many games beats an extreme over few
  const top = [...ops].sort((a, b) => weight(b) - weight(a))[0], low = [...ops].sort((a, b) => weight(a) - weight(b))[0];
  if (top && top.score >= 0.6) good.push({ title: top.fam, why: `You score ${pct(top.score)} in ${top.n} games with it as ${top.side}.` });
  if (low && low !== top && low.score <= 0.4) work.push({ title: low.fam, why: `You score ${pct(low.score)} in ${low.n} games with it as ${low.side}. Practise its lines.`, href: './' });
  return [good.slice(0, 4), work.slice(0, 4)];
}
// Skill bars, 0-100, each read from one thing in the games; null when there are too few games to say.
// The scales are rules of thumb (50 is a so-so result), not a comparison with other players.
const clamp = (x) => Math.round(Math.max(0, Math.min(100, x)));
function skillsOf(p) {
  return [
    { label: 'Openings', v: p.analysed >= 10 ? clamp(100 - p.badStarts * 250) : null,
      means: 'Whether you come out of the first 12 moves with a playable position.',
      why: `Worse by 1.5 pawns or more after move 12 in ${pct(p.badStarts)} of analysed games.`,
      train: 'Practise the lines of the openings you play, and learn the plan behind them, not just the moves.', href: './' },
    { label: 'Tactics', v: p.analysed >= 10 && p.blunders !== null ? clamp(100 - p.blunders * 30) : null,
      means: 'Seeing threats and shots: how often you blunder, that is make a move that throws away a piece or the game.',
      why: `${(p.blunders ?? 0).toFixed(1)} blunders a game.`,
      train: 'Before every move, check every check, capture and threat your opponent has after it. Then solve the positions where you blundered.', href: './mistakes.html' },
    { label: 'Finishing won games', v: p.ups >= 5 ? clamp(((p.converted - 0.4) / 0.55) * 100) : null,
      means: 'Turning a clearly winning position (3 pawns or more ahead) into a win.',
      why: `Won ${pct(p.converted ?? 0)} of ${p.ups} games where you were clearly better.`,
      train: 'When ahead: trade pieces, not pawns, take away their counterplay first, and do not rush.', href: './basics.html' },
    { label: 'Defending', v: p.downs >= 5 ? clamp((p.saved / 0.6) * 100) : null,
      means: 'Saving clearly lost positions: still winning or drawing them.',
      why: `Saved ${pct(p.saved ?? 0)} of ${p.downs} games where you were clearly worse.`,
      train: 'When behind: keep pieces on, make threats, and set traps rather than waiting.' },
    { label: 'Endgames', v: p.endgames >= 10 ? clamp(50 + (p.endgameScore - p.score) * 300) : null,
      means: 'How you do once most pieces are gone (6 or fewer pieces besides kings and pawns), against your games overall.',
      why: `Score ${pct(p.endgameScore ?? 0)} in endgames against ${pct(p.score)} overall.`,
      train: 'Learn the basic endgames: king activity, passed pawns, and the key king-and-pawn positions.', href: './basics.html' },
    { label: 'Clock', v: p.n >= 30 ? clamp(100 - p.lowTime * 150 - p.timeLosses * 100) : null,
      means: 'Using your time well: not ending up short of time or losing on the clock.',
      why: `Short of time in ${pct(p.lowTime)} of games; ${pct(p.timeLosses)} of losses on time.`,
      train: 'Play the opening fast (you know it), and save your thinking time for the critical moments.' },
  ];
}
console.assert(skillsOf({ analysed: 20, badStarts: 0.1, blunders: 1, ups: 0, downs: 0, endgames: 0, n: 10 }).map((x) => x.v).slice(0, 3).join() === '75,70,', 'skillsOf');
const worstPhase = (p) => Object.entries(p.slips).sort((a, b) => b[1] - a[1])[0][0];
{
  const g = (o) => ({ side: 'w', speed: 'blitz', status: 'resign', plies: 60, result: 1, family: 'Italian Game', rating: 1500, diff: 5, castled: 8, queensOff: null, endgame: false, analysed: false, acc: null, blunders: null, best: null, worst: null, after12: null, slips: { opening: 0, middlegame: 0, endgame: 0 }, lowTime: false, ...o });
  const p = profileOf([g({}), g({ result: 0 }), g({ side: 'b', result: 0 }), g({ side: 'b', result: 0.5 })]);
  console.assert(p.score === 0.375 && p.white === 0.5 && p.type[0].name === 'Attacker', 'profileOf');
}

// ---------- Fetching ----------
async function fetchGames(name, onGame) {
  const a = account();
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(name)}?` + new URLSearchParams({
    max: MAX, rated: 'true', perfType: 'bullet,blitz,rapid,classical', moves: 'true', opening: 'true', clocks: 'true', evals: 'true', accuracy: 'true',
  }), { headers: { Accept: 'application/x-ndjson', ...(a ? { Authorization: `Bearer ${a.token}` } : {}) } });
  if (res.status === 404) throw new Error(`Lichess has no player called ${name}.`);
  if (res.status === 429) throw new Error('Lichess is busy right now. Try again in a minute.');
  if (!res.ok) throw new Error(`Lichess answered with an error (${res.status}).`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader(), games = [];
  let rest = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const lines = (rest + value).split('\n');
    rest = lines.pop();
    for (const l of lines) if (l.trim()) { games.push(JSON.parse(l)); onGame(games.length); }
  }
  if (rest.trim()) games.push(JSON.parse(rest));
  return games.filter((g) => g.variant === 'standard').slice(0, MAX);
}

async function build(name) {
  const msg = $('#profile-msg');
  msg.textContent = `Fetching ${name}'s last ${MAX} rated games from Lichess…`;
  const raw = await fetchGames(name, (k) => { msg.textContent = `Fetching ${name}'s games from Lichess… ${k}`; });
  if (!raw.length) throw new Error(`${name} has no rated games on Lichess yet.`);
  const me = name.toLowerCase(), games = [];
  for (let i = 0; i < raw.length; i++) {
    games.push(readGame(raw[i], me));
    if (i % 25 === 24) { msg.textContent = `Reading the games… ${i + 1} of ${raw.length}`; await new Promise((r) => setTimeout(r)); }
  }
  const p = profileOf(games);
  const keep = Object.entries(cache()).sort((a, b) => b[1].at - a[1].at).slice(0, 9);
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([[me, { name, at: Date.now(), p }], ...keep.filter(([k]) => k !== me)]))); } catch {}
  msg.textContent = '';
  return p;
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
  $('#pf-form').addEventListener('submit', (e) => { e.preventDefault(); show($('#pf-name').value.trim(), true); });
}
const bar = (s) => `<div class="wdl" role="img" aria-label="Score ${pct(s)}"><span class="w" style="width:${s * 100}%"></span><span class="l" style="width:${(1 - s) * 100}%"></span></div>`;
const ago = (t) => { const h = (Date.now() - t) / 3.6e6; return h < 1 ? 'less than an hour ago' : h < 48 ? `${Math.round(h)} hours ago` : `${Math.round(h / 24)} days ago`; };
function verdictList(items, empty) {
  return items.length ? `<ul class="pf-list">${items.map((i) => `<li><b>${esc(i.title)}</b><span>${esc(i.why)}${i.href ? ` <a href="${i.href}">Train it</a>` : ''}</span></li>`).join('')}</ul>` : `<p class="info">${empty}</p>`;
}
function openingRows(list) {
  return list.length ? `<ul class="pf-rows">${list.slice(0, 6).map((o) => `<li><span>${esc(o.fam)}</span><small>${o.n} games · ${pct(o.score)}</small>${bar(o.score)}</li>`).join('')}</ul>` : '<p class="info">Fewer than 5 games with any one opening.</p>';
}
const article = (w) => (/^[AEIOU]/.test(w) ? 'an' : 'a');
function diploma(name, at, p, t, say) {
  const known = skillsOf(p).filter((x) => x.v !== null).sort((a, b) => b.v - a.v);
  const date = new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<section class="pf-diploma pf-type" aria-label="Player type">
    <p class="pf-dip-kicker">Chess Trainer · Certificate of play style</p>
    <p class="pf-dip-lead">This certifies that</p>
    <p class="pf-dip-player">${esc(name)}</p>
    <p class="pf-dip-lead">plays as ${article(t[0].name)}</p>
    <p class="pf-name">${t.map((x) => esc(x.name)).join(' · ')}</p>
    <ul class="pf-why">${t.map((x) => `<li><b>${esc(x.name)}.</b> ${esc(TYPE_ABOUT[x.name] || '')} <span>${esc(say(x.why))}</span></li>`).join('')}</ul>
    ${known.length >= 2 ? `<p class="pf-dip-best">Strongest: <b>${known[0].label}</b> · To train: <b>${known[known.length - 1].label}</b></p>` : ''}
    <div class="pf-dip-foot">
      <span>From ${p.n} rated Lichess games<br>${date}</span>
      <svg class="pf-seal" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="36"/><circle cx="40" cy="40" r="29"/><text x="40" y="54" text-anchor="middle">♞</text></svg>
    </div>
  </section>`;
}
// Each bar: what it measures, what the games show, and below 50 how to train it.
function skillBars(skills, say, me) {
  return `<ul class="pf-skills">${skills.map((x) => `<li${x.v === null ? ' class="pf-skill-none"' : ''}>
      <span class="pf-skill-name">${x.label}</span><span class="pf-skill-val">${x.v ?? '–'}</span>
      <div class="pf-meter" role="img" aria-label="${x.label}: ${x.v === null ? 'not enough games' : `${x.v} of 100`}"><i style="width:${x.v ?? 0}%"></i></div>
      <p class="pf-means">${esc(x.means)}</p>
      <small>${x.v === null ? 'Not enough games to say.' : esc(say(x.why))}</small>
      ${x.v !== null && x.v < 50 ? `<p class="pf-train"><b>How to train:</b> ${esc(x.train)}${me && x.href ? ` <a href="${x.href}">Start</a>` : ''}</p>` : ''}</li>`).join('')}</ul>`;
}
function render(name, at, p) {
  const t = p.type, me = isMe(name), say = me ? (x) => x : they;
  const list = (items, empty) => verdictList(items.map((i) => ({ ...i, why: say(i.why), href: me ? i.href : null })), empty);
  $('#profile').innerHTML = `
    <div class="pf-head">
      <div><h1>${esc(name)}</h1>
        <p class="info">${me ? 'Your profile, from your' : `From ${esc(name)}'s`} last ${p.n} rated Lichess games${p.analysed ? `, ${p.analysed} of them with computer analysis` : ''}. Updated ${ago(at)}.</p></div>
      <button id="refresh" class="ghost" type="button">Refresh</button>
    </div>
    ${search('Look up a player')}
    ${diploma(name, at, p, t, say)}
    <section class="pf-card">
      <h2>${me ? 'Your skills' : `${esc(name)}'s skills`}</h2>
      <p class="info pf-note">Each bar is read from one thing in the games. 50 is a so-so result.</p>
      ${skillBars(skillsOf(p), say, me)}
    </section>
    <div class="pf-two">
      <section class="pf-card"><h2>Good at</h2>${list(p.good, 'Nothing stands out yet. More games give a clearer picture.')}</section>
      <section class="pf-card"><h2>Work on</h2>${list(p.work, 'Nothing stands out as a weakness in these games.')}</section>
    </div>
    <section class="pf-card">
      <h2>Results</h2>
      <dl class="pf-stats">
        <div><dt>Score</dt><dd>${pct(p.score)}</dd></div>
        <div><dt>As White</dt><dd>${p.white === null ? '–' : pct(p.white)}</dd></div>
        <div><dt>As Black</dt><dd>${p.black === null ? '–' : pct(p.black)}</dd></div>
        <div><dt>Draws</dt><dd>${pct(p.draws)}</dd></div>
        <div><dt>Moves a game</dt><dd>${p.moves}</dd></div>
        ${p.acc !== null ? `<div><dt>Accuracy</dt><dd>${p.acc}%</dd></div>` : ''}
        ${p.blunders !== null ? `<div><dt>Blunders a game</dt><dd>${p.blunders.toFixed(1)}</dd></div>` : ''}
      </dl>
      <h3>By time control</h3>
      <ul class="pf-rows">${p.speeds.map((s) => `<li><span>${s.speed[0].toUpperCase() + s.speed.slice(1)}</span><small>${s.n} games · ${pct(s.score)} · now ${s.rating} (${s.change >= 0 ? '+' : ''}${s.change})</small>${bar(s.score)}</li>`).join('')}</ul>
      <h3>How ${me ? 'your' : 'their'} games end</h3>
      <p class="info">Wins: ${pct(p.ends.won.mate)} by mate, ${pct(p.ends.won.resign)} resigned, ${pct(p.ends.won.time)} on time.
        Losses: ${pct(p.ends.lost.mate)} by mate, ${pct(p.ends.lost.resign)} resigned, ${pct(p.ends.lost.time)} on time.</p>
    </section>
    <div class="pf-two">
      <section class="pf-card"><h2>Openings as White</h2>${openingRows(p.openings.w)}</section>
      <section class="pf-card"><h2>Openings as Black</h2>${openingRows(p.openings.b)}</section>
    </div>
    <p class="info">The style labels and thresholds are rules of thumb, not a rating. Score counts a win as 1 and a draw as a half.</p>`;
  $('#refresh').addEventListener('click', () => run(name));
  bindSearch();
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
  try { const p = await build(name); if (mine === runs) render(name, Date.now(), p); } catch (err) { if (mine === runs) $('#profile-msg').textContent = err.message; }
}

try { await finishLogin(); } catch (err) { $('#profile-msg').textContent = err.message; } // back from logging in on this page
// A player's profile: from this browser when it was read before, else from their games. The address
// keeps the name (?u=), so a profile can be shared or bookmarked.
function show(name, push) {
  if (push) history.pushState(null, '', isMe(name) ? location.pathname : `?u=${encodeURIComponent(name)}`);
  const c = cache()[name.toLowerCase()];
  if (c) render(c.name, c.at, c.p); else run(name);
}
addEventListener('popstate', () => start());
function start() {
  const name = new URLSearchParams(location.search).get('u') || myName();
  if (name) show(name, false); else ask();
}
start();
