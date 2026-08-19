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
in the system prompt in [`src/server/generate-core.ts`](./src/server/generate-core.ts):
plain words, short sentences, humble without underselling, honest about what
AI cannot do here, conservative with numbers, no invented commercial terms, and
no em dashes. That last one is also enforced in code, because models slip.

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
   and you edit it before sending from hello@westringia.com via Spacemail SMTP.
   Sends are logged on the lead and the status advances to *contacted*. Nothing
   sends without a human click.

Keep the docs out of the first email. Attachments and links to a cold address
are what trip spam filters, so the email offers the write-up rather than
carrying it, and you send it when they reply.

No `GOOGLE_GENERATIVE_AI_API_KEY`? The flow still works end to end with a
clearly-marked template draft, so you can set up Firebase first and add the
key later.

## Setup

```bash
npm install
cp .env.example .env
```

### Firebase

1. Create a project at console.firebase.google.com.
2. **Authentication → Sign-in method**: enable **Google**. Add your dev/prod
   domains under *Authorized domains* (localhost is pre-authorised).
3. **Firestore Database**: create a database, then publish the rules in
   [`firestore.rules`](./firestore.rules) (any signed-in user can read/write
   the shared `leads` collection).
4. **Project settings → Your apps → Web app**: register a web app and copy the
   config values into `.env` (`VITE_FIREBASE_*`).

### Gemini

Create an API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
and put it in `.env` as `GOOGLE_GENERATIVE_AI_API_KEY` (server-side only; it
is never sent to the browser). The model defaults to `gemini-3.1-pro-preview`.
This is copywriting a client reads, so it wants a pro model. The flash models
write blander and break the voice rules more often.
Set `GEMINI_MODEL` to override, and check the id is still live if generation starts failing.

### Email (Spacemail)

Outgoing mail uses [Spacemail's SMTP](https://www.spaceship.com/knowledgebase/connect-spacemail-to-email-client/):
host `mail.spacemail.com`, port `465` (SSL) — port `587` (STARTTLS) also works
on restricted networks. Set `SMTP_USER` to the full mailbox address
(hello@westringia.com) and `SMTP_PASS` to its password. Every send BCCs the
mailbox itself, since SMTP sends don't land in the Sent folder.

Two things to keep in mind for cold outreach from your primary domain:
keep volume low (a handful a day) to protect the mailbox's reputation, and
leave the identification + opt-out lines in the drafts — commercial email in
Australia falls under the Spam Act.

### Run

```bash
npm run dev    # http://localhost:3000
npm run build  # production build
npm start      # serve the production build
```

## Notes

- The site reader is polite but simple: it fetches HTML with a 15s timeout and
  parses it without a headless browser, so JS-only sites yield thin research.
  Generation stays conservative when research is thin.
- Extraction and generation both run server-side (TanStack server functions),
  so no CORS issues and no API key exposure.
- The `leads` collection is shared across all signed-in users by design. It is
  one team pipeline, not per-user data.
