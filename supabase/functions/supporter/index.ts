// supporter: who supports Chess Labs with a monthly Stripe subscription, and the frame each picked for
// their card. The Lichess login is the key, checked with Lichess as in messages.
// GET: every active supporter, [{ p: player, f: frame }] (public: the badge and frame show to everyone).
// GET ?me: your own { active, frame, customer }. POST { frame }: pick your frame (supporters only).
// POST ?checkout: a Stripe Checkout page for the subscription, { url }. POST ?portal: Stripe's page to
// change or cancel it, { url }. POST ?webhook: Stripe's events, which set who is active.
// Admins only: GET ?all lists every row; POST ?admin { player, active } marks a player a supporter by hand (no Stripe).
// Secrets (Supabase, set by the owner): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID (used only when no
// price has the lookup key chesslabs_supporter).
import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = 'https://chesslabs.gg';
const ADMINS = ['joelandersson', 'sicko88'];
const FRAMES = ['holo', 'prism', 'chrome', 'gold', 'neon', 'ice', 'lava', 'galaxy', 'tilt', 'oil', 'glitch', 'none'];
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-lichess-token, content-type, apikey, authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, 'content-type': 'application/json' } });
const KEY = Deno.env.get('STRIPE_SECRET_KEY'), HOOK = Deno.env.get('STRIPE_WEBHOOK_SECRET'), PRICE = Deno.env.get('STRIPE_PRICE_ID');

// A Chess Labs account (the account function): its token is cl_…, kept hashed with the player it is ('cc:name').
async function siteId(token: string, col = 'player') {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const { data } = await db.from('site_sessions').select(col).eq('hash', hash).maybeSingle();
  return (data as Record<string, string> | null)?.[col] ?? null;
}
const who = new Map<string, { id: string; at: number }>();
async function idOf(token: string | null) {
  if (!token) return null;
  const c = who.get(token);
  if (c && Date.now() - c.at < 600_000) return c.id;
  const id = token.startsWith('cl_') ? await siteId(token)
    : await fetch('https://lichess.org/api/account', { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => (r.ok ? (await r.json()).id : null));
  if (!id) return null;
  who.set(token, { id, at: Date.now() });
  return id as string;
}

// Stripe's API takes form fields; nested ones as a[b][c].
async function stripe(path: string, fields: Record<string, string> = {}, method = 'POST') {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers: { Authorization: `Bearer ${KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: method === 'GET' ? undefined : new URLSearchParams(fields) });
  const x = await r.json();
  if (!r.ok) throw new Error(x.error?.message || 'Stripe error');
  return x;
}

// A webhook is Stripe's only if its signature is the HMAC of "t.body" with the webhook secret, and recent.
async function signed(body: string, header: string | null) {
  if (!HOOK || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 600) return false;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(HOOK), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${t}.${body}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

const LIVE = ['active', 'trialing', 'past_due'];
async function hook(req: Request) {
  const body = await req.text();
  if (!(await signed(body, req.headers.get('stripe-signature')))) return json({ error: 'bad signature' }, 400);
  const ev = JSON.parse(body), o = ev.data?.object || {};
  if (ev.type === 'checkout.session.completed' && o.client_reference_id) {
    const player = String(o.client_reference_id).toLowerCase().slice(0, 30);
    const { data } = await db.from('supporters').select('player').eq('player', player).maybeSingle();
    const row = { player, customer: o.customer, active: true, updated: new Date().toISOString() };
    await (data ? db.from('supporters').update(row).eq('player', player) : db.from('supporters').insert(row));
  }
  if (ev.type?.startsWith('customer.subscription.') && o.customer) {
    await db.from('supporters').update({ active: LIVE.includes(o.status) && ev.type !== 'customer.subscription.deleted', updated: new Date().toISOString() }).eq('customer', o.customer);
  }
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const q = new URL(req.url).searchParams;
  if (req.method === 'POST' && q.has('webhook')) return hook(req);
  if (req.method === 'GET' && !q.has('me')) {
    const { data, error } = await db.from('supporters').select('player, frame').eq('active', true).limit(5000);
    if (error) return json({ error: 'error' }, 500);
    return new Response(JSON.stringify(data.map((r) => ({ p: r.player, f: r.frame || 'holo' }))), { headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });
  }
  const id = await idOf(req.headers.get('x-lichess-token'));
  if (!id) return json({ error: 'Log in first.' }, 401);
  if (ADMINS.includes(id) && req.method === 'GET' && q.has('all')) {
    const { data, error } = await db.from('supporters').select('player, active, frame, customer, since').order('since', { ascending: false }).limit(5000);
    return error ? json({ error: 'error' }, 500) : json(data.map((r) => ({ ...r, customer: !!r.customer })));
  }
  if (ADMINS.includes(id) && req.method === 'POST' && q.has('admin')) {
    let b: { player?: unknown; active?: unknown } = {};
    try { b = JSON.parse(await req.text()); } catch { return json({ error: 'bad' }, 400); }
    const player = String(b.player || '').toLowerCase();
    if (!/^[a-z0-9_-]{2,30}$/.test(player)) return json({ error: 'Not a Lichess name.' }, 400);
    const { data: had } = await db.from('supporters').select('player').eq('player', player).maybeSingle();
    const row = { player, active: !!b.active, updated: new Date().toISOString() };
    const { error } = await (had ? db.from('supporters').update(row).eq('player', player) : db.from('supporters').insert(row));
    return error ? json({ error: 'error' }, 500) : json({ ok: true });
  }
  const { data: me } = await db.from('supporters').select('active, frame, customer').eq('player', id).maybeSingle();
  if (req.method === 'GET') return json({ active: !!me?.active, frame: me?.frame || 'holo', customer: !!me?.customer });
  if (req.method !== 'POST') return json({ error: 'bad' }, 405);
  try {
    if (q.has('checkout')) {
      // The price by its lookup key (one price in USD, EUR, GBP and SEK; Checkout shows the buyer's own), else STRIPE_PRICE_ID.
      if (!KEY) return json({ error: 'Supporting opens soon.' }, 503);
      const price = (await stripe('prices?lookup_keys[]=chesslabs_supporter&active=true', {}, 'GET')).data?.[0]?.id || PRICE;
      if (!KEY || !price) return json({ error: 'Supporting opens soon.' }, 503);
      const s = await stripe('checkout/sessions', {
        mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': '1', client_reference_id: id,
        'subscription_data[metadata][player]': id, allow_promotion_codes: 'true',
        ...(me?.customer ? { customer: me.customer } : {}),
        success_url: `${SITE}/profile.html?u=${encodeURIComponent(id)}&supported=1`, cancel_url: `${SITE}/profile.html?u=${encodeURIComponent(id)}`,
      });
      return json({ url: s.url });
    }
    if (q.has('portal')) {
      if (!KEY || !me?.customer) return json({ error: 'No subscription to change.' }, 400);
      const s = await stripe('billing_portal/sessions', { customer: me.customer, return_url: `${SITE}/profile.html?u=${encodeURIComponent(id)}` });
      return json({ url: s.url });
    }
  } catch (e) { return json({ error: (e as Error).message }, 502); }
  let b: { frame?: unknown } = {};
  try { b = JSON.parse(await req.text()); } catch { return json({ error: 'bad' }, 400); }
  if (!me?.active) return json({ error: 'Frames are for supporters.' }, 403);
  if (typeof b.frame !== 'string' || !FRAMES.includes(b.frame)) return json({ error: 'No such frame.' }, 400);
  const { error } = await db.from('supporters').update({ frame: b.frame, updated: new Date().toISOString() }).eq('player', id);
  return error ? json({ error: 'error' }, 500) : json({ frame: b.frame });
});
