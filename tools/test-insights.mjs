// Runs admin-stats' insights() (supabase/functions/admin-stats/index.ts, between its insights markers)
// on made-up events and checks the numbers. node tools/test-insights.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const src = readFileSync(new URL('../supabase/functions/admin-stats/index.ts', import.meta.url), 'utf8');
const part = src.slice(src.indexOf('// insights:start'), src.indexOf('// insights:end'));
const file = join(mkdtempSync(join(tmpdir(), 'insights-')), 'insights.ts');
writeFileSync(file, `${part}\nexport { insights };\n`);
const { insights } = await import(file);

const now = Date.parse('2026-10-31T12:00:00Z'), at = (days) => new Date(now - days * 864e5).toISOString();
const run = (o) => JSON.stringify({ k: 'done', m: 'try', s: 'w', o: 'Italian Game', l: 'Evans Gambit', x: 0, p: 9, ...o });
const rows = [
  { at: at(20), kind: 'view', target: null, visitor: 'a' }, { at: at(18), kind: 'view', target: null, visitor: 'a' }, // new 20 days ago, back 2 days later
  { at: at(12), kind: 'view', target: null, visitor: 'b' }, // new 12 days ago, never back
  { at: at(10), kind: 'view', target: null, visitor: 'c' }, { at: at(2), kind: 'view', target: null, visitor: 'c' }, // new 10 days ago, back 8 days later
  { at: at(1), kind: 'view', target: null, visitor: 'd' }, { at: at(1), kind: 'profile', target: 'cc:hikaru', visitor: 'd' },
  { at: at(1), kind: 'line', target: run({ k: 'left', x: 1, f: 'fen1', w: 'b4', g: 'c3' }), visitor: 'd' },
  { at: at(0.5), kind: 'line', target: run({}), visitor: 'd' },
  { at: at(0.4), kind: 'line', target: run({ x: 2, f: 'fen1', w: 'b4', g: 'c3' }), visitor: 'c' },
  { at: at(0.3), kind: 'line', target: 'not json', visitor: 'c' },
  { at: at(0.2), kind: 'error', target: 'x: boom', visitor: 'c' }, { at: at(0.1), kind: 'error', target: 'x: boom', visitor: 'd' },
];
const r = insights(rows, now);
assert.equal(r.overview.now.visitors, 2);
assert.equal(r.overview.now.profiles, 1);
assert.equal(r.overview.now.finished, 2);
assert.equal(r.overview.now.back, 0, 'b and c were new 7–14 days ago; c came back after 8 days, outside 7');
assert.deepEqual(r.funnel.map((x) => x.n), [2, 1, 2, 2, 2]); // d was here yesterday and today
const op = r.openings2[0];
assert.equal(op.runs, 3); assert.equal(op.done, 2); assert.equal(op.misses, 3); assert.equal(op.people, 2); assert.equal(op.try, 2);
assert.equal(op.lines[0].name, 'Evans Gambit');
assert.equal(r.hardest[0].n, 2); assert.equal(r.hardest[0].got, 'c3'); assert.equal(r.hardest[0].share, 2 / 3);
assert.deepEqual(r.errors[0], { text: 'x: boom', n: 2, last: at(0.1), people: 2 });
assert.deepEqual(r.sites, { chesscom: 1, lichess: 0 });
assert.ok(r.retention.length >= 3 && r.retention.every((c) => c.n >= 1));
console.log('insights: ok');
