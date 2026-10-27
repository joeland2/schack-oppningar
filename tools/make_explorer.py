"""Build data/explorer-<speed>.json: opening move statistics from the Lichess game database.

Streams the start of a monthly dump from database.lichess.org (CC0), keeps rated games of one time control,
and counts how often every move sequence up to MAX_PLY occurs, per Lichess explorer rating group
(by the players' average rating). The openings page reads this file instead of calling Lichess.

Needs: curl and zstd on PATH.
Run:   python tools/make_explorer.py <blitz|classical> [games]   (default 2,000,000 games)
Output node format: [games, White wins, draws (each per rating group), {san: child node}];
the dict is left out on leaves. Black wins are games minus White wins minus draws.
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
    speed = sys.argv[1]
    want = int(sys.argv[2]) if len(sys.argv) > 2 else 2_000_000
    event = {'blitz': 'Blitz', 'classical': 'Classical'}[speed]
    counts = {}  # 'e4 c5 Nf3' -> [games, white wins, draws] x rating groups, flattened
    nb = len(BUCKETS)
    stream = subprocess.Popen(f'curl -s {URL} | zstd -dc', shell=True, stdout=subprocess.PIPE, text=True)
    games = 0
    wanted = False
    elo = []
    result = None
    for line in stream.stdout:
        if line.startswith('[Event '):
            wanted = event in line
            elo = []
            result = None
        elif line.startswith('[Result '):
            result = {'1-0': 1, '1/2-1/2': 2, '0-1': 0}.get(line.split('"')[1])  # 1 = white win, 2 = draw
        elif line.startswith(('[WhiteElo ', '[BlackElo ')):
            elo.append(int(line.split('"')[1]))
        elif line.startswith('1.') and wanted and len(elo) == 2 and result is not None:
            b = bisect_right(BUCKETS, sum(elo) / 2) - 1
            key = ''
            for san in moves_of(line):
                key = f'{key} {san}' if key else san
                c = counts.get(key)
                if c is None:
                    c = counts[key] = [0] * (3 * nb)
                c[b] += 1
                if result:
                    c[result * nb + b] += 1
            r = counts.setdefault('', [0] * (3 * nb))
            r[b] += 1
            if result:
                r[result * nb + b] += 1
            games += 1
            if games % PRUNE_EVERY == 0:
                # lossy counting: forget one-off deep sequences so memory stays bounded
                for k in [k for k, c in counts.items() if sum(c[:nb]) < 2 and k.count(' ') > 3]:
                    del counts[k]
                print(f'{games:,} games, {len(counts):,} sequences', file=sys.stderr)
            if games >= want:
                break
    stream.kill()

    split = lambda c: [c[:nb], c[nb:2 * nb], c[2 * nb:]]
    root = split(counts[''])
    for key in sorted((k for k in counts if k and sum(counts[k][:nb]) >= KEEP), key=lambda k: k.count(' ')):
        *path, last = key.split(' ')
        node = root
        for san in path:
            node = node[3][san]  # parents were added first; a child never outnumbers its parent
        if len(node) == 3:
            node.append({})
        node[3][last] = split(counts[key])
    assert sum(root[0]) == games and all(sum(c[0]) <= sum(root[0]) and sum(c[1]) + sum(c[2]) <= sum(c[0]) for c in root[3].values())
    with open(f'data/explorer-{speed}.json', 'w') as f:
        json.dump({'speed': speed, 'buckets': BUCKETS, 'games': games, 'source': URL, 'tree': root}, f, separators=(',', ':'))
    print(f'wrote {games:,} games', file=sys.stderr)


if __name__ == '__main__':
    main()
