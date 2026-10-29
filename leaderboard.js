// The leaderboard: players who chose to show their card (see the profile), ranked within a time control
// and a rating band, by the card's overall number, one skill, or how they score with their own gambits.
const BOARD = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/leaderboard';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const BANDS = [['All', 0, 9999], ['Under 1000', 0, 999], ['1000–1399', 1000, 1399], ['1400–1799', 1400, 1799], ['1800–2199', 1800, 2199], ['2200+', 2200, 9999]];
const GAMBIT_MIN = 10; // gambit games before a gambit score counts
const BY = [['overall', 'Overall', (r) => r.overall], ...['Attack', 'Defense', 'Early game', 'Late game', 'Accuracy', 'Speed'].map((k) => [k, k, (r) => r.skills?.[k] ?? null]),
  ['gambits', 'Gambits', (r) => (r.gambit_games >= GAMBIT_MIN ? Math.round(r.gambit_score * 100) : null)]];
const state = { speed: 'blitz', band: 'All', by: 'overall' };
let rows = [];

function seg(el, items, key) {
  el.innerHTML = items.map(([k, label]) => `<button type="button" data-k="${esc(k)}" aria-pressed="${state[key] === k}">${esc(label)}</button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { state[key] = b.dataset.k; render(); } };
}
function render() {
  const speeds = [...new Set(rows.map((r) => r.speed))];
  if (speeds.length && !speeds.includes(state.speed)) state.speed = speeds[0];
  seg($('#lb-speed'), speeds.map((s) => [s, s[0].toUpperCase() + s.slice(1)]), 'speed');
  seg($('#lb-band'), BANDS.map(([b]) => [b, b]), 'band');
  seg($('#lb-by'), BY.map(([k, label]) => [k, label]), 'by');
  const [, lo, hi] = BANDS.find(([b]) => b === state.band), [, label, value] = BY.find(([k]) => k === state.by);
  const list = rows.filter((r) => r.speed === state.speed && r.rating >= lo && r.rating <= hi && value(r) !== null)
    .sort((a, b) => value(b) - value(a) || b.rating - a.rating);
  $('#lb-col').textContent = state.by === 'gambits' ? 'Gambit score' : label;
  $('.lb-table').hidden = !list.length;
  $('#lb-msg').textContent = list.length ? (state.by === 'gambits' ? `Score with their own gambits, from at least ${GAMBIT_MIN} games.` : '')
    : rows.length ? 'Nobody here yet for this choice.' : 'Nobody has joined yet. Be the first: tick Show me on the leaderboard on your profile.';
  $('#lb-rows').innerHTML = list.map((r, i) => `<tr><td>${i + 1}</td><td><a href="profile.html?u=${encodeURIComponent(r.name)}">${esc(r.name)}</a></td><td>${r.rating}</td>
    <td>${esc(r.style || '')}${r.strength ? ` <small>+ ${esc(r.strength)}</small>` : ''}</td><td><b>${value(r)}${state.by === 'gambits' ? '%' : ''}</b>${state.by === 'gambits' ? ` <small>${r.gambit_games} games</small>` : ''}</td></tr>`).join('');
}

fetch(BOARD).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`The leaderboard answered with an error (${r.status}).`))))
  .then((x) => { rows = x; render(); })
  .catch((err) => { $('#lb-msg').textContent = err.message; });
