// rivalry: two players' head to head as a 1200x630 PNG, the picture a shared rivalry link shows (og:image).
// GET ?u=<name>&vs=<other> reads every game between them from Lichess (one call, kept an hour by the
// cache header) and draws the score from u's side; on any trouble the site's own picture.
import React from 'https://esm.sh/react@18.2.0';
import { ImageResponse } from 'https://deno.land/x/og_edge@0.0.6/mod.ts';

const h = React.createElement;
const C = { bg: '#12100e', ink: '#f4efe6', muted: '#a8a093', hot: '#ff6a2f', good: '#5fc48a', bad: '#ff6b6b', draw: '#8a8278', track: '#2e2a25' };
const NAME = /^[A-Za-z0-9_-]{2,30}$/;
const FALLBACK = () => Response.redirect('https://chesslabs.gg/og.png', 302);
let fonts: Promise<ArrayBuffer[]> | null = null;
const font = (url: string) => fetch(url).then((r) => r.arrayBuffer());

Deno.serve(async (req) => {
  const q = new URL(req.url).searchParams, a = (q.get('u') || '').trim(), b = (q.get('vs') || '').trim();
  if (!NAME.test(a) || !NAME.test(b) || a.toLowerCase() === b.toLowerCase()) return FALLBACK();
  const res = await fetch(`https://lichess.org/api/games/user/${a}?vs=${b}&max=500&moves=false&tags=false`, { headers: { Accept: 'application/x-ndjson' } }).catch(() => null);
  if (!res?.ok) return FALLBACK(); // a 429 or a missing player: no picture this time, never a retry
  const me = a.toLowerCase();
  let w = 0, d = 0, l = 0, first = Infinity, run = 0, best = [0, 0], cur = '';
  const games = (await res.text()).split('\n').filter((x) => x.trim()).map((x) => JSON.parse(x)).filter((g) => g.variant === 'standard').reverse(); // oldest first
  for (const g of games) {
    const side = g.players?.white?.user?.id === me ? 'white' : 'black', r = !g.winner ? 'D' : g.winner === side ? 'W' : 'L';
    if (r === 'W') w++; else if (r === 'L') l++; else d++;
    run = r === cur ? run + 1 : 1; cur = r;
    if (r === 'W') best[0] = Math.max(best[0], run); if (r === 'L') best[1] = Math.max(best[1], run);
    first = Math.min(first, g.createdAt);
  }
  const n = w + d + l;
  if (!n) return FALLBACK();
  fonts ??= Promise.all([
    font('https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf'),
    font('https://github.com/vercel/geist-font/raw/main/packages/next/dist/fonts/geist-sans/Geist-Bold.ttf'),
  ]);
  const [anton, geist] = await fonts;
  const since = new Date(first).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  const lead = w > l ? `${a} leads` : l > w ? `${b} leads` : 'Level';
  const nameSize = (s: string) => (s.length > 14 ? 52 : s.length > 10 ? 64 : 76);
  const side = (who: string, score: number, colour: string, right = false) => h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', width: 520 } },
    h('div', { style: { fontFamily: 'Anton', fontSize: nameSize(who), lineHeight: 1, textTransform: 'uppercase' } }, who),
    h('div', { style: { fontFamily: 'Anton', fontSize: 210, lineHeight: 1, color: colour } }, String(score)));
  const seg = (k: number, colour: string) => (k ? h('div', { style: { width: `${(k / n) * 100}%`, height: 26, background: colour } }) : null);
  return new ImageResponse(
    h('div', { style: { width: 1200, height: 630, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: C.bg, color: C.ink, fontFamily: 'Geist', padding: '52px 64px' } },
      h('div', { style: { display: 'flex', fontSize: 26, letterSpacing: 6, color: C.hot } }, `RIVALRY · ${n} GAMES SINCE ${since.toUpperCase()}`),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' } },
        side(a, w, w >= l ? C.good : C.bad),
        h('div', { style: { fontFamily: 'Anton', fontSize: 70, color: C.muted, paddingBottom: 70 } }, 'VS'),
        side(b, l, l >= w ? C.good : C.bad, true)),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
        h('div', { style: { display: 'flex', width: 1072, height: 26, borderRadius: 13, overflow: 'hidden', background: C.track } }, seg(w, C.good), seg(d, C.draw), seg(l, C.bad)),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 30, color: C.muted } },
          h('div', { style: { display: 'flex' } }, `${lead}${d ? ` · ${d} drawn` : ''} · best runs ${best[0]} and ${best[1]}`),
          h('div', { style: { display: 'flex', color: C.ink } }, 'chesslabs.gg · settle it')))),
    { width: 1200, height: 630, fonts: [{ name: 'Anton', data: anton, weight: 400 }, { name: 'Geist', data: geist, weight: 700 }],
      headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
});
