"""Build data/opening-scores.json: how White scores in each opening family, per rating group.

From data/explorer-<speed>.json (Lichess games, see make_explorer.py) and the named lines in
data/[a-e].tsv. A family is the part of a Lichess opening name before the colon ("King's Gambit
Accepted", "Sicilian Defense"); its position is the shortest named line of that family. The profile
uses this as what players at a rating usually score in an opening, to judge a player's own results.

Output: {"buckets": [...], "<speed>": {"<family>": [[games per group], [White's score per group]]}}
Run: python3 tools/make_opening_scores.py
"""
import json
import re
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def clean(san):
    return re.sub(r"[+#?!]", "", san)


def book():
    first = {}
    for f in "abcde":
        for row in (DATA / f"{f}.tsv").read_text().strip().split("\n")[1:]:
            _, name, pgn = row.split("\t")
            moves = [clean(m) for m in re.sub(r"\d+\.\s*", "", pgn).split()]
            fam = name.split(":")[0]
            if fam not in first or len(moves) < len(first[fam]):
                first[fam] = moves
    return first


def main():
    lines = book()
    out = {}
    for speed in ("blitz", "classical"):
        src = json.loads((DATA / f"explorer-{speed}.json").read_text())
        out["buckets"] = src["buckets"]
        fams = {}
        for fam, moves in lines.items():
            node = src["tree"]
            for m in moves:
                node = (node[3] or {}).get(m) if len(node) > 3 else None
                if node is None:
                    break
            if node is None:
                continue
            games, wins, draws = node[0], node[1], node[2]
            fams[fam] = [games, [round((w + d / 2) / g, 3) if g else None for g, w, d in zip(games, wins, draws)]]
        out[speed] = fams
        print(speed, len(fams), "families")
    (DATA / "opening-scores.json").write_text(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()
