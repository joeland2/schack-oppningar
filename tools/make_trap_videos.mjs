// Vertical shorts (1080x1920, 30 fps) of the named traps, for YouTube Shorts, TikTok and Reels.
// Needs the site served at localhost:8765 (python3 -m http.server 8765), Chrome and ffmpeg.
// node tools/make_trap_videos.mjs <outdir> [name filter]
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [out = 'trap-videos', only = ''] = process.argv.slice(2);
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
const count = await ev(`import('/traps.js').then((m) => m.NAMED_TRAPS.length)`);
for (let i = 0; i < count; i++) {
  const { total, name } = await ev(`setup(${i})`);
  if (only && !name.toLowerCase().includes(only.toLowerCase())) continue;
  const dir = mkdtempSync(join(tmpdir(), 'tvf-'));
  for (let n = 0; n < total; n++) writeFileSync(join(dir, `${String(n).padStart(5, '0')}.jpg`), Buffer.from((await ev(`frame(${n})`)).split(',')[1], 'base64'));
  const file = join(out, `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ']/g, '').replace(/[^a-z0-9]+/g, '-')}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', join(dir, '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', file]);
  rmSync(dir, { recursive: true });
  console.log('ok', file, `${(total / 30).toFixed(1)}s`);
}
ws.close(); chrome.kill();
