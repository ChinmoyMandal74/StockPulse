# Post to Instagram (2026-10-10)

The studio's admin-only box under "Post to blog". One card is a post; cards added to the tray first are a carousel, in the order added.

**Where things live**

- `instagram.js` (root, pure): the rules (`problem`), the request shapes, the address Instagram fetches (`imageUrl`), error wording, and `tokenPlan`. The one implementation of every rule; the studio repeats none of them.
- `server.js`, block `// ---- Instagram`: `igCall`, `igToken`, `igReady`, `GET /api/admin/instagram` (who it posts as, the day's allowance, recent posts: read-only, and the proof the token works), `POST /api/admin/instagram/post`.
- `db.js`: table `ig_posts` (one row per published post), `app_meta` key `ig_token` (the token chain).
- `private/promo.html`: `#igBox`, `igShoot` / `igAdd` / `igCheck` / `igGo` / `loadIg`.

**Environment**: `IG_ACCESS_TOKEN`, `IG_USER_ID` (both required; set on Vercel, not in the local `.env`), `IG_API_VERSION` (optional, default `v23.0`). Meta app "Tickr Lab Publisher", Instagram API with Instagram Login, account `@tickr_lab`.

**Rules that must hold**

- **Nothing posts by itself.** No cron, no queue. The first click is a dry run (`dry: true`) that checks the post and names the account; only the second button sends. A post cannot be withdrawn through this API.
- **The picture must be a JPEG at a public address.** It is stored in `post_images` and fetched by Instagram from `/blog/img/<id>.jpg` (the route ignores the extension). A local server is not public, so posting is refused there; post from the live site.
- **Feed shapes only**: 4:5 to 1.91:1. The 9:16 Story size is refused. A carousel is one shape, two to ten pictures.
- **The same pictures twice inside ten minutes is refused** as a double click unless `again` is sent, which the studio offers as a second confirmation.
- **After `media_publish` succeeds nothing may report a failure**: the post is up. A failed record write returns `recorded: false`, still `ok`.
- **The token is never logged or returned**, and travels in a header except on the refresh call. Network errors are reported in our words because the driver's message can carry the address.
- **The token chain**: the environment's token is used until its first refresh; the refreshed token is stored in `app_meta` with a mark (a short hash) of the environment token it descends from. A different token in the environment wins and restarts the chain. The daily watchdog cron calls `igToken`, which refreshes after a week, and mails the operator if a refresh is refused. A failed read of the chain throws rather than being read as "nothing stored".

**Tests** were scratchpad Node suites: the rules, and the server block run against a pretend Instagram. Nothing was posted to the real account by the build.

**Not built**: Stories, video and reels, scheduling, deleting a post.
