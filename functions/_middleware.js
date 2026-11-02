// Cloudflare Pages: a shared profile link (profile?u=<name>) shows that player's card in its preview,
// a picture the card Edge Function draws; every other request passes through untouched.
const CARD = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/card';
const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
export async function onRequest({ request, next }) {
  const res = await next();
  try {
    const url = new URL(request.url), name = (url.searchParams.get('u') || '').trim();
    if (!/^\/profile(\.html)?$/.test(url.pathname) || !/^(cc:)?[A-Za-z0-9_-]{2,30}$/i.test(name) || !(res.headers.get('content-type') || '').includes('text/html')) return res;
    const shown = name.replace(/^cc:/i, ''), img = `${CARD}?u=${encodeURIComponent(name)}`;
    const title = `${shown}'s chess card · Chess Labs`, desc = `${shown}'s play style, strengths and openings, from their real games. Get your own card at chesslabs.gg.`;
    const set = (attr) => ({ element: (el) => el.setAttribute('content', attr) });
    return new HTMLRewriter()
      .on('meta[property="og:image"]', set(img))
      .on('meta[property="og:title"]', set(title))
      .on('meta[property="og:description"]', set(desc))
      .on('meta[name="description"]', set(desc))
      .on('title', { element: (el) => el.setInnerContent(title) })
      .on('head', { element: (el) => el.append(`<meta name="twitter:image" content="${esc(img)}">`, { html: true }) })
      .transform(res);
  } catch { return res; }
}
