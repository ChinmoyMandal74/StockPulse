## Serving and the gate
**Two directories, and which one a file lives in decides whether a stranger can read it.**

| | `public/` | `private/` |
|---|---|---|
| holds | `login.html`, `reset.html`, `app.css`, `favicon.svg`, `logo.png` | every other page, the shared JS modules, every research JSON |
| served by | Vercel's CDN, without invoking the function | this Express app, behind `gateAssets` |
| reachable signed out | yes, deliberately | no |

- **`public/` is a Vercel static directory, and the CDN answers it before the function ever runs.** That is why `GATED_PAGES` — the redirect bouncing `/chat.html` to `/chat` — **had never once executed in production**. Every gated page answered 200 to anyone with the URL, as did `single-closes.json`, `lab-grid.json` and all sixteen `strategy-*.json` files: the whole price archive, with the portfolio names inside it. Locally it worked perfectly, which is exactly why it went unnoticed for so long. Confirmed by `X-Vercel-Cache: HIT` on `/single.html` against `MISS` on `/single`.
- **The fix is the directory, not the code.** Everything requiring a session moved to `private/`, which the CDN knows nothing about, so the request falls through to the function and the guard actually decides. URLs did not change — `private/` is mounted at the root, after `public/`.
- **Never put anything in `public/` that is not meant for a stranger.** There is no code path that can protect it.
- **`gateAssets` guards only what `private/` actually holds**, matching a filename set read at boot, and calls `next()` for everything else. This is load-bearing: `app.use()` sees every request that reaches it and **every API route is registered below that line**, so the first version — which refused outright — swallowed `POST /api/login` and made signing in impossible. Not just the gated pages; the entire site. Caught by testing the signed-**in** path, which is the half that is easy to skip.
- **A page request redirects to `/login`; an asset request answers 401 JSON.** Content negotiation cannot tell them apart — a browser's `fetch()` sends `Accept: */*` exactly like a navigation, so `req.accepts()` answered "html" for both and every data file got a redirect, which `fetch` follows, handing the page a login form and HTTP 200 where it expected JSON. `Sec-Fetch-Dest` is what a browser sets to say what a request is *for*; the file extension is the fallback for clients that omit it.
- **`GET /api/health` is deliberately open and returns a count, nothing else.** `private/` is not a Vercel static directory, so if the platform ever stopped bundling it with the function every gated page would 404 and it would look like a routing bug. `{"ok":true,"assets":35}` says which it is.
- **The offline builders write into `private/`** (`single-data.js`, `strategy-runs.js`, `lab-grid.js`), and `server.js`, `lab-grid.js` and `strategy-runs.js` all `require` the shared modules from there.
- **The APIs were never affected** — `/api/stocks` 401s, `/api/visitors` 403s, and the pages were empty shells without a session. No user data or credentials were exposed. What was readable was the derived market data and the page source.

