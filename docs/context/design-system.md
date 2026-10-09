## Design system
Dark-only. "Ethereal glass": OLED black with a fixed radial mesh aura and a film-grain overlay, glass chrome, hairline borders.

### Where CSS lives
`public/app.css` holds everything common to all four pages — tokens, `.aura`/`.grain`, `#sprite`/`.ic`, `.bezel`/`.core`, `.btn` and variants, the signal colours, table base, `#rowcard` and `.reveal`. Each page links it and then keeps **only its own layout** in an inline `<style>`.

- **The page's block loads second, so it wins ties.** That is how `login.html` keeps its full-width white submit button and its tinted card interior while still inheriting the rest.
- **Match the shared selector exactly when you mean to override it.** `login.html` styles `.bezel > .core`, not `.core`, because the shared rule is more specific and would otherwise win regardless of order.
- **Watch grouped selectors.** A page rule like `th, td { font-size: … }` sits after the shared `th { font-size: … }` at equal specificity and silently takes it over. `index.html` and `analysis.html` set their table font sizes on `td` alone for this reason.
- **An unscoped class rule in a page can capture a shared one, and layout is where it hurts.** `index.html` carried `.warn { display: inline-block; vertical-align: -2px; margin-left: 3px }`, written for a small inline glyph — and `.warn` is also the app-wide amber signal class from `app.css`. The day a table cell first used that colour (Cushion, 2026-09-17) every amber cell became `display: inline-block`, stopped being a table cell, and stopped aligning with the rest of its column. **The signal classes in `app.css` are colours and nothing else; a rule that also positions must name what it positions** — it is `span.warn` now. `.pos`, `.neg` and `.na` were checked at the same time and are colour-only everywhere.
- **`[hidden] { display: none !important }` sits at the top of `app.css`, and is load-bearing.** The attribute is only a plain UA declaration, so *any* rule of ours that sets `display` beats it on specificity and the element keeps painting — `#chart .readout { display: flex }` left an empty 22×12 glass pill parked over the stock page's change caption. Don't remove it, and don't write a `[hidden]` variant beside each new `display` rule instead. Audited when it was added: the readout was the only element on any of the seven pages that it changed.
- **`app.css` carries NO heading reset, so every `<h1>` keeps the browser's own `margin: 0.67em 0` unless its page says otherwise.** Every page does — pivot, promo, quality, database and backtest all set an h1 margin explicitly — except `/stock`, whose `.sympick` did not (2026-09-21). At that type size it was **23.5px of empty band above the symbol** and the same below, sitting between the nav pill and the masthead for no reason anyone chose; the owner circled it in a screenshot. `.head` is a flex container, so an item's margin collapses into nothing and is simply added — `.head` measured **83.5px tall against 60px** once it was zeroed. A local omission rather than a systemic gap, but the next new page will inherit the same default: **set the margin.**
- Before changing a shared rule, check the other three pages — the four style blocks used to be copies of each other and drifted (`20px` where the token said `var(--r-core)`, buttons that had lost `font-family`).

- **Type** — `Geist` / `Geist Mono` from Google Fonts (`--sans` / `--mono`). Numeric table cells use the mono face with `font-variant-numeric: tabular-nums`. This is the app's only external dependency; it degrades to `system-ui` offline.
- **Double bezel** — every card is `.bezel` (translucent shell, hairline, `--r-shell` radius, 6px padding) wrapping `.core` (opaque `--surface`, `--r-core` radius, inset top highlight). `--r-core` = `--r-shell` − padding, for concentric curves.
- **Icons** — inline SVG sprite in `#sprite`, used as `<svg class="ic"><use href="#i-name" /></svg>`. No emoji, no icon font. Add new glyphs as `<symbol id="i-...">` with 1.35px strokes on a 24×24 viewBox.
- **Motion** — only `--ease` / `--ease-soft` cubic-beziers, never `linear` or `ease-in-out`. `.reveal` + `IntersectionObserver` gives blocks a fade-up-and-deblur entry; table rows stagger via `--i` on each `<tr>`. All of it is disabled under `prefers-reduced-motion`.
- **Performance rules** — `backdrop-filter` only on fixed/sticky elements (island menus, mobile sheet, tooltip), never on a scrolling container. The grain and aura are fixed `pointer-events: none` layers. Animate `transform`/`opacity` only.
- **Layers** — `--z-sheet: 45`, `--z-nav: 46`, `--z-tip: 55`, `--z-grain: 60`. Menus sit at `z-index: 30` inside `.page`'s stacking context.

### CSS tokens (`:root` in `public/app.css`)
```
--void #050505      page          --text  #e9ecf2   17.2:1
--surface #0a0c11   card interior --muted #9aa3b2    7.7:1
--surface-2 #0d1017 group headers --faint #7d8797    5.4:1
--shell   rgba(255,255,255,.028)  --green #34d399   --red   #fb7185
--hair    rgba(255,255,255,.07)   --amber #fbbf24
--hair-2  rgba(255,255,255,.13)   --accent #7c9cff  --accent-2 #a78bfa
```
`--bg`, `--panel` and `--border` are kept as aliases so older rules and inline styles keep resolving.

**The two greys are contrast-floored.** Ratios above are against `--surface`; both clear WCAG AA (4.5:1). `--faint` used to be `#59616f` at 3.1:1 and it painted the column headers, the hover card's field names and every em-dash placeholder — the least legible text in the app. Don't darken either one back below 4.5:1.

**`--surface` must stay opaque.** The frozen table columns and the sticky header cells paint on it to mask the rows scrolling underneath; a translucent value makes them see-through.

