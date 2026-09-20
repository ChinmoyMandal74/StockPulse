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

  // track('sort', 'overallScore:desc', 81) — kind from the server's allowlist,
  // detail a short fact string, and an OPTIONAL duration in milliseconds.
  // Anything else is dropped server-side.
  //
  // The duration is carried per event rather than derived at flush time, and it
  // has to be: a batch of up to fifty events is sent as one request and the
  // server stamps them all with ONE timestamp, so nothing downstream can work
  // out how long any single interaction took. This is the only place that knows.
  window.track = function (kind, detail, ms) {
    try {
      var e = { k: String(kind).slice(0, 16), d: detail == null ? '' : String(detail).slice(0, 80) };
      // Reject the empty before coercing — Number(null) is 0 and finite, which
      // would record a fabricated "instant" for every untimed call. The lesson
      // `num()` taught this codebase twice already.
      if (ms != null && ms !== '' && isFinite(ms) && Number(ms) >= 0) e.m = Math.round(Number(ms));
      Q.push(e);
      if (Q.length >= 40) { flush(); return; }
      if (!timer) timer = setTimeout(function () { timer = null; flush(); }, 20000);
    } catch (e) { /* ignore */ }
  };

  // How long THIS page took to become usable, which is the only load time worth
  // recording: the server logs its `page` row in about a millisecond and then
  // hands over a static file, so every wait that matters happens after that.
  //
  // The page decides when it is usable, because only it knows — the screener
  // means "the table is painted", not `window.load`, which fires while the data
  // is still in flight. Called once; later calls are ignored so a re-render
  // cannot log a second, smaller number and make the first look wrong.
  var loadSent = false;
  window.trackLoad = function (name, ms) {
    if (loadSent) return;
    loadSent = true;
    var t = ms;
    if (t == null && window.performance && performance.now) t = performance.now();
    window.track('load', name, t);
  };

  // pagehide is the reliable end-of-page signal; visibilitychange covers
  // mobile tab switches where pagehide may never fire.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
})();
