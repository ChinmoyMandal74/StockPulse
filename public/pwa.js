// THE INSTALLABLE APP (backlog 63, step 1; the owner, 2026-11-11: build it,
// members only, push for alerts and new posts, named Tickr Lab). One script,
// loaded by the phone page /m: it registers the service worker (/sw.js), and
// - opened from the home screen by someone who is not a member, shows a
//   sign-in screen instead of the page (the app is for members);
// - logs one 'app' event a session when opened from the home screen, which is
//   how installs are counted (/activity);
// - in the browser, offers to install (Safari's Share > Add to Home Screen;
//   Chrome's own prompt where it exists), once, dismissable;
// - adds the bell: notifications for the member's own price alerts and for
//   new posts, each switchable, sent by the server through Web Push.
// No data and no secrets here, so it lives in public/. Every class is pw-.
(function () {
  'use strict';
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
  const css = `
  .pw-gate{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:32px 24px;text-align:center;background:var(--void,#071120);color:var(--text,#eef2f8)}
  .pw-gate img{width:84px;height:84px;border-radius:20px}
  .pw-gate h2{margin:6px 0 0;font-size:24px;letter-spacing:-.02em}.pw-gate p{margin:0;max-width:30ch;color:var(--muted,#9aa3b2);font-size:15px;line-height:1.5}
  .pw-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
  .pw-b{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:12px;border:1px solid var(--hair-2,rgba(255,255,255,.18));background:transparent;color:var(--text,#eef2f8);font:600 15px var(--sans,system-ui);text-decoration:none;cursor:pointer}
  .pw-b.pw-p{background:var(--text,#eef2f8);color:var(--void,#071120);border-color:transparent}
  .pw-ban{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:150;display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:16px;border:1px solid var(--hair,rgba(255,255,255,.12));background:var(--surface-2,#0f1828);box-shadow:0 18px 50px -20px rgba(0,0,0,.8);color:var(--text,#eef2f8);font-size:14px;line-height:1.4}
  .pw-ban img{width:40px;height:40px;border-radius:10px;flex:0 0 40px}.pw-ban span{flex:1;min-width:0}.pw-ban b{display:block}
  .pw-x{min-width:44px;min-height:44px;border:0;background:transparent;color:var(--muted,#9aa3b2);font-size:22px;cursor:pointer}
  .pw-sheet{position:fixed;inset:auto 0 0 0;z-index:180;padding:20px 20px calc(24px + env(safe-area-inset-bottom,0px));border-radius:22px 22px 0 0;background:var(--surface-2,#0f1828);border-top:1px solid var(--hair,rgba(255,255,255,.12));color:var(--text,#eef2f8)}
  .pw-sheet h3{margin:0 0 4px;font-size:18px}.pw-sheet p{margin:0 0 14px;color:var(--muted,#9aa3b2);font-size:14px;line-height:1.5}
  .pw-tg{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;border-top:1px solid var(--hair,rgba(255,255,255,.1));font-size:15px}
  .pw-tg input{width:24px;height:24px}
  .pw-msg{margin-top:10px;min-height:1.2em;font-size:13.5px;color:var(--muted,#9aa3b2)}.pw-msg.pw-err{color:var(--red,#fb7185)}
  .pw-dim{position:fixed;inset:0;z-index:170;background:rgba(0,0,0,.5)}`;
  const addCss = () => { if (document.getElementById('pw-css')) return; const s = document.createElement('style'); s.id = 'pw-css'; s.textContent = css; document.head.appendChild(s); };
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };
  const ICON = '/icons/apple-touch-icon.png';

  async function me() { try { const r = await fetch('/api/me', { cache: 'no-store' }); return r.ok ? r.json() : null; } catch (e) { return null; } }

  // The app is for members: from the home screen, anyone else meets this.
  function gate() {
    addCss();
    document.body.appendChild(el(`<div class="pw-gate" role="dialog" aria-label="Sign in"><img src="${ICON}" alt=""><h2>Tickr Lab</h2>
      <p>The app is for members. Sign in with your account, or create one; it is free.</p>
      <div class="pw-row"><a class="pw-b pw-p" href="/login?next=/m">Sign in</a><a class="pw-b" href="/login?mode=register&next=/m">Create an account</a></div></div>`));
  }

  // Counted once a session, through the page beacon's allowlisted kinds.
  function countOpen() {
    try { if (sessionStorage.getItem('pw-open')) return; sessionStorage.setItem('pw-open', '1'); } catch (e) { /* counted anyway */ }
    const body = JSON.stringify({ events: [{ k: 'app', d: ios ? 'open:ios' : 'open' }] });
    try { navigator.sendBeacon('/api/activity', new Blob([body], { type: 'application/json' })); } catch (e) { /* not counted */ }
  }

  // In the browser: offer the app, once, until dismissed.
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  function banner() {
    if (standalone() || store.get('pw-ban-off')) return;
    const safari = ios && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
    if (!safari && !deferred) return;
    addCss();
    const b = el(`<div class="pw-ban" role="region" aria-label="Install the app"><img src="${ICON}" alt=""><span><b>Get the Tickr Lab app</b>${safari
      ? 'Tap <b style="display:inline">Share</b>, then <b style="display:inline">Add to Home Screen</b>.' : 'Install it on this phone.'}</span>${safari ? '' : '<button class="pw-b pw-p" type="button">Install</button>'}<button class="pw-x" type="button" aria-label="Not now">×</button></div>`);
    b.querySelector('.pw-x').addEventListener('click', () => { store.set('pw-ban-off', '1'); b.remove(); });
    const go = b.querySelector('.pw-p');
    if (go) go.addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); try { await deferred.userChoice; } catch (e) { /* closed */ } deferred = null; b.remove(); });
    document.body.appendChild(b);
  }

  // PUSH. The browser's subscription is sent to the server with the topics
  // chosen; turning both off removes it there.
  const b64 = (s) => { const p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'The server answered ' + r.status + '.'); return d; });
  async function currentSub() { const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }
  async function sheet() {
    addCss();
    const dim = el('<div class="pw-dim"></div>');
    const s = el(`<div class="pw-sheet" role="dialog" aria-label="Notifications"><h3>Notifications</h3>
      <p>On this phone, for your own account. You can turn them off here or in the phone's settings.</p>
      <label class="pw-tg"><span>My price alerts</span><input type="checkbox" data-t="alerts"></label>
      <label class="pw-tg"><span>New posts on the blog</span><input type="checkbox" data-t="posts"></label>
      <div class="pw-msg" role="status"></div><div class="pw-row" style="margin-top:10px"><button class="pw-b" type="button">Done</button></div></div>`);
    const close = () => { dim.remove(); s.remove(); };
    dim.addEventListener('click', close); s.querySelector('.pw-row .pw-b').addEventListener('click', close);
    document.body.append(dim, s);
    const msg = s.querySelector('.pw-msg'), boxes = [...s.querySelectorAll('input')];
    const say = (t, bad) => { msg.textContent = t; msg.className = 'pw-msg' + (bad ? ' pw-err' : ''); };
    if (!('PushManager' in window) || !('serviceWorker' in navigator)) {
      boxes.forEach((x) => { x.disabled = true; });
      return say(ios && !standalone() ? 'On iPhone, notifications work once the app is on your Home Screen: tap Share, then Add to Home Screen, and open it from there.' : 'This browser cannot receive notifications.', true);
    }
    try {
      const sub = await currentSub();
      if (sub) { const st = await post('/api/push/status', { endpoint: sub.endpoint }); boxes.forEach((x) => { x.checked = !!(st.topics && st.topics[x.dataset.t]); }); }
    } catch (e) { /* shown unticked */ }
    boxes.forEach((x) => x.addEventListener('change', async () => {
      const topics = Object.fromEntries(boxes.map((b) => [b.dataset.t, b.checked]));
      boxes.forEach((b) => { b.disabled = true; }); say('Saving…');
      try {
        let sub = await currentSub();
        if (!topics.alerts && !topics.posts) {
          if (sub) { await post('/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
          say('Notifications are off on this phone.');
        } else {
          if (!sub) {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') throw new Error('Notifications are blocked for this site in the phone’s settings.');
            const { key } = await fetch('/api/push/key').then((r) => r.json());
            const reg = await navigator.serviceWorker.ready;
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
          }
          await post('/api/push/subscribe', { subscription: sub.toJSON(), topics });
          say('Saved.');
        }
      } catch (e) { x.checked = !x.checked; say(e.message || 'That did not work.', true); }
      boxes.forEach((b) => { b.disabled = false; });
    }));
  }
  function bell(where) {
    if (!where) return;
    const b = el('<button class="cbtn" type="button" aria-label="Notifications" title="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg></button>');
    b.addEventListener('click', sheet);
    where.appendChild(b);
  }

  async function init(opts) {
    opts = opts || {};
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* the page works without it */ });
    const who = await me();
    const member = !!(who && who.signedIn && !who.guest);
    if (standalone()) {
      if (!member) return gate();
      countOpen();
    } else if (member) setTimeout(banner, 1500);
    if (member) bell(opts.bellIn);
  }
  window.TickrApp = { init, standalone };
})();
