# The marketing pipeline

Leader carries the pipeline for Westringia Labs marketing material: drafting
LinkedIn posts, reviewing and approving them, publishing to the company page,
the poster-card templates, and the brand guidelines.

Posts live in Firestore next to the rest of Leader's data — `marketing_posts`
for the queue, `marketing_cards/{postId}` for each card PNG (stored as a data
URL; real cards run well under Firestore's 1 MB document cap). The client
owns the store the same way it owns leads; the only server function is the
LinkedIn call itself, because it holds the organisation token. Status moves
draft → approved → posted, and only ever forward: posted is final, and a
posted post can never be edited, deleted or published again, so the record
of what went out can never quietly change.

The collateral posted before the pipeline moved here stays in the westringia
repo under `docs/social/` as a closed archive; nothing reads it.

## The pages

- **/marketing** (sidebar → Marketing) — the queue. **New post** drafts one
  (title is internal, the body goes out exactly as written, with a live
  character count against LinkedIn's 3,000 limit). A draft is editable, can
  carry a card PNG with alt text, and can be deleted. **Approve** freezes it
  and unlocks **Publish to LinkedIn**; publish posts it as the organisation
  and stamps the post with the URN and time. The pages sit behind Leader's
  normal Google sign-in.
- **/marketing/brand** — the brand guidelines: palette, type, wordmark rules,
  the nine writing rules, the banned-word list, the card conventions.
- **/marketing/cards** — the poster-card templates, rendered at exactly
  1080 × 1350 for `tools/shoot-cards.mjs` to screenshot. A tool, not a page
  of the app: noindexed, and outside the auth gate so the screenshot script
  can reach it on a dev server. The first twelve cards are the ones published
  from the old pipeline, kept as worked examples of the style.

## Drafting a post

1. **New post** on /marketing. Write to the rules at /marketing/brand.
2. If it carries a card: add a card section to
   `apps/web/src/routes/marketing.cards.tsx` and its slug to
   `tools/shoot-cards.mjs`, then with `pnpm dev` running, `pnpm shoot:cards`.
   The PNGs land in `card-exports/` (gitignored — the export is a scratch
   step, the store is Firestore).
3. **Attach card** on the post, write the alt text, save.
4. Review against the checklist, **Approve**, **Publish**.

## Configuration

The publish call reads environment variables (the repo-root `.env` in dev,
the deploy's env vars in production). Everything else needs only the Firebase
config the app already has.

| Value | Env var | What it is |
| --- | --- | --- |
| LinkedIn token | `LINKEDIN_ACCESS_TOKEN` | From `tools/linkedin-auth.mjs`, run by a page admin. ~60-day life. |
| Organisation id | `LINKEDIN_ORG_ID` | The number in `linkedin.com/company/<number>/admin/`. |
| API version | `LINKEDIN_VERSION` | LinkedIn-Version header, default pinned in code (202506). |

## One-time LinkedIn setup, and the honest gate

Done once, by an admin of the company page. The gate is step 3: LinkedIn
reviews access applications by hand, so allow days, not minutes.

1. **Create an app** at developer.linkedin.com with the Westringia company
   page selected, and verify the association as a page admin (Settings tab).
2. **Add the redirect URL** `http://localhost:8917/callback` under Auth →
   Authorized redirect URLs, exactly as written.
3. **Request access to the Community Management API** on the Products tab —
   the product that allows posting as an organisation, reviewed manually.
4. **Mint the token** once approved:

   ```sh
   LINKEDIN_CLIENT_ID=… LINKEDIN_CLIENT_SECRET=… node tools/linkedin-auth.mjs
   ```

   It prints the access token and the organisation ids you administer.
5. **Set the values** in the deploy's environment and redeploy.

When publishing starts failing with a 401 the token has expired: re-run step
4 and update the value. If the app is enabled for programmatic refresh,
`node tools/linkedin-auth.mjs --refresh <token>` skips the browser
round-trip. Diarise it rather than discovering it the morning a post was
meant to go out.

## What this deliberately does not do

- **No browser automation.** Driving a logged-in LinkedIn session with a bot
  is against LinkedIn's user agreement and gets accounts restricted. Only the
  official API is used here, with the page's own consent flow.
- **No scheduling.** A post goes out when a person presses the button, on
  purpose.
- **No personal-profile posting.** The token is scoped to the organisation.
  Founders posting as themselves post by hand, which is where those posts
  should come from anyway.
- **No draft images on the public internet.** Cards live in Firestore behind
  the app's sign-in and are never served as public files. (The templates page
  is public tooling, but it carries only the composed designs, not the queue.)
