// My practice: a training plan built from your own Lichess games (the profile's reading of them).
// Your weakest skills first, then puzzles from your own mistakes, the openings that cost you most,
// the traps in your openings, and the opening that works best for you, to keep it sharp. Every step
// links straight into the trainer: ?practise= starts an opening, ?do= starts traps or the mistake check.
import { login } from './lichess.js?v=20261029185940';
import { findMistakes, pickPuzzles } from './mistakes.js?v=20261029185940';
import { current, cache, myName, skillsOf, storedGames, gamesReady } from './profile.js?v=20261029185940';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x) => `${Math.round(x * 100)}%`;
const PUZZLES = 'opening-book-v2-mistakes';
const puzzles = () => { try { return JSON.parse(localStorage.getItem(PUZZLES)) || []; } catch { return []; } };
// Puzzles straight from your analysed games (by Lichess or on your profile): every mistake and
// blunder of yours with the better move, added to the ones Find my mistakes has found. No engine
// needed, so they are there at once.
async function puzzlesFromGames(name) {
  await gamesReady;
  const games = (storedGames(name) || []).filter((g) => g.analysis);
  if (!games.length) return;
  const found = await findMistakes(games, name, { evaluate: async () => null });
  const have = puzzles(), seen = new Set(found.map((f) => f.fen));
  const all = pickPuzzles([...found, ...have.filter((f) => !seen.has(f.fen))]);
  try { localStorage.setItem(PUZZLES, JSON.stringify(all)); } catch {}
}
const practise = (side, fam) => `./?practise=${side}~${encodeURIComponent(fam.replace(/^vs /, ''))}`;

// Where each weak skill is trained on this site.
const SKILL_GO = {
  Attack: { href: 'mistakes.html', label: 'Solve your own mistakes' },
  Defense: null,
  'Early game': null, // the openings that cost you most are their own step
  'Late game': null,
  Accuracy: { href: 'mistakes.html', label: 'Solve your own mistakes' },
  Speed: null,
};

function step(n, title, body, action) {
  return `<li class="pr-step"><span class="pr-n">${n}</span><div><h2>${title}</h2>${body}${action ? `<p class="pr-go">${action}</p>` : ''}</div></li>`;
}

function render(name, p) {
  const steps = [];
  const weak = skillsOf(p).filter((x) => x.raw !== null && x.raw <= 45).sort((a, b) => a.raw - b.raw); // clearly below your opponents, as on the profile
  for (const x of weak.slice(0, 2)) {
    const go = SKILL_GO[x.label];
    steps.push([`Train ${x.label.toLowerCase()} <small>${x.v}</small>`, `<p>${esc(x.means)} ${esc(x.why)}</p><p class="pr-how"><b>How:</b> ${esc(x.train)}</p>`,
      go ? `<a class="cta" href="${go.href}">${go.label}</a>` : x.label === 'Early game' ? '<a class="cta" href="#pr-openings">See the openings below</a>' : '']);
  }
  const mine = puzzles();
  steps.push(['Puzzles from your own games', mine.length
    ? `<p>${mine.length} positions from your games where you went wrong. Find the move you missed. <a href="profile.html">Analyse more games</a> on your profile for more.</p>`
    : '<p>The positions in your games where you went wrong, as puzzles: blunders, missed wins and missed mates.</p>',
  mine.length ? '<a class="cta" href="mistakes.html">Solve them</a>' : '<a class="cta" href="./?do=mistakes">Find my mistakes</a>']);
  const ops = [...p.openings.w.map((o) => ({ ...o, side: 'w' })), ...p.openings.b.map((o) => ({ ...o, side: 'b' }))]
    .filter((o) => o.n >= 8 && o.score <= 0.47).sort((a, b) => (a.score - 0.5) * Math.sqrt(a.n) - (b.score - 0.5) * Math.sqrt(b.n)).slice(0, 3);
  if (ops.length) {
    steps.push(['<span id="pr-openings">Openings that cost you points</span>', `<ul class="pr-list">${ops.map((o) => `<li><a href="${practise(o.side, o.fam)}"><b>${esc(o.fam)}</b> as ${o.side === 'w' ? 'White' : 'Black'}</a><small>${pct(o.win ?? o.score)} wins in ${o.n} games</small></li>`).join('')}</ul>`,
      '<small class="info">Each opens that opening\'s lines in the trainer.</small>']);
  }
  steps.push(['A player to learn from', '<p>Someone rated a bit above you who plays your main opening and avoids the moves that cost you: see what they play where you go wrong.</p>',
    '<a class="cta" href="./?do=learnfrom">Find one</a>']);
  steps.push(['Traps in your openings', '<p>The traps players at your level fall into in the openings you play, one after another: spot the slip and punish it.</p>',
    '<a class="cta" href="./?do=traps">Practise the traps</a>']);
  const best = [...p.openings.w.map((o) => ({ ...o, side: 'w' })), ...p.openings.b.map((o) => ({ ...o, side: 'b' }))]
    .filter((o) => o.n >= 8).sort((a, b) => (b.score - 0.5) * Math.sqrt(b.n) - (a.score - 0.5) * Math.sqrt(a.n))[0];
  if (best && best.score >= 0.55) {
    steps.push(['Keep your best opening sharp', `<p><b>${esc(best.fam)}</b> as ${best.side === 'w' ? 'White' : 'Black'}: you win ${pct(best.win ?? best.score)} of ${best.n} games. A short review keeps it that way.</p>`,
      `<a class="ghost pr-ghost" href="${practise(best.side, best.fam)}">Review it</a>`]);
  }
  $('#practice').innerHTML = `
    <header class="pr-head"><h1 class="pf-h1">Your plan</h1>
      <p class="info">Built from your last ${p.n} rated Lichess games, ${esc(name)}: the weakest parts of your game first. <a href="profile.html">See your profile</a></p></header>
    <ol class="pr-steps">${steps.map((x, i) => step(i + 1, ...x)).join('')}</ol>`;
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
