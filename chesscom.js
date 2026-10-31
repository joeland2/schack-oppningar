// Chess.com players: their games from chess.com's public API, made over into Lichess's shape so the
// profile reads them like any other. A chess.com player is the name with cc: before it (cc:hikaru),
// everywhere a name is kept or linked, so the two sites' players never mix; nick() is the name shown.
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm';

export const isCC = (name) => /^cc:/i.test(String(name));
export const nick = (name) => String(name).replace(/^cc:/i, '');
export const siteOf = (name) => (isCC(name) ? 'Chess.com' : 'Lichess');
export const ccUrl = (name) => `https://www.chess.com/member/${encodeURIComponent(nick(name))}`;
export const ccGameUrl = (id) => `https://www.chess.com/game/live/${id}`;
const API = 'https://api.chess.com/pub/player/';
const SPEEDS = ['bullet', 'blitz', 'rapid'];

// Opening names as Lichess gives them, found by position (so a transposition gets its name too): the
// last position of the game, within the first 40 moves, that the Lichess opening list (data/a-e.tsv) names.
let NAMES = null;
const key = (c) => c.fen().split(' ').slice(0, 3).join(' ');
const openingNames = () => (NAMES ??= Promise.all('abcde'.split('').map((f) => fetch(`data/${f}.tsv`).then((r) => r.text()))).then((files) => {
  const m = new Map();
  for (const line of files.join('\n').split('\n')) {
    const [eco, name, pgn] = line.split('\t');
    if (!pgn || eco === 'eco') continue;
    const c = new Chess();
    try { for (const t of pgn.split(' ')) if (!/^\d+\.$/.test(t)) c.move(t); } catch { continue; }
    m.set(key(c), name);
  }
  return m;
}));

// A chess.com game's moves and the clock after each (in centiseconds, as Lichess's clocks).
export function readPgn(pgn) {
  const body = pgn.replace(/^\[.*\]\s*$/gm, '');
  const moves = [], clocks = [];
  for (const m of body.matchAll(/\{[^}]*\}|[^\s{}]+/g)) {
    const t = m[0];
    if (t[0] === '{') { const c = t.match(/%clk (\d+):(\d+):([\d.]+)/); if (c && clocks.length < moves.length) clocks.push(Math.round(((+c[1] * 60 + +c[2]) * 60 + +c[3]) * 100)); }
    else if (!/^\d+\.+$|^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) moves.push(t);
  }
  return { moves, clocks: clocks.length === moves.length ? clocks : [] };
}
console.assert(((r) => r.moves.join() === 'e4,e5,Nf3' && r.clocks.join() === '18000,17950,17500')(readPgn('[Event "x"]\n\n1. e4 {[%clk 0:03:00]} 1... e5 {[%clk 0:02:59.5]} 2. Nf3 {[%clk 0:02:55]} 1-0')), 'readPgn');

// How a game ended, in Lichess's words, from the loser's result (or a draw's).
const LOST = { checkmated: 'mate', resigned: 'resign', timeout: 'outoftime', abandoned: 'timeout' };
function convert(g, names) {
  const { moves, clocks } = readPgn(g.pgn || '');
  const c = new Chess();
  let name;
  for (const m of moves.slice(0, 80)) { try { c.move(m); } catch { break; } name = names.get(key(c)) || name; }
  const w = g.white, b = g.black, winner = w.result === 'win' ? 'white' : b.result === 'win' ? 'black' : undefined;
  const loser = winner === 'white' ? b : winner === 'black' ? w : null;
  const player = (x) => ({ user: { id: `cc:${x.username.toLowerCase()}` }, rating: x.rating });
  return { id: g.url.split('/').pop(), variant: 'standard', speed: g.time_class, createdAt: g.end_time * 1000,
    status: loser ? LOST[loser.result] || 'resign' : w.result === 'stalemate' ? 'stalemate' : 'draw', winner,
    moves: moves.join(' '), opening: name ? { name } : undefined, clock: { initial: parseInt(g.time_control, 10) }, clocks,
    players: { white: player(w), black: player(b) } };
}

// The player's last max rated games (newest first), in the time controls asked for, played after since;
// the same calls as Lichess's fetchGames in profile.js, onGame after each game read.
export async function fetchCC(name, onGame, since, perf, max) {
  const u = nick(name).toLowerCase(), want = new Set(perf.split(','));
  const res = await fetch(`${API}${encodeURIComponent(u)}/games/archives`);
  if (res.status === 404) throw new Error(`Chess.com has no player called ${nick(name)}.`);
  if (res.status === 429) throw new Error('Chess.com is busy right now. Try again in a minute.');
  if (!res.ok) throw new Error(`Chess.com answered with an error (${res.status}).`);
  // chess.com now and then answers with an empty body: a month that cannot be read is skipped.
  const list = await res.json().catch(() => null);
  if (!list) throw new Error('Chess.com did not answer properly. Try again in a minute.');
  const months = (list.archives || []).reverse(), names = await openingNames(), games = [];
  for (const url of months) {
    if (games.length >= max) break;
    const [y, mo] = url.split('/').slice(-2).map(Number);
    if (since && Date.UTC(y, mo, 1) < since) break; // the month ended before the newest game kept
    const month = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    for (const g of (month?.games || []).reverse()) {
      if (games.length >= max) break;
      if (!g.rated || g.rules !== 'chess' || !want.has(g.time_class) || !g.pgn || (since && g.end_time * 1000 < since)) continue;
      games.push(convert(g, names)); onGame(games.length, games);
    }
  }
  return games;
}

// Games per time control and the country, as Lichess's user call gives them to perfsOf.
export async function ccUser(name) {
  const u = encodeURIComponent(nick(name).toLowerCase());
  const [st, pl] = await Promise.all([fetch(`${API}${u}/stats`), fetch(`${API}${u}`)].map((p) => p.then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  if (!st) return null;
  const n = (x) => (x ? x.win + x.loss + x.draw : 0);
  return { flag: pl?.country?.split('/').pop(), games: Object.fromEntries([...SPEEDS.map((sp) => [sp, n(st[`chess_${sp}`]?.record)]), ['classical', 0]]) };
}

// A chess.com rating as the Lichess rating of the same strength, in the same time control, for what is
// measured against Lichess's players (what players score in an opening, the card's colour band). From
// chessgoals.com's rating comparison (a survey of players on both): chess.com is lower, by about 450 at
// 800 and less higher up; blitz meets around 2200. Between the points straight, beyond them the end's gap.
const LEVELS = {
  bullet: [[760, 1240], [920, 1375], [1100, 1515], [1385, 1735], [1690, 1970], [1900, 2135], [2110, 2300], [2425, 2550]],
  blitz: [[800, 1290], [1000, 1425], [1200, 1555], [1500, 1755], [1800, 1950], [2000, 2080], [2200, 2210], [2500, 2410]],
  rapid: [[1085, 1490], [1255, 1615], [1420, 1740], [1655, 1905], [1870, 2065], [1995, 2165], [2110, 2260], [2260, 2400]],
};
export function asLichess(rating, speed) {
  const t = LEVELS[speed] || LEVELS.rapid;
  if (rating == null) return rating;
  const i = t.findIndex(([c]) => c > rating);
  if (i === 0 || i === -1) { const [c, l] = t.at(i); return rating + l - c; }
  const [[c0, l0], [c1, l1]] = [t[i - 1], t[i]];
  return Math.round(l0 + ((rating - c0) / (c1 - c0)) * (l1 - l0));
}
console.assert(asLichess(1000, 'blitz') === 1425 && asLichess(1100, 'blitz') === 1490 && asLichess(600, 'blitz') === 1090 && asLichess(2600, 'blitz') === 2510, 'asLichess');
