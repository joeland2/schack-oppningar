// Play: real Lichess games on Chess Labs, through Lichess's Board API (admins only while it is tried out).
// The login needs the board:play permission once; then a seek or a challenge starts a game, which Lichess
// streams here move by move. When it ends, the game page reviews it.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard, enableDrag } from './board.js?v=20261102153259';
import { account, login, finishLogin } from './lichess.js?v=20261102153259';

const $ = (s) => document.querySelector(s);
const API = 'https://lichess.org';
// No blitz or bullet: Lichess lets outside sites play rapid and slower only (a blitz seek gets "Invalid time control").
const GROUPS = [['Rapid', [[10, 0], [10, 5], [15, 10]]], ['Classical', [[30, 0], [30, 20]]]];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const auth = () => ({ Authorization: `Bearer ${account()?.token}` });
// Lichess's error in words: { error: '…' }, or a form's errors as { field: ['…'] }.
async function why(r) {
  const t = await r.text().catch(() => '');
  let x = {}; try { x = JSON.parse(t); } catch {}
  const e = x.error ?? x.global ?? x;
  const s = typeof e === 'string' ? e : Object.values(e || {}).flat().join(' ') || t.slice(0, 200);
  return `${s || 'Lichess said no'} (${r.status})`;
}
const say = (t) => { $('#play-msg').textContent = t; };

// Lichess streams answers as one JSON object per line; onLine gets each one.
async function stream(url, onLine, opts = {}) {
  const r = await fetch(API + url, { ...opts, headers: { ...auth(), ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(await why(r));
  const rd = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await rd.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(JSON.parse(line)); }
  }
}
const post = (url, body) => fetch(API + url, { method: 'POST', headers: auth(), body: body && new URLSearchParams(body) })
  .then(async (r) => { if (!r.ok) throw new Error(await why(r)); });

// Opening names (lichess-org/chess-openings, as on the Openings page): the longest named line the game follows.
let BOOK = null;
const loadBook = () => (BOOK ??= Promise.all([...'abcde'].map((f) => fetch(`data/${f}.tsv`).then((r) => r.text()))).then((ts) => {
  const m = new Map();
  for (const row of ts.flatMap((t) => t.trim().split('\n').slice(1))) { const [, name, pgn] = row.split('\t'); m.set(pgn.replace(/\d+\.\s*/g, '').trim().replace(/[+#]/g, ''), name); }
  return m;
}));
async function openingOf(sans) {
  const names = await loadBook();
  for (let n = sans.length; n > 0; n--) { const hit = names.get(sans.slice(0, n).join(' ').replace(/[+#]/g, '')); if (hit) return hit; }
  return 'Starting position';
}

// ---------- The lobby ----------
let tc = (() => { try { const x = JSON.parse(localStorage.getItem('opening-book-v2-play-tc')); return x && GROUPS.some(([, xs]) => xs.some(([m, i]) => m === x[0] && i === x[1])) ? x : [10, 0]; } catch { return [10, 0]; } })();
function lobby() {
  $('.play-tiles').innerHTML = GROUPS.map(([h, xs]) => `<p class="sups-k">${h}</p><div class="play-row" role="group" aria-label="${h}">${xs.map(([m, i]) => `<button type="button" class="play-tile" aria-pressed="${m === tc[0] && i === tc[1]}" data-tc="${m}+${i}">${m}+${i}</button>`).join('')}</div>`).join('');
  $('#play-seek').textContent = `Find an opponent · ${tc.join('+')}`;
}
$('.play-tiles').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tc]');
  if (!b) return;
  tc = b.dataset.tc.split('+').map(Number);
  try { localStorage.setItem('opening-book-v2-play-tc', JSON.stringify(tc)); } catch {}
  lobby();
});
let seeking = null; // the open seek's AbortController: Lichess keeps the request open until someone takes it
$('#play-seek').addEventListener('click', async () => {
  if (seeking) { seeking.abort(); return; }
  seeking = new AbortController();
  $('#play-seek').textContent = 'Searching… press to stop';
  say('Looking for someone at your level. The game starts as soon as one is found.');
  try {
    await stream('/api/board/seek', () => {}, { method: 'POST', body: new URLSearchParams({ time: tc[0], increment: tc[1], rated: $('#play-rated').checked }), signal: seeking.signal });
    if (!g) say('Lichess closed the search without a game. Try again, or another time control.');
  } catch (e) { say(e.name === 'AbortError' ? 'Search stopped.' : `Could not search: ${e.message}`); }
  seeking = null; lobby();
});
$('#play-challenge').addEventListener('click', async () => {
  const who = $('#play-who').value.trim();
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(who)) return say('Type your friend’s Lichess name.');
  try {
    await post(`/api/challenge/${who}`, { rated: $('#play-rated').checked, 'clock.limit': tc[0] * 60, 'clock.increment': tc[1] });
    say(`Challenge sent to ${who}. The game starts here when they accept it on Lichess.`);
  } catch (e) { say(e.message); }
});

// Your last games on Lichess and today's rating change, beside the time controls.
async function lastGames(name) {
  $('#play-aside').hidden = false;
  const gs = [];
  try { await stream(`/api/games/user/${encodeURIComponent(name)}?max=6&opening=true&moves=false`, (x) => gs.push(x), { headers: { Accept: 'application/x-ndjson' } }); } catch {}
  const me = name.toLowerCase(), side = (x) => (x.players.white.user?.id === me ? 'white' : 'black');
  const today = gs.filter((x) => new Date(x.createdAt).toDateString() === new Date().toDateString());
  const diff = today.reduce((n, x) => n + (x.players[side(x)].ratingDiff || 0), 0);
  const won = today.filter((x) => x.winner === side(x)).length, lost = today.filter((x) => x.winner && x.winner !== side(x)).length;
  $('#play-today').innerHTML = today.length ? `<b class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : '−'}${Math.abs(diff)}</b><span>${won} won · ${lost} lost</span>` : '<span>No games yet today</span>';
  $('#play-last').innerHTML = gs.length ? gs.map((x) => {
    const s = side(x), o = x.players[s === 'white' ? 'black' : 'white'], r = !x.winner ? 'd' : x.winner === s ? 'w' : 'l';
    return `<li><a href="game.html?u=${encodeURIComponent(name)}&id=${x.id}"><span class="chip r-${r}">${{ w: 'Won', l: 'Lost', d: 'Draw' }[r]}</span> <b>${esc(o.user?.name || 'Anonymous')}</b><small>${esc((x.opening?.name || '').split(':')[0])} · ${x.clock ? `${x.clock.initial / 60}+${x.clock.increment}` : x.speed}</small></a></li>`;
  }).join('') : '<li class="info">No games yet.</li>';
}

// ---------- A game ----------
let g = null; // { id, me ('w'|'b'), chess, white, black, wtime, btime, at, status, sel }
const boardEl = $('#board');
const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s < 60 && ms < 20000 ? (ms / 1000).toFixed(1) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function draw() {
  const last = g.chess.history({ verbose: true }).at(-1);
  drawBoard(boardEl, g.chess, { side: g.me, sel: g.sel, last });
  const top = g.me === 'w' ? 'b' : 'w';
  for (const [el, c] of [[$('#pl-top'), top], [$('#pl-bot'), g.me]]) {
    const p = c === 'w' ? g.white : g.black;
    el.querySelector('b').innerHTML = `${esc(p.name || p.id || 'Anonymous')} <span>${p.rating || ''}</span>`;
    el.classList.toggle('to-move', g.status === 'started' && g.chess.turn() === c);
  }
  tick();
  const sans = g.chess.history();
  $('#play-moves').innerHTML = sans.reduce((a, s, i) => (i % 2 ? a : [...a, `<li><span>${s}</span><span>${sans[i + 1] || ''}</span></li>`]), []).join('');
  $('#play-moves').scrollTop = 1e6;
  openingOf(sans.slice(0, 24)).then((n) => { $('#play-open').textContent = n; });
}
function tick() {
  if (!g) return;
  const run = g.status === 'started' && g.chess.history().length >= 2, gone = run ? Date.now() - g.at : 0;
  const t = { w: g.wtime - (g.chess.turn() === 'w' ? gone : 0), b: g.btime - (g.chess.turn() === 'b' ? gone : 0) };
  $('#pl-top .play-clock').textContent = clock(t[g.me === 'w' ? 'b' : 'w']);
  $('#pl-bot .play-clock').textContent = clock(t[g.me]);
}
setInterval(tick, 200);

function setState(s) {
  const c = new Chess();
  for (const u of s.moves ? s.moves.split(' ') : []) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  g.chess = c; g.wtime = s.wtime; g.btime = s.btime; g.at = Date.now(); g.status = s.status; g.sel = null;
  draw();
  if (s.status !== 'started') ended(s);
  else $('#play-status').textContent = c.turn() === g.me ? 'Your move.' : '';
}
function ended(s) {
  const won = s.winner && s.winner[0] === g.me, how = { mate: 'by checkmate', resign: 'by resignation', outoftime: 'on time', timeout: 'as the other left', draw: '', stalemate: 'by stalemate', aborted: '' }[s.status] ?? '';
  const head = s.status === 'aborted' ? 'Game aborted.' : !s.winner ? `Draw${how ? ` ${how}` : ''}.` : `${won ? 'You won' : 'You lost'} ${how}.`;
  $('#play-status').innerHTML = `<b>${head}</b>`;
  $('#play-btns').innerHTML = `${s.status === 'aborted' ? '' : `<a class="cta" href="game.html?u=${encodeURIComponent(account().name)}&id=${g.id}">Review this game</a>`}<button type="button" class="ghost" id="play-again">New game · ${tc.join('+')}</button>`;
  $('#play-again').addEventListener('click', () => { g = null; $('#play-game').hidden = true; $('#play-pick').hidden = false; resetBtns(); });
}
function resetBtns() {
  $('#play-btns').innerHTML = '<button type="button" class="ghost" id="play-draw">Offer draw</button><button type="button" class="ghost" id="play-resign">Resign</button>';
  $('#play-draw').addEventListener('click', () => post(`/api/board/game/${g.id}/draw/yes`).then(() => { $('#play-status').textContent = 'Draw offered.'; }).catch((e) => { $('#play-status').textContent = e.message; }));
  $('#play-resign').addEventListener('click', (e) => {
    if (e.currentTarget.dataset.sure !== '1') { e.currentTarget.dataset.sure = '1'; e.currentTarget.textContent = 'Press again to resign'; return; }
    post(`/api/board/game/${g.id}/resign`).catch((x) => { $('#play-status').textContent = x.message; });
  });
}
async function openGame(id) {
  if (g?.id === id) return;
  g = { id, me: 'w', chess: new Chess(), white: {}, black: {}, wtime: 0, btime: 0, at: Date.now(), status: 'started', sel: null };
  $('#play-pick').hidden = true; $('#play-game').hidden = false; resetBtns();
  $('#play-status').textContent = 'Starting…';
  try {
    await stream(`/api/board/game/stream/${id}`, (x) => {
      if (x.type === 'gameFull') {
        g.white = x.white; g.black = x.black;
        g.me = x.black?.id === account().name.toLowerCase() ? 'b' : 'w';
        setState(x.state);
      } else if (x.type === 'gameState') setState(x);
      else if (x.type === 'opponentGone' && x.gone) $('#play-status').textContent = 'Your opponent left. You can claim the win on Lichess if they do not come back.';
    });
  } catch (e) { $('#play-status').textContent = e.message; }
}
function tryMove(from, to) {
  if (!g || g.status !== 'started' || g.chess.turn() !== g.me) return false;
  let m;
  try { m = g.chess.move({ from, to, promotion: 'q' }); } catch { return false; }
  g.sel = null; draw();
  post(`/api/board/game/${g.id}/move/${m.from}${m.to}${m.promotion || ''}`).catch((e) => { g.chess.undo(); draw(); $('#play-status').textContent = e.message; });
  return true;
}
enableDrag(boardEl, { canDrag: (sq) => g && g.status === 'started' && g.chess.turn() === g.me && g.chess.get(sq)?.color === g.me, onDrop: (f, t) => { if (!tryMove(f, t)) draw(); } });
boardEl.addEventListener('click', (e) => {
  const sq = e.target.closest('.sq')?.dataset.sq;
  if (!g || !sq) return;
  if (g.sel && g.sel !== sq && tryMove(g.sel, sq)) return;
  g.sel = g.chess.get(sq)?.color === g.me && g.sel !== sq ? sq : null;
  draw();
});

// ---------- Start ----------
(async () => {
  try { await finishLogin(); } catch (e) { $('#play-gate').innerHTML = `<p class="info">${esc(e.message)}</p>`; }
  const a = account();
  if (!a || a.site) { $('#play-gate').innerHTML = '<p class="info">Playing goes through Lichess. <button type="button" class="cta" id="play-login">Log in with Lichess</button></p>'; }
  else if (!String(a.scope || '').includes('board:play')) {
    $('#play-gate').innerHTML = '<p class="info">To play from here, Lichess asks you once to let Chess Labs play games for you. Your games stay normal Lichess games. <button type="button" class="cta" id="play-login">Allow playing</button></p>';
  } else {
    $('#play-k').textContent = `Rated on Lichess · ${a.name}`;
    $('#play-lobby').hidden = false; lobby(); lastGames(a.name);
    // Every game that starts for you (a seek taken, a challenge accepted, or one still running) arrives here.
    stream('/api/stream/event', (x) => { if (x.type === 'gameStart') openGame(x.game.gameId || x.game.id); })
      .catch((e) => say(e.message));
  }
  $('#play-login')?.addEventListener('click', () => login('board:play'));
})();
