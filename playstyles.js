// Play styles: every style and strength a card can show, what it means, how the card reads it from
// the games, and what it wins with and loses to. ?s= and ?t= mark the visitor's own (from the profile).
import { TYPE_ABOUT } from './profile.js?v=20261031205015';

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
// What each one wins with and what it costs, in plain words, and for a style the one it has the hardest time against.
const SIDES = {
  Striker: ['Quick wins. When the attack lands, opponents at your level rarely defend it, and many games are over before move 30.', 'The pawns and pieces you give for the attack. If it stalls, you are simply material down in a long game.', 'Guardian'],
  'Solid builder': ['Being hard to beat. Opponents run out of ideas against a position with no weak points, and you collect the points from their mistakes.', 'Waiting too long. A safe position does not win by itself, and draws or slow losses come when you never strike.', 'Endgame artist'],
  'Endgame artist': ['Long, quiet positions. With the queens off, technique counts more than tactics, and you squeeze points out of small edges.', 'Opponents who keep the queens on and attack early. Your edge only shows if the game reaches the endgame.', 'Striker'],
  'Time scrambler': ['The scramble at the end. With seconds left, you find moves and opponents panic.', 'Losing on time in won positions. Time spent early is time you do not have when it matters.', 'Solid builder'],
  Trickster: ['Opponents who know the first moves but not the trap. One natural mistake and the game is over.', 'A careful opponent. If the trap is seen, you are often a pawn down or worse placed, with a long game ahead.', 'Solid builder'],
  Specialist: ['Knowing your openings deeply. You get the positions you know, and opponents spend time where you play fast.', 'Being predictable. An opponent who has looked at your games can prepare a line you do not know.', 'Explorer'],
  Explorer: ['Surprising people. Opponents rarely meet the same thing from you twice, so their preparation does not help.', 'Not knowing any one opening deeply. Against a prepared opponent you are often the one thinking early.', 'Specialist'],
  Marathoner: ['Long games. You keep playing when others would settle, and many points come after move 40.', 'Spending energy and time on the clock. Long games also mean more moves where one slip can cost it all.', 'Trickster'],
  Guardian: ['Holding bad positions. You find defensive moves, and attackers burn out against you.', 'Being on the back foot too often. Defending well still means you were worse first.', 'Endgame artist'],
  'Killer instinct': ['Converting attacks. When you go after the king, it works more often than for players at your level.', 'Forcing it. An attack started without reason can leave you overextended.'],
  'Well prepared': ['The first moves. You come out of the opening with a better position than your opponents usually do.', 'What comes after. A good start is wasted if the middlegame plan is not there.'],
  Grinder: ['Endgames. You win more points than your level from positions with few pieces left.', 'Getting there. If the middlegame goes wrong, the endgame never comes.'],
  'Sure hand': ['Few blunders. You make fewer big mistakes than your opponents, so they have to earn their wins.', 'Playing it safe. Careful moves can miss the sharp chance that wins at once.'],
  'Speed demon': ['The clock. You rarely run short of time, and you win games on time more often than you lose them.', 'Moving too fast. Quick moves in a position that needs thought can cost the game.'],
  'Giant killer': ['Playing up. Against players rated 100 and more above you, you score more than the gap predicts.', 'Playing down. The same energy is not always there against weaker opponents.'],
  'White specialist': ['Games with White. Your openings and plans work best when you move first.', 'Games with Black. Half your games are with Black, and that is where the points go.'],
  'Black specialist': ['Games with Black. You are at your best when you react to what White does.', 'Games with White. Taking the lead with the first move does not suit you as well.'],
  Fighter: ['Decided games. You play for a result, and draws are rare in your games.', 'Turning down draws. Pushing on in an equal or worse position can turn a draw into a loss.'],
  Houdini: ['Lost positions. You save more of them than players at your level, with draws and comebacks.', 'Needing to. Saving lost positions means you got into them first.'],
  Finisher: ['Won positions. When you are clearly ahead, you almost always bring the win home.', 'Getting ahead first. Finishing only counts once there is something to finish.'],
  'Clutch player': ['Time scrambles. When both players are short of time, you score better than you do overall.', 'Relying on it. A scramble is a gamble even for you, and an earlier decision is safer.'],
};
const q = new URLSearchParams(location.search), mine = [q.get('s'), q.get('t')].filter(Boolean);

function card([name, how, icon]) {
  const you = mine.includes(name), [good, watch, vs] = SIDES[name] || [];
  return `<article class="ps-card${you ? ' you' : ''}" id="${slug(name)}">
    <h3><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${icon}"/></svg>${esc(name)}${you ? '<span class="ps-you">Yours</span>' : ''}</h3>
    <p>${esc(TYPE_ABOUT[name] || '')}</p>
    <p class="ps-how"><b>How the card sees it:</b> ${esc(how)}</p>
    ${good ? `<div class="ps-gw"><p class="ps-good"><b>Strong at</b>${esc(good)}</p><p class="ps-watch"><b>Watch out for</b>${esc(watch)}</p></div>` : ''}
    ${vs ? `<p class="ps-vs">Has the hardest time against <a href="#${slug(vs)}">${esc(vs)}</a> players.</p>` : ''}</article>`;
}
function render() {
  $('#ps').innerHTML = `<h2 class="ps-group" id="styles">Styles <small>how someone plays: the card shows the one they lean to most</small></h2><div class="ps-grid">${STYLES.map(card).join('')}</div>
    <h2 class="ps-group" id="strengths">Strengths <small>where someone beats players at their own level</small></h2><div class="ps-grid">${STRENGTHS.map(card).join('')}</div>`;
}
render();
if (mine.length) document.getElementById(slug(mine[0]))?.scrollIntoView({ block: 'center' });
