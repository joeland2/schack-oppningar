// The Log in dialog: Lichess (lichess.js), or a Chess Labs account with a Chess.com name linked, for
// players without Lichess. Chess.com lets no other site log its players in, which the dialog says.
import { login, siteLogin } from './lichess.js?v=20261104151257';

let dlg = null;
export function openLogin() {
  dlg?.remove();
  dlg = document.createElement('dialog');
  dlg.className = 'chat sup-dlg login-dlg';
  dlg.innerHTML = `<header class="chat-head"><h2>Log in to Chess Labs</h2><button type="button" class="chat-x" aria-label="Close">×</button></header>
  <div class="sup-body">
    <button type="button" class="cta login-li">Log in with Lichess</button>
    <p class="login-or"><span>No Lichess account?</span></p>
    <div class="pf-seg login-tabs" role="group" aria-label="Chess Labs account"><button type="button" data-tab="signup" aria-pressed="true">Make an account</button><button type="button" data-tab="login" aria-pressed="false">I have one</button></div>
    <form class="login-form" novalidate>
      <label>Email<input name="email" type="email" autocomplete="email" required maxlength="200"></label>
      <label>Password<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="200"><small>At least 8 characters.</small></label>
      <label class="login-cc">Your Chess.com username<input name="chesscom" autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="25"><small>Your profile, games and the leaderboard read from this account.</small></label>
      <p class="chat-err" role="alert" hidden></p>
      <button type="submit" class="cta">Make my account</button>
    </form>
    <details class="login-why" open><summary>Why not log in with Chess.com?</summary>
      <p>Chess.com doesn't let other sites log its players in, so there is no "Log in with Chess.com" button anywhere outside Chess.com. Lichess does, which is why it's the quick way in.</p>
      <p>So without Lichess, make a Chess Labs account here and link your Chess.com name to it. Or make a free Lichess account, log in with it, and link your Chess.com account on your profile: both work the same.</p>
    </details>
  </div>`;
  document.body.append(dlg);
  dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); dlg = null; };
  dlg.querySelector('.chat-x').addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.querySelector('.login-li').addEventListener('click', () => login());
  const form = dlg.querySelector('form'), err = form.querySelector('.chat-err');
  let tab = 'signup';
  dlg.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    dlg.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    form.querySelector('.login-cc').hidden = tab === 'login';
    form.chesscom.required = tab === 'signup';
    form.password.autocomplete = tab === 'signup' ? 'new-password' : 'current-password';
    form.querySelector('[type=submit]').textContent = tab === 'signup' ? 'Make my account' : 'Log in';
    err.hidden = true;
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const go = form.querySelector('[type=submit]');
    go.disabled = true; err.hidden = true;
    try {
      const { name } = await siteLogin(tab, { email: form.email.value, password: form.password.value, chesscom: form.chesscom.value });
      location.href = `profile.html?u=${encodeURIComponent(name)}`;
    } catch (x) {
      err.textContent = x.message;
      err.hidden = false; go.disabled = false;
    }
  });
}
