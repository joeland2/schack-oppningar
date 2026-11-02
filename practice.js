// My practice: a training plan built from your own Lichess games (the profile's reading of them).
// Your weakest skills first, then puzzles from your own mistakes, the openings that cost you most,
// the traps in your openings, and the opening that works best for you, to keep it sharp. Every step
// links straight into the trainer: ?practise= starts an opening, ?do= starts traps or the mistake check.
import { login } from './lichess.js?v=20261102133851';
import { blunders, puzzles, puzzlesFromGames } from './blunder.js?v=20261102133851';
import { current, cache, myName, skillsOf, storedGames } from './profile.js?v=20261102133851';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x) => `${Math.round(x * 100)}%`;
const practise = (side, fam) => `./?practise=${side}~${encodeURIComponent(fam.replace(/^vs /, ''))}`;

// Skills on the left, the plan for the one picked on the right: each skill's exercises on this site.
function render(name, p) {
  const skills = skillsOf(p).filter((x) => x.v !== null);
  const mine = puzzles(), spot = blunders(mine, storedGames(name) || []);
  const all = [...p.openings.w.map((o) => ({ ...o, side: 'w' })), ...p.openings.b.map((o) => ({ ...o, side: 'b' }))];
  const costly = all.filter((o) => o.n >= 8 && o.score <= 0.47).sort((a, b) => (a.score - 0.5) * Math.sqrt(a.n) - (b.score - 0.5) * Math.sqrt(b.n)).slice(0, 3);
  const best = all.filter((o) => o.n >= 8).sort((a, b) => (b.score - 0.5) * Math.sqrt(b.n) - (a.score - 0.5) * Math.sqrt(a.n))[0];
  const side = (o) => (o.side === 'w' ? 'White' : 'Black');
  // One exercise: [icon, title, a line on it, link, button].
  const ex = {
    puzzles: ['🧩', 'Puzzles from your games', mine.length ? `${mine.length} positions where you went wrong: find the move you missed.` : 'The positions in your games where you went wrong, as puzzles.', mine.length ? 'mistakes.html' : './?do=mistakes', mine.length ? 'Solve' : 'Find them'],
    spot: spot.length && ['👁', 'Spot the blunder', `A few moves from one of your ${spot.length} games: which of yours threw it away?`, 'blunder.html', 'Play'],
    traps: ['⚡', 'Traps in your openings', 'The traps players at your level fall into in your openings: spot the slip and punish it.', './?do=traps', 'Practise'],
    learnfrom: ['👤', 'A player to learn from', 'Someone a bit above you in your main opening: what they play where you go wrong.', './?do=learnfrom', 'Find one'],
    endgames: ['♚', 'Endgames', 'Win the basic endgames to mate, move by move, then against the clock.', 'endgames.html', 'Train'],
    pawn: ['♙', 'King and pawn', 'The endgame most games come down to: the opposition and the key squares.', 'endgames.html#kp', 'Train'],
    rook: ['♜', 'Rook and king', 'Mate with a rook: the most common mate to need.', 'endgames.html#kr', 'Train'],
    time: ['⏱', 'Endgames against the clock', 'The Time challenge: mate as fast as you can, without a slip.', 'endgames.html', 'Race'],
  };
  const opRows = costly.map((o) => ['♞', `${esc(o.fam)} as ${side(o)}`, `${pct(o.win ?? o.score)} wins in ${o.n} games: one of the openings that cost you most.`, practise(o.side, o.fam), 'Fix it']);
  const keep = best && best.score >= 0.55 ? [['★', `Keep the ${esc(best.fam)} sharp`, `Your best: ${pct(best.win ?? best.score)} wins in ${best.n} games as ${side(best)}.`, practise(best.side, best.fam), 'Review']] : [];
  const PLAN = {
    Attack: [ex.puzzles, ex.traps, ex.spot],
    Defense: [ex.puzzles, ex.spot, ex.rook],
    'Early game': [...opRows, ex.traps, ex.learnfrom, ...keep],
    'Late game': [ex.pawn, ex.rook, ex.endgames],
    Accuracy: [ex.spot, ex.puzzles],
    Speed: [ex.time, ...keep, ex.traps],
  };
  const tone = (x) => (x.raw !== null && x.raw <= 45 ? 'weak' : x.raw !== null && x.raw >= 55 ? 'strong' : '');
  const HEAD = { Attack: 'Make your attacks land', Defense: 'Hold your worse positions', 'Early game': 'Come out of the opening better', 'Late game': 'Win more endgames', Accuracy: 'Blunder less', Speed: 'Use your clock better' };
  const why = (w) => (Array.isArray(w) ? w.filter(Boolean).join(' · ') : w || '');
  let pick = [...skills].sort((a, b) => (a.raw ?? a.v) - (b.raw ?? b.v))[0]?.label;
  const panel = () => {
    const x = skills.find((k) => k.label === pick), rows = (PLAN[pick] || []).filter(Boolean);
    return `<p class="pr-k">To train ${esc(pick.toLowerCase())} <b>${x.v}</b></p><h2>${esc(HEAD[pick] || pick)}</h2>
      <p class="pr-why">${esc(x.means)} ${esc(why(x.why))}</p><p class="pr-how"><b>How:</b> ${esc(x.train)}</p>
      <ul class="pr-ex">${rows.map(([ic, t, d, href, go], i) => `<li><span class="pr-ic" aria-hidden="true">${ic}</span><span><b>${t}</b><small>${d}</small></span><a class="${i ? 'ghost' : 'cta'}" href="${href}">${go}</a></li>`).join('')}</ul>`;
  };
  $('#practice').innerHTML = `
    <header class="pr-head"><h1 class="pf-h1">Your plan</h1>
      <p class="info">Built from your last ${p.n} rated Lichess games, ${esc(name)}. Pick a skill to see how to train it; your weakest is picked. <a href="profile.html">See your profile</a></p></header>
    <div class="pr-split">
      <section class="pf-card pr-skills"><h2>Your skills</h2><div role="tablist" aria-label="Skills">${skills.map((x) => `<button type="button" role="tab" class="pr-sk ${tone(x)}" data-skill="${esc(x.label)}" aria-selected="${x.label === pick}">
        <span class="pr-sk-row"><span>${esc(x.label)}</span><b>${x.v}</b></span><span class="pr-sk-bar"><i style="width:${x.v}%"></i></span></button>`).join('')}</div>
        <p class="pr-scale">Against players within your rating range: 50 is as good as them.</p></section>
      <section class="pf-card pr-plan" role="tabpanel" aria-live="polite">${panel()}</section>
    </div>`;
  $('.pr-skills').addEventListener('click', (e) => {
    const b = e.target.closest('[data-skill]');
    if (!b) return;
    pick = b.dataset.skill;
    document.querySelectorAll('.pr-sk').forEach((x) => x.setAttribute('aria-selected', x === b));
    $('.pr-plan').innerHTML = panel();
  });
}

function ask() {
  $('#practice').innerHTML = `<section class="picker"><h1 class="pf-h1">Your plan</h1>
    <p class="info">Log in with Lichess and this page reads your games and builds a training plan: your weakest skills first, puzzles from your own mistakes, and the openings that cost you points.</p>
    <p><button id="pr-login" class="cta" type="button">Log in with Lichess</button></p></section>`;
  $('#pr-login').addEventListener('click', login);
}

// Your games are kept in this browser, so the plan opens at once; only the first visit fetches them.
const name = myName();
if (!name) ask();
else {
  current(name).then(async (p) => { await puzzlesFromGames(name); render(cache()[name.toLowerCase()]?.name || name, p); }).catch((err) => { $('#profile-msg').textContent = err.message; });
}
