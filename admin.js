// Admin: how the site is used, the last 30 days. The numbers come from the admin-stats Edge Function
// (supabase/functions/admin-stats), which checks your Lichess login and answers only for the admin.
import { account, login, finishLogin } from './lichess.js?v=20261031195251';
import { cardImage, flagHtml, loadFlags, bandColor, proClass } from './profile.js?v=20261031195251';

const FN = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/admin-stats';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
// A downloaded card, drawn from the code its event carries (profile.js cardCode), or from the
// leaderboard for older events; shown when the row is hovered or tapped.
const TYPE_CODES = ['Striker', 'Guardian', 'Solid builder', 'Endgame artist', 'Time scrambler', 'Trickster', 'Specialist', 'Explorer', 'Marathoner', 'Houdini',
  'Killer instinct', 'Well prepared', 'Grinder', 'Sure hand', 'Speed demon', 'Clutch player', 'Giant killer', 'White specialist', 'Black specialist', 'Fighter', 'Finisher'];
const SPEED_OF = { bu: 'bullet', bl: 'blitz', ra: 'rapid', cl: 'classical', co: 'correspondence' };
const SKILL_KEYS = ['ATK', 'DEF', 'EARLY', 'LATE', 'ACC', 'SPD'];
function cardOf(target, board) {
  const [head, rest] = (target || '').split(' #'), name = head.split(/ · |: /)[0];
  const [code, extra] = (rest || '').split(' ~'); // newer downloads also carry what the image needs (profile.js cardExtra)
  if (code) {
    const [ovr, st, sg, sk, rs, piece] = code.split('/'), m = rs.match(/^(\d+)(\w+)$/);
    const [n, w, b, lead] = extra ? extra.split('~') : [];
    return { name, overall: ovr, style: TYPE_CODES[st], strength: TYPE_CODES[sg], skills: sk.split('.').map((v) => (v === '-' ? null : Number(v))), rating: m && Number(m[1]), speed: m && SPEED_OF[m[2]], piece: piece?.trim(),
      ...(n ? { n: Number(n), w, b, lead: lead || '' } : {}) };
  }
  const r = board.filter((x) => x.name.toLowerCase() === name.toLowerCase()).sort((x, y) => y.games - x.games)[0]; // their main time control
  return r && { name: r.name, overall: r.overall, style: r.style, strength: r.strength, skills: ['Attack', 'Defense', 'Early game', 'Late game', 'Accuracy', 'Speed'].map((k) => r.skills?.[k] ?? null), rating: r.rating, speed: r.speed, piece: r.piece };
}
const cardHtml = (c, look = 'dark', style = false) => `<div class="ad-cv ad-cv-${look}${style ? ' with-style' : ''}"><div class="pf-pcard${proClass(c.name)}" style="--band:${bandColor(c.rating)}">${flagHtml(c.name)}<div class="pf-pcard-top"><div><b class="pf-ovr">${esc(c.overall ?? '–')}</b><span class="pf-pos">${esc(c.style || '')}</span>${c.strength ? `<span class="pf-str">+ ${esc(c.strength)}</span>` : ''}</div>
  <div class="pf-pcard-side"><img class="pf-pcard-piece ink-on-light" src="pieces/b${(c.piece || 'n').toUpperCase()}.svg" alt=""><img class="pf-pcard-piece ink-on-dark" src="pieces/w${(c.piece || 'n').toUpperCase()}.svg" alt="">${c.rating ? `<span class="pf-pcard-rating">${c.rating} <small>${esc(c.speed || '')}</small></span>` : ''}</div></div>
  <p class="pf-pcard-name">${esc(c.name)}</p><div class="pf-pcard-bars">${SKILL_KEYS.map((k, i) => `<div><span>${k}</span><i style="--v:${c.skills[i] ?? 0}%"></i><b>${c.skills[i] ?? '–'}</b></div>`).join('')}</div></div>${style ? `<div class="ad-cv-style"><b>${esc(c.style || '')}</b>${c.strength ? `<span>+ ${esc(c.strength)}</span>` : ''}</div>` : ''}</div>`;
let BOARD = [];
// An event's target with the player names as links to their profiles (looked up, card, analysis, comparison).
const plink = (n) => `<a href="profile.html?u=${encodeURIComponent(n)}">${esc(n)}</a>`;
// The latest downloads and analyses, one row each: an icon for an image or an analysis, the player, what
// was downloaded (card only, card + style, or both: the two images of one click a moment apart) and the look.
const ICON = {
  card: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 16l5-5 4 4 3-3 4 4"/></svg>',
  analyse: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16M5 15l4-5 4 3 6-7"/></svg>',
};
const WHAT = { card: 'Card only', style: 'Card + style', compare: 'Comparison', 'compare + text': 'Comparison + text' };
function actionRows(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i], t = (r.target || '').replace(/ · $/, ''), parts = t.split(' #')[0].split(' · ');
    const where = `<small>${flag(r.country)}${esc(r.city || '')} · ${short(r.at)}</small>`, by = r.name ? ` <small>by ${esc(r.name)}</small>` : '';
    if (r.kind !== 'card') {
      const [name, rest] = t.split(': ');
      // The same analysis started again (stopped and restarted, or a second device): one row, with how often.
      let n = 1;
      while (list[i + 1]?.kind === r.kind && list[i + 1].target === r.target) { n++; i++; }
      out.push(`<li><span class="ad-act">${ICON.analyse}<span><b>Analysis</b> ${plink(name)} <span class="ad-what">${esc((rest || '').replace(/^until (\d+)$/, 'up to $1 games'))}${n > 1 ? ` · started ${n} times` : ''}</span>${by}</span></span>${where}</li>`);
      continue;
    }
    let [name, what, look] = parts, own = r.target || '';
    // Both: the style image's event comes a moment after the card's, from the same click.
    const o = list[i + 1], op = o?.kind === 'card' && (o.target || '').split(' #')[0].split(' · ');
    if (op && op[0] === name && op[2] === look && new Set([what, op[1]]).size === 2 && [what, op[1]].every((x) => x === 'card' || x === 'style')
      && Math.abs(new Date(r.at) - new Date(o.at)) < 60000) { what = 'both'; if (op[1] === 'style') own = o.target; i++; }
    const label = what === 'both' ? 'Both: card, and card + style' : WHAT[what] || esc(what || '');
    const who = name.includes(' vs ') ? name.split(' vs ').map(plink).join(' vs ') : plink(name).replace('<a ', `<a data-card="${esc(own)}" `);
    out.push(`<li><span class="ad-act">${ICON.card}<span><b>Image</b> ${who} <span class="ad-what">${label}</span>${look ? ` <span class="ad-look ${look === 'light' ? 'light' : 'dark'}">${look === 'light' ? 'Light' : 'Dark'}</span>` : ''}${by}</span></span>${where}</li>`);
  }
  return out;
}
function targetHtml(kind, target) {
  const t = (target || '').split(' #')[0];
  if (kind === 'compare') return t.split(' vs ').map(plink).join(' vs ');
  if (!['profile', 'card', 'analyse'].includes(kind) || !t) return esc(t);
  const name = t.split(/ · |: /)[0];
  return (name.includes(' vs ') ? name.split(' vs ').map(plink).join(' vs ') : plink(name)) + esc(t.slice(name.length)); // a comparison image names both
} // the leaderboard, for cards downloaded before their events carried the card
// Today: the time only; otherwise the day too.
const short = (iso) => (new Date(iso).toDateString() === new Date().toDateString() ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : when(iso));
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
// A country code as a name: SE is Sweden; – for an unknown country.
const NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const land = (c) => { try { return c && c !== '–' ? `${NAMES.of(c)} (${c})` : 'Unknown'; } catch { return c || 'Unknown'; } };
const KIND = { profile: 'Looked up a profile', compare: 'Comparisons', analyse: 'Analysed', practise: 'Openings practised', card: 'Cards downloaded', login: 'Lichess logins', line: 'Lines practised', error: 'Errors' };

// Visitors per day (each counted once that day) as a line, and unique visitors (their first visit
// ever) as the shaded area under it, over the picked span; Today (from midnight), 1W and 1M are per hour,
// drawn as a smooth curve through a short moving average (the tooltip has each hour's own numbers).
// Days without visits are zero. Moving the mouse along the graph shows that point's numbers and notes.
const SPANS = [['Today', 'today'], ['1W', 7], ['1M', 30], ['6M', 182], ['1Y', 365], ['All', Infinity]];
let span = 'today';
const hourly = () => span === 'today' || span === 7 || span === 30; // these spans are drawn per hour
const W = 760, H = 180;
const TZ = 'Europe/Stockholm';
const dayKey = (t) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(t));
const hourKey = (t) => `${dayKey(t)} ${new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(t))}`;
// The span's points, oldest first: { key, label, fresh, visitors, views }.
function spanPoints(body) {
  const zero = { fresh: 0, visitors: 0, views: 0 };
  if (hourly()) {
    // Per hour: Today from midnight, 1W and 1M their last 168 and 720 hours.
    const by = new Map((body.perHour || []).map((d) => [d.hour, d])), n = span === 'today' ? Math.max(Number(hourKey(Date.now()).slice(-2)) + 1, 2) : span * 24;
    return Array.from({ length: n }, (_, k) => { const t = Date.now() - (n - 1 - k) * 36e5, key = hourKey(t), h = Number(key.slice(-2));
      return { ...zero, ...by.get(key), key, label: `${span === 'today' ? '' : `${new Date(t).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })}, `}${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00` }; });
  }
  const by = new Map(body.perDay.map((d) => [d.day, d])), n = Number.isFinite(span) ? span : Math.max(body.perDay.length, 2), out = [];
  for (let i = n - 1; i >= 0; i--) { const key = dayKey(Date.now() - i * 864e5); out.push({ ...zero, ...by.get(key), key, label: day(key) }); }
  return out;
}
// Notes on the graph (what was done when: "posted on Reddit"), kept with the admin's account (header.js syncs the key).
const NOTES_KEY = 'chess-trainer-admin-notes';
const notes = () => { try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || []; } catch { return []; } };
const saveNotes = (xs) => { try { localStorage.setItem(NOTES_KEY, JSON.stringify(xs.sort((a, b) => a.t - b.t))); } catch {} };
const noteKey = (t) => (hourly() ? hourKey(t) : dayKey(t));
// A curve through the points that never overshoots them (monotone cubic, Fritsch–Carlson), as an SVG path.
function curve(ps) {
  const n = ps.length, d = ps.slice(1).map(([x, y], i) => (y - ps[i][1]) / (x - ps[i][0])), m = ps.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) if (d[i] === 0) m[i] = m[i + 1] = 0; else { const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b; if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
  return ps.map(([x, y], i) => { if (!i) return `M${x.toFixed(1)},${y.toFixed(1)}`; const [x0, y0] = ps[i - 1], h = (x - x0) / 3;
    return `C${(x0 + h).toFixed(1)},${(y0 + m[i - 1] * h).toFixed(1)} ${(x - h).toFixed(1)},${(y - m[i] * h).toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`; }).join('');
}
console.assert(curve([[0, 0], [1, 1]]).startsWith('M0.0,0.0C'), 'curve');
// Each point as the mean of its neighbours (k on each side), so single hours do not make spikes.
const ease = (vs, k) => vs.map((_, i) => { const w = vs.slice(Math.max(0, i - k), i + k + 1); return w.reduce((t, v) => t + v, 0) / w.length; });
const SMOOTH = () => (span === 30 ? 3 : span === 7 ? 1 : 0); // hours on each side
function visitorLine(ds) {
  const sv = { visitors: ease(ds.map((d) => d.visitors), SMOOTH()), fresh: ease(ds.map((d) => d.fresh), SMOOTH()), back: ease(ds.map((d) => Math.max(0, d.visitors - d.fresh)), SMOOTH()) };
  // The scale: a round step with about four lines up to just above the highest point, each line numbered on the left.
  const high = Math.max(1, ...sv.visitors), p = 10 ** Math.floor(Math.log10(high / 4 || 1)), f = high / 4 / p;
  const step = Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p), top = Math.ceil(high / step) * step;
  ds.top = top;
  const x = (i) => (i / (ds.length - 1)) * W, y = (v) => H - (v / top) * (H - 10);
  const pts = (k) => sv[k].map((v, i) => [x(i), y(v)]);
  ds.forEach((d, i) => { d.drawn = sv.visitors[i]; }); // where the hover dot sits
  const at = new Map(ds.map((d, i) => [d.key, i]));
  const marks = notes().map((nt, k) => [nt, at.get(noteKey(nt.t)), k]).filter(([, i]) => i !== undefined);
  return `<svg class="ad-line" viewBox="-34 0 ${W + 34} ${H + 22}" role="img" aria-label="Visitors ${hourly() ? `per hour over ${ds.length} hours` : `per day over ${ds.length} days`}: ${ds.reduce((t, d) => t + d.fresh, 0)} new">
    ${Array.from({ length: top / step + 1 }, (_, k) => k * step).map((v) => `<line class="${v ? 'ad-grid' : 'ad-axis'}" x1="0" y1="${y(v)}" x2="${W}" y2="${y(v)}"></line><text class="ad-tick" x="-8" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    ${span === 7 || span === 30 ? ds.map((d, i) => { const date = new Date(d.key.slice(0, 10)); // a midnight each day in 1W, each Monday in 1M
      return i && d.key.endsWith(' 00') && x(i) < W - 60 && (span === 7 || date.getDay() === 1) ? `<line class="ad-midnight" x1="${x(i)}" y1="0" x2="${x(i)}" y2="${H}"></line><text x="${x(i) + 4}" y="${H + 16}">${date.toLocaleDateString('en-GB', span === 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' })}</text>` : ''; }).join('') : ''}
    ${marks.map(([nt, i]) => `<g class="ad-note"><line x1="${x(i)}" y1="6" x2="${x(i)}" y2="${H}"></line><circle cx="${x(i)}" cy="6" r="4"></circle></g>`).join('')}
    <path class="ad-area" d="${curve(pts('fresh'))}L${W},${H}L0,${H}Z"></path><path class="ad-curve" d="${curve(pts('visitors'))}"></path><path class="ad-curve-back" d="${curve(pts('back'))}"></path>
    <line class="ad-cross" x1="0" y1="0" x2="0" y2="${H}" visibility="hidden"></line><circle class="ad-dot" r="4" visibility="hidden"></circle>
    <text x="0" y="${H + 16}">${span === 'today' ? '00:00' : day(ds[0].key.slice(0, 10))}</text><text x="${W}" y="${H + 16}" text-anchor="end">${hourly() ? 'Now' : 'Today'}</text></svg>
    <div class="ad-tip" hidden></div>
    <p class="ad-key"><span class="ad-k-line"></span>Visitors <span class="ad-k-area"></span>New (first visit) <span class="ad-k-back"></span>Came back <span class="ad-k-note"></span>Note</p>`;
}
function bindLine(body) {
  const ds = spanPoints(body), box = $('#ad-line');
  box.innerHTML = visitorLine(ds);
  const svg = box.querySelector('svg'), cross = svg.querySelector('.ad-cross'), dot = svg.querySelector('.ad-dot'), tip = box.querySelector('.ad-tip');
  const top = ds.top;
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(ds.length - 1, Math.round((((e.clientX - r.left) / r.width) * (W + 34) - 34) / W * (ds.length - 1)))), d = ds[i];
    const cx = (i / (ds.length - 1)) * W, cy = H - (d.drawn / top) * (H - 10);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
    const here = notes().filter((nt) => noteKey(nt.t) === d.key);
    tip.hidden = false;
    tip.innerHTML = `<b>${d.label}</b><br>${d.visitors} visitor${d.visitors === 1 ? '' : 's'} · ${d.fresh} new · ${Math.max(0, d.visitors - d.fresh)} came back<br><small>${d.views} page views</small>${here.map((nt) => `<br><span class="ad-tip-note">${esc(nt.text)}</span>`).join('')}`;
    const px = ((cx + 34) / (W + 34)) * r.width; // the numbers on the left take 34 units
    tip.style.left = `${Math.min(Math.max(px, 60), r.width - 60)}px`;
  });
  svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  renderNotes(body);
}
// The notes under the graph: when and what, newest first; add one (now, or any time) or remove one.
function renderNotes(body) {
  const el = $('#ad-notes'), when = (t) => new Date(t).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const local = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 16); };
  el.innerHTML = `<form class="ad-note-form"><input name="text" required maxlength="80" placeholder="What did you do? e.g. Posted on r/lichess" aria-label="Note"><input name="at" type="datetime-local" value="${local(Date.now())}" aria-label="When"><button type="submit" class="cta">Add note</button></form>
    ${notes().length ? `<ul class="ad-note-list">${notes().slice().reverse().map((nt) => `<li><span>${when(nt.t)}</span><b>${esc(nt.text)}</b><button type="button" data-note="${nt.t}" aria-label="Remove the note ${esc(nt.text)}">×</button></li>`).join('')}</ul>` : ''}`;
  el.querySelector('form').onsubmit = (e) => { e.preventDefault(); const f = e.target, t = Date.parse(f.at.value) || Date.now();
    saveNotes([...notes(), { t, text: f.text.value.trim() }]); bindLine(body); };
  el.onclick = (e) => { const b = e.target.closest('[data-note]'); if (b) { saveNotes(notes().filter((nt) => nt.t !== Number(b.dataset.note))); bindLine(body); } };
}
const rows = (list, label = (x) => esc(x.name)) => (list.length
  ? `<ul class="pf-rows ad-rows">${list.map((x) => `<li><span>${label(x)}</span><small>${x.n}</small></li>`).join('')}</ul>`
  : '<p class="info">Nothing yet.</p>');
// A list with a bar under each name, as long as its share of the largest.
const bars = (list, label = (x) => esc(x.name), extra = () => '') => (list.length
  ? `<ul class="ad-list">${list.map((x) => `<li><span>${label(x)}</span><b>${x.n}${extra(x)}</b><i style="width:${(x.n / list[0].n) * 100}%"></i></li>`).join('')}</ul>`
  : '<p class="info">Nothing yet.</p>');
// Page views per hour (0–23) or weekday, as columns; each column's count in its tooltip.
function cols(values, labels, every = 1) {
  const W = 360, H = 120, top = Math.max(1, ...values), bw = W / values.length;
  return `<svg class="ad-bars ad-cols" viewBox="0 0 ${W} ${H + 20}" role="img" aria-label="${values.map((v, i) => `${labels[i]}: ${v}`).join(', ')}">
    ${values.map((v, i) => { const h = (v / top) * H; return `<g><title>${labels[i]}: ${v} page views</title>
      <rect x="${i * bw + 1.5}" y="${H - h}" width="${bw - 3}" height="${Math.max(h, v ? 2 : 0)}" rx="1.5"></rect>
      <rect class="hit" x="${i * bw}" y="0" width="${bw}" height="${H}"></rect></g>`; }).join('')}
    ${labels.map((l, i) => (i % every ? '' : `<text x="${i * bw + bw / 2}" y="${H + 15}" text-anchor="middle">${l}</text>`)).join('')}</svg>`;
}
const flag = (c) => (c && /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((x) => 0x1f1a5 + x.charCodeAt(0))) + ' ' : '');
const PAGE = { 'index.html': 'Openings', 'practice.html': 'My practice', 'profile.html': 'Profile', 'game.html': 'Game review', 'mistakes.html': 'Mistakes', 'admin.html': 'Admin', 'basics.html': 'Basics', 'pros.html': 'Puzzles' };
const pageName = (p) => PAGE[p] || p;

// The overview: four numbers for the last 7 days with the change against the 7 before, how far that
// week's visitors got, and how many came back, by the week they first came.
const pctOf = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);
function change(now, before, points = false) {
  if (now === null || before === null) return '<small class="ad-ch">no week before to compare</small>';
  const d = points ? Math.round((now - before) * 100) : before ? Math.round(((now - before) / before) * 100) : null;
  if (d === null) return '<small class="ad-ch">new this week</small>';
  return `<small class="ad-ch ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d)}${points ? ' points' : '%'} vs the week before</small>`;
}
function overviewHtml(s) {
  const o = s.overview;
  if (!o) return '';
  const tiles = [['Visitors, 7 days', o.now.visitors, o.before.visitors], ['Profiles looked up', o.now.profiles, o.before.profiles], ['Lines finished', o.now.finished, o.before.finished]]
    .map(([dt, a, b]) => `<div><dt>${dt}</dt><dd>${a}</dd>${change(a, b)}</div>`).join('')
    + `<div><dt>Came back within 7 days</dt><dd>${pctOf(o.now.back)}</dd>${change(o.now.back, o.before.back, true)}</div>`;
  const top = Math.max(1, s.funnel[0]?.n || 0), cell = (x) => (x === null ? '<td class="ad-ret-none">–</td>' : `<td style="--v:${x}">${pctOf(x)}</td>`);
  const sites = s.sites && s.sites.lichess + s.sites.chesscom;
  return `<dl class="pf-kpis ad-kpis ad-week">${tiles}</dl>
    <div class="pf-two">
      <section class="pf-card"><h2>How far visitors get <small>last 7 days</small></h2><ul class="ad-funnel">${s.funnel.map((f) => `<li><span>${esc(f.name)}</span><i style="width:${(f.n / top) * 100}%"></i><b>${f.n}${f === s.funnel[0] ? '' : ` <small>${pctOf(f.n / top)}</small>`}</b></li>`).join('')}</ul>
        <p class="ad-foot">Each step as a share of everyone who visited.</p></section>
      <section class="pf-card"><h2>Come back <small>by the week they first came</small></h2>
        <table class="ad-ret"><thead><tr><th>Week of</th><th>New</th><th>1 day</th><th>7 days</th><th>30 days</th></tr></thead>
        <tbody>${s.retention.map((c) => `<tr><td>${day(c.week)}</td><td class="num">${c.n}</td>${cell(c.d1)}${cell(c.d7)}${cell(c.d30)}</tr>`).join('')}</tbody></table>
        <p class="ad-foot">Seen again on a later day. – while a week is too new to tell.${sites ? ` Names looked up, 30 days: Lichess ${pctOf(s.sites.lichess / sites)} · Chess.com ${pctOf(s.sites.chesscom / sites)}.` : ''}</p></section>
    </div>`;
}

// One person: who they are on the left, and on the right what they did, visit by visit, newest first
// (a visit ends after 30 minutes without anything). A logged-in player's browsers are joined into one.
const MODE = { learn: 'Learn', try: 'Practice', time: 'Time' };
const runOf = (t) => { try { return JSON.parse(t); } catch { return null; } };
const side = (c) => `<i class="ad-side ${c === 'b' ? 'b' : 'w'}" title="As ${c === 'b' ? 'Black' : 'White'}"></i>`;
const EV_ICON = { view: 'M4 6h16M4 12h16M4 18h10', profile: 'M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM20 20l-4.5-4.5', line: 'M5 12.5l4.5 4.5L19 7.5', left: 'M6 6l12 12M18 6L6 18',
  card: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4', analyse: 'M4 19h16M5 15l4-5 4 3 6-7', compare: 'M7 4v16M17 4v16M4 8h6M14 16h6', practise: 'M5 4h11l3 3v13H5zM9 12h6M9 16h6', login: 'M10 17l5-5-5-5M15 12H3M14 4h5v16h-5', error: 'M12 8v5M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' };
const evIcon = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${EV_ICON[k] || EV_ICON.view}"/></svg>`;
// How one run of a line went: the mode, how it ended and the mistakes.
const runHow = (x) => `${MODE[x.m] || esc(x.m)} · ${x.k === 'done' ? 'finished' : x.k === 'wrong' ? `wrong on move ${Math.floor(x.n / 2) + 1}` : `left at move ${Math.ceil((x.p || 0) / 2)}`}${x.x ? ` · ${x.x} mistake${x.x === 1 ? '' : 's'}` : ''}`;
// A visitor by their Lichess name, else by where they were.
const personName = (v) => (v.name ? `<a href="profile.html?u=${encodeURIComponent(v.name)}">${esc(v.name)}</a>` : `<span class="ad-muted">${flag(v.country)}${esc(v.city || 'Visitor')}</span>`);
// Icons for the groups and the cards' titles.
const IC = { ...EV_ICON, people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18', pin: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', phone: 'M7 2h10v20H7zM11 18h2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', calendar: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4', bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  plus: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 5 2.7M19 14v6M16 17h6', target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  home: 'M3 11l9-7 9 7M5 9.5V20h14V9.5' };
const ic = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${IC[k]}"/></svg>`;
const GROUPS = [['overview', 'Overview', 'home', 'the week at a glance'], ['openings', 'Openings', 'practise', 'what is practised, and by whom'], ['people', 'People', 'people', 'who comes and what they do'],
  ['traffic', 'Traffic', 'globe', 'where they come from'], ['errors', 'Errors', 'error', 'what broke']];
const group = (id) => { const [, t, i, sub] = GROUPS.find((g) => g[0] === id); return `<h2 class="ad-group" id="ad-${id}">${ic(i)}${t}<small>${sub}</small></h2>`; };

// Who practises what: every run of a line in the visitor list, by person, and the newest runs.
function runsOf(s) {
  return s.visitors.flatMap((v) => v.events.filter((e) => e.kind === 'line').map((e) => ({ v, at: e.at, x: runOf(e.target) }))).filter((r) => r.x?.o).sort((a, b) => b.at.localeCompare(a.at));
}
function practiceHtml(s) {
  const runs = runsOf(s), people = new Map(), none = '<p class="info">Nobody yet. Runs are counted from 31 Oct 2026.</p>';
  for (const r of runs) {
    const k = r.v.name || r.v.id, p = people.get(k) ?? { v: r.v, runs: 0, done: 0, last: r.at, ops: new Map() }, o = `${r.x.s}|${r.x.o}`;
    p.runs++; if (r.x.k === 'done') p.done++; p.ops.set(o, (p.ops.get(o) || 0) + 1); people.set(k, p);
  }
  return `<section class="pf-card"><h2>${ic('people')}Who practises <small>${people.size} ${people.size === 1 ? 'person' : 'people'}</small></h2>${people.size ? `<ul class="pf-rows ad-who-list">${[...people.values()].sort((a, b) => b.runs - a.runs).map((p) => `<li><span>${personName(p.v)} <small>${p.runs} run${p.runs === 1 ? '' : 's'} · ${p.done} finished · ${short(p.last)}</small>
      <span class="ad-who-ops">${[...p.ops.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="ad-chip">${side(k[0])}${esc(k.slice(2))}${n > 1 ? ` ×${n}` : ''}</span>`).join('')}</span></span></li>`).join('')}</ul>` : none}</section>
    <section class="pf-card"><h2>${ic('line')}Latest runs <small>newest first</small></h2>${runs.length ? `<ul class="pf-rows ad-recent">${runs.slice(0, 40).map(({ v, at, x }) => `<li><span>${side(x.s)}<b>${esc(x.o)}</b> · ${esc(x.l)} <small>${runHow(x)}</small></span><small>${personName(v)} · ${short(at)}</small></li>`).join('')}</ul>` : none}</section>`;
}
// Getting better: the mistakes a run by how many times that person had tried that line before,
// then each person who ran a line more than once, from their first run to their latest.
function betterHtml(s) {
  const tries = new Map(), byNth = [];
  for (const r of runsOf(s).slice().reverse()) {
    const k = `${r.v.name || r.v.id}|${r.x.o}|${r.x.l}`, t = tries.get(k) ?? { v: r.v, x: r.x, runs: [] };
    t.runs.push(r.x.x || 0); tries.set(k, t);
    const nth = Math.min(t.runs.length, 5) - 1; (byNth[nth] ??= []).push(r.x.x || 0);
  }
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const curve = byNth.map((xs, i) => ({ name: i === 4 ? '5th try or later' : `${['1st', '2nd', '3rd', '4th'][i]} try`, n: avg(xs), runs: xs.length })).filter((c) => c.runs);
  const top = Math.max(0.1, ...curve.map((c) => c.n));
  const people = [...tries.values()].filter((t) => t.runs.length > 1).sort((a, b) => (b.runs[0] - b.runs.at(-1)) - (a.runs[0] - a.runs.at(-1)) || b.runs.length - a.runs.length);
  return `<section class="pf-card"><h2>${ic('target')}Getting better <small>mistakes a run, by try</small></h2>${curve.length ? `<div><ul class="ad-list">${curve.map((c) => `<li><span>${c.name} <small class="ad-muted">${c.runs} run${c.runs === 1 ? '' : 's'}</small></span><b>${c.n.toFixed(1)}</b><i style="width:${(c.n / top) * 100}%"></i></li>`).join('')}</ul>
    ${people.length ? `<h3 class="ad-sub">From the first run to the latest</h3><ul class="pf-rows ad-recent">${people.map((t) => { const a = t.runs[0], b = t.runs.at(-1);
      return `<li><span>${personName(t.v)} · ${side(t.x.s)}${esc(t.x.o)} <small>${esc(t.x.l)} · ${t.runs.length} runs</small></span><small class="${b < a ? 'ad-up' : b > a ? 'ad-down' : ''}">${a} → ${b} mistake${b === 1 ? '' : 's'}</small></li>`; }).join('')}</ul>` : ''}</div>`
    : '<p class="info">Nothing yet. Runs are counted from 31 Oct 2026.</p>'}</section>`;
}

// Downloaded cards: which kind, which look, and the player types on them.
function cardsHtml(s) {
  const cs = s.visitors.flatMap((v) => v.events.filter((e) => e.kind === 'card' && e.target)), count = (xs) => Object.entries(xs.reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
  const parts = cs.map((e) => { const [head, code] = e.target.split(' #'), bits = head.split(' · '); return { kind: bits.includes('style') ? 'Style card' : head.includes(' vs ') ? 'Comparison' : 'Card', look: bits.find((b) => b === 'light' || b === 'dark'), type: code && TYPE_CODES[code.split('/')[1]] }; });
  const block = (t, xs) => (xs.length ? `<h3 class="ad-sub">${t}</h3>${bars(xs)}` : '');
  return `<section class="pf-card"><h2>${ic('card')}Cards downloaded · ${cs.length} <small>by kind, look and player type</small></h2>${cs.length ? `<div>${block('Kind', count(parts.map((p) => p.kind)))}${block('Look', count(parts.map((p) => (p.look ? `${p.look[0].toUpperCase()}${p.look.slice(1)}` : 'Not known (older)'))))}${block('Player type on the card', count(parts.map((p) => p.type).filter(Boolean)))}</div>` : '<p class="info">None yet.</p>'}</section>`;
}

// Live: who was here in the last 15 minutes, and the last thing each did. Drawn when the page loads.
function liveHtml(s) {
  const now = Date.now(), ago = (iso) => Math.round((now - Date.parse(iso)) / 6e4), here = s.visitors.filter((v) => ago(v.last) < 15), hour = s.visitors.filter((v) => ago(v.last) < 60).length;
  const doing = (v) => { const e = v.events[0]; return e ? eventRow(e).replace(/^<li>|<\/li>$/g, '') : ''; };
  return `<section class="pf-card ad-live"><div class="ad-head"><h2><i class="ad-live-dot" aria-hidden="true"></i>Live now <small>${here.length} in the last 15 min · ${hour} in the last hour</small></h2><small>As of ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. Reload for newer.</small></div>
    ${here.length ? `<ul class="ad-live-list">${here.map((v) => `<li><span class="ad-live-who">${personName(v)} <small>${esc(v.device || '')} · ${ago(v.last) < 1 ? 'just now' : `${ago(v.last)} min ago`}</small></span><span class="ad-live-did">${doing(v)}</span></li>`).join('')}</ul>` : '<p class="info">Nobody right now.</p>'}</section>`;
}

function eventRow(e) {
  const t = `<time>${new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time>`;
  if (e.kind === 'line') {
    const x = runOf(e.target);
    if (!x) return '';
    const slip = x.w ? ` · played ${esc(x.g || '?')}, the line has ${esc(x.w)}` : '';
    return `<li>${t}${evIcon(x.k === 'done' ? 'line' : 'left')}<span>${side(x.s)}${esc(x.o)} · ${esc(x.l)} <small>${runHow(x)}${slip}</small></span></li>`;
  }
  if (e.kind === 'view') return `<li>${t}${evIcon('view')}<span class="ad-muted">Opened ${esc(pageName(e.page))}</span></li>`;
  return `<li>${t}${evIcon(e.kind)}<span>${esc(KIND[e.kind] || e.kind)}${e.target ? `: <b>${targetHtml(e.kind, e.target)}</b>` : ''}</span></li>`;
}
function personHtml(v, all) {
  const same = v.name ? all.filter((w) => w.name === v.name) : [v];
  const events = same.flatMap((w) => w.events).sort((a, b) => a.at.localeCompare(b.at));
  const visits = [];
  for (const e of events) { const last = visits.at(-1); if (last && Date.parse(e.at) - Date.parse(last.at(-1).at) < 30 * 6e4) last.push(e); else visits.push([e]); }
  const mins = (vs) => Math.round((Date.parse(vs.at(-1).at) - Date.parse(vs[0].at)) / 6e4);
  const total = visits.reduce((t, vs) => t + mins(vs), 0), runs = events.filter((e) => e.kind === 'line').map((e) => runOf(e.target)).filter(Boolean);
  const devices = [...new Set(same.map((w) => w.device).filter(Boolean))], dayCount = new Set(events.map((e) => e.at.slice(0, 10))).size;
  const chips = [[runs.filter((x) => x.k === 'done').length, 'line', 'finished'], [events.filter((e) => e.kind === 'profile').length, 'profile', 'looked up'], [events.filter((e) => e.kind === 'card').length, 'card', 'downloaded']]
    .filter(([n]) => n).map(([n, w, d]) => `<span class="ad-chip">${n} ${w}${n === 1 ? '' : 's'} ${d}</span>`).join('');
  return `<div class="ad-person"><div class="ad-who">${v.name ? `<b>${esc(v.name)}</b><small>Logged in with Lichess${same.length > 1 ? ` · ${same.length} browsers` : ''}</small>` : `<b>Visitor</b><small>Not logged in</small>`}
      <dl><dt>First seen</dt><dd>${when(events[0].at)}</dd><dt>Last seen</dt><dd>${when(events.at(-1).at)}</dd><dt>Visits</dt><dd>${visits.length} on ${dayCount} day${dayCount === 1 ? '' : 's'}</dd>
        <dt>Time here</dt><dd>${total < 1 ? 'under a minute' : `${total >= 60 ? `${Math.floor(total / 60)} h ` : ''}${total % 60} min`}</dd><dt>From</dt><dd>${flag(v.country)}${esc(v.city || land(v.country))}</dd>
        <dt>Device</dt><dd>${esc(devices.join(', ') || '–')}</dd><dt>Came via</dt><dd>${esc(v.source || '–')}</dd></dl>${chips ? `<p class="ad-chips">${chips}</p>` : ''}</div>
    <ol class="ad-visits">${visits.reverse().map((vs) => `<li><h3>${new Date(vs[0].at).toDateString() === new Date().toDateString() ? 'Today' : day(vs[0].at)}<small>${new Date(vs[0].at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${mins(vs) ? `–${new Date(vs.at(-1).at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${mins(vs)} min` : ''}</small></h3>
      <ul>${vs.slice().reverse().map(eventRow).join('')}</ul></li>`).join('')}</ol></div>`;
}

// Openings, the last 30 days: per opening and colour the runs, people, the share finished and the
// mistakes a run, its lines under it; then the moves where most runs slip first, as boards.
function boardHtml(fen, white) {
  const rows = fen.split(' ')[0].split('/').map((r) => [...r].flatMap((c) => (/\d/.test(c) ? Array(Number(c)).fill('') : [c])));
  const ord = (xs) => (white ? xs : [...xs].reverse());
  return `<div class="ad-board">${ord(rows).map((row, r) => ord(row).map((p, f) => `<i class="${(r + f) % 2 ? 'd' : 'l'}">${p ? `<img src="pieces/${p === p.toUpperCase() ? 'w' : 'b'}${p.toUpperCase()}.svg" alt="">` : ''}</i>`).join('')).join('')}</div>`;
}
const doneBar = (t) => `<span class="ad-done"><i style="--v:${t.runs ? t.done / t.runs : 0}"></i>${pctOf(t.runs ? t.done / t.runs : null)}</span>`;
const modes = (t) => `<small title="Lines finished in Learn, Practice and Time">L ${t.learn} · P ${t.try} · T ${t.time}</small>`;
function openingsHtml(s) {
  if (!(s.openings2 || []).length) return `<section class="pf-card"><div class="ad-head"><h2>${ic('practise')}Openings practised <small>last 30 days</small></h2></div>
    <p class="info">Nothing yet. Each line practised is counted from 31 Oct 2026; the table, each opening's lines and the hardest moves fill in as people practise.</p></section>`;
  const by = new Map();
  for (const { v, x } of runsOf(s)) { const k = `${x.s}|${x.o}`, m = by.get(k) ?? new Map(), p = v.name || v.id; m.set(p, { v, n: (m.get(p)?.n || 0) + 1 }); by.set(k, m); }
  // The logged-in players by name; the rest only as a count, so a busy opening stays one line.
  const who = (o) => { const ps = [...(by.get(`${o.side}|${o.name}`) || new Map()).values()].sort((a, b) => b.n - a.n), anon = ps.filter((p) => !p.v.name).length;
    return [...ps.filter((p) => p.v.name).map((p) => `${personName(p.v)}${p.n > 1 ? ` <small>×${p.n}</small>` : ''}`), ...(anon ? [`${anon} not logged in`] : [])].join(' · '); };
  const row = (t) => `<td class="num">${t.people}</td><td class="num">${t.runs}</td><td>${doneBar(t)}</td><td class="num">${(t.misses / Math.max(1, t.runs)).toFixed(1)}</td>`;
  return `<section class="pf-card"><div class="ad-head"><h2>${ic('practise')}Openings practised <small>last 30 days</small></h2><small>A run is one go at a line. Click an opening for its lines and who practised it.</small></div>
    <div class="ad-op-wrap"><table class="ad-op"><thead><tr><th>Opening</th><th>People</th><th>Runs</th><th>Finished</th><th>Mistakes a run</th><th>Finished in</th></tr></thead>
    ${s.openings2.map((o) => `<tbody class="ad-op-group"><tr class="ad-op-row" tabindex="0" aria-expanded="false"><td>${side(o.side)}<b>${esc(o.name)}</b> <small>${o.lines.length} line${o.lines.length === 1 ? '' : 's'}</small></td>${row(o)}<td>${modes(o)}</td></tr>
      ${o.lines.map((l) => `<tr class="ad-op-line" hidden><td>${esc(l.name)}</td>${row(l)}<td>${modes(l)}</td></tr>`).join('')}${who(o) ? `<tr class="ad-op-line ad-op-who" hidden><td colspan="6">${ic('people')}${who(o)}</td></tr>` : ''}</tbody>`).join('')}</table></div>
    ${(s.hardest || []).length ? `<h3 class="ad-sub">${ic('target')}Hardest moves <small>where most runs slip first</small></h3><div class="ad-hard">${s.hardest.map((h) => `<figure>${boardHtml(h.fen, h.side !== 'b')}
      <figcaption><b class="ad-hard-n">${pctOf(h.share)}</b> of runs slip here · the move is <b>${esc(h.want)}</b>${h.got ? `, most play ${esc(h.got)}` : ''}<small>${side(h.side)}${esc(h.opening)} · ${esc(h.line)} · ${h.n} slip${h.n === 1 ? '' : 's'}, ${h.people} ${h.people === 1 ? 'person' : 'people'}</small></figcaption></figure>`).join('')}</div>` : ''}</section>`;
}
const errorsHtml = (s) => `<section class="pf-card"><div class="ad-head"><h2>${ic('error')}Errors <small>last 30 days</small></h2><small>What broke for visitors: profiles that could not be read, and errors in the pages.</small></div>
  ${(s.errors || []).length ? `<ul class="pf-rows ad-recent">${s.errors.map((e) => `<li><span>${esc(e.text)}</span><small>${e.n}× · ${e.people} ${e.people === 1 ? 'person' : 'people'} · last ${short(e.last)}</small></li>`).join('')}</ul>` : '<p class="info">None. Errors are counted from 31 Oct 2026.</p>'}</section>`;

function render(s) {
  const link = (x) => `<a href="profile.html?u=${encodeURIComponent(x.name)}">${esc(x.name)}</a>`, t = s.totals;
  $('#admin').innerHTML = `
    <header class="pr-head"><h1 class="pf-h1">Admin</h1><p class="info">How Chess Trainer is used. A visitor is a browser, counted once in each period; a new visitor came for the first time in it. The admins' own visits and automated browsers are not counted.</p>
      <p class="ad-demo-row"><span class="seg" role="group" aria-label="Which numbers"><button type="button" data-real aria-pressed="${!s.demo}">Real</button><button type="button" data-demo aria-pressed="${!!s.demo}">Demo</button></span>
        ${s.demo ? '<b class="ad-demo-tag">Demo data</b> Made up test visitors, to see how the page looks with many.' : ''}</p>
      <nav class="ad-jump" aria-label="Parts">${GROUPS.map(([id, t, i]) => `<a href="#ad-${id}">${ic(i)}${t}</a>`).join('')}</nav></header>
    <dl class="pf-kpis ad-kpis">
      ${[['Today', t.today, t.newToday], ['7 days', t.week, t.new7], [`${s.days} days`, t.month, t.new30, `${Math.round(t.mobile * 100)}% on a phone`],
        ['All time', t.all, t.all, `${t.all ? (t.views / t.all).toFixed(1) : 0} pages a visitor`]].map(([dt, all, fresh, more]) => `<div class="ad-pair"><dt>${dt}</dt>
        <dd><span>${all}<small>visitors</small></span><span>${fresh}<small>new visitors</small></span></dd>${more ? `<small>${more}</small>` : ''}</div>`).join('')}
      <div><dt>Profiles created</dt><dd>${t.registered}</dd><small>logged in with Lichess</small></div>
    </dl>
    ${group('overview')}
    ${liveHtml(s)}
    ${overviewHtml(s)}
    <section class="pf-card"><div class="ad-head"><h2>${ic('analyse')}Visitors</h2><div class="seg" role="group" aria-label="Time span" id="ad-span">${SPANS.map(([l, n]) => `<button type="button" data-span="${n}" aria-pressed="${n === span}">${l}</button>`).join('')}</div></div>
      <div id="ad-line" class="ad-line-box"></div><div id="ad-notes" class="ad-notes"></div></section>
    ${group('openings')}
    ${openingsHtml(s)}
    <div class="ad-three">${practiceHtml(s)}${betterHtml(s)}</div>
    <div class="pf-two">${cardsHtml(s)}
      <section class="pf-card"><h2>${ic('practise')}Openings opened <small>before lines were counted one by one</small></h2>
        ${(s.openings || []).length ? `<ul class="pf-rows ad-recent">${s.openings.map((o) => `<li><span>${esc(o.name)}</span><small>opened ${o.opened} · ${o.people} ${o.people === 1 ? 'person' : 'people'} · done <b title="Learn">${o.learn}</b> L · <b title="Practice">${o.try}</b> P · <b title="Time challenge">${o.time}</b> T</small></li>`).join('')}</ul>` : rows(s.practised)}</section>
    </div>
    ${group('people')}
    <section class="pf-card"><div class="ad-head"><h2>${ic('people')}Unique visitors · ${s.visitors.length}</h2><small>Every visitor once, newest first. IP addresses without their last part. Click one to see what they did.</small></div>
      ${s.visitors.length ? `<div class="ad-visitors"><div class="ad-v-head"><span>Location</span><span>IP</span><span>Lichess</span><span>Device</span><span>Visits</span><span>Last seen</span></div>${s.visitors.map((v) => `<details class="ad-visitor"><summary>
          <span class="ad-v-where">${flag(v.country)}${esc(v.country ? land(v.country).replace(/ \(..\)$/, '') : 'Unknown')}${v.city ? ` · ${esc(v.city)}` : ''}</span>
          <span class="num">${esc((v.ip || '–').replace(/\.0$/, '.x').replace(/::$/, ':x'))}</span>
          <span>${v.name ? link({ name: v.name }) : '<small>–</small>'}</span>
          <span>${esc(v.device || '–')}</span>
          <span class="num">${v.views} view${v.views === 1 ? '' : 's'} · since ${day(v.first)}</span>
          <span class="num">${when(v.last)}</span></summary>
          ${personHtml(v, s.visitors)}</details>`).join('')}</div>
      ${s.visitors.length > 10 ? `<button type="button" class="ghost ad-more" data-more aria-expanded="false">Show all ${s.visitors.length}</button>` : ''}`
      : '<p class="info">Nobody yet.</p>'}</section>
    <div class="ad-three">
      <section class="pf-card"><h2>${ic('login')}Logged-in players · ${s.days} days</h2>${s.users.length
        ? `<ul class="pf-rows ad-rows">${s.users.map((u) => `<li><span>${link(u)}</span><small>${u.n} actions · last ${when(u.last)}</small></li>`).join('')}</ul>` : '<p class="info">Nobody yet.</p>'}</section>
      <section class="pf-card"><h2>${ic('plus')}Profiles created · ${s.registered.length}</h2>${s.registered.length ? `<p class="ad-names">${s.registered.map((n) => link({ name: n })).join(' · ')}</p>` : '<p class="info">Nobody yet.</p>'}</section>
      <section class="pf-card"><h2>${ic('profile')}Names looked up <small>found, all time</small></h2>${rows(s.profiles, link)}</section>
    </div>
    <div class="ad-three">
      <section class="pf-card"><div class="ad-head"><h2>${ic('profile')}Latest profiles looked up</h2><small>Newest first, with where the visitor was.</small></div>
      ${(s.recentProfiles || []).length ? `<ul class="pf-rows ad-recent">${s.recentProfiles.slice(0, 15).map((r) => `<li><span>${link({ name: (r.target || '').split(' #')[0] })}${r.name ? ` <small>by ${esc(r.name)}</small>` : ''}</span><small>${flag(r.country)}${esc(r.city || '')} · ${short(r.at)}</small></li>`).join('')}</ul>` : '<p class="info">None yet.</p>'}</section>
      <section class="pf-card"><div class="ad-head"><h2>${ic('card')}Latest cards downloaded and analyses</h2><small>Newest first.</small></div>
      ${(s.recentActions || []).length ? `<ul class="pf-rows ad-recent">${actionRows(s.recentActions).slice(0, 15).join('')}</ul>` : '<p class="info">None yet.</p>'}</section>
      <section class="pf-card"><h2>${ic('compare')}Comparisons</h2>${rows(s.compares, (x) => targetHtml('compare', x.name))}</section>
    </div>
    ${group('traffic')}
    <div class="ad-four">
      <section class="pf-card"><h2>${ic('globe')}Countries <small>unique visitors</small></h2>${bars(s.countries || [], (x) => flag(x.name) + esc(land(x.name)))}</section>
      <section class="pf-card"><h2>${ic('pin')}Cities <small>unique visitors</small></h2>${bars(s.cities || [], (x) => flag(x.name.split(', ')[1]) + esc(x.name))}</section>
      <section class="pf-card"><h2>${ic('link')}Where visitors come from</h2>${bars(s.sources || [])}</section>
      <section class="pf-card"><h2>${ic('phone')}Devices <small>unique visitors</small></h2>${bars(s.devices || [])}</section>
    </div>
    <div class="ad-four">
      <section class="pf-card"><h2>${ic('view')}Most visited pages</h2>${bars(s.pages, (x) => esc(pageName(x.name)), (x) => ` <small>${x.unique} unique</small>`)}</section>
      <section class="pf-card"><h2>${ic('bolt')}What people do</h2>${rows(s.usage, (x) => KIND[x.name] || esc(x.name))}</section>
      <section class="pf-card"><h2>${ic('clock')}Time of day <small>Swedish time</small></h2>${cols(s.hours, s.hours.map((_, i) => String(i).padStart(2, '0')), 3)}</section>
      <section class="pf-card"><h2>${ic('calendar')}Weekday</h2>${cols(s.weekdays, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])}</section>
    </div>
    ${group('errors')}
    ${errorsHtml(s)}
`;
}

// Draw the numbers (real or demo) and wire the graph's spans and the demo switch.
// Hovering any player name shows their card beside the mouse; a click opens the profile. The card is the
// newest one a download event carried, else the leaderboard's; a name with neither shows nothing.
function cardsOf(body) {
  const out = new Map(BOARD.map((r) => [r.name.toLowerCase(), cardOf(r.name, BOARD)]));
  const events = [...(body.visitors || []).flatMap((v) => v.events), ...(body.recentActions || []), ...(body.recentProfiles || []).map((r) => ({ ...r, kind: 'profile' }))]
    .filter((e) => (e.kind === 'card' || e.kind === 'profile') && e.target?.includes(' #'));
  events.sort((a, b) => a.at.localeCompare(b.at)).forEach((e) => { const c = cardOf(e.target, []); if (c) out.set(c.name.toLowerCase(), c); });
  return out;
}
let tip;
const SHOTS = new Map();
function shot(key, c, look, style) {
  if (!SHOTS.has(key)) {
    const mix = (x) => { if (!x) return null; const [label, share] = x.split(':'); return { n: 99, parts: [{ k: label, label, share: Number(share) }] }; };
    const p = { n: c.n, piece: c.piece, speeds: c.rating ? [{ rating: c.rating, speed: c.speed }] : [], styleMix: { w: mix(c.w), b: mix(c.b) } };
    const t = [{ name: c.style }, ...(c.strength ? [{ name: c.strength }] : [])];
    const skills = ['Attack', 'Defense', 'Early game', 'Late game', 'Accuracy', 'Speed'].map((label, i) => ({ label, v: c.skills[i] }));
    SHOTS.set(key, cardImage(look, c.name, p, t, skills, style, c.lead).then((cv) => cv.toDataURL('image/png')));
  }
  return SHOTS.get(key);
}
function bindCards(body) {
  const cards = cardsOf(body), box = $('#admin');
  loadFlags([...cards.keys()]); // the stickers on the cards shown on hover
  tip ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'ad-card-tip', hidden: true }));
  const place = (e) => { const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.min(e.clientX + 16, innerWidth - w - 8)}px`; tip.style.top = `${Math.min(e.clientY + 16, innerHeight - h - 8)}px`; };
  box.onmouseover = (e) => {
    const a = e.target.closest?.('a[href*="profile.html?u="]');
    // A download row shows that download as it was: dark or light, with the style beside it or not.
    const own = a?.dataset.card, c = a && ((own && cardOf(own, BOARD)) || cards.get(new URL(a.href).searchParams.get('u').toLowerCase()));
    if (!c) { tip.hidden = true; return; }
    const look = own && / · light\b/.test(own) ? 'light' : 'dark', style = !!own && / · (style|card \+ style)\b/.test(own);
    tip.innerHTML = cardHtml(c, look, style); tip.hidden = false; place(e);
    // A download that carries its image data is shown as the very image, drawn as the profile page drew it.
    if (own && c.n) shot(own, c, look, style).then((src) => { if (!tip.hidden && tip.dataset.own === own) { tip.innerHTML = `<img class="ad-shot${style ? ' style' : ''}" src="${src}" alt="">`; place(e); } });
    tip.dataset.own = own || '';
  };
  box.onmousemove = (e) => { if (!tip.hidden) place(e); };
  box.onmouseout = (e) => { if (e.target.closest?.('a[href*="profile.html?u="]')) tip.hidden = true; };
}
function show(body) {
  render(body);
  bindCards(body);
  bindLine(body);
  $('#ad-span').addEventListener('click', (e) => { const b = e.target.closest('[data-span]'); if (!b) return; span = b.dataset.span === 'today' ? 'today' : Number(b.dataset.span);
    $('#ad-span').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); bindLine(body); });
  // The visitor list shows the newest 10 until opened.
  $('[data-more]')?.addEventListener('click', (e) => { const b = e.currentTarget, open = $('.ad-visitors').classList.toggle('open');
    b.setAttribute('aria-expanded', open); b.textContent = open ? 'Show the newest 10' : `Show all ${body.visitors.length}`; });
  // An opening's lines open under it, by click or Enter.
  for (const r of document.querySelectorAll('.ad-op-row')) r.onclick = r.onkeydown = (e) => {
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const open = r.getAttribute('aria-expanded') !== 'true';
    r.setAttribute('aria-expanded', open);
    r.parentElement.querySelectorAll('.ad-op-line').forEach((x) => { x.hidden = !open; });
  };
  $('[data-demo]').addEventListener('click', () => { if (!body.demo) { real = body; show(demoData()); } });
  $('[data-real]').addEventListener('click', () => { if (body.demo) show(real); });
}
let real = null;
// Made-up numbers in the real shape: a year of growth, a few hundred visitors from many places with
// what they did, and logged-in players. Nothing is stored; it is drawn only on this page.
const DEMO_LINES = [['w', 'Italian Game', 'Giuoco Pianissimo'], ['w', 'Italian Game', 'Evans Gambit'], ['b', 'Caro-Kann Defense', 'Advance Variation'], ['b', 'Sicilian Defense', 'Najdorf'], ['w', 'London System', 'Main line']];
const DEMO_HARD = [
  { side: 'b', opening: 'Caro-Kann Defense', line: 'Advance Variation', fen: 'rnbqkbnr/pp2pppp/2p5/3pP3/3P4/8/PPP2PPP/RNBQKBNR b KQkq - 0 3', want: 'c5', got: 'Bf5', n: 21, people: 14, share: 0.58 },
  { side: 'w', opening: 'Italian Game', line: 'Evans Gambit', fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', want: 'b4', got: 'c3', n: 12, people: 9, share: 0.41 },
  { side: 'b', opening: 'Sicilian Defense', line: 'Najdorf', fen: 'rnbqkb1r/pp2pppp/3p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R b KQkq - 2 5', want: 'a6', got: 'Nc6', n: 11, people: 8, share: 0.37 },
  { side: 'w', opening: 'London System', line: 'Main line', fen: 'rnbqkb1r/ppp1pppp/5n2/3p4/3P1B2/5N2/PPP1PPPP/RN1QKB1R w KQkq - 2 3', want: 'e3', got: 'c4', n: 6, people: 6, share: 0.22 },
];
function demoData() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const DAYS = 365, now = Date.now(), iso = (t) => new Date(t).toISOString();
  const day = (t) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(t));
  const PLACES = [['SE', 'Stockholm'], ['SE', 'Gothenburg'], ['SE', 'Malmö'], ['SE', 'Uppsala'], ['NO', 'Oslo'], ['DK', 'Copenhagen'], ['FI', 'Helsinki'], ['DE', 'Berlin'], ['GB', 'London'], ['US', 'New York'], ['NL', 'Amsterdam'], ['IN', 'Mumbai'], ['FR', 'Paris'], ['ES', 'Madrid']];
  const DEVICES = ['iPhone · Safari', 'Android · Chrome', 'Mac · Chrome', 'Windows · Chrome', 'Mac · Safari', 'Windows · Edge', 'iPad · Safari', 'Linux · Firefox'];
  const PAGES = ['index.html', 'profile.html', 'leaderboard.html', 'practice.html', 'mistakes.html', 'game.html'];
  const OPS = ['White: Italian Game', 'White: London System', 'White: Danish Gambit', "White: Queen's Gambit", 'Black: Sicilian Defense', 'Black: Caro-Kann Defense', 'Black: vs Italian Game', 'White: Scotch Game'];
  const NAMES = ['knightrider', 'pawnstorm77', 'gambit_greta', 'eriksson_chess', 'blitzbjorn', 'castlequeen', 'fianchetto_fred', 'tactix', 'endgame_eva', 'sicilian_sam', 'rookie2000', 'mateinthree', 'zugzwang_zoe', 'bishoppair', 'olof_plays'];
  const SOURCES = ['Direct', 'Direct', 'Direct', 'google.com', 'lichess.org', 'reddit.com', 'discord.com', 'facebook.com'];
  const perDay = [], visitors = [];
  for (let d = DAYS - 1; d >= 0; d--) {
    const t = now - d * 864e5, growth = 2 + (DAYS - d) * 0.12, weekend = [0, 6].includes(new Date(t).getDay()) ? 1.4 : 1;
    const fresh = Math.max(0, Math.round(growth * weekend * (0.6 + rnd() * 0.8)));
    perDay.push({ day: day(t), fresh, visitors: Math.round(fresh * (1.6 + rnd())), views: Math.round(fresh * (5 + rnd() * 4)) });
    for (let i = 0; i < fresh && visitors.length < 300 && d < 60; i++) {
      const [country, city] = pick(PLACES), first = t + rnd() * 864e5 * 0.9, name = rnd() < 0.25 ? pick(NAMES) : null;
      const events = Array.from({ length: 2 + Math.floor(rnd() * 8) }, (_, k) => {
        const kind = k === 0 ? 'view' : pick(['view', 'view', 'view', 'practise', 'line', 'line', 'profile', 'analyse', 'compare', 'card']);
        const [sd, o, l] = pick(DEMO_LINES), x = rnd() < 0.6 ? 0 : 1 + Math.floor(rnd() * 3);
        const run = { k: rnd() < 0.7 ? 'done' : 'left', m: pick(['learn', 'try', 'try', 'time']), s: sd, o, l, x, p: 8 + Math.floor(rnd() * 10), ...(x ? { f: DEMO_HARD[0].fen, w: 'c5', g: 'Bf5', n: 5 } : {}) };
        return { at: iso(first + k * 90e3), kind, page: kind === 'view' ? pick(PAGES) : 'index.html', target: kind === 'practise' ? pick(OPS) : kind === 'line' ? JSON.stringify(run) : kind === 'profile' ? pick(NAMES) : kind === 'compare' ? `${pick(NAMES)} vs ${pick(NAMES)}` : kind === 'card' ? `${pick(NAMES)} · ${pick(['card', 'card', 'style'])} · ${pick(['dark', 'dark', 'light'])} #72/${Math.floor(rnd() * 21)}/3/60.55.70.45.65.50/1650bl/K` : null };
      }).reverse();
      visitors.push({ id: `demo-${visitors.length}`, ip: `${Math.floor(rnd() * 200) + 20}.${Math.floor(rnd() * 255)}.${Math.floor(rnd() * 255)}.0`, country, city, device: pick(DEVICES), source: pick(SOURCES), name,
        views: events.filter((e) => e.kind === 'view').length, first: iso(first), last: events[0].at, events });
    }
  }
  visitors.sort((a, b) => b.last.localeCompare(a.last));
  visitors.slice(0, 4).forEach((v, i) => { v.last = v.events[0].at = iso(now - i * 4 * 6e4); }); // a few here right now
  const count = (xs) => Object.entries(xs.reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, n]) => ({ name, n }));
  const sum = (n, k) => perDay.slice(-n).reduce((t, d) => t + d[k], 0), events = visitors.flatMap((v) => v.events);
  const registered = [...new Set(visitors.map((v) => v.name).filter(Boolean))];
  const perHour = Array.from({ length: 720 }, (_, k) => { const t = now - k * 36e5, f = Math.round(4 * Math.max(0, Math.sin(((Number(hourKey(t).slice(-2)) - 7) / 16) * Math.PI)) * (0.5 + rnd()));
    return { hour: hourKey(t), fresh: f, visitors: Math.round(f * (1.5 + rnd())), views: Math.round(f * (5 + rnd() * 3)) }; });
  const hours = Array.from({ length: 24 }, (_, h) => Math.round(40 + 120 * Math.max(0, Math.sin(((h - 7) / 16) * Math.PI)) * (0.8 + rnd() * 0.4)));
  const line = (name, runs, done, misses, people) => ({ name, runs, done, misses, people, learn: Math.round(done * 0.4), try: Math.round(done * 0.45), time: done - Math.round(done * 0.4) - Math.round(done * 0.45) });
  const op = (side, name, ls) => ({ side, ...['runs', 'done', 'misses', 'people', 'learn', 'try', 'time'].reduce((m, k) => ({ ...m, [k]: ls.reduce((t, l) => t + l[k], 0) }), {}), name, lines: ls });
  return {
    demo: true, days: 30,
    overview: { now: { visitors: 412, profiles: 1038, finished: 286, back: 0.31 }, before: { visitors: 349, profiles: 952, finished: 298, back: 0.28 } },
    funnel: [{ name: 'Visited', n: 412 }, { name: 'Looked up a profile', n: 292 }, { name: 'Opened an opening', n: 118 }, { name: 'Finished a line', n: 86 }, { name: 'Came back another day', n: 131 }],
    retention: [{ week: '2026-10-26', n: 203, d1: null, d7: null, d30: null }, { week: '2026-10-19', n: 164, d1: 0.35, d7: 0.24, d30: null }, { week: '2026-10-12', n: 98, d1: 0.29, d7: 0.18, d30: null }, { week: '2026-10-05', n: 61, d1: 0.31, d7: 0.2, d30: 0.12 }],
    sites: { lichess: 744, chesscom: 294 },
    openings2: [op('w', 'Italian Game', [line('Giuoco Pianissimo', 97, 81, 48, 41), line('Evans Gambit', 71, 49, 92, 29), line('Two Knights: Fried Liver', 44, 35, 31, 18)]),
      op('b', 'Caro-Kann Defense', [line('Advance Variation', 88, 50, 160, 33), line('Classical', 79, 52, 110, 30)]),
      op('b', 'Sicilian Defense', [line('Najdorf', 83, 40, 190, 28), line('Dragon', 68, 39, 130, 24)]),
      op('w', 'London System', [line('Main line', 120, 106, 48, 39)])],
    hardest: DEMO_HARD,
    errors: [{ text: 'cc:somebody: Chess.com has no player called somebody.', n: 9, last: iso(now - 3e6), people: 7 }, { text: 'Could not reach Lichess: the connection dropped.', n: 4, last: iso(now - 9e6), people: 3 }],
    totals: { today: perDay.at(-1).visitors, newToday: perDay.at(-1).fresh, week: Math.round(sum(7, 'visitors') * 0.6), new7: sum(7, 'fresh'), month: Math.round(sum(30, 'visitors') * 0.5), new30: sum(30, 'fresh'),
      all: sum(DAYS, 'fresh'), views: sum(DAYS, 'views'), mobile: visitors.filter((v) => /iPhone|Android/.test(v.device)).length / visitors.length, loggedIn: registered.length, registered: registered.length * 6 },
    perDay, perHour,
    pages: count(events.filter((e) => e.kind === 'view').map((e) => e.page)).map((x) => ({ ...x, n: x.n * 9, unique: x.n * 3 })),
    sources: count(visitors.map((v) => v.source)), countries: count(visitors.map((v) => v.country)), cities: count(visitors.map((v) => `${v.city}, ${v.country}`)), devices: count(visitors.map((v) => v.device)),
    hours, weekdays: [520, 480, 470, 500, 560, 760, 720],
    profiles: count(events.filter((e) => e.kind === 'profile').map((e) => e.target)),
    recentProfiles: events.filter((e) => e.kind === 'profile').slice(0, 40).map((e) => ({ at: e.at, target: e.target, country: 'SE', city: 'Malmö', device: 'iPhone · Safari' })), compares: count(events.filter((e) => e.kind === 'compare').map((e) => e.target)),
    usage: count(events.filter((e) => !['view', 'profile'].includes(e.kind)).map((e) => e.kind)), practised: count(events.filter((e) => e.kind === 'practise').map((e) => e.target)),
    visitors, registered: registered.sort(), users: registered.map((name) => ({ name, n: 5 + Math.floor(rnd() * 40), last: iso(now - rnd() * 6 * 864e5) })),
  };
}
async function start() {
  if (new URLSearchParams(location.search).has('demo')) return show(demoData()); // made-up numbers only: for trying the page without the login
  const a = account();
  if (!a) {
    $('#admin').innerHTML = `<section class="picker"><h1 class="pf-h1">Admin</h1><p class="info">Log in with Lichess to see the site's numbers.</p>
      <p><button id="ad-login" class="cta" type="button">Log in with Lichess</button></p></section>`;
    return $('#ad-login').addEventListener('click', login);
  }
  $('#profile-msg').textContent = 'Loading the numbers…';
  try {
    BOARD = await fetch('https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/leaderboard').then((r) => (r.ok ? r.json() : [])).catch(() => []);
    const res = await fetch(FN, { headers: { 'x-lichess-token': a.token } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `The stats service answered ${res.status}.`);
    $('#profile-msg').textContent = '';
    try { localStorage.setItem('chess-trainer-no-track', '1'); } catch {} // this browser is the admin's: its visits stay out of the numbers
    show(body);
  } catch (err) {
    $('#profile-msg').innerHTML = `${esc(err.message)} <button type="button" class="link" data-retry>Try again</button>`;
    $('[data-retry]').addEventListener('click', start);
  }
}
finishLogin().catch((err) => { $('#profile-msg').textContent = err.message; }).finally(start); // back from logging in on this page
