# The marketing pipeline

Leader carries the pipeline for Westringia Labs marketing material: the
LinkedIn queue review, the approve/publish flow, the poster-card templates,
and the brand guidelines. It moved here from the westringia repo, which used
to run it as a password-protected admin on the Netlify deploy of the
marketing site.

**The collateral itself did not move.** Queue files stay in the westringia
repo at `docs/social/queue` (frontmatter: `title`, `image`, `image_alt`,
`status`; body: the exact post text) with their card PNGs in
`docs/social/images`. Leader reads and writes them through the GitHub
contents API, so every approve and publish is still a real commit on the
westringia deploy branch and git stays the log of what went out and when.

## The pages

- **/marketing** (sidebar → Marketing) — every post in the queue with its
  card. Open one: the image, the exact text, the alt text and the review
  checklist. **Approve** unlocks **Publish to LinkedIn**; publish posts it as
  the organisation and marks the file `status: posted` with the post URN. A
  posted file can never post again. Status moves draft → approved → posted,
  and only ever forward. The pages sit behind Leader's normal Google sign-in.
- **/marketing/brand** — the brand guidelines: palette, type, wordmark rules,
  the nine writing rules, the banned-word list, the card conventions.
- **/marketing/cards** — the poster-card templates, rendered at exactly
  1080 × 1350 for `tools/shoot-cards.mjs` to screenshot. A tool, not a page
  of the app: noindexed, and outside the auth gate so the screenshot script
  can reach it on a dev server.

## Configuration

Everything reads environment variables (the repo-root `.env` in dev, the
deploy's env vars in production).

| Value | Env var | What it is |
| --- | --- | --- |
| LinkedIn token | `LINKEDIN_ACCESS_TOKEN` | From `tools/linkedin-auth.mjs`, run by a page admin. ~60-day life. |
| Organisation id | `LINKEDIN_ORG_ID` | The number in `linkedin.com/company/<number>/admin/`. |
| API version | `LINKEDIN_VERSION` | LinkedIn-Version header, default pinned in code (202506). |
| GitHub token | `MARKETING_GITHUB_TOKEN` | Fine-grained PAT for the westringia repo only, Contents read + write. Falls back to `GITHUB_TOKEN`. |
| Repo / branch | `MARKETING_GITHUB_REPO`, `MARKETING_GITHUB_BRANCH` | Default `nithinpeter/westringia` / `main`. |
| Local checkout | `WESTRINGIA_CHECKOUT` | Path to a westringia clone, default `../westringia`. |

Without a GitHub token the store falls back to the local westringia checkout,
where approves and publishes show up in that repo's `git status` instead of
as commits — which is what makes local dev work. `MARKETING_STORE=local|github`
forces the choice if a machine carries an unrelated `GITHUB_TOKEN`.

## Drafting a new post

1. Copy any file in the westringia repo's `docs/social/queue`, keep the
   frontmatter shape, and write to the rules at `/marketing/brand` (the same
   rules as westringia.com/how-we-write). `image:` may be omitted for a
   text-only post.
2. If it carries a card, add a card section to
   `apps/web/src/routes/marketing.cards.tsx` and its slug to
   `tools/shoot-cards.mjs`, then with `pnpm dev` running:
   `pnpm shoot:cards`. The PNG lands in the westringia checkout's
   `docs/social/images`; commit and push it there.
3. Review, approve and publish from `/marketing`.

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
5. **Set the values** in the deploy's environment (plus the GitHub PAT) and
   redeploy.

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
- **No draft images on the public internet.** The cards are delivered to the
  signed-in review page as data URLs read from the private westringia repo,
  never served as public files.
