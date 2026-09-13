// The client half of the activity log — the interactions the server never
// sees (sorts, picker changes, chart toggles, the CSV export). Facts only,
// batched: events queue here and flush as ONE request every ~20s, on a full
// queue, and when the page hides — so a busy sorting session is one database
// write, not thirty. sendBeacon because it survives navigation; fetch with
// keepalive is the fallback. Fire-and-forget throughout: tracking must never
// slow or break the page, so every path swallows its own failure.
(function () {
  var Q = [];
  var timer = null;

  function flush() {
    if (!Q.length) return;
    var batch = Q.splice(0, 50);
    var body = JSON.stringify({ events: batch });
    try {
      var sent = false;
      if (navigator.sendBeacon) {
        sent = navigator.sendBeacon('/api/activity', new Blob([body], { type: 'application/json' }));
      }
      if (!sent) {
        fetch('/api/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (e) { /* never the page's problem */ }
  }

  // track('sort', 'overallScore:desc') — kind from the server's allowlist,
  // detail a short fact string. Anything else is dropped server-side.
  window.track = function (kind, detail) {
    try {
      Q.push({ k: String(kind).slice(0, 16), d: detail == null ? '' : String(detail).slice(0, 80) });
      if (Q.length >= 40) { flush(); return; }
      if (!timer) timer = setTimeout(function () { timer = null; flush(); }, 20000);
    } catch (e) { /* ignore */ }
  };

  // pagehide is the reliable end-of-page signal; visibilitychange covers
  // mobile tab switches where pagehide may never fire.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
})();
