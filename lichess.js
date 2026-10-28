// Log in with Lichess (OAuth with PKCE: no server and no secret, Lichess needs no app registration).
// The token asks for no permissions; it only lets the page use Lichess's opening explorer, which needs
// a logged-in player, so play-outs can follow real games from the whole Lichess database.
const KEY = 'chess-trainer-lichess-login';      // { token, name }; not in saved progress files
const PENDING = 'chess-trainer-lichess-pkce';   // { verifier, state } while Lichess asks you
const CLIENT = 'chess-trainer-openings';
const back = () => location.origin + location.pathname;
const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function account() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

export async function login() {
  const verifier = b64(crypto.getRandomValues(new Uint8Array(32)));
  const state = b64(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state }));
  location.href = 'https://lichess.org/oauth?' + new URLSearchParams({
    response_type: 'code', client_id: CLIENT, redirect_uri: back(), code_challenge_method: 'S256', code_challenge: challenge, state,
  });
}

// Back from Lichess: trade the code for a token. Resolves your Lichess account (name and ratings), or
// null when this page load is not a return from Lichess.
export async function finishLogin() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  history.replaceState(null, '', back() + location.hash); // the code is single-use; keep it out of the address bar
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING)); } catch {}
  sessionStorage.removeItem(PENDING);
  if (!q.get('code') || !pending || q.get('state') !== pending.state) throw new Error('The Lichess login was cancelled. Try again.');
  const res = await fetch('https://lichess.org/api/token', { method: 'POST', body: new URLSearchParams({
    grant_type: 'authorization_code', code: q.get('code'), code_verifier: pending.verifier, redirect_uri: back(), client_id: CLIENT,
  }) });
  if (!res.ok) throw new Error(`Lichess did not accept the login (${res.status}). Try again.`);
  const { access_token: token } = await res.json();
  const me = await fetch('https://lichess.org/api/account', { headers: { Authorization: `Bearer ${token}` } });
  if (!me.ok) throw new Error(`Lichess did not accept the login (${me.status}). Try again.`);
  const user = await me.json();
  try { localStorage.setItem(KEY, JSON.stringify({ token, name: user.username })); } catch {}
  return user;
}

export function logout() {
  const a = account();
  try { localStorage.removeItem(KEY); } catch {}
  if (a) fetch('https://lichess.org/api/token', { method: 'DELETE', headers: { Authorization: `Bearer ${a.token}` } }).catch(() => {});
}

// Real games from all of Lichess for one position: { white, draws, black, moves: [{ san, white, draws,
// black }] }, most played first. Null when you are not logged in or Lichess does not answer in time.
const LIVE = new Map();
export function liveGames(fen, ratings, speed) {
  const a = account();
  if (!a) return Promise.resolve(null);
  const url = 'https://explorer.lichess.org/lichess?' + new URLSearchParams({
    variant: 'standard', fen, speeds: speed, ratings: ratings.join(','), topGames: 0, recentGames: 0,
  });
  if (!LIVE.has(url)) {
    LIVE.set(url, fetch(url, { headers: { Authorization: `Bearer ${a.token}` }, signal: AbortSignal.timeout(5000) })
      .then((r) => {
        if (r.status === 401) logout(); // the token was revoked on Lichess
        if (!r.ok) { LIVE.delete(url); return null; }
        return r.json();
      })
      .catch(() => { LIVE.delete(url); return null; }));
  }
  return LIVE.get(url);
}
