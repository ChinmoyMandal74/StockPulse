// LogoFX — lifts the baked-in white background off the stored logo JPEGs, in
// the browser, with no dependency: canvas in, transparent PNG data-URL out.
//
// How: flood-fill from the image BORDER, removing only white connected to the
// edge — so a white counter inside a mark (the knockouts in lettering)
// survives, where a naive "remove all white" would punch holes. A feather
// pass then fades the bright JPEG halo where opaque meets transparent.
//
// The one honest limit: a mark that is mostly near-black would vanish on the
// dark card, and a fill that removed nearly everything means the logo WAS a
// white shape on colour. Both come back { flat: false } and the caller keeps
// the white tile — the current look — so the fallback is never worse than
// today. Same-origin images only (/api/logo/...), so the canvas stays clean.
(function () {
  const cache = new Map(); // symbol -> Promise<{url, flat}>

  function process(img) {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h || w * h > 1024 * 1024) throw new Error('bad image');
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const id = cx.getImageData(0, 0, w, h);
    const d = id.data;

    // 232, not 255: JPEG compression leaves ringing a few shades off white,
    // and the fill has to swallow it or every logo keeps a dirty halo.
    const TH = 232;
    const isWhite = (p) => d[p * 4] >= TH && d[p * 4 + 1] >= TH && d[p * 4 + 2] >= TH;
    const seen = new Uint8Array(w * h);
    const q = [];
    for (let x = 0; x < w; x++) { q.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { q.push(y * w, y * w + w - 1); }
    while (q.length) {
      const p = q.pop();
      if (seen[p]) continue;
      seen[p] = 1;
      if (!isWhite(p)) continue;
      d[p * 4 + 3] = 0;
      const x = p % w;
      if (x > 0) q.push(p - 1);
      if (x < w - 1) q.push(p + 1);
      if (p >= w) q.push(p - w);
      if (p < w * (h - 1)) q.push(p + w);
    }

    // Feather the seam and take the mark's measurements in the same pass.
    let opaque = 0, lumSum = 0;
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      if (d[i + 3] === 0) continue;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const x = p % w;
      const nearClear =
        (x > 0 && d[i - 4 + 3] === 0) || (x < w - 1 && d[i + 4 + 3] === 0) ||
        (p >= w && d[i - w * 4 + 3] === 0) || (p < w * (h - 1) && d[i + w * 4 + 3] === 0);
      if (nearClear && lum > 215) {
        d[i + 3] = Math.max(0, Math.round(255 - (lum - 215) * 6));
      }
      if (d[i + 3] > 0) { opaque++; lumSum += lum; }
    }
    const frac = opaque / (w * h);
    const meanLum = opaque ? lumSum / opaque : 0;
    cx.putImageData(id, 0, 0);
    const flat = frac > 0.02 && meanLum > 80;
    return { url: flat ? cv.toDataURL('image/png') : null, flat };
  }

  function clean(symbol) {
    if (cache.has(symbol)) return cache.get(symbol);
    const pr = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try { resolve(process(img)); }
        catch (e) { resolve({ url: null, flat: false }); } // fallback: white tile
      };
      img.onerror = () => reject(new Error('no logo'));
      img.src = '/api/logo/' + encodeURIComponent(symbol);
    });
    cache.set(symbol, pr);
    return pr;
  }

  window.LogoFX = { clean };
})();
