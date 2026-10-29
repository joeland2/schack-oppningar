// Maia (github.com/CSSLab/maia-chess, GPLv3): small Leela Chess Zero nets trained on Lichess games to
// play the move a human of a given rating would play, one net per 100 points from 1100 to 1900. The
// nets in engine/maia/ are the original files; they are read and run here in plain JavaScript (6
// residual blocks of 64 filters with squeeze-excitation, a convolutional policy head), as lc0 does
// with one node of search: the net's own move choice, no engine search on top.

export const MAIA_MIN = 1100, MAIA_MAX = 1900;
export const maiaLevel = (r) => Math.min(MAIA_MAX, Math.max(MAIA_MIN, Math.round(r / 100) * 100));

// ---------- Reading the net (lc0's protobuf format, net.proto) ----------
function varint(b, i) {
  let r = 0, s = 1, x;
  do { x = b[i++]; r += (x & 0x7f) * s; s *= 128; } while (x >= 0x80);
  return [r, i];
}
// The fields of one message: field number -> list of values ([start, end] for bytes, numbers otherwise).
function fields(b, start = 0, end = b.length) {
  const out = {}, view = new DataView(b.buffer, b.byteOffset);
  let i = start;
  while (i < end) {
    let key, v;
    [key, i] = varint(b, i);
    const type = key & 7;
    if (type === 0) [v, i] = varint(b, i);
    else if (type === 2) { let n; [n, i] = varint(b, i); v = [i, i + n]; i += n; }
    else if (type === 5) { v = view.getFloat32(i, true); i += 4; }
    else if (type === 1) { v = null; i += 8; }
    else throw new Error('maia: bad protobuf');
    (out[Math.floor(key / 8)] ||= []).push(v);
  }
  return out;
}
const sub = (b, msg, f) => (msg[f] ? fields(b, ...msg[f][0]) : null);
// A layer of numbers, stored as 16-bit steps between min_val and max_val (LINEAR16, all Maia uses).
function layer(b, msg, f) {
  const l = sub(b, msg, f);
  if (!l) return null;
  if (l[4] && l[4][0] !== 1) throw new Error('maia: only LINEAR16 weights are read');
  const min = l[1][0], max = l[2][0], [s, e] = l[3][0], view = new DataView(b.buffer, b.byteOffset);
  const out = new Float32Array((e - s) / 2);
  for (let k = 0; k < out.length; k++) { const t = view.getUint16(s + 2 * k, true) / 0xffff; out[k] = min * (1 - t) + max * t; }
  return out;
}
// A 3x3 convolution with its batch norm folded into weights and bias, as lc0 does.
function convBlock(b, msg) {
  const w = layer(b, msg, 1), bias = layer(b, msg, 2), means = layer(b, msg, 3), vars = layer(b, msg, 4);
  const gammas = layer(b, msg, 5), betas = layer(b, msg, 6);
  const out = (means || bias).length, per = w.length / out, b2 = new Float32Array(out);
  for (let o = 0; o < out; o++) {
    if (!means) { b2[o] = bias[o]; continue; }
    const s = (gammas ? gammas[o] : 1) / Math.sqrt(vars[o] + 1e-5);
    for (let k = 0; k < per; k++) w[o * per + k] *= s;
    b2[o] = (betas ? betas[o] : 0) - s * (means[o] - (bias ? bias[o] : 0));
  }
  return { w, bias: b2, inC: per / 9, outC: out };
}
function readNet(bytes) {
  const top = fields(bytes), w = sub(bytes, top, 10);
  const res = w[2].map(([s, e]) => {
    const r = fields(bytes, s, e), se = sub(bytes, r, 3);
    return { conv1: convBlock(bytes, sub(bytes, r, 1)), conv2: convBlock(bytes, sub(bytes, r, 2)),
      se: { w1: layer(bytes, se, 1), b1: layer(bytes, se, 2), w2: layer(bytes, se, 3), b2: layer(bytes, se, 4) } };
  });
  return { input: convBlock(bytes, sub(bytes, w, 1)), res, policy1: convBlock(bytes, sub(bytes, w, 11)), policy: convBlock(bytes, sub(bytes, w, 3)) };
}

// ---------- Running it ----------
function conv3(x, { w, bias, inC, outC }, relu) {
  const y = new Float32Array(outC * 64);
  for (let o = 0; o < outC; o++) {
    const out = y.subarray(o * 64, o * 64 + 64);
    out.fill(bias[o]);
    for (let i = 0; i < inC; i++) {
      const inp = x.subarray(i * 64, i * 64 + 64);
      for (let k = 0; k < 9; k++) {
        const v = w[(o * inC + i) * 9 + k];
        if (!v) continue;
        const dy = Math.floor(k / 3) - 1, dx = (k % 3) - 1;
        for (let r = Math.max(0, -dy); r < Math.min(8, 8 - dy); r++) {
          for (let f = Math.max(0, -dx); f < Math.min(8, 8 - dx); f++) out[r * 8 + f] += v * inp[(r + dy) * 8 + f + dx];
        }
      }
    }
  }
  if (relu) for (let k = 0; k < y.length; k++) if (y[k] < 0) y[k] = 0;
  return y;
}
function residual(x, { conv1, conv2, se }) {
  const u = conv3(conv3(x, conv1, true), conv2, false), C = conv2.outC, fc = se.b1.length;
  const pool = new Float32Array(C), h = new Float32Array(fc), z = new Float32Array(2 * C);
  for (let c = 0; c < C; c++) { let s = 0; for (let k = 0; k < 64; k++) s += u[c * 64 + k]; pool[c] = s / 64; }
  for (let j = 0; j < fc; j++) { let s = se.b1[j]; for (let c = 0; c < C; c++) s += se.w1[j * C + c] * pool[c]; h[j] = Math.max(0, s); }
  for (let j = 0; j < 2 * C; j++) { let s = se.b2[j]; for (let c = 0; c < fc; c++) s += se.w2[j * fc + c] * h[c]; z[j] = s; }
  for (let c = 0; c < C; c++) {
    const g = 1 / (1 + Math.exp(-z[c]));
    for (let k = c * 64; k < c * 64 + 64; k++) u[k] = Math.max(0, g * u[k] + z[C + c] + x[k]);
  }
  return u;
}

// The 112 input planes (lc0's classical format): the last 8 positions, each as 12 piece planes from
// the side to move's view (its pieces first, the board turned for Black) and a repetition plane, then
// castling rights, side to move, the fifty-move counter and a plane of ones.
const PIECES = 'pnbrqk';
function encode(fens) {
  const x = new Float32Array(112 * 64), now = fens[fens.length - 1].split(' ');
  const us = now[1], flip = us === 'b';
  const seen = fens.map((f) => f.split(' ').slice(0, 4).join(' '));
  for (let h = 0; h < 8 && h < fens.length; h++) {
    const idx = fens.length - 1 - h, rows = fens[idx].split(' ')[0].split('/');
    rows.forEach((row, ri) => {
      let file = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { file += Number(ch); continue; }
        const white = ch === ch.toUpperCase(), rank = flip ? ri : 7 - ri;
        const plane = h * 13 + ((white ? 'w' : 'b') === us ? 0 : 6) + PIECES.indexOf(ch.toLowerCase());
        x[plane * 64 + rank * 8 + file] = 1;
        file++;
      }
    });
    if (seen.indexOf(seen[idx]) < idx) x.fill(1, (h * 13 + 12) * 64, (h * 13 + 13) * 64);
  }
  const castle = now[2], [ourK, ourQ, theirK, theirQ] = flip ? ['k', 'q', 'K', 'Q'] : ['K', 'Q', 'k', 'q'];
  [ourQ, ourK, theirQ, theirK].forEach((c, k) => { if (castle.includes(c)) x.fill(1, (104 + k) * 64, (105 + k) * 64); });
  if (flip) x.fill(1, 108 * 64, 109 * 64);
  x.fill(Number(now[4]) || 0, 109 * 64, 110 * 64);
  x.fill(1, 111 * 64, 112 * 64);
  return x;
}
// After 1.e4, from Black's view: Black's pawns on the second row, White's e-pawn on e5, Black to move.
console.assert(((x) => x[8] && x[6 * 64 + 36] && x[108 * 64])(encode(['rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'])), 'maia encode');

// The net's chance for each legal move: fens are the game's positions, oldest first, ending with the
// position to play from; moves are its legal moves as { from, to, promotion }.
function policy(net, policyAt, fens, moves) {
  let x = conv3(encode(fens), net.input, true);
  for (const r of net.res) x = residual(x, r);
  const out = conv3(conv3(x, net.policy1, true), net.policy, false);
  const logit = new Map();
  policyAt.forEach((uci, k) => { if (uci) logit.set(uci, out[k]); });
  const flip = fens[fens.length - 1].split(' ')[1] === 'b';
  const turn = (sq) => (flip ? sq[0] + (9 - Number(sq[1])) : sq);
  const scores = moves.map((m) => logit.get(turn(m.from) + turn(m.to) + (m.promotion && m.promotion !== 'n' ? m.promotion : '')) ?? -1e9);
  const top = Math.max(...scores), e = scores.map((s) => Math.exp(s - top)), sum = e.reduce((a, b) => a + b, 0);
  return moves.map((m, k) => ({ move: m, p: e[k] / sum })).sort((a, b) => b.p - a.p);
}

// ---------- Loading ----------
const NETS = new Map();
let POLICY_AT = null;
async function bytesOf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`maia: ${url} ${res.status}`);
  const raw = new Uint8Array(await res.arrayBuffer());
  if (raw[0] !== 0x1f || raw[1] !== 0x8b) return raw; // the server already unpacked it
  return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
export function loadMaia(level) {
  if (!NETS.has(level)) {
    const p = Promise.all([bytesOf(`engine/maia/maia-${level}.pb.gz`), POLICY_AT || fetch('engine/maia/policy.json').then((r) => r.json())])
      .then(([bytes, at]) => { POLICY_AT = at; return readNet(bytes); });
    p.catch(() => NETS.delete(level)); // a failed download is tried again next time
    NETS.set(level, p);
  }
  return NETS.get(level);
}

// The move a player of this rating would most likely play: always Maia's top move, never a draw among
// the others (a draw let a 6% blunder through one game in seventeen). Resolves the ranked list too.
export async function maiaMove(rating, fens, moves) {
  const net = await loadMaia(maiaLevel(rating));
  const ranked = policy(net, POLICY_AT, fens, moves);
  return { move: ranked[0].move, ranked };
}
