// Maia 3 (github.com/CSSLab/maia3, AGPL-3.0): a transformer trained on Lichess games to play the move a
// human would play, told both players' ratings, any rating. The 5M net in engine/maia3/ is the ONNX
// export at huggingface.co/bqrio/maia3-onnx (fp16, current position only), run with onnxruntime-web.
// It always gives its most likely move, never a draw among the others.
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.wasm.min.mjs';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
ort.env.wasm.numThreads = 1; // GitHub Pages cannot send the headers threads need
let session = null;
const load = () => (session ??= ort.InferenceSession.create('engine/maia3/maia3-5m.fp16.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'basic' })
  .catch((e) => { session = null; throw e; }));

// The board as the net reads it (maia3/dataset.py): 64 squares from a1, 12 piece channels (pawn, knight,
// bishop, rook, queen, king; the side to move's first), mirrored when Black is to move.
const PIECE = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };
function tokens(fen) {
  const black = fen.split(' ')[1] === 'b', t = new Float32Array(64 * 12);
  fen.split(' ')[0].split('/').forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      const white = ch === ch.toUpperCase(), rank = black ? i : 7 - i, own = white !== black;
      t[(rank * 8 + file) * 12 + PIECE[ch.toLowerCase()] + (own ? 0 : 6)] = 1;
      file++;
    }
  });
  return t;
}
// A move's place among the net's 4352 (maia3/utils.py): from * 64 + to for every move, then the
// promotions from the seventh rank, 4 pieces (q, r, b, n) per pair of files; Black's moves mirrored.
const sq = (s) => s.charCodeAt(0) - 97 + 8 * (Number(s[1]) - 1);
function indexOf(m, black) {
  const from = black ? m.from[0] + (9 - Number(m.from[1])) : m.from, to = black ? m.to[0] + (9 - Number(m.to[1])) : m.to;
  if (m.promotion) return 4096 + ((from.charCodeAt(0) - 97) * 8 + (to.charCodeAt(0) - 97)) * 4 + 'qrbn'.indexOf(m.promotion);
  return sq(from) * 64 + sq(to);
}
console.assert(indexOf({ from: 'e2', to: 'e4' }, false) === 12 * 64 + 28 && indexOf({ from: 'e7', to: 'e5' }, true) === 12 * 64 + 28
  && indexOf({ from: 'a7', to: 'b8', promotion: 'n' }, false) === 4096 + 1 * 4 + 3, 'maia3 move index');

// The move a player rated selfElo would most likely play against one rated oppoElo, from chess.js
// verbose legal moves; the ranked list (with each move's share) comes too.
export async function maia3Move(fen, moves, selfElo, oppoElo) {
  const s = await load(), black = fen.split(' ')[1] === 'b';
  const out = await s.run({
    tokens: new ort.Tensor('float32', tokens(fen), [1, 64, 12]),
    elo_self: new ort.Tensor('float32', Float32Array.of(selfElo), [1]),
    elo_oppo: new ort.Tensor('float32', Float32Array.of(oppoElo), [1]),
  });
  const logits = out.logits_move.data, scores = moves.map((m) => Number(logits[indexOf(m, black)]));
  const top = Math.max(...scores), e = scores.map((x) => Math.exp(x - top)), sum = e.reduce((a, b) => a + b, 0);
  const ranked = moves.map((m, k) => ({ move: m, p: e[k] / sum })).sort((a, b) => b.p - a.p);
  return { move: ranked[0].move, ranked };
}
