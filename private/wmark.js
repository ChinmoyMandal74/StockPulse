// The watermark: the viewer's identity tiled faintly across every data page.
// It PREVENTS nothing — nothing in a browser can stop a screenshot — it signs
// them: any capture that leaves this site carries the account it came from,
// which deters sharing far better than blocking ever could. Self-contained on
// purpose: each data page adds one script tag and this does the rest.
//
// Who gets marked: members and guests. The owner is skipped — the threat
// model is redistribution by others, and the owner should not read their own
// screen through a mark all day. Open mode (no ADMIN_PASSWORD) is local dev
// and is skipped too. Failures are swallowed throughout: identity comes from
// /api/me, and a watermark must never break the page it decorates.
// ONE /api/me per page. Every page that loads this also asks who the viewer is
// for its own reasons, so the answer was fetched twice on each of them. The
// shared slot is a promise on `window`, not a function, deliberately: this
// script is deferred and a page's inline script runs first, so neither can rely
// on the other having defined a helper — whichever runs first creates the
// promise and the other awaits the same one.
window.__me = window.__me
  || fetch('/api/me', { cache: 'no-store' }).then((r) => r.json());

(async function () {
  try {
    const me = await window.__me;
    if (!me || !me.authRequired || me.admin) return;
    const text = me.guest ? 'Guest preview' : (me.user && me.user.email) || '';
    if (!text) return;
    // One tile, drawn as an inline SVG background so there are no extra DOM
    // nodes to reflow — the div repeats it across the viewport. The fill is
    // the app's text colour at 5%: present in a capture, ignorable in use.
    const safe = text.replace(/[<>&"']/g, '');
    const svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='460' height='260'>" +
      "<text x='10' y='150' font-family='system-ui,sans-serif' font-size='15' " +
      "fill='rgba(233,236,242,0.05)' transform='rotate(-24 230 130)'>" + safe + '</text></svg>';
    const div = document.createElement('div');
    div.className = 'wmark';
    div.style.backgroundImage = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
    (document.body || document.documentElement).appendChild(div);
  } catch (e) { /* never the page's problem */ }
})();
