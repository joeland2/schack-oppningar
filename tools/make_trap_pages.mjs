// Static pages for search engines: one per named trap (traps/<slug>.html), one per opening that has
// traps (traps/<opening>-traps.html) and an index (traps/index.html), all from traps.js, plus their
// sitemap entries. Run by stamp.sh, so the pages carry the same ?v= stamp as the rest of the site.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { NAMED_TRAPS } from '../traps.js';

const root = new URL('..', import.meta.url).pathname;
const v = readFileSync(root + 'index.html', 'utf8').match(/style\.css\?v=(\d+)/)?.[1] || '1';
const SITE = 'https://chesslabs.gg';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Opening names from data/*.tsv (lichess-org/chess-openings): the longest named line the trap follows.
const NAMES = new Map();
for (const f of 'abcde') for (const row of readFileSync(`${root}data/${f}.tsv`, 'utf8').split('\n').slice(1)) {
  const [, name, pgn] = row.split('\t');
  if (pgn) NAMES.set(pgn.replace(/\d+\.\s*/g, '').trim(), name);
}
const openingOf = (moves, upTo) => {
  for (let i = upTo; i > 0; i--) { const n = NAMES.get(moves.slice(0, i).join(' ')); if (n) return n; }
  return '';
};
const numbered = (moves) => moves.map((m, i) => (i % 2 ? m : `${i / 2 + 1}.${m}`)).join(' ');
const sideName = (c) => (c === 'w' ? 'White' : 'Black');

const traps = NAMED_TRAPS.map((t) => {
  // Broad names ("Indian Defense: Budapest Defense") go by the part people search for.
  const full = openingOf(t.moves, t.slip), [a, b] = full.split(/:\s*/), family = (/^(Indian Defense|King's Pawn Game|Queen's Pawn Game)$/.test(a) && b ? b.split(',')[0].replace(/ Accepted$/, '') : a) || 'Opening';
  return { ...t, slug: slug(t.name.endsWith('Trap') || t.name.endsWith('Mate') ? t.name : `${t.name} trap`), full, family };
});
const families = [...new Set(traps.map((t) => t.family))];
const famSlug = (f) => `${slug(f)}-traps`;
console.assert(new Set(traps.map((t) => t.slug)).size === traps.length, 'trap pages: unique slugs');

const head = (title, desc, path) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <base href="/">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${SITE}/${path}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta property="og:site_name" content="Chess Labs">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${SITE}/${path}">
  <meta property="og:image" content="${SITE}/og.png">
  <meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Geist:wght@400;500;700&family=Geist+Mono:wght@400;500&display=swap">
  <link rel="stylesheet" href="style.css?v=${v}">
  <script src="header.js?v=${v}" defer></script>
  <script src="theme.js?v=${v}"></script>
</head>
<body>
  <header class="top">
    <div class="wrap top-in">
      <a class="brand" href="./">Chess<span>Labs</span></a>
      <nav class="top-nav" aria-label="Sections"><a href="./#openings">Openings</a><a href="traps/">Traps</a><a href="profile.html">Profile</a></nav>
      <button id="theme" class="ghost theme" type="button" aria-label="Switch theme"></button>
    </div>
  </header>
`;
const foot = `  <footer class="wrap foot-mini"><div class="foot-row"><a href="traps/">All opening traps</a><a href="./">Opening trainer</a><a href="profile.html">Find your play style</a></div></footer>
</body>
</html>
`;

function trapPage(t) {
  const me = sideName(t.side), them = sideName(t.side === 'w' ? 'b' : 'w'), slipMove = numbered(t.moves).split(' ')[t.slip];
  const title = `${t.name}: how it works and how to ${t.avoid ? 'play or avoid' : 'play'} it · Chess Labs`;
  const desc = `The ${t.name} in the ${t.full || t.family}: ${t.note} It gives ${me} ${t.win}.`;
  const others = traps.filter((x) => x.family === t.family && x !== t);
  const practise = `./?practise=${t.side}~${encodeURIComponent(t.family)}`;
  const ld = { '@context': 'https://schema.org', '@type': 'Article', headline: t.name, description: desc, url: `${SITE}/traps/${t.slug}.html`, publisher: { '@type': 'Organization', name: 'Chess Labs', url: SITE } };
  return head(title, desc, `traps/${t.slug}.html`) + `  <main class="wrap trap-page">
    <p class="trap-crumbs"><a href="traps/">Opening traps</a> › <a href="traps/${famSlug(t.family)}.html">${esc(t.family)}</a></p>
    <h1>${esc(t.name)}</h1>
    <p class="trap-lead">A trap for <b>${me}</b> in the ${esc(t.full || t.family)}. ${them}'s natural-looking <b>${esc(slipMove)}</b> gives ${me} ${esc(t.win)}.</p>
    <div class="trap-grid">
      <div class="board-frame"><div id="board" class="board mini" data-moves="${esc(t.moves.join(' '))}" data-slip="${t.slip}" data-side="${t.side}" role="img" aria-label="Chessboard showing the ${esc(t.name)}"></div>
        <div class="trap-ctl"><button type="button" class="ghost" data-go="start" aria-label="To the start">«</button><button type="button" class="ghost" data-go="-1" aria-label="Back one move">‹</button><button type="button" class="cta" data-go="play">Play</button><button type="button" class="ghost" data-go="1" aria-label="Forward one move">›</button><button type="button" class="ghost" data-go="end" aria-label="To the end">»</button></div>
      </div>
      <div class="trap-text">
        <h2>The moves</h2>
        <p class="trap-moves">${numbered(t.moves).split(' ').map((m, i) => `<button type="button" data-ply="${i + 1}" class="${i === t.slip ? 'slip' : i > t.slip ? 'punish' : ''}">${esc(m)}${i === t.slip ? '??' : ''}</button>`).join(' ')}</p>
        <h2>How it works</h2>
        <p>${esc(t.note)}</p>
        <h2>What it wins</h2>
        <p>${me} gets ${esc(t.win)}.</p>
        ${t.avoid ? `<h2>How ${them} avoids it</h2>
        <p>${esc(t.avoid.note)} The safe move is <b>${esc(t.avoid.safe)}</b>.</p>` : ''}
        <p class="trap-cta"><a class="cta" href="${practise}">Practise the ${esc(t.family)} as ${me}</a><small>The trainer plays the moves real players at your rating choose, and springs this trap when they do.</small></p>
        ${others.length ? `<h2>More ${esc(t.family)} traps</h2><ul class="trap-more">${others.map((x) => `<li><a href="traps/${x.slug}.html">${esc(x.name)}</a></li>`).join('')}</ul>` : ''}
      </div>
    </div>
  </main>
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
  <script type="module" src="traps/trap-page.js?v=${v}"></script>
` + foot;
}

function familyPage(f) {
  const ts = traps.filter((t) => t.family === f);
  const title = `${f} traps: ${ts.length === 1 ? 'the trap' : `${ts.length} traps`} to know · Chess Labs`;
  const desc = `The known traps in the ${f}: ${ts.map((t) => t.name).join(', ')}. The moves, how each one works, and how to avoid it.`;
  return head(title, desc, `traps/${famSlug(f)}.html`) + `  <main class="wrap trap-page">
    <p class="trap-crumbs"><a href="traps/">Opening traps</a></p>
    <h1>${esc(f)} traps</h1>
    <p class="trap-lead">${ts.length === 1 ? 'The known trap' : `The ${ts.length} known traps`} in the ${esc(f)}, each with the moves, why it works and how to stay out of it.</p>
    <ul class="trap-list">${ts.map((t) => `<li><a href="traps/${t.slug}.html"><b>${esc(t.name)}</b><span>For ${sideName(t.side)} · ${esc(numbered(t.moves.slice(0, t.slip + 1)))}?? · wins ${esc(t.win)}</span></a></li>`).join('')}</ul>
    <p class="trap-cta"><a class="cta" href="./?practise=${ts[0].side}~${encodeURIComponent(f)}">Practise the ${esc(f)}</a></p>
  </main>
` + foot;
}

function indexPage() {
  const title = 'Chess opening traps: every famous trap, move by move · Chess Labs';
  const desc = `${traps.length} famous chess opening traps, from the Fried Liver and Légal's Mate to the Traxler and Noah's Ark: the moves, how each works, and how to avoid it.`;
  const group = (side) => traps.filter((t) => t.side === side).map((t) => `<li><a href="traps/${t.slug}.html"><b>${esc(t.name)}</b><span>${esc(t.family)} · wins ${esc(t.win)}</span></a></li>`).join('');
  return head(title, desc, 'traps/') + `  <main class="wrap trap-page">
    <h1>Chess opening traps</h1>
    <p class="trap-lead">The famous traps, each checked with Stockfish: the moves, why the slip loses, and how the other side stays out of it.</p>
    <h2>Traps for White</h2><ul class="trap-list">${group('w')}</ul>
    <h2>Traps for Black</h2><ul class="trap-list">${group('b')}</ul>
    <h2>By opening</h2><ul class="trap-more">${families.map((f) => `<li><a href="traps/${famSlug(f)}.html">${esc(f)} traps</a></li>`).join('')}</ul>
  </main>
` + foot;
}

mkdirSync(root + 'traps', { recursive: true });
for (const t of traps) writeFileSync(`${root}traps/${t.slug}.html`, trapPage(t));
for (const f of families) writeFileSync(`${root}traps/${famSlug(f)}.html`, familyPage(f));
writeFileSync(root + 'traps/index.html', indexPage());

// The sitemap: the site's own pages stay, the trap pages are written fresh after them.
const sm = root + 'sitemap.xml', urls = readFileSync(sm, 'utf8').match(/<loc>[^<]+<\/loc>/g).map((x) => x.slice(5, -6)).filter((u) => !u.includes('/traps/'));
const all = [...urls, `${SITE}/traps/`, ...families.map((f) => `${SITE}/traps/${famSlug(f)}.html`), ...traps.map((t) => `${SITE}/traps/${t.slug}.html`)];
writeFileSync(sm, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${all.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`trap pages: ${traps.length} traps, ${families.length} openings`);
