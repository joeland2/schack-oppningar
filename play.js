// Play: real Lichess games on Chess Labs, through Lichess's Board API (admins only while it is tried out).
// The login needs the board:play permission once; then a seek or a challenge starts a game, which Lichess
// streams here move by move. When it ends, the game page reviews it.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard, enableDrag } from './board.js?v=20261104145746';
import { account, login, finishLogin } from './lichess.js?v=20261104145746';
import { openingOf, leftBook } from './book.js?v=20261104145746';

const $ = (s) => document.querySelector(s);
const API = 'https://lichess.org';
// Lichess's Board API: seeks are rapid and slower only (a blitz seek gets "Invalid time control"); a direct
// challenge may also be blitz. Bullet is never allowed. So blitz is for challenging a friend.
const GROUPS = [['Rapid', [[10, 0], [10, 5], [15, 10]]], ['Classical', [[30, 0], [30, 20]]], ['Blitz', [[3, 0], [3, 2], [5, 0], [5, 3]]]];
const blitz = () => tc[0] + tc[1] * 2 / 3 < 8;
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

// ---------- The lobby ----------
let tc = (() => { try { const x = JSON.parse(localStorage.getItem('opening-book-v2-play-tc')); return x && GROUPS.some(([, xs]) => xs.some(([m, i]) => m === x[0] && i === x[1])) ? x : [10, 0]; } catch { return [10, 0]; } })();
function lobby() {
  $('.play-tiles').innerHTML = GROUPS.map(([h, xs]) => `<p class="sups-k">${h}${h === 'Blitz' ? ' <span class="play-only">Friends only</span>' : ''}</p><div class="play-row" role="group" aria-label="${h}">${xs.map(([m, i]) => `<button type="button" class="play-tile" aria-pressed="${m === tc[0] && i === tc[1]}" data-tc="${m}+${i}">${m}+${i}</button>`).join('')}</div>`).join('');
  // Blitz: no search, only a friend; the friend's challenge becomes the main button.
  $('#play-seek').textContent = `Find an opponent · ${tc.join('+')}`;
  $('#play-seek').hidden = blitz();
  $('#play-challenge').textContent = blitz() ? `Challenge a friend · ${tc.join('+')}` : 'Challenge';
  $('#play-challenge').className = blitz() ? 'cta play-go' : 'ghost';
  $('#play-who').placeholder = 'Friend’s Lichess name';
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
// view: how many moves the board shows while you look back with the arrow keys; null is now.
let view = null;
function draw() {
  const all = g.chess.history();
  if (view !== null && view >= all.length) view = null;
  const b = view === null ? g.chess : new Chess();
  if (view !== null) all.slice(0, view).forEach((m) => b.move(m));
  drawBoard(boardEl, b, { side: g.me, sel: view === null ? g.sel : null, last: b.history({ verbose: true }).at(-1) || null, pre: g.pre && view === null ? [g.pre.from, g.pre.to] : [], arrows: g.slip && view === g.slip.ply ? g.slip.arrows : [] });
  boardEl.classList.toggle('looking-back', view !== null);
  [...$('#play-moves').querySelectorAll('[data-ply]')].forEach((x) => x.classList.toggle('now', Number(x.dataset.ply) === (view ?? all.length) - 1));
  const top = g.me === 'w' ? 'b' : 'w';
  for (const [el, c] of [[$('#pl-top'), top], [$('#pl-bot'), g.me]]) {
    const p = c === 'w' ? g.white : g.black;
    el.querySelector('b').innerHTML = `${esc(p.name || p.id || 'Anonymous')} <span>${p.rating || ''}</span>`;
    el.classList.toggle('to-move', g.status === 'started' && g.chess.turn() === c);
  }
  tick();
  const sans = g.chess.history();
  $('#play-moves').innerHTML = sans.reduce((a, s, i) => (i % 2 ? a : [...a, `<li><span data-ply="${i}">${s}</span><span data-ply="${i + 1}">${sans[i + 1] || ''}</span></li>`]), []).join('');
  $('#play-moves').querySelector(`[data-ply="${(view ?? sans.length) - 1}"]`)?.classList.add('now');
  if (g.slip) $('#play-moves').querySelector(`[data-ply="${g.slip.ply}"]`)?.classList.add('slip');
  if (view === null) $('#play-moves').scrollTop = 1e6;
  openingOf(sans.slice(0, 24)).then(([f, v]) => { $('#play-open').innerHTML = `${esc(f)}${v ? `<small>${esc(v)}</small>` : ''}`; });
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
  if (s.status !== 'started') { g.pre = null; return ended(s); }
  $('#play-status').textContent = c.turn() === g.me ? 'Your move.' : '';
  // Your premove, played the moment it is your turn, if it is still legal.
  if (c.turn() === g.me && g.pre) { const p = g.pre; g.pre = null; if (!tryMove(p.from, p.to)) draw(); }
}
function ended(s) {
  const won = s.winner && s.winner[0] === g.me, how = { mate: 'by checkmate', resign: 'by resignation', outoftime: 'on time', timeout: 'as the other left', draw: '', stalemate: 'by stalemate', aborted: '' }[s.status] ?? '';
  const head = s.status === 'aborted' ? 'Game aborted.' : !s.winner ? `Draw${how ? ` ${how}` : ''}.` : `${won ? 'You won' : 'You lost'} ${how}.`;
  $('#play-status').innerHTML = `<b>${head}</b>`;
  if (s.status !== 'aborted') review();
  $('#play-btns').innerHTML = `${s.status === 'aborted' ? '' : `<a class="cta" href="game.html?u=${encodeURIComponent(account().name)}&id=${g.id}">Review this game</a>`}<button type="button" class="ghost" id="play-again">New game · ${tc.join('+')}</button>`;
  $('#play-again').addEventListener('click', () => { g = null; $('#play-game').hidden = true; $('#play-pick').hidden = false; resetBtns(); });
}
// After the game (never during it: Lichess forbids opening books in live games): where the game left known
// theory, whether that was your move, and the opening on the Openings page.
async function review() {
  const sans = g.chess.history(), [f, v] = await openingOf(sans), out = await leftBook(sans);
  const mine = out && (out.ply % 2 === 0) === (g.me === 'w'), mv = (i, san) => `${Math.floor(i / 2) + 1}${i % 2 ? '…' : '.'}${san}`;
  const side = g.me, link = `./?practise=${side}~${encodeURIComponent(f)}`;
  $('#play-review').innerHTML = `<p class="sups-k">Your opening</p><p class="play-open">${esc(f)}${v ? `<small>${esc(v)}</small>` : ''}</p>
    ${!out ? '<p>The game stayed in known theory all through the opening.</p>' : mine
      ? `<p class="play-off bad"><b>${mv(out.ply, out.san)}</b> was your move that left known theory${out.ply ? ` after ${Math.ceil(out.ply / 2)} moves` : ''}. The book plays <b>${out.book.map((b) => mv(out.ply, b)).join('</b> or <b>')}</b>.</p>`
      : `<p class="play-off">Your opponent left known theory with <b>${mv(out.ply, out.san)}</b>; you were still in the book.</p>`}
    ${mine ? '<p class="play-key"><i class="bad"></i>Your move <i class="good"></i>The book <button type="button" class="link" id="play-slip">Show it on the board</button></p>' : ''}
    ${f !== 'Starting position' ? `<p><a class="link" href="${link}">Practise the ${esc(f)} →</a></p>` : ''}`;
  $('#play-review').hidden = false;
  // Your slip on the board: the position before it, your move in red and the book's in green.
  if (mine) {
    const b = new Chess(); sans.slice(0, out.ply).forEach((m) => b.move(m));
    const arrow = (san, c) => { const m = new Chess(b.fen()).move(san); return [m.from, m.to, c]; };
    g.slip = { ply: out.ply, arrows: [...out.book.map((x) => arrow(x, 'var(--good)')), arrow(out.san, 'var(--bad)')] };
    const show = () => { view = g.slip.ply; draw(); };
    $('#play-slip').addEventListener('click', show);
    show();
  }
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
  view = null;
  g = { id, me: 'w', chess: new Chess(), white: {}, black: {}, wtime: 0, btime: 0, at: Date.now(), status: 'started', sel: null };
  $('#play-pick').hidden = true; $('#play-game').hidden = false; $('#play-review').hidden = true; resetBtns();
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
  if (view !== null) { view = null; draw(); return true; } // looking back: a click brings you to now
  if (!g || g.status !== 'started') return false;
  // Not your turn: a premove, kept until the opponent has moved (shown on the board; a click elsewhere drops it).
  if (g.chess.turn() !== g.me) { if (from === to || g.chess.get(from)?.color !== g.me) return false; g.pre = { from, to }; g.sel = null; draw(); return true; }
  let m;
  try { m = g.chess.move({ from, to, promotion: 'q' }); } catch { return false; }
  g.sel = null; draw();
  post(`/api/board/game/${g.id}/move/${m.from}${m.to}${m.promotion || ''}`).catch((e) => { g.chess.undo(); draw(); $('#play-status').textContent = e.message; });
  return true;
}
enableDrag(boardEl, { canDrag: (sq) => view === null && g && g.status === 'started' && g.chess.get(sq)?.color === g.me, onDrop: (f, t) => { if (!tryMove(f, t)) draw(); } });
// ← → step through the moves, ↑ to the start, ↓ back to now; a move in the list jumps there.
const browse = (to) => { if (!g) return; const n = g.chess.history().length; view = to >= n ? null : Math.max(0, to); g.sel = null; draw(); };
document.addEventListener('keydown', (e) => {
  if (!g || e.target.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const n = g.chess.history().length, at = view ?? n;
  const to = { ArrowLeft: at - 1, ArrowRight: at + 1, ArrowUp: 0, ArrowDown: n }[e.key];
  if (to === undefined) return;
  e.preventDefault(); browse(to);
});
$('#play-moves').addEventListener('click', (e) => { const x = e.target.closest('[data-ply]'); if (x && x.textContent) browse(Number(x.dataset.ply) + 1); });
boardEl.addEventListener('contextmenu', (e) => { if (g?.pre) { e.preventDefault(); g.pre = null; draw(); } }); // right-click drops a premove
boardEl.addEventListener('click', (e) => {
  if (view !== null) { view = null; return draw(); }
  const sq = e.target.closest('.sq')?.dataset.sq;
  if (!g || !sq) return;
  if (g.pre && !g.sel) { g.pre = null; if (g.chess.get(sq)?.color !== g.me) return draw(); } // a click drops the premove
  if (g.sel && g.sel !== sq && tryMove(g.sel, sq)) return;
  g.sel = g.chess.get(sq)?.color === g.me && g.sel !== sq ? sq : null;
  draw();
});

// Your friends: the players you follow on Lichess, online ones first; a tap fills in the name.
async function friends() {
  const fs = [];
  try { await stream('/api/rel/following', (x) => fs.push(x), { headers: { Accept: 'application/x-ndjson' } }); } catch { // a login from before follow:read
    $('#play-friends').innerHTML = '<p class="info"><button type="button" class="link" id="play-fr-login">Show my Lichess friends here</button> (Lichess asks once more)</p>';
    return $('#play-fr-login').addEventListener('click', () => login('board:play follow:read'));
  }
  if (!fs.length) return;
  let on = new Set();
  try { on = new Set((await fetch(`${API}/api/users/status?ids=${fs.slice(0, 100).map((f) => f.id).join(',')}`).then((r) => r.json())).filter((x) => x.online).map((x) => x.id)); } catch {}
  fs.sort((x, y) => on.has(y.id) - on.has(x.id));
  $('#play-friends').innerHTML = `<p class="sups-k">Your Lichess friends</p><div class="play-row">${fs.slice(0, 16).map((f) => `<button type="button" class="play-fr${on.has(f.id) ? ' on' : ''}" data-fr="${esc(f.username)}">${esc(f.username)}</button>`).join('')}</div>`;
  $('#play-friends').addEventListener('click', (e) => { const b = e.target.closest('[data-fr]'); if (b) { $('#play-who').value = b.dataset.fr; $('#play-who').focus(); } });
}

// A friend's challenge to you, sent from Chess Labs or from Lichess: accept, and the game starts here for both.
function incoming(c) {
  if (document.querySelector(`[data-ch="${c.id}"]`)) return;
  const tcw = c.timeControl?.limit ? `${c.timeControl.limit / 60}+${c.timeControl.increment}` : c.speed;
  $('#play-incoming').insertAdjacentHTML('beforeend', `<div class="play-ch" data-ch="${esc(c.id)}"><span><b>${esc(c.challenger?.name)}</b> ${c.challenger?.rating ? `(${c.challenger.rating}) ` : ''}challenges you · ${esc(tcw)} · ${c.rated ? 'rated' : 'casual'}</span>
    <button type="button" class="cta play-go" data-acc>Accept</button><button type="button" class="ghost" data-dec>Decline</button></div>`);
  const el = document.querySelector(`[data-ch="${c.id}"]`);
  el.querySelector('[data-acc]').addEventListener('click', () => post(`/api/challenge/${c.id}/accept`).then(() => el.remove()).catch((e) => say(e.message)));
  el.querySelector('[data-dec]').addEventListener('click', () => post(`/api/challenge/${c.id}/decline`).then(() => el.remove()).catch((e) => say(e.message)));
}

// ---------- Start ----------
(async () => {
  try { await finishLogin(); } catch (e) { $('#play-gate').innerHTML = `<p class="info">${esc(e.message)}</p>`; }
  const a = account();
  // Supporters (who try new things first) and the admins, while Play is tried out.
  let sup = null;
  try { sup = JSON.parse(localStorage.getItem('chess-trainer-supporter-me')); } catch {}
  const early = a && (['joelandersson', 'sicko88'].includes(a.name.toLowerCase()) || (sup?.active && sup.name === a.name.toLowerCase() && sup.prefs?.early !== false));
  if (a && !a.site && !early) { $('#play-gate').innerHTML = '<p class="info">Play is new, and supporters try it first. <a href="supporters.html">See what supporters get</a>.</p> <button type="button" class="cta" data-support>Become a supporter</button>'; return; }
  if (!a || a.site) { $('#play-gate').innerHTML = '<p class="info">Playing goes through Lichess. <button type="button" class="cta" id="play-login">Log in with Lichess</button></p>'; }
  else if (!String(a.scope || '').includes('board:play')) {
    $('#play-gate').innerHTML = '<p class="info">To play from here, Lichess asks you once to let Chess Labs play games for you. Your games stay normal Lichess games. <button type="button" class="cta" id="play-login">Allow playing</button></p>';
  } else {
    $('#play-k').textContent = `Rated on Lichess · ${a.name}`;
    $('#play-lobby').hidden = false; lobby(); lastGames(a.name); friends();
    // Every game that starts for you (a seek taken, a challenge accepted, or one still running) arrives here.
    stream('/api/stream/event', (x) => {
      if (x.type === 'gameStart') openGame(x.game.gameId || x.game.id);
      if (x.type === 'challenge' && x.challenge?.destUser?.id === a.name.toLowerCase()) incoming(x.challenge);
      if (x.type === 'challengeCanceled' || x.type === 'challengeDeclined') document.querySelector(`[data-ch="${x.challenge?.id}"]`)?.remove();
    })
      .catch((e) => say(e.message));
  }
  $('#play-login')?.addEventListener('click', () => login('board:play follow:read'));
})();
