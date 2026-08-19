# Leader

Lead research and CRM for Westringia Labs. Enter a business's website; Leader
reads it, works out what they do, drafts Westringia's angle plus two AI
automation opportunities, and produces a print-ready **Westringia × Company**
opportunity doc in the westringia.com house style.

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
3. A second server function asks Gemini (via the Vercel AI SDK) for the research doc content: company
   summary, Westringia's unique proposition for that business, exactly two
   grounded AI automation use cases, where AI fits, and a cold-open line.
4. The lead lands in the Firestore pipeline (`new → researched → doc_ready →
   contacted → in conversation → won/lost`), with notes.
5. **Open opportunity doc** renders the Westringia × Company doc — use
   *Print / save as PDF* (A4 print styles included) or screenshot it for
   outreach materials.

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
is never sent to the browser). The model defaults to `gemini-3-pro-preview`;
set `GEMINI_MODEL` to override.

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
- The `leads` collection is shared across all signed-in users by design — it's
  one team pipeline, not per-user data.
