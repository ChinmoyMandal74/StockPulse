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
| 2. Screener | Done 2026-10-15. **The switch (account menu, Theme: Dark / Light / Auto) is `admin-only`** until step 3 |
| 3. Stock page (and its charts) | Next. Then the switch goes to members |
| 4. Compare, group pages, phone, Paper positions, Research, Holders | After |
| Admin pages | Stay dark |

The promo cards keep their own Dark / Light / Navy / Sky choice: that is the posted picture's, not the site's.

### Verified
- **Dark unchanged**: every element's computed colours (text, background, gradient, border, shadow, fill, stroke, outline) on the real screener with real data, last commit against this one: 3,995 elements, **zero differences** after normalising notation.
- Light screenshots across the Info, Signal and returns columns; the switch driven by clicks: page flips, choice stored, the account prefs PUT carries it, the banner's inline colour moves to the light shade and back, `<meta name="theme-color">` follows.
- Not yet looked at in light: the hover card's chart, the tiles layout, open menus. A member cannot reach light until step 3, so these are checked then.
