# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Every Lichess player, at any level and in any time control. The site is open to all, not a closed group of friends.

- **Club and online players**, mostly Lichess blitz and bullet, who want to know what kind of player they are, what is costing them games, and what to practise next. The owner (Lichess blitz about 1226) and his friends use it, and compare themselves with each other.
- **Players who want to stop being surprised in the opening**, at their own level.
- **New players** learning how the pieces move and the special rules (Basics).
- **Curious players** who look up others (friends, favourite players, top players such as Magnus Carlsen) and compare themselves with them.

Typical situation: between games or in the evening, on a laptop or phone, going back and forth with Lichess.

## Product Purpose

Chess Trainer reads a player's own Lichess games and turns them into an understanding of their game and a way to train it. What it covers today:

- **Profile** (`profile.html`): the player's last 500 rated Lichess games, read move by move. A player card (overall, the player type, their most important piece, rating in their main time control, six skills that compare the player with their own opponents rated within 200 of them, in the same games (50 = as good as them; openings by the position after move 12, tactics by blunders, winning when ahead and defending by mistakes per move while clearly ahead or behind, endgames by score, clock by time trouble and time losses)), two player types with the evidence, a portrait written from their own games, a rating graph (1W to all time, high and low), key numbers (win rate, accuracy, blunders, draws), skills, Good at and Work on, opening style, results, how games end, openings by side, and the list of games. Any player can be looked up, starred, and compared with you.
- **Analysing games here**: games Lichess has not analysed can be analysed in the browser with Stockfish (the newest 100, 250 or 500 in all, skipping analysed ones, with count and time first). Numbers that need analysis appear from 20 analysed games.
- **Game review** (`game.html`): one game replayed on the board with move badges, a winning-chances graph, the moves that decided it (played move and better move), and what went well and badly.
- **Compare** (`profile.html?u=a&vs=b`): two players side by side, in one time control or all, with a summary in words.
- **My practice** (`practice.html`): a training plan from the player's games: weakest skills first, puzzles from their own mistakes (made at once from analysed games), the openings that cost them points, the traps of their openings, their best opening to keep sharp.
- **Openings** (`index.html`, the start page): openings drilled against what real players at the user's rating actually play, from Lichess game statistics; Learn, Practice, Explore and Time modes, traps, spaced review, and playing the game on past the line against real moves, then Maia (human-like, at the user's rating), then Stockfish.
- **Basics** (`basics.html`): short interactive lessons on the moves and rules.
- **Puzzles** (`pros.html`): find the move a top player found in a real game, with an engine explanation; mistakes from your own games (`mistakes.html`).

Success: a player sees what kind of player they are and what costs them games, trains exactly that, and comes back to see it change.

## Positioning

Everything starts from the player's own Lichess games: the profile, the player type, the weaknesses, the puzzles and the training plan are read from what they actually played, not from a generic course. Openings are trained against what players at their own rating really play, from real game statistics, not from a theory book or an engine's first choice.

## Operating Context

- Used in a browser on desktop and phone; no install.
- No account of its own. A Lichess username is enough for public data; logging in with Lichess (OAuth with PKCE, no permissions requested, token kept in the browser) is optional and lets play-outs use the Lichess opening explorer and fills in the player's ratings.
- Everything the player has (games read, analyses, progress, starred players and openings) lives in the browser's local storage; progress can be saved to a file and loaded on another device. Games are kept for the three players looked at last, so later visits fetch only new games.
- Players go back and forth between this site and playing on Lichess.

## Capabilities and Constraints

- Plain static HTML, CSS and JavaScript, no build step; chess.js from jsDelivr. Must be served over HTTP, not `file://`. Hosted on GitHub Pages from `main` (https://joeland2.github.io/schack-oppningar/); every push redeploys. `tools/stamp.sh` versions file links before each commit.
- Live calls go only to Lichess: a player's public profile and rated games (export API, capped at 500), rating history, single game export, the opening explorer (needs a login), and OAuth. Lichess's opening explorer and rating history no longer answer without a login.
- Engines run in the browser: Stockfish 18 lite (WebAssembly, `engine/`) for analysis, hints and the strongest opponent; Maia (`engine/maia/`, nine Lichess-trained nets 1100–1900, run in plain JavaScript by `maia.js`) as the human-like opponent.
- Precomputed data in the repo: `data/explorer-blitz.json` and `data/explorer-classical.json` (Lichess database, September 2026, up to 20 plies; `tools/make_explorer.py`), named opening lines `data/*.tsv` (lichess-org/chess-openings), `data/pros.json` (45 top-player puzzles; `tools/make_pros.py`), `styles.js` (editorial: play styles, opening descriptions and plans).
- Rules of thumb, not measurements: player types, skill scales, thresholds and opening styles are the site's own judgement read from the games, and the site says so.
- Known limits: computer-analysed games are few unless the player analyses them here; Lichess's own analysis covers only games someone requested; the analysis here is shallower than Lichess's; opening names come from exact move orders; data for 2200+ is thin deep into lines.
- Terminology: Learn / Practice / Explore / Time (opening modes; Practice is stored as 'try'), line, cleared, player type, skill, win rate (wins out of games), analysed game.

## Brand Commitments

- Name: open. "Chess Trainer" is the working name; a new name has not been chosen.
- The board uses Lichess's default look: brown board and cburnett pieces.
- All interface text is in English.

## Evidence on Hand

- Real game statistics: `data/explorer-blitz.json`, `data/explorer-classical.json` (Lichess database, CC0).
- Real pro positions and engine analysis: `data/pros.json`, each with its source game.
- Named opening lines: `data/a.tsv` to `data/e.tsv` (CC0).
- Piece art: `pieces/` (cburnett, GPLv2+). Engines: Stockfish (GPLv3), Maia (GPLv3), credited in README.md.
- The product has no user counts, testimonials or ratings. Never invent them.

## Product Principles

1. **From your own games.** What the site says about a player comes from their own games, and it shows the evidence (the numbers, the games, the moves) behind every claim.
2. **Real games, honest numbers.** Opening statistics come from real players' games; judgements that are rules of thumb are labelled as such; nothing is shown from too few games to mean anything.
3. **Measured against your level.** Skills compare a player with players at their own rating (their opponents).
4. **Train what you will actually meet.** Order and filter by how often it happens at the player's own level, and point every weakness at a concrete way to practise it.
5. **No invented words or people.** Never put words in real players' mouths; engine explanations are labelled as such.

## Accessibility & Inclusion

No specific standard has been set. The site uses buttons for board squares, keyboard-operable cards and moves (arrow keys in game review), visible labels next to colour (results, skill values), and turns off motion for players who ask their system to reduce it.
