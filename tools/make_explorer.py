"""Build data/explorer.json: opening move statistics from the Lichess game database.

Streams the start of a monthly dump from database.lichess.org (CC0), keeps rated blitz games,
and counts how often every move sequence up to MAX_PLY occurs, per Lichess explorer rating group
(by the players' average rating). The openings page reads this file instead of calling Lichess.

Needs: curl and zstd on PATH.
Run:   python tools/make_explorer.py [games]       (default 1,000,000 blitz games)
Output node format: [counts per rating group, {san: child node}] — the dict is left out on leaves.
"""
import json, re, subprocess, sys
from bisect import bisect_right

URL = 'https://database.lichess.org/standard/lichess_db_standard_rated_2026-09.pgn.zst'
BUCKETS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]  # same groups as the Lichess explorer
MAX_PLY = 20
KEEP = 20            # drop sequences seen in fewer games than this
PRUNE_EVERY = 100_000
COMMENT = re.compile(r'\{[^}]*\}')
NUMBER = re.compile(r'^\d+\.+$')


def moves_of(text):
    out = []
    for tok in COMMENT.sub(' ', text).split():
        if NUMBER.match(tok):
            continue
        if tok in ('1-0', '0-1', '1/2-1/2', '*'):
            break
        out.append(tok.rstrip('+#?!'))
        if len(out) == MAX_PLY:
            break
    return out


def main():
    want = int(sys.argv[1]) if len(sys.argv) > 1 else 1_000_000
    counts = {}  # 'e4 c5 Nf3' -> [n per bucket]
    stream = subprocess.Popen(f'curl -s {URL} | zstd -dc', shell=True, stdout=subprocess.PIPE, text=True)
    games = 0
    blitz = False
    elo = []
    for line in stream.stdout:
        if line.startswith('[Event '):
            blitz = 'Blitz' in line
            elo = []
        elif line.startswith(('[WhiteElo ', '[BlackElo ')):
            elo.append(int(line.split('"')[1]))
        elif line.startswith('1.') and blitz and len(elo) == 2:
            b = bisect_right(BUCKETS, sum(elo) / 2) - 1
            key = ''
            for san in moves_of(line):
                key = f'{key} {san}' if key else san
                c = counts.get(key)
                if c is None:
                    c = counts[key] = [0] * len(BUCKETS)
                c[b] += 1
            counts.setdefault('', [0] * len(BUCKETS))[b] += 1
            games += 1
            if games % PRUNE_EVERY == 0:
                # lossy counting: forget one-off deep sequences so memory stays bounded
                for k in [k for k, c in counts.items() if sum(c) < 2 and k.count(' ') > 3]:
                    del counts[k]
                print(f'{games:,} games, {len(counts):,} sequences', file=sys.stderr)
            if games >= want:
                break
    stream.kill()

    root = [counts['']]
    for key in sorted((k for k in counts if k and sum(counts[k]) >= KEEP), key=lambda k: k.count(' ')):
        *path, last = key.split(' ')
        node = root
        for san in path:
            node = node[1][san]  # parents were added first; a child never outnumbers its parent
        if len(node) == 1:
            node.append({})
        node[1][last] = [counts[key]]
    assert sum(root[0]) == games and all(sum(c[0]) <= sum(root[0]) for c in root[1].values())
    with open('data/explorer.json', 'w') as f:
        json.dump({'buckets': BUCKETS, 'games': games, 'source': URL, 'tree': root}, f, separators=(',', ':'))
    print(f'wrote {games:,} games', file=sys.stderr)


if __name__ == '__main__':
    main()
