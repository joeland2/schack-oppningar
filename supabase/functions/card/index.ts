// card: a player's card as a 1200x630 PNG, the picture a shared profile link shows (og:image).
// GET ?u=<name>[&speed=blitz] draws it from the player's leaderboard row (players), so only cards a
// player saved themselves are shown; anyone else gets the site's own picture.
import React from 'https://esm.sh/react@18.2.0';
import { ImageResponse } from 'https://deno.land/x/og_edge@0.0.6/mod.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const h = React.createElement;
const SKILLS = ['Attack', 'Defense', 'Early game', 'Late game', 'Accuracy', 'Speed'];
const C = { bg: '#12100e', ink: '#f4efe6', muted: '#a8a093', hot: '#ff6a2f', track: '#2e2a25', card: '#f4efe6', cardInk: '#141414' };
let fonts: Promise<ArrayBuffer[]> | null = null;
const font = (url: string) => fetch(url).then((r) => r.arrayBuffer());

Deno.serve(async (req) => {
  const q = new URL(req.url).searchParams, name = (q.get('u') || '').slice(0, 30), speed = q.get('speed');
  const { data } = name ? await db.from('players').select('name, speed, rating, games, overall, style, strength, skills').ilike('name', name.replace(/[%_\\]/g, '\\$&')) : { data: null };
  const rows = (data || []) as Record<string, any>[];
  const p = rows.find((r) => r.speed === speed) || rows.find((r) => r.speed === 'blitz') || rows.sort((a, b) => b.games - a.games)[0];
  if (!p) return Response.redirect('https://chesslabs.gg/og.png', 302);
  fonts ??= Promise.all([
    font('https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf'),
    font('https://github.com/vercel/geist-font/raw/main/packages/next/dist/fonts/geist-sans/Geist-Bold.ttf'),
  ]);
  const [anton, geist] = await fonts;
  const display = String(p.name).replace(/^cc:/i, '');
  const bar = (k: string) => h('div', { key: k, style: { display: 'flex', alignItems: 'center', gap: 18, fontSize: 30 } },
    h('div', { style: { width: 200, color: C.muted } }, k),
    h('div', { style: { display: 'flex', width: 300, height: 18, background: C.track, borderRadius: 9 } },
      h('div', { style: { width: `${Math.max(4, p.skills?.[k] ?? 0)}%`, height: 18, background: C.hot, borderRadius: 9 } })),
    h('div', { style: { width: 60, textAlign: 'right' } }, String(p.skills?.[k] ?? '–')));
  return new ImageResponse(
    h('div', { style: { width: 1200, height: 630, display: 'flex', background: C.bg, color: C.ink, fontFamily: 'Geist', padding: 56, gap: 56 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', width: 420, background: C.card, color: C.cardInk, borderRadius: 18, padding: 36, justifyContent: 'space-between' } },
        h('div', { style: { display: 'flex', flexDirection: 'column' } },
          h('div', { style: { fontFamily: 'Anton', fontSize: 150, lineHeight: 1 } }, String(p.overall ?? '–')),
          h('div', { style: { fontSize: 26, color: '#62594c' } }, `${p.rating} ${p.speed}`)),
        h('div', { style: { display: 'flex', flexDirection: 'column' } },
          h('div', { style: { fontFamily: 'Anton', fontSize: display.length > 14 ? 46 : 60, lineHeight: 1.05, textTransform: 'uppercase' } }, display),
          h('div', { style: { fontSize: 24, color: '#62594c', marginTop: 8 } }, p.name.startsWith('cc:') ? 'Chess.com' : 'Lichess'))),
      h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' } },
        h('div', { style: { display: 'flex', flexDirection: 'column' } },
          h('div', { style: { fontSize: 28, color: C.muted } }, 'Play style'),
          h('div', { style: { fontFamily: 'Anton', fontSize: 92, lineHeight: 1, color: C.hot, textTransform: 'uppercase' } }, p.style || 'All-rounder'),
          p.strength ? h('div', { style: { fontSize: 32, marginTop: 6 } }, `+ ${p.strength}`) : null),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, ...SKILLS.map(bar)),
        h('div', { style: { fontSize: 28, color: C.muted } }, 'chesslabs.gg · get your own card'))),
    { width: 1200, height: 630, fonts: [{ name: 'Anton', data: anton, weight: 400 }, { name: 'Geist', data: geist, weight: 700 }],
      headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
});
