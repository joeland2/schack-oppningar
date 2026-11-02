// The end of a game or a puzzle, shared by every page with a board: the stamp that slams onto the
// board and confetti fired from its two bottom corners.
const REDUCE_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const frameOf = (el) => el?.closest?.('.board-frame') || document.querySelector('.board-frame');

// The stamp over the board when a game ends (a win also gets confetti, see celebrate): the word slams down
// and the board jolts. "Draw · by repetition" puts what follows the dot under the word.
export function banner(text, kind = '', el) {
  const frame = frameOf(el), [word, more] = text.split(' · ');
  frame.querySelector('.mate-banner')?.remove();
  frame.insertAdjacentHTML('beforeend', `<div class="mate-banner${kind ? ` ${kind}` : ''}" role="status"><b class="stamp">${word}${more ? `<small>${more}</small>` : ''}</b></div>`);
  frame.classList.remove('thud'); void frame.offsetWidth; frame.classList.add('thud');
  setTimeout(() => frame.querySelector('.mate-banner')?.remove(), 3500);
}

// Confetti from two cannons at the board's bottom corners, in an arc that meets over it and drifts down: a
// mate, a line learned, cleared or played against the clock. n bits in all; none with reduced motion.
const CONFETTI = ['#ff6a2f', '#ffb84d', '#f7d774', '#f4efe6', '#2f9e5b', '#4dc9ff'];
let bits = [], bitsRaf = 0, bitsCanvas = null;
export function confetti(n, el) {
  if (REDUCE_MOTION || !n) return;
  const box = frameOf(el).getBoundingClientRect(), k = Math.max(0.6, box.width / 400), r = (a, b) => a + Math.random() * (b - a);
  if (!bitsCanvas) { bitsCanvas = Object.assign(document.createElement('canvas'), { className: 'confetti' }); document.body.append(bitsCanvas); }
  bitsCanvas.width = innerWidth * devicePixelRatio; bitsCanvas.height = innerHeight * devicePixelRatio;
  for (let i = 0; i < n; i++) {
    const right = i % 2;
    bits.push({ x: right ? box.right : box.left, y: box.bottom, vx: (right ? -1 : 1) * r(2.5, 6.5) * k, vy: -r(6.5, 11) * k, g: 0.16 * k, rot: 0, vr: r(-0.2, 0.2),
      flip: r(0.1, 0.3), seed: r(0, 100), size: r(6, 10) * Math.min(k, 1.4), color: CONFETTI[i % CONFETTI.length], age: 0, life: r(130, 190) });
  }
  let t0 = 0;
  const ctx = bitsCanvas.getContext('2d');
  const frame = (t) => {
    const dt = Math.min(32, t - (t0 || t)) / 16.7; t0 = t;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); ctx.clearRect(0, 0, innerWidth, innerHeight);
    bits = bits.filter((b) => (b.age += dt) < b.life);
    for (const b of bits) {
      b.vx *= 0.982 ** dt; b.vy = b.vy * 0.982 ** dt + b.g * dt; b.vx += Math.sin((b.age + b.seed) * 0.08) * 0.15 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt;
      const flip = Math.cos((b.age + b.seed) * b.flip);
      ctx.globalAlpha = Math.min(1, (b.life - b.age) / 25);
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot); ctx.fillStyle = b.color; ctx.fillRect(-b.size / 2, -b.size * 0.3 * flip, b.size, b.size * 0.6 * flip); ctx.restore();
    }
    bitsRaf = bits.length ? requestAnimationFrame(frame) : 0;
    if (!bitsRaf) ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  if (!bitsRaf) bitsRaf = requestAnimationFrame(frame);
}
