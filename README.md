# Opening Book

Practise chess openings move by move against real games. Log in with Lichess; the app takes your blitz rating and builds lines from blitz games played by people within ±200 of it. Every opponent reply played in at least 5% of games becomes its own line (up to 20), most common first. Your moves are what 2200+ players play most, preferring moves from the opening's book. Clear a line without mistakes to move on to the next. When the line ends you play on against Stockfish, scaled to your rating, until checkmate. Progress is saved in the browser.

Plain HTML, CSS and JavaScript with no build step. Move logic comes from [chess.js](https://github.com/jhlywa/chess.js). Real-game statistics come from the [Lichess opening explorer](https://lichess.org/api#tag/Opening-Explorer); the engine is [stockfish.js](https://github.com/nmrugg/stockfish.js) (GPLv3) loaded from jsDelivr. Book lines are the [Lichess opening database](https://github.com/lichess-org/chess-openings) (CC0), stored in `data/`.

- `openings.js` – the openings (add new ones here; `family` is the Lichess opening name)
- `app.js` – board and practice logic
- `style.css` – styling
- `data/*.tsv` – Lichess openings (eco, name, pgn)

Run locally: `npx serve .` and open the address shown.

The board uses Lichess's default look. Piece images in `pieces/` are the cburnett set by [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett), licensed [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt), taken from [lichess-org/lila](https://github.com/lichess-org/lila).
