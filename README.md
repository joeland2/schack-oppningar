# Chess Trainer

Three ways to practise, picked from the start page:

- **Basics** (`basics.html`): how each piece moves, special moves, check and mate.
- **Openings** (`openings.html`): the 30 most played white and 15 most played black openings in blitz or classical at your Lichess rating, filtered by play style if you like. Practise them against real games.
- **Think like the pros** (`pros.html`): find the move Magnus Carlsen, Hikaru Nakamura or Alireza Firouzja found in a real chess.com game, with Stockfish's explanation.

Openings: pick Blitz or Classical and enter your Lichess rating for it. Lines come from games of that time control played by people within ±200 of it. Style tags (attacking, solid, positional, tricky) in `styles.js` are editorial; popularity is from real games. Every opponent reply played in at least 5% of games becomes its own line (up to 20), most common first. Your moves are what 2200+ players play most, preferring moves from the opening's book. Learn shows every move; Try tests you, and a line clears when you play it without mistakes. When the line ends you play on against Stockfish, scaled to your rating, until checkmate. Progress is saved in the browser.

Plain HTML, CSS and JavaScript with no build step. Move logic comes from [chess.js](https://github.com/jhlywa/chess.js). Real-game statistics come from the [Lichess game database](https://database.lichess.org) (CC0), counted once by `tools/make_explorer.py` into `data/explorer-blitz.json` and `data/explorer-classical.json`, so the site never calls Lichess; the engine is [stockfish.js](https://github.com/nmrugg/stockfish.js) (GPLv3) loaded from jsDelivr. Book lines are the [Lichess opening database](https://github.com/lichess-org/chess-openings) (CC0), stored in `data/`.

- `app.js` – openings page: picker, line building, practice
- `board.js` – board drawing shared by all pages
- `drill.js` – the find-the-move trainer used by Basics and Pros
- `basics.js` – the lessons
- `pros.js` + `data/pros.json` – pro puzzles; rebuild with `python tools/make_pros.py` (needs `pip install chess` and Stockfish)
- `style.css` – styling
- `data/*.tsv` – Lichess openings (eco, name, pgn)

Run locally: `npx serve .` and open the address shown.

The board uses Lichess's default look. Piece images in `pieces/` are the cburnett set by [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett), licensed [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt), taken from [lichess-org/lila](https://github.com/lichess-org/lila).
