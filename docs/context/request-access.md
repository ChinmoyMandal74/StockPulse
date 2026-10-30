# Requesting an invite code (2026-10-10)

Owner's request: someone should be able to ask for access by giving an email address, so the owner can send them the sign-up code. Until then the code field on `/login` said "Ask the admin for this" and offered no way to.

**The flow**

1. On the Create account tab, when a code is required, the code field carries "No code? Request one by email". It sends the email (and name, if typed) already in the form to `POST /api/access-request`.
2. The server stores one row in `access_requests` and emails the owner a notice (`kind: 'access-request'`) linking to `/users`.
3. `/users` shows an "Access requests" table above the accounts, hidden when empty. **Send code** emails the requester the invite code and a link to `/login?mode=register` (`kind: 'access-invite'`) and marks the row sent. **Delete** removes the row and sends nothing.

**Rules that must hold**

- **The code is never sent automatically.** It leaves the server in one place, `POST /api/access-requests/:id/send`, on an admin's click. An automatic reply would make the code fetchable by anyone who types an address.
- **The public answer is the same whatever happened**: new, repeat, over the cap, or an address that already has an account. Only a malformed address is told so. The admin list is where "already has an account" shows.
- **Bounded twice**, because the route is unauthenticated: one row per address (a repeat bumps `asks` and `last_at` and does not notify again), and `ACCESS_REQ_PER_HOUR` (20) new addresses site-wide per hour, past which a request is dropped unwritten.
- A row marked `sent` becomes `new` again only if the person asks more than a day later.
- The owner's notice carries no typed text in its subject, and the name has CR and LF stripped.
- A failed send is not marked sent. A failing mail provider does not fail the public request.
- Rows are purged after 90 days on the next request, and `/privacy` says so.
- With no `SIGNUP_CODE` set, the login page shows no code field and so no request link; the Send button reads "Send invite" and the mail says no code is needed.

**Where**: `server.js` block `// ---- asking for an invite code` (above the `/api/users` routes, below `requireAdmin`); `db.js` `noteAccessRequest`, `listAccessRequests`, `readAccessRequest`, `markAccessRequestSent`, `deleteAccessRequest`; `public/login.html` `requestAccess`; `private/users.html` `loadRequests`.

**Not built**: a request form on the landing page (it links to `/login`), and any automatic approval.

## Invite code switched off (2026-10-30)

The owner opened sign-up to everyone: "disable the Invite code feature, I might bring it back later". `INVITE_CODE_ON = false` in server.js makes `SIGNUP_CODE` read as empty whatever Vercel holds; the code itself stays in Vercel's `SIGNUP_CODE`, untouched. With approval also off (since 2026-09-26) registration is open, and the startup warning about wide-open registration is expected. Email verification and the terms tick still apply. `/join` (the Google step) now asks for the code only when `/api/auth/google/pending` says `codeRequired`, and otherwise just asks for the terms. Help and Privacy are worded to hold either way.

**To bring it back:** set `INVITE_CODE_ON = true` and push. The sign-up field, the request link, `/join`'s field and the access mail all follow `SIGNUP_CODE`.
