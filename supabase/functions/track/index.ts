// track: one usage event from the site (header.js), stored with where the visitor is.
// The IP address is cut before it is stored: the last part of an IPv4 address is zeroed (83.250.12.147
// becomes 83.250.12.0), an IPv6 address keeps its first three groups. The whole address is never kept.
// The country comes from the CDN in front of this function, else from ipapi.co.
import { createClient } from 'npm:@supabase/supabase-js@2';

const KINDS = ['view', 'profile', 'compare', 'analyse', 'practise', 'card', 'login'];
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cut = (s: unknown, n: number) => (typeof s === 'string' && s ? s.slice(0, n) : null);

function anonymise(ip: string | null) {
  if (!ip) return null;
  if (ip.includes('.')) return ip.split('.').slice(0, 3).concat('0').join('.');
  return ip.split(':').slice(0, 3).join(':') + '::';
}
console.assert(anonymise('83.250.12.147') === '83.250.12.0' && anonymise('2a02:aa1:1234:5678::1') === '2a02:aa1:1234::', 'anonymise');

async function countryOf(req: Request, ip: string | null) {
  const cdn = req.headers.get('cf-ipcountry');
  if (cdn && /^[A-Z]{2}$/.test(cdn)) return cdn;
  if (!ip) return null;
  try {
    const r = await fetch(`https://ipapi.co/${ip}/country/`, { signal: AbortSignal.timeout(1500) });
    const c = (await r.text()).trim();
    return /^[A-Z]{2}$/.test(c) ? c : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let e: Record<string, unknown> = {};
  try { e = JSON.parse(await req.text()); } catch { return new Response('bad', { status: 400, headers: cors }); }
  if (!KINDS.includes(e.kind as string) || typeof e.visitor !== 'string') return new Response('bad', { status: 400, headers: cors });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null;
  const { error } = await db.from('events').insert({
    kind: e.kind, page: cut(e.page, 40), target: cut(e.target, 80), visitor: cut(e.visitor, 40), user_name: cut(e.user_name, 30),
    ip: anonymise(ip), country: await countryOf(req, ip),
  });
  return new Response(error ? 'error' : 'ok', { status: error ? 500 : 201, headers: cors });
});
