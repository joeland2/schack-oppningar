// Test my opening: a game against Maia 3 at your rating, then what the opening is called, where you went
// wrong and how it scores at your level. Nothing leaves the browser: the games are the site's own data files.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard, enableDrag, BOOK, GLYPH } from './board.js?v=20261104162531';
import { engineEval, winPct } from './profile.js?v=20261104162531';
import { banner, confetti } from './celebrate.js?v=20261104162531';
import { PLAN, VS_PLAN } from './styles.js?v=20261104162531';
import { GUIDE } from './guide.js?v=20261104162531';
import { hanging } from './ideas.js?v=20261104162531';
import { openingOf, loadBook, key } from './book.js?v=20261104162531';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x) => `${Math.round(x * 100)}%`;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(`opening-book-v2${k}`)) ?? d; } catch { return d; } };
const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`no answer in ${ms / 1000} s`)), ms))]);
const MIN_GAMES = 20, FEW_GAMES = 100, MINE = 12; // your first 12 moves count as the opening
const mv = (i, san) => `${Math.floor(i / 2) + 1}${i % 2 ? '…' : '.'}${san}`;

const speed = load('-speed', 'blitz');
let rating = load(`-${speed}-rating`, 1500);
let side = load('-test-side', 'w');
let g = null, view = null, run = 0;
const boardEl = $('#board');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The rating groups of the games, as on the Openings page: your band there, or 100 below to 200 above you.
const EDGES = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500, 3200];
function band() {
  const lo = Math.max(0, EDGES.findLastIndex((e) => e <= rating - 100));
  let hi = EDGES.findIndex((e) => e >= rating + 200);
  if (hi < 0) hi = EDGES.length - 1;
  return load('-band', null) || [lo, Math.max(hi, lo + 1)];
}
const range = (lo, hi) => Array.from({ length: hi - lo }, (_, i) => lo + i);
const level = () => range(...band());
const levelText = () => { const [lo, hi] = band(); return hi === EDGES.length - 1 ? `${EDGES[lo]}+` : lo === 0 ? `under ${EDGES[hi]}` : `${EDGES[lo]}–${EDGES[hi] - 1}`; };
// Strong players as on the Openings page: 200 to 1000 points above you, the top group at the very top.
function strong() { const s = range(0, 9).filter((i) => EDGES[i] >= rating + 200 && EDGES[i] <= rating + 1000); return s.length ? s : [8]; }

// The small file (lines of 200+ games) first, then the full one, kept in the same browser cache as on the Openings page.
const treeFile = async (part) => {
  const url = `data/explorer-${speed}${part}.json?v=2026-10-31-k20`, box = await globalThis.caches?.open('explorer').catch(() => null);
  let res = await box?.match(url).catch(() => null);
  if (!res) { res = await fetch(url); if (res.ok) box?.put(url, res.clone()).catch(() => {}); }
  return (await res.json()).tree;
};
const TOP = treeFile('-top');
let fullTree = null;
const FULL = TOP.then(() => treeFile('')).then((t) => { fullTree = t; return t; }).catch((e) => { console.warn(e); return null; });
const treeNow = async () => fullTree || TOP;
function stat(node, groups) { // node: [games, white wins, draws, children], per rating group
  const sum = (c) => groups.reduce((s, i) => s + (c[i] || 0), 0), n = sum(node[0]);
  return { n, win: n ? sum(node[1]) / n : 0, draw: n ? sum(node[2]) / n : 0, get score() { return this.win + this.draw / 2; } };
}
const clean = (san) => san.replace(/[+#]/g, '');
const nodeAt = (tree, sans) => sans.reduce((node, m) => node?.[3]?.[clean(m)], tree);
const forMe = (s, me) => (me === 'w' ? s.score : 1 - s.score);

// ---------- The game ----------
// The moves on the board when it is not the game now: a step of the line, or a move looked back at.
const shownMoves = () => (g.walk ? g.walk.line.sans.slice(0, g.walk.i) : view !== null ? g.c.history().slice(0, view) : null);
function draw() {
  const all = g.c.history({ verbose: true }), sans = all.map((m) => m.san);
  const moves = shownMoves(), b = moves ? new Chess() : g.c;
  moves?.forEach((m) => b.move(m));
  // Looked back to your turn: the move you played here shows, and the badge goes with it.
  const yours = !g.walk && view !== null && b.turn() === g.me ? all[view] : null, about = yours || (!g.walk && b.history({ verbose: true }).at(-1)) || null, note = about && notes.get(noteKey(about));
  drawBoard(boardEl, b, { side: g.me, sel: g.sel, last: b.history({ verbose: true }).at(-1) || null, mark: note && { sq: about.to, kind: note.kind }, hint: view === null && g.hint ? [g.hint] : [], arrows: g.walk ? walkArrows(b) : view !== null ? g.arrows || (yours ? [[yours.from, yours.to, 'var(--muted)']] : []) : g.tips?.[g.tipShown] ? [[g.tips[g.tipShown].from, g.tips[g.tipShown].to, 'var(--good)']] : g.best ? [[g.best.from, g.best.to, 'var(--good)']] : [] });
  evalBar(b.fen());
  boardEl.classList.toggle('looking-back', view !== null);
  const cell = (i) => { const k = all[i] && notes.get(noteKey(all[i]))?.kind; return `<span data-ply="${i}">${sans[i] || ''}${k && k !== 'book' ? `<sup class="nag k-${k}">${GLYPH[k]}</sup>` : ''}</span>`; };
  $('#test-moves').innerHTML = sans.reduce((a, s, i) => (i % 2 ? a : [...a, `<li>${cell(i)}${cell(i + 1)}</li>`]), []).join('');
  const i = yours ? view : b.history().length - 1;
  $('#test-verdict').innerHTML = note ? `<span class="mark k-${note.kind} legend-badge">${note.kind === 'book' ? BOOK : GLYPH[note.kind]}</span><span><b>${mv(i, about.san)}</b> ${WORD[note.kind]}${note.better ? ` Better was <b>${esc(note.better)}</b>.` : ''}</span>` : '';
  $('#test-moves').querySelector(`[data-ply="${(view ?? sans.length) - 1}"]`)?.classList.add('now');
  if (view === null) $('#test-moves').scrollTop = 1e6;
  $('#test-report').disabled = sans.length < (g.me === 'w' ? 1 : 2); // once you have played a move
  openingOf(sans.slice(0, 24)).then(([f, v]) => { $('#test-open').innerHTML = `${esc(f)}${v ? `<small>${esc(v)}</small>` : ''}`; });
  $('#test-maia').textContent = rating;
  live(sans);
  buttons();
  gradeMoves();
}
// Every move gets a badge, by the Openings page's rules and the report's limits, one at a time as Stockfish gets to it.
const notes = new Map(), noteKey = (m) => `${m.before}|${m.san}`;
const WORD = { book: 'is on the line.', brilliant: 'is brilliant.', best: 'is the best move.', good: 'is good.', inaccuracy: 'is an inaccuracy.', mistake: 'is a mistake.', blunder: 'is a blunder.' };
const WORTH = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function leavesPieceHanging(c, m) { // as in app.js
  if ('pk'.includes(m.piece)) return false;
  const attackers = c.attackers(m.to, m.color === 'w' ? 'b' : 'w');
  return attackers.length > 0 && (Math.min(...attackers.map((sq) => WORTH[c.get(sq).type])) < WORTH[m.piece] || !c.isAttacked(m.to, m.color));
}
async function gradeOne(m, moves) {
  const c = new Chess(m.before); c.move(m.san);
  if (c.isCheckmate()) return { kind: 'best' };
  const [tree, { next }] = await Promise.all([treeNow(), loadBook()]);
  const a = await deepOf(m.before), b = c.isGameOver() ? { cp: 0 } : await deepOf(c.fen()), sign = m.color === 'w' ? 1 : -1;
  const drop = winPct(sign * a.cp) - winPct(sign * b.cp), on = onLine(next, moves, m.san, soundMoves(kidsOf(nodeAt(tree, moves)))), isBest = a.best?.startsWith(m.from + m.to);
  const kind = drop >= 15 ? 'blunder' : drop >= 10 ? 'mistake' : on ? 'book' : drop >= 5 ? 'inaccuracy'
    : isBest ? (leavesPieceHanging(c, m) && winPct(sign * b.cp) >= 45 ? 'brilliant' : 'best') : 'good';
  const better = (drop >= 10 || (drop >= 5 && !on)) && a.best && !isBest ? new Chess(m.before).move({ from: a.best.slice(0, 2), to: a.best.slice(2, 4), promotion: a.best[4] || 'q' }).san : null;
  return { kind, better };
}
let grading = false;
async function gradeMoves() {
  if (grading) return;
  grading = true;
  try {
    for (;;) {
      const all = g.c.history({ verbose: true }), i = all.findIndex((m) => !notes.has(noteKey(m)));
      if (i < 0) return;
      notes.set(noteKey(all[i]), await gradeOne(all[i], all.slice(0, i).map((m) => m.san)));
      draw();
    }
  } catch (e) { console.warn(e); } finally { grading = false; }
}
// The bar beside the board: White's winning chances in the position shown, with Stockfish's number at White's end.
function evalBar(fen) {
  const el = $('#test-eval');
  el.classList.add('stale');
  evalOf(fen).then(({ cp }) => {
    if (shownFen() !== fen) return;
    const white = winPct(cp), text = `${cp >= 0 ? '+' : '-'}${(Math.abs(cp) / 100).toFixed(1)}`;
    el.querySelector('.evalbar-white').style.height = `${white}%`;
    el.querySelector('.evalbar-num').textContent = text;
    el.classList.remove('stale');
    el.classList.toggle('flip', g.me === 'b');
    el.classList.toggle('behind', white < 50);
    el.setAttribute('aria-label', `Evaluation: ${cp >= 0 ? 'White' : 'Black'} ${text.slice(1)}`);
  }).catch((e) => console.warn(e));
}
function shownFen() {
  const moves = shownMoves();
  if (!moves) return g.c.fen();
  const b = new Chess(); moves.forEach((m) => b.move(m));
  return b.fen();
}
// The position looked back at, if it is your turn in it and Maia is not thinking.
function canPlayShown() {
  if (view === null || g.walk || g.busy) return null;
  const c = new Chess(shownFen());
  return c.turn() === g.me ? c : null;
}
// Under the opening's name: whether the game is still in theory, and what players at your level score here.
async function live(sans) {
  const tree = await treeNow(), node = nodeAt(tree, sans.slice(0, 20)), s = node && sans.length <= 20 && stat(node, level());
  if (g.c.history().length !== sans.length) return;
  const name = g.me === 'w' ? 'White' : 'Black';
  $('#test-live').innerHTML = [g.off ? `Off the line since ${mv(g.off.ply, g.off.san)}; it plays ${mv(g.off.ply, g.off.plays)}.` : g.note || (g.cleared || !sans.length ? '' : 'On the line so far.'),
    s?.n >= FEW_GAMES ? `${name} scores ${pct(forMe(s, g.me))} from here at your level, in ${s.n.toLocaleString('en')} games.` : ''].filter(Boolean).join(' ');
}
const myTurn = () => !g.done && !g.busy && g.c.turn() === g.me && !g.c.isGameOver();
function buttons() {
  const n = g.c.history().length, enough = g.me === 'w' ? 1 : 2;
  $('#test-hint').disabled = $('#test-best').disabled = !myTurn() || view !== null;
  $('#test-back').disabled = g.busy || (view === null && n < enough);
  $('#test-back').textContent = view === null ? 'Take back' : 'Play from here';
  $('#test-prev').disabled = (view ?? n) <= 0; $('#test-fwd').disabled = view === null;
  document.querySelectorAll('.test-tip').forEach((b) => { b.disabled = view !== null || !g.tips; }); // they are about the game now, not a move looked back at
  $('#test-resign').disabled = g.done || g.c.isGameOver() || !n;
  if ($('#test-resign').dataset.sure && $('#test-resign').disabled) { delete $('#test-resign').dataset.sure; $('#test-resign').textContent = 'Resign'; }
}
// For Hint and Best move: on the line its move, as following the button must not bring the off-the-line stamp; past it Stockfish's.
async function bestNow() {
  const t = g, fen = t.c.fen(), moves = t.c.history();
  const pick = !t.off && !t.cleared && lineMove(soundMoves(kidsOf(nodeAt(await treeNow(), moves))), t.me);
  if (pick) { const m = new Chess(fen).move(pick.san); return g === t && t.c.fen() === fen ? { from: m.from, to: m.to, line: mv(moves.length, pick.san) } : null; }
  const { best } = await deepOf(fen);
  return g === t && t.c.fen() === fen && best ? { from: best.slice(0, 2), to: best.slice(2, 4) } : null;
}
function over() {
  if (!g.c.isGameOver()) return false;
  const lost = g.c.isCheckmate() && g.c.turn() === g.me;
  $('#test-status').innerHTML = `<b>${g.c.isCheckmate() ? (lost ? 'Maia won by checkmate.' : 'You won by checkmate.') : 'Draw.'}</b>`;
  if (lost) {
    const before = g.c.history().slice(0, -2);
    stamp('Checkmated', 'Go back and find something better', 'lost', [['Go back and play', () => rewind(before)], ['See my report', () => {}]]);
  } else if (g.c.isCheckmate()) banner('Checkmate!'); else banner('Draw', 'draw');
  g.done = true; buttons(); saveGame();
  report();
  return true;
}
// Opponents answer differently: a move among those Maia 3 gives at least 5%, as often as players at your rating play it.
function humanPick(ranked) {
  const likely = ranked.filter((x) => x.p >= 0.05), kept = likely.length ? likely : ranked.slice(0, 1);
  let at = Math.random() * kept.reduce((s, x) => s + x.p, 0);
  return kept.find((x) => (at -= x.p) <= 0)?.move || kept[0].move;
}
// Maia 3 at your rating; Maia 1 if it cannot load, then Stockfish. The nets are big, so they load on the first move only.
async function maiaPlays() {
  const t = g, fen = t.c.fen(), legal = t.c.moves({ verbose: true });
  t.busy = true; buttons(); $('#test-status').textContent = t.c.history().length < 2 ? 'Maia 3 is waking up: the first move takes a moment…' : 'Maia 3 is thinking…';
  const { maia3Move } = await import('./maia3.js?v=20261104162531'), { maiaMove, MAIA_MAX } = await import('./maia.js?v=20261104162531');
  let r = null;
  try { r = humanPick((await within(20000, maia3Move(fen, legal, rating, rating))).ranked); } catch (e) { console.warn(e); }
  if (!r && rating < MAIA_MAX + 100) try { r = (await within(15000, maiaMove(rating, [fen], legal))).move; } catch (e) { console.warn(e); }
  if (!r) { const e = await engineEval(fen); r = e.best && { from: e.best.slice(0, 2), to: e.best.slice(2, 4), promotion: e.best[4] }; }
  await sleep(450); // as the opponent on the Openings page
  if (g !== t) return; // a new game began while Maia thought
  t.busy = false; $('#test-status').textContent = 'Your move.';
  t.c.move({ from: r.from, to: r.to, promotion: r.promotion || 'q' });
  draw(); if (!over()) { saveGame(); checkCleared(t); }
}
function tryMove(from, to) {
  if (g && view !== null) { // looking back: moving a piece plays on from here
    const c = canPlayShown();
    if (!c) return false;
    try { c.move({ from, to, promotion: 'q' }); } catch { return false; }
    rewind(g.c.history().slice(0, view));
  }
  if (!g || !myTurn()) return false;
  const before = g.c.history();
  let played;
  try { played = g.c.move({ from, to, promotion: 'q' }); } catch { return false; }
  g.sel = null; g.hint = g.best = g.tips = null; draw();
  if (!over()) {
    saveGame();
    const t = g; t.busy = true; buttons();
    checkLine(t, before, played.san).then((off) => { if (!off && g === t) maiaPlays(); });
  }
  return true;
}
function newGame() {
  run++; view = null; $('#test-walk').hidden = true; removeStamp(); $('#test-next').hidden = true;
  g = { id: Date.now(), me: side, c: new Chess(), sel: null, busy: false, arrows: null };
  $('#test-out').hidden = true;
  document.querySelectorAll('[data-side]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.side === side));
  $('#test-status').textContent = 'Your move.';
  draw(); pastList();
  if (side === 'b') maiaPlays();
}

// ---------- Your earlier games ----------
// Saved after every move under opening-book-v2 (so they follow your login), newest first; a game you left can be picked up
// again, unless you left it within a move or two.
const PAST = '-test-games', MAX_PAST = 30;
const past = () => load(PAST, []);
const resultOf = (t) => (t.resigned ? 'L' : !t.c.isGameOver() ? 'U' : !t.c.isCheckmate() ? 'D' : t.c.turn() === t.me ? 'L' : 'W');
async function saveGame() {
  const t = g, sans = t.c.history();
  if (sans.length < (t.me === 'w' ? 1 : 2)) { // nothing of yours left in it: not a game to keep
    try { localStorage.setItem(`opening-book-v2${PAST}`, JSON.stringify(past().filter((x) => x.id !== t.id))); } catch {}
    return pastList();
  }
  const [f, v] = await openingOf(sans.slice(0, 24));
  const row = { id: t.id, me: t.me, moves: sans.join(' '), result: resultOf(t), name: v ? `${f}: ${v}` : f };
  try { localStorage.setItem(`opening-book-v2${PAST}`, JSON.stringify([row, ...past().filter((x) => x.id !== t.id && (x.result !== 'U' || x.moves.split(' ').length >= 4))].sort((a, b) => b.id - a.id).slice(0, MAX_PAST))); } catch {}
  pastList();
}
function pastList() {
  const rows = past();
  $('#test-past-card').hidden = !rows.length;
  $('#test-past').innerHTML = rows.map((x) => `<li><button type="button" data-past="${x.id}"${x.id === g?.id ? ' aria-current="true"' : ''}>
    <span class="pf-res r-${x.result}">${x.result === 'U' ? '–' : x.result}</span>
    <span>${esc(x.name)}<small>${x.me === 'w' ? 'White' : 'Black'} · ${new Date(x.id).toLocaleDateString('en', { day: 'numeric', month: 'short' })} · ${Math.ceil(x.moves.split(' ').length / 2)} move${x.moves.split(' ').length > 2 ? 's' : ''}${x.result === 'U' ? ' · not finished' : ''}</small></span></button></li>`).join('');
}
function openPast(id) {
  const x = past().find((y) => y.id === id);
  if (!x) return;
  run++; view = null; $('#test-walk').hidden = true; $('#test-out').hidden = true; removeStamp(); $('#test-next').hidden = true;
  const c = new Chess(); x.moves.split(' ').forEach((m) => c.move(m));
  side = x.me;
  g = { id: x.id, me: x.me, c, sel: null, busy: false, arrows: null, done: x.result !== 'U', resigned: x.result === 'L' && !c.isGameOver() };
  document.querySelectorAll('[data-side]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.side === side));
  $('#test-status').innerHTML = g.done ? `<b>${{ W: 'You won.', L: 'You lost.', D: 'Draw.' }[x.result]}</b>` : 'Your move.';
  draw(); pastList();
  if (g.done) report();
  else if (c.turn() !== x.me) maiaPlays();
}

// ---------- The report ----------
const evals = new Map();
const evalOf = (fen) => { if (!evals.has(fen)) evals.set(fen, engineEval(fen)); return evals.get(fen); };
// For a verdict: a fixed depth, so the same game gets the same answer; the bar stays on the quick look.
const deep = new Map();
const deepOf = (fen) => { if (!deep.has(fen)) deep.set(fen, engineEval(fen, 'depth 14')); return deep.get(fen); };
// What makes a move part of the line: known theory, or played by strong players (the same rule live and in the report).
const kidsOf = (node) => Object.entries(node?.[3] || {}).map(([san, c]) => ({ san, ...stat(c, level()), top: stat(c, strong()).n, all: stat(c, range(0, 9)).n }));
const soundMoves = (kids) => { const all = kids.reduce((s, m) => s + m.top, 0); return kids.filter((m) => m.top >= 20 && m.top / all >= 0.1); };
const onLine = (next, moves, san, sound) => next.get(key(moves))?.has(clean(san)) || sound.some((m) => m.san === clean(san));
const lineMove = (sound, me) => { const score = (m) => (m.n >= FEW_GAMES ? forMe(m, me) : -1); return [...sound].sort((a, b) => score(b) - score(a) || b.top - a.top)[0]; };
// The stamp with a choice on the board; nothing happens behind it until one is made.
function stamp(word, small, kind, choices) {
  removeStamp();
  document.querySelector('.board-frame').insertAdjacentHTML('beforeend', `<div class="mate-banner test-stamp${kind ? ` ${kind}` : ''}" role="dialog" aria-label="${esc(word)}"><b class="stamp">${esc(word)}<small>${esc(small)}</small></b>
    <div class="test-choices">${choices.map(([label], i) => `<button type="button" class="${i ? 'ghost' : 'cta'}" data-choice="${i}">${esc(label)}</button>`).join('')}</div></div>`);
  stampChoices = choices;
}
let stampChoices = [];
function removeStamp() { document.querySelector('.test-stamp')?.remove(); stampChoices = []; }
// Your move leaves the line: say so before Maia answers. True if the stamp is up. Where the games run out there is no line to leave.
async function checkLine(t, before, san) {
  if (t.off || t.cleared) return false;
  const [tree, { next }] = await Promise.all([treeNow(), loadBook()]);
  if (g !== t) return false;
  const sound = soundMoves(kidsOf(nodeAt(tree, before))), pick = lineMove(sound, t.me);
  if (!pick || onLine(next, before, san, sound)) return false;
  const i = before.length, plays = pick.san;
  t.off = { ply: i, san, plays };
  t.busy = false; buttons(); live(t.c.history());
  stamp('Off the line', `You played ${mv(i, san)}. The line plays ${mv(i, plays)}`, 'lost', [
    [`Play ${mv(i, plays)}`, () => playLine(t, before, plays)],
    ['Try again', () => rewind(before)],
    ['Keep playing', () => maiaPlays()],
  ]);
  return true;
}
// The line's move played for you, slowly enough to follow: your move goes back, the arrow shows, then the piece moves.
async function playLine(t, before, plays) {
  rewind(before);
  const m = new Chess(t.c.fen()).move(plays), i = before.length;
  t.busy = true; t.best = { from: m.from, to: m.to }; buttons();
  $('#test-status').textContent = `The line plays ${mv(i, plays)}.`;
  draw();
  await sleep(1100);
  if (g !== t) return;
  t.best = null; t.c.move(plays); draw();
  await sleep(900);
  if (g !== t) return;
  t.busy = false;
  if (!over()) { saveGame(); maiaPlays(); }
}
// Your turn and no known line goes further: the end of the data (20 half-moves) or the games at your level running out.
function lineEnded(tree, next, moves) {
  return moves.length >= 20 || (!soundMoves(kidsOf(nodeAt(tree, moves))).length && !next.get(key(moves))?.size);
}
// The opponent's move that no line on the Openings page follows, as its index; null if there is none. The same limits as
// buildLines in app.js: from where the opening gets its name, a reply is taught if it is the most common, a main reply
// of 2000+ players, a trap, or at least 5% of games here and 3% of the opening's. Change them together.
function leftLines(tree, names, sans, me) {
  let root = 0, family = null;
  sans.forEach((_, i) => { const f = names.get(key(sans.slice(0, i + 1)))?.split(': ')[0]; if (f && f !== family) { family = f; root = i + 1; } });
  let share = 1;
  for (let i = root; i < sans.length; i++) {
    if ((i % 2 === 0) === (me === 'w')) continue;
    const node = nodeAt(tree, sans.slice(0, i));
    if (!node) break;
    const groups = stat(node, level()).n >= MIN_GAMES ? level() : range(band()[0], 9), total = stat(node, groups).n;
    if (total < MIN_GAMES) break; // the games have run out: the line ended before this move
    const count = (c) => stat(c, groups).n, kids = Object.entries(node[3] || {}).sort((a, b) => count(b[1]) - count(a[1]));
    const child = node[3]?.[clean(sans[i])], m = child && stat(child, groups);
    if (!m) return i;
    const top = stat(node, [6, 7, 8]).n, atTop = stat(child, [6, 7, 8]).n, next = share * m.n / total;
    const theory = atTop >= MIN_GAMES && atTop / top >= 0.15 && m.n >= 3;
    const trap = m.n >= 30 && m.n / total >= 0.05 && forMe(m, me === 'w' ? 'b' : 'w') <= 0.38;
    if (kids[0][0] !== clean(sans[i]) && !theory && !trap && !(m.n >= MIN_GAMES && m.n / total >= 0.05 && next >= 0.03)) return i;
    share = next;
  }
  return null;
}
async function checkCleared(t) {
  if (t.cleared && !t.done) return whatNow(t); // playing on: the questions follow the position
  if (t.off || t.cleared || t.done) return;
  const moves = t.c.history(), { next, names } = await loadBook();
  await within(8000, FULL).catch(() => {}); // the small file ends early: ask the full one
  const tree = await treeNow();
  if (g !== t || t.c.history().length !== moves.length || t.off) return;
  const rare = fullTree ? leftLines(fullTree, names, moves, t.me) : null;
  if (rare === null && !lineEnded(tree, next, moves)) return;
  t.cleared = true; t.clearedAt = rare === null ? moves.length : rare + 1;
  const [f] = await openingOf(moves.slice(0, 24)), mine = moves.filter((_, i) => (i % 2 === 0) === (t.me === 'w')).length;
  t.family = f;
  // Only a line played to its end is worth stopping the game for; otherwise a quiet line under the opening's name.
  if (rare === null && mine >= 4) { confetti(110); stamp(`${f} cleared`, `${mine} moves on the line. What to do next is under the board`, '', [['Play on against Maia', () => {}], ['Try again', () => newGame()]]); }
  else t.note = `${rare === null ? 'The known lines end here.' : `Maia left the lines on the Openings page with ${mv(rare, moves[rare])}.`} You are on your own from here.`;
  whatNow(t);
  live(moves);
}
// What to think about now the line is over: the opening's plan, then questions about this very position. Stockfish
// has each answer ready, limited to that piece's moves; hovering or tapping shows it on the board.
const NAME = { n: 'knight', b: 'bishop', q: 'queen', r: 'rook', p: 'pawn', k: 'king' };
async function whatNow(t) {
  const c = t.c, me = t.me, family = t.family, fen = c.fen(), legal = c.moves({ verbose: true });
  const find = (o) => o[family] || Object.entries(o).find(([k]) => family.startsWith(k))?.[1];
  const plan = find(me === 'w' ? PLAN : VS_PLAN), idea = !plan && find(GUIDE)?.idea?.split('. ').slice(0, 2).join('. ');
  const el = $('#test-next'), head = `<p class="sups-k">Now the line is over</p>${plan ? `<p><b>Your plan:</b> ${plan}</p>` : idea ? `<p><b>The idea:</b> ${idea.replace(/\.?$/, '.')}</p>` : ''}`;
  if (el.hidden) { el.innerHTML = `${head}<p>Stockfish is looking at this position…</p>`; el.hidden = false; } // the stamp points here: never an empty place
  // The best of these moves, as a move on the board.
  const bestOf = async (moves) => {
    if (!moves.length) return null;
    const { best } = await engineEval(fen, `depth 12 searchmoves ${moves.map((m) => m.from + m.to + (m.promotion || '')).join(' ')}`);
    return best && new Chess(fen).move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] || 'q' });
  };
  const home = me === 'w' ? { b1: 'n', g1: 'n', c1: 'b', f1: 'b' } : { b8: 'n', g8: 'n', c8: 'b', f8: 'b' };
  const idle = Object.entries(home).filter(([sq, type]) => { const p = c.get(sq); return p?.color === me && p.type === type; });
  const king = c.board().flat().find((p) => p?.type === 'k' && p.color === me)?.square, central = king === (me === 'w' ? 'e1' : 'e8');
  const castles = legal.filter((m) => m.san.startsWith('O-O'));
  const tips = [];
  for (const h of hanging(c, me).slice(0, 1)) tips.push([`Your ${NAME[h.type]} on ${h.square} can be taken. What now?`, await bestOf(legal)]);
  let waiting = 0; // how many pieces at home still have somewhere to go
  for (const [sq, type] of idle) {
    const moves = legal.filter((m) => m.from === sq);
    if (moves.length && ++waiting <= 2) tips.push([`Your ${NAME[type]} on ${sq}: where should it go?`, await bestOf(moves)]);
  }
  if (castles.length) tips.push(['Your king is still in the centre: which way should it castle?', await bestOf(castles)]);
  else if (central) tips.push(['Castle soon: clear the squares next to your king first.', null]);
  if (!waiting && !central) tips.push(['Your pieces are out: which pawn move opens the game for them?', await bestOf(legal.filter((m) => m.piece === 'p'))]);
  tips.push(['The strongest move right now?', await bestOf(legal)]);
  if (g !== t || t.c.fen() !== fen || !t.cleared) return; // the game moved on while Stockfish thought
  t.tips = tips.map(([, m]) => m); t.tipShown = null;
  el.innerHTML = `${head}
    <ul>${tips.map(([q, m], i) => (m ? `<li><button type="button" class="test-tip" data-tip="${i}">${esc(q)} <b>${esc(m.san)}</b></button></li>` : `<li>${esc(q)}</li>`)).join('')}</ul>`;
  buttons();
}
function showTip(i) {
  if (!g?.tips || g.tipShown === i) return;
  g.tipShown = i;
  document.querySelectorAll('.test-tip').forEach((b) => b.classList.toggle('on', Number(b.dataset.tip) === i));
  draw();
}
// The line you opened with: your own moves as long as they are known theory or something strong players play;
// from the first that is not, what strong players play that scores best at your level, against the most common
// answers. It ends where the games run out.
async function theLine(tree, next, sans, me) {
  const line = { sans: [], notes: [], off: null, played: null };
  let onGame = true, mine = 0;
  for (let i = 0; i < 24 && mine < MINE; i++) {
    const node = nodeAt(tree, line.sans), played = onGame ? sans[i] : null, label = (san) => mv(i, san);
    if (onGame && !played) onGame = false;
    const kids = kidsOf(node);
    if ((i % 2 === 0) !== (me === 'w')) { // their move
      const common = [...kids].sort((a, b) => b.n - a.n || b.all - a.all)[0];
      const san = played || common?.san;
      if (!san) break;
      line.sans.push(san); line.notes.push(played ? `${label(san)}: Maia played this.` : `${label(san)}: the most common answer at your level.`);
      continue;
    }
    mine++;
    const sound = soundMoves(kids);
    const fine = played && onLine(next, line.sans, played, sound);
    if (fine) { line.sans.push(played); line.notes.push(`${label(played)}: you played this too.`); continue; }
    const pick = lineMove(sound, me) || (played ? null : kids.filter((m) => m.top >= 20).sort((a, b) => b.top - a.top)[0]);
    const san = pick?.san, why = pick ? `${pick.n >= FEW_GAMES ? `scores ${pct(forMe(pick, me))} at your level` : 'strong players play it'}` : '';
    if (!san) break; // the games run out here: the line ends
    if (played) { line.off = i; line.played = played; onGame = false; }
    line.sans.push(san);
    line.notes.push(`${label(san)}: ${why}.${played ? ` You played ${label(played)}.` : ''}`);
  }
  return line;
}
function walkArrows(b) {
  const { line, i } = g.walk, arrow = (san, colour) => { const m = new Chess(b.fen()).move(san); return [m.from, m.to, colour]; };
  if (i >= line.sans.length) return [];
  const mine = (i % 2 === 0) === (g.me === 'w');
  return [...(i === line.off ? [arrow(line.played, 'var(--bad)')] : []), arrow(line.sans[i], mine ? 'var(--good)' : 'var(--muted)')];
}
function startWalk(line, i) { g.walk = { line, i }; view = 0; g.sel = null; $('#test-walk').hidden = false; showStep(); }
function showStep() { const { line, i } = g.walk; $('#test-walk-text').textContent = line.notes[i] || 'The end of the line.'; draw(); }
function stepWalk(by) { g.walk.i = Math.max(0, Math.min(g.walk.line.sans.length, g.walk.i + by)); showStep(); }
function endWalk() { g.walk = null; $('#test-walk').hidden = true; }
async function report() {
  const me = ++run, t = g, colour = t.me === 'w' ? 'White' : 'Black', sans = t.c.history(), hist = t.c.history({ verbose: true });
  const out = $('#test-out'), [tree, { next }] = await Promise.all([treeNow(), loadBook()]), [f, v] = await openingOf(sans.slice(0, 24));
  const line = await theLine(tree, next, sans, t.me);
  t.line = line;
  // The report has the last word on the line, also for a game opened from the list.
  if (line.off !== null) t.off = { ply: line.off, san: line.played, plays: line.sans[line.off] };
  live(sans);
  // How good: the deepest position of your game that enough players at your level reached.
  let at = 0, here = null;
  for (let n = Math.min(sans.length, 20); n > 0 && !here; n--) { const node = nodeAt(tree, sans.slice(0, n)), s = node && stat(node, level()); if (s?.n >= FEW_GAMES) { here = s; at = n; } }
  const base = stat(tree, level()), [hf, hv] = here ? await openingOf(sans.slice(0, at)) : [];
  const gap = here ? Math.round((forMe(here, t.me) - forMe(base, t.me)) * 100) : 0;
  const win = here && (t.me === 'w' ? here.win : 1 - here.win - here.draw), loss = here && 1 - win - here.draw;
  const good = !here ? `<p>Too few games at your level (${levelText()}) reach this position to say how good it is.</p>`
    : `<p class="sups-k">At your level, ${levelText()}</p><p class="test-big">${pct(forMe(here, t.me))}</p>
       <p>${colour}'s score after ${mv(at - 1, sans[at - 1])}${hv || hf !== f ? ` (${esc(hv || hf)})` : ''}, in ${here.n.toLocaleString('en')} games: a win counts as 1, a draw as ½. ${Math.abs(gap) < 2 ? `About the average for ${colour} (${pct(forMe(base, t.me))}).` : `${Math.abs(gap)} points ${gap > 0 ? 'above' : 'below'} the ${pct(forMe(base, t.me))} ${colour} scores on average.`}</p>
       <div class="wdl" role="img" aria-label="Win ${pct(win)}, draw ${pct(here.draw)}, loss ${pct(loss)}"><span class="w" style="width:${win * 100}%"></span><span class="d" style="width:${here.draw * 100}%"></span><span class="l" style="width:${loss * 100}%"></span></div>
       <p class="wdl-key"><span>Win <b>${pct(win)}</b></span><span>Draw ${pct(here.draw)}</span><span>Loss ${pct(loss)}</span></p>`;
  // Your moves, with what the games say; Stockfish's verdict fills in below.
  const rows = [];
  sans.forEach((san, i) => {
    if ((i % 2 === 0) !== (t.me === 'w') || rows.length >= MINE) return;
    const node = nodeAt(tree, sans.slice(0, i)), kids = Object.entries(node?.[3] || {});
    const lv = kids.map(([m, c]) => ({ san: m, ...stat(c, level()), top: stat(c, strong()).n }));
    const you = lv.find((m) => m.san === clean(san)), topAll = lv.reduce((s, m) => s + m.top, 0);
    const alt = you?.n >= FEW_GAMES ? lv.filter((m) => m.san !== clean(san) && m.n >= FEW_GAMES && m.top / topAll >= 0.1 && forMe(m, t.me) - forMe(you, t.me) >= 0.05).sort((a, b) => forMe(b, t.me) - forMe(a, t.me))[0] : null;
    const book = next.get(key(sans.slice(0, i)))?.has(clean(san));
    const notes = [i === line.off ? `The line plays ${mv(i, line.sans[i])}` : null,
      you?.n >= FEW_GAMES ? `scores ${pct(forMe(you, t.me))} in ${you.n.toLocaleString('en')} games` : 'too few games to say',
      alt ? `${mv(i, alt.san)} scores ${pct(forMe(alt, t.me))}` : null].filter(Boolean);
    const kept = clean(line.sans[i] || '') === clean(san) && (line.off === null || i < line.off);
    rows.push({ i, san, book, kept, m: hist[i], note: notes.join(' · ') });
  });
  const list = () => rows.map((r) => `<li class="${[r.kind ? 'bad' : '', r.i === line.off ? 'off' : ''].join(' ').trim()}"><button type="button" data-row="${r.i}"><b>${r.i % 2 ? `<i>${mv(r.i - 1, sans[r.i - 1])}</i> ${r.san}` : mv(r.i, r.san)}${r.kind ? (r.kind === 'Blunder' ? '??' : r.kind === 'Mistake' ? '?' : '?!') : ''}${r.i % 2 === 0 && sans[r.i + 1] ? ` <i>${sans[r.i + 1]}</i>` : ''}${r.kept ? `<span class="mark k-book legend-badge" title="${r.book ? 'On the line: known theory' : 'On the line: strong players play this'}">${BOOK}</span>` : ''}</b><small>${r.i === line.off ? '<em>Left the line here</em> · ' : ''}${r.kind ? `${r.kind} · ` : ''}${esc(r.note)}</small></button></li>`).join('');
  const paint = (verdict) => {
    if (me !== run) return;
    out.innerHTML = `<p class="sups-k">Your opening</p><p class="play-open">${esc(f)}${v ? `<small>${esc(v)}</small>` : ''}</p>
      ${good}${verdict}
      <p class="sups-k">The line</p>
      <p>${line.off !== null ? `You left it with <b>${mv(line.off, line.played)}</b>. The line plays <b>${mv(line.off, line.sans[line.off])}</b>.` : line.sans.length > sans.length ? 'You stayed on the line. This is how it goes on.' : 'You played the line to its end.'}</p>
      <p class="test-line">${line.sans.map((m, i) => `<span${i === line.off ? ' class="off"' : ''}>${i % 2 ? '' : `${i / 2 + 1}.`}${esc(m)}</span>`).join(' ')}</p>
      <p><button type="button" class="link" data-line>Show the line on the board</button></p>
      <ul class="test-list">${list()}</ul>
      ${f !== 'Starting position' ? `<p><a class="link" href="./?practise=${t.me}~${encodeURIComponent(f)}">Practise the ${esc(f)} →</a></p>` : ''}`;
    out.hidden = false;
  };
  paint(`<p class="info">Stockfish is checking your ${rows.length} moves…</p>`);
  // What each move gave away, with the site's own limits for a slip.
  for (const r of rows) {
    const before = new Chess(); sans.slice(0, r.i).forEach((m) => before.move(m));
    const a = await deepOf(before.fen()); before.move(r.san);
    const b = await deepOf(before.fen());
    if (me !== run) return;
    const sign = t.me === 'w' ? 1 : -1, drop = Math.max(0, winPct(sign * a.cp) - winPct(sign * b.cp));
    r.kind = drop >= 15 ? 'Blunder' : drop >= 10 ? 'Mistake' : drop >= 5 && !r.kept ? 'Inaccuracy' : null; // a small loss is no reason to fault a move of the line, as in the badges
    if (r.kind && a.best && a.best !== r.m.from + r.m.to + (r.m.promotion || '')) {
      const c = new Chess(); sans.slice(0, r.i).forEach((m) => c.move(m));
      r.best = c.move({ from: a.best.slice(0, 2), to: a.best.slice(2, 4), promotion: a.best[4] || 'q' });
    }
  }
  const slip = rows.find((r) => r.kind === 'Blunder' || r.kind === 'Mistake') || rows.find((r) => r.kind);
  paint(slip ? `<p class="test-wrong"><b>Where it went wrong: ${mv(slip.i, slip.san)}</b>. ${slip.kind}${slip.best ? `; Stockfish prefers <b>${mv(slip.i, slip.best.san)}</b>` : ''}. <button type="button" class="link" data-row="${slip.i}">Show it on the board</button></p>`
    : `<p class="test-fine"><b>No slips.</b> Stockfish found nothing wrong with your ${rows.length} move${rows.length === 1 ? '' : 's'}.</p>`);
  t.rows = rows;
  if (t.done && g === t && !t.walk && line.off !== null) startWalk(line, line.off); // the game is over: straight to where you left the line
}

// ---------- Input ----------
function showRow(i) {
  const r = g.rows?.find((x) => x.i === i);
  endWalk(); view = i; g.sel = null;
  g.arrows = r ? [[r.m.from, r.m.to, 'var(--bad)'], ...(r.best ? [[r.best.from, r.best.to, 'var(--good)']] : [])] : null;
  draw();
}
const browse = (to) => { endWalk(); const n = g.c.history().length; view = to >= n ? null : Math.max(0, to); g.sel = null; g.arrows = null; draw(); };
enableDrag(boardEl, { canDrag: (sq) => g && (view === null ? myTurn() && g.c.get(sq)?.color === g.me : canPlayShown()?.get(sq)?.color === g.me), onDrop: (a, b) => { if (!tryMove(a, b)) draw(); } });
boardEl.addEventListener('click', (e) => {
  const sq = e.target.closest('.sq')?.dataset.sq, shown = g && (view === null ? null : canPlayShown());
  if (view !== null && (!shown || !sq || (!g.sel && shown.get(sq)?.color !== g.me))) { endWalk(); view = null; return draw(); }
  if (!g || !sq || (view === null && !myTurn())) return;
  if (g.sel && g.sel !== sq && tryMove(g.sel, sq)) return;
  g.sel = (shown || g.c).get(sq)?.color === g.me && g.sel !== sq ? sq : null;
  draw();
});
// A step back lands on your turn, with the move you played there on the board, ready to be played differently.
const myPly = (i) => (i % 2 === 0) === (g.me === 'w');
const stepBy = (by) => { const now = view ?? g.c.history().length, to = now + by; browse(myPly(to) ? to : Math.max(0, to + by)); };
$('#test-prev').addEventListener('click', () => stepBy(-1));
$('#test-fwd').addEventListener('click', () => stepBy(1));
document.addEventListener('keydown', (e) => {
  if (!g || e.target.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (g.walk && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); return stepWalk(e.key === 'ArrowLeft' ? -1 : 1); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); return stepBy(e.key === 'ArrowLeft' ? -1 : 1); }
  const to = { ArrowUp: 0, ArrowDown: g.c.history().length }[e.key];
  if (to !== undefined) { e.preventDefault(); browse(to); }
});
$('#test-moves').addEventListener('click', (e) => { const x = e.target.closest('[data-ply]'); if (x?.textContent) browse(Number(x.dataset.ply) + 1); });
$('#test-out').addEventListener('click', (e) => {
  const x = e.target.closest('[data-row]');
  if (x) return Number(x.dataset.row) === g.line?.off && !x.closest('.test-wrong') ? startWalk(g.line, g.line.off) : showRow(Number(x.dataset.row));
  if (e.target.closest('[data-line]')) startWalk(g.line, g.line.off ?? 0);
});
$('#test-walk').addEventListener('click', (e) => {
  const by = e.target.closest('[data-walk]')?.dataset.walk;
  if (by === '0') { endWalk(); view = null; draw(); } else if (by) stepWalk(Number(by));
});
$('#test-hint').addEventListener('click', async () => { const b = await bestNow(); if (b) { g.hint = b.from; draw(); } });
$('#test-best').addEventListener('click', async () => { const b = await bestNow(); if (b) { g.hint = null; g.best = b; draw(); if (b.line) $('#test-status').textContent = `The line plays ${b.line}.`; } });
// Back to the position on the board, or your last move when you are at the end, and on from there. A position with
// Maia to move goes back one more, so it is your move again. A finished game stays in the list; this becomes a new one.
function rewind(to, then) {
  removeStamp();
  g.cleared = g.cleared && to.length >= g.clearedAt; // still past the line's end: no second stamp, and the questions stay
  if (!g.cleared) { g.note = null; $('#test-next').hidden = true; }
  const c = new Chess(); to.forEach((m) => c.move(m));
  if (g.done) g.id = Date.now();
  if (g.off?.ply >= to.length) g.off = null;
  endWalk();
  run++; view = null; g.c = c; g.done = g.resigned = false; g.rows = g.line = null; g.sel = g.hint = g.best = g.tips = null;
  then?.(c);
  $('#test-out').hidden = true; $('#test-status').textContent = 'Your move.';
  draw(); saveGame();
  if (g.cleared) whatNow(g);
  if (c.turn() !== g.me && !c.isGameOver()) maiaPlays();
}
$('#test-back').addEventListener('click', () => {
  const shown = shownMoves(), to = shown ? [...shown] : g.c.history().slice(0, g.c.turn() === g.me ? -2 : -1);
  if (shown && to.length && to.length % 2 === (g.me === 'w' ? 1 : 0)) to.pop();
  rewind(to);
});
document.querySelector('.board-frame').addEventListener('click', (e) => {
  const b = e.target.closest('[data-choice]');
  if (!b) return;
  e.stopPropagation();
  const choose = stampChoices[Number(b.dataset.choice)];
  removeStamp();
  choose?.[1]();
});
$('#test-resign').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Press again to resign'; return; }
  removeStamp(); g.done = g.resigned = true; g.sel = g.hint = g.best = null;
  $('#test-status').innerHTML = '<b>You resigned.</b>';
  draw(); saveGame(); report();
});
$('#test-past').addEventListener('click', (e) => { const x = e.target.closest('[data-past]'); if (x) openPast(Number(x.dataset.past)); });
// A question's answer: on hover or focus, and held by a tap, as a phone has no hover.
const tipOf = (e) => e.target.closest?.('[data-tip]');
$('#test-next').addEventListener('mouseover', (e) => { const b = tipOf(e); if (b && !b.disabled) showTip(Number(b.dataset.tip)); });
$('#test-next').addEventListener('mouseout', (e) => { if (tipOf(e)) showTip(null); });
$('#test-next').addEventListener('focusin', (e) => { const b = tipOf(e); if (b && !b.disabled) showTip(Number(b.dataset.tip)); });
$('#test-next').addEventListener('click', (e) => { const b = tipOf(e); if (b && !b.disabled) showTip(Number(b.dataset.tip)); });
$('#test-report').addEventListener('click', report);
$('#test-new').addEventListener('click', newGame);
document.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => { side = b.dataset.side; try { localStorage.setItem('opening-book-v2-test-side', JSON.stringify(side)); } catch {} newGame(); }));
$('#test-rating').value = rating;
$('#test-rating').addEventListener('change', (e) => { const r = Number(e.target.value); if (r >= 600 && r <= 2800) { rating = r; draw(); } else e.target.value = rating; });

// New, so supporters and admins try it first.
if (window.earlyAccess?.()) { $('#test-game').hidden = false; newGame(); }
else $('#test-gate').innerHTML = '<p class="info">Test my opening is new, and supporters try it first. <a href="supporters.html">See what supporters get</a>.</p>';
