// The frame of the static pages for search engines (traps/, players/): the head with its tags, the
// header and the footer, stamped with the site's ?v= like the rest of it.
import { readFileSync } from 'node:fs';

export const root = new URL('..', import.meta.url).pathname;
export const v = readFileSync(root + 'index.html', 'utf8').match(/style\.css\?v=(\d+)/)?.[1] || '1';
export const SITE = 'https://chesslabs.gg';
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const head = (title, desc, path, index = true) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <base href="/">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${SITE}/${path}">${index ? '' : '\n  <meta name="robots" content="noindex">'}
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
export const foot = `  <footer class="wrap foot-mini"><div class="foot-row"><a href="traps/">All opening traps</a><a href="./">Opening trainer</a><a href="profile.html">Find your play style</a></div></footer>
</body>
</html>
`;

