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
2. **Openings**: the most played openings at the player's blitz rating (30 for White, 15 for Black). Each opening is drilled against the replies real players at that level actually choose, most common first. Learn mode shows every move; Try mode tests the player, and a line counts as cleared only when played without mistakes. After the opening, the player plays on against Stockfish until checkmate.
3. **Think like the pros**: find the move Magnus Carlsen, Hikaru Nakamura or Alireza Firouzja found in a real game, then see an engine-based explanation of why it works and why the next-best move falls short.

Success: a player meets the lines they will actually face at their level, recognises them in their own games, and clears more lines over time.

## Positioning

Opening lines are built from what real players at the user's own rating (±200) actually play, ordered by how often they occur, rather than from a theory book or an engine's choice. The user's own moves are what 2200+ players play in that position, preferring moves that stay within the opening's named book lines.

## Operating Context

- Used in a browser on desktop and phone; no install and no account.
- The player enters their Lichess blitz rating by hand. It is stored in the browser.
- Progress (cleared lines, solved lessons and puzzles, Learn/Try mode) lives in the browser's local storage only.
- Players typically go back and forth between practising here and playing blitz on Lichess.

## Capabilities and Constraints

- Plain static HTML, CSS and JavaScript with no build step. chess.js and stockfish.js are loaded from jsDelivr.
- Must be served over HTTP; it does not work from `file://`.
- All game data is precomputed and committed to the repo. The site makes no calls to Lichess or chess.com at runtime:
  - `data/explorer.json`: move counts per Lichess rating group from 2,000,000 rated blitz games, Lichess database September 2026, up to 20 plies deep. Rebuild with `tools/make_explorer.py`.
  - `data/*.tsv`: named opening lines from lichess-org/chess-openings.
  - `data/pros.json`: 45 puzzles (15 per player) from chess.com blitz and rapid games, analysed with Stockfish. Rebuild with `tools/make_pros.py`.
- Lines branch on every opponent reply played in at least 5% of games from that position, capped at about 20 lines per opening.
- Known limits:
  - Opening names come only from exact move-order matches with the named-lines list, so transpositions are missed.
  - Data for 2200+ players is thin deep into lines.
  - Stockfish strength is a rough mapping from rating.
- Terminology: Learn / Try (practice modes), line (one sequence of moves from the opening's root), cleared (played without mistakes in Try).
- Hosted publicly on GitHub Pages from the `main` branch: https://joeland2.github.io/schack-oppningar/. Every push to `main` redeploys it.

## Brand Commitments

- Name: Chess Trainer.
- The board uses Lichess's default look: brown board and cburnett pieces.
- All interface text is in English.

## Evidence on Hand

- Real game statistics: `data/explorer.json` (Lichess database, CC0).
- Real pro positions and engine analysis: `data/pros.json`, with a link to each source game.
- Named opening lines: `data/a.tsv` to `data/e.tsv` (CC0).
- Piece art: `pieces/` (cburnett, GPLv2+, credited in README.md).
- The product has no users, testimonials, ratings or usage numbers. Never invent them.

## Product Principles

1. **Real games only.** Opening statistics come from real players' games, never invented lines. The engine is used only to explain positions and to play on after the opening.
2. **No account, no live API.** Everything works without logging in and without calling Lichess. Data is precomputed and shipped with the site.
3. **No invented quotes.** Never put words in real players' mouths. Explanations of pro moves come from engine analysis and are labelled as such.
4. **Practise what you will actually meet.** Order and filter content by how often it occurs at the player's own level.
5. **English interface.**

## Accessibility & Inclusion

No specific standard has been set yet. The site already uses buttons for board squares, keyboard-operable opening cards, and turns off motion for players who have set their system to reduce motion.
