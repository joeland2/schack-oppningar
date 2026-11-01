// Spot the blunder: a few moves from one of your own games play out on the board, and one of yours was
// a blunder. Pick it. From the slips Find my mistakes and your analysed games have found (the puzzles
// on mistakes.html), with the game's moves from the games kept in this browser.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';
import { drawBoard } from './board.js?v=20261101212412';
import { THEMES } from './mistakes.js?v=20261101212412';

const SEEN = 'opening-book-v2-blunder-seen'; // the ones already shown, so the next is a new one while any are left
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const gameId = (url) => url.split('/')[3].split('#')[0];
const label = (ply, san) => `${Math.floor(ply / 2) + 1}${ply % 2 ? '…' : '.'}${san}`;
console.assert(label(12, 'Nxd4') === '7.Nxd4' && label(13, 'exd4') === '7…exd4' && gameId('https://lichess.org/abc123/black#14') === 'abc123', 'blunder labels');

// The slips worth a round: clear blunders whose game is still kept here.
export function blunders(puzzles, games) {
  const byId = new Map(games.map((g) => [g.id, g]));
  return puzzles.filter((f) => (f.loss ?? 15) >= 15 && byId.get(gameId(f.url))?.moves).map((f) => ({ ...f, moves: byId.get(gameId(f.url)).moves.split(' ') }));
}

// el gets the round; all: from blunders(). The blunder is your 2nd, 3rd or 4th move of five shown.
export function spotTheBlunder(el, all) {
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(SEEN)) || []; } catch {}
  let timer;
  function round() {
    clearTimeout(timer);
    const fresh = all.filter((f) => !seen.includes(f.url));
    const pool = fresh.length ? fresh : all;
    const f = pool[Math.floor(Math.random() * pool.length)];
    seen = fresh.length ? [...seen, f.url] : [f.url];
    try { localStorage.setItem(SEEN, JSON.stringify(seen)); } catch {}
    const k = Math.min(1 + Math.floor(Math.random() * 3), Math.floor(f.ply / 2)); // your moves before it
    const from = f.ply - 2 * k, plies = f.moves.slice(from, from + 10).map((san, i) => ({ ply: from + i, san }));
    const others = new Set(all.filter((x) => x.url !== f.url && gameId(x.url) === gameId(f.url)).map((x) => x.ply));
    const game = new Chess();
    for (const san of f.moves.slice(0, from)) game.move(san);
    const start = game.fen();
    el.innerHTML = `<div class="bd">
      <div class="bd-board board" role="img" aria-label="The game's position"></div>
      <div class="bd-side">
        <p class="bd-k">From your game${f.opening ? `: ${esc(f.opening.split(':')[0])}` : ''}</p>
        <p class="bd-msg" aria-live="polite">Watch the moves. One of yours is a blunder.</p>
        <ol class="bd-moves">${plies.map((p) => `<li><button type="button" class="chip-btn" data-ply="${p.ply}" ${p.ply % 2 === f.ply % 2 ? '' : 'disabled'} hidden>${esc(label(p.ply, p.san))}</button></li>`).join('')}</ol>
        <p class="bd-acts"><button type="button" class="ghost bd-replay">Replay</button> <button type="button" class="ghost bd-next">Next game</button></p>
      </div></div>`;
    const board = el.querySelector('.bd-board'), msg = el.querySelector('.bd-msg'), chips = [...el.querySelectorAll('.bd-moves button')];
    let done = false, caught = false, misses = 0;
    // The moves one by one, about a second apart, each chip showing as its move is played.
    function play() {
      clearTimeout(timer);
      const g = new Chess(start);
      chips.forEach((c) => { c.hidden = true; });
      drawBoard(board, g, { side: f.side });
      let i = 0;
      const next = () => {
        if (i >= plies.length) { if (done) reveal(caught); else msg.textContent = 'Which of your moves was the blunder?'; return; }
        let m;
        try { m = g.move(plies[i].san); } catch { return; }
        chips[i].hidden = false;
        drawBoard(board, g, { side: f.side, last: m });
        i++;
        timer = setTimeout(next, 900);
      };
      timer = setTimeout(next, 600);
    }
    // The position before the blunder, with the better move drawn in.
    function reveal(ok) {
      clearTimeout(timer);
      done = true; caught = ok;
      const g = new Chess(f.fen), best = new Chess(f.fen).move(f.best);
      drawBoard(board, g, { side: f.side, arrow: [best.from, best.to] });
      chips.forEach((c) => { c.disabled = true; c.hidden = false; if (+c.dataset.ply === f.ply) c.classList.add('bd-hit'); });
      msg.innerHTML = `${ok ? '<b>Caught it!</b> ' : ''}<b>${esc(label(f.ply, f.played))}??</b> was the blunder. <b>${esc(f.best)}</b> was the move here. ${esc(THEMES[f.theme]?.tip || '')}`;
    }
    chips.forEach((c) => c.addEventListener('click', () => {
      const ply = +c.dataset.ply;
      if (ply === f.ply) return reveal(misses === 0);
      c.disabled = true; c.classList.add('bd-miss');
      misses++;
      if (misses >= 2) return reveal(false);
      msg.textContent = others.has(ply) ? 'That one was a slip too, but not the big one. Try again.' : `${c.textContent} was fine. Try again.`;
    }));
    el.querySelector('.bd-replay').addEventListener('click', play);
    el.querySelector('.bd-next').addEventListener('click', round);
    play();
  }
  round();
}
