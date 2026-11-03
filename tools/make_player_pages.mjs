// Static pages for search engines, one per known player with a card (players/<name>.html) and an index
// (players/index.html): their play style, skills and openings from data/pro-cards.json, each account
// they play on, and a link to the live profile. People search "Magnus Carlsen play style"; the page
// answers and offers their own card. Run by stamp.sh.
// While PUBLISH is false the pages carry noindex, are linked from nowhere and stay out of the sitemap,
// so they can be looked over at chesslabs.gg/players/ before search engines see them.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { root, SITE, esc, slug, head, foot } from './page-shell.mjs';
import { PEOPLE } from '../pros.js';

const PUBLISH = false;
const cards = JSON.parse(readFileSync(root + 'data/pro-cards.json', 'utf8'));
const SKILLS = ['Attack', 'Defense', 'Early game', 'Late game', 'Accuracy', 'Speed'];
// One person, all their accounts with a card, the one with most games first.
const people = new Map();
for (const [acct, who] of PEOPLE) {
  const c = cards.find((x) => x.name.toLowerCase() === acct.toLowerCase());
  if (!c) continue;
  const name = who.replace(/^(GM|IM|FM|WGM|WIM|NM|CM)\s+/, ''), p = people.get(name) || { name, title: who, accts: [] };
  p.accts.push(c); people.set(name, p);
}
const list = [...people.values()].map((p) => ({ ...p, slug: slug(p.name), accts: p.accts.sort((a, b) => b.games - a.games) }));
console.assert(new Set(list.map((p) => p.slug)).size === list.length, 'player pages: unique slugs');
const site = (a) => (a.name.startsWith('cc:') ? 'Chess.com' : 'Lichess');
const nick = (a) => a.name.replace(/^cc:/, '');
const style = (a) => `${a.style || 'All-rounder'}${a.strength ? ` + ${a.strength}` : ''}`;
const pct = (x) => `${Math.round(x * 100)}%`;

function acctHtml(a) {
  const side = (s) => (a.openings || []).filter((o) => o.side === s).slice(0, 5);
  const ops = (s) => side(s).length ? `<ul class="pl-ops">${side(s).map((o) => `<li><span>${esc(o.fam)}</span><small>${o.n} games · scores ${pct(o.score)}</small></li>`).join('')}</ul>` : '<p class="info">Too few games to say.</p>';
  return `<section class="pl-acct">
      <h2>${esc(nick(a))} <small>${site(a)} · ${a.rating} ${a.speed} · ${a.games} games read</small></h2>
      <p class="pl-style"><b>${esc(style(a))}</b> · overall ${a.overall}</p>
      <ul class="pl-skills">${SKILLS.map((k) => `<li><span>${k}</span><i style="--v:${a.skills?.[k] ?? 0}%"></i><b>${a.skills?.[k] ?? '–'}</b></li>`).join('')}</ul>
      <div class="pl-two"><div><h3>As White</h3>${ops('w')}</div><div><h3>As Black</h3>${ops('b')}</div></div>
      <p><a class="cta" href="profile.html?u=${encodeURIComponent(a.name)}">See ${esc(nick(a))}'s live profile</a></p>
    </section>`;
}
function playerPage(p) {
  const a = p.accts[0];
  const title = `${p.name}'s chess style: ${style(a)} · Chess Labs`;
  const desc = `How ${p.title} plays, read from ${a.games} ${a.speed} games on ${site(a)}: a ${style(a)}, overall ${a.overall}, with ${SKILLS.map((k) => `${k.toLowerCase()} ${a.skills?.[k] ?? '–'}`).join(', ')}. And the openings they choose.`;
  const ld = { '@context': 'https://schema.org', '@type': 'ProfilePage', name: title, description: desc, url: `${SITE}/players/${p.slug}.html`, mainEntity: { '@type': 'Person', name: p.name } };
  return head(title, desc, `players/${p.slug}.html`, PUBLISH) + `  <main class="wrap trap-page pl-page">
    <p class="trap-crumbs"><a href="players/">Players</a></p>
    <h1>${esc(p.name)}'s chess style</h1>
    <p class="trap-lead">${esc(p.title)} plays like a <b>${esc(style(a))}</b>, read from their last ${a.games} rated ${a.speed} games on ${site(a)}.${p.accts.length > 1 ? ` They play on ${p.accts.length} accounts; each is read on its own.` : ''}</p>
    ${p.accts.map(acctHtml).join('\n    ')}
    <section class="pl-you"><h2>What is your chess style?</h2><p>Chess Labs reads your last games on Lichess or Chess.com and draws your card: your style, your skills and the openings you choose. It takes a minute.</p><p><a class="cta" href="profile.html">Get your own card</a></p></section>
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
  </main>
` + foot;
}
function indexPage() {
  const title = 'How the best chess players play: their styles and openings · Chess Labs';
  const desc = `The play styles of ${list.length} top players and streamers, from Magnus Carlsen on: their skills and the openings they choose, read from their own games.`;
  return head(title, desc, 'players/', PUBLISH) + `  <main class="wrap trap-page">
    <h1>How the best players play</h1>
    <p class="trap-lead">Each card is read from the player's own recent games: their style, their skills and the openings they choose.</p>
    <ul class="trap-list">${list.map((p) => `<li><a href="players/${p.slug}.html"><b>${esc(p.name)}</b><span>${esc(style(p.accts[0]))} · overall ${p.accts[0].overall}</span></a></li>`).join('')}</ul>
  </main>
` + foot;
}

mkdirSync(root + 'players', { recursive: true });
for (const p of list) writeFileSync(`${root}players/${p.slug}.html`, playerPage(p));
writeFileSync(root + 'players/index.html', indexPage());
if (PUBLISH) {
  const sm = root + 'sitemap.xml', urls = readFileSync(sm, 'utf8').match(/<loc>[^<]+<\/loc>/g).map((x) => x.slice(5, -6)).filter((u) => !u.includes('/players/'));
  const all = [...urls, `${SITE}/players/`, ...list.map((p) => `${SITE}/players/${p.slug}.html`)];
  writeFileSync(sm, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${all.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);
}
console.log(`player pages: ${list.length}${PUBLISH ? '' : ' (noindex, not in the sitemap)'}`);
