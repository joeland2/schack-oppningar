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
2. **Openings**: real-game statistics at the player's rating in the chosen time control, Blitz or Classical. As White: the 30 most played openings at the player's level (300 below to 500 above their rating, as everywhere on the site); sorted by best results or most played. As Black: the same 30 White openings, practised from Black's side. Every card shows how often the opening is played and its win/draw/loss split. The player can pick a play style (Attacking, Solid, Positional, Tricky) to see only openings that suit it. The list shows one side at a time (You play White / You play Black) as large cards, eight first with Show all: a board that plays the moves, a sentence on what the opening is about (editorial, in `styles.js`), how often it comes up and how your side scores. With a Lichess username, one compact box shows "What you play most" (three openings as White, three as Black) and "What to train" (the opening moves they get wrong, and the whole-game mistake check). It lists the player's most played openings (the opening they play, or "1.e4 vs …" when their own moves name none) with won/drawn/lost, how that compares with players at their level, and Practise for every one. "Find my mistakes" checks whole games: all of the last 100: Lichess's own analysis where a game has it; the rest are scanned on the board for tactical slips (allowed or missed mate in one, a piece left hanging, a free piece missed) and only those moves are checked with Stockfish; every move that costs 10% or more of the winning chances is sorted by kind (walked into a mate, missed a mate, left a piece hanging, missed material, missed a check, opening, middlegame, endgame) and becomes a puzzle on `mistakes.html`. The whole site uses the "achromatic ledger" look from the taste-skill: Geist, ink chrome, a near-black primary, flat panels on a warm stone ground (warm black in dark mode), one blue for what you are working on. Each opening is drilled against the replies real players at that level actually choose, most common first. Learn shows every move in plain words ("Play knight to f3") with an explanation; Practice tests the player, and a line cleared without mistakes comes back for review after 1, 3, 7, 14 and 30 days (a mistake sends it back to the start). After each opponent move the player sees every reply players at their level choose there, most common first, and which line covers it. A wrong move is compared with the line's move: how often strong players choose each, and how players at their level score after each. A line ends where the real-game data ends, with a short summary in words and tips on how to go on. Every line ends on the opponent's move; an arrow then shows a good next move, and any move plays the game out (Back takes a move back, as on Lichess): real players' moves while they exist, then Stockfish 18 lite (in `engine/`) at the player's rating (never below 1320, its lowest setting), with Hint and Show move for help. Coach text stays light on numbers so the player looks at the board. Lines are ordered like a course: the main line (the most common reply at each step) first, then traps (a reply players at that level often make and lose with), then the main deviations, including theory strong players choose (15%+ at 2000+). The player's moves come from players 200–1000 above them, picking the best-scoring of the moves they really play. Each line opens with an introduction and the opening's plan (editorial `PLAN` / `VS_PLAN` in `styles.js`). Practice works on three lines at a time. A Time mode gives 60 seconds to play lines from memory (+2 s right, −5 s wrong). Hint works in three steps. Openings can be starred into My repertoire. In Learn, a sound move with games behind it can replace the suggested move ("Play d3 here in my lines"); the lines are rebuilt around it, and the line box can switch it back. The main line is called Main line; other lines show the move where they leave it, trap lines the slip they punish. Line shares under 10% are not shown. With a Lichess username, "Where you left your lines" lists the first move in each game where the player left their own lines. Another move order to a line's position counts as the line's move (a transposition, or your next two moves the other way round). The lines can be shown as a list or as a tree (shared moves once, branches where they part, each line's status). A streak and daily goal (5 lines a day) sit in the header. Stockfish sorts each statistical trap: a Trap loses something concrete (material along its best line, or mate) and says what; otherwise it is a Common mistake (time, development, the easier game). After the punishing move a Punished! strip says why it was right and what it brings. Moments that matter stop the game with a card over the board, placed away from the move: Trap! (what they played, your chances before and after as a bar, how to punish it; a trap line that ends soon after the slip goes on for two guided moves), Blunder (your own, with why and Take it back), Chance! (the opponent's blunder, with Show me). Looking back at a slip in play-out says why it was bad and shows the position before it (played move red, better move green). Progress can be saved to a file and loaded on another device. The board works like Lichess: premoves, right-click arrows, animated moves, an evaluation bar, and move badges (book, brilliant, best, good, inaccuracy, mistake, blunder; Lichess's thresholds) from Stockfish in Explore and play-out.
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
