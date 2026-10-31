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
- **Feed shapes**: 4:5 to 1.91:1; 9:16 is refused on the feed. A carousel is one shape, two to ten pictures.
- **Stories** ("Post as a Story", `kind: 'story'`): `media_type=STORIES`, as tall as 9:16. One picture each, so every card in the tray is published as a story of its own, in order, and recorded as its own `ig_posts` row with `kind = 'story'`. No caption is sent; the API has no field for one. If a later story in a batch fails, the earlier ones stay up and the answer is still `ok` with `posted`, `pictures` and `failed`.
- **The same pictures twice inside ten minutes is refused** as a double click unless `again` is sent, which the studio offers as a second confirmation.
- **After `media_publish` succeeds nothing may report a failure**: the post is up. A failed record write returns `recorded: false`, still `ok`.
- **The token is never logged or returned**, and travels in a header except on the refresh call. Network errors are reported in our words because the driver's message can carry the address.
- **The token chain**: the environment's token is used until its first refresh; the refreshed token is stored in `app_meta` with a mark (a short hash) of the environment token it descends from. A different token in the environment wins and restarts the chain. The daily watchdog cron calls `igToken`, which refreshes after a week, and mails the operator if a refresh is refused. A failed read of the chain throws rather than being read as "nothing stored".

**Tests** were scratchpad Node suites: the rules, and the server block run against a pretend Instagram. Nothing was posted to the real account by the build.

**Not built**: video and reels, scheduling, deleting a post, links or stickers on a Story (the API offers none).

## A blog post to Instagram (2026-10-31, owner: "This should only be allowed if the blog is live")

**"Post to Instagram" on `/posts`**, beside "Send as email" and shown only for a live post, as that one is.

- **The slides are drawn in the editor from the SAVED post**, fetched again when the box opens, never the textarea: the caption sends people to the page, so the slides must be what the page says. Unsaved edits are named in the hint.
- **A cover, then each of the post's own pictures** (`/blog/img/` only, in reading order, fences included, at most nine), every slide 1080x1350 on navy (`#071120` to `#0d1a2d`), a JPEG at q0.92 stored through `/api/admin/posts/image`. One shape because a carousel is one shape; 4:5 because it is the tallest the feed takes. A picture from another site is left out and counted (it would taint the canvas). A post with no pictures is a single cover.
- **The caption** starts as the title, the summary, `The full post, with every chart: tickrlab.com/blog/<slug>`, and the house caveat; it is editable, and editing it after Check hides Post now until checked again.
- **`POST /api/admin/posts/:slug/instagram`** refuses an unknown post (404) and a draft (400, "Publish it first"), the dry run included, and then runs `igPublish`, the studio route's body moved into a function, unchanged. So the rule is the server's, not the hidden button's. The activity log line ends `:blog:<slug>`.
- **Check, then Post now**, as the studio: the dry run names the account; the same slides inside ten minutes turn the button into "Post it again anyway".
- Tests (scratchpad, pretend Instagram, headless Chrome over the real page): 17 checks, including the button absent on a draft and after unpublishing, three slides from a body with a foreign picture, four media calls and one publish, and the draft refused with nothing reaching Instagram. Proved by reverting the status check: three fail, and the draft is posted.

### Instagram pictures of a post's own (2026-10-31, owner: "the image size for blog and instagram cannot be the same")
A wide chart suits the blog and a 4:5 one suits the feed, so a post can carry both. **A ```instagram fence** holds the 4:5 pictures, one per line, written like a gallery fence (the editor's Gallery menu inserts it: "Instagram only"). The page, the editor preview and the mail render nothing of it (`closeGallery` drops the `instagram` mode); the plain-text mail and the index thumbnail read the markdown through `splitIgFence`, so neither sees it. **`igPictures(md)`** in server.js is the one reader of which pictures go on Instagram: the fence's when it has any, else the post's own, our uploads only; `GET /api/admin/posts?slug=` hands it to the editor as `post.instagram`, and the editor no longer parses the body for pictures itself. The cover slide is still drawn in the editor. Tests: 11 checks with a fenced post (page, index, preview, the editor's four slides, five media calls), 17 without; removing the renderer's skip shows the fence's pictures on the page and fails two.

### Each picture gets its own wait (2026-10-31)
The first blog carousel (four slides) failed with "Instagram was still preparing the picture after 25 seconds": one 25-second allowance covered the whole post while each child was created and then waited for before the next. Now every child container is created in order (the carousel's order is the `children` list) and then waited for together, each with its own `IG_WAIT_MS`, now 45 seconds, and the carousel container gets its own. `Promise.allSettled`, so no poll is left running after one fails. Against a pretend Instagram taking ten polls (about 11 seconds) per picture: the old code fails at 25 seconds with that message, the new one posts in 22. Worst case is about two minutes, inside the function's limit.
