// track: one usage event from the site (header.js), stored with where the visitor is.
// The IP address is cut before it is stored: the last part of an IPv4 address is zeroed (83.250.12.147
// becomes 83.250.12.0), an IPv6 address keeps its first three groups. The whole address is never kept.
// The country and city come from ipapi.co (looked up with the whole address, which is then dropped);
// the device is read from the browser's user agent; the source is the site the visit came from.
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

async function placeOf(ip: string | null) {
  if (!ip) return { country: null, city: null };
  try {
    const r = await fetch(`https://ipapi.co/${ip}/json/`, { signal: AbortSignal.timeout(1500) });
    const x = await r.json();
    return { country: /^[A-Z]{2}$/.test(x.country_code) ? x.country_code : null, city: cut(x.city, 60) };
  } catch { return { country: null, city: null }; }
}

// "iPhone · Safari": the system, then the browser, from the user agent.
function deviceOf(ua: string) {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Other';
  return `${os} · ${br}`;
}
console.assert(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile Safari/604.1') === 'iPhone · Safari', 'deviceOf');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let e: Record<string, unknown> = {};
  try { e = JSON.parse(await req.text()); } catch { return new Response('bad', { status: 400, headers: cors }); }
  if (!KINDS.includes(e.kind as string) || typeof e.visitor !== 'string') return new Response('bad', { status: 400, headers: cors });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null;
  const { error } = await db.from('events').insert({
    kind: e.kind, page: cut(e.page, 40), target: cut(e.target, 80), visitor: cut(e.visitor, 40), user_name: cut(e.user_name, 30),
    ip: anonymise(ip), ...(await placeOf(ip)), device: deviceOf(req.headers.get('user-agent') || ''), source: cut(e.source, 80),
  });
  return new Response(error ? 'error' : 'ok', { status: error ? 500 : 201, headers: cors });
});
