// discord: the Chess Labs app for Discord, answering slash commands over HTTP (Discord's "Interactions
// Endpoint URL" points here, so no bot runs anywhere). /chesslabs name:<Lichess name> posts that player's
// card (the card function's picture) with a link to their profile; a player without a saved card gets the
// link to make one. Discord signs every request with the app's key: DISCORD_PUBLIC_KEY (the app's public
// key, from the Developer Portal, set as an Edge Function secret). The command itself is registered once by
// .github/workflows/discord-commands.yml.
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const KEY = Deno.env.get('DISCORD_PUBLIC_KEY') || '';
const CARD = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/card';
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
const bytes = (hex: string) => new Uint8Array((hex.match(/../g) || []).map((h) => parseInt(h, 16)));
let key: Promise<CryptoKey> | null = null;

async function signed(req: Request, body: string) {
  const sig = req.headers.get('x-signature-ed25519'), ts = req.headers.get('x-signature-timestamp');
  if (!sig || !ts || !KEY) return false;
  key ??= crypto.subtle.importKey('raw', bytes(KEY), { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify('Ed25519', await key, bytes(sig), new TextEncoder().encode(ts + body)).catch(() => false);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'bad' }, 405);
  const body = await req.text();
  if (!(await signed(req, body))) return new Response('bad signature', { status: 401 });
  const i = JSON.parse(body);
  if (i.type === 1) return json({ type: 1 }); // Discord's ping when the URL is saved
  const name = String(i.data?.options?.find((o: { name: string }) => o.name === 'name')?.value || '').trim().slice(0, 30);
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(name)) return json({ type: 4, data: { content: 'That is no Lichess name.', flags: 64 } });
  const profile = `https://chesslabs.gg/profile?u=${encodeURIComponent(name)}`;
  const { data } = await db.from('players').select('name, speed, rating, overall, style, strength, games').ilike('name', name.replace(/[%_\\]/g, '\\$&'));
  const p = (data || []).sort((a, b) => b.games - a.games)[0];
  const link = (label: string, url: string) => ({ type: 2, style: 5, label, url }); // a link button
  if (!p) return json({ type: 4, data: { content: `**${name}** has no Chess Labs card yet. Anyone can make it: open their profile and it reads their games.`, components: [{ type: 1, components: [link(`Make ${name}'s card`, profile)] }] } });
  return json({ type: 4, data: {
    embeds: [{ title: `${p.name.replace(/^cc:/, '')} · ${p.style || 'All-rounder'}${p.strength ? ` + ${p.strength}` : ''}`, url: profile, color: 0xff6a2f,
      description: `Overall **${p.overall ?? '–'}** · ${p.rating} ${p.speed}`, image: { url: `${CARD}?u=${encodeURIComponent(p.name)}&h=${Math.floor(Date.now() / 36e5)}` },
      footer: { text: 'chesslabs.gg · what is your chess style?' } }],
    components: [{ type: 1, components: [link('Full profile', profile), link('Get your own card', 'https://chesslabs.gg/profile')] }],
  } });
});
