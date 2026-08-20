# Leader

Lead research and CRM for Westringia Labs. Enter a business's website; Leader
reads it, works out what they do, and drafts the three things you send them:

1. **The opportunity doc** (`/doc/$leadId`) is about *their* business. What we
  understood, where the week goes, the two things worth building, what we
   would leave alone, and what we probably got wrong. Print-ready A4.
2. **The pitch doc** (`/pitch/$leadId`) is about working with us. The method,
  what it costs and what you carry, four straight answers to the questions
   that particular owner would ask, and who we are a poor fit for. Print-ready.
3. **The cold email**, on the lead page, with a follow-up for a week later and
  a checklist to run before sending.

All three are written to be read by the client, not by us. The house rules are
in the system prompt in [packages/core/src/generate-core.ts](./packages/core/src/generate-core.ts):
plain words, short sentences, humble without underselling, honest about what
AI cannot do here, conservative with numbers, no invented commercial terms, and
no em dashes. That last one is also enforced in code, because models slip.

## Repository layout

A pnpm workspace ([pnpm-workspace.yaml](./pnpm-workspace.yaml)):

- **[apps/web](./apps/web)** (`@leader/web`) - the TanStack Start app: routes,
  components, the Firebase client, and the server-function wrappers.
- **[packages/core](./packages/core)** (`@leader/core`) - shared domain code:
  lead types, site extraction, proposition generation, outreach email, the
  follow-up automation. No build step; it is consumed as TypeScript source by
  Vite and esbuild alike, via `exports` mapping `@leader/core/*` to `src/*.ts`.
- **[functions](./functions)** - the Cloud Functions deployable. Deliberately
  *not* a workspace member: it is its own pnpm root with its own lockfile,
  because `gcloud functions deploy --source=functions` uploads that directory
  alone and Cloud Build must install it without the rest of the repo.
  `pnpm build:functions` bundles `@leader/core` source into `functions/dist`,
  so only real npm packages are left as runtime dependencies there.

Root scripts delegate (`pnpm dev` / `build` / `start` run the web app, which
is what Railway builds; `pnpm typecheck` covers all three), so a host that
runs `pnpm install && pnpm build && pnpm start` at the repo root needs no
special configuration.

## Stack

- [TanStack Start](https://tanstack.com/start) (React 19, Vite, server functions)
- Tailwind CSS v4, themed to westringia.com (paper/ink/sage/clay, Source Serif 4 + Public Sans)
- Firebase Auth (Google sign-in)
- Cloud Firestore (shared `leads` collection, live-updating pipeline)
- Vercel AI SDK (`ai` + `@ai-sdk/google`) calling Gemini for proposition and doc generation

## Flow

1. **New lead** → paste a website URL.
2. A server function fetches the site (plus up to three about/services pages)
  and extracts what they do: title, copy, headings, services, contact details,
   tech signals.
3. A second server function asks Gemini (via the Vercel AI SDK) for everything
  the client sees: the opportunity doc content, the pitch doc content, and the
   cold email plus its follow-up.
4. The lead lands in the Firestore pipeline (`new → researched → doc_ready →
  contacted → in conversation → won/lost`), with notes.
5. **Open opportunity doc** and **Open pitch doc** render the two client-facing
  documents. Use *Print / save as PDF* (A4 print styles included).
6. The **cold email draft** sits on the lead page with copy buttons and the
  follow-up for a week later, alongside a checklist to run before sending.
7. **Outreach** is where it actually goes out. It prefills with the drafted
  email, adds the sender identification and opt-out line the Spam Act wants,
   and you edit it before sending from [hello@westringia.com](mailto:hello@westringia.com) via Spacemail SMTP.
   Sends are logged on the lead and the status advances to *contacted*. Nothing
   sends without a human click.

Keep the docs out of the first email. Attachments and links to a cold address
are what trip spam filters, so the email offers the write-up rather than
carrying it, and you send it when they reply.

**Check for replies** on the pipeline reads the mailbox over IMAP and matches
what came back to the lead that caused it. Matching is on the `Message-ID` we
stored when sending, found in the reply's `In-Reply-To`/`References`, so it
still works when you email `info@` and the owner answers from their own
address. Falls back to matching the sender address. It opens the inbox
read-only, so nothing is marked as read.

Inbound is sorted into four kinds, because they mean opposite things: a
**reply** moves the lead to *in conversation*, an **auto reply** means nobody
has read it yet, a **bounce** means the address is dead, and an **opt-out**
means stop. Your own BCC copy is filtered out, or every send would look like an
instant reply.

## The automation

A Cloud Function runs the whole loop every 30 minutes: read the mailbox, record
what came back, answer anyone who wrote to us, make first contact with any lead
never emailed, and move the follow-up sequence along for anyone who has gone
quiet. Every automated send emails you a copy immediately, with the full text
and why it went.

**First contact** is what makes a lead finder useful: drop a lead in with
nothing but a URL and the next run researches the site, generates the docs and
the cold email, sends it, and moves the lead to *contacted*. It only touches
leads still at *new*, *researched* or *doc_ready*; a status beyond that means a
person moved the lead along by hand, so the cold email is theirs to send. It
sends at most `COLD_EMAILS_PER_RUN` first emails per run (default 3, set it to
0 to turn first contact off), because a burst of cold email is how a mailbox
loses its reputation. Without a Gemini key the template draft is never sent;
the lead stops at *doc_ready* for a person to handle.

The four follow-ups each have their own job, because a model given "write a
follow-up" four times writes the same email four times:


| #   | After   | What it does                                                   |
| --- | ------- | -------------------------------------------------------------- |
| 1   | 4 days  | Leads with the *other* automation, not the one already pitched |
| 2   | 7 days  | Shows one concrete step of how it would actually work          |
| 3   | 11 days | Asks plainly whether this is even their call                   |
| 4   | 14 days | Closes out, leaves something useful, says it is the last email |


Then it stops. It never sends a fifth, never follows up once somebody has
replied, and never emails a lead marked `doNotContact`.

**What it will not do**, because these are correctness rather than caution: it
never replies to a bounce or an auto-responder (that is how mail loops start),
and an opt-out sets `doNotContact` so nothing can email that lead again, from
the cron or by hand. The reply drafter is told it may not invent a price, a
timeline or a commitment; asked for cost it says the two weeks are priced on
their own and a fixed price comes before any build.

Worth being clear-eyed: this sends email written by a model to real businesses
with nobody reading it first. `AUTOMATION_ENABLED` must be exactly `true`
before anything reaches a prospect. Left unset, the function does the whole
run and logs what it *would* have sent, which is the honest way to watch it for
a week before letting it out.

### Deploying it

```bash
pnpm build:functions           # bundles functions/src + packages/core to functions/dist
```

Store the secrets once:

```bash
printf '%s' 'SPACEMAIL_PASSWORD' | gcloud secrets create leader-smtp-pass --data-file=-
printf '%s' 'GEMINI_API_KEY'     | gcloud secrets create leader-gemini-key --data-file=-
printf '%s' "$(openssl rand -hex 24)" | gcloud secrets create leader-cron-secret --data-file=-
```

Give the function its own service account, with Firestore and secret access:

```bash
PROJECT=$(gcloud config get-value project)
SA=leader-cron@$PROJECT.iam.gserviceaccount.com
gcloud iam service-accounts create leader-cron --display-name="Leader outreach cron"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role=roles/datastore.user
for s in leader-smtp-pass leader-gemini-key leader-cron-secret; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done
```

Deploy. Note `AUTOMATION_ENABLED=false`: it runs and logs but sends nothing
until you flip it.

```bash
gcloud functions deploy leader-outreach \
  --gen2 --runtime=nodejs22 --region=australia-southeast1 \
  --source=functions --entry-point=runOutreach \
  --trigger-http --no-allow-unauthenticated \
  --service-account="$SA" --timeout=900s --memory=512Mi \
  --set-env-vars=SMTP_USER=hello@westringia.com,NOTIFY_EMAIL=you@westringia.com,APP_URL=https://your-app-url,GEMINI_MODEL=gemini-3.1-pro-preview,AUTOMATION_ENABLED=false \
  --set-secrets=SMTP_PASS=leader-smtp-pass:latest,GOOGLE_GENERATIVE_AI_API_KEY=leader-gemini-key:latest,CRON_SECRET=leader-cron-secret:latest
```

Then the schedule. `**--max-retry-attempts=0` matters**: a retry after a
timeout would send the same email twice, and missing one run costs you thirty
minutes.

```bash
URL=$(gcloud functions describe leader-outreach --region=australia-southeast1 --gen2 --format='value(serviceConfig.uri)')
gcloud scheduler jobs create http leader-outreach-30min \
  --location=australia-southeast1 \
  --schedule="*/30 * * * *" --time-zone="Australia/Sydney" \
  --uri="$URL" --http-method=POST \
  --oidc-service-account-email="$SA" --oidc-token-audience="$URL" \
  --headers="x-cron-secret=$(gcloud secrets versions access latest --secret=leader-cron-secret)" \
  --attempt-deadline=900s --max-retry-attempts=0
```

Watch a few runs, then turn it on:

```bash
gcloud functions deploy leader-outreach --gen2 --region=australia-southeast1 \
  --update-env-vars=AUTOMATION_ENABLED=true
```

No `GOOGLE_GENERATIVE_AI_API_KEY`? The flow still works end to end with a
clearly-marked template draft, so you can set up Firebase first and add the
key later.

### Redeploys from GitHub Actions

After the first manual deploys, pushes to `main` that touch the bundled code
(`functions/`, `packages/core/`) redeploy the functions automatically
(`.github/workflows/deploy-function.yml`; it can also be run by hand from the
Actions tab). It covers all three entry points — `leader-outreach`,
`leader-import-lead` and `leader-bulk-import` — but only ones that already
exist: a function that has never been deployed is skipped rather than created
half-configured, so the first deploy of each stays manual. The workflow passes
no env vars or secrets, so a redeploy keeps whatever the function already
has — it can't flip `AUTOMATION_ENABLED` or detach a secret.

One-time setup — a deployer service account that can deploy the function and
act as `leader-cron`:

```bash
PROJECT=$(gcloud config get-value project)
DEPLOYER=leader-deployer@$PROJECT.iam.gserviceaccount.com
gcloud iam service-accounts create leader-deployer --display-name="GitHub Actions deployer"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$DEPLOYER" --role=roles/cloudfunctions.developer
gcloud iam service-accounts add-iam-policy-binding "leader-cron@$PROJECT.iam.gserviceaccount.com" \
  --member="serviceAccount:$DEPLOYER" --role=roles/iam.serviceAccountUser
gcloud iam service-accounts keys create leader-deployer-key.json --iam-account="$DEPLOYER"
```

Then in the GitHub repo under **Settings → Secrets and variables → Actions**
add two secrets: `GCP_PROJECT_ID` (the project id) and `GCP_SA_KEY` (the full
contents of `leader-deployer-key.json`) — and delete the local key file. If
you'd rather not keep a long-lived key at all, swap the `auth` step for
[Workload Identity Federation](https://github.com/google-github-actions/auth#preferred-direct-workload-identity-federation);
the rest of the workflow stays the same.

## Bulk import

**Bulk import** on the dashboard takes a pasted list of websites - one per
line, commas, or a spreadsheet column - and researches the lot. It skips
anything already in the pipeline (matched on domain), creates one lead per
site marked *Queued*, and then each business is extracted and written up
**in its own function invocation**, so a batch of hundreds runs in parallel
and one slow or broken site never stalls the rest. Progress lands in the
pipeline live; failures keep the reason on the lead, with a retry button on
the lead page.

Two Cloud Functions do the work:

- `bulkImport` takes the batch of lead ids and enqueues one Cloud Tasks task
  per lead. The queue's dispatch rate is the only throttle, so crawling and
  Gemini calls are paced there, not in code.
- `importLead` handles exactly one company: crawl the site, generate the
  proposition, update the lead. A failure answers 500 so the queue retries
  with backoff (a timeout or a rate-limited model usually passes on the second
  go); the extraction is saved as soon as it exists, so a retry skips the
  crawl. When the retries run out the lead stays marked *Import failed* with
  the reason.

With nothing deployed, the import page still works: it falls back to running
the same steps from the browser tab, a few leads at a time, and says so. Fine
for a dozen leads; deploy the functions for hundreds.

### Deploying it

Reuses the service account and secrets from the outreach cron above, plus a
Cloud Tasks queue. The queue needs the enqueuer role and permission to mint
OIDC tokens for the worker:

```bash
PROJECT=$(gcloud config get-value project)
SA=leader-cron@$PROJECT.iam.gserviceaccount.com
REGION=australia-southeast1

gcloud tasks queues create leader-import --location=$REGION \
  --max-dispatches-per-second=2 --max-concurrent-dispatches=10 \
  --max-attempts=3 --min-backoff=60s
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role=roles/cloudtasks.enqueuer
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser
```

Deploy the worker first, since the dispatcher needs its URL. Same bundle as
the cron, different entry points:

```bash
pnpm build:functions

gcloud functions deploy leader-import-lead \
  --gen2 --runtime=nodejs22 --region=$REGION \
  --source=functions --entry-point=importLead \
  --trigger-http --no-allow-unauthenticated \
  --service-account="$SA" --timeout=540s --memory=512Mi \
  --set-env-vars=GEMINI_MODEL=gemini-3.1-pro-preview \
  --set-secrets=GOOGLE_GENERATIVE_AI_API_KEY=leader-gemini-key:latest,CRON_SECRET=leader-cron-secret:latest

WORKER_URL=$(gcloud functions describe leader-import-lead --region=$REGION --gen2 --format='value(serviceConfig.uri)')
gcloud functions add-invoker-policy-binding leader-import-lead \
  --region=$REGION --member="serviceAccount:$SA"

gcloud functions deploy leader-bulk-import \
  --gen2 --runtime=nodejs22 --region=$REGION \
  --source=functions --entry-point=bulkImport \
  --trigger-http --allow-unauthenticated \
  --service-account="$SA" --timeout=540s --memory=256Mi \
  --set-env-vars=IMPORT_LEAD_URL=$WORKER_URL,TASKS_LOCATION=$REGION,IMPORT_QUEUE=leader-import,TASKS_SA_EMAIL=$SA \
  --set-secrets=CRON_SECRET=leader-cron-secret:latest
```

`leader-bulk-import` is reachable from the internet because the app server
(not a Google identity) calls it; the `x-cron-secret` header is the lock, and
without it the function answers 403 before touching anything. The worker stays
`--no-allow-unauthenticated` - only Cloud Tasks calls it, with an OIDC token
minted for `$SA`.

Finally, tell the app where the dispatcher lives. In the app server's
environment (Vercel, `.env`, wherever the TanStack server runs):

```bash
BULK_IMPORT_URL=$(gcloud functions describe leader-bulk-import --region=$REGION --gen2 --format='value(serviceConfig.uri)')
CRON_SECRET=$(gcloud secrets versions access latest --secret=leader-cron-secret)
```

## Setup

```bash
pnpm install
cp .env.example .env
```

`.env` stays at the repo root - the web app reads it from there (`envDir` in
[apps/web/vite.config.ts](./apps/web/vite.config.ts)).

### Firebase

1. Create a project at console.firebase.google.com.
2. **Authentication → Sign-in method**: enable **Google**. Add your dev/prod
  domains under *Authorized domains* (localhost is pre-authorised).
3. **Firestore Database**: create a database, then publish the rules in
  `[firestore.rules](./firestore.rules)` (any signed-in user can read/write
   the shared `leads` collection).
4. **Project settings → Your apps → Web app**: register a web app and copy the
  config values into `.env` (`VITE_FIREBASE_`*).

### Gemini

Create an API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
and put it in `.env` as `GOOGLE_GENERATIVE_AI_API_KEY` (server-side only; it
is never sent to the browser). The model defaults to `gemini-3.1-pro-preview`.
This is copywriting a client reads, so it wants a pro model. The flash models
write blander and break the voice rules more often.
Set `GEMINI_MODEL` to override, and check the id is still live if generation starts failing.

### Email (Spacemail)

Outgoing mail uses [Spacemail's SMTP](https://www.spaceship.com/knowledgebase/connect-spacemail-to-email-client/):
host `mail.spacemail.com`, port `465` (SSL). Port `587` (STARTTLS) also works
on restricted networks. Set `SMTP_USER` to the full mailbox address
([hello@westringia.com](mailto:hello@westringia.com)) and `SMTP_PASS` to its password. Every send BCCs the
mailbox itself, since SMTP sends don't land in the Sent folder.

Two things to keep in mind for cold outreach from your primary domain:
keep volume low (a handful a day) to protect the mailbox's reputation, and
leave the identification and opt-out lines in the drafts. Commercial email in
Australia falls under the Spam Act.

### Run

```bash
pnpm dev        # http://localhost:3000
pnpm build      # production build of the web app
pnpm start      # serve the production build
pnpm typecheck  # web + core + functions
```

## Notes

- The site reader is polite but simple: it fetches HTML with a 15s timeout and
parses it without a headless browser, so JS-only sites yield thin research.
Generation stays conservative when research is thin.
- Extraction and generation both run server-side (TanStack server functions),
so no CORS issues and no API key exposure.
- The `leads` collection is shared across all signed-in users by design. It is
one team pipeline, not per-user data.

