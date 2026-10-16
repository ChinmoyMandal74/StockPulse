## Themes: dark and light (2026-10-15, owner's request)

The owner: *"I want give users the options to change themes"*, after a local mock-up of the screener in white ("It works, What next", then "Go"). This replaces the old **Dark only** convention.

### How it works
- **Tokens, not colours.** `public/app.css` holds every colour as a token on `:root`; `:root[data-theme="light"]` swaps the set. New tokens for the job: `--wash` (what a hover or hairline is mixed from: white on dark, ink on light), `--shade` (shadows), `--strong` (the loudest ink, which was a bare `#fff`), `--glass`, `--pink`, `--orange`, `--teal`, `--ok-ink`, `--warn-ink`. Every translucent colour a stylesheet used to write out is now `color-mix(in srgb, var(--token) N%, transparent)`, **which resolves to exactly the colour it was on dark**.
- **Meanings do not change.** Green up, red down, amber notice, the Signal's six colours: on light each uses the promo studio's light-ground shade (Cards `LIGHT_INK` / `LADDER_LIGHT`), 4.5:1 or better on white.
- **`public/theme.js`** runs in `<head>` before paint and sets `data-theme` on `<html>`, so a light choice never flashes dark. **Only a page that opts in with `<html data-themeable>` is ever turned light**; an unconverted page stays dark rather than half-light. Choices: dark, light, auto (follows the computer). `window.TickrTheme` (`choice`, `set`, `current`); a `themechange` event fires on `document`.
- **Stored** in the browser (`localStorage['tl-theme']`) and in the account's prefs (`theme`, one of dark/light/auto, all three stored so a dark choice reaches a machine set to light). The screener writes it with its other prefs and applies the account's choice on load.
- **Colours chosen in script** (column-group tints, theme badges, the portfolio picker) go through `ink()` in index.html, a light lookup over the same palette; `GROUP_COLORS` is a Proxy that answers through it, so the hover card gets light tints without a change of its own. A theme change runs `applyGroups()` and `render()`, because the banners are coloured by the former.
- **What the tokens cannot reach** has a light rule of its own in app.css: `<option>` popups, the grain overlay, the wordmark gradient, the white primary button (dark on light).

### Converting a page
1. Run the converter (`theme-convert.js` in the session scratchpad: CSS only, inside `<style>`, skips token definitions) or do it by hand: translucent white to `--wash`, black to `--shade`, signal rgba to their tokens, hexes to tokens.
2. Anything left is a decision, not a substitution: give it a light-only rule.
3. Colours chosen in script need a light lookup and a redraw on `themechange`.
4. Add `data-themeable` to `<html>` and `<script src="/theme.js"></script>` right after the `theme-color` meta.
5. **Prove dark unchanged**: dump every element's computed colours on the old and new build (`styles-probe.js`, `styles-diff.js`, which normalise `rgba()` against `color(srgb ...)` and allow one unit of rounding) and require zero differences.

### Rollout
| Step | State |
|---|---|
| 1. Tokens, theme.js, prefs | Done 2026-10-15 |
| 2. Screener | Done 2026-10-15. The switch is in the account menu: Appearance: Dark / Light / Auto |
| 3. Stock page (and its charts) | Done 2026-10-15; **the switch opened to every signed-in account** the same day |
| 4. Every member page | Done 2026-10-15 (list below) |
| Admin pages | Stay dark |

The promo cards keep their own Dark / Light / Navy / Sky choice: that is the posted picture's, not the site's.

### Verified
- **Dark unchanged**: every element's computed colours (text, background, gradient, border, shadow, fill, stroke, outline) on the real screener with real data, last commit against this one: 3,995 elements, **zero differences** after normalising notation.
- Light screenshots across the Info, Signal and returns columns; the switch driven by clicks: page flips, choice stored, the account prefs PUT carries it, the banner's inline colour moves to the light shade and back, `<meta name="theme-color">` follows.
- Not yet looked at in light: the hover card's chart, the tiles layout, open menus. A member cannot reach light until step 3, so these are checked then.

### The stock page (step 3)
- Its stylesheet converted (82 colours); the one rule left is the figures on the revenue-mix columns, dark on the bright dark-theme segments, which turn white on light.
- **Series colours are tokens with the old hex as fallback** (`var(--sky, #38bdf8)`): the stock page's two-colour bars (insiders, options, capital returns), the revenue-mix palette, `peertrend.js`'s share bands, and **`RowCard.GROUP_COLORS`** (the group heads in All fields, on /compare and in the phone's field picker). Every one lands in a style attribute, so a theme switch recolours them with no redraw, and the card rasteriser resolves them because it reads computed styles. New tokens: `--lime`, `--orchid`, `--steel`, `--sky`, `--slate`, `--dim`, `--indigo`, `--peach`.
- Verified: every element's computed colours on the stock page, previous build against this one, MU and RGTI, **zero differences** on dark (654 elements each, the parts a canned server can draw; the rest changed a hex for a token holding the same hex). Light drawn for MU with a synthetic price history: the price chart, both averages, RSI, volume and the trend ribbon, the masthead and All fields.

### Every member page (step 4)
- **Converted and opted in** (20): compare, the group pages (basket), the phone page, Paper positions, Research, Holders and Holder, Alerts, the pivot, Consolidated, Help, Privacy, Terms, About, Accept terms, Contact, Join, Login, Reset, and the Visuals studio. Admin pages stay dark.
- **Left to a light-only rule** (dark untouched): the wordmark gradient on Login, Join and Accept; white text on the dark buttons there and on About's green one; the pivot's link hover; the Visuals studio's stage, dropdown list and image buttons.
- **Charts drawn in script** now write every colour through a style, never an SVG attribute (which cannot read a token): the group page's chart, Paper's account chart. Their palettes, and those of Research's verdicts, Holder's sector bar, the pivot's ladders and the phone's field groups, are tokens with today's colour as fallback. Seven more series tokens: `--blue`, `--aqua`, `--fuchsia`, `--yellow`, `--lilac`, `--ice`, `--rose`.
- **THE POST CARDS OWN THEIR COLOURS.** The dark card used to borrow ten tokens from the page (`--text`, `--muted`, `--faint`, `--hair`, `--hair-2`, `--accent`, `--green`, `--red`, `--amber`, `--bg`); on a light page it would have drawn dark ink on its black ground, in the studio, on the phone and in the exported picture. `.s-art` now sets them to the dark values itself; the card themes (Light, Navy, Sky) still set their own. A card looks the same whatever page holds it.
- **The phone has its own switch**: a button in its header cycling Dark, Light, Auto, saved through **`POST /api/prefs/theme`**, which reads the prefs row, changes the one field and writes it back. `PUT /api/prefs` replaces the whole row and stays the screener's alone. The phone applies the account's choice on load.
- **Called Appearance, not Theme**, in the screener menu, on the phone and in /help: on this site a *theme* is a stock grouping (the Theme picker, the Themes column). Code and docs still say theme; only the label changed.
- Verified: every element's computed colours on all 20 pages, previous commit against this one, **zero differences on dark** (transitions switched off, script tags skipped, one 8-bit step of transparency allowed: an rgba() alpha is stored in 8 bits, so 0.022 reads back 0.024 where color-mix() keeps 0.022, the same pixel). The Visuals studio (4,000 elements, a card on the stage) among them. Light seen on the studio (panel light, the Dark-ground card unchanged), the phone, Help and Compare. Accept terms and Login render little without a real sign-in, so their check is thin.
