// The leaderboard: everyone logged in here with Lichess who has opened their profile (see the profile), ranked within a time control
// and a rating band, by the card's overall number, one skill, or how they score with their own gambits.
const BOARD = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/leaderboard';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const BANDS = [['All', 0, 9999], ['Under 1000', 0, 999], ['1000–1399', 1000, 1399], ['1400–1799', 1400, 1799], ['1800–2199', 1800, 2199], ['2200+', 2200, 9999]];
const GAMBIT_MIN = 10; // gambit games before a gambit score counts
const BY = [['overall', 'Overall', (r) => r.overall], ...['Attack', 'Defense', 'Early game', 'Late game', 'Accuracy', 'Speed'].map((k) => [k, k, (r) => r.skills?.[k] ?? null]),
  ['gambits', 'Gambits', (r) => (r.gambit_games >= GAMBIT_MIN ? Math.round(r.gambit_score * 100) : null)]];
const ABBR = { Attack: 'ATK', Defense: 'DEF', 'Early game': 'EARLY', 'Late game': 'LATE', Accuracy: 'ACC', Speed: 'SPD' };
// A small player card, as on the profile: overall, style and strength, rating, name and the six skills,
// with the skill the board is ranked by marked.
function card(r, i, value) {
  return `<li><a class="lb-card" href="profile.html?u=${encodeURIComponent(r.name)}" title="${esc(r.name)}'s profile">
    <span class="lb-rank">${i + 1}</span>
    <div class="pf-pcard"><div class="pf-pcard-top"><div><b class="pf-ovr">${r.overall ?? '–'}</b><span class="pf-pos">${esc(r.style || '')}</span>${r.strength ? `<span class="lb-strength">+ ${esc(r.strength)}</span>` : ''}</div>
      <div class="pf-pcard-side"><span class="pf-pcard-rating">${r.rating} <small>${esc(r.speed)}</small></span></div></div>
      <p class="pf-pcard-name">${esc(r.name)}</p>
      <div class="pf-pcard-stats">${Object.entries(ABBR).map(([k, a]) => `<span${state.by === k ? ' class="lb-by"' : ''}><b>${r.skills?.[k] ?? '–'}</b>${a}</span>`).join('')}</div>
      <p class="pf-pcard-foot">${state.by === 'gambits' ? `GAMBITS ${value}% · ${r.gambit_games} GAMES` : `${r.games} ${esc(r.speed).toUpperCase()} GAMES`}</p></div></a></li>`;
}
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
  const [, lo, hi] = BANDS.find(([b]) => b === state.band), [, , value] = BY.find(([k]) => k === state.by);
  const list = rows.filter((r) => r.speed === state.speed && r.rating >= lo && r.rating <= hi && value(r) !== null)
    .sort((a, b) => value(b) - value(a) || b.rating - a.rating);

  $('#lb-msg').textContent = list.length ? (state.by === 'gambits' ? `Score with their own gambits, from at least ${GAMBIT_MIN} games.` : '')
    : rows.length ? 'Nobody here yet for this choice.' : 'Nobody is here yet. Log in with Lichess and open your profile to be the first.';
  $('#lb-rows').innerHTML = list.map((r, i) => card(r, i, value(r))).join('');
}

fetch(BOARD).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`The leaderboard answered with an error (${r.status}).`))))
  .then((x) => { rows = x; render(); })
  .catch((err) => { $('#lb-msg').textContent = err.message; });
