// Opening names (lichess-org/chess-openings, as on the Openings page): the longest named line the game follows.
let BOOK = null; // { names: line → name, next: position (moves so far) → book moves from there }
export const key = (sans) => sans.join(' ').replace(/[+#]/g, '');
export const loadBook = () => (BOOK ??= Promise.all([...'abcde'].map((f) => fetch(`data/${f}.tsv`).then((r) => r.text()))).then((ts) => {
  const names = new Map(), next = new Map();
  for (const row of ts.flatMap((t) => t.trim().split('\n').slice(1))) {
    const [, name, pgn] = row.split('\t'), ms = pgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/);
    names.set(key(ms), name);
    ms.forEach((m, i) => { const k = key(ms.slice(0, i)); if (!next.has(k)) next.set(k, new Set()); next.get(k).add(m.replace(/[+#]/g, '')); });
  }
  return { names, next };
}));
// The opening as [family, variation], from the longest named line the game follows.
export async function openingOf(sans) {
  const { names } = await loadBook();
  for (let n = sans.length; n > 0; n--) { const hit = names.get(key(sans.slice(0, n))); if (hit) { const [f, v = ''] = hit.split(': '); return [f, v]; } }
  return ['Starting position', ''];
}
// Where the game left known theory: the first move no named line has, with what the book plays there.
export async function leftBook(sans) {
  const { next } = await loadBook();
  for (let i = 0; i < Math.min(sans.length, 30); i++) {
    const book = next.get(key(sans.slice(0, i)));
    if (!book) return null;
    if (!book.has(sans[i].replace(/[+#]/g, ''))) return { ply: i, san: sans[i], book: [...book].slice(0, 3) };
  }
  return null;
}
