// Vertical shorts (1080x1920, 30 fps) of the named traps, for YouTube Shorts, TikTok and Reels.
// Needs the site served at localhost:8765 (python3 -m http.server 8765), Chrome and ffmpeg.
// node tools/make_trap_videos.mjs <outdir> [name filter] [card image]
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [out = 'trap-videos', only = '', card = ''] = process.argv.slice(2);
const SR = 44100, MATES = JSON.parse(readFileSync(new URL('trap-video-mates.json', import.meta.url), 'utf8'));
// The sound track, synthesised from the page's cues: a click per move, a thud under the slip, ticks
// for the countdown, a rising whoosh for the punishing moves, a chord at the end, and a soft beat.
function track(frames, cues) {
  const n = Math.ceil(frames / 30 * SR) + SR, a = new Float32Array(n);
  let seed = 7; const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const add = (t0, len, f) => { const i0 = Math.round(t0 * SR); for (let i = 0; i < len * SR && i0 + i < n; i++) a[i0 + i] += f(i / SR); };
  const tone = (t0, len, hz, vol, drop = 0) => add(t0, len, (t) => Math.sin(2 * Math.PI * (hz - drop * t / len / 2) * t) * vol * Math.exp(-t * 6 / len));
  for (let t = 0; t < frames / 30; t += 0.5) tone(t, 0.18, 55, 0.22, 20); // the beat, 120 bpm
  for (const { f, type } of cues) {
    const t = f / 30;
    let lp = 0; const click = (t0, vol) => add(t0, 0.05, (x) => (lp += (noise() - lp) * 0.35) * vol * Math.exp(-x * 90));
    if (type === 'move') { click(t, 0.9); tone(t, 0.06, 420, 0.15); }
    if (type === 'capture') { click(t, 1.2); click(t + 0.03, 0.8); tone(t, 0.1, 300, 0.2); }
    if (type === 'tick') tone(t, 0.08, 1320, 0.25);
    if (type === 'slip') { tone(t, 0.6, 160, 0.6, 220); add(t, 0.3, (x) => noise() * 0.35 * Math.exp(-x * 14)); }
    if (type === 'whoosh') add(t, 0.22, (x) => noise() * 0.18 * Math.sin(Math.PI * x / 0.22));
    if (type === 'hit') { tone(t, 0.4, 70, 0.6, 40); add(t, 0.15, (x) => noise() * 0.2 * Math.exp(-x * 25)); }
    if (type === 'mate' || type === 'win') for (const hz of [523, 659, 784, 1047]) tone(t + (type === 'win' ? 0.05 : 0.15), 1.1, hz, 0.12);
  }
  const peak = a.reduce((m, x) => Math.max(m, Math.abs(x)), 0.01), buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(a[i] / peak * 0.8 * 32767), 44 + i * 2);
  return buf;
}
mkdirSync(out, { recursive: true });
const port = 9334, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tv-'))}`, 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 40 && !ws; i++) {
  await sleep(250);
  try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
}
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const wait = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Page.navigate', { url: 'http://localhost:8765/tools/trap-video.html' });
for (let i = 0; i < 60 && !(await ev('window.ready === true')); i++) await sleep(250);
async function render(total, name, cues) {
  const dir = mkdtempSync(join(tmpdir(), 'tvf-'));
  for (let n = 0; n < total; n++) writeFileSync(join(dir, `${String(n).padStart(5, '0')}.jpg`), Buffer.from((await ev(`frame(${n})`)).split(',')[1], 'base64'));
  writeFileSync(join(dir, 'a.wav'), track(total, cues));
  const file = join(out, `${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f']/g, '').replace(/[^a-z0-9]+/g, '-')}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', join(dir, '%05d.jpg'), '-i', join(dir, 'a.wav'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', file]);
  rmSync(dir, { recursive: true });
  console.log('ok', file, `${(total / 30).toFixed(1)}s`);
}
// With a card image (a path under the site, e.g. /img/card.png): the play style video instead of the traps.
if (card) { const { total, name, cues } = await ev(`setupCard(${JSON.stringify(card)})`); await render(total, name, cues); }
else {
  const count = await ev(`import('/traps.js').then((m) => m.NAMED_TRAPS.length)`);
  for (let i = 0; i < count; i++) {
    // Only the traps that end in mate within a few moves make a short; the rest win material far from mate.
    const name = await ev(`import('/traps.js').then((m) => m.NAMED_TRAPS[${i}].name)`);
    const { total, cues, mate } = await ev(`setup(${i}, ${JSON.stringify(MATES[name] || [])})`);
    if (mate && (!only || name.toLowerCase().includes(only.toLowerCase()))) await render(total, name, cues);
  }
}
ws.close(); chrome.kill();
