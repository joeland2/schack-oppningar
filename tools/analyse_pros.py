"""Analyse the known pros' and streamers' games with a local Stockfish and send the results to the
analyses function, so their cards are whole for every visitor (Early game needs Stockfish on the position
after move 12, Accuracy and parts of Attack and Defense a full analysis), without anyone analysing in the browser.

Per account, the games the profile reads: the last 500 rated games and the last 500 of each time control.
The move-12 look on all of them, a full analysis on the newest FULL of each set; games Lichess analysed are
left as they are. Rows as profile.js's extra(): { ours, at12, an, pa }.

Needs: stockfish on PATH and python-chess.
Run:   python tools/analyse_pros.py [account …]   (default: every account in supabase/functions/pros/index.ts)
"""
import json, re, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from math import exp
import chess

SYNC = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/analyses'
MAX, FULL, DEPTH, WORKERS = 500, 300, 10, 8
UA = {'User-Agent': 'chess-labs (chesslabs.gg)'}
SPEEDS = ['bullet', 'blitz', 'rapid', 'classical']


def get(url, accept='application/json'):
    req = urllib.request.Request(url, headers={**UA, 'Accept': accept})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read().decode()


# ---------- the games, as the profile fetches them (newest first) ----------
def lichess(name, perf):
    text = get(f'https://lichess.org/api/games/user/{name}?max={MAX}&rated=true&perfType={perf}&moves=true&evals=true', 'application/x-ndjson')
    return [{'id': g['id'], 'moves': g.get('moves', '').split(), 'analysed': 'analysis' in g}
            for g in map(json.loads, filter(None, text.split('\n'))) if g.get('variant') == 'standard']


def pgn_moves(pgn):
    body = re.sub(r'^\[.*\]\s*$', '', pgn, flags=re.M)
    body = re.sub(r'\{[^}]*\}', ' ', body)
    return [t for t in body.split() if not re.match(r'^\d+\.+$|^(1-0|0-1|1/2-1/2|\*)$', t)]


def chesscom(nick):
    u = nick.lower()
    months = json.loads(get(f'https://api.chess.com/pub/player/{u}/games/archives'))['archives'][::-1]
    sets = {sp: [] for sp in ['all', 'bullet', 'blitz', 'rapid']}
    for url in months:
        if all(len(v) >= MAX for v in sets.values()):
            break
        for g in json.loads(get(url)).get('games', [])[::-1]:
            if not g.get('rated') or g.get('rules') != 'chess' or g.get('time_class') not in sets or not g.get('pgn'):
                continue
            x = {'id': g['url'].split('/')[-1], 'moves': pgn_moves(g['pgn']), 'analysed': False}
            for k in ('all', g['time_class']):
                if len(sets[k]) < MAX:
                    sets[k].append(x)
    return list(sets.values())


# ---------- Stockfish, one process per worker thread ----------
class Engine:
    def __init__(self):
        self.p = subprocess.Popen(['stockfish'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        self.send('uci'); self.wait('uciok')
        self.send('setoption name Threads value 1'); self.send('setoption name Hash value 16'); self.send('isready'); self.wait('readyok')

    def send(self, s):
        self.p.stdin.write(s + '\n')

    def wait(self, word):
        while not (line := self.p.stdout.readline()).startswith(word):
            pass
        return line

    # As profile.js's evalNow: centipawns from White, clamped to ±1000, a mate as ±1000; and the best move.
    def eval(self, board):
        self.send(f'position fen {board.fen()}'); self.send(f'go depth {DEPTH}')
        cp = 0
        while True:
            line = self.p.stdout.readline()
            m = re.search(r' score (cp|mate) (-?\d+)', line)
            if m and not re.search(r' (lower|upper)bound', line):
                n = int(m.group(2))
                cp = max(-1000, min(1000, n)) if m.group(1) == 'cp' else (1000 if n > 0 else -1000)
            if line.startswith('bestmove'):
                b = line.split()[1]
                return (cp if board.turn == chess.WHITE else -cp), (b if b != '(none)' else None)


win_pct = lambda cp: 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)


# As profile.js's applyEvals, packed as pack() does: the row's an and pa.
def packed(cps, best):
    tally = {w: {'blunder': 0, 'mistake': 0, 'inaccuracy': 0, 'acc': []} for w in ('white', 'black')}
    j, prev = [], 20
    for i, cp in enumerate(cps):
        who = 'black' if i % 2 else 'white'
        sign = 1 if who == 'white' else -1
        drop = max(0, win_pct(sign * prev) - win_pct(sign * cp))
        kind = 'Blunder' if drop >= 15 else 'Mistake' if drop >= 10 else 'Inaccuracy' if drop >= 5 else None
        if kind:
            tally[who][kind.lower()] += 1
        j.append(kind[0] if kind else '.')
        tally[who]['acc'].append(max(0, min(100, 103.1668 * exp(-0.04354 * drop) - 3.1669)))
        prev = cp
    pa = [{'blunder': t['blunder'], 'mistake': t['mistake'], 'inaccuracy': t['inaccuracy'],
           'accuracy': round(sum(t['acc']) / len(t['acc'])) if t['acc'] else None} for t in tally.values()]
    an = {'cp': cps, 'j': ''.join(j), 'best': {str(i): b for i, b in best.items() if i < len(cps)}, 'v': {}}
    return an, pa


def work(engines, job):
    g, full = job
    e = engines.get()
    try:
        board, cps, best, at12 = chess.Board(), [], {}, None
        for i, san in enumerate(g['moves']):
            try:
                board.push_san(san)
            except ValueError:
                break
            if full:
                cp, b = e.eval(board)
                cps.append(cp)
                if b:
                    best[len(cps)] = b
            if i == 23:
                at12 = cps[-1] if full else e.eval(board)[0]
                if not full:
                    break
        data = {'at12': at12} if at12 is not None else {}
        if full and cps:
            data['ours'] = True
            data['an'], data['pa'] = packed(cps, best)
        return g['id'], data
    finally:
        engines.put(e)


def post(player, rows):
    for i in range(0, len(rows), 200):
        body = json.dumps({'player': player, 'rows': rows[i:i + 200]}).encode()
        req = urllib.request.Request(SYNC, data=body, method='POST', headers={**UA, 'content-type': 'text/plain'})
        urllib.request.urlopen(req, timeout=120).read()


def accounts():
    src = open('supabase/functions/pros/index.ts').read()
    return [a for a in re.findall(r"\['([^']+)', '[^']+', '(?:pro|vip)'\]", src)]


def main():
    import queue
    engines = queue.Queue()
    for _ in range(WORKERS):
        engines.put(Engine())
    for a in sys.argv[1:] or accounts():
        try:
            sets = chesscom(a[3:]) if a.startswith('cc:') else [lichess(a, ','.join(SPEEDS))] + [lichess(a, sp) for sp in SPEEDS]
        except Exception as err:
            print(f'{a}: could not fetch ({err})', flush=True)
            continue
        jobs = {}
        for games in sets:
            todo = [g for g in games if not g['analysed'] and len(g['moves']) > 24]
            for k, g in enumerate(todo):
                jobs[g['id']] = (g, jobs.get(g['id'], (g, False))[1] or k < FULL)
        with ThreadPoolExecutor(WORKERS) as pool:
            rows = [{'id': i, 'data': d} for i, d in pool.map(lambda j: work(engines, j), jobs.values()) if d]
        post(a.lower(), rows)
        print(f'{a}: {len(rows)} games, {sum("an" in r["data"] for r in rows)} fully analysed', flush=True)


if __name__ == '__main__':
    main()
