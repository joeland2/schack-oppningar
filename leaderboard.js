// The leaderboard: everyone logged in here with Lichess who has opened their profile (see the profile), ranked within a time control
// and a rating band, by the card's overall number, one skill, or how they score with their own gambits.
const BOARD = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/leaderboard';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const ABBR = { Attack: 'ATK', Defense: 'DEF', 'Early game': 'EARLY', 'Late game': 'LATE', Accuracy: 'ACC', Speed: 'SPD' };
const BANDS = [['All', 0, 9999], ['Under 1000', 0, 999], ['1000–1399', 1000, 1399], ['1400–1799', 1400, 1799], ['1800–2199', 1800, 2199], ['2200+', 2200, 9999]];
const GAMBIT_MIN = 10; // gambit games before a gambit score counts
const BY = [['overall', 'Overall', (r) => r.overall], ...['Attack', 'Defense', 'Early game', 'Late game', 'Accuracy', 'Speed'].map((k) => [k, k, (r) => r.skills?.[k] ?? null]),
  ['gambits', 'Gambits', (r) => (r.gambit_games >= GAMBIT_MIN ? Math.round(r.gambit_score * 100) : null)]];
// One row: the place, a small player card as on the profile (overall, style, piece, rating, name and the
// six skills, the ranked one marked), and beside it the name, style + strength and the openings played most.
const practise = (side, fam) => `./?practise=${side}~${encodeURIComponent(fam.replace(/^vs /, ''))}`;
const PIECE = { n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };
function row(r, i, value) {
  const top = (side) => (r.openings || []).filter((o) => o.side === side).sort((a, b) => b.n - a.n)[0];
  const w = top('w'), bl = top('b'), href = `profile.html?u=${encodeURIComponent(r.name)}`;
  return `<li class="lb-row"><span class="lb-rank">${i + 1}</span>
    <a class="lb-card" href="${href}" aria-label="${esc(r.name)}'s profile"><div class="pf-pcard"><div class="pf-pcard-top"><div><b class="pf-ovr">${r.overall ?? '–'}</b><span class="pf-pos">${esc(r.style || '')}</span></div>
      <div class="pf-pcard-side"><img class="pf-pcard-piece" src="pieces/w${(r.piece || 'n').toUpperCase()}.svg" alt="" title="Most important piece: the ${PIECE[r.piece || 'n']}"><span class="pf-pcard-rating">${r.rating} <small>${esc(r.speed)}</small></span></div></div>
      <p class="pf-pcard-name">${esc(r.name)}</p>
      <div class="pf-pcard-stats">${Object.entries(ABBR).map(([k, a]) => `<span${state.by === k ? ' class="lb-by"' : ''}><b>${r.skills?.[k] ?? '–'}</b>${a}</span>`).join('')}</div></div></a>
    <div class="lb-info"><a class="lb-name" href="${href}">${esc(r.name)}</a>
      <p class="lb-type">${esc(r.style || '')}${r.strength ? ` <span>+ ${esc(r.strength)}</span>` : ''}</p>
      <p class="lb-ops">${w ? `<span><small>As White</small> <a class="lb-op" href="${practise('w', w.fam)}">${esc(w.fam)}</a></span>` : ''}${bl ? `<span><small>As Black</small> <a class="lb-op" href="${practise('b', bl.fam)}">${esc(bl.fam)}</a></span>` : ''}</p>
      <p class="lb-value">${state.by === 'gambits' ? `Gambits: <b>${value}%</b> in ${r.gambit_games} games` : `${BY.find(([k]) => k === state.by)[1]}: <b>${value}</b>`} <small>· ${r.rating} ${esc(r.speed)} · ${r.games} games</small></p></div></li>`;
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
  $('#lb-rows').innerHTML = list.map((r, i) => row(r, i, value(r))).join('');
}

fetch(BOARD).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`The leaderboard answered with an error (${r.status}).`))))
  .then((x) => { rows = x; render(); })
  .catch((err) => { $('#lb-msg').textContent = err.message; });
