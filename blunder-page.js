// Spot the blunder (blunder.html): rounds from your own games, kept in this browser by your profile.
import { blunders, puzzles, puzzlesFromGames, spotTheBlunder } from './blunder.js?v=20261103124949';
import { myName, storedGames, gamesReady } from './profile.js?v=20261103124949';

const msg = document.querySelector('#message'), name = myName();
if (!name) msg.innerHTML = 'Log in with Lichess on <a href="profile.html?login">your profile</a> first: the rounds come from your own games.';
else {
  await gamesReady;
  await puzzlesFromGames(name).catch(() => {});
  const all = blunders(puzzles(), storedGames(name) || []);
  if (all.length) spotTheBlunder(all);
  else msg.innerHTML = 'No blunders found in your games here yet. Open <a href="profile.html">your profile</a> and analyse some games, then come back.';
}
