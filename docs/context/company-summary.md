# The Company summary: one stock, written up as a blog draft (2026-10-12)

The owner asked whether a one-page executive summary of a stock could be made "as a sample research", and over three messages settled it: **admin only**, **AI-written**, the outlet is **a blog post** (not a PDF), it is called a **Company summary**, it uses **the Anthropic key already configured**, and it is **stock level only** for now. Cheaper models were discussed and left for later; at about two cents a summary the cost was not the deciding factor.

## Where things live

- `summary.js` (root, pure): `factSheet(d)`, `sheetText`, `prompt(d, sections)`, `check(text, sections, d)`, `postBody`, `slugOf`, `titleOf`, `ROW_SECTIONS`, `HEADINGS`, `RULES`.
- `server.js`: `summaryFacts(symbol)` and `POST /api/admin/company-summary?symbol=` (`requireAdmin`). `SUMMARY_MODEL` (env) defaults to `CHAT_MODEL`.
- `private/stock.html`: a **Company summary** button on the chart toolbar, shown only to the admin. It asks, then opens the blog editor on the draft.

## How it works

1. **The fact sheet.** `summaryFacts` takes the stock's snapshot row through the same stamps the stock page applies and through `RowCard.fieldValues`, and takes each further section from the payload function its page section uses (capital returns, revenue mix, insiders, options, holders, events, earnings). So a summary cannot quote a figure the page does not show. A field with no value is left off; the model is never shown a dash.
2. **The model** is given the sheet as text and told it is the only source: quote figures exactly, compute nothing, describe and never advise, mention the Signal once with its rule as a mechanical reading. Five fixed headings, 280 to 420 words.
3. **The checks**, in code: every number in the prose must be a number on the sheet (small counts and the spans in the sheet's own labels are free); a list of advice and prediction words is refused; headings, length and the Signal mention are verified.
4. **The post** is saved as a **draft**: a line saying what it is and that it is not advice, the prose, then every figure it was written from, then the sources.

## Rules that must hold

- **Never published from here.** The route only ever writes `status: draft`. A published post at the same address is not overwritten (409); a draft is, which is what pressing the button again is for. The address is `<symbol>-company-summary-<data date>`.
- **A flagged draft is still saved, with what was flagged printed at its top** as a quote block that has to be removed by hand before publishing. The owner reads every one; a flagged draft is more use than a refusal.
- **It is a description.** Not research, not a rating, no target, no forecast: the site's standing rule, and the opening and closing lines of every post say so. The Signal appears once, with the rule that fired.
- **The model's error body is never passed on**, and nothing is saved when the call fails or returns nothing.
- `dry=1` returns the fact sheet and instructions and calls nothing; `preview=1` calls the model and returns the draft without saving. Both exist for testing.
- The blog's Markdown has no tables, so the figures are lists. There is no chart in the post: the server cannot draw one, and an image would have to be added in the editor.

## Measured on the first real run (Apple, preview, nothing saved)

Fifteen sections and about seventy figures on the sheet; 2,524 tokens in, 1,074 out, twelve seconds; 419 words; every check passed. Read by hand, each figure matched the sheet.

## Not yet done

- No chart or image in the post.
- One stock at a time; no batch.
- Only Anthropic. Trying cheaper models would mean a second provider call behind the same `prompt` and `check`, which were written not to care who answers.
- The save path was not exercised by the build (it would have put a draft in the production blog); the first press is the owner's.

Tests: a scratchpad suite, 47 checks, including the captured real fact sheet and the captured real draft.
