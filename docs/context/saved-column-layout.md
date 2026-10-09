## Saved column layout
Which column groups a user has collapsed — and which starter screens they have starred — is stored per account in the `prefs` table (`user_key`, JSON `data`), read by `GET /api/prefs` and written by `PUT /api/prefs`.

- **Server-side, not `localStorage`.** The choice belongs to the person, so it follows them to another browser or machine rather than belonging to a device and being shared by whoever sits at it.
- **Keyed on the signed-in email**, falling back to `'admin'` for the legacy password cookie and for open mode, where there is no user row — the same convention `chat_usage` uses.
- **`fwd` is never persisted.** It is derived state: `refresh()` sets it from whether an as-of date is set, so saving it would only store a value the next load overwrites.
- **Prefs are awaited before the first render**, in the boot chain `checkAuth().then(loadPrefs).then(refresh)`. Applying them afterwards would paint the default layout and then visibly rearrange it.
- **Writes are debounced 600ms** — the columns menu stays open while toggling, so changes arrive in bursts — and are suppressed until the load lands, or the defaults would be written back over the values being fetched.
- **The server stores only what it understands.** `PUT` rebuilds the `collapsed` map from scratch against `/^[a-z]{1,16}$/`, so the endpoint cannot be used as free per-user storage and `__proto__` cannot get in.

