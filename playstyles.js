// Play styles: every style and strength a card can show, what it means, how the card reads it from
// the games, and the leaderboard's players who have it. ?s= and ?t= mark the visitor's own (from the profile).
import { TYPE_ABOUT, flagHtml, loadFlags, proClass, keptTypes } from './profile.js?v=20261031183854';
import { nick } from './chesscom.js?v=20261031183854';

const BOARD = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/leaderboard';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const slug = (n) => n.toLowerCase().replace(/\W+/g, '-');
const SWORD = 'M14 3h7v7l-9 9-4-4zM3 21l5-5', SHIELD = 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', CLOCK = 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l3 2M9 2h6';
// [name, how the card reads it, icon]; the style is how someone plays, the strength where they beat their level.
const STYLES = [
  ['Striker', 'Plays attacking openings and gambits in many more games than most.', SWORD],
  ['Solid builder', 'Plays solid or positional openings in most games, with few gambits.', 'M3 7h18v5H3zM3 12h18v5H3zM9 7v5M15 12v5'],
  ['Endgame artist', 'The queens come off before move 25 in many of their games.', 'M7 21h10M8 21l-1-8h10l-1 8M12 2v4M10 4h4M7 13c-2-3 0-6 5-5 5-1 7 2 5 5'],
  ['Time scrambler', 'Ends games short of time clearly more often than their opponents at the same level.', CLOCK],
  ['Trickster', 'Wins within 25 moves far more often than their opponents at the same level.', 'M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z'],
  ['Specialist', 'Two main openings make up nearly every opening they choose.', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01'],
  ['Explorer', 'Plays many different openings, each at least three times.', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z'],
  ['Marathoner', 'Their games last more moves than is usual at their rating.', 'M4 12h16M14 6l6 6-6 6M4 6v12'],
  ['Guardian', 'Defends clearly better than their opponents at the same level.', SHIELD],
];
const STRENGTHS = [
  ['Killer instinct', 'Attack is the skill furthest above their opponents at the same level.', SWORD],
  ['Well prepared', 'Early game is the skill furthest above their level: better out of the opening.', 'M5 4h11l3 3v13H5zM9 12h6M9 16h6'],
  ['Grinder', 'Late game is the skill furthest above their level: more points from endgames.', 'M7 21h10M8 21l-1-8h10l-1 8M12 2v4M10 4h4'],
  ['Sure hand', 'Accuracy is the skill furthest above their level: fewer blunders, from analysed games.', 'M5 12.5l4.5 4.5L19 7.5'],
  ['Speed demon', 'Speed is the skill furthest above their level: rarely short of time, and wins on it.', 'M13 2L4 14h7l-1 8 9-12h-7z'],
  ['Giant killer', 'Scores more against players 100+ above than the rating gap predicts, over 30+ such games.', 'M12 19V5M6 11l6-6 6 6'],
  ['White specialist', 'Wins clearly more often with White, over 30+ games with each colour.', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'],
  ['Black specialist', 'Wins clearly more often with Black, over 30+ games with each colour.', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18'],
  ['Fighter', 'Far fewer draws than is usual at their rating: their games are decided.', 'M4 4l16 16M20 4L4 20'],
  ['Houdini', 'Wins or draws an unusual share of clearly lost positions, from analysed games.', 'M4 17c3-6 5-6 8 0s5 6 8 0M4 7h16'],
  ['Finisher', 'Wins nearly all of their clearly won positions, from analysed games.', 'M5 21V4M5 4h11l-2 4 2 4H5'],
  ['Clutch player', 'Scores better when both players are short of time, over 25+ such games.', CLOCK],
];
const q = new URLSearchParams(location.search), mine = [q.get('s'), q.get('t')].filter(Boolean);
let rows = [];

// The players with a style or strength: one row per name (their best card), pros first, then by overall.
function playersWith(name) {
  const best = new Map();
  for (const r of rows) if (r.style === name || r.strength === name) { const k = r.name.toLowerCase(); if (!best.has(k) || best.get(k).overall < r.overall) best.set(k, r); }
  return [...best.values()].sort((a, b) => Number(!!proClass(b.name)) - Number(!!proClass(a.name)) || (b.overall ?? 0) - (a.overall ?? 0));
}
function card([name, how, icon]) {
  const ps = playersWith(name), you = mine.includes(name);
  return `<article class="ps-card${you ? ' you' : ''}" id="${slug(name)}">
    <h3><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${icon}"/></svg>${esc(name)}${you ? '<span class="ps-you">Yours</span>' : ''}</h3>
    <p>${esc(TYPE_ABOUT[name] || '')}</p>
    <p class="ps-how"><b>How the card sees it:</b> ${esc(how)}</p>
    <div class="ps-players">${ps.length ? `${ps.slice(0, 8).map((r) => `<a class="ps-player${proClass(r.name)}" href="profile.html?u=${encodeURIComponent(r.name)}">${flagHtml(r.name)}${esc(nick(r.name))}<small>${r.overall ?? ''}</small></a>`).join('')}${ps.length > 8 ? `<small class="ps-more">and ${ps.length - 8} more</small>` : ''}`
      : '<small class="ps-more">Nobody on the leaderboard yet.</small>'}</div></article>`;
}
function render() {
  $('#ps').innerHTML = `<h2 class="ps-group" id="styles">Styles <small>how someone plays: the card shows the one they lean to most</small></h2><div class="ps-grid">${STYLES.map(card).join('')}</div>
    <h2 class="ps-group" id="strengths">Strengths <small>where someone beats players at their own level</small></h2><div class="ps-grid">${STRENGTHS.map(card).join('')}</div>`;
}
render();
if (mine.length) document.getElementById(slug(mine[0]))?.scrollIntoView({ block: 'center' });
// The leaderboard and the known pros, as on the leaderboard page.
Promise.all([fetch(BOARD).then((r) => (r.ok ? r.json() : [])), fetch('data/pro-cards.json').then((r) => (r.ok ? r.json() : [])).catch(() => [])])
  .then(async ([x, pros]) => {
    const have = new Set(x.map((r) => `${r.name.toLowerCase()}|${r.speed}`));
    rows = [...x, ...pros.filter((p) => !have.has(`${p.name.toLowerCase()}|${p.speed}`))];
    render(); loadFlags(rows.map((r) => r.name)).then(render);
    rows = await keptTypes(rows); render();
  })
  .catch(() => { $('#ps-msg').textContent = 'The players could not be loaded; the styles are all here.'; });
