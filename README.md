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
loses its reputation. That is the burst limit; [the day has its own, and it
climbs](#how-much-goes-out-in-a-day). Without a Gemini key the template draft
is never sent; the lead stops at *doc_ready* for a person to handle.

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

### How much goes out in a day

`COLD_EMAILS_PER_RUN` limits a burst and nothing else. Three first emails every
thirty minutes is 144 a day, and 144 is not by itself a lot — a small
consultancy sending that many is unremarkable. What is not unremarkable is a
domain with no sending history going from zero to 144 overnight, which is the
shape of a compromised mailbox rather than a business. So there is a second
limit on the day, and it climbs:

| Week | Marketing emails per day |
| ---- | ------------------------ |
| 1    | 30                       |
| 2    | 45                       |
| 3    | 65                       |
| 4    | 90                       |
| 5    | 120                      |
| 6+   | 144                      |

The numbers live in `WARMUP_DAILY_CAPS` in
[packages/core/src/automation/warmup.ts](./packages/core/src/automation/warmup.ts);
edit them there and nothing else needs to know.

The count lives in a single Firestore document, `settings/outreach`, rather
than being recomputed from the leads, so you can open it and read it:

```
startedAt        2026-08-22   the day the first marketing email went out
day              2026-08-22   the day sentToday counts
sentToday        17
overrideDailyCap (absent)     set a number to pin the cap, 0 to stop
```

Week one starts on the first send, not on the deploy, so the ramp is not spent
while you are still watching the logs. The day rolls over at midnight in
Sydney, which is the timezone the schedule runs on.

**Sending allowance** on the dashboard is the control for it, and the only
place that distinguishes a spent allowance from a broken cron: both leave
leads sitting at *doc_ready*, and only this says which. It shows the day's
count live and offers three modes.

| Mode         | What it does                                               |
| ------------ | ---------------------------------------------------------- |
| Warm-up ramp | Follow the table above. The default, and what to leave it on |
| Fixed limit  | Hold one number every day, ignoring the ramp                |
| Paused       | No cold emails, no follow-ups, until you change it back     |

Paused takes effect on the next run, so within thirty minutes, with no deploy.
Replies keep working in every mode. The screen only ever writes
`overrideDailyCap`; the count and the start date belong to the cron, so
changing the limit at midday cannot lose the morning's tally.

**Replies are outside all of this.** Someone who wrote to us and is waiting on
an answer is not marketing, capping that would lose the deal the cold email was
for, and mail people actually engage with helps a domain rather than costing
it. Cold emails and follow-ups spend the allowance; replies do not.

A dry run reads the real ledger, so the cap it sees is the one it would face,
and writes to a throwaway copy. Watching the automation for a week does not
spend a week of allowance.

### Checking the address before sending

Bounces cost a sending domain more than the emails would ever have earned back:
a run of them reads, correctly, as a list the sender did not build. The
addresses here are scraped off websites, and a good share of what a crawler
finds is not a mailbox — a `noreply@`, the placeholder address a theme shipped
with, or a filename the address regex matched (`logo@2x.png` is a real
example). So every automated send checks the address first, in
[packages/core/src/verify-email.ts](./packages/core/src/verify-email.ts):
syntax, a small list of local parts nobody reads and domains that only appear
in template copy, then a DNS lookup for whether the domain accepts mail at all.
A domain with no MX but an address record passes, because RFC 5321 says fall
back to it and plenty of small business domains rely on exactly that.

`info@` and `hello@` pass on purpose. For a ten-person trade business that *is*
the owner's inbox, and dropping role addresses would drop most of the pipeline.

Three outcomes, and the third is the one that matters:

- **deliverable** — send.
- **undeliverable** — structural, so it will be just as wrong next run. The
  verdict is written to the lead, the cron stops using that address, and the
  lead page says why. It is keyed by address, so putting a better one in the
  contact field gets it re-checked on the next run with nothing to undo.
- **unknown** — the resolver timed out or failed. That is our problem, not the
  address's, so nothing is written down and the lead is tried again next run.

What this does not do is open an SMTP session and probe with `RCPT TO`, the
only way to learn whether a specific mailbox exists. Google Cloud blocks
outbound port 25 from Cloud Functions so the call cannot leave, and most
business mail sits behind Google or Microsoft, who accept every probe anyway.
Per-mailbox certainty has to come from a verification API over HTTPS; drop one
in behind `verifyEmailAddress` and the rest of the cycle needs no changes.

Neither of these needs a deploy step, new secrets or new environment
variables. The ledger document creates itself on the first send.

Worth being clear-eyed: this sends email written by a model to real businesses
with nobody reading it first. `AUTOMATION_ENABLED` must be exactly `true`
before anything reaches a prospect. Left unset, the function does the whole
run and logs what it *would* have sent, which is the honest way to watch it for
a week before letting it out.

### Deploying it

Four separate things have to exist before the cron works: the secrets it
reads, an identity it runs as, the function itself, and a schedule to poke it
every 30 minutes. Do them in that order — each step needs the one before it.

This is a one-time job. Once all of it exists, GitHub Actions redeploys the
code for you on every push (see [Redeploys from GitHub Actions](#redeploys-from-github-actions)).

#### 1. Build the bundle

```bash
pnpm build:functions           # bundles functions/src + packages/core to functions/dist
```

#### 2. Store the passwords and keys

These live in Secret Manager rather than in the deploy command, so they never
end up in your shell history or on the function's settings page.

```bash
printf '%s' 'SPACEMAIL_PASSWORD' | gcloud secrets create leader-smtp-pass --data-file=-
printf '%s' 'GEMINI_API_KEY'     | gcloud secrets create leader-gemini-key --data-file=-
printf '%s' "$(openssl rand -hex 24)" | gcloud secrets create leader-cron-secret --data-file=-
```

`leader-cron-secret` isn't a password you picked — it's a random string the
function and whatever calls it share. A stranger who discovers the function's
URL can't make it run without that string.

#### 3. Give the function an identity

Every Cloud Function runs *as* some account, and that account is what Google
checks when the code touches anything. `leader-cron` is that account here, and
it gets exactly two powers: read/write Firestore, and read the three secrets
above.

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

#### 4. Deploy the function

Note `AUTOMATION_ENABLED=false`. The function runs the complete loop and logs
every email it *would* have sent, but sends nothing until you flip that. Leave
it off for a week and read the logs.

```bash
gcloud functions deploy leader-outreach \
  --gen2 --runtime=nodejs22 --region=australia-southeast1 \
  --source=functions --entry-point=runOutreach \
  --trigger-http --no-allow-unauthenticated \
  --service-account="$SA" --timeout=900s --memory=512Mi \
  --set-env-vars=SMTP_USER=hello@westringia.com,NOTIFY_EMAIL=you@westringia.com,APP_URL=https://your-app-url,GEMINI_MODEL=gemini-3.1-pro-preview,AUTOMATION_ENABLED=false \
  --set-secrets=SMTP_PASS=leader-smtp-pass:latest,GOOGLE_GENERATIVE_AI_API_KEY=leader-gemini-key:latest,CRON_SECRET=leader-cron-secret:latest
```

#### 5. Schedule it

Cloud Scheduler is the thing that actually calls the function every 30
minutes; the function has no timer of its own.

**`--max-retry-attempts=0` matters.** If a run times out halfway through,
a retry would send the same emails a second time. Missing one run costs you
thirty minutes; double-emailing a prospect costs you the prospect.

```bash
URL=$(gcloud functions describe leader-outreach --region=australia-southeast1 --gen2 --format='value(serviceConfig.uri)')
gcloud scheduler jobs create http leader-outreach-30min \
  --location=australia-southeast1 \
  --schedule="*/30 * * * *" --time-zone="Australia/Sydney" \
  --uri="$URL" --http-method=POST \
  --oidc-service-account-email="$SA" --oidc-token-audience="$URL" \
  --headers="x-cron-secret=$(gcloud secrets versions access latest --secret=leader-cron-secret)" \
  --attempt-deadline=900s --max-retry-attempts=0

# The OIDC token above only opens the door if the same account is an invoker
# on the service. Without this the job runs every 30 minutes and every run is
# a 403 in the logs, which looks exactly like a quiet cron with nothing to do.
gcloud run services add-iam-policy-binding leader-outreach \
  --region=australia-southeast1 \
  --member="serviceAccount:$SA" --role=roles/run.invoker
```

#### 6. When you're ready, turn it on

```bash
gcloud functions deploy leader-outreach --gen2 --region=australia-southeast1 \
  --source=functions --entry-point=runOutreach \
  --update-env-vars=AUTOMATION_ENABLED=true
```

`--source` and `--entry-point` are not optional here. Every `gcloud functions
deploy` rebuilds, and without `--source` it builds the current directory: from
the repo root that fails with `function.js does not exist`. The env vars and
secrets you set above survive, because `--update-env-vars` only touches the
one key it names.

No `GOOGLE_GENERATIVE_AI_API_KEY`? The flow still works end to end with a
clearly-marked template draft, so you can set up Firebase first and add the
key later.

### Redeploys from GitHub Actions

Once a function exists, you shouldn't be deploying by hand any more. Pushes to
`main` that touch the bundled code (`functions/`, `packages/core/`) redeploy
all three functions automatically — `leader-outreach`, `leader-import-lead`
and `leader-bulk-import`. The workflow is
[`.github/workflows/deploy-function.yml`](./.github/workflows/deploy-function.yml)
and you can also trigger it by hand from the repo's Actions tab.

Two deliberate limits, both there to stop CI quietly breaking production:

- **It only redeploys functions that already exist.** A function that has
  never been deployed is skipped, not created. The first deploy of each one is
  the manual one above, because that's where env vars and secrets get set.
- **It passes no env vars and no secrets.** A `gcloud functions deploy` that
  omits `--set-env-vars` / `--set-secrets` keeps whatever the function already
  has. So a redeploy can't flip `AUTOMATION_ENABLED` back to `false` or
  detach a secret, no matter what's in the repo.

#### One-time setup

GitHub needs its own Google Cloud identity to deploy with — it can't use your
laptop's `gcloud` login. That identity is a second service account,
`leader-deployer`, and it needs two permissions.

```bash
PROJECT=$(gcloud config get-value project)
DEPLOYER=leader-deployer@$PROJECT.iam.gserviceaccount.com

# Create it first — the two bindings below fail if it doesn't exist yet.
gcloud iam service-accounts create leader-deployer --display-name="GitHub Actions deployer"

# (a) may deploy Cloud Functions
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$DEPLOYER" --role=roles/cloudfunctions.developer

# (b) may hand leader-cron to a function as its runtime identity
gcloud iam service-accounts add-iam-policy-binding "leader-cron@$PROJECT.iam.gserviceaccount.com" \
  --member="serviceAccount:$DEPLOYER" --role=roles/iam.serviceAccountUser
```

Binding (b) is the one that's easy to miss, and it's granted **on the
`leader-cron` account, not on the project**. The deploy command says
`--service-account=leader-cron@...`, which means the deployer is acting as
that account, and Google makes you say so explicitly. Without it the deploy
fails with `PERMISSION_DENIED: iam.serviceaccounts.actAs`.

Note what the deployer deliberately *doesn't* get: `roles/run.admin`. That's
why the workflow passes no `--allow-unauthenticated` flag — changing a
function's invoker policy needs rights this account doesn't have, so a
redeploy simply inherits whatever policy the function already had.

#### Then give GitHub the key

```bash
gcloud iam service-accounts keys create leader-deployer-key.json --iam-account="$DEPLOYER"
```

In the repo under **Settings → Secrets and variables → Actions**, on the
**Secrets** tab (not Variables — the workflow reads them as `secrets.*`), add:

| Secret           | Value                                          |
| ---------------- | ---------------------------------------------- |
| `GCP_PROJECT_ID` | your project id, e.g. `leader-west`             |
| `GCP_SA_KEY`     | the entire contents of `leader-deployer-key.json` |

Then **delete the local key file** — `rm leader-deployer-key.json`. It's a
password to your cloud project in plain text, and the `.gitignore` patterns
for service-account keys don't match that filename.

Rather not keep a long-lived key at all? Swap the `auth` step for
[Workload Identity Federation](https://github.com/google-github-actions/auth#preferred-direct-workload-identity-federation);
the rest of the workflow stays exactly the same.

## Bulk import

**Bulk import** on the dashboard takes a pasted list of websites - one per
line, commas, or a spreadsheet column - and researches the lot. It skips
anything already in the pipeline (matched on domain), creates one lead per
site marked *Queued*, and then each business is extracted and written up
**in its own function invocation**, so a batch of hundreds runs in parallel
and one slow or broken site never stalls the rest. Progress lands in the
pipeline live; failures keep the reason on the lead, with a retry button on
the lead page.

The work is split across two Cloud Functions, which is worth explaining because
one function would look simpler:

- `bulkImport` — the **dispatcher**. Takes the batch of lead ids and enqueues
  one Cloud Tasks task per lead. It does nothing slow, so it finishes in
  seconds whether the batch is five leads or five hundred.
- `importLead` — the **worker**. Handles exactly one company per invocation:
  crawl the site, generate the proposition, update the lead.

Importing one lead means crawling a website and then waiting on a model — call
it 30 to 60 seconds. A single function looping over three hundred of those
would hit its timeout and die halfway through, every time. Splitting it buys
four things that loop can't have:

1. **It runs in parallel.** Hundreds of invocations at once, instead of one
   loop grinding through leads in sequence.
2. **One bad site can't stall the batch.** A site that hangs or errors takes
   down its own invocation and nothing else.
3. **Retries are per lead.** A failure answers 500 and Cloud Tasks retries
   *that lead* with backoff — a timeout or a rate-limited model call usually
   passes on the second go. One big function retrying would re-crawl and
   re-bill the two hundred leads that already succeeded. The extraction is
   saved as soon as it exists, so even a retry of the same lead skips the
   crawl it already did.
4. **Throttling is configuration, not code.** The queue's dispatch rate paces
   crawling and Gemini calls. Nothing in the source has to know about rate
   limits.

When the retries do run out, the lead stays marked *Import failed* with the
reason on it, and there's a retry button on the lead page.

With nothing deployed, the import page still works: it falls back to running
the same steps from the browser tab, a few leads at a time, and says so. Fine
for a dozen leads; deploy the functions for hundreds.

### Deploying it

This reuses the `leader-cron` service account and the secrets you already set
up for the outreach cron, so do that section first. What's new is the Cloud
Tasks queue plus the two functions.

**Order matters here.** The queue must exist before the worker, and the worker
must exist before the dispatcher — the dispatcher needs the worker's URL baked
into its environment. Run all of it in one shell session; later steps use
variables set by earlier ones.

#### 1. The queue

This is the thing that holds the per-lead tasks and hands them out at a
controlled rate. The numbers below are the throttle for the whole import: two
leads dispatched per second, ten in flight at once, three attempts each before
giving up.

```bash
PROJECT=$(gcloud config get-value project)
SA=leader-cron@$PROJECT.iam.gserviceaccount.com
REGION=australia-southeast1

gcloud tasks queues create leader-import --location=$REGION \
  --max-dispatches-per-second=2 --max-concurrent-dispatches=10 \
  --max-attempts=3 --min-backoff=60s

# may put tasks on a queue
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role=roles/cloudtasks.enqueuer

# may mint OIDC tokens as itself, so the queue can prove who it is to the worker
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser
```

That last binding looks odd — the account being granted access to itself — but
it's what lets the queue call the worker carrying a token that says "I am
leader-cron".

#### 2. The worker

Same bundle as the cron, different entry point.

```bash
pnpm build:functions

gcloud functions deploy leader-import-lead \
  --gen2 --runtime=nodejs22 --region=$REGION \
  --source=functions --entry-point=importLead \
  --trigger-http --no-allow-unauthenticated \
  --service-account="$SA" --timeout=540s --memory=512Mi \
  --set-env-vars=GEMINI_MODEL=gemini-3.1-pro-preview \
  --set-secrets=GOOGLE_GENERATIVE_AI_API_KEY=leader-gemini-key:latest,CRON_SECRET=leader-cron-secret:latest

# grab its URL for the next step, and let leader-cron call it
WORKER_URL=$(gcloud functions describe leader-import-lead --region=$REGION --gen2 --format='value(serviceConfig.uri)')
gcloud functions add-invoker-policy-binding leader-import-lead \
  --region=$REGION --member="serviceAccount:$SA"
```

#### 3. The dispatcher

```bash
gcloud functions deploy leader-bulk-import \
  --gen2 --runtime=nodejs22 --region=$REGION \
  --source=functions --entry-point=bulkImport \
  --trigger-http --allow-unauthenticated \
  --service-account="$SA" --timeout=540s --memory=256Mi \
  --set-env-vars=IMPORT_LEAD_URL=$WORKER_URL,TASKS_LOCATION=$REGION,IMPORT_QUEUE=leader-import,TASKS_SA_EMAIL=$SA \
  --set-secrets=CRON_SECRET=leader-cron-secret:latest
```

The two functions are locked down differently, on purpose:

- The **worker** is `--no-allow-unauthenticated`. Only Cloud Tasks ever calls
  it, and it does so with an OIDC token minted for `leader-cron`. Nothing on
  the open internet can reach it.
- The **dispatcher** is `--allow-unauthenticated`, because the thing that calls
  it is your app server — not a Google identity, so it has no token to present.
  The `x-cron-secret` header is the lock instead: without it the function
  answers 403 before touching anything.

#### 4. Tell the app where the dispatcher is

In the app server's environment (Vercel, `.env`, wherever the TanStack server
runs):

```bash
BULK_IMPORT_URL=$(gcloud functions describe leader-bulk-import --region=$REGION --gen2 --format='value(serviceConfig.uri)')
CRON_SECRET=$(gcloud secrets versions access latest --secret=leader-cron-secret)
```

That's the last manual deploy of the import pair. From here GitHub Actions
redeploys every already-deployed function on pushes to `main`.

## The contact page

westringia.com/contact runs on this repo too. The page's "show us your
website" tool and its enquiry form both call one public Cloud Function,
`leader-westringia` ([functions/src/westringia.ts](./functions/src/westringia.ts)),
which reuses the exact extraction + generation pipeline the CRM uses and
writes into the same `leads` collection. Two POST routes:

- **`/research`** - body `{ url, email, consent: true }`. The email is
  required and consent must be ticked before anything runs; both are stored on
  the lead as proof (the exact consent sentence, when, and a salted hash of
  the network address - never the address itself). If a lead for that domain
  is already researched, the stored research answers immediately and nothing
  is re-crawled or re-billed. Otherwise the site is read through an
  SSRF-guarded fetcher ([functions/src/safe-fetch.ts](./functions/src/safe-fetch.ts))
  and written up, and the visit lands as a lead either way - created with
  `source: 'westringia-contact'`, or appended to the existing one. The
  response is a public-safe subset (summary, use cases, tech signals) - never
  the cold email draft.
- **`/enquiry`** - the contact form. Appends to the lead the research created
  (matched by id, falling back to domain), moves it to *in conversation*, and
  emails `NOTIFY_EMAIL` so the same-day-reply promise has a human behind it.
  Works as JSON and as a no-JS urlencoded post (303 back to the static site).

Leads with `source: 'westringia-contact'` are never cold-emailed by the
outreach cron - they asked to hear from a person, and the cold sequence is not
that. Reply by hand from the lead page.

Abuse controls: 5 research / 10 enquiry calls per IP per hour, a global daily
fuse on Gemini spend (`CONTACT_DAILY_RESEARCH_CAP`, default 300), a honeypot
field, and hard output caps on everything echoed back to the page.

### Deploying it

Reuses the `leader-cron` service account and secrets from the outreach cron,
so do that section first. This is the one function that must allow
unauthenticated invoke - anonymous visitors are the audience:

```bash
gcloud functions deploy leader-westringia \
  --gen2 --runtime=nodejs22 --region=australia-southeast1 \
  --source=functions --entry-point=westringia \
  --trigger-http --allow-unauthenticated \
  --service-account="$SA" --timeout=300s --memory=512Mi \
  --set-env-vars=SMTP_USER=hello@westringia.com,NOTIFY_EMAIL=you@westringia.com,APP_URL=https://your-app-url,GEMINI_MODEL=gemini-3.1-pro-preview,CONTACT_DAILY_RESEARCH_CAP=300 \
  --set-secrets=SMTP_PASS=leader-smtp-pass:latest,GOOGLE_GENERATIVE_AI_API_KEY=leader-gemini-key:latest,CRON_SECRET=leader-cron-secret:latest
```

`CRON_SECRET` is not an auth gate here (the routes are public by design); it
salts the hashed network addresses. A fresh research call is a crawl plus a
pro-model generation, so expect it to take a minute or two; set `GEMINI_MODEL`
to a flash model on this function alone if that is too slow for the page.

Then point the static site at it - in westringia.com's `src/site.ts`, set
`apiBase` to the function's URL:

```bash
gcloud functions describe leader-westringia --region=australia-southeast1 --gen2 --format='value(serviceConfig.uri)'
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

Two things to keep in mind for cold outreach from your primary domain. Volume
is handled for you: [the daily allowance](#how-much-goes-out-in-a-day) starts
at 30 and climbs weekly, and [every address is checked before
sending](#checking-the-address-before-sending), because bounces cost the
mailbox more than volume does. The other one is on you: leave the
identification and opt-out lines in the drafts. Commercial email in Australia
falls under the Spam Act.

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

