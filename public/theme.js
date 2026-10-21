// The site's theme: dark, light, navy (2026-10-21), or auto (follow the computer). 2026-10-15.
//
// Loaded in <head>, BEFORE the stylesheet paints, so a light-theme visitor never
// sees a dark flash. Only a page that opts in with <html data-themeable> is
// ever turned light: a page not yet converted keeps its dark look rather than
// going half-light. The choice lives in this browser (localStorage) and, for a
// signed-in member, in their account prefs, which the screener writes and
// reads back -- so it follows them to another machine.
//
// window.TickrTheme: choice() -> 'dark'|'light'|'navy'|'auto', set(choice),
// current() -> 'dark'|'light'|'navy'. Navy is a dark theme on a navy ground:
// code asking "is it light?" treats it as dark, which is right. A `themechange` event fires on document when the
// resolved theme changes, so a page can redraw anything coloured in script.
(function () {
  'use strict';
  var KEY = 'tl-theme';
  var root = document.documentElement;
  var themeable = root.hasAttribute('data-themeable');
  var mq = null;
  try { mq = window.matchMedia('(prefers-color-scheme: light)'); } catch (e) { /* old browser */ }

  function choice() {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
    return v === 'light' || v === 'navy' || v === 'auto' ? v : 'dark';
  }
  function resolve(c) {
    if (c === 'auto') return mq && mq.matches ? 'light' : 'dark';
    return c === 'light' || c === 'navy' ? c : 'dark';
  }
  function apply() {
    var t = themeable ? resolve(choice()) : 'dark';
    var was = root.getAttribute('data-theme');
    root.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#eef1f5' : t === 'navy' ? '#071120' : '#050505');
    if (was && was !== t) {
      try { document.dispatchEvent(new CustomEvent('themechange', { detail: t })); } catch (e) { /* very old browser */ }
    }
  }
  apply();
  if (mq) {
    var onOs = function () { if (choice() === 'auto') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onOs); else if (mq.addListener) mq.addListener(onOs);
  }
  // Another tab changed it.
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); });

  window.TickrTheme = {
    choice: choice,
    current: function () { return root.getAttribute('data-theme') || 'dark'; },
    set: function (c) {
      c = c === 'light' || c === 'navy' || c === 'auto' ? c : 'dark';
      try { localStorage.setItem(KEY, c); } catch (e) { /* this page only */ }
      apply();
    },
    themeable: themeable,
  };
})();
