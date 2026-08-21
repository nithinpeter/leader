import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import '../styles/cards.css'

/**
 * LinkedIn poster cards — one per post in the westringia repo's
 * docs/social/queue. Moved here from westringia (src/pages/social/cards.astro).
 *
 * This page is a tool, not a page of the app: it renders each card at exactly
 * 1080 × 1350 (LinkedIn portrait), and tools/shoot-cards.mjs screenshots each
 * one. It is deliberately outside the auth gate so the screenshot script can
 * reach it against a local dev server, and it is noindexed. Every number on a
 * card is published on westringia.com with a source beside it. If a number
 * changes on the site, it changes here too.
 *
 * To draft a card for a new post: copy the closest existing card section,
 * give it the next id (`card-13`, …), add its slug to tools/shoot-cards.mjs,
 * and follow the brand rules at /marketing/brand.
 */

const BANNED_WORDS = [
  'leverage', 'unlock', 'empower', 'transform', 'harness', 'elevate',
  'cutting-edge', 'game-changing', 'world-class', 'holistic', 'synergy',
  'bespoke', 'journey', 'seamless', 'robust', 'delve', 'crucial', 'pivotal',
  'tapestry', 'testament', 'revolutionary', 'state-of-the-art',
]

export const Route = createFileRoute('/marketing/cards')({
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
    links: [
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Public+Sans:ital,wght@0,100..900;1,100..900&display=swap',
      },
    ],
  }),
  component: CardsPage,
})

function CardShell({
  id,
  head,
  no,
  url,
  mark,
  children,
}: {
  id: string
  head: string
  no: string
  url: string
  mark: 'tl' | 'tr' | 'bl' | 'br'
  children: ReactNode
}) {
  return (
    <section className="card" id={id}>
      <div className="card-frame">
        <header className="card-head">
          <span>{head}</span>
          <span className="card-no">№ {no}</span>
        </header>
        <main className="card-main">{children}</main>
        <footer className="card-foot">
          <span className="card-wordmark">
            <span className="fl" />
            Westringia <em>Labs</em>
          </span>
          <span>{url}</span>
        </footer>
      </div>
      <span className={`card-mark card-mark--${mark}`} />
    </section>
  )
}

function CardsPage() {
  return (
    <div className="li-cards">
      {/* ============ 01 · The gap ============ */}
      <CardShell id="card-01" head="Westringia Labs · Sydney" no="01" url="westringia.com" mark="br">
        <div className="poles">
          <div className="pole">
            <p className="pole-price">
              A$110 <span className="pole-unit">a week</span>
            </p>
            <p className="pole-label">
              Subscription automation. Real, but nobody is reading the fine print on your data.
            </p>
          </div>
          <h1 className="card-display gap-line">So the middle does nothing, for&nbsp;years.</h1>
          <div className="pole">
            <p className="pole-price">A$120,000–400,000</p>
            <p className="pole-label">A Big 4 scoping engagement, before a line of code is written.</p>
          </div>
        </div>
        <p className="card-close">
          Our diagnostic sits in between: <strong>A$4,500</strong>, two weeks, and a fixed quote
          for the one thing worth building.
        </p>
      </CardShell>

      {/* ============ 02 · The prices ============ */}
      <CardShell id="card-02" head="Westringia Labs · Sydney" no="02" url="westringia.com/pricing" mark="tr">
        <h1 className="card-display">The prices are on the&nbsp;website.</h1>
        <table className="card-tbl">
          <tbody>
            <tr>
              <td>Two weeks of looking</td>
              <td className="num">A$4,500</td>
            </tr>
            <tr>
              <td>One workflow, live</td>
              <td className="num">A$9,000</td>
            </tr>
            <tr>
              <td>Implementation sprint</td>
              <td className="num">A$12,000–28,000</td>
            </tr>
            <tr>
              <td>Run it with us</td>
              <td className="num">
                A$3,500–7,500 <span className="per">/mo</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="card-close">
          Fixed price, fixed scope, Australian dollars, excluding GST. No hourly rate, no day
          rate, no time sheets.
        </p>
      </CardShell>

      {/* ============ 03 · Buy, don't build ============ */}
      <CardShell id="card-03" head="Westringia Labs · Sydney" no="03" url="westringia.com" mark="bl">
        <h1 className="card-display">Most weeks we talk somebody out of a&nbsp;build.</h1>
        <ul className="card-list">
          <li>A phone agent their job system already sells.</li>
          <li>Supplier pricing their job system already imports.</li>
          <li>Invoice reminders that ship switched off.</li>
        </ul>
        <p className="card-close card-close--big">
          If software you already pay for does the job, <strong>buy&nbsp;that</strong>.
        </p>
        <p className="card-sub">You hear it on a free half-hour call, and it costs you nothing.</p>
      </CardShell>

      {/* ============ 04 · The number we could not find ============ */}
      <CardShell id="card-04" head="Westringia Labs · Sydney" no="04" url="westringia.com" mark="tr">
        <p className="struck">“Missed calls cost tradies $50,000 a year.”</p>
        <h1 className="card-display">We went looking for the source. There isn’t&nbsp;one.</h1>
        <p className="card-body">
          The figure traces back to vendor blogs quoting each other. That does not make missed
          calls harmless. It makes the number unusable.
        </p>
        <p className="card-close card-close--clay">
          We would rather count a month of your real calls and tell you your own number.
        </p>
      </CardShell>

      {/* ============ 05 · What the diagnostic buys ============ */}
      <CardShell id="card-05" head="Westringia Labs · Sydney" no="05" url="westringia.com/how-we-work" mark="br">
        <h1 className="card-display">What A$4,500 buys.</h1>
        <ol className="card-steps">
          <li>
            <span className="step-no">1</span>A half-day workshop with the people who do the work.
          </li>
          <li>
            <span className="step-no">2</span>Three to five shadowing sessions. We sit beside them
            and time things.
          </li>
          <li>
            <span className="step-no">3</span>A 15–25 page report: five to eight options, ranked,
            showing their arithmetic.
          </li>
          <li>
            <span className="step-no">4</span>A 90-minute readout, and a fixed quote for the top
            item.
          </li>
        </ol>
        <p className="card-close">
          Start a build within 90 days and the A$4,500 comes off it. Sometimes the recommendation
          is to build nothing.
        </p>
      </CardShell>

      {/* ============ 06 · Hosted in Australia ============ */}
      <CardShell id="card-06" head="Westringia Labs · Field notes" no="06" url="westringia.com" mark="tl">
        <h1 className="card-display">“Hosted in Australia” is a setting, not a&nbsp;slogan.</h1>
        <div className="code-pair">
          <div className="code-row">
            <code>
              <span className="au">au.</span>anthropic.claude-opus-5
            </code>
            <p>Pinned to the Australian geography – Sydney and Melbourne.</p>
          </div>
          <div className="code-row code-row--dim">
            <code>anthropic.claude-opus-5</code>
            <p>Goes wherever the default profile sends it. Usually not here.</p>
          </div>
        </div>
        <p className="card-close">
          Ask your supplier which profile. Then ask to see it. We keep a model-by-model table,
          dated and sourced.
        </p>
      </CardShell>

      {/* ============ 07 · eCert deadline ============ */}
      <CardShell id="card-07" head="NSW electrical work" no="07" url="westringia.com/what-we-do" mark="tr">
        <p className="card-kicker">Since</p>
        <h1 className="card-display card-display--date">1 July 2026</h1>
        <p className="card-body card-body--big">
          certificates of compliance go through the Building Commission NSW eCert portal.{' '}
          <strong className="clay">Handwritten and PDF forms are no longer accepted.</strong>
        </p>
        <p className="card-close">
          There is a public API, so your job system can lodge from the job record. Only a licensed
          electrician signs – software drafts, every time.
        </p>
      </CardShell>

      {/* ============ 08 · 19% slower ============ */}
      <CardShell id="card-08" head="Westringia Labs · Sydney" no="08" url="westringia.com/how-we-work" mark="bl">
        <div className="split">
          <div className="split-half">
            <p className="split-num">
              19% <span className="split-dir">slower</span>
            </p>
            <p className="split-label">on the stopwatch</p>
          </div>
          <div className="split-rule" />
          <div className="split-half">
            <p className="split-num split-num--dim">
              20% <span className="split-dir">“faster”</span>
            </p>
            <p className="split-label">in their own estimate</p>
          </div>
        </div>
        <p className="card-body">
          Sixteen experienced developers, 246 real tasks, working with AI tools, 2025. The tools
          have moved since. The gap between what people felt and what the clock said is the part
          that survives.
        </p>
        <h2 className="card-close card-close--big">
          <strong>People cannot tell. So we count.</strong>
        </h2>
      </CardShell>

      {/* ============ 09 · Words we do not use ============ */}
      <CardShell id="card-09" head="Westringia Labs · Sydney" no="09" url="westringia.com/how-we-write" mark="tr">
        <h1 className="card-display">Words we do not&nbsp;use.</h1>
        <ul className="chips">
          {BANNED_WORDS.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <p className="card-close">
          Some are filler. Others are words machines overuse to a measured degree. The full list
          is published, so you can hold us to it.
        </p>
      </CardShell>

      {/* ============ 10 · 84 of 100 ============ */}
      <CardShell id="card-10" head="Westringia Labs · Sydney" no="10" url="westringia.com/how-we-work" mark="br">
        <p className="big-count">
          <span>84</span>
          <span className="of">of</span>
          <span>100</span>
        </p>
        <h1 className="card-display">The output is a count, not a&nbsp;feeling.</h1>
        <p className="card-body">
          We test with a hundred real jobs from your business. You get the number, the 16 it got
          wrong, and why each one failed. Then we fix those and run the lot again.
        </p>
        <p className="card-close">
          If it passes everything first go, the test was too easy, and we go and write a harder
          one.
        </p>
      </CardShell>

      {/* ============ 11 · No case studies ============ */}
      <CardShell id="card-11" head="Westringia Labs · Sydney" no="11" url="westringia.com/proof" mark="tl">
        <div className="logo-row">
          <span className="logo-slot" />
          <span className="logo-slot" />
          <span className="logo-slot" />
          <span className="logo-slot" />
        </div>
        <h1 className="card-display">
          A story you cannot check is worth about as much as no story at&nbsp;all.
        </h1>
        <p className="card-body">
          No client has signed off on a case study, so there is no case study. What we have is
          Lomandra – our own product, answering the phone for Australian small businesses, on the
          internet right now.
        </p>
      </CardShell>

      {/* ============ 12 · Integration ============ */}
      <CardShell id="card-12" head="Westringia Labs · Sydney" no="12" url="westringia.com/what-we-do" mark="br">
        <h1 className="card-display">The AI is rarely the expensive&nbsp;part.</h1>
        <ul className="card-list card-list--rules">
          <li>A webhook says a record changed – not what it changed to.</li>
          <li>Xero caps API calls per day. The cap decides how often you can look.</li>
          <li>Tradify publishes no developer documentation we can find at all.</li>
        </ul>
        <p className="card-close">
          This is why one build costs four times another that sounded identical in the meeting.
          You should hear it on the first call.
        </p>
      </CardShell>
    </div>
  )
}
