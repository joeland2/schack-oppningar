# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Chess players of all levels:

- **New players** learning how the pieces move and what check, checkmate, castling and en passant are (Basics).
- **Online blitz players**, typically around 800–1800 on Lichess, who want to stop being surprised in the opening (Openings). The owner plays Lichess blitz at about 1226 and uses the product himself.
- **Stronger or curious players** who want to test themselves against positions from top players' real games (Think like the pros).

Typical situation: a short practice session between games, on a laptop or phone, often in the evening.

## Product Purpose

Chess Trainer helps players improve through three self-contained practice modes, picked from a start page:

1. **Basics**: short interactive lessons where the player makes each move themselves, with an explanation after.
2. **Openings**: real-game statistics at the player's rating in the chosen time control, Blitz or Classical. As White: openings reached in at least 1% of games, best results first (a draw counts as half). As Black: the 15 White openings met most often, practised from Black's side. Every card shows how often the opening is played and its win/draw/loss split. The player can pick a play style (Attacking, Solid, Positional, Tricky) to see only openings that suit it. Each card previews the opening by playing its moves on a mini board. Each opening is drilled against the replies real players at that level actually choose, most common first. Learn shows every move in plain words ("Play knight to f3") with an explanation; Practice tests the player, and a line cleared without mistakes comes back for review after 1, 3, 7, 14 and 30 days (a mistake sends it back to the start). After each opponent move the player sees every reply players at their level choose there, most common first, and which line covers it. A wrong move is compared with the line's move: how often strong players choose each, and how players at their level score after each. A line ends where the real-game data ends, with a short summary in words and tips on how to go on. The player can then play the game out: real players' moves while they exist, then Stockfish 18 lite (in `engine/`) at the player's rating (never below 1320, its lowest setting), with Hint and Show move for help. Coach text stays light on numbers so the player looks at the board. The board works like Lichess: premoves, right-click arrows, animated moves, an evaluation bar, and move badges (book, brilliant, best, good, inaccuracy, mistake, blunder; Lichess's thresholds) from Stockfish in Explore and play-out.
3. **Think like the pros**: find the move Magnus Carlsen, Hikaru Nakamura or Alireza Firouzja found in a real game, then see an engine-based explanation of why it works and why the next-best move falls short.

Success: a player meets the lines they will actually face at their level, recognises them in their own games, and clears more lines over time.

## Positioning

Opening lines are built from what real players at the user's own rating (±200) actually play, ordered by how often they occur, rather than from a theory book or an engine's choice. The user's own moves are what 2200+ players play in that position, preferring moves that stay within the opening's named book lines.

## Operating Context

- Used in a browser on desktop and phone; no install and no account.
- The player picks a time control (Blitz or Classical) and either types their Lichess username (their public profile supplies the rating, and their recent games are checked for opening slips) or enters a rating by hand. Both are stored in the browser.
- Progress (cleared lines, solved lessons and puzzles, Learn/Try mode) lives in the browser's local storage only.
- Players typically go back and forth between practising here and playing blitz on Lichess.

## Capabilities and Constraints

- Plain static HTML, CSS and JavaScript with no build step. chess.js is loaded from jsDelivr.
- Must be served over HTTP; it does not work from `file://`.
- Opening and puzzle data is precomputed and committed to the repo. The only runtime calls are reading the player's public Lichess profile for their rating, and "Check my own games": it fetches the player's last 100 rated games of the chosen time control from Lichess's public games API by username (no login). It then flags the first move in each game that leaves every named opening line and that 2200+ players (2000+ in classical) choose in under 5% of games:
  - `data/explorer-blitz.json` and `data/explorer-classical.json`: games, White wins and draws per Lichess rating group from 2,000,000 rated blitz games and 400,000 rated classical games, Lichess database September 2026, up to 20 plies deep. Rebuild with `tools/make_explorer.py <blitz|classical>`.
  - `styles.js`: which play styles each opening suits. This is editorial judgement, not game data.
  - `data/*.tsv`: named opening lines from lichess-org/chess-openings.
  - `data/pros.json`: 45 puzzles (15 per player) from chess.com blitz and rapid games, analysed with Stockfish. Rebuild with `tools/make_pros.py`.
- Lines branch on every opponent reply played in at least 5% of games from that position, capped at about 20 lines per opening.
- Known limits:
  - Opening names come only from exact move-order matches with the named-lines list, so transpositions are missed.
  - Data for 2200+ players is thin deep into lines.
- Terminology: Learn / Practice / Explore (modes; Practice is stored as 'try'), line (one sequence of moves from the opening's root), cleared (played without mistakes in Try).
- Hosted publicly on GitHub Pages from the `main` branch: https://joeland2.github.io/schack-oppningar/. Every push to `main` redeploys it.

## Brand Commitments

- Name: Chess Trainer.
- The board uses Lichess's default look: brown board and cburnett pieces.
- All interface text is in English.

## Evidence on Hand

- Real game statistics: `data/explorer-blitz.json`, `data/explorer-classical.json` (Lichess database, CC0).
- Real pro positions and engine analysis: `data/pros.json`, with a link to each source game.
- Named opening lines: `data/a.tsv` to `data/e.tsv` (CC0).
- Piece art: `pieces/` (cburnett, GPLv2+, credited in README.md).
- The product has no users, testimonials, ratings or usage numbers. Never invent them.

## Product Principles

1. **Real games only.** Opening statistics come from real players' games, never invented lines. The engine is used only to explain positions and to play on after the opening.
2. **No account, almost no live API.** Everything works without logging in. Game statistics are precomputed and shipped with the site. The only live call is fetching the player's own public Lichess games, and only when they type their username and ask for it.
3. **No invented quotes.** Never put words in real players' mouths. Explanations of pro moves come from engine analysis and are labelled as such.
4. **Practise what you will actually meet.** Order and filter content by how often it occurs at the player's own level.
5. **English interface.**

## Accessibility & Inclusion

No specific standard has been set yet. The site already uses buttons for board squares, keyboard-operable opening cards, and turns off motion for players who have set their system to reduce motion.
