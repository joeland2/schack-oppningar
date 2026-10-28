# Chess Trainer

Three ways to practise, picked from the start page:

- **Basics** (`basics.html`): how each piece moves, special moves, check and mate.
- **Openings** (`index.html`, the start page): in blitz or classical at your Lichess rating: as White the best-scoring openings that are played in at least 1% of games (filtered by play style if you like), as Black the White openings you meet most often. Each shows how often it is played and its win/draw/loss split. Practise them against real games.
- **Think like the pros** (`pros.html`): find the move Magnus Carlsen, Hikaru Nakamura or Alireza Firouzja found in a real chess.com game, with Stockfish's explanation.

Openings: pick Blitz or Classical and enter your Lichess rating for it. Lines come from games of that time control played by people within ±200 of it. Style tags (attacking, solid, positional, tricky) in `styles.js` are editorial; popularity is from real games. Every opponent reply played in at least 5% of games becomes its own line (up to 20), most common first. Your moves are what 2200+ players play most, preferring moves from the opening's book. Learn shows every move and the replies you can expect; Practice tests you, and a line clears when you play it without mistakes, then comes back for review. Explore lets you try any move and shows how often players at your level choose it and how it scores. At the end of a line you can play the game out: the opponent plays real players' moves while games reach that far, then Maia, a net trained on Lichess games to play like people at your rating (Stockfish above 1900); Hint and Show move help there. Progress is saved in the browser.

Plain HTML, CSS and JavaScript with no build step. Move logic comes from [chess.js](https://github.com/jhlywa/chess.js). Real-game statistics come from the [Lichess game database](https://database.lichess.org) (CC0), counted once by `tools/make_explorer.py` (blitz: 8 million games, lossy counting so rare but steady lines are kept) into `data/explorer-blitz.json` and `data/explorer-classical.json`, so the site never calls Lichess. Book lines are the [Lichess opening database](https://github.com/lichess-org/chess-openings) (CC0), stored in `data/`. Where real games run out, the play-out opponent is [Maia](https://github.com/CSSLab/maia-chess) (GPLv3): its nine Lichess-trained nets (1100–1900) are in `engine/maia/` and run in plain JavaScript by `maia.js`; `engine/maia/policy.json` is lc0's policy map (GPLv3). Above 1900, and for hints, evaluations and move badges, [Stockfish 18 lite](https://github.com/nmrugg/stockfish.js) (WebAssembly, GPLv3) in `engine/`.

- `app.js` – openings page: picker, line building, practice
- `board.js` – board drawing shared by all pages
- `drill.js` – the find-the-move trainer used by Basics and Pros
- `basics.js` – the lessons
- `mistakes.js` + `mistakes.html`/`mistakes-page.js` – mistakes from your whole Lichess games, trained as puzzles
- `pros.js` + `data/pros.json` – pro puzzles; rebuild with `python tools/make_pros.py` (needs `pip install chess` and Stockfish)
- `style.css` – styling
- `data/*.tsv` – Lichess openings (eco, name, pgn)

Run locally: `npx serve .` and open the address shown.

Before committing a change, run `tools/stamp.sh`: it gives every CSS and JS reference a fresh `?v=` stamp so browsers load the new files instead of cached ones.

The board uses Lichess's default look. Piece images in `pieces/` are the cburnett set by [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett), licensed [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt), taken from [lichess-org/lila](https://github.com/lichess-org/lila).
