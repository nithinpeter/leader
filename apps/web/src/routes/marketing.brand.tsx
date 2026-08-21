import { createFileRoute, Link } from '@tanstack/react-router'
import { AppShell, Protected } from '../components/AppShell'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui'

export const Route = createFileRoute('/marketing/brand')({
  component: () => (
    <AppShell
      breadcrumbs={[
        { label: 'Dashboard', to: '/' },
        { label: 'Marketing', to: '/marketing' },
        { label: 'Brand guidelines' },
      ]}
    >
      <Protected>
        <Brand />
      </Protected>
    </AppShell>
  ),
})

/**
 * The Westringia Labs brand, gathered in one place for anyone producing
 * marketing material. Everything here is lifted from where it is enforced:
 * the design tokens in westringia's global.css, the writing rules published
 * at westringia.com/how-we-write, and the card conventions in the templates
 * at /marketing/cards.
 */

const SURFACES = [
  { name: 'paper', hex: '#FAF9F4', note: 'The page. Warm, never pure white.' },
  { name: 'paper-deep', hex: '#F2F0E8', note: 'Recessed panels, code blocks.' },
  { name: 'paper-card', hex: '#FFFFFF', note: 'Raised cards on paper.' },
]

const INKS = [
  { name: 'ink', hex: '#1C1B18', note: 'Headings and emphasis. 16.5:1 on paper.' },
  { name: 'ink-2', hex: '#55534C', note: 'Body text. 7.3:1.' },
  { name: 'ink-3', hex: '#6E6C63', note: 'Captions, metadata. 4.8:1.' },
]

const ACCENTS = [
  { name: 'sage', hex: '#5F7355', note: 'The brand green. The flower, the wordmark "Labs".' },
  { name: 'sage-deep', hex: '#3F4F38', note: 'Buttons, links, numbers that matter.' },
  { name: 'clay', hex: '#A8603C', note: 'Reserved for "check this". Never decoration.' },
]

const RULES = [
  { name: 'rule', hex: '#DEDCD2', note: 'Hairline dividers.' },
  { name: 'rule-strong', hex: '#C6C3B6', note: 'Frames, table heads.' },
  { name: 'rule-control', hex: '#8D8878', note: 'Button and input borders (3:1 AA).' },
]

const WRITING_RULES = [
  ['Sentences average fifteen words. Twenty-five is the ceiling.', 'A short one after a long one carries weight.'],
  ['Write to a Year 7 reading level.', '"Get" not "access", "start" not "commence", "each year" not "annually".'],
  ['Say "you" and "we".', 'Never "clients" when we mean you. Third person about yourself is a way of hiding.'],
  ['Every number carries its source.', 'If we cannot link it, we do not write it. A small honest number beats a big unsourced one.'],
  ['Present tense for what is true. Never for what we hope.', 'If it is a plan, it is written as a plan, with a date.'],
  ['Sentence case headings, and no questions.', 'Title Case Looks Like An Advertisement.'],
  ['Australian spelling, and spaced en dashes.', 'Organisation, realise, licence. The en dash – like that – never the em dash.'],
  ['Main point first.', 'The first sentence of a paragraph says what the paragraph is about.'],
  ['No boasting adjectives.', 'Describe what happens instead. "We test against a hundred real jobs" beats "rigorous quality assurance".'],
]

const BANNED_WORDS = [
  'leverage', 'unlock', 'empower', 'transform', 'harness', 'elevate',
  'cutting-edge', 'game-changing', 'world-class', 'holistic', 'synergy',
  'bespoke', 'journey', 'seamless', 'robust', 'delve', 'crucial', 'pivotal',
  'tapestry', 'testament', 'revolutionary', 'state-of-the-art',
]

function Swatch({ name, hex, note }: { name: string; hex: string; note: string }) {
  const lightText = ['ink', 'ink-2', 'sage', 'sage-deep', 'clay', 'rule-control'].includes(name)
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div
        className="flex h-16 items-end px-3 pb-2"
        style={{ backgroundColor: hex, color: lightText ? '#FAF9F4' : '#1C1B18' }}
      >
        <span className="font-mono text-[11px]">{hex}</span>
      </div>
      <div className="p-3">
        <p className="text-sm font-medium">{name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
      </div>
    </div>
  )
}

function Brand() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <p className="kicker">Marketing · Brand</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
        Westringia Labs brand guidelines
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        The aesthetic brief, recorded so nobody "fixes" it later: an Australian
        technical field manual, not a startup landing page. Warm paper, one
        strong serif for headings, hairline rules instead of heavy cards, real
        tables for real data, and colour used sparingly and only where it means
        something. Everything below is enforced somewhere — the tokens in the
        site's stylesheet, the writing rules published at{' '}
        <a
          href="https://westringia.com/how-we-write"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sage-deep underline underline-offset-2"
        >
          westringia.com/how-we-write
        </a>
        , and the card conventions in the{' '}
        <Link to="/marketing/cards" className="text-sage-deep underline underline-offset-2">
          card templates
        </Link>
        .
      </p>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold tracking-tight">Colour</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Paper, ink, sage, clay. No purple, no glassmorphism. Every pair meets
          WCAG 2.2 AA on its surface (4.5:1 body, 3:1 UI). Accents carry
          meaning: sage is ours, clay means "check this" — neither is ever
          decoration.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {SURFACES.map((s) => (
            <Swatch key={s.name} {...s} />
          ))}
          {INKS.map((s) => (
            <Swatch key={s.name} {...s} />
          ))}
          {ACCENTS.map((s) => (
            <Swatch key={s.name} {...s} />
          ))}
          {RULES.map((s) => (
            <Swatch key={s.name} {...s} />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold tracking-tight">Type</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-2xl font-semibold">
                Source Serif 4
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Display face: headings, big numbers, card displays. Weight 600,
              tight letter-spacing (−0.021em), sizes deliberately restrained —
              oversized heroes read as marketing.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl font-semibold" style={{ fontFamily: "'Public Sans', sans-serif" }}>
                Public Sans
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Body face on westringia.com and the collateral — the typeface of
              the Australian Government Design System. Inter, Roboto, Open Sans
              and Lato are avoided on purpose in brand material.
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Wordmark and mark
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The wordmark is a heavy, tight, uppercase grotesque — Public Sans 900,
          letter-spacing −0.055em — with the flower mark at cap height and{' '}
          <em className="not-italic text-sage">Labs</em> in sage, no space. The
          flower is the westringia bloom as line art, always sage, often hanging
          off the edge of a frame the way the site's marks hang off a plate.
          Master assets (logo, banner, email lockup, partner badges) live in the
          westringia repo under <code className="rounded bg-muted px-1 py-0.5 text-xs">public/brand/</code>{' '}
          and <code className="rounded bg-muted px-1 py-0.5 text-xs">docs/</code>.
        </p>
        <div className="mt-4 rounded-md border border-border bg-[#FAF9F4] p-8">
          <span
            className="inline-flex items-center gap-2 text-2xl font-black uppercase text-[#1C1B18]"
            style={{ fontFamily: "'Public Sans', sans-serif", letterSpacing: '-0.055em' }}
          >
            <FlowerMark />
            Westringia <em className="not-italic text-[#5F7355]">Labs</em>
          </span>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Voice: nine rules
        </h2>
        <div className="mt-4 divide-y divide-border rounded-md border border-border">
          {WRITING_RULES.map(([rule, detail]) => (
            <div key={rule} className="px-4 py-3">
              <p className="text-sm font-medium">{rule}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Words we do not use
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Some are filler. Others are words machines overuse to a measured
          degree. The list is published so readers can hold us to it.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {BANNED_WORDS.map((w) => (
            <li
              key={w}
              className="rounded-sm border border-border px-2.5 py-1 text-sm text-muted-foreground line-through decoration-clay decoration-2"
            >
              {w}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 mb-4">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          LinkedIn cards
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          1080 × 1350 (portrait). Paper ground, hairline frame with the clay
          second impression printed out of register, the sage flower overhanging
          one corner, wordmark and URL in the footer. Every number on a card is
          published on the site with a source beside it — if a number changes on
          the site, it changes on the card too. Compose new cards in the{' '}
          <Link to="/marketing/cards" className="text-sage-deep underline underline-offset-2">
            card templates
          </Link>{' '}
          page and screenshot them with <code className="rounded bg-muted px-1 py-0.5 text-xs">tools/shoot-cards.mjs</code>.
        </p>
      </section>
    </div>
  )
}

function FlowerMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="#5F7355"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <ellipse cx="12" cy="7.4" rx="2.7" ry="4.4" />
      <ellipse cx="7.9" cy="10.6" rx="2.7" ry="4.4" transform="rotate(-72 7.9 10.6)" />
      <ellipse cx="16.1" cy="10.6" rx="2.7" ry="4.4" transform="rotate(72 16.1 10.6)" />
      <ellipse cx="9.5" cy="15.6" rx="2.7" ry="4.4" transform="rotate(-36 9.5 15.6)" />
      <ellipse cx="14.5" cy="15.6" rx="2.7" ry="4.4" transform="rotate(36 14.5 15.6)" />
      <circle cx="12" cy="12" r="1.6" />
    </svg>
  )
}
