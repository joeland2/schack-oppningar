// The site moved from joeland2.github.io/schack-oppningar to chesslabs.gg, and www.chesslabs.gg goes there too. A browser keeps saved progress
// per address, so the old address hands it over once: it sends this browser's saved keys along in the
// link's #fragment (never sent to any server) to the same page on the new address, which saves the ones
// it does not have yet and drops the fragment. Loaded first on every page, before anything reads storage.
// Array/String .at() for older Safari (before 15.4), which the site's code uses throughout.
for (const C of [Array, String]) if (!C.prototype.at) Object.defineProperty(C.prototype, 'at', { configurable: true, writable: true, value(i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return i < 0 || i >= this.length ? undefined : this[i]; } });
(() => {
  const NEW = 'https://chesslabs.gg', OLD = 'joeland2.github.io', TAG = '#moved=';
  const skip = (k) => k === 'chess-trainer-sync' || /-(sf|games|profiles)$/.test(k); // caches, fetched again
  if (location.hostname === OLD || location.hostname === 'www.chesslabs.gg') {
    let data = {};
    try { for (const k of Object.keys(localStorage)) if (!skip(k)) data[k] = localStorage.getItem(k); } catch {}
    const path = location.pathname.replace(/^\/schack-oppningar/, '') || '/';
    const hand = Object.keys(data).length ? TAG + encodeURIComponent(JSON.stringify(data)) : location.hash;
    location.replace(NEW + path + location.search + hand);
    document.documentElement.hidden = true; // nothing of the old page while it goes
    return;
  }
  if (!location.hash.startsWith(TAG)) return;
  try {
    const data = JSON.parse(decodeURIComponent(location.hash.slice(TAG.length)));
    for (const [k, v] of Object.entries(data)) if (typeof v === 'string' && !skip(k) && localStorage.getItem(k) === null) localStorage.setItem(k, v);
  } catch {}
  history.replaceState(null, '', location.pathname + location.search);
})();
