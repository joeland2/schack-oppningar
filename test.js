// Test my opening: a game against Maia 3 at your rating, then what the opening is called, where you went
// wrong and how it scores at your level. Nothing leaves the browser: the games are the site's own data files.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard, enableDrag } from './board.js?v=20261104133132';
import { engineEval, winPct } from './profile.js?v=20261104133132';
import { openingOf, leftBook, loadBook, key } from './book.js?v=20261104133132';

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
function draw() {
  const all = g.c.history({ verbose: true }), sans = all.map((m) => m.san);
  const b = view === null ? g.c : new Chess();
  if (view !== null) sans.slice(0, view).forEach((m) => b.move(m));
  drawBoard(boardEl, b, { side: g.me, sel: view === null ? g.sel : null, last: view === null || view ? (view === null ? all.at(-1) : all[view - 1]) : null, arrows: view !== null ? g.arrows || [] : [] });
  boardEl.classList.toggle('looking-back', view !== null);
  $('#test-moves').innerHTML = sans.reduce((a, s, i) => (i % 2 ? a : [...a, `<li><span data-ply="${i}">${s}</span><span data-ply="${i + 1}">${sans[i + 1] || ''}</span></li>`]), []).join('');
  $('#test-moves').querySelector(`[data-ply="${(view ?? sans.length) - 1}"]`)?.classList.add('now');
  if (view === null) $('#test-moves').scrollTop = 1e6;
  $('#test-report').disabled = sans.length < (g.me === 'w' ? 1 : 2); // once you have played a move
  openingOf(sans.slice(0, 24)).then(([f, v]) => { $('#test-open').innerHTML = `${esc(f)}${v ? `<small>${esc(v)}</small>` : ''}`; });
  $('#test-maia').textContent = rating;
}
function over() {
  if (!g.c.isGameOver()) return false;
  const lost = g.c.isCheckmate() && g.c.turn() === g.me;
  $('#test-status').innerHTML = `<b>${g.c.isCheckmate() ? (lost ? 'Maia won by checkmate.' : 'You won by checkmate.') : 'Draw.'}</b>`;
  report();
  return true;
}
// Maia 3 at your rating; Maia 1 if it cannot load, then Stockfish. The nets are big, so they load on the first move only.
async function maiaPlays() {
  const t = g, fen = t.c.fen(), legal = t.c.moves({ verbose: true });
  t.busy = true; $('#test-status').textContent = t.c.history().length < 2 ? 'Maia 3 is waking up: the first move takes a moment…' : 'Maia 3 is thinking…';
  const { maia3Move } = await import('./maia3.js?v=20261104133132'), { maiaMove, MAIA_MAX } = await import('./maia.js?v=20261104133132');
  let r = null;
  try { r = (await within(20000, maia3Move(fen, legal, rating, rating))).move; } catch (e) { console.warn(e); }
  if (!r && rating < MAIA_MAX + 100) try { r = (await within(15000, maiaMove(rating, [fen], legal))).move; } catch (e) { console.warn(e); }
  if (!r) { const e = await engineEval(fen); r = e.best && { from: e.best.slice(0, 2), to: e.best.slice(2, 4), promotion: e.best[4] }; }
  if (g !== t) return; // a new game began while Maia thought
  t.busy = false; $('#test-status').textContent = 'Your move.';
  t.c.move({ from: r.from, to: r.to, promotion: r.promotion || 'q' });
  draw(); over();
}
function tryMove(from, to) {
  if (!g || g.busy || g.c.turn() !== g.me) return false;
  try { g.c.move({ from, to, promotion: 'q' }); } catch { return false; }
  g.sel = null; draw();
  if (!over()) maiaPlays();
  return true;
}
function newGame() {
  run++; view = null;
  g = { me: side, c: new Chess(), sel: null, busy: false, arrows: null };
  $('#test-out').hidden = true;
  document.querySelectorAll('[data-side]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.side === side));
  $('#test-status').textContent = 'Your move.';
  draw();
  if (side === 'b') maiaPlays();
}

// ---------- The report ----------
const evals = new Map();
const evalOf = (fen) => { if (!evals.has(fen)) evals.set(fen, engineEval(fen)); return evals.get(fen); };
async function report() {
  const me = ++run, t = g, colour = t.me === 'w' ? 'White' : 'Black', sans = t.c.history(), hist = t.c.history({ verbose: true });
  const out = $('#test-out'), [tree, { next }] = await Promise.all([TREE, loadBook()]), [f, v] = await openingOf(sans.slice(0, 24));
  const off = await leftBook(sans);
  const mine = off && (off.ply % 2 === 0) === (t.me === 'w');
  // How good: the deepest position of your game that enough players at your level reached.
  let at = 0, here = null;
  for (let n = Math.min(sans.length, 20); n > 0 && !here; n--) { const node = nodeAt(tree, sans.slice(0, n)), s = node && stat(node, level()); if (s?.n >= FEW_GAMES) { here = s; at = n; } }
  const base = stat(tree, level()), [hf, hv] = here ? await openingOf(sans.slice(0, at)) : [];
  const gap = here ? Math.round((forMe(here, t.me) - forMe(base, t.me)) * 100) : 0;
  const good = !here ? `<p>Too few games at your level (${levelText()}) reach this position to say how good it is.</p>`
    : `<p class="sups-k">At your level, ${levelText()}</p><p class="test-big">${pct(forMe(here, t.me))}</p>
       <p>What ${colour} scores after ${mv(at - 1, sans[at - 1])}${hv || hf !== f ? ` (${esc(hv || hf)})` : ''}, in ${here.n.toLocaleString('en')} games. ${Math.abs(gap) < 2 ? `About the average for ${colour} (${pct(forMe(base, t.me))}).` : `${Math.abs(gap)} points ${gap > 0 ? 'above' : 'below'} the ${pct(forMe(base, t.me))} ${colour} scores on average.`}</p>`;
  // Your moves, with what the games say; Stockfish's verdict fills in below.
  const rows = [];
  sans.forEach((san, i) => {
    if ((i % 2 === 0) !== (t.me === 'w') || rows.length >= MINE) return;
    const node = nodeAt(tree, sans.slice(0, i)), kids = Object.entries(node?.[3] || {});
    const lv = kids.map(([m, c]) => ({ san: m, ...stat(c, level()), top: stat(c, strong()).n }));
    const you = lv.find((m) => m.san === clean(san)), topAll = lv.reduce((s, m) => s + m.top, 0);
    const alt = you?.n >= FEW_GAMES ? lv.filter((m) => m.san !== clean(san) && m.n >= FEW_GAMES && m.top / topAll >= 0.1 && forMe(m, t.me) - forMe(you, t.me) >= 0.05).sort((a, b) => forMe(b, t.me) - forMe(a, t.me))[0] : null;
    const notes = [next.get(key(sans.slice(0, i)))?.has(clean(san)) ? 'Book' : null,
      you?.n >= FEW_GAMES ? `scores ${pct(forMe(you, t.me))} in ${you.n.toLocaleString('en')} games` : 'too few games to say',
      alt ? `${mv(i, alt.san)} scores ${pct(forMe(alt, t.me))}` : null].filter(Boolean);
    rows.push({ i, san, m: hist[i], note: notes.join(' · ') });
  });
  const list = () => rows.map((r) => `<li class="${r.kind ? 'bad' : ''}"><button type="button" data-row="${r.i}"><b>${mv(r.i, r.san)}${r.kind ? (r.kind === 'Blunder' ? '??' : r.kind === 'Mistake' ? '?' : '?!') : ''}</b><small>${r.kind ? `${r.kind} · ` : ''}${esc(r.note)}</small></button></li>`).join('');
  const paint = (verdict) => {
    if (me !== run) return;
    out.innerHTML = `<p class="sups-k">Your opening</p><p class="play-open">${esc(f)}${v ? `<small>${esc(v)}</small>` : ''}</p>
      ${good}${verdict}
      ${!off ? '<p>The game stayed in known theory all the way.</p>' : mine ? `<p>You left known theory with <b>${mv(off.ply, off.san)}</b>. The book plays <b>${off.book.map((b) => mv(off.ply, b)).join(', ')}</b>.</p>` : `<p>Maia left known theory with <b>${mv(off.ply, off.san)}</b>; you were still in the book.</p>`}
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
    r.kind = drop >= 15 ? 'Blunder' : drop >= 10 ? 'Mistake' : drop >= 5 ? 'Inaccuracy' : null;
    if (r.kind && a.best && a.best !== r.m.from + r.m.to + (r.m.promotion || '')) {
      const c = new Chess(); sans.slice(0, r.i).forEach((m) => c.move(m));
      r.best = c.move({ from: a.best.slice(0, 2), to: a.best.slice(2, 4), promotion: a.best[4] || 'q' });
    }
  }
  const slip = rows.find((r) => r.kind === 'Blunder' || r.kind === 'Mistake') || rows.find((r) => r.kind);
  paint(slip ? `<p class="test-wrong"><b>Where it went wrong: ${mv(slip.i, slip.san)}</b>. ${slip.kind}${slip.best ? `; Stockfish prefers <b>${mv(slip.i, slip.best.san)}</b>` : ''}. <button type="button" class="link" data-row="${slip.i}">Show it on the board</button></p>`
    : `<p class="test-fine"><b>No slips.</b> Stockfish found nothing wrong with your ${rows.length} move${rows.length === 1 ? '' : 's'}.</p>`);
  t.rows = rows;
}

// ---------- Input ----------
function showRow(i) {
  const r = g.rows?.find((x) => x.i === i);
  view = i; g.sel = null;
  g.arrows = r ? [[r.m.from, r.m.to, 'var(--bad)'], ...(r.best ? [[r.best.from, r.best.to, 'var(--good)']] : [])] : null;
  draw();
}
const browse = (to) => { const n = g.c.history().length; view = to >= n ? null : Math.max(0, to); g.sel = null; g.arrows = null; draw(); };
enableDrag(boardEl, { canDrag: (sq) => view === null && g && !g.busy && g.c.turn() === g.me && g.c.get(sq)?.color === g.me, onDrop: (a, b) => { if (!tryMove(a, b)) draw(); } });
boardEl.addEventListener('click', (e) => {
  if (view !== null) { view = null; return draw(); }
  const sq = e.target.closest('.sq')?.dataset.sq;
  if (!g || !sq) return;
  if (g.sel && g.sel !== sq && tryMove(g.sel, sq)) return;
  g.sel = g.c.get(sq)?.color === g.me && g.sel !== sq ? sq : null;
  draw();
});
document.addEventListener('keydown', (e) => {
  if (!g || e.target.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const n = g.c.history().length, now = view ?? n, to = { ArrowLeft: now - 1, ArrowRight: now + 1, ArrowUp: 0, ArrowDown: n }[e.key];
  if (to !== undefined) { e.preventDefault(); browse(to); }
});
$('#test-moves').addEventListener('click', (e) => { const x = e.target.closest('[data-ply]'); if (x?.textContent) browse(Number(x.dataset.ply) + 1); });
$('#test-out').addEventListener('click', (e) => { const x = e.target.closest('[data-row]'); if (x) showRow(Number(x.dataset.row)); });
$('#test-report').addEventListener('click', report);
$('#test-new').addEventListener('click', newGame);
document.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => { side = b.dataset.side; try { localStorage.setItem('opening-book-v2-test-side', JSON.stringify(side)); } catch {} newGame(); }));
$('#test-rating').value = rating;
$('#test-rating').addEventListener('change', (e) => { const r = Number(e.target.value); if (r >= 600 && r <= 2800) { rating = r; draw(); } else e.target.value = rating; });

// New, so supporters and admins try it first.
if (window.earlyAccess?.()) { $('#test-game').hidden = false; newGame(); }
else $('#test-gate').innerHTML = '<p class="info">Test my opening is new, and supporters try it first. <a href="supporters.html">See what supporters get</a>.</p>';
