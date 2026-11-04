// Test my opening: a game against Maia 3 at your rating, then what the opening is called, where you went
// wrong and how it scores at your level. Nothing leaves the browser: the games are the site's own data files.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard, enableDrag, BOOK } from './board.js?v=20261104142604';
import { engineEval, winPct } from './profile.js?v=20261104142604';
import { banner } from './celebrate.js?v=20261104142604';
import { openingOf, loadBook, key } from './book.js?v=20261104142604';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x) => `${Math.round(x * 100)}%`;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(`opening-book-v2${k}`)) ?? d; } catch { return d; } };
const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`no answer in ${ms / 1000} s`)), ms))]);
const FEW_GAMES = 100, MINE = 12; // your first 12 moves count as the opening
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

// shortcut: only the -top file (lines of 200+ games), so rare lines count as no data; use the full file if that shows.
const TREE = fetch(`data/explorer-${speed}-top.json?v=2026-10-31-k20`).then((r) => r.json()).then((d) => d.tree);
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
  drawBoard(boardEl, b, { side: g.me, sel: view === null ? g.sel : null, last: b.history({ verbose: true }).at(-1) || null, hint: view === null && g.hint ? [g.hint] : [], arrows: g.walk ? walkArrows(b) : view !== null ? g.arrows || [] : g.best ? [[g.best.from, g.best.to, 'var(--good)']] : [] });
  evalBar(b.fen());
  boardEl.classList.toggle('looking-back', view !== null);
  $('#test-moves').innerHTML = sans.reduce((a, s, i) => (i % 2 ? a : [...a, `<li><span data-ply="${i}">${s}</span><span data-ply="${i + 1}">${sans[i + 1] || ''}</span></li>`]), []).join('');
  $('#test-moves').querySelector(`[data-ply="${(view ?? sans.length) - 1}"]`)?.classList.add('now');
  if (view === null) $('#test-moves').scrollTop = 1e6;
  $('#test-report').disabled = sans.length < (g.me === 'w' ? 1 : 2); // once you have played a move
  openingOf(sans.slice(0, 24)).then(([f, v]) => { $('#test-open').innerHTML = `${esc(f)}${v ? `<small>${esc(v)}</small>` : ''}`; });
  $('#test-maia').textContent = rating;
  live(sans);
  buttons();
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
// Under the opening's name: whether the game is still in theory, and what players at your level score here.
async function live(sans) {
  const tree = await TREE, node = nodeAt(tree, sans.slice(0, 20)), s = node && sans.length <= 20 && stat(node, level());
  if (g.c.history().length !== sans.length) return;
  const name = g.me === 'w' ? 'White' : 'Black';
  $('#test-live').textContent = [g.off?.note, g.off || !sans.length ? '' : 'On the line so far.',
    s?.n >= FEW_GAMES ? `${name} scores ${pct(forMe(s, g.me))} from here at your level, in ${s.n.toLocaleString('en')} games.` : ''].filter(Boolean).join(' ');
}
const myTurn = () => !g.done && !g.busy && g.c.turn() === g.me && !g.c.isGameOver();
function buttons() {
  const n = g.c.history().length, enough = g.me === 'w' ? 1 : 2;
  $('#test-hint').disabled = $('#test-best').disabled = !myTurn() || view !== null;
  $('#test-back').disabled = g.busy || n < enough || g.resigned;
  $('#test-resign').disabled = g.done || g.c.isGameOver() || !n;
  if ($('#test-resign').dataset.sure && $('#test-resign').disabled) { delete $('#test-resign').dataset.sure; $('#test-resign').textContent = 'Resign'; }
}
// Stockfish's move for the position on the board, for Hint and Best move.
async function bestNow() {
  const t = g, fen = t.c.fen(), { best } = await evalOf(fen);
  return g === t && t.c.fen() === fen && best ? { from: best.slice(0, 2), to: best.slice(2, 4) } : null;
}
function over() {
  if (!g.c.isGameOver()) return false;
  const lost = g.c.isCheckmate() && g.c.turn() === g.me;
  $('#test-status').innerHTML = `<b>${g.c.isCheckmate() ? (lost ? 'Maia won by checkmate.' : 'You won by checkmate.') : 'Draw.'}</b>`;
  if (g.c.isCheckmate()) banner(lost ? 'Checkmated' : 'Checkmate!', lost ? 'lost' : ''); else banner('Draw', 'draw');
  g.done = true; buttons(); saveGame();
  report();
  return true;
}
// Maia 3 at your rating; Maia 1 if it cannot load, then Stockfish. The nets are big, so they load on the first move only.
async function maiaPlays() {
  const t = g, fen = t.c.fen(), legal = t.c.moves({ verbose: true }), began = Date.now();
  t.busy = true; buttons(); $('#test-status').textContent = t.c.history().length < 2 ? 'Maia 3 is waking up: the first move takes a moment…' : 'Maia 3 is thinking…';
  const { maia3Move } = await import('./maia3.js?v=20261104142604'), { maiaMove, MAIA_MAX } = await import('./maia.js?v=20261104142604');
  let r = null;
  try { r = (await within(20000, maia3Move(fen, legal, rating, rating))).move; } catch (e) { console.warn(e); }
  if (!r && rating < MAIA_MAX + 100) try { r = (await within(15000, maiaMove(rating, [fen], legal))).move; } catch (e) { console.warn(e); }
  if (!r) { const e = await engineEval(fen); r = e.best && { from: e.best.slice(0, 2), to: e.best.slice(2, 4), promotion: e.best[4] }; }
  await sleep(800 + Math.random() * 1400 - (Date.now() - began)); // Maia answers at once; a move you can follow takes a moment
  if (g !== t) return; // a new game began while Maia thought
  t.busy = false; $('#test-status').textContent = 'Your move.';
  t.c.move({ from: r.from, to: r.to, promotion: r.promotion || 'q' });
  draw(); if (!over()) saveGame();
}
function tryMove(from, to) {
  if (!g || !myTurn()) return false;
  const before = g.c.history();
  let played;
  try { played = g.c.move({ from, to, promotion: 'q' }); } catch { return false; }
  checkLine(g, before, played.san);
  g.sel = null; g.hint = g.best = null; draw();
  if (!over()) { saveGame(); maiaPlays(); }
  return true;
}
function newGame() {
  run++; view = null; $('#test-walk').hidden = true;
  g = { id: Date.now(), me: side, c: new Chess(), sel: null, busy: false, arrows: null };
  $('#test-out').hidden = true;
  document.querySelectorAll('[data-side]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.side === side));
  $('#test-status').textContent = 'Your move.';
  draw(); pastList();
  if (side === 'b') maiaPlays();
}

// ---------- Your earlier games ----------
// Saved after every move under opening-book-v2 (so they follow your login), newest first; a game you left can be picked up again.
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
  try { localStorage.setItem(`opening-book-v2${PAST}`, JSON.stringify([row, ...past().filter((x) => x.id !== t.id)].sort((a, b) => b.id - a.id).slice(0, MAX_PAST))); } catch {}
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
  run++; view = null; $('#test-walk').hidden = true; $('#test-out').hidden = true;
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
// What makes a move part of the line: known theory, or played by strong players (the same rule live and in the report).
const kidsOf = (node) => Object.entries(node?.[3] || {}).map(([san, c]) => ({ san, ...stat(c, level()), top: stat(c, strong()).n, all: stat(c, range(0, 9)).n }));
const soundMoves = (kids) => { const all = kids.reduce((s, m) => s + m.top, 0); return kids.filter((m) => m.top >= 20 && m.top / all >= 0.1); };
const onLine = (next, moves, san, sound) => next.get(key(moves))?.has(clean(san)) || sound.some((m) => m.san === clean(san));
const lineMove = (sound, me) => { const score = (m) => (m.n >= FEW_GAMES ? forMe(m, me) : -1); return [...sound].sort((a, b) => score(b) - score(a) || b.top - a.top)[0]; };
// The first time your move leaves the line, say so at once. Where the games run out there is nothing to say.
async function checkLine(t, before, san) {
  const [tree, { next }] = await Promise.all([TREE, loadBook()]);
  if (g !== t || t.off) return;
  const sound = soundMoves(kidsOf(nodeAt(tree, before))), pick = lineMove(sound, t.me);
  if (!pick || onLine(next, before, san, sound)) return;
  const i = before.length;
  t.off = { ply: i, note: `You left the line with ${mv(i, san)}; it plays ${mv(i, pick.san)}.` };
  banner(`Off the line · The line plays ${mv(i, pick.san)}`, 'lost');
  live(t.c.history());
}
// The line you opened with: your own moves as long as they are known theory or something strong players play;
// from the first that is not, what strong players play that scores best at your level, against the most common
// answers. Where the games run out, Stockfish's move ends it.
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
    let san = pick?.san, why = pick ? `${pick.n >= FEW_GAMES ? `scores ${pct(forMe(pick, me))} at your level` : 'strong players play it'}` : '';
    if (!san) { // the games run out here
      const b = new Chess(); line.sans.forEach((m) => b.move(m));
      const { best } = await evalOf(b.fen());
      if (!best) break;
      san = b.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] || 'q' }).san; why = "Stockfish's move, as the games run out here";
      if (played && clean(san) === clean(played)) { line.sans.push(played); line.notes.push(`${label(played)}: you played this too.`); break; }
    }
    if (played) { line.off = i; line.played = played; onGame = false; }
    line.sans.push(san);
    line.notes.push(`${label(san)}: ${why}.${played ? ` You played ${label(played)}.` : ''}`);
    if (!pick) break;
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
  const out = $('#test-out'), [tree, { next }] = await Promise.all([TREE, loadBook()]), [f, v] = await openingOf(sans.slice(0, 24));
  const line = await theLine(tree, next, sans, t.me);
  t.line = line;
  // The report has the last word on the line, also for a game opened from the list.
  if (line.off !== null) t.off = { ply: line.off, note: `You left the line with ${mv(line.off, line.played)}; it plays ${mv(line.off, line.sans[line.off])}.` };
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
      <p>${line.off !== null ? `You left it with <b>${mv(line.off, line.played)}</b>. The line plays <b>${mv(line.off, line.sans[line.off])}</b>.` : line.sans.length > sans.length ? 'You stayed on the line. This is how it goes on.' : 'You stayed on the line as far as the games go.'}</p>
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
    const a = await evalOf(before.fen()); before.move(r.san);
    const b = await evalOf(before.fen());
    if (me !== run) return;
    const sign = t.me === 'w' ? 1 : -1, drop = Math.max(0, winPct(sign * a.cp) - winPct(sign * b.cp));
    r.kind = drop >= 15 ? 'Blunder' : drop >= 10 ? 'Mistake' : drop >= 5 && !r.book ? 'Inaccuracy' : null; // a quick look is no reason to fault a known theory move for a small loss
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
enableDrag(boardEl, { canDrag: (sq) => view === null && g && myTurn() && g.c.get(sq)?.color === g.me, onDrop: (a, b) => { if (!tryMove(a, b)) draw(); } });
boardEl.addEventListener('click', (e) => {
  if (view !== null) { endWalk(); view = null; return draw(); }
  const sq = e.target.closest('.sq')?.dataset.sq;
  if (!g || !sq || !myTurn()) return;
  if (g.sel && g.sel !== sq && tryMove(g.sel, sq)) return;
  g.sel = g.c.get(sq)?.color === g.me && g.sel !== sq ? sq : null;
  draw();
});
document.addEventListener('keydown', (e) => {
  if (!g || e.target.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (g.walk && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); return stepWalk(e.key === 'ArrowLeft' ? -1 : 1); }
  const n = g.c.history().length, now = view ?? n, to = { ArrowLeft: now - 1, ArrowRight: now + 1, ArrowUp: 0, ArrowDown: n }[e.key];
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
$('#test-best').addEventListener('click', async () => { const b = await bestNow(); if (b) { g.hint = null; g.best = b; draw(); } });
// Your last move goes, with Maia's answer to it; the report made before it no longer holds.
$('#test-back').addEventListener('click', () => {
  if (g.c.turn() === g.me) g.c.undo();
  g.c.undo();
  if (g.off?.ply >= g.c.history().length) g.off = null; // the move that left the line was taken back
  run++; view = null; g.walk = null; $('#test-walk').hidden = true; g.done = false; g.rows = null; g.sel = g.hint = g.best = null;
  $('#test-out').hidden = true; $('#test-status').textContent = 'Your move.';
  draw(); saveGame();
});
$('#test-resign').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Press again to resign'; return; }
  g.done = g.resigned = true; g.sel = g.hint = g.best = null;
  $('#test-status').innerHTML = '<b>You resigned.</b>';
  draw(); saveGame(); report();
});
$('#test-past').addEventListener('click', (e) => { const x = e.target.closest('[data-past]'); if (x) openPast(Number(x.dataset.past)); });
$('#test-report').addEventListener('click', report);
$('#test-new').addEventListener('click', newGame);
document.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => { side = b.dataset.side; try { localStorage.setItem('opening-book-v2-test-side', JSON.stringify(side)); } catch {} newGame(); }));
$('#test-rating').value = rating;
$('#test-rating').addEventListener('change', (e) => { const r = Number(e.target.value); if (r >= 600 && r <= 2800) { rating = r; draw(); } else e.target.value = rating; });

// New, so supporters and admins try it first.
if (window.earlyAccess?.()) { $('#test-game').hidden = false; newGame(); }
else $('#test-gate').innerHTML = '<p class="info">Test my opening is new, and supporters try it first. <a href="supporters.html">See what supporters get</a>.</p>';
