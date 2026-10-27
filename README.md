# Opening Book

Practise chess openings move by move. Pick an opening and play it against an opponent who chooses a random book variation, so you learn how to answer every line, not just the main one. Any book move counts as correct. Three clean runs and the opening counts as learned. Progress is saved in the browser.

Plain HTML, CSS and JavaScript with no build step. Move logic comes from [chess.js](https://github.com/jhlywa/chess.js). The variations are the [Lichess opening database](https://github.com/lichess-org/chess-openings) (CC0), stored in `data/`.

- `openings.js` – the openings (add new ones here; `family` is the Lichess opening name)
- `app.js` – board and practice logic
- `style.css` – styling
- `data/*.tsv` – Lichess openings (eco, name, pgn)

Run locally: `npx serve .` and open the address shown.
