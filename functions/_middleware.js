// Cloudflare Pages: a shared profile link (profile?u=<name>) shows that player's card in its preview,
// a picture the card Edge Function draws, and a rivalry link (rivals?u=<a>&vs=<b>) the score the rivalry one draws; every other request passes through untouched.
const CARD = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/card', RIVALRY = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/rivalry';
const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
export async function onRequest({ request, next }) {
  const res = await next();
  try {
    const url = new URL(request.url), name = (url.searchParams.get('u') || '').trim(), vs = (url.searchParams.get('vs') || '').trim();
    if (/^\/rivals(\.html)?$/.test(url.pathname) && /^[A-Za-z0-9_-]{2,30}$/.test(name) && /^[A-Za-z0-9_-]{2,30}$/.test(vs) && (res.headers.get('content-type') || '').includes('text/html')) {
      return rewrite(res, `${RIVALRY}?u=${encodeURIComponent(name)}&vs=${encodeURIComponent(vs)}`, `${name} vs ${vs} · Chess Labs`, `Every game between ${name} and ${vs} on Lichess: the score, who is better at what, and where it goes wrong. See your own rivals at chesslabs.gg.`);
    }
    if (!/^\/profile(\.html)?$/.test(url.pathname) || !/^(cc:)?[A-Za-z0-9_-]{2,30}$/i.test(name) || !(res.headers.get('content-type') || '').includes('text/html')) return res;
    const shown = name.replace(/^cc:/i, ''), img = `${CARD}?u=${encodeURIComponent(name)}`;
    const title = `${shown}'s chess card · Chess Labs`, desc = `${shown}'s play style, strengths and openings, from their real games. Get your own card at chesslabs.gg.`;
    return rewrite(res, img, title, desc);
  } catch { return res; }
}
// The page's preview: its picture, title and description, for link previews (Discord, Messenger, X).
function rewrite(res, img, title, desc) {
  const set = (attr) => ({ element: (el) => el.setAttribute('content', attr) });
  return new HTMLRewriter()
    .on('meta[property="og:image"]', set(img))
    .on('meta[property="og:title"]', set(title))
    .on('meta[property="og:description"]', set(desc))
    .on('meta[name="description"]', set(desc))
    .on('title', { element: (el) => el.setInnerContent(title) })
    .on('head', { element: (el) => el.append(`<meta name="twitter:image" content="${esc(img)}">`, { html: true }) })
    .transform(res);
}
