// One game, replayed here: the board with every move, how the advantage swung, the moves that
// decided it (yours and your opponent's mistakes, with the better move), and a short read of what
// went well and what went badly. The game comes from the games kept for the profile, or straight
// from Lichess. A game without analysis can be analysed here with Stockfish in a few seconds.
import { banner, confetti } from './celebrate.js?v=20261103143953';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard, enableDrag } from './board.js?v=20261103143953';
import { account, lichessAuth } from './lichess.js?v=20261103143953';
import { isCC, nick, ccGameUrl } from './chesscom.js?v=20261103143953';
import { gamesReady, storedGames, keepGame, engineEval, applyEvals, winPct, profileFromRaw, skillsOf, fineSkillsOf } from './profile.js?v=20261103143953';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const q = new URLSearchParams(location.search), name = q.get('u') || '', id = q.get('id') || '';
// Your own game speaks to you; anyone else's names the player.
const isMe = account()?.name?.toLowerCase() === name.toLowerCase(), who1 = esc(nick(name));
const P = isMe ? { You: 'You', you: 'you', your: 'your', Your: 'Your', were: 'were', they: 'you', their: 'your' } : { You: who1, you: who1, your: `${who1}'s`, Your: `${who1}'s`, were: 'was', they: 'they', their: 'their' };
const oppName = (cap) => (isMe ? `${cap ? 'Your' : 'your'} opponent` : esc(nick(g.players[side === 'white' ? 'black' : 'white'].user?.id || '') || `${cap ? 'Their' : 'their'} opponent`));
const RED = 'var(--bad)', GREEN = 'var(--good)';
const GLYPHS = { Inaccuracy: '?!', Mistake: '?', Blunder: '??' };
const HOW = { mate: 'by mate', resign: 'by resignation', outoftime: 'on time', timeout: 'on time', draw: 'by agreement', stalemate: 'by stalemate', insufficientMaterialClaim: 'by insufficient material', repetition: 'by repetition' };

let g = null, moves = [], fens = [], side = 'white', idx = 0, flip = false, focus = null, showBest = false;

async function load() {
  await gamesReady;
  g = [name, ...['bullet', 'blitz', 'rapid', 'classical'].map((sp) => `${name}~${sp}`)].map((k) => (storedGames(k) || []).find((x) => x.id === id)).find(Boolean); // the player's games, or a time control's own
  if (!g) {
    $('#profile-msg').textContent = 'Fetching the game from Lichess…';
    const res = await fetch(`https://lichess.org/game/export/${encodeURIComponent(id)}?` + new URLSearchParams({ evals: 'true', clocks: 'true', opening: 'true', accuracy: 'true' }),
      { headers: { Accept: 'application/json', ...lichessAuth() } });
    if (!res.ok) throw new Error(`Lichess has no game ${id}.`);
    g = await res.json();
    $('#profile-msg').textContent = '';
  }
  side = g.players.white.user?.id === name.toLowerCase() ? 'white' : g.players.black.user?.id === name.toLowerCase() ? 'black' : 'white';
  const c = new Chess();
  fens = [c.fen()];
  moves = [];
  for (const san of (g.moves || '').split(' ').filter(Boolean)) {
    let m;
    try { m = c.move(san); } catch { break; }
    moves.push(m);
    fens.push(c.fen());
  }
  idx = moves.length;
}

// ---------- Reading the analysis ----------
const pov = () => (side === 'white' ? 1 : -1);
const cpAt = (i) => { const a = g.analysis?.[i]; return a ? (a.mate !== undefined ? Math.sign(a.mate) * 1000 : Math.max(-1000, Math.min(1000, a.eval ?? 0))) : null; };
const chanceAt = (i) => (i < 0 ? 50 : winPct((cpAt(i) ?? 0) * pov())); // your winning chances after move i
const mine = (i) => (i % 2 === 0) === (side === 'white');
const moveNo = (i) => `${Math.floor(i / 2) + 1}${i % 2 ? '…' : '.'}`;
// Lichess writes castling as king takes rook; the board wants the king's square.
function bestMove(i) {
  let uci = g.analysis?.[i]?.best;
  if (!uci) return null;
  const castle = { e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8' }[uci.slice(0, 4)];
  const before = new Chess(fens[i]);
  if (castle && before.get(uci.slice(0, 2))?.type === 'k') uci = castle;
  try { return before.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' }); } catch { return null; }
}
// The moves that decided the game: every mistake and blunder, by either side.
function moments() {
  if (!g.analysis) return [];
  return moves.flatMap((m, i) => {
    const j = g.analysis[i]?.judgment?.name;
    if (j !== 'Mistake' && j !== 'Blunder') return [];
    const before = chanceAt(i - 1), after = chanceAt(i);
    return [{ i, j, m, best: bestMove(i), mine: mine(i), swing: Math.round(mine(i) ? before - after : after - before) }];
  });
}
// Your answer to your opponent's mistake: punished when it gave nothing back (no inaccuracy or worse).
function answer(x) {
  const k = x.i + 1;
  if (x.mine || k >= moves.length) return '';
  const best = bestMove(k);
  return g.analysis[k]?.judgment
    ? `<span class="pf-bad">${P.You} missed it: ${best ? `<b>${best.san}</b> punished it, ` : ''}${P.they} played <b>${moves[k].san}</b></span>`
    : `<span class="pf-good">${P.You} punished it with <b>${moves[k].san}</b></span>`;
}

// What went well and what went badly, read from the result and the analysis.
function story() {
  const me = side, them = me === 'white' ? 'black' : 'white';
  const won = g.winner === me, lost = g.winner && g.winner !== me;
  const how = HOW[g.status] || g.status;
  const n = Math.ceil(moves.length / 2);
  const head = `${won ? `${P.You} won` : lost ? `${P.You} lost` : 'A draw'} ${how} in ${n} moves${g.opening?.name ? `, in the ${esc(g.opening.name.split(':')[0])}` : ''}.`;
  const good = [], bad = [];
  if (!g.analysis) return { head, good, bad, acc: null };
  const myA = g.players[me].analysis || {}, theirA = g.players[them].analysis || {};
  const after12 = moves.length > 23 ? (cpAt(23) ?? 0) * pov() : null;
  if (after12 !== null) {
    if (after12 >= 100) good.push(`${P.You} came out of the opening better (${(after12 / 100).toFixed(1)} pawns up after move 12).`);
    else if (after12 <= -100) bad.push(`${P.You} came out of the opening worse (${(-after12 / 100).toFixed(1)} pawns down after move 12)${isMe ? ': look at the opening again' : ''}.`);
    else good.push('The opening went fine: about equal after move 12.');
  }
  const chances = moves.map((_, i) => chanceAt(i));
  const best = Math.max(...chances), worst = Math.min(...chances);
  if (best >= 85 && !won) bad.push(`${P.You} had a winning position (${Math.round(best)}% winning chances) but did not win it.`);
  if (best >= 85 && won) good.push(`${P.You} got a winning position and converted it.`);
  if (worst <= 15 && !lost) good.push(`${P.You} ${P.were} lost (${Math.round(worst)}%) and still ${won ? 'won' : 'saved a draw'}: good fighting.`);
  if (!myA.blunder) good.push(`No blunders from ${P.you}.`);
  else bad.push(`${myA.blunder} blunder${myA.blunder > 1 ? 's' : ''} from ${P.you}${myA.mistake ? ` and ${myA.mistake} mistake${myA.mistake > 1 ? 's' : ''}` : ''}. They are in the list below.`);
  const theirBlunders = moments().filter((x) => !x.mine && x.j === 'Blunder');
  if (theirBlunders.length) {
    const punished = theirBlunders.filter((x) => !moments().some((y) => y.mine && y.i === x.i + 1));
    if (punished.length === theirBlunders.length) good.push(`${oppName(true)} blundered ${theirBlunders.length === 1 ? 'once' : `${theirBlunders.length} times`} and ${P.you} made them pay.`);
    else bad.push(`${oppName(true)} blundered and ${P.you} missed the chance on the next move.`);
  }
  if (lost && /outoftime|timeout/.test(g.status)) bad.push(isMe ? 'You lost on time: play the opening faster to keep time for the hard moments.' : `${P.You} lost on time.`);
  const swing = moments().filter((x) => x.mine).sort((a, b) => b.swing - a.swing)[0];
  if (swing && swing.swing >= 20) bad.push(`The turning point: ${moveNo(swing.i)} ${swing.m.san} cost ${swing.swing}% of ${P.your} winning chances${swing.best ? `; ${swing.best.san} was better` : ''}.`);
  return { head, good, bad, acc: myA.accuracy != null ? [myA.accuracy, theirA.accuracy] : null };
}

// ---------- Drawing ----------
// The badge on the moved piece, as in the trainer: blunder, mistake, inaccuracy from the analysis,
// best when it was the engine's own move, good otherwise; none without analysis.
function kindOf(i) {
  const j = g.analysis?.[i]?.judgment?.name;
  if (j) return j.toLowerCase();
  if (!g.analysis?.[i]) return null;
  const b = i > 0 ? g.analysis[i]?.best : null, m = moves[i];
  return b && b.slice(0, 4) === m.from + m.to ? 'best' : 'good';
}
// Who is who: the player of each colour beside the board, the one at the bottom below it.
function players(bottom) {
  const strip = (c) => {
    const pl = g.players[c === 'w' ? 'white' : 'black'], you = (c === 'w') === (side === 'white');
    return `<img src="pieces/${c}K.svg" alt=""><b>${esc(nick(pl.user?.id || 'anonymous'))}</b> <span>${pl.rating || ''}</span> <small>${c === 'w' ? 'White' : 'Black'}${you && name && !q.get('play') ? (isMe ? ' · you' : '') : ''}</small>`;
  };
  $('#top-player').innerHTML = strip(bottom === 'w' ? 'b' : 'w');
  $('#bottom-player').innerHTML = strip(bottom);
}
// The eval bar beside the board: White's winning chances after the move shown, filled from the side at the
// bottom, with Stockfish's number (pawns, or M and the moves to mate) at the end of the side ahead.
function evalBar(bottom) {
  const el = $('#gm-eval'), i = idx - 1, a = g.analysis?.[i];
  el.hidden = !g.analysis || tryOut;
  if (el.hidden) return;
  const cp = i < 0 ? 0 : cpAt(i) ?? 0, white = winPct(cp), up = bottom === 'w' ? white : 100 - white;
  const text = a?.mate !== undefined ? `M${Math.abs(a.mate)}` : (Math.abs(cp) / 100).toFixed(1);
  el.querySelector('i').style.height = `${up}%`;
  el.querySelector('span').textContent = text;
  el.classList.toggle('low', up >= 50); // the number sits at the end of the side ahead
  el.classList.toggle('bw', bottom === 'b'); // black at the bottom: the dark part fills from below
  el.setAttribute('aria-label', `Evaluation: ${cp >= 0 ? 'White' : 'Black'} ${text}`);
}
function drawPosition() {
  if (tryOut) return drawTry();
  $('#board').classList.remove('looking-back');
  const c = new Chess(fens[idx]);
  const arrows = [];
  let last = idx ? { from: moves[idx - 1].from, to: moves[idx - 1].to } : null;
  if (lesson && idx === lesson.at) { // the lesson's stop: their move in green, the one you usually play in red
    if (lesson.yours) arrows.push([lesson.yours.from, lesson.yours.to, RED]);
    if (lesson.theirs) arrows.push([lesson.theirs.from, lesson.theirs.to, GREEN]);
    last = null;
  } else if (focus !== null && idx === focus) { // a key moment: the move played in red, the better one in green
    const m = moves[focus], b = bestMove(focus);
    if (!b || b.san !== m.san) arrows.push([m.from, m.to, RED]);
    if (b) arrows.push([b.from, b.to, GREEN]);
    last = null;
  } else if (showBest && idx < moves.length && bestMove(idx)) { const b = bestMove(idx); arrows.push([b.from, b.to, GREEN]); }
  const bottom = (side === 'white') !== flip ? 'w' : 'b';
  drawBoard($('#board'), c, { side: bottom, last, arrows, mark: focus === null && idx && kindOf(idx - 1) ? { sq: moves[idx - 1].to, kind: kindOf(idx - 1) } : null });
  players(bottom);
  evalBar(bottom);
  const i = idx - 1, j = g.analysis?.[i]?.judgment?.name;
  const fb = focus !== null && idx === focus ? bestMove(focus) : null;
  $('#here').innerHTML = focus !== null && idx === focus
    ? (fb && fb.san === moves[focus].san ? `${moveNo(focus)} <b>${fb.san}</b> was played here (green), the best move.` : `${moveNo(focus)} <b>${moves[focus].san}</b> was played here (red)${fb ? `; <b>${fb.san}</b> (green) was better` : ''}.`)
    : showBest && idx < moves.length ? (bestMove(idx) ? `Best move here: <b>${bestMove(idx).san}</b> (green). ${moveNo(idx)} <b>${moves[idx].san}</b> was played.` : 'No best move kept for this position.')
    : idx ? `${moveNo(i)} <b>${moves[i].san}</b>${j ? ` <span class="gm-j j-${j}">${GLYPHS[j]} ${j.toLowerCase()}</span>` : ''}${g.analysis ? ` · ${P.your} chances ${Math.round(chanceAt(i))}%` : ''}` : 'The start position.';
  document.querySelectorAll('.gm-move').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === idx - 1));
  const cur = document.querySelector('.gm-move.on');
  // Keep the current move in view inside the move list only, never scrolling the page
  const list = cur?.closest('ol');
  if (list) list.scrollTop = cur.offsetTop - list.offsetTop - list.clientHeight / 2;
  const dot = document.querySelector('.gm-graph .now');
  if (dot) dot.setAttribute('x1', gx(idx - 1)), dot.setAttribute('x2', gx(idx - 1));
}
const W = 300, H = 70;
const gx = (i) => (moves.length ? (Math.max(0, i + 1) / moves.length) * W : 0);
function graph() {
  if (!g.analysis) return '';
  const pts = [[0, 50], ...moves.map((_, i) => [gx(i), chanceAt(i)])];
  const yy = (c) => H - (c / 100) * H;
  const line = pts.map(([x, c], k) => `${k ? 'L' : 'M'}${x.toFixed(1)},${yy(c).toFixed(1)}`).join('');
  const area = `${line}L${W},${H}L0,${H}Z`;
  // The slips as dots, in the move list's colours: red blunders, orange mistakes, yellow inaccuracies;
  // yours filled, your opponent's as rings.
  const dots = moves.map((_, i) => [i, g.analysis[i]?.judgment?.name]).filter(([, j]) => j)
    .map(([i, j]) => `<circle class="${j}${mine(i) ? '' : ' theirs'}" cx="${gx(i).toFixed(1)}" cy="${yy(chanceAt(i)).toFixed(1)}" r="${j === 'Inaccuracy' ? 2.5 : 3}"/>`).join('');
  return `<figure class="gm-graph"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${P.Your} winning chances move by move">
      <path class="area" d="${area}"/><line class="mid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/><path class="ln" d="${line}"/>${dots}
      <line class="now" x1="0" x2="0" y1="0" y2="${H}"/><rect class="hit" width="${W}" height="${H}"/></svg>
    <figcaption>${P.Your} winning chances, move by move. Above the middle line ${P.you} ${P.were} better. The dots are the slips: red blunders, orange mistakes, yellow inaccuracies. Filled are ${isMe ? 'yours' : `${P.your}`}, rings ${oppName()}'s.</figcaption></figure>`;
}
// A player's name as a link to their profile here (anonymous players have none).
function who(colour, fallback = 'anonymous') {
  const id = g.players[colour].user?.id;
  return id ? `<a class="gm-who" href="profile.html?u=${encodeURIComponent(id)}" title="${esc(nick(id))}'s profile">${esc(nick(id))}</a>` : esc(fallback);
}
function render() {
  const s = story(), me = g.players[side], opp = g.players[side === 'white' ? 'black' : 'white'];
  const list = moments();
  const pairs = [];
  for (let i = 0; i < moves.length; i += 2) pairs.push(i);
  $('#game').innerHTML = `
    <h1 class="gm-title">${who('white', 'White')} <span>vs</span> ${who('black', 'Black')}</h1>
    <p class="gm-sides"><span><img src="pieces/wK.svg" alt="">White: <b>${who('white')}</b> ${g.players.white.rating || ''}</span>
      <span><img src="pieces/bK.svg" alt="">Black: <b>${who('black')}</b> ${g.players.black.rating || ''}</span></p>
    <p class="info">${P.You} played ${esc(side)} · ${g.speed} · ${new Date(g.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · <a href="${isCC(name) ? ccGameUrl(g.id) : `https://lichess.org/${g.id}${side === 'black' ? '/black' : ''}`}" target="_blank" rel="noopener">On ${isCC(name) ? 'Chess.com' : 'Lichess'}</a></p>
    <section class="gm-impact" id="gm-impact"></section>
    <section class="gm-story">
      <p class="gm-head">${s.head}</p>
      ${s.acc ? `<p class="gm-acc">Accuracy: <b>${s.acc[0]}%</b> ${P.you}, <b>${s.acc[1] ?? '–'}%</b> ${oppName()}</p>` : ''}
      ${g.analysis ? `${s.good.length ? `<h2 class="pf-good">What went well</h2><ul>${s.good.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
        ${s.bad.length ? `<h2 class="pf-bad">What went badly</h2><ul>${s.bad.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}`
      : `<p class="gm-noan">This game has no computer analysis yet, so there is no read on what went well or badly. <button type="button" class="cta" data-analyse>Analyse it now</button> <small>About ${Math.max(2, Math.round(moves.length * 0.035))} seconds, with Stockfish in your browser.</small></p>`}
    </section>
    ${graph()}
    ${list.length ? `<section class="gm-moments"><h2>The moves that decided it</h2><ul>${list.map((x) => `<li><button type="button" class="gm-moment ${x.mine ? 'mine' : 'theirs'} side-${x.i % 2 ? 'b' : 'w'}" title="Played by ${x.i % 2 ? 'Black' : 'White'}" data-moment="${x.i}">
      <span class="gm-j j-${x.j}">${GLYPHS[x.j]}</span><span><b>${moveNo(x.i)} ${x.m.san}</b> ${x.mine ? `by ${P.you}` : `by ${oppName()}`}${x.best ? `: <b>${x.best.san}</b> was better` : ''}<br><small>${x.mine ? `cost ${P.you} ${x.swing}% of ${P.their} winning chances` : `gave ${P.you} ${x.swing}%`}</small>${answer(x) ? `<br><small>${answer(x)}</small>` : ''}</span></button></li>`).join('')}</ul></section>` : ''}
    <section class="gm-moves"><h2>Moves</h2><ol>${pairs.map((i) => `<li><span class="n">${i / 2 + 1}.</span>${[i, i + 1].filter((k) => k < moves.length).map((k) => {
      const j = g.analysis?.[k]?.judgment?.name;
      return `<button type="button" class="gm-move${j ? ` j-${j}` : ''}" data-i="${k}">${moves[k].san}${j ? GLYPHS[j] : ''}</button>`;
    }).join('')}</li>`).join('')}</ol></section>`;
  $('#game').querySelectorAll('.gm-move').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.i) + 1)));
  $('#game').querySelectorAll('[data-moment]').forEach((b) => b.addEventListener('click', () => {
    focus = idx = Number(b.dataset.moment); tryOut = null; drawPosition(); // yours or theirs: the move played in red, the better one in green
  }));
  const bb = $('#best');
  bb.hidden = !g.analysis;
  $('#game').querySelector('[data-analyse]')?.addEventListener('click', analyse);
  const svg = $('#game').querySelector('.gm-graph svg');
  svg?.addEventListener('click', (e) => { const r = svg.getBoundingClientRect(); go(Math.round(((e.clientX - r.left) / r.width) * moves.length)); });
  drawPosition();
  impact();
}
// How this game affected your stats: the card read from your games in this time control with and
// without it, skill by skill (only what changed), and the style if it changed.
async function impact() {
  await gamesReady;
  // The games the profile card of this time control reads: its own last 500 when fetched, the analyses of
  // the player's games laid over them, so the "now" numbers match the card.
  const mixed = storedGames(name) || [], own = storedGames(`${name}~${g.speed}`), done = new Map(mixed.filter((x) => x.analysis).map((x) => [x.id, x]));
  const newer = own ? mixed.filter((x) => x.speed === g.speed && x.createdAt > (own[0]?.createdAt || 0)) : []; // played since, as the card has them
  const el = $('#gm-impact'), all = own ? [...newer, ...own].slice(0, 500).map((x) => (x.id === g.id ? g : (!x.analysis && done.get(x.id)) || x)) : mixed.filter((x) => x.speed === g.speed);
  // Only once the game is analysed: without it, only the result and the clock count, and the analysis
  // would then move the numbers again.
  if (!el || !g.analysis || !all.some((x) => x.id === g.id) || all.length < 50) return;
  el.innerHTML = `<p class="info">Working out how this game affected ${P.your} stats…</p>`;
  const [withIt, without] = await Promise.all([profileFromRaw(name, all), profileFromRaw(name, all.filter((x) => x.id !== g.id))]);
  const a = fineSkillsOf(withIt), b = fineSkillsOf(without, withIt), card = skillsOf(withIt); // card: the numbers the profile card shows
  const known = (xs) => xs.filter((x) => x.v !== null), ovr = (xs) => (known(xs).length ? known(xs).reduce((t, x) => t + x.v, 0) / known(xs).length : null);
  // One game moves a skill by a fraction of a point, so unrounded and shown to one decimal: the card's
  // own numbers (your rating sets the card's level, so a won or lost game lifts or lowers them all).
  const tenth = (d) => Math.round(d * 10) / 10;
  const moved = a.map((x, i) => ({ label: x.label, now: card[i].v, d: x.v !== null && b[i].v !== null ? tenth(x.v - b[i].v) : 0 })).filter((x) => x.now !== null);
  // Overall over the skills known both with and without the game, so a skill that only one of them has
  // (it unlocks or locks with this game) does not swing it against the skills shown.
  const both = a.map((x, i) => i).filter((i) => a[i].v !== null && b[i].v !== null);
  const dOvr = both.length ? tenth(both.reduce((t, i) => t + a[i].v - b[i].v, 0) / both.length) : 0, style = withIt.type?.[0]?.name, was = without.type?.[0]?.name;
  const sign = (d) => (d > 0 ? `+${d}` : d < 0 ? `${d}`.replace('-', '−') : '±0');
  const way = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : 'same');
  el.innerHTML = `<h2>How this game affected ${P.your} ${g.speed} stats</h2>
    ${moved.length ? `<ul class="gm-moves-card">${ovr(a) !== null ? `<li class="${way(dOvr)}"><b>${sign(dOvr)}</b> overall <small>now ${Math.round(ovr(card))}</small></li>` : ''}
      ${moved.map((x) => `<li class="${way(x.d)}"><b>${sign(x.d)}</b> ${x.label} <small>now ${x.now}</small></li>`).join('')}</ul>`
      : `<p class="info">This game hardly moved ${P.your} stats: under a tenth of a point each.</p>`}
    ${style && was && style !== was ? `<p>It changed ${P.your} style: <b>${esc(was)}</b> → <b>${esc(style)}</b>.</p>` : ''}`;
}
function go(n) { focus = null; tryOut = null; idx = Math.max(0, Math.min(moves.length, n)); drawPosition(); }

async function analyse() {
  window.track?.('analyse', `${name}: game ${g.id}`); // a profile's run says until N instead
  const btn = $('[data-analyse]');
  btn.disabled = true;
  const c = new Chess(), cps = [], best = [];
  for (let k = 0; k < moves.length; k++) {
    c.move(moves[k].san);
    const r = await engineEval(c.fen());
    cps.push(r.cp);
    best[cps.length] = r.best;
    btn.textContent = `Analysing… ${Math.round(((k + 1) / moves.length) * 100)}%`;
  }
  applyEvals(g, cps, best);
  keepGame(name, g);
  render();
}

// Play from here, as on Lichess: from the position on the board you play on against Maia at your
// rating (the side to move is yours), say from just before a blunder, to try the other move.
let tryOut = null;
const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('slow')), ms))]);
function startTry() {
  const c = new Chess(fens[idx]), me = c.turn(), pl = g.players[me === 'w' ? 'white' : 'black'];
  const bottom = (side === 'white') !== flip ? 'w' : 'b'; // the board stays turned as it was
  tryOut = { c, me, bottom, rating: Math.round(pl.rating || 1500), from: idx, sel: null, last: idx ? { from: moves[idx - 1].from, to: moves[idx - 1].to } : null, busy: false, view: null };
  focus = null;
  drawPosition();
}
// view: how many of your moves on the board shows while you step back with the arrows; null is now.
function tryBoard(t) {
  if (t.view === null) return { b: t.c, last: t.last };
  const b = new Chess(fens[t.from]), h = t.c.history({ verbose: true }).slice(0, t.view);
  h.forEach((m) => b.move(m.san));
  const l = h.at(-1);
  return { b, last: l ? { from: l.from, to: l.to } : t.view === 0 ? (t.from ? { from: moves[t.from - 1].from, to: moves[t.from - 1].to } : null) : null };
}
function stepTry(n) {
  const t = tryOut, len = t.c.history().length, v = Math.max(0, Math.min(len, n));
  t.view = v === len ? null : v; t.sel = null; drawTry();
}
function drawTry() {
  const t = tryOut, c = t.c, bottom = t.bottom, { b, last } = tryBoard(t);
  drawBoard($('#board'), b, { side: bottom, sel: t.sel, last });
  $('#board').classList.toggle('looking-back', t.view !== null);
  players(bottom);
  const end = c.isCheckmate() ? (c.turn() === t.me ? 'Checkmate: Maia wins.' : 'Checkmate! You win.') : c.isDraw() ? 'A draw.' : '';
  $('#here').innerHTML = `${end || (t.view !== null ? 'Looking back at your moves. A move here plays on from this position; → goes forward again.' : t.busy ? `Maia ${t.rating} is thinking…` : `Your move. You play on from ${t.from ? `after ${moveNo(t.from - 1)} ${moves[t.from - 1].san}` : 'the start'} against Maia at ${t.rating}.`)}
    <span class="gm-try-btns"><button type="button" class="ghost" id="try-undo"${c.history().length ? '' : ' disabled'}>Take back</button><button type="button" class="ghost" id="try-back">Back to the game</button></span>`;
  $('#try-back').onclick = () => go(t.from);
  $('#try-undo').onclick = () => { if (t.busy) return; t.view = null; c.undo(); if (c.turn() !== t.me) c.undo(); t.sel = null; const h = c.history({ verbose: true }).at(-1); t.last = h ? { from: h.from, to: h.to } : null; drawTry(); };
}
function ended(t) {
  if (t.c.isCheckmate()) t.c.turn() === t.me ? banner('Checkmated', 'lost') : (banner('Checkmate!'), confetti(110));
  else if (t.c.isDraw()) banner('Draw', 'draw');
}
async function tryMove(from, to) {
  const t = tryOut;
  if (!t || t.busy) return false;
  if (t.view !== null) { const len = t.c.history().length; for (let k = t.view; k < len; k++) t.c.undo(); t.view = null; } // play on from where you stepped back to
  if (t.c.turn() !== t.me) return false;
  let m;
  try { m = t.c.move({ from, to, promotion: 'q' }); } catch { return false; }
  t.sel = null; t.last = { from: m.from, to: m.to };
  if (t.c.isGameOver()) return drawTry(), ended(t), true;
  t.busy = true; drawTry();
  const legal = t.c.moves({ verbose: true });
  const { maia3Move } = await import('./maia3.js?v=20261103143953'), { maiaMove, MAIA_MAX } = await import('./maia.js?v=20261103143953'); // loaded on the first move only: the nets are big
  let r = null;
  try { r = (await within(20000, maia3Move(t.c.fen(), legal, t.rating, t.rating))).move; } catch (e) { console.warn(e); }
  if (!r && t.rating < MAIA_MAX + 100) try { r = (await within(15000, maiaMove(t.rating, [t.c.fen()], legal))).move; } catch (e) { console.warn(e); }
  if (tryOut !== t) return true; // left while Maia thought
  if (!r) { const e = await engineEval(t.c.fen()); r = e.best && { from: e.best.slice(0, 2), to: e.best.slice(2, 4), promotion: e.best[4] }; }
  t.busy = false;
  if (r) { const a = t.c.move({ from: r.from, to: r.to, promotion: r.promotion || 'q' }); t.last = { from: a.from, to: a.to }; }
  drawTry(); ended(t);
  return true;
}
// A piece of the side to move, picked up in the game itself, starts playing on from that position.
const shown = () => (tryOut ? tryBoard(tryOut).b : new Chess(fens[idx]));
const mover = (sq) => { const b = shown(), p = b.get(sq); return !timer && (!tryOut || !tryOut.busy) && p?.color === b.turn() && (!tryOut || b.turn() === tryOut.me); };
enableDrag($('#board'), {
  canDrag: mover,
  onDrop: (from, to) => { if (!tryOut) startTry(); tryMove(from, to).then((ok) => { if (!ok && tryOut) drawTry(); }); },
});
$('#board').addEventListener('click', (e) => {
  const b = e.target.closest('.sq');
  if (!b || timer) return;
  const sq = b.dataset.sq;
  if (!tryOut) { if (!mover(sq)) return; startTry(); }
  const t = tryOut;
  if (t.busy) return;
  const here = tryBoard(t).b;
  if (t.sel && t.sel !== sq && here.moves({ square: t.sel, verbose: true }).some((m) => m.to === sq)) return void tryMove(t.sel, sq);
  t.sel = here.get(sq)?.color === t.me && here.turn() === t.me && t.sel !== sq ? sq : null;
  drawTry();
});
$('#try').addEventListener('click', startTry);
$('#first').addEventListener('click', () => go(0));
$('#prev').addEventListener('click', () => (tryOut ? stepTry((tryOut.view ?? tryOut.c.history().length) - 1) : go(idx - 1)));
$('#next').addEventListener('click', () => (tryOut ? stepTry((tryOut.view ?? tryOut.c.history().length) + 1) : go(idx + 1)));
$('#last').addEventListener('click', () => go(moves.length));
$('#flip').addEventListener('click', () => { flip = !flip; drawPosition(); });
$('#best').addEventListener('click', (e) => { showBest = !showBest; focus = null; e.currentTarget.setAttribute('aria-pressed', showBest); e.currentTarget.textContent = showBest ? 'Hide best move' : 'Show best move'; drawPosition(); });
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if (tryOut && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) $(e.key === 'ArrowLeft' ? '#prev' : '#next').click();
  else if (e.key === 'ArrowLeft') go(idx - 1);
  else if (e.key === 'ArrowRight') go(idx + 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(moves.length);
});

// A lesson from "A player to learn from": ?play=1&at=<ply>&note=…&mine=<your usual move>. The game plays
// itself a move a second and stops at the ply where you usually go wrong, the player's move in green and
// yours in red, with the note; Play on goes to the end. Any button press stops it.
let lesson = null, timer = null;
const stopPlay = () => { clearInterval(timer); timer = null; };
function playTo(end, then) {
  stopPlay();
  timer = setInterval(() => { if (idx >= end) { stopPlay(); then?.(); } else go(idx + 1); }, 1000);
}
function startLesson() {
  const at = Math.min(Number(q.get('at')) || moves.length, moves.length), mine = q.get('mine');
  const yours = mine && (() => { try { return new Chess(fens[at]).move(mine); } catch { return null; } })();
  lesson = { at, theirs: moves[at], yours };
  go(0);
  // Stockfish reads the game while it plays, so the stop can say which move holds up and the slips show.
  const analysed = g.analysis || !$('[data-analyse]') ? Promise.resolve() : analyse();
  const intro = (q.get('intro') || '').split('\n').filter(Boolean);
  document.querySelector('#here').insertAdjacentHTML('beforebegin', `<div class="gm-lesson" id="gm-lesson">${intro.length ? intro.map((t) => `<p>${esc(t)}</p>`).join('') : '<p><b>Watch:</b> the game plays itself and stops where it matters.</p>'}</div>`);
  const run = () => playTo(at, async () => {
    const el = $('#gm-lesson');
    el.innerHTML = `<p>${esc(q.get('note') || 'This is the moment to look at.')}</p><p class="gm-verdict">Stockfish is checking the moves…</p><button type="button" class="cta" id="gm-on">Play on</button>`;
    drawPosition();
    $('#gm-on').addEventListener('click', () => { el.remove(); lesson = null; playTo(moves.length); });
    await analysed;
    const v = await verdict(at, yours, moves[at]).catch(() => null);
    const out = el.querySelector('.gm-verdict');
    if (out) out.innerHTML = v || '';
  });
  if (!intro.length) return run();
  // First what to look for, in a box over the page; the game starts when it is closed.
  const d = document.createElement('dialog');
  d.className = 'gm-intro';
  d.innerHTML = `<h2>What to watch</h2>${intro.map((t) => `<p>${esc(t)}</p>`).join('')}<form method="dialog"><button class="cta">Start watching</button></form>`;
  document.body.append(d);
  d.addEventListener('close', () => { d.remove(); run(); });
  d.showModal();
}
// Your usual move against theirs at the lesson's stop, as winning chances for the side to move, and
// the answer that punishes yours: what makes one move better than the other.
async function verdict(at, yours, theirs) {
  const white = new Chess(fens[at]).turn() === 'w';
  const check = async (m) => {
    const c = new Chess(fens[at]); c.move(m.san);
    const r = await engineEval(c.fen());
    let reply = null;
    try { reply = r.best && c.move({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] }).san; } catch {}
    return { pct: Math.round(winPct(white ? r.cp : -r.cp)), reply };
  };
  const b = await check(theirs);
  const who = esc(nick(name));
  if (!yours || yours.san === theirs.san) return `Stockfish: after ${who}'s <b>${theirs.san}</b> the side to move here has <b>${b.pct}%</b> winning chances.`;
  const a = await check(yours), d = b.pct - a.pct;
  return `<span class="gm-vs"><span class="bad">Your usual <b>${yours.san}</b>: ${a.pct}% winning chances${a.reply ? `; the best answer to it is <b>${a.reply}</b>` : ''}.</span>
    <span class="good">${who}'s <b>${theirs.san}</b>: ${b.pct}%.</span></span>
    ${d >= 8 ? `That is the difference between you here: ${theirs.san} keeps ${d} percent more of the game. Next time you reach this, play ${theirs.san}.`
      : d <= -8 ? `Here your move is actually the stronger one. The difference is in what comes after: play on and watch how ${who} goes on.`
      : 'Both moves are about as good. The difference is in the plan that follows: play on and watch the next few moves.'}`;
}
document.querySelector('.controls')?.addEventListener('click', () => { if (timer) stopPlay(); }, true);

if (!name || !id) $('#profile-msg').innerHTML = 'Open a game from <a href="profile.html">your profile</a>.';
else load().then(render).then(() => { if (q.get('play')) startLesson(); }).catch((err) => { $('#profile-msg').textContent = err.message; });
