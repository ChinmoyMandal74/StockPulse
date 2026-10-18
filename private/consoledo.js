// The admin console's "do this" links (`/refreshes?do=refreshall` and the like),
// made safe to arrive at (backlog 45a, 2026-10-18).
//
// A page opened with ?do= used to start the job on load. That made a link
// anywhere (an email, a page someone else controls) able to start a refresh
// worth ten minutes and hundreds of credits in the admin's browser. Now the
// console marks the click, and the target page starts straight away only when
// that mark is there, fresh and for the same job; any other arrival is asked
// first. localStorage rather than sessionStorage, because a link may open a
// new tab; another site cannot write this origin's storage.
(function () {
  var KEY = 'consoleDo';
  var FRESH_MS = 60 * 1000;
  var id = function (path, what) { return String(path) + '|' + String(what); };

  // On the console: record the click just before the browser follows it. In the
  // bubbling phase on the document, so it runs AFTER a link's own handler (Fill
  // missing confirms first), and a click that handler cancelled is not marked.
  function markLinks(root) {
    (root || document).addEventListener('click', function (e) {
      if (e.defaultPrevented) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href*="?do="]') : null;
      if (!a) return;
      try {
        var u = new URL(a.href, location.href);
        if (u.origin !== location.origin) return;
        localStorage.setItem(KEY, JSON.stringify({ id: id(u.pathname, u.searchParams.get('do')), at: Date.now() }));
      } catch (err) { /* storage blocked: the target page will simply ask */ }
    });
  }

  // On the target page: was this arrival a console click for this job? The
  // mark is used up either way, so it cannot carry over to a later visit.
  function fromConsole(what) {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      localStorage.removeItem(KEY);
      return !!v && v.id === id(location.pathname, what) && Date.now() - Number(v.at) < FRESH_MS;
    } catch (err) { return false; }
  }

  // Start without asking only for a fresh console click; otherwise ask.
  function allowed(what, question) {
    return fromConsole(what) || window.confirm(question);
  }

  window.ConsoleDo = { markLinks: markLinks, fromConsole: fromConsole, allowed: allowed };
})();
