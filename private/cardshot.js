// cardshot.js — turning a card on the page into a PNG at its true pixel size.
//
// Lifted out of promo.html (2026-09-16) when the phone page needed the same
// thing: a second implementation of "rasterise this card" would have drifted
// from the studio's the first time a CSS property was added, which is the
// reason rowcard.js, cards.js, action.js and filters.js all exist.
//
// Why it is this involved, and why none of it is optional:
//   - A serialized SVG document sees NONE of the page's stylesheets, so every
//     computed property has to be written onto the clone as an inline style.
//   - An external font reference inside an SVG-as-image is silently dropped,
//     so the Google fonts are fetched once and embedded as data URIs. A face
//     still pointing at the network is worse than a missing face: the external
//     ref is what taints the canvas and makes toBlob throw.
//   - The on-screen artboard is scaled to fit the window; the export is not,
//     so the clone is forced back to its true size before serialising.
//
// Contract: CardShot.shoot(el, { w, h, mime, quality }) -> Promise<Blob>.
(function (global) {
  'use strict';

  // Only properties that can change how a card LOOKS. Walking every computed
  // property instead would produce a megabyte of style attributes per card.
  const INLINE_PROPS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'box-sizing',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
    'align-items', 'align-self', 'justify-content', 'gap', 'row-gap', 'column-gap',
    'grid-template-columns', 'grid-template-rows', 'place-items', 'order',
    'overflow', 'overflow-x', 'overflow-y', 'visibility', 'opacity',
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-numeric',
    'letter-spacing', 'line-height', 'text-align', 'text-transform', 'text-decoration-line',
    'white-space', 'word-break', 'text-overflow', 'vertical-align', 'color',
    'background-color', 'background-image', 'background-repeat', 'background-position',
    'background-size', 'background-clip',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-left-radius', 'border-bottom-right-radius',
    'box-shadow', 'transform', 'transform-origin', 'filter',
    'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill',
  ];

  function inlineStyles(src, dst) {
    const cs = getComputedStyle(src);
    let text = '';
    for (const prop of INLINE_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v && v !== 'none' || prop === 'display') text += `${prop}:${v};`;
    }
    dst.setAttribute('style', text);
    const sk = src.children, dk = dst.children;
    for (let i = 0; i < sk.length; i++) inlineStyles(sk[i], dk[i]);
  }

  // Fetched and embedded once per page. A few hundred KB of woff2, and the
  // alternative is a card exported in the system font.
  let fontCssPromise = null;
  function fontCss() {
    if (fontCssPromise) return fontCssPromise;
    fontCssPromise = (async () => {
      const link = document.querySelector('link[href*="fonts.googleapis.com/css2"]');
      if (!link) return '';
      const css = await fetch(link.href).then((r) => r.text());
      const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
      const data = {};
      await Promise.all(urls.map(async (u) => {
        const buf = await fetch(u).then((r) => r.arrayBuffer());
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        data[u] = 'data:font/woff2;base64,' + btoa(bin);
      }));
      let out = css.replace(/url\((https:[^)]+)\)/g, (m, u) => (data[u] ? `url(${data[u]})` : m));
      out = out.replace(/@font-face\s*\{[^}]*url\(https:[^}]*\}/g, '');
      return out;
    })().catch(() => '');
    return fontCssPromise;
  }

  // One rasteriser, every caller: the studio's still, its eighty video frames,
  // and the phone's saveable image.
  async function shoot(el, opts) {
    const o = opts || {};
    const w = o.w || 1080;
    const h = o.h || Math.round(el.getBoundingClientRect().height);
    const css = o.fontCss == null ? await fontCss() : o.fontCss;
    const clone = el.cloneNode(true);
    inlineStyles(el, clone);
    clone.style.transform = 'none';
    clone.style.width = w + 'px';
    clone.style.height = h + 'px';
    const xhtml = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<foreignObject width="100%" height="100%"><style>${css}</style>` +
      `<div xmlns="http://www.w3.org/1999/xhtml">${xhtml}</div></foreignObject></svg>`;
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('The browser refused to rasterise the card.'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    await new Promise((r) => requestAnimationFrame(r));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    return new Promise((resolve, reject) =>
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed.'))),
        o.mime || 'image/png', o.quality));
  }

  global.CardShot = { shoot, fontCss, inlineStyles, INLINE_PROPS };
})(typeof window !== 'undefined' ? window : globalThis);
