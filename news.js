// Per-stock headlines, from a swappable provider — parsing and selection
// only, no database and no schedule, the same shape momentum.js has. The
// server orchestrates fetch/store/serve; this file is the part a test can
// hold still.
//
// Two providers:
//   google-rss — Google News search RSS, keyless. The default, because a
//     feature that waits on an API key is a dead feature. Headline, source,
//     link and timestamp only; the link is Google's redirect to the
//     publisher. Queried by company NAME (Google is not ticker-tagged).
//   finnhub — /company-news, ticker-tagged, used when FINNHUB_API_KEY is
//     set. Free tier covers this universe nightly with room to spare.
//
// Only headline / source / url / published_at are ever kept — never article
// bodies. Facts and links out are the safe shape to store.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NewsFeed = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_PER_SYMBOL = 25;      // stored per symbol, newest kept
  const KEEP_DAYS = 21;           // stored window; the page shows a fortnight

  function decodeEntities(s) {
    return String(s || '')
      .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .trim();
  }

  // Google News RSS: <item><title>Headline - Source</title><link>…</link>
  // <pubDate>…</pubDate><source url="…">Source</source></item>. Hand-parsed —
  // an XML library would be a dependency for four tags.
  function parseGoogleRss(xml) {
    const items = [];
    const blocks = String(xml || '').match(/<item>[\s\S]*?<\/item>/g) || [];
    for (const b of blocks) {
      const tag = (name) => {
        const m = b.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
        return m ? decodeEntities(m[1]) : '';
      };
      let headline = tag('title');
      const source = tag('source');
      // Google suffixes the publisher onto the title; strip it when it is
      // literally the source name, keep it when it is part of the headline.
      if (source && headline.endsWith(' - ' + source)) {
        headline = headline.slice(0, -(' - ' + source).length).trim();
      }
      const url = tag('link');
      const ts = Date.parse(tag('pubDate'));
      if (!headline || !url || !isFinite(ts)) continue;
      items.push({ headline, source: source || 'Google News', url, published_at: new Date(ts).toISOString() });
    }
    return items;
  }

  // Finnhub /company-news: [{ datetime (unix s), headline, source, url }]
  function normFinnhub(json) {
    const items = [];
    for (const x of Array.isArray(json) ? json : []) {
      const ts = Number(x && x.datetime) * 1000;
      if (!x || !x.headline || !x.url || !isFinite(ts) || ts <= 0) continue;
      items.push({ headline: String(x.headline).trim(), source: String(x.source || 'Finnhub').trim(),
        url: String(x.url), published_at: new Date(ts).toISOString() });
    }
    return items;
  }

  // Newest first, de-duplicated by url and by identical headline (Google
  // often carries one story through several syndicated urls), capped.
  function dedupe(items) {
    const seenUrl = new Set(), seenHead = new Set(), out = [];
    const sorted = items.slice().sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
    for (const it of sorted) {
      const h = it.headline.toLowerCase();
      if (seenUrl.has(it.url) || seenHead.has(h)) continue;
      seenUrl.add(it.url); seenHead.add(h);
      out.push(it);
      if (out.length >= MAX_PER_SYMBOL) break;
    }
    return out;
  }

  // Which symbols to top up next: never-fetched first, then stalest. The
  // nightly rounds call this with a small n, so the whole universe cycles
  // through in one night without any round doing bulk work.
  function pickStalest(symbols, fetchedAt, n) {
    return symbols.slice()
      .sort((a, b) => (fetchedAt[a] || 0) - (fetchedAt[b] || 0) || a.localeCompare(b))
      .slice(0, Math.max(0, n));
  }

  function googleRssUrl(name, symbol) {
    // The company name is the query — Google is not ticker-tagged — with
    // "stock" to bias toward the finance cluster. The symbol seeds the rare
    // row with no stored name.
    const q = `"${(name || symbol)}" stock`;
    return 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-US&gl=US&ceid=US:en';
  }

  function finnhubUrl(symbol, key, days) {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${key}`;
  }

  return { MAX_PER_SYMBOL, KEEP_DAYS, parseGoogleRss, normFinnhub, dedupe, pickStalest, googleRssUrl, finnhubUrl, decodeEntities };
});
