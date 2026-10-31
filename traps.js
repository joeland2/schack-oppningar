// The known, named opening traps: the opponent's natural-looking move (slip, a ply index into moves)
// and how it is punished; win completes "It gives you …". side is yours: 'w' when you play White and spring it. Each opening whose
// start the moves follow, from your side, gets the trap as a line of its own. Checked by the asserts
// in app.js (legal moves, the slip is the opponent's, a line ending in # is mate). Only openings you
// practise from the trap's side get it as a trap to spring. One with avoid is also a line for the other side: the
// move that walks into it (avoid.ply), what Stockfish plays instead (safe) and why it loses (note).
export const NAMED_TRAPS = [
  { name: 'Fried Liver Attack', side: 'w', slip: 9, win: 'a winning attack on the exposed king',
    note: 'Taking back on d5 with the knight lets Nxf7 tear the king out. Qf3+ then hits the king and the pinned knight on d5.',
    moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 Nc3' },
  { name: "Légal's Mate", side: 'w', slip: 9, win: 'mate',
    note: 'The pin on the f3 knight is not real. Nxe5 offers the queen, and taking it walks into Bxf7+ and Nd5#.',
    moves: 'e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5 Bxd1 Bxf7+ Ke7 Nd5#',
    avoid: { ply: 7, safe: 'Nf6', note: 'It looks harmless, but White plays Nxe5! anyway: if you take the queen, Bxf7+ and Nd5# is mate.' } },
  { name: 'Petrov Trap', side: 'w', slip: 7, win: 'the queen',
    note: 'After 3...Nxe4? Qe2 pins on the e-file. Moving the knight away opens the file: Nc6+ is a discovered check that hits the queen.',
    moves: 'e4 e5 Nf3 Nf6 Nxe5 Nxe4 Qe2 Nf6 Nc6+ Be7 Nxd8',
    avoid: { ply: 5, safe: 'd6', note: 'Taking back the pawn at once walks into Qe2: the knight is pinned, and when it moves, Nc6+ uncovers check and wins the queen. Chase the knight with ...d6 first.' } },
  { name: 'Caro-Kann Smothered Mate', side: 'w', slip: 9, win: 'mate',
    note: 'With the queen on e2, the knight on d7 blocks the king\'s last square. Developing the other knight allows Nd6#.',
    moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nd7 Qe2 Ngf6 Nd6#',
    avoid: { ply: 9, safe: 'Ndf6', note: 'The knight on d7 blocks the king\'s last square, and the queen on e2 pins the e-pawn: Nd6 is mate.' } },
  { name: "Queen's Gambit Accepted Trap", side: 'w', slip: 5, win: 'the rook on a8, or a piece if Black blocks',
    note: 'Holding the extra pawn with ...b5 fails: a4 and axb5 open the long diagonal, and Qf3 hits the rook on a8.',
    moves: 'd4 d5 c4 dxc4 e3 b5 a4 c6 axb5 cxb5 Qf3' },
  { name: 'Elephant Trap', side: 'b', slip: 10, win: 'a piece',
    note: 'The knight on f6 only looks pinned. Nxd5? is met by ...Nxd5!, and Bxd8 Bb4+ gets the queen back with a piece to spare.',
    moves: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Nbd7 cxd5 exd5 Nxd5 Nxd5 Bxd8 Bb4+ Qd2 Bxd2+ Kxd2 Kxd8' },
  { name: 'Lasker Trap', side: 'b', slip: 10, win: 'a piece, and the queen after ...Bg4+',
    note: 'In the Albin, Bxb4?? lets the pawn run: ...exf2+ and ...fxg1=N+, promoting to a knight with check.',
    moves: 'd4 d5 c4 e5 dxe5 d4 e3 Bb4+ Bd2 dxe3 Bxb4 exf2+ Ke2 fxg1=N+' },
  { name: 'Siberian Trap', side: 'b', slip: 16, win: 'the queen or mate: ...Qh2# and ...Nxe2+ are both threatened',
    note: 'In the Smith-Morra, h3?? to chase the knight allows ...Nd4!, hitting the queen while ...Qh2# waits.',
    moves: 'e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 e6 Bc4 Qc7 O-O Nf6 Qe2 Ng4 h3 Nd4' },
  { name: 'Kieninger Trap', side: 'b', slip: 14, win: 'mate',
    note: 'In the Budapest, taking the bishop on b4 opens d3 for the knight: ...Nd3# while the queen pins the e-pawn.',
    moves: 'd4 Nf6 c4 e5 dxe5 Ng4 Nf3 Nc6 Bf4 Bb4+ Nbd2 Qe7 a3 Ngxe5 axb4 Nd3#' },
  { name: 'Englund Gambit Trap', side: 'b', slip: 10, win: 'mate',
    note: 'After ...Qxb2, Bc3?? to hit the queen runs into ...Bb4!, and the queen mates on c1.',
    moves: 'd4 e5 dxe5 Nc6 Nf3 Qe7 Bf4 Qb4+ Bd2 Qxb2 Bc3 Bb4 Qd2 Bxc3 Qxc3 Qc1#' },
  { name: 'Stafford Gambit Trap', side: 'b', slip: 10, win: 'mate',
    note: 'Bg5 to pin the knight lets it jump: ...Nxe4! gives the queen, and Bxd8 Bxf2+ Ke2 Bg4# mates.',
    moves: 'e4 e5 Nf3 Nf6 Nxe5 Nc6 Nxc6 dxc6 d3 Bc5 Bg5 Nxe4 Bxd8 Bxf2+ Ke2 Bg4#' },
].map((t) => ({ ...t, moves: t.moves.split(' ') }));
