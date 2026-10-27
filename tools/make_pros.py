"""Build data/pros.json: "find the move" puzzles from top players' real chess.com games.

A puzzle is a position where the player found the engine's best move and every other move
is clearly worse. Stockfish supplies the evaluation and the lines used to explain it.

Needs: pip install chess, and a stockfish binary on PATH.
Run:   python tools/make_pros.py
"""
import io, json, sys, urllib.request
import chess, chess.engine, chess.pgn

PLAYERS = [('magnuscarlsen', 'Magnus Carlsen'), ('hikaru', 'Hikaru Nakamura'), ('firouzja2003', 'Alireza Firouzja')]
MONTHS = 3             # most recent monthly archives to scan
GAMES = 30             # games analysed per player
PER_PLAYER = 15        # puzzles kept per player
GAP = 150              # best move must beat the second best by this many centipawns
LIMIT = chess.engine.Limit(time=0.15)
VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'opening-book-puzzle-builder'})
    return json.load(urllib.request.urlopen(req, timeout=30))


def games_of(user):
    archives = get(f'https://api.chess.com/pub/player/{user}/games/archives')['archives'][-MONTHS:]
    out = []
    for url in reversed(archives):
        for g in reversed(get(url)['games']):
            if g.get('rules') == 'chess' and g.get('time_class') in ('blitz', 'rapid') and g.get('rated'):
                out.append(g)
    return out[:GAMES]


def score(info, color):
    s = info['score'].pov(color)
    return {'mate': s.mate()} if s.is_mate() else {'cp': s.score()}


def as_cp(e):
    return e['cp'] if 'cp' in e else (10000 if e['mate'] > 0 else -10000)


def material(board, color):
    return sum(VALUES.get(p.piece_type, 0) * (1 if p.color == color else -1) for p in board.piece_map().values())


def sans(board, moves, n):
    b = board.copy()
    out = []
    for m in moves[:n]:
        out.append(b.san(m))
        b.push(m)
    return out


def puzzles_in(game, user, name, engine):
    pgn = chess.pgn.read_game(io.StringIO(game['pgn']))
    color = chess.WHITE if game['white']['username'].lower() == user else chess.BLACK
    opponent = game['black' if color == chess.WHITE else 'white']
    board = pgn.board()
    found, prev = [], None
    for move in pgn.mainline_moves():
        if (board.turn == color and board.fullmove_number > 8 and board.legal_moves.count() >= 3
                and not (prev and board.is_capture(move) and move.to_square == prev.to_square)):  # skip plain recaptures
            infos = engine.analyse(board, LIMIT, multipv=3)
            if len(infos) >= 2 and infos[0]['pv'][0] == move:
                best, alt = score(infos[0], color), score(infos[1], color)
                if as_cp(best) - as_cp(alt) >= GAP and -150 <= as_cp(best) and as_cp(alt) < 400:
                    after = board.copy()
                    for m in infos[0]['pv'][:2]:
                        after.push(m)
                    motifs = []
                    if board.gives_check(move): motifs.append('check')
                    if board.is_capture(move): motifs.append('capture')
                    if material(after, color) < material(board, color) and as_cp(best) >= 100: motifs.append('sacrifice')
                    if 'mate' in best: motifs.append('mate')
                    found.append({
                        'player': name, 'opponent': opponent['username'], 'opponentRating': opponent.get('rating'),
                        'color': 'w' if color == chess.WHITE else 'b', 'timeClass': game['time_class'],
                        'date': pgn.headers.get('Date', '').replace('.', '-'), 'url': game['url'],
                        'fen': board.fen(), 'move': board.san(move), 'eval': best,
                        'pv': sans(board, infos[0]['pv'], 8), 'motifs': motifs,
                        'alt': {'move': board.san(infos[1]['pv'][0]), 'eval': alt, 'pv': sans(board, infos[1]['pv'], 6)},
                        'others': [{'move': board.san(i['pv'][0]), 'eval': score(i, color)} for i in infos[1:]],
                    })
        prev = move
        board.push(move)
    return found[:2]  # at most two per game keeps the set varied


def main():
    engine = chess.engine.SimpleEngine.popen_uci('stockfish')
    out = []
    try:
        for user, name in PLAYERS:
            mine = []
            for g in games_of(user):
                mine += puzzles_in(g, user, name, engine)
                print(f'{name}: {len(mine)} puzzles', file=sys.stderr)
                if len(mine) >= PER_PLAYER:
                    break
            out += mine[:PER_PLAYER]
    finally:
        engine.quit()
    assert all(p['pv'][0] == p['move'] for p in out), 'puzzle answer must start the engine line'
    with open('data/pros.json', 'w') as f:
        json.dump(out, f, indent=1)
    print(f'wrote {len(out)} puzzles', file=sys.stderr)


if __name__ == '__main__':
    main()
