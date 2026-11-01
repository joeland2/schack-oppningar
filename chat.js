// Message the admins: a logged-in player's thread with the admins, in a dialog any page can open
// (header.js puts the button at the bottom of every page). The messages Edge Function checks the
// Lichess login; an admin opens any player's thread from the admin page with openChat(player).
const API = 'https://duhlvhjtxoofgnjegspa.supabase.co/functions/v1/messages';
const KEY = 'sb_publishable_6jWrlp6aNe4REB4v-uebxA_giKYde2o';
const login = () => { try { return JSON.parse(localStorage.getItem('chess-trainer-lichess-login')) || null; } catch { return null; } };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export async function api(query = '', body) {
  const r = await fetch(API + query, { method: body ? 'POST' : 'GET', headers: { apikey: KEY, 'x-lichess-token': login()?.token || '', 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const x = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(x.error || 'Could not reach the messages. Try again in a minute.');
  return x;
}

let dlg = null, timer = 0;
// player: whose thread (an admin answering); none: your own.
export function openChat(player = null) {
  dlg?.remove(); clearInterval(timer);
  const me = login(), them = player || me?.name?.toLowerCase();
  dlg = document.createElement('dialog');
  dlg.className = 'chat';
  dlg.innerHTML = `<header class="chat-head"><h2>${player ? `Thread with ${esc(player)}` : 'Message the admins'}</h2><button type="button" class="chat-x" aria-label="Close">×</button></header>
    ${me ? `<ol class="chat-list" aria-live="polite"><li class="chat-note">Loading…</li></ol>
      <form class="chat-form"><textarea name="body" rows="3" maxlength="2000" required placeholder="${player ? 'Your answer' : 'A question, an idea, something that broke…'}"></textarea><button class="cta" type="submit">Send</button></form>
      <p class="chat-err" role="alert" hidden></p>`
    : '<p class="chat-note">Log in with Lichess to write to the admins. Your messages and their answers are kept here, with your Lichess name.</p><p><a class="cta" href="profile.html?login">Log in with Lichess</a></p>'}`;
  document.body.append(dlg);
  dlg.showModal();
  const close = () => { clearInterval(timer); dlg.close(); dlg.remove(); dlg = null; };
  dlg.querySelector('.chat-x').addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  if (!me) return;
  const list = dlg.querySelector('.chat-list'), form = dlg.querySelector('.chat-form'), err = dlg.querySelector('.chat-err'), q = player ? `?player=${encodeURIComponent(player)}` : '';
  const show = (msgs) => {
    // Yours on the right: the player's own messages in their view, the admins' in an admin's.
    const mine = (m) => (player ? m.author !== them : m.author === them);
    list.innerHTML = msgs.length ? msgs.map((m) => `<li class="chat-msg${mine(m) ? ' mine' : ''}"><p>${esc(m.body).replace(/\n/g, '<br>')}</p><small>${m.author === them ? esc(m.author) : player ? esc(m.author) : 'Admin'} · ${when(m.at)}</small></li>`).join('')
      : `<li class="chat-note">${player ? 'No messages yet.' : 'Write anything: a question, an idea, or something that broke. The admins answer here, so look back in a while.'}</li>`;
    list.scrollTop = list.scrollHeight;
  };
  const load = () => api(q).then(show, (e) => { err.textContent = e.message; err.hidden = false; });
  load(); timer = setInterval(load, 20000);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = form.body.value.trim();
    if (!body) return;
    form.querySelector('button').disabled = true; err.hidden = true;
    try { show(await api('', { body, ...(player ? { to: player } : {}) })); form.body.value = ''; }
    catch (x) { err.textContent = x.message; err.hidden = false; }
    form.querySelector('button').disabled = false;
  });
  form.body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
  form.body.focus();
}
